# Day Planner Specification

> Daily planning sessions with structured context

**Version**: 1.0
**Status**: Implemented
**Dependencies**: Context Builder, Calendar

## Overview

The Day Planner provides structured daily planning sessions that produce a day plan loaded into every agent interaction. This gives the agent awareness of the user's intentions for the day, enabling better prioritization suggestions and context-aware responses.

### Goals

1. **Daily Structure**: Capture the user's intentions, priorities, and focus areas for each day
2. **Persistent Context**: Day plan is available to the agent in all interactions throughout the day
3. **Calendar Integration**: Planning incorporates scheduled events as fixed anchors
4. **Flexible Updates**: Plan can be revised throughout the day as circumstances change
5. **Historical Insight**: Past plans provide data for pattern recognition and improvement

### Non-Goals (for v1)

- Automatic planning session triggers (future trigger system)
- Time blocking / detailed scheduling
- Multi-day or weekly planning
- Integration with external todo apps
- AI-generated plan suggestions (user-driven for now)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Day Planner                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────┐        ┌──────────────────┐          │
│  │   Planning Tool  │───────▶│  DayPlanService  │          │
│  │   (agent use)    │        │                  │          │
│  └──────────────────┘        └────────┬─────────┘          │
│                                       │                     │
│                                       ▼                     │
│                              ┌──────────────────┐          │
│                              │   Day Plan Store │          │
│                              │   (persistence)  │          │
│                              └──────────────────┘          │
│                                       │                     │
│                                       ▼                     │
│                              ┌──────────────────┐          │
│                              │ Context Builder  │          │
│                              │ (integration)    │          │
│                              └──────────────────┘          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Components

| Component | Purpose |
|-----------|---------|
| `DayPlanService` | Core service for creating, updating, and retrieving day plans |
| `day-planner.store.ts` | SQLite persistence for day plans |
| `day-planner.schemas.ts` | Zod schemas for plan structure |
| `day-planner.tools.ts` | LangChain tools for agent interaction |

---

## Module Structure

```
src/day-planner/
├── day-planner.ts           # Main DayPlanService
├── day-planner.schemas.ts   # Zod schemas
├── day-planner.store.ts     # SQLite persistence
├── day-planner.tools.ts     # Agent tools
├── day-planner.errors.ts    # Custom errors
└── day-planner.test.ts      # Unit tests
```

---

## Data Model

### Day Plan

```typescript
type DayPlan = {
  id: string;                    // UUID
  date: string;                  // ISO date (YYYY-MM-DD)

  // Core planning elements
  intentions: string[];          // What user wants to accomplish
  priorities: Priority[];        // Ordered by importance
  focusBlocks: FocusBlock[];     // Dedicated time for deep work

  // Metadata
  status: 'draft' | 'active' | 'completed' | 'abandoned';
  energyLevel?: 'low' | 'medium' | 'high';  // User's expected energy
  notes?: string;                // Free-form notes

  // Tracking
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

type Priority = {
  id: string;
  description: string;
  category?: string;             // e.g., 'work', 'personal', 'health'
  linkedProjectId?: string;      // Reference to user-model project
  linkedTaskId?: string;         // Reference to delegated/user task
  completed: boolean;
  completedAt?: string;
};

type FocusBlock = {
  id: string;
  label: string;                 // e.g., "Deep work on Project X"
  startTime?: string;            // Optional - can be unscheduled
  duration: number;              // Minutes
  completed: boolean;
};
```

### Day Plan Context (for Agent)

The context provided to the agent is a simplified view:

```typescript
type DayPlanContext = {
  date: string;
  status: 'draft' | 'active' | 'completed' | 'abandoned';
  intentions: string[];
  priorities: {
    description: string;
    category?: string;
    completed: boolean;
  }[];
  focusBlocks: {
    label: string;
    startTime?: string;
    duration: number;
    completed: boolean;
  }[];
  energyLevel?: 'low' | 'medium' | 'high';
  notes?: string;
  progressSummary: string;       // e.g., "2 of 5 priorities completed"
};
```

---

## Database Schema

### Migration: `XXX_day_plans.ts`

```sql
CREATE TABLE day_plans (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,     -- Only one plan per day
  status TEXT NOT NULL DEFAULT 'draft',
  energy_level TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE day_plan_intentions (
  id TEXT PRIMARY KEY,
  day_plan_id TEXT NOT NULL REFERENCES day_plans(id) ON DELETE CASCADE,
  intention TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE day_plan_priorities (
  id TEXT PRIMARY KEY,
  day_plan_id TEXT NOT NULL REFERENCES day_plans(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  category TEXT,
  linked_project_id TEXT,
  linked_task_id TEXT,
  completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE day_plan_focus_blocks (
  id TEXT PRIMARY KEY,
  day_plan_id TEXT NOT NULL REFERENCES day_plans(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  start_time TEXT,
  duration INTEGER NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_day_plans_date ON day_plans(date);
CREATE INDEX idx_day_plan_priorities_plan ON day_plan_priorities(day_plan_id);
CREATE INDEX idx_day_plan_focus_blocks_plan ON day_plan_focus_blocks(day_plan_id);
```

---

## Service API

### DayPlanService

```typescript
class DayPlanService {
  // Plan lifecycle
  createPlan(date: string, input: CreateDayPlanInput): Promise<DayPlan>;
  getPlan(date: string): Promise<DayPlan | null>;
  getTodayPlan(): Promise<DayPlan | null>;
  updatePlan(date: string, input: UpdateDayPlanInput): Promise<DayPlan>;

  // Status management
  activatePlan(date: string): Promise<DayPlan>;
  completePlan(date: string): Promise<DayPlan>;
  abandonPlan(date: string): Promise<DayPlan>;

  // Priority management
  addPriority(date: string, priority: CreatePriorityInput): Promise<Priority>;
  updatePriority(priorityId: string, input: UpdatePriorityInput): Promise<Priority>;
  completePriority(priorityId: string): Promise<Priority>;
  removePriority(priorityId: string): Promise<void>;
  reorderPriorities(date: string, priorityIds: string[]): Promise<void>;

  // Focus block management
  addFocusBlock(date: string, block: CreateFocusBlockInput): Promise<FocusBlock>;
  updateFocusBlock(blockId: string, input: UpdateFocusBlockInput): Promise<FocusBlock>;
  completeFocusBlock(blockId: string): Promise<FocusBlock>;
  removeFocusBlock(blockId: string): Promise<void>;

  // Context for agent
  getPlanContext(date: string): Promise<DayPlanContext | null>;
  getTodayPlanContext(): Promise<DayPlanContext | null>;

  // History
  getRecentPlans(days: number): Promise<DayPlan[]>;
}
```

---

## Agent Tools

### day_plan_create

Creates or updates the day plan. Used during planning sessions.

```typescript
const dayPlanCreateTool = {
  name: 'day_plan_create',
  description: `Create or update the day plan. Use this during a planning session to capture
the user's intentions and priorities for the day. If a plan already exists for today,
it will be updated.`,
  schema: z.object({
    intentions: z.array(z.string()).describe('High-level intentions for the day'),
    priorities: z.array(z.object({
      description: z.string(),
      category: z.string().optional(),
    })).describe('Ordered list of priorities (most important first)'),
    focusBlocks: z.array(z.object({
      label: z.string(),
      startTime: z.string().optional(),
      duration: z.number(),
    })).optional().describe('Dedicated focus time blocks'),
    energyLevel: z.enum(['low', 'medium', 'high']).optional(),
    notes: z.string().optional(),
  }),
  riskLevel: 'low',
};
```

### day_plan_update_priority

Update a specific priority's status or details.

```typescript
const dayPlanUpdatePriorityTool = {
  name: 'day_plan_update_priority',
  description: 'Update a priority in today\'s plan - mark as complete or update details.',
  schema: z.object({
    priorityId: z.string().describe('ID of the priority to update'),
    completed: z.boolean().optional(),
    description: z.string().optional(),
  }),
  riskLevel: 'low',
};
```

### day_plan_add_priority

Add a new priority to today's plan.

```typescript
const dayPlanAddPriorityTool = {
  name: 'day_plan_add_priority',
  description: 'Add a new priority to today\'s plan.',
  schema: z.object({
    description: z.string(),
    category: z.string().optional(),
    position: z.number().optional().describe('Position in priority list (0 = top)'),
  }),
  riskLevel: 'low',
};
```

### day_plan_get

Retrieve the current day plan. Primarily for agent inspection.

```typescript
const dayPlanGetTool = {
  name: 'day_plan_get',
  description: 'Get the full day plan for today or a specific date.',
  schema: z.object({
    date: z.string().optional().describe('ISO date (YYYY-MM-DD), defaults to today'),
  }),
  riskLevel: 'low',
};
```

---

## Context Builder Integration

The day plan is integrated into the agent's context via `ContextBuilderService`:

```typescript
// In context.schemas.ts
const agentContextSchema = z.object({
  // ... existing fields ...

  // Day plan awareness
  dayPlan: dayPlanContextSchema.nullable(),
});

// In context.ts
class ContextBuilderService {
  buildContext = async (now: Date = new Date()): Promise<AgentContext> => {
    const [
      // ... existing context ...
      dayPlanContext,
    ] = await Promise.all([
      // ... existing calls ...
      this.#getDayPlanContext(),
    ]);

    return {
      // ... existing fields ...
      dayPlan: dayPlanContext,
    };
  };

  #getDayPlanContext = async (): Promise<DayPlanContext | null> => {
    try {
      const dayPlanService = this.#services.get(DayPlanService);
      return await dayPlanService.getTodayPlanContext();
    } catch {
      return null;
    }
  };
}
```

---

## Planning Session Flow

A planning session is a conversation where the agent helps the user create their day plan:

### 1. Session Initiation

User or trigger initiates planning:
```
User: "Let's plan my day"
```

### 2. Context Gathering

Agent gathers relevant context:
- Today's calendar events (fixed commitments)
- Pending tasks from task service
- Active projects from user model
- Yesterday's plan (if exists) - what carried over?

### 3. Interactive Planning

Agent guides user through:
1. **Energy Check**: "How's your energy today?"
2. **Intentions**: "What do you want this day to be about?"
3. **Priorities**: "What are your top 3 priorities?" (considering calendar gaps)
4. **Focus Blocks**: "When do you want dedicated focus time?"
5. **Review**: Summarize and confirm

### 4. Plan Capture

Agent uses `day_plan_create` tool to persist the plan.

### 5. Plan Activation

Plan moves from `draft` to `active` status.

---

## Example Interactions

### Planning Session

```
User: Let's plan my day

Agent: Good morning! Let me help you plan your day.

Looking at your calendar, you have:
- 10:00 AM - Team standup (30 min)
- 2:00 PM - 1:1 with Sarah (1 hour)
- 4:30 PM - Dentist appointment

That leaves your morning before 10 AM, late morning (10:30-2:00),
and a slot from 3:00-4:30 PM.

First, how's your energy level today - low, medium, or high?

User: Medium, didn't sleep great

Agent: Understood. With medium energy, we might want to tackle
harder tasks in the morning when you're freshest.

What are your main intentions for today? What do you want this
day to be about?

User: I really need to make progress on the API redesign, and
I should follow up with the team about the launch timeline

Agent: Great - API redesign progress and launch timeline follow-up.

Let's turn those into priorities. What else is on your mind?

User: That's the main stuff. Oh, and I need to prep for the
Sarah 1:1

Agent: Perfect. Here's what I'm capturing:

**Priorities:**
1. Make progress on API redesign (work)
2. Follow up on launch timeline with team (work)
3. Prep for Sarah 1:1 (work)

**Focus Blocks:**
Would you like to block some focus time? You have 8:00-10:00 AM
free - perfect for the API work while your mind is fresh.

User: Yes, let's do 8-10 for API work

Agent: Done! I've created your day plan:

**Today's Plan** (Medium Energy)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Intentions: API redesign progress, launch timeline alignment

Priorities:
☐ Make progress on API redesign
☐ Follow up on launch timeline with team
☐ Prep for Sarah 1:1

Focus Time:
📍 8:00-10:00 AM - API redesign deep work

I'll keep this in mind throughout our conversations today.
```

### Mid-Day Check-In

```
User: I finished the API auth section

Agent: Nice work! I've marked "Make progress on API redesign"
as complete on your day plan.

You're 1 of 3 on priorities. Still have:
☐ Follow up on launch timeline with team
☐ Prep for Sarah 1:1

Your 1:1 with Sarah is in 2 hours - want to tackle the prep now
or after the launch timeline follow-up?
```

### Adding to Plan

```
User: Oh, I also need to review the PR from Mike today

Agent: Added "Review Mike's PR" to today's priorities.
Updated plan:

☑ Make progress on API redesign
☐ Follow up on launch timeline with team
☐ Prep for Sarah 1:1
☐ Review Mike's PR
```

---

## Implementation Checklist

### Phase 1: Core Infrastructure
- [x] Create Zod schemas for DayPlan, Priority, FocusBlock
- [x] Create database migration
- [x] Implement DayPlanStore with CRUD operations
- [x] Implement DayPlanService

### Phase 2: Agent Integration
- [x] Create day_plan_create tool
- [x] Create day_plan_update_priority tool
- [x] Create day_plan_add_priority tool
- [x] Create day_plan_get tool
- [x] Register tools in tool service

### Phase 3: Context Integration
- [x] Add DayPlanContext schema
- [x] Integrate with ContextBuilderService
- [x] Update AgentContext type

### Phase 4: Testing
- [x] Unit tests for DayPlanService
- [x] Unit tests for DayPlanStore
- [x] Flow tests for planning sessions

---

## Future Enhancements

These are out of scope for v1 but worth considering:

1. **Automatic Triggers**: Start planning session at configured time (requires trigger system)
2. **Plan Templates**: Recurring plan structures for different day types
3. **AI Suggestions**: Suggest priorities based on pending tasks, calendar, and patterns
4. **Time Blocking**: Automatically slot priorities into calendar gaps
5. **End-of-Day Review**: Automated reflection on what got done
6. **Weekly Planning**: Higher-level planning that informs daily plans
7. **Priority Linking**: Deep links to tasks, calendar events, projects
8. **Energy Tracking**: Learn user's energy patterns over time
