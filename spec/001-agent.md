# GLaDOS - Personal AI Assistant Specification

> "I'm doing science and I'm still alive."

**Version**: 1.0 (Initial Implementation Complete)
**Status**: Phases 1-7 Implemented | 580+ Tests Passing

## Overview

GLaDOS (General Learning and Decision Orchestration System) is a personal AI assistant designed to operate both interactively and proactively. It maintains a rich model of you, anticipates your needs, and manages complex multi-step tasks with human-in-the-loop trust controls.

### Goals

1. **Personal Context**: Maintain a rich model of the user - identity, relationships, projects, goals, routines
2. **Proactive Assistant**: Anticipate needs, not just respond to requests
3. **Interactive & Reactive**: Handle direct queries and external events (emails, webhooks, schedules)
4. **Long-Running Tasks**: Manage multi-step workflows that span hours or days
5. **Learning System**: Build long-term memory, learn preferences, improve over time
6. **Extensible Tooling**: Support many tools without overwhelming the agent's context
7. **Trust Through Control**: Human-in-the-loop for risky actions, transparent about what it's doing

### Non-Goals (for v1)

- Multi-user support
- Voice interface
- Mobile app (notifications yes, full app no)

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              GLaDOS Core                                  │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                        Foundation Layer                              │ │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌────────┐│ │
│  │  │User Model │ │ Contacts  │ │ Calendar  │ │ Location  │ │ Memory ││ │
│  │  │ (who am I)│ │  (who)    │ │  (when)   │ │  (where)  │ │(recall)││ │
│  │  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └───┬────┘│ │
│  │        └─────────────┴─────────────┴─────────────┴───────────┘     │ │
│  │                                │                                    │ │
│  │                                ▼                                    │ │
│  │                      ┌─────────────────┐                           │ │
│  │                      │ Context Builder │                           │ │
│  │                      │ (unified view)  │                           │ │
│  │                      └────────┬────────┘                           │ │
│  └───────────────────────────────┼─────────────────────────────────────┘ │
│                                  │                                       │
│  ┌───────────────────────────────┼───────────────────────────────────┐  │
│  │                    Orchestration Layer                             │  │
│  │                               │                                    │  │
│  │    ┌──────────────┐          ▼           ┌──────────────┐         │  │
│  │    │   Ingress    │   ┌─────────────┐    │  Proactive   │         │  │
│  │    │   (events,   │──▶│Orchestrator │◀───│  Scheduler   │         │  │
│  │    │   webhooks)  │   │ (LangGraph) │    │  (cron)      │         │  │
│  │    └──────────────┘   └──────┬──────┘    └──────────────┘         │  │
│  │                              │                                     │  │
│  │              ┌───────────────┼───────────────┐                    │  │
│  │              ▼               ▼               ▼                    │  │
│  │       ┌───────────┐   ┌───────────┐   ┌───────────┐              │  │
│  │       │   Task    │   │   Tool    │   │  Notify   │              │  │
│  │       │   Queue   │   │  Router   │   │  Router   │              │  │
│  │       │(long-run) │   │(risk gate)│   │(channels) │              │  │
│  │       └───────────┘   └─────┬─────┘   └───────────┘              │  │
│  │                             │                                     │  │
│  └─────────────────────────────┼─────────────────────────────────────┘  │
│                                │                                        │
│                    ┌───────────┼───────────┐                           │
│                    ▼           ▼           ▼                           │
│             ┌──────────┐ ┌──────────┐ ┌──────────┐                     │
│             │ Tool Set │ │ Tool Set │ │ Discovery│                     │
│             │    A     │ │    B     │ │  Agent   │                     │
│             └──────────┘ └──────────┘ └──────────┘                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Component         | Technology                 | Rationale                                |
| ----------------- | -------------------------- | ---------------------------------------- |
| Agent Framework   | LangChain + LangGraph      | Mature ecosystem, graph-based workflows  |
| Persistence       | Knex + SQLite + sqlite-vss | Simple, portable, vector search built-in |
| Runtime           | Node.js 22+                | Native TypeScript via type stripping     |
| Schema Validation | Zod                        | Type inference, runtime validation       |

---

## Foundation Layer

The foundation layer contains core data that shapes every interaction. These are not tools - they're always-available context.

### 1. User Model

The agent's understanding of _who you are_. This is the most important component - it transforms the agent from a generic chatbot to a personalized assistant.

```
src/
└── user-model/
    ├── user-model.ts             # Service interface
    ├── user-model.schemas.ts     # Zod schemas
    ├── user-model.store.ts       # Persistence
    └── user-model.test.ts
```

```typescript
type UserModel = {
  // Identity
  identity: {
    name: string;
    timezone: string;
    locale: string;
    workingHours: { start: string; end: string; days: number[] };
  };

  // Active focus areas
  projects: Project[];
  goals: Goal[];
  routines: Routine[];

  // Communication preferences
  preferences: {
    communicationStyle: 'casual' | 'professional' | 'formal';
    verbosity: 'terse' | 'balanced' | 'detailed';
    proactivityLevel: 'minimal' | 'moderate' | 'high';
  };
};

type Project = {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'paused' | 'completed';
  priority: 'low' | 'medium' | 'high';
  relatedContacts: string[]; // Contact IDs
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

type Goal = {
  id: string;
  description: string;
  timeframe: 'short' | 'medium' | 'long'; // weeks, months, years
  progress: string; // Freeform status
  relatedProjects: string[];
  createdAt: string;
  updatedAt: string;
};

type Routine = {
  id: string;
  name: string;
  schedule: CronExpression; // When this happens
  description: string; // What the agent should know/do
  enabled: boolean;
};
```

**Operations:**

```typescript
type UserModelService = {
  // Identity
  getIdentity: () => Promise<UserModel['identity']>;
  updateIdentity: (updates: Partial<UserModel['identity']>) => Promise<void>;

  // Projects
  getProjects: (filter?: { status?: string }) => Promise<Project[]>;
  getProject: (id: string) => Promise<Project | null>;
  createProject: (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Project>;
  updateProject: (id: string, updates: Partial<Project>) => Promise<Project>;

  // Goals
  getGoals: (filter?: { timeframe?: string }) => Promise<Goal[]>;
  createGoal: (goal: Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Goal>;
  updateGoal: (id: string, updates: Partial<Goal>) => Promise<Goal>;

  // Routines
  getRoutines: (filter?: { enabled?: boolean }) => Promise<Routine[]>;
  getActiveRoutines: () => Promise<Routine[]>; // Due now or soon
};
```

### 2. Contacts

First-class support for people and relationships. The agent needs to understand _who_ is involved in your life.

```
src/
└── contacts/
    ├── contacts.ts
    ├── contacts.schemas.ts
    ├── contacts.store.ts
    └── contacts.test.ts
```

```typescript
type Contact = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  organization?: string;
  role?: string; // Their role (e.g., "Project Manager")

  // Relationship to user
  relationship: {
    type: RelationshipType;
    context: string; // How you know them
    importance: 'low' | 'medium' | 'high' | 'critical';
  };

  // Agent-learned info
  notes: string; // Freeform notes about this person
  communicationStyle?: string; // How they prefer to communicate
  lastInteraction?: string; // ISO date
  tags: string[];

  createdAt: string;
  updatedAt: string;
};

type RelationshipType =
  | 'family'
  | 'friend'
  | 'colleague'
  | 'manager'
  | 'report'
  | 'client'
  | 'vendor'
  | 'professional'
  | 'other';

type ContactGroup = {
  id: string;
  name: string;
  description?: string;
  contactIds: string[];
};
```

**Operations:**

```typescript
type ContactsService = {
  // CRUD
  getContact: (id: string) => Promise<Contact | null>;
  findContacts: (query: string) => Promise<Contact[]>; // Name, email, org search
  createContact: (contact: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Contact>;
  updateContact: (id: string, updates: Partial<Contact>) => Promise<Contact>;

  // Lookup
  findByEmail: (email: string) => Promise<Contact | null>;
  findByRelationship: (type: RelationshipType) => Promise<Contact[]>;
  getImportantContacts: () => Promise<Contact[]>; // High/critical importance

  // Groups
  getGroups: () => Promise<ContactGroup[]>;
  getGroupMembers: (groupId: string) => Promise<Contact[]>;

  // Learning
  recordInteraction: (contactId: string, summary: string) => Promise<void>;
};
```

### 3. Calendar (Core)

Time awareness is fundamental to being a useful assistant. Calendar is core infrastructure, not an optional tool set.

```
src/
└── calendar/
    ├── calendar.ts
    ├── calendar.schemas.ts
    ├── calendar.sync.ts          # External calendar sync
    └── calendar.test.ts
```

```typescript
type CalendarEvent = {
  id: string;
  externalId?: string; // ID from external calendar (Google, Outlook)
  source: 'local' | 'google' | 'outlook' | 'ical';

  title: string;
  description?: string;
  location?: string;

  start: string; // ISO datetime
  end: string;
  allDay: boolean;
  timezone: string;

  // Participants
  attendees: Array<{
    contactId?: string; // Link to Contact if known
    email: string;
    name?: string;
    status: 'accepted' | 'declined' | 'tentative' | 'pending';
  }>;

  // Recurrence
  recurrence?: {
    rule: string; // RRULE format
    exceptions: string[]; // Dates to skip
  };

  // For agent awareness
  requiresPrep: boolean; // Does user need prep time?
  prepNotes?: string; // What to prepare
  travelTime?: number; // Minutes to get there

  tags: string[];
  createdAt: string;
  updatedAt: string;
};

type TimeBlock = {
  start: string;
  end: string;
  type: 'busy' | 'free' | 'tentative' | 'focus' | 'travel';
};
```

**Operations:**

```typescript
type CalendarService = {
  // Query
  getEvent: (id: string) => Promise<CalendarEvent | null>;
  getEventsInRange: (start: Date, end: Date) => Promise<CalendarEvent[]>;
  getUpcoming: (hours: number) => Promise<CalendarEvent[]>;
  getToday: () => Promise<CalendarEvent[]>;

  // Availability
  getFreeSlots: (date: Date, duration: number) => Promise<TimeBlock[]>;
  isBusy: (time: Date) => Promise<boolean>;
  getNextFreeTime: () => Promise<Date>;

  // Create/modify (local events)
  createEvent: (event: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>) => Promise<CalendarEvent>;
  updateEvent: (id: string, updates: Partial<CalendarEvent>) => Promise<CalendarEvent>;
  deleteEvent: (id: string) => Promise<void>;

  // Sync with external
  syncExternal: (source: string) => Promise<SyncResult>;

  // Context for agent
  getCurrentContext: () => Promise<{
    currentEvent: CalendarEvent | null;
    nextEvent: CalendarEvent | null;
    minutesToNext: number | null;
    todayRemaining: CalendarEvent[];
  }>;
};
```

### 4. Location

Where you are shapes what's relevant. Location enables travel time calculations, context-aware suggestions, and geofenced reminders.

```
src/
└── location/
    ├── location.ts
    ├── location.schemas.ts
    ├── location.store.ts
    └── location.test.ts
```

```typescript
type Location = {
  id: string;
  name: string; // "Home", "Office", "Gym"
  type: LocationType;

  // Coordinates (optional - for travel calculations)
  coordinates?: {
    latitude: number;
    longitude: number;
  };

  // Address (optional - for display/navigation)
  address?: {
    street?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  };

  // Context
  timezone?: string; // Override user's default
  isDefault: boolean; // Primary location (e.g., home)

  // Metadata
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

type LocationType = 'home' | 'work' | 'client' | 'travel' | 'venue' | 'other';

type CurrentLocation = {
  location: Location | null; // Known location, or null if unknown/transit
  confidence: 'exact' | 'approximate' | 'inferred';
  source: LocationSource;
  updatedAt: string;
};

type LocationSource =
  | 'manual' // User told us
  | 'calendar' // Inferred from current event location
  | 'device' // From phone/watch API
  | 'schedule'; // Inferred from routine

type TravelEstimate = {
  from: Location;
  to: Location;
  durationMinutes: number;
  mode: 'driving' | 'transit' | 'walking' | 'cycling';
  departBy: string; // To arrive on time
  source: 'cached' | 'api' | 'estimated';
};
```

**Operations:**

```typescript
type LocationService = {
  // Saved locations
  getLocations: () => Promise<Location[]>;
  getLocation: (id: string) => Promise<Location | null>;
  findLocationByName: (name: string) => Promise<Location | null>;
  createLocation: (location: Omit<Location, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Location>;
  updateLocation: (id: string, updates: Partial<Location>) => Promise<Location>;

  // Current location
  getCurrentLocation: () => Promise<CurrentLocation>;
  setCurrentLocation: (locationId: string, source?: LocationSource) => Promise<void>;
  inferCurrentLocation: () => Promise<CurrentLocation>; // From calendar, schedule, etc.

  // Travel
  estimateTravel: (from: Location | string, to: Location | string) => Promise<TravelEstimate>;
  getTravelTimeToEvent: (event: CalendarEvent) => Promise<TravelEstimate | null>;

  // Geofencing (for reminders)
  createGeofence: (locationId: string, trigger: 'enter' | 'exit', action: string) => Promise<Geofence>;
  getActiveGeofences: () => Promise<Geofence[]>;
};

type Geofence = {
  id: string;
  locationId: string;
  trigger: 'enter' | 'exit';
  action: string; // What to do when triggered
  enabled: boolean;
  createdAt: string;
};
```

**Location Inference:**

When exact location isn't available, infer from context:

```typescript
const inferCurrentLocation = async (): Promise<CurrentLocation> => {
  // 1. Check current calendar event
  const currentEvent = await calendar.getCurrentEvent();
  if (currentEvent?.location) {
    const location = await findLocationByAddress(currentEvent.location);
    if (location) {
      return { location, confidence: 'inferred', source: 'calendar', updatedAt: now() };
    }
  }

  // 2. Check user's routine for this time
  const routine = await userModel.getActiveRoutine();
  if (routine?.defaultLocation) {
    const location = await getLocation(routine.defaultLocation);
    if (location) {
      return { location, confidence: 'inferred', source: 'schedule', updatedAt: now() };
    }
  }

  // 3. Fall back to default (home) during non-work hours, office during work hours
  const isWorkHours = await userModel.isWorkingHours();
  const defaultLocation = await getDefaultLocation(isWorkHours ? 'work' : 'home');

  return {
    location: defaultLocation,
    confidence: 'inferred',
    source: 'schedule',
    updatedAt: now(),
  };
};
```

### 5. Entity Knowledge

Beyond the core entities (User, Contacts, Calendar, Location), the agent builds knowledge about _things in your world_ - companies, projects, products, documents, and concepts that come up in conversation. This is like a personal wiki that grows through interaction.

```
src/
└── memory/
    └── entity-knowledge/
        ├── entity-knowledge.ts
        ├── entity-knowledge.schemas.ts
        ├── entity-knowledge.store.ts
        └── entity-knowledge.test.ts
```

```typescript
type EntityType =
  | 'company' // Organizations you interact with
  | 'project' // Work initiatives (beyond your own projects)
  | 'document' // Reports, contracts, templates
  | 'product' // Physical or digital products
  | 'concept' // Ideas, frameworks, processes
  | 'place' // Named places (beyond saved locations)
  | 'other';

type EntityKnowledge = {
  id: string;
  name: string; // "Acme Corp", "Q4 Report", "Home Espresso Machine"
  type: EntityType;
  description: string;

  // Flexible attributes based on entity type
  attributes: Record<string, unknown>; // { "industry": "tech", "size": "enterprise" }

  // Relationships to other entities
  relationships: EntityRelation[];

  // Provenance
  source: 'explicit' | 'inferred'; // User told us vs. we figured it out
  confidence: number; // 0-1, how sure we are about this

  createdAt: string;
  updatedAt: string;
  lastReferencedAt: string; // For relevance tracking
  referenceCount: number;
};

type EntityRelation = {
  targetEntityId: string;
  targetType: 'entity' | 'contact' | 'project'; // Can link to different entity types
  relationshipType: string; // 'has_contact', 'belongs_to', 'uses_template', etc.
  metadata?: Record<string, unknown>;
};
```

**Operations:**

```typescript
type EntityKnowledgeService = {
  // CRUD
  createEntity: (
    entity: Omit<EntityKnowledge, 'id' | 'createdAt' | 'updatedAt' | 'lastReferencedAt' | 'referenceCount'>,
  ) => Promise<EntityKnowledge>;
  getEntity: (id: string) => Promise<EntityKnowledge | null>;
  updateEntity: (id: string, updates: Partial<EntityKnowledge>) => Promise<EntityKnowledge>;
  deleteEntity: (id: string) => Promise<boolean>;

  // Search
  findByName: (name: string) => Promise<EntityKnowledge[]>;
  findByType: (type: EntityType) => Promise<EntityKnowledge[]>;
  searchEntities: (query: string) => Promise<EntityKnowledge[]>; // Semantic search

  // Relationships
  addRelation: (entityId: string, relation: EntityRelation) => Promise<void>;
  getRelatedEntities: (entityId: string) => Promise<EntityKnowledge[]>;

  // Usage tracking
  recordReference: (entityId: string) => Promise<void>; // Mark as recently used
  getRecentEntities: (limit?: number) => Promise<EntityKnowledge[]>;
};
```

**Example Knowledge Graph:**

```
Acme Corp (company)
├── has_contact → Sarah (contact)
├── has_contact → Mike (contact)
├── has_project → Website Redesign (project)
└── uses_template → Formal Email Template (document)

Q4 Report (document)
├── uses_template → 2023 Q4 Report (document)
├── involves → Finance Team (contact group)
└── part_of → Annual Planning (project)
```

Entity knowledge enables natural references in conversation - when you say "send the proposal to Acme," the agent knows who Acme is, their communication preferences, and the relevant contacts.

### 6. Context Builder

Assembles a unified view of "the current situation" for the agent. This is what makes the agent context-aware.

```
src/
└── context/
    ├── context.ts
    ├── context.schemas.ts
    └── context.test.ts
```

```typescript
type AgentContext = {
  // Time (when)
  now: string;
  timezone: string;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  isWorkingHours: boolean;

  // Location (where)
  location: {
    current: Location | null;
    confidence: 'exact' | 'approximate' | 'inferred';
    atHome: boolean;
    atWork: boolean;
    traveling: boolean;
  };

  // User state (who)
  user: {
    name: string;
    activeProjects: Project[];
    currentGoals: Goal[];
  };

  // Calendar awareness
  calendar: {
    currentEvent: CalendarEvent | null;
    nextEvent: CalendarEvent | null;
    minutesToNext: number | null;
    travelTimeToNext: number | null; // Minutes, if location known
    shouldLeaveBy: string | null; // Time to leave for next event
    todayAgenda: string; // Human-readable summary
  };

  // Recent context
  recentContacts: Contact[]; // People mentioned/interacted recently
  recentTopics: string[]; // From memory retrieval
  pendingTasks: DelegatedTask[]; // Long-running tasks in progress

  // Active conversation (if any)
  conversation?: {
    id: string;
    summary: string;
    messageCount: number;
  };
};

type ContextBuilderService = {
  // Build full context for agent
  buildContext: () => Promise<AgentContext>;

  // Partial updates (for efficiency)
  getCalendarContext: () => Promise<AgentContext['calendar']>;
  getRecentContext: () => Promise<{ contacts: Contact[]; topics: string[] }>;
};
```

The orchestrator calls `buildContext()` at the start of each interaction, giving the LLM a complete picture.

---

## Orchestration Layer

### 5. Proactive Scheduler

Runs periodic checks and initiates agent actions without user prompting. This is what makes the agent _anticipate_ needs.

```
src/
└── proactive/
    ├── proactive.ts              # Scheduler runner
    ├── proactive.schemas.ts
    ├── proactive.checks.ts       # Check definitions
    └── proactive.test.ts
```

```typescript
type ProactiveCheck = {
  id: string;
  name: string;
  description: string;

  // When to run
  schedule: CronExpression;
  enabled: boolean;

  // What to check
  check: (context: AgentContext) => Promise<ProactiveResult | null>;
};

type ProactiveResult = {
  // What was detected
  finding: string;
  urgency: 'low' | 'medium' | 'high';

  // What to do about it
  suggestedAction: {
    type: 'notify' | 'task' | 'question';
    content: string;
    options?: string[];
  };

  // Should we bother the user?
  shouldNotify: boolean;
  notificationChannel?: string;
};
```

**Built-in Checks:**

```typescript
const builtInChecks: ProactiveCheck[] = [
  {
    id: 'calendar-lookahead',
    name: 'Calendar Lookahead',
    description: 'Check for upcoming events that need attention',
    schedule: '0 * * * *', // Every hour
    check: async (ctx) => {
      const upcoming = ctx.calendar.nextEvent;
      if (!upcoming) return null;

      const minutes = ctx.calendar.minutesToNext;
      if (minutes && minutes < 30 && upcoming.requiresPrep) {
        return {
          finding: `You have "${upcoming.title}" in ${minutes} minutes`,
          urgency: 'high',
          suggestedAction: {
            type: 'notify',
            content: `Upcoming: ${upcoming.title}\n${upcoming.prepNotes || 'No prep notes.'}`,
          },
          shouldNotify: true,
        };
      }
      return null;
    },
  },

  {
    id: 'stale-followups',
    name: 'Stale Follow-ups',
    description: 'Check for tasks waiting too long',
    schedule: '0 9 * * *', // Daily at 9am
    check: async (ctx) => {
      const stale = ctx.pendingTasks.filter((t) => t.status === 'waiting' && daysSince(t.waitingSince) > 3);
      if (stale.length === 0) return null;

      return {
        finding: `${stale.length} tasks have been waiting for follow-up`,
        urgency: 'medium',
        suggestedAction: {
          type: 'question',
          content: 'Would you like to review stale follow-ups?',
          options: ['Show me', 'Remind me later', 'Dismiss'],
        },
        shouldNotify: true,
      };
    },
  },

  {
    id: 'daily-briefing',
    name: 'Daily Briefing',
    description: 'Morning summary of the day ahead',
    schedule: '0 8 * * 1-5', // 8am weekdays
    check: async (ctx) => {
      const events = await calendarService.getToday();
      const tasks = ctx.pendingTasks.filter((t) => t.status === 'active');

      return {
        finding: 'Daily briefing ready',
        urgency: 'low',
        suggestedAction: {
          type: 'notify',
          content: formatDailyBriefing(events, tasks, ctx.user),
        },
        shouldNotify: true,
        notificationChannel: 'default',
      };
    },
  },
];
```

### 7. Task Queue (Long-Running Tasks)

Manages tasks that span multiple interactions, hours, or days. Essential for real delegation.

```
src/
└── tasks/
    ├── tasks.ts
    ├── tasks.schemas.ts
    ├── tasks.executor.ts
    ├── tasks.store.ts
    └── tasks.test.ts
```

#### User Tasks vs Agent Tasks

The system distinguishes between **User Tasks** (things the user needs to do) and **Agent Tasks** (work the agent performs on behalf of the user).

**User Tasks** - items on the user's to-do list, with flexible scheduling:

```typescript
type TaskTrigger =
  | { type: 'deadline'; dueAt: string } // Due by specific time
  | { type: 'recurring_time'; schedule: CronExpression; lastRun?: string } // Fixed schedule
  | { type: 'recurring_completion'; intervalDays: number; lastCompleted?: string } // After last done
  | { type: 'opportunistic'; priority: number } // When time permits
  | { type: 'deferred'; becomesRelevant: string; condition?: string } // Future task
  | { type: 'conditional'; condition: string; watchExpression: string }; // When X happens

type UserTask = {
  id: string;
  description: string;
  trigger: TaskTrigger;
  status: 'pending' | 'active' | 'waiting' | 'completed' | 'cancelled';

  // Context
  relatedProjects: string[];
  relatedContacts: string[];
  relatedEntities: string[]; // Link to Entity Knowledge

  // Metadata
  notes?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};
```

**Task Types Explained:**

| Task Type                  | Trigger                 | Examples                                                               |
| -------------------------- | ----------------------- | ---------------------------------------------------------------------- |
| **Deadline-based**         | Specific due date/time  | "Submit report by Friday", "Pay invoice before the 15th"               |
| **Recurring (time)**       | Fixed schedule          | "Weekly team update every Monday", "Monthly review on the 1st"         |
| **Recurring (completion)** | After last completion   | "Water plants every 3 days", "Follow up 1 week after sending"          |
| **Opportunistic**          | When time permits       | "Read that article sometime", "Organize photos when free"              |
| **Deferred**               | Becomes relevant later  | "After the move, set up home office", "Once Q4 starts, begin planning" |
| **Conditional**            | When conditions are met | "When budget is approved, book the venue"                              |

#### Agent Tasks (Delegated Work)

**Agent Tasks** - work the agent performs autonomously:

```typescript
type DelegatedTask = {
  id: string;
  description: string;
  createdAt: string;
  updatedAt: string;

  // Link to user task (if applicable)
  userTaskId?: string;

  // Status
  status: TaskStatus;
  statusReason?: string;

  // Multi-step workflow
  steps: TaskStep[];
  currentStepIndex: number;

  // Waiting for something
  waitingFor?: {
    type: 'time' | 'event' | 'user_response' | 'external';
    description: string;
    condition: string;
    deadline?: string;
    checkSchedule?: CronExpression; // When to check if condition met
    onTimeout: 'remind' | 'escalate' | 'cancel' | 'proceed';
  };

  // Context
  conversationId?: string; // Original conversation
  relatedContacts: string[];
  relatedProjects: string[];
  relatedEntities: string[]; // Link to Entity Knowledge
  tags: string[];

  // Audit trail
  history: TaskEvent[];
};

type TaskStatus =
  | 'pending' // Not yet started
  | 'active' // Currently being worked on
  | 'waiting' // Waiting for something (time, event, response)
  | 'blocked' // Cannot proceed, needs intervention
  | 'completed'
  | 'cancelled';

type TaskStep = {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed';
  result?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
};

type TaskEvent = {
  timestamp: string;
  type: 'created' | 'started' | 'step_completed' | 'waiting' | 'resumed' | 'completed' | 'failed' | 'cancelled';
  details: string;
  metadata?: Record<string, unknown>;
};
```

**Operations:**

```typescript
type TaskQueueService = {
  // Create
  createTask: (task: {
    description: string;
    steps: Array<{ description: string }>;
    relatedContacts?: string[];
    relatedProjects?: string[];
  }) => Promise<DelegatedTask>;

  // Query
  getTask: (id: string) => Promise<DelegatedTask | null>;
  getActiveTasks: () => Promise<DelegatedTask[]>;
  getWaitingTasks: () => Promise<DelegatedTask[]>;
  getTasksForProject: (projectId: string) => Promise<DelegatedTask[]>;

  // Progress
  advanceStep: (taskId: string, result?: unknown) => Promise<DelegatedTask>;
  failStep: (taskId: string, error: string) => Promise<DelegatedTask>;
  skipStep: (taskId: string, reason: string) => Promise<DelegatedTask>;

  // Waiting
  setWaiting: (taskId: string, waitingFor: DelegatedTask['waitingFor']) => Promise<DelegatedTask>;
  checkWaitingConditions: () => Promise<DelegatedTask[]>; // Returns tasks ready to resume

  // Completion
  completeTask: (taskId: string, summary: string) => Promise<DelegatedTask>;
  cancelTask: (taskId: string, reason: string) => Promise<DelegatedTask>;

  // Reminders
  getOverdueTasks: () => Promise<DelegatedTask[]>;
  scheduleReminder: (taskId: string, when: Date, message: string) => Promise<void>;
};
```

**Example: Multi-Day Task**

```typescript
// User: "Book me a flight to London for the conference next month"

const task = await taskQueue.createTask({
  description: 'Book flight to London for conference',
  steps: [
    { description: 'Confirm conference dates' },
    { description: 'Search for flights' },
    { description: 'Present options to user' },
    { description: 'Book selected flight' },
    { description: 'Add to calendar' },
    { description: 'Send confirmation' },
  ],
  relatedProjects: ['london-conference'],
});

// Step 1: Agent asks user for dates
// Step 2: Agent searches (may take time, run in background)
// Step 3: Agent presents options, creates interrupt
// User responds hours later...
// Step 4: Agent books (high-risk, requires approval)
// Steps 5-6: Complete automatically
```

### 8. Notification Router

Routes notifications to the user through appropriate channels based on urgency, time, and user preferences.

```
src/
└── notifications/
    ├── notifications.ts
    ├── notifications.schemas.ts
    ├── notifications.channels.ts
    ├── notifications.attention.ts  # Attention budget management
    └── notifications.test.ts
```

#### Attention Budget

Proactivity is powerful, but so is restraint. The agent maintains an **attention budget** - an awareness of how much it should demand the user's focus.

```typescript
type AttentionBudget = {
  // Current state
  recentInterruptions: number; // Count in last hour
  lastInterruptionAt: string | null;
  userResponsiveness: 'high' | 'medium' | 'low'; // Based on recent response times

  // Context factors
  currentActivity: ActivityState;
  quietHoursActive: boolean;
  focusBlockActive: boolean;
  manualDndUntil: string | null;
};

type ActivityState =
  | { type: 'idle' }
  | { type: 'in_conversation' }
  | { type: 'in_meeting'; event: CalendarEvent }
  | { type: 'focus_block'; until: string }
  | { type: 'traveling' };

type InterruptionTier =
  | 'critical' // Interrupt always (security, time-sensitive crisis)
  | 'high' // Interrupt unless explicitly blocked
  | 'medium' // Queue for next natural break, or batch with others
  | 'low' // Include in daily summary, don't interrupt
  | 'background'; // Just do it silently, no notification needed
```

**Factors Affecting Budget:**

| Factor               | Effect                                            |
| -------------------- | ------------------------------------------------- |
| Time of day          | Quiet hours reduce interruptions to critical only |
| Current activity     | In a meeting or focus block = higher threshold    |
| Recent interruptions | Already pinged 3 times today = be more selective  |
| User responsiveness  | Not responding to notifications = back off        |
| Stated preference    | "Leave me alone this afternoon" = respect it      |

**Notification Decision:**

```typescript
type NotificationDecision = {
  shouldNotify: boolean;
  tier: InterruptionTier;
  channel: string | null;
  reason: string;
  batchWith?: string[]; // IDs of notifications to batch together
  delayUntil?: string; // Queue for later delivery
};
```

#### Notification Types

```typescript
type Notification = {
  id: string;
  type: 'info' | 'action_required' | 'reminder' | 'alert';
  title: string;
  body: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';

  // Actions user can take
  actions?: Array<{
    id: string;
    label: string;
    action: 'approve' | 'deny' | 'snooze' | 'dismiss' | 'custom';
    customAction?: string;
  }>;

  // Metadata
  source: string; // What generated this
  relatedTaskId?: string;
  relatedConversationId?: string;

  // Batching support
  batchable: boolean;
  batchKey?: string; // Group similar notifications

  createdAt: string;
  expiresAt?: string;
};

type NotificationChannel = {
  id: string;
  type: 'cli' | 'push' | 'sms' | 'email' | 'slack' | 'webhook';
  name: string;
  enabled: boolean;

  // When to use this channel
  availability: {
    schedule?: CronExpression; // When it's available
    minUrgency: 'low' | 'medium' | 'high' | 'critical';
  };

  // Channel-specific config
  config: Record<string, unknown>;

  // Send function
  send: (notification: Notification) => Promise<NotificationResult>;
};

type NotificationResult = {
  success: boolean;
  channelId: string;
  deliveredAt?: string;
  error?: string;
};
```

**Routing Logic:**

```typescript
const routeNotification = async (
  notification: Notification,
  channels: NotificationChannel[],
  context: AgentContext,
): Promise<NotificationResult> => {
  // Filter to enabled channels that meet urgency threshold
  const eligible = channels.filter(
    (c) => c.enabled && urgencyLevel(notification.urgency) >= urgencyLevel(c.availability.minUrgency),
  );

  // Prioritize based on context
  const sorted = eligible.sort((a, b) => {
    // If user is in CLI session, use CLI
    if (context.conversation && a.type === 'cli') return -1;
    // Outside working hours + high urgency = SMS
    if (!context.isWorkingHours && notification.urgency === 'critical') {
      if (a.type === 'sms') return -1;
    }
    // Default priority by type
    return channelPriority(a.type) - channelPriority(b.type);
  });

  // Try channels in order until one succeeds
  for (const channel of sorted) {
    const result = await channel.send(notification);
    if (result.success) return result;
  }

  // All failed - queue for retry
  return { success: false, channelId: 'none', error: 'All channels failed' };
};
```

### 8. Personality Configuration

Defines how the agent communicates. Makes GLaDOS feel like _your_ assistant, not a generic bot.

```
src/
└── personality/
    ├── personality.ts
    ├── personality.schemas.ts
    └── personality.prompts.ts
```

```typescript
type PersonalityConfig = {
  // Basic identity
  name: string; // "GLaDOS", "Jarvis", "Friday", etc.
  role: string; // "personal assistant", "executive assistant"

  // Communication style
  style: {
    formality: 'casual' | 'professional' | 'formal';
    verbosity: 'terse' | 'balanced' | 'detailed';
    humor: 'none' | 'subtle' | 'witty';
    emoji: 'never' | 'minimal' | 'moderate';
  };

  // Behavioral traits
  traits: {
    proactivity: 'reactive' | 'suggestive' | 'proactive';
    confidence: 'humble' | 'balanced' | 'confident';
    directness: 'diplomatic' | 'balanced' | 'direct';
  };

  // Custom instructions
  coreInstructions: string; // Always included in system prompt
  topicGuidelines: Record<string, string>; // Per-topic instructions

  // Example interactions for few-shot
  examples: Array<{
    scenario: string;
    userMessage: string;
    assistantResponse: string;
  }>;
};
```

**System Prompt Generation:**

```typescript
const buildSystemPrompt = (personality: PersonalityConfig, context: AgentContext): string => {
  return `You are ${personality.name}, a ${personality.role} for ${context.user.name}.

## Communication Style
- Formality: ${personality.style.formality}
- Be ${personality.style.verbosity} in your responses
- Humor: ${personality.style.humor}
${personality.style.emoji === 'never' ? '- Never use emoji' : ''}

## Behavioral Guidelines
${
  personality.traits.proactivity === 'proactive'
    ? '- Proactively suggest relevant actions and information'
    : '- Wait for explicit requests before suggesting actions'
}
${
  personality.traits.directness === 'direct'
    ? '- Be direct and get to the point quickly'
    : '- Be diplomatic and consider feelings'
}

## Current Context
- Time: ${context.now} (${context.timeOfDay})
- ${context.calendar.currentEvent ? `Currently in: ${context.calendar.currentEvent.title}` : 'No current meeting'}
- ${
    context.calendar.nextEvent
      ? `Next: ${context.calendar.nextEvent.title} in ${context.calendar.minutesToNext} minutes`
      : 'Nothing scheduled next'
  }

## Active Projects
${context.user.activeProjects.map((p) => `- ${p.name}: ${p.description}`).join('\n')}

## Custom Instructions
${personality.coreInstructions}
`;
};
```

---

## Core Components

### 9. Orchestrator

The main agent loop built with LangGraph. Manages conversation state, decides when to use tools, and integrates with the foundation layer.

```
src/
└── orchestrator/
    ├── orchestrator.ts           # Main agent graph
    ├── orchestrator.nodes.ts     # Graph node definitions
    ├── orchestrator.state.ts     # State schema
    └── orchestrator.test.ts
```

**State Shape:**

```typescript
type OrchestratorState = {
  messages: Message[];
  activeToolSets: ToolSetId[];
  currentTask: Task | null;
  memoryContext: MemoryContext;
};
```

**Graph Nodes:**

1. **router** - Determines next action (respond, use tool, delegate, ask user)
2. **tool-executor** - Runs selected tools
3. **memory-retriever** - Fetches relevant context from long-term memory
4. **response-generator** - Produces final response to user

### 10. Tool System

Tools use an intermediate format that can be exposed via multiple interfaces (LangChain, MCP, REST API).

```
src/
└── tools/
    ├── tools.ts                  # Tool registry and execution
    ├── tools.schemas.ts          # Input/output contract definitions
    ├── tools.types.ts            # Core type definitions
    └── tools.test.ts
```

#### Tool Definition Format

```typescript
const toolDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),

  // Contract definitions - used for all exposure methods
  inputSchema: z.instanceof(z.ZodSchema),
  outputSchema: z.instanceof(z.ZodSchema),

  // Execution
  execute: z.function(),

  // Metadata for discovery
  tags: z.array(z.string()),
  examples: z.array(
    z.object({
      input: z.unknown(),
      description: z.string(),
    }),
  ),
});

type ToolDefinition<TInput, TOutput> = {
  id: string;
  name: string;
  description: string;
  category: string;

  inputSchema: z.ZodSchema<TInput>;
  outputSchema: z.ZodSchema<TOutput>;

  execute: (input: TInput, context: ToolContext) => Promise<TOutput>;

  tags: string[];
  examples: Array<{
    input: TInput;
    description: string;
  }>;
};
```

#### Tool Context

Tools receive context that includes:

```typescript
type ToolContext = {
  userId: string;
  conversationId: string;
  memory: MemoryAccessor;
  logger: Logger;
  abortSignal: AbortSignal;
};
```

#### Exposure Adapters

```
src/
└── tools/
    └── adapters/
        ├── adapters.langchain.ts    # Convert to LangChain tools
        ├── adapters.mcp.ts          # Expose as MCP server
        └── adapters.rest.ts         # Expose as REST endpoints
```

Each adapter transforms the neutral tool definition:

```typescript
// LangChain adapter
const toLangChainTool = <TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): DynamicStructuredTool => {
  return new DynamicStructuredTool({
    name: tool.id,
    description: tool.description,
    schema: tool.inputSchema,
    func: async (input, runManager) => {
      const result = await tool.execute(input, buildContext(runManager));
      return JSON.stringify(result);
    },
  });
};
```

### 11. Tool Sets and Discovery

To prevent context overload, tools are organized into **Tool Sets** - logical groupings that can be activated/deactivated.

```
src/
└── tool-sets/
    ├── tool-sets.ts              # Tool set registry
    ├── tool-sets.schemas.ts
    └── sets/
        ├── email/
        │   ├── email.ts
        │   └── email.tools.ts
        ├── calendar/
        │   ├── calendar.ts
        │   └── calendar.tools.ts
        └── filesystem/
            ├── filesystem.ts
            └── filesystem.tools.ts
```

#### Tool Set Definition

```typescript
type ToolSet = {
  id: string;
  name: string;
  description: string;
  tools: ToolDefinition<unknown, unknown>[];

  // When should this set be considered?
  triggerPatterns: string[]; // Regex patterns for activation hints
  relatedSets: string[]; // Other sets often used together
};
```

#### Discovery Agent

A specialized mechanism that helps the orchestrator find and activate appropriate tool sets.

```typescript
type DiscoveryRequest = {
  userIntent: string;
  currentContext: string;
  activeToolSets: string[];
};

type DiscoveryResponse = {
  recommendedToolSets: Array<{
    id: string;
    relevanceScore: number;
    reasoning: string;
  }>;
  shouldDeactivate: string[];
};
```

The orchestrator can:

1. Start with a minimal tool set
2. Ask the discovery agent when it needs capabilities it doesn't have
3. Dynamically load/unload tool sets based on conversation flow

#### Task Kickstart

For known task types, bypass discovery and start with optimal tool sets:

```typescript
type TaskTemplate = {
  id: string;
  name: string;
  description: string;
  toolSets: string[];
  initialPrompt?: string;
  initialState?: Partial<OrchestratorState>;
};

// Example templates
const taskTemplates: TaskTemplate[] = [
  {
    id: 'email-triage',
    name: 'Email Triage',
    description: 'Process and respond to emails',
    toolSets: ['email', 'contacts', 'calendar'],
  },
  {
    id: 'code-review',
    name: 'Code Review',
    description: 'Review code changes and provide feedback',
    toolSets: ['git', 'filesystem', 'code-analysis'],
  },
];
```

### 12. Model Selection

Different tasks need different models. The orchestrator intelligently selects models based on task requirements to balance cost and capability.

```typescript
type ModelTier = 'fast' | 'balanced' | 'capable' | 'premium';

type ModelSelectionConfig = {
  tiers: Record<
    ModelTier,
    {
      model: string;
      maxTokens: number;
      costPerMillion: number;
    }
  >;

  // Task-to-tier mappings
  taskMappings: Record<string, ModelTier>;

  // Default behaviors
  defaultTier: ModelTier;
  cascadeOnLowConfidence: boolean; // Try fast first, escalate if needed
  budgetAware: boolean; // Consider cost limits
};
```

**Task-Model Matching:**

| Task Type             | Model Tier | Rationale                                      |
| --------------------- | ---------- | ---------------------------------------------- |
| Simple retrieval      | fast       | "What's on my calendar?" - no reasoning needed |
| Summarization         | balanced   | Condense information, modest reasoning         |
| Analysis & planning   | capable    | Complex reasoning, nuanced understanding       |
| Creative/strategic    | premium    | Novel solutions, sophisticated judgment        |
| Bulk processing       | fast       | Triage 100 emails - speed matters              |
| High-stakes decisions | premium    | Errors are costly, quality matters             |

**Cascading Strategy:**

For uncertain complexity, the agent can cascade:

1. Try fast model first - if it produces confident result, done
2. Escalate if needed - ambiguous or complex? Route to capable model
3. Learn from patterns - "This type of query usually needs the capable model"

### 13. Memory System

Long-term memory enables learning from past interactions.

```
src/
└── memory/
    ├── memory.ts                 # Memory service interface
    ├── memory.schemas.ts
    ├── memory.store.ts           # SQLite storage implementation
    └── memory.retrieval.ts       # Semantic search and retrieval
```

#### Memory Types

```typescript
type MemoryEntry = {
  id: string;
  type: MemoryType;
  content: string;
  embedding: number[]; // For semantic search
  metadata: Record<string, unknown>;
  createdAt: string;
  lastAccessedAt: string;
  accessCount: number;
  importance: number; // 0-1, affects retention
};

type MemoryType =
  | 'conversation' // Past conversation summaries
  | 'fact' // Learned facts about user/world
  | 'preference' // User preferences
  | 'procedure' // How to do things
  | 'feedback' // User corrections and guidance
  | 'event' // External events that occurred
  | 'entity'; // Knowledge about things in user's world (links to EntityKnowledge)
```

#### Memory Operations

```typescript
type MemoryService = {
  // Store
  remember: (entry: Omit<MemoryEntry, 'id' | 'embedding'>) => Promise<string>;

  // Retrieve
  recall: (query: string, options?: RecallOptions) => Promise<MemoryEntry[]>;
  recallByType: (type: MemoryType, limit?: number) => Promise<MemoryEntry[]>;

  // Update
  reinforce: (id: string) => Promise<void>; // Increase importance
  correct: (id: string, correction: string) => Promise<void>;
  forget: (id: string) => Promise<void>;

  // Maintenance
  consolidate: () => Promise<void>; // Merge similar memories
  prune: () => Promise<void>; // Remove low-importance old entries
};

type RecallOptions = {
  limit?: number;
  types?: MemoryType[];
  minImportance?: number;
  timeRange?: { start: Date; end: Date };
};
```

#### Learning from Feedback

When the user corrects the agent or provides guidance:

```typescript
type FeedbackEntry = {
  originalResponse: string;
  correction: string;
  context: string;
  learnedRule: string; // Extracted principle
};

// Example flow:
// User: "No, I prefer you schedule meetings in the afternoon"
// Agent stores:
// {
//   type: 'preference',
//   content: 'User prefers meetings scheduled in afternoon, not morning',
//   metadata: { domain: 'calendar', confidence: 0.9 }
// }
```

### 13. Event Ingress

Handles external events that trigger agent actions.

```
src/
└── ingress/
    ├── ingress.ts                # Event router
    ├── ingress.schemas.ts
    └── sources/
        ├── email/
        │   └── email.ts          # IMAP/webhook listener
        ├── webhook/
        │   └── webhook.ts        # Generic webhook receiver
        └── scheduler/
            └── scheduler.ts      # Cron-based triggers
```

#### Event Processing

```typescript
type IngressEvent = {
  id: string;
  source: string;
  type: string;
  payload: unknown;
  receivedAt: string;
};

type EventHandler = {
  source: string;
  eventTypes: string[];

  // Determine if agent should act
  shouldProcess: (
    event: IngressEvent,
    memory: MemoryService,
  ) => Promise<{
    shouldAct: boolean;
    reasoning: string;
    urgency: 'immediate' | 'soon' | 'when-convenient';
  }>;

  // Transform to agent task
  toTask: (event: IngressEvent) => TaskTemplate;
};
```

#### Email Example Flow

```
1. New email arrives
2. Email ingress creates IngressEvent
3. Handler checks memory for:
   - Is sender known/important?
   - Are there relevant past interactions?
   - User preferences for this type of email?
4. Handler decides:
   - Auto-respond (if confident)
   - Draft response for review
   - Notify user and ask for guidance
   - Ignore (spam, newsletters, etc.)
5. Action taken, result stored in memory for future learning
```

---

## Database Schema

Using Knex with SQLite. Migrations in `src/database/migrations/`.

```
src/
└── database/
    ├── database.ts               # Knex instance and helpers
    ├── database.schemas.ts
    └── migrations/
        ├── 001_initial.ts
        └── ...
```

### Foundation Tables

```sql
-- User identity and preferences (single row)
CREATE TABLE user_identity (
  id TEXT PRIMARY KEY DEFAULT 'user',
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  locale TEXT NOT NULL DEFAULT 'en-US',
  working_hours_start TEXT DEFAULT '09:00',
  working_hours_end TEXT DEFAULT '17:00',
  working_days TEXT DEFAULT '[1,2,3,4,5]',  -- JSON array, Mon-Fri
  preferences TEXT,                          -- JSON (communication style, etc.)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Projects
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',    -- 'active' | 'paused' | 'completed'
  priority TEXT NOT NULL DEFAULT 'medium',  -- 'low' | 'medium' | 'high'
  tags TEXT,                                -- JSON array
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_projects_status ON projects(status);

-- Goals
CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  timeframe TEXT NOT NULL,                  -- 'short' | 'medium' | 'long'
  progress TEXT,
  related_projects TEXT,                    -- JSON array of project IDs
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Routines
CREATE TABLE routines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  schedule TEXT NOT NULL,                   -- Cron expression
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_routines_enabled ON routines(enabled);

-- Contacts
CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  organization TEXT,
  role TEXT,
  relationship_type TEXT,                   -- 'family' | 'colleague' | etc.
  relationship_context TEXT,
  relationship_importance TEXT DEFAULT 'medium',
  notes TEXT,
  communication_style TEXT,
  last_interaction_at TEXT,
  tags TEXT,                                -- JSON array
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_contacts_email ON contacts(email);
CREATE INDEX idx_contacts_importance ON contacts(relationship_importance);

-- Contact groups
CREATE TABLE contact_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE contact_group_members (
  group_id TEXT NOT NULL REFERENCES contact_groups(id),
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  PRIMARY KEY (group_id, contact_id)
);

-- Project-contact relationships
CREATE TABLE project_contacts (
  project_id TEXT NOT NULL REFERENCES projects(id),
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  role TEXT,                                -- Their role in this project
  PRIMARY KEY (project_id, contact_id)
);

-- Locations
CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,               -- 'home' | 'work' | 'client' | etc.
  latitude REAL,
  longitude REAL,
  address TEXT,                     -- JSON (street, city, etc.)
  timezone TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  tags TEXT,                        -- JSON array
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_locations_type ON locations(type);

-- Current location tracking
CREATE TABLE location_history (
  id TEXT PRIMARY KEY,
  location_id TEXT REFERENCES locations(id),
  confidence TEXT NOT NULL,         -- 'exact' | 'approximate' | 'inferred'
  source TEXT NOT NULL,             -- 'manual' | 'calendar' | 'device' | 'schedule'
  recorded_at TEXT NOT NULL
);

CREATE INDEX idx_location_history_time ON location_history(recorded_at);

-- Geofences (location-triggered actions)
CREATE TABLE geofences (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES locations(id),
  trigger_type TEXT NOT NULL,       -- 'enter' | 'exit'
  action TEXT NOT NULL,             -- What to do
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Entity Knowledge (things in user's world)
CREATE TABLE entity_knowledge (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,               -- 'company' | 'project' | 'document' | 'product' | 'concept' | 'place' | 'other'
  description TEXT,
  attributes TEXT,                  -- JSON (flexible key-value pairs)
  source TEXT NOT NULL DEFAULT 'explicit',  -- 'explicit' | 'inferred'
  confidence REAL NOT NULL DEFAULT 1.0,
  last_referenced_at TEXT NOT NULL,
  reference_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_entity_knowledge_type ON entity_knowledge(type);
CREATE INDEX idx_entity_knowledge_name ON entity_knowledge(name);

-- Entity relationships
CREATE TABLE entity_relations (
  id TEXT PRIMARY KEY,
  source_entity_id TEXT NOT NULL REFERENCES entity_knowledge(id),
  target_entity_id TEXT NOT NULL,
  target_type TEXT NOT NULL,        -- 'entity' | 'contact' | 'project'
  relationship_type TEXT NOT NULL,   -- 'has_contact', 'belongs_to', 'uses_template', etc.
  metadata TEXT,                     -- JSON
  created_at TEXT NOT NULL
);

CREATE INDEX idx_entity_relations_source ON entity_relations(source_entity_id);
CREATE INDEX idx_entity_relations_target ON entity_relations(target_entity_id);

-- Calendar events
CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  external_id TEXT,
  source TEXT NOT NULL DEFAULT 'local',     -- 'local' | 'google' | 'outlook'
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL,
  attendees TEXT,                           -- JSON array
  recurrence_rule TEXT,
  recurrence_exceptions TEXT,               -- JSON array
  requires_prep INTEGER NOT NULL DEFAULT 0,
  prep_notes TEXT,
  travel_time_minutes INTEGER,
  tags TEXT,                                -- JSON array
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_calendar_events_start ON calendar_events(start_time);
CREATE INDEX idx_calendar_events_source ON calendar_events(source);

-- Delegated tasks (long-running)
CREATE TABLE delegated_tasks (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'active' | 'waiting' | etc.
  status_reason TEXT,
  steps TEXT NOT NULL,                      -- JSON array of steps
  current_step_index INTEGER NOT NULL DEFAULT 0,
  waiting_for TEXT,                         -- JSON (type, condition, deadline, etc.)
  conversation_id TEXT REFERENCES conversations(id),
  related_contacts TEXT,                    -- JSON array of contact IDs
  related_projects TEXT,                    -- JSON array of project IDs
  tags TEXT,                                -- JSON array
  history TEXT NOT NULL DEFAULT '[]',       -- JSON array of events
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_delegated_tasks_status ON delegated_tasks(status);

-- Notifications
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                       -- 'info' | 'action_required' | etc.
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  urgency TEXT NOT NULL,
  actions TEXT,                             -- JSON array
  source TEXT NOT NULL,
  related_task_id TEXT REFERENCES delegated_tasks(id),
  related_conversation_id TEXT REFERENCES conversations(id),
  delivered_at TEXT,
  delivered_via TEXT,
  response TEXT,                            -- JSON
  created_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE INDEX idx_notifications_delivered ON notifications(delivered_at);

-- Notification channels config
CREATE TABLE notification_channels (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  min_urgency TEXT NOT NULL DEFAULT 'low',
  schedule TEXT,                            -- Cron for availability
  config TEXT NOT NULL,                     -- JSON (channel-specific)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Personality config (single row)
CREATE TABLE personality (
  id TEXT PRIMARY KEY DEFAULT 'default',
  name TEXT NOT NULL DEFAULT 'GLaDOS',
  role TEXT NOT NULL DEFAULT 'personal assistant',
  style TEXT NOT NULL,                      -- JSON (formality, verbosity, etc.)
  traits TEXT NOT NULL,                     -- JSON (proactivity, confidence, etc.)
  core_instructions TEXT,
  topic_guidelines TEXT,                    -- JSON
  examples TEXT,                            -- JSON array
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### Core Tables

```sql
-- Memory entries
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding BLOB,                 -- Serialized float array
  metadata TEXT,                  -- JSON
  importance REAL DEFAULT 0.5,
  created_at TEXT NOT NULL,
  last_accessed_at TEXT NOT NULL,
  access_count INTEGER DEFAULT 0
);

CREATE INDEX idx_memories_type ON memories(type);
CREATE INDEX idx_memories_importance ON memories(importance);

-- Conversations
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  summary TEXT,
  metadata TEXT                   -- JSON
);

-- Messages within conversations
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,             -- 'user' | 'assistant' | 'system' | 'tool'
  content TEXT NOT NULL,
  tool_calls TEXT,                -- JSON array of tool calls
  created_at TEXT NOT NULL
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id);

-- Ingress events
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,          -- JSON
  status TEXT NOT NULL,           -- 'pending' | 'processing' | 'completed' | 'failed'
  result TEXT,                    -- JSON
  received_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE INDEX idx_events_status ON events(status);
CREATE INDEX idx_events_source ON events(source);

-- Tool usage tracking (for learning which tools work well together)
CREATE TABLE tool_usage (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  tool_id TEXT NOT NULL,
  tool_set_id TEXT NOT NULL,
  input TEXT NOT NULL,            -- JSON
  output TEXT,                    -- JSON
  success INTEGER NOT NULL,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_tool_usage_tool ON tool_usage(tool_id);

-- Interrupts (human-in-the-loop)
CREATE TABLE interrupts (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  type TEXT NOT NULL,           -- 'question' | 'confirmation' | 'tool_approval' | 'error_recovery'
  prompt TEXT NOT NULL,
  context TEXT,
  options TEXT,                 -- JSON array of options
  allow_freeform INTEGER NOT NULL DEFAULT 1,
  tool_call TEXT,               -- JSON (for tool_approval type)
  resume_state TEXT NOT NULL,   -- JSON serialized graph state
  created_at TEXT NOT NULL,
  expires_at TEXT,
  responded_at TEXT,
  response TEXT                 -- JSON
);

CREATE INDEX idx_interrupts_conversation ON interrupts(conversation_id);
CREATE INDEX idx_interrupts_pending ON interrupts(responded_at) WHERE responded_at IS NULL;

-- User tasks (distinct from agent delegated_tasks)
CREATE TABLE user_tasks (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  trigger_type TEXT NOT NULL,       -- 'deadline' | 'recurring_time' | 'recurring_completion' | etc.
  trigger_config TEXT NOT NULL,     -- JSON (type-specific configuration)
  status TEXT NOT NULL DEFAULT 'pending',
  related_projects TEXT,            -- JSON array
  related_contacts TEXT,            -- JSON array
  related_entities TEXT,            -- JSON array
  notes TEXT,
  tags TEXT,                        -- JSON array
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_user_tasks_status ON user_tasks(status);
CREATE INDEX idx_user_tasks_trigger ON user_tasks(trigger_type);
```

---

## Interaction Modes

### Interactive Mode

Direct conversation with the user via CLI or future UI.

```typescript
type InteractiveSession = {
  start: () => Promise<void>;
  send: (message: string) => Promise<string>;
  end: () => Promise<void>;
};
```

### Reactive Mode

Background process monitoring events.

```typescript
type ReactiveRunner = {
  start: () => Promise<void>;
  stop: () => Promise<void>;

  // Manual event injection for testing
  injectEvent: (event: IngressEvent) => Promise<void>;
};
```

### Hybrid Mode

Both active simultaneously - user can interact while events are processed.

---

## Configuration

```typescript
const configSchema = z.object({
  // LLM configuration
  llm: z.object({
    provider: z.enum(['anthropic', 'openai']),
    model: z.string(),
    apiKey: z.string(),
    embeddingModel: z.string().optional(), // For memory embeddings
  }),

  // Database
  database: z.object({
    path: z.string().default('./data/glados.db'),
  }),

  // Memory settings
  memory: z.object({
    maxEntries: z.number().default(10000),
    consolidation: z.object({
      enabled: z.boolean().default(true),
      tierSchedules: z.object({
        deduplication: z.string().default('0 3 * * *'), // 3am daily
        decay: z.string().default('0 4 * * 0'), // 4am Sunday
        patternExtraction: z.string().default('0 5 1 * *'), // 5am 1st of month
      }),
    }),
  }),

  // Calendar integration
  calendar: z.object({
    sync: z.object({
      enabled: z.boolean().default(false),
      providers: z
        .array(
          z.object({
            type: z.enum(['google', 'outlook', 'ical']),
            credentials: z.record(z.string()),
            syncInterval: z.number().default(300000), // 5 minutes
          }),
        )
        .default([]),
    }),
    lookaheadHours: z.number().default(24),
    defaultTravelTime: z.number().default(15), // minutes
  }),

  // Location awareness
  location: z.object({
    enabled: z.boolean().default(true),
    defaultMode: z.enum(['driving', 'transit', 'walking', 'cycling']).default('driving'),
    travelTimeApi: z.object({
      provider: z.enum(['google', 'mapbox', 'none']).default('none'),
      apiKey: z.string().optional(),
    }),
    inferFromCalendar: z.boolean().default(true),
    inferFromSchedule: z.boolean().default(true),
    geofencingEnabled: z.boolean().default(false), // Requires device integration
  }),

  // Proactive scheduler
  proactive: z.object({
    enabled: z.boolean().default(true),
    checks: z.object({
      calendarLookahead: z.boolean().default(true),
      staleFollowups: z.boolean().default(true),
      dailyBriefing: z.boolean().default(true),
    }),
    customChecks: z.array(z.string()).default([]), // IDs of custom checks
  }),

  // Notifications
  notifications: z.object({
    defaultChannel: z.string().default('cli'),
    quietHours: z.object({
      enabled: z.boolean().default(true),
      start: z.string().default('22:00'),
      end: z.string().default('08:00'),
      allowCritical: z.boolean().default(true),
    }),
  }),

  // Event ingress
  ingress: z.object({
    email: z
      .object({
        enabled: z.boolean(),
        imap: z
          .object({
            host: z.string(),
            port: z.number(),
            user: z.string(),
            password: z.string(),
            tls: z.boolean().default(true),
          })
          .optional(),
        pollInterval: z.number().default(60000), // 1 minute
      })
      .optional(),

    webhook: z
      .object({
        enabled: z.boolean(),
        port: z.number().default(3000),
        secret: z.string().optional(),
      })
      .optional(),
  }),

  // Tool sets
  toolSets: z.object({
    enabled: z.array(z.string()),
    disabled: z.array(z.string()),
    autoDiscovery: z.boolean().default(true),
  }),

  // Human in the loop
  humanInTheLoop: z.object({
    defaultTimeout: z.number().default(3600000), // 1 hour
    timeoutBehavior: z.enum(['expire', 'escalate']).default('expire'),
    escalationChannel: z.string().optional(),
    requireApprovalFor: z.array(z.enum(['high', 'critical'])).default(['high', 'critical']),
  }),

  // Cost management
  costs: z.object({
    trackUsage: z.boolean().default(true),
    monthlyBudget: z.number().optional(), // USD
    alertThreshold: z.number().default(0.8), // Alert at 80% of budget
  }),
});

type Config = z.infer<typeof configSchema>;
```

---

## Decisions

### Long-Term Memory Storage

**Decision**: SQLite with sqlite-vss extension

- Single database for all data (relational + vector)
- Portable, no external services
- Abstraction layer allows future migration if needed

### Memory Consolidation Strategy

Memory consolidation runs periodically (default: daily) and on-demand. Uses a tiered approach:

#### Tier 1: Conversation Summarization (after each conversation)

```typescript
type ConversationSummary = {
  keyTopics: string[];
  decisionsReached: string[];
  actionsTaken: string[];
  openItems: string[];
  extractedFacts: string[];
  extractedPreferences: string[];
};
```

After a conversation ends:

1. Generate summary using LLM
2. Extract facts and preferences as separate memory entries
3. Store summary, link to original messages
4. Original messages retained for 30 days, then pruned

#### Tier 2: Fact Deduplication (daily)

1. Group memories by type and semantic similarity (cosine > 0.85)
2. For each cluster:
   - If memories are complementary, merge into richer entry
   - If memories conflict, keep most recent, flag for review
   - Update importance = max(cluster importance)

```typescript
type MergeResult = {
  kept: string; // ID of surviving memory
  merged: string[]; // IDs that were merged in
  conflict?: {
    entries: string[];
    requiresReview: boolean;
  };
};
```

#### Tier 3: Importance Decay (weekly)

```typescript
const decayImportance = (memory: MemoryEntry): number => {
  const daysSinceAccess = daysBetween(memory.lastAccessedAt, now());
  const decayRate = 0.95; // 5% decay per week
  const minImportance = 0.1; // Floor to prevent complete loss

  const decayed = memory.importance * Math.pow(decayRate, daysSinceAccess / 7);
  return Math.max(decayed, minImportance);
};
```

Memories below threshold (0.2) for 90+ days are candidates for pruning.

#### Tier 4: Pattern Extraction (monthly)

LLM-based reflection to extract higher-level patterns:

```typescript
type PatternExtraction = {
  prompt: `Analyze these memories and extract higher-level patterns,
           recurring themes, and general principles about the user.`;
  input: MemoryEntry[]; // Recent high-importance memories
  output: {
    patterns: string[];
    principles: string[];
    suggestions: string[]; // Proactive improvements
  };
};
```

Extracted patterns become high-importance `procedure` or `preference` memories.

---

## Human in the Loop

The agent must be able to pause execution, request human input, and resume. This is critical for:

- Clarifying ambiguous requests
- Confirming risky actions
- Learning from corrections
- Building trust through transparency

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Orchestrator Graph                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │  Router  │───▶│ Tool     │───▶│ Risk     │───▶│ Execute  │  │
│  │          │    │ Selector │    │ Gate     │    │ or Halt  │  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘  │
│       │                               │                │        │
│       │                               ▼                ▼        │
│       │                         ┌──────────┐    ┌──────────┐   │
│       │                         │ Approval │    │ Question │   │
│       │                         │ Request  │    │ Request  │   │
│       └─────────────────────────┴──────────┴────┴──────────┘   │
│                                        │                        │
│                                        ▼                        │
│                               ┌────────────────┐                │
│                               │  Interrupt     │                │
│                               │  Handler       │                │
│                               └────────────────┘                │
│                                        │                        │
└────────────────────────────────────────┼────────────────────────┘
                                         │
                                         ▼
                               ┌────────────────┐
                               │  User/Client   │
                               └────────────────┘
```

### Interrupt Types

```typescript
type InterruptType =
  | 'question' // Agent needs information
  | 'confirmation' // Agent wants to verify before acting
  | 'tool_approval' // High-risk tool requires explicit approval
  | 'error_recovery'; // Something failed, need guidance

type Interrupt = {
  id: string;
  type: InterruptType;
  conversationId: string;
  createdAt: string;
  expiresAt: string | null; // For time-sensitive actions

  // What the agent is asking
  prompt: string;
  context: string; // Relevant background

  // Structured options (optional)
  options?: InterruptOption[];
  allowFreeform: boolean; // Can user type custom response?

  // For tool_approval
  toolCall?: {
    toolId: string;
    toolName: string;
    input: unknown;
    riskLevel: RiskLevel;
    riskReason: string;
  };

  // State to resume
  resumeState: OrchestratorState;
};

type InterruptOption = {
  id: string;
  label: string;
  description?: string;
  isRecommended?: boolean;
};

type InterruptResponse = {
  interruptId: string;
  selectedOptionId?: string;
  freeformResponse?: string;
  approved?: boolean; // For tool_approval
  respondedAt: string;
};
```

### Tool Risk Profiles

Every tool declares its risk level. The graph (not the agent) enforces approval for high-risk tools.

```typescript
type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

type RiskProfile = {
  level: RiskLevel;

  // Why this risk level?
  reason: string;

  // What could go wrong?
  potentialImpact: string;

  // Is the action reversible?
  reversible: boolean;

  // Categories of risk
  categories: RiskCategory[];
};

type RiskCategory =
  | 'data_loss' // Could delete or overwrite data
  | 'data_exposure' // Could leak sensitive information
  | 'financial' // Could spend money or affect finances
  | 'communication' // Could send messages to others
  | 'system' // Could affect system state
  | 'external'; // Calls external services
```

#### Updated Tool Definition

```typescript
type ToolDefinition<TInput, TOutput> = {
  id: string;
  name: string;
  description: string;
  category: string;

  inputSchema: z.ZodSchema<TInput>;
  outputSchema: z.ZodSchema<TOutput>;

  // NEW: Risk profile
  risk: RiskProfile;

  execute: (input: TInput, context: ToolContext) => Promise<TOutput>;

  tags: string[];
  examples: Array<{
    input: TInput;
    description: string;
  }>;
};
```

#### Risk Level Behaviors

| Level      | Behavior                            | Examples                                |
| ---------- | ----------------------------------- | --------------------------------------- |
| `low`      | Execute immediately                 | Read file, search, calculate            |
| `medium`   | Execute, log for review             | Create file, API read calls             |
| `high`     | **Require approval**                | Send email, delete file, API write      |
| `critical` | **Require approval + confirmation** | Financial transactions, bulk operations |

#### Risk Gate Node

The risk gate is a **graph node**, not agent logic. The agent cannot bypass it.

```typescript
const riskGateNode = async (state: OrchestratorState): Promise<OrchestratorState | Interrupt> => {
  const pendingToolCall = state.pendingToolCall;
  if (!pendingToolCall) return state;

  const tool = toolRegistry.get(pendingToolCall.toolId);
  const riskLevel = tool.risk.level;

  // Low/medium: proceed
  if (riskLevel === 'low' || riskLevel === 'medium') {
    return { ...state, approvedToolCall: pendingToolCall };
  }

  // High/critical: create interrupt
  return createInterrupt({
    type: 'tool_approval',
    prompt: `I'd like to use "${tool.name}" which ${tool.risk.reason}`,
    context: formatToolCallContext(pendingToolCall),
    toolCall: {
      toolId: tool.id,
      toolName: tool.name,
      input: pendingToolCall.input,
      riskLevel,
      riskReason: tool.risk.reason,
    },
    resumeState: state,
  });
};
```

### Agent-Initiated Questions

The agent can request an interrupt when it needs clarification:

```typescript
// Special "tool" available to the agent
const askUserTool: ToolDefinition<AskUserInput, void> = {
  id: 'ask_user',
  name: 'Ask User',
  description: 'Pause and ask the user a question when you need clarification or confirmation',

  inputSchema: z.object({
    question: z.string(),
    context: z.string().optional(),
    options: z
      .array(
        z.object({
          label: z.string(),
          description: z.string().optional(),
        }),
      )
      .optional(),
    allowFreeform: z.boolean().default(true),
  }),

  outputSchema: z.void(),

  risk: {
    level: 'low',
    reason: 'Only pauses execution to ask user',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },

  execute: async (input, context) => {
    // This doesn't actually execute - the graph intercepts it
    // and creates an interrupt instead
    throw new InterruptSignal(input);
  },
};
```

### Updated Orchestrator State

```typescript
type OrchestratorState = {
  messages: Message[];
  activeToolSets: ToolSetId[];
  currentTask: Task | null;
  memoryContext: MemoryContext;

  // NEW: Interrupt handling
  pendingToolCall: ToolCall | null;
  approvedToolCall: ToolCall | null;

  // NEW: Interrupt state
  interrupt: Interrupt | null;
  interruptResponse: InterruptResponse | null;
};
```

### Interrupt Flow

```
1. Agent decides to use high-risk tool
2. Graph routes to risk-gate node
3. Risk-gate creates Interrupt, returns it instead of state
4. Orchestrator detects interrupt, persists state, notifies user
5. User responds (approve/deny/modify)
6. Orchestrator loads state, applies response
7. Graph resumes from risk-gate with approval decision
8. If approved: tool executes
   If denied: agent receives denial, can try alternative
```

### Persistence for Interrupts

Interrupts must survive process restarts:

```sql
CREATE TABLE interrupts (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  type TEXT NOT NULL,
  prompt TEXT NOT NULL,
  context TEXT,
  options TEXT,              -- JSON
  allow_freeform INTEGER NOT NULL,
  tool_call TEXT,            -- JSON
  resume_state TEXT NOT NULL, -- JSON (serialized graph state)
  created_at TEXT NOT NULL,
  expires_at TEXT,
  responded_at TEXT,
  response TEXT              -- JSON
);

CREATE INDEX idx_interrupts_conversation ON interrupts(conversation_id);
CREATE INDEX idx_interrupts_pending ON interrupts(responded_at) WHERE responded_at IS NULL;
```

### Timeout Behavior

For reactive events with time-sensitive interrupts:

```typescript
type TimeoutBehavior =
  | { action: 'expire' } // Let it expire, do nothing
  | { action: 'default'; optionId: string } // Pick default option
  | { action: 'escalate'; method: string }; // Notify via different channel

type InterruptConfig = {
  defaultTimeout: number; // ms, null = no timeout
  timeoutBehavior: TimeoutBehavior;
  escalationMethods: string[]; // e.g., ['sms', 'push']
};
```

### Example: High-Risk Tool Flow

```
User: "Delete all emails from newsletters@spam.com"

Agent: [Selects email.deleteMany tool]
Agent: [Proposes: { sender: "newsletters@spam.com", permanent: true }]

Graph (risk-gate): [Tool is high risk - data_loss, irreversible]
Graph: [Creates interrupt]

Interrupt to User:
  "I'd like to permanently delete emails from newsletters@spam.com.
   This will delete 47 emails and cannot be undone.

   [Approve] [Deny] [Move to trash instead]"

User: [Selects "Move to trash instead"]

Graph: [Resumes with modified action]
Agent: [Uses email.moveToTrash instead]
Agent: "Done! Moved 47 emails to trash."
```

---

## Implementation Status

**Status: Initial Implementation Complete (Phases 1-7)**

This specification has been fully implemented. The system includes 580+ passing tests across all modules.

### Phase 1: Foundation Layer - Complete

- [x] Database setup with Knex + SQLite
- [x] User Model service (identity, projects, goals, routines)
- [x] Contacts service (people, relationships, groups)
- [x] Calendar service (events, time blocks, scheduling)
- [x] Location service (saved locations, current location)
- [x] Context Builder (unified context for agent)

### Phase 2: Core Orchestration - Complete

- [x] Tool system with risk profiles and LangChain adapters
- [x] LangGraph-based orchestrator with state management
- [x] Interactive CLI with conversation management
- [x] Personality configuration and system prompt generation
- [x] Database-backed checkpointing for conversations

### Phase 3: Human in the Loop - Complete

- [x] Interrupt system (questions, confirmations, approvals)
- [x] Risk gate node integrated in graph
- [x] Tool approval flow with timeout behaviors
- [x] Interrupt persistence and conversation resume

### Phase 4: Memory - Complete

- [x] Memory storage with sqlite-vss vector search
- [x] Embedding generation and semantic retrieval
- [x] Context-aware recall during conversations
- [x] Conversation summarization (Tier 1)
- [x] Entity Knowledge service (things in user's world)

### Phase 5: Long-Running Tasks - Complete

- [x] User Task service with flexible triggers
- [x] Delegated Task service for agent workflows
- [x] Multi-step workflow execution
- [x] Waiting/follow-up conditions
- [x] Task status tracking and history

### Phase 6: Proactive & Notifications - Complete

- [x] Proactive Scheduler with cron-based checks
- [x] Built-in checks (calendar lookahead, stale follow-ups, daily briefing, deferred tasks)
- [x] Notification Router with channel registration
- [x] Multiple notification channels (CLI, Telegram)
- [x] Attention Budget management (quiet hours, DND, interruption limits)

### Phase 7: Tool Discovery & Agents - Complete

- [x] Tool set organization
- [x] Discovery agent for tool selection

### External Clients - Complete

- [x] Telegram bot client (see `spec/telegram.md`)

### Future Phases

Phases 8 (Reactive Events) and 9 (Learning & Refinement) are documented in [`spec/future-phases.md`](./future-phases.md) for future implementation.

---

## Example Interactions

### Proactive: Morning Briefing

```
[8:00 AM - Daily briefing check triggers]

Agent → Notification:
  "Good morning! Here's your day:

   📅 Today's Schedule:
   • 9:00 - Standup (15 min)
   • 11:00 - Client call with Acme Corp (Sarah, Mike) - prep notes attached
   • 14:00 - 1:1 with Jamie
   • 16:00 - Focus time blocked

   📋 Active Tasks:
   • London conference booking - waiting for your flight preference
   • Q4 report - draft ready for review

   ⚠️ Needs Attention:
   • Haven't heard back from David about the proposal (5 days)

   Anything you'd like me to help with this morning?"

User: "Follow up with David for me"

Agent: [Creates task: Follow up with David]
Agent: [Drafts email based on previous correspondence]
Agent: "I've drafted a follow-up email to David. Here it is:

        'Hi David, wanted to check in on the proposal...'

        Should I send this?"

User: "Looks good, send it"

Agent: [Requests approval - high risk: communication]
→ Interrupt: "Send email to David Chen about proposal follow-up? [Send] [Edit] [Cancel]"

User: [Approves]

Agent: [Sends email]
Agent: "Sent! I'll let you know when he responds."
Agent: [Creates waiting task: Follow up if no response in 2 days]
```

### Interactive: Context-Aware Help

```
User: "What's the status of the Acme project?"

Agent: [Context: User has Acme client call in 2 hours]
Agent: [Retrieves: Project info, recent communications, related tasks]

Agent: "Here's the Acme project status:

        **Overview**: Website redesign, Phase 2
        **Status**: On track
        **Key contacts**: Sarah (PM), Mike (Tech Lead)

        **Recent activity**:
        • Last week: Approved mockups for homepage
        • Yesterday: Mike sent technical requirements doc
        • Pending: Your review of requirements doc

        **Upcoming**:
        • Today 11:00: Call with Sarah and Mike (2 hours from now)

        Since you have a call with them soon, would you like me to:
        1. Summarize the requirements doc for the call
        2. Pull up the mockups you approved
        3. Draft talking points"

User: "Summarize the requirements doc"

Agent: [Retrieves and summarizes document]
Agent: "Here's the summary: [...]

        Three items that might need discussion:
        1. They're proposing React, but you mentioned preferring Vue in past projects
        2. Timeline assumes 2 sprints, which is aggressive
        3. No mention of accessibility requirements

        Want me to add these to your notes for the call?"
```

### Long-Running Task: Travel Booking

```
User: "Book me a flight to London for the AI conference next month"

Agent: [Creates multi-step task]
Agent: "I'll help you book that. Let me gather some information:

        The AI conference is March 15-17 in London.

        Questions:
        1. When would you like to fly out? (March 14 recommended for jet lag)
        2. Return date? (March 18 gives you a buffer day)
        3. Any airline preferences?
        4. Budget range?"

User: "March 14-18 works. No preference on airline, keep it under $2000"

Agent: [Updates task, moves to search step]
Agent: "Got it. I'll search for flights and get back to you with options.
        This might take a few minutes - I'll notify you when ready."

[Agent searches in background, user continues other work]
[15 minutes later]

Agent → Notification:
  "Found flight options for London. Ready to review? [Show options] [Later]"

User: [Show options]

Agent: "Here are the top 3 options:

        1. **United** - $1,450
           Mar 14: SFO 18:30 → LHR 12:15+1 (direct, 10h45m)
           Mar 18: LHR 09:00 → SFO 12:15 (direct, 11h15m)

        2. **British Airways** - $1,680
           Mar 14: SFO 20:00 → LHR 14:30+1 (direct, 10h30m)
           Mar 18: LHR 11:00 → SFO 14:30 (direct, 11h30m)

        3. **Lufthansa** - $1,320
           Mar 14: SFO 15:00 → LHR 14:00+1 (1 stop FRA, 14h)
           Mar 18: LHR 08:00 → SFO 14:00 (1 stop FRA, 15h)

        Based on your past trips, you've preferred direct flights.
        Option 1 or 2 recommended. Which would you like?"

User: "Book option 1"

Agent: [Requests approval - critical risk: financial]
→ Interrupt: "Book United flights for $1,450?
              This will charge your saved payment method.
              [Confirm booking] [Cancel]"

User: [Confirms]

Agent: [Books flight]
Agent: [Adds to calendar with travel time]
Agent: [Creates packing reminder for March 13]
Agent: "Booked! Confirmation: UA1234

        I've added the flights to your calendar and set a packing
        reminder for March 13.

        Would you like me to:
        1. Research hotels near the conference venue
        2. Check if any contacts are also attending
        3. Block focus time before the trip for prep"
```

### Reactive: Email Processing with Learning

```
[Event: New email from unknown sender about "partnership opportunity"]

Agent: [Checks: No prior interaction with sender or domain]
Agent: [Checks: User preference for unknown senders = "flag for review"]
Agent: [Analyzes: Generic pitch, no personalization, bulk email indicators]
Agent: [Decision: Likely spam, flag but don't auto-delete]

[Agent queues for review, doesn't interrupt user]

[Later, user reviews flagged items]

User: "Show me flagged emails"

Agent: "3 emails flagged for review:

        1. **Partnership opportunity** - TechSolutions Inc
           Looks like: Cold outreach / possible spam
           [View] [Archive] [Block domain]

        2. **Conference speaker invitation** - AI Summit
           Looks like: Legitimate, relates to your speaking history
           [View] [Reply interested] [Decline]

        3. **Invoice #4521** - Unknown sender
           Looks like: Possible phishing (you have no account with them)
           [View] [Report phishing] [Delete]"

User: "Block TechSolutions, I'm interested in the AI Summit, delete the invoice"

Agent: [Blocks domain, stores preference]
Agent: [Drafts interest reply for AI Summit]
Agent: [Deletes phishing email, reports]

Agent: "Done! I've drafted a reply for the AI Summit invitation:

        'Thank you for the invitation. I'd be interested in learning more
        about speaking opportunities. Could you share details about...'

        Should I send this, or would you like to edit it?"

Agent: [Stores learning: User interested in speaking invitations]
Agent: [Stores learning: Cold partnership emails = usually spam]
```

### Proactive: Intelligent Follow-up

```
[3 days after user asked agent to follow up with David]

[Proactive check detects: No response from David, task still waiting]

Agent → Notification (medium priority):
  "Still no response from David about the proposal.

   Options:
   • Send another follow-up
   • Try reaching him on LinkedIn
   • Loop in his manager (you have Sarah's contact)
   • Wait another few days

   What would you prefer?"

User: "Wait until Monday, then try LinkedIn if still no response"

Agent: [Updates task with new condition]
Agent: "Got it. I'll check again Monday and reach out via LinkedIn if needed.
        I'll let you know either way."

[Monday, still no response]

Agent: [Drafts LinkedIn message]
Agent: [Requests approval before sending]
→ Interrupt: "No response from David via email. Ready to send LinkedIn message?

              'Hi David, I wanted to follow up on the proposal I sent
              last week. Would love to connect when you have a moment.'

              [Send] [Edit] [Wait longer] [Escalate to Sarah]"
```

---

## References

- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
- [LangChain.js](https://js.langchain.com/)
- [Knex.js](https://knexjs.org/)
- [Zod](https://zod.dev/)
- [MCP Specification](https://modelcontextprotocol.io/)

---

## Conclusion

This specification documents the complete initial implementation of GLaDOS. The system provides:

- **Personal Context**: User model, contacts, calendar, and location awareness
- **Conversational Interface**: CLI and Telegram clients
- **Tool Execution**: Risk-gated tools with human-in-the-loop approval
- **Memory**: Persistent storage with semantic search and procedural knowledge
- **Task Management**: User tasks and multi-step delegated workflows
- **Proactive Behavior**: Scheduled checks and intelligent notifications
- **Extensibility**: Dynamic tool discovery

Future capabilities (reactive events and learning) are documented in [`spec/future-phases.md`](./future-phases.md).

For developer documentation, see the `docs/` directory. For AI agent guidance, see `CLAUDE.md`.
