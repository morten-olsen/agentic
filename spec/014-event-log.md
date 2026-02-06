# Event Log Specification

> Unified event stream capturing changes from internal systems and external sources

**Version**: 1.0
**Status**: Implemented
**Dependencies**: 001-agent.md, 003-triggers.md

## Overview

The Event Log is a unified event stream that captures all relevant changes from both internal systems and external sources. Rather than rebuilding context snapshots and computing deltas, the system maintains a chronological log of discrete events that agents can query.

This is a fundamental shift from **polling** to **event-driven** architecture.

### Goals

1. **Unified Event Stream**: Single source of truth for all system changes
2. **Efficient Querying**: Query events by time range, category, type, or checkpoint
3. **Reactive Triggers**: Enable triggers to fire on event patterns, not just time
4. **Agent Awareness**: Give agents visibility into what changed since last interaction
5. **Audit Trail**: Complete history of system activity for debugging and replay

### Non-Goals (for v1)

- Real-time streaming to external systems (webhooks, SSE)
- Event sourcing as primary data storage (events complement, not replace, domain tables)
- Complex event processing (CEP) or pattern matching across multiple events
- Cross-user event aggregation (single-user system)
- Event schema versioning and migration

### Future Considerations

- Subscription system for reactive triggers (trigger fires when pattern matches)
- Event replay for debugging
- Integration with Messaging feature (events for messages received)
- Health/wellness event sources
- External event ingress (webhooks)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Event Log System                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                        Event Sources                                  │   │
│   │                                                                       │   │
│   │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │   │
│   │  │ Calendar │ │  Tasks   │ │ Location │ │  System  │ │ External │  │   │
│   │  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘  │   │
│   │       │            │            │            │            │         │   │
│   └───────┼────────────┼────────────┼────────────┼────────────┼─────────┘   │
│           │            │            │            │            │             │
│           └────────────┴────────────┼────────────┴────────────┘             │
│                                     ▼                                        │
│                          ┌───────────────────┐                              │
│                          │   EventService    │                              │
│                          │                   │                              │
│                          │ - emit(event)     │                              │
│                          │ - query(filter)   │                              │
│                          │ - since(id)       │                              │
│                          └─────────┬─────────┘                              │
│                                    │                                         │
│                                    ▼                                         │
│                          ┌───────────────────┐                              │
│                          │   EventStore      │                              │
│                          │   (SQLite)        │                              │
│                          └─────────┬─────────┘                              │
│                                    │                                         │
│           ┌────────────────────────┼────────────────────────┐               │
│           │                        │                        │               │
│           ▼                        ▼                        ▼               │
│   ┌───────────────┐      ┌───────────────┐      ┌───────────────┐          │
│   │ Agent Tools   │      │   Triggers    │      │ Background    │          │
│   │               │      │               │      │ Tasks         │          │
│   │ queryEvents   │      │ React to      │      │               │          │
│   │ eventsSince   │      │ patterns      │      │ Process delta │          │
│   └───────────────┘      └───────────────┘      └───────────────┘          │
│                                                                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Append-Only Log**: Events are immutable once written. Edits to external entities (e.g., Slack message edited) create new events with a different type and versioned externalId, preserving full history.

2. **Entity vs Event Identity**: `externalId` identifies a specific event/state (versioned), while `entityId` identifies the underlying entity (stable). This allows querying "all events for message X" while maintaining append-only semantics.

3. **Pull-Based Consumption**: Consumers query for events rather than receiving pushes. This simplifies the architecture and avoids delivery guarantees complexity.

4. **Checkpointing**: Background tasks track their last processed event ID, enabling efficient "since last run" queries.

5. **Source Integration**: Event emission is added to existing services (calendar, tasks, location) rather than requiring them to be rewritten.

6. **Idempotent Writes**: Duplicate events (same externalId + same content) are silently skipped. Same externalId with different content is an error - sources must version their IDs for mutable entities.

---

## Event Type Namespacing

Event types use dot-notation namespacing to enable hierarchical filtering with wildcards.

### Convention

```
{domain}.{entity}.{action}
```

Examples:
- `calendar.event.created`
- `calendar.event.updated`
- `tasks.task.completed`
- `location.zone.arrived`
- `health.sleep.logged`
- `system.trigger.fired`

### Wildcard Matching

Queries can use wildcards to match event hierarchies:

| Pattern | Matches |
|---------|---------|
| `calendar.*` | All calendar events |
| `calendar.event.*` | All calendar event actions |
| `*.*.created` | All creation events across domains |
| `health.*` | All health events |

### Common Domains

| Domain | Description | Example Types |
|--------|-------------|---------------|
| `calendar` | Calendar events | `calendar.event.created`, `calendar.event.started` |
| `tasks` | Task management | `tasks.task.completed`, `tasks.task.delegated` |
| `location` | Location tracking | `location.zone.arrived`, `location.zone.departed` |
| `communication` | Messaging | `communication.slack.received`, `communication.email.received` |
| `system` | Internal system | `system.trigger.fired`, `system.conversation.started` |
| `health` | Health & wellness | `health.sleep.logged`, `health.exercise.logged` |
| `external` | External sources | `external.weather.alert`, `external.price.changed` |

New domains can be added freely - the system doesn't enforce a fixed list.

---

## Data Model

### Event Schema

```typescript
type Event = {
  id: string;                           // ULID for time-ordered IDs
  type: string;                         // Namespaced: 'calendar.event.created', 'health.sleep.logged'
  timestamp: string;                    // ISO8601 when event occurred
  source: string;                       // 'calendar-service', 'homeassistant', etc.

  // Deduplication
  externalId?: string;                  // ID from source system
  hash?: string;                        // Content hash for duplicate detection

  // Content
  summary?: string;                     // Human-readable (optional - type may be self-describing)
  data: Record<string, unknown>;        // Full event payload

  // Relations
  entityId?: string;                    // Related entity (contact ID, project ID, etc.)
  entityType?: string;                  // Type of related entity
  conversationId?: string;              // Conversation that triggered this event
  messageId?: string;                   // Specific message within the conversation

  // Timestamps
  createdAt: string;                    // When event was recorded (may differ from timestamp)
};
```

### Event Input Schema

```typescript
type EmitEventInput = {
  type: string;                         // Namespaced: 'calendar.event.created'
  timestamp?: string;                   // Defaults to now
  source: string;
  externalId?: string;
  summary?: string;                     // Optional human-readable description
  data?: Record<string, unknown>;
  entityId?: string;
  entityType?: string;
  conversationId?: string;
  messageId?: string;
};
```

### Query Filter Schema

```typescript
type EventQueryFilter = {
  // Time range
  since?: string;                       // ISO8601 or event ID
  until?: string;                       // ISO8601

  // Type filtering with wildcards
  types?: string[];                     // e.g., ['calendar.*', 'tasks.task.completed']

  // Entity filtering
  entityId?: string;
  entityType?: string;

  // Conversation filtering
  conversationId?: string;
  messageId?: string;

  // Pagination
  limit?: number;                       // Default 100, max 1000
  offset?: number;
};

type EventQueryResult = {
  events: Event[];
  total: number;                        // Total matching events (for pagination awareness)
  hasMore: boolean;
  nextOffset?: number;
};
```

---

## Database Schema

### Migration: `xxx_events.ts`

```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY,                  -- ULID
  type TEXT NOT NULL,                   -- Namespaced: 'calendar.event.created'
  timestamp TEXT NOT NULL,              -- ISO8601 when event occurred
  source TEXT NOT NULL,                 -- 'calendar-service'

  -- Deduplication
  external_id TEXT,
  hash TEXT,

  -- Content
  summary TEXT,                         -- Optional human-readable description
  data TEXT NOT NULL,                   -- JSON

  -- Relations
  entity_id TEXT,
  entity_type TEXT,
  conversation_id TEXT,
  message_id TEXT,

  -- Timestamps
  created_at TEXT NOT NULL,             -- When recorded

  -- Deduplication constraint
  UNIQUE(source, external_id)
);

-- Primary query pattern: events since a timestamp
CREATE INDEX idx_events_timestamp ON events(timestamp DESC);

-- Filter by type (supports prefix matching for wildcards)
CREATE INDEX idx_events_type_timestamp ON events(type, timestamp DESC);

-- Filter by entity
CREATE INDEX idx_events_entity ON events(entity_type, entity_id, timestamp DESC);

-- Lookup by conversation
CREATE INDEX idx_events_conversation ON events(conversation_id);

-- Lookup by message
CREATE INDEX idx_events_message ON events(message_id);

-- Deduplication by hash (for events without external_id)
CREATE INDEX idx_events_hash ON events(source, hash);
```

### Checkpoint Table

Background tasks track their progress using checkpoints:

```sql
CREATE TABLE event_checkpoints (
  task_id TEXT PRIMARY KEY,             -- 'daily-briefing', 'calendar-sync', etc.
  last_event_id TEXT NOT NULL,          -- Last processed event ID
  updated_at TEXT NOT NULL
);
```

---

## EventService

### Responsibilities

1. **Emit Events**: Accept events from sources, deduplicate, and persist
2. **Query Events**: Efficient querying by time range, category, type, entity
3. **Checkpoint Management**: Track consumption progress for background tasks
4. **Cleanup**: Retention policy enforcement

### Interface

```typescript
class EventService {
  constructor(deps: {
    db: Knex;
  });

  // Emit events
  emit(input: EmitEventInput): Promise<Event>;
  emitBatch(inputs: EmitEventInput[]): Promise<Event[]>;

  // Query events
  query(filter: EventQueryFilter): Promise<EventQueryResult>;
  since(eventId: string, filter?: Omit<EventQueryFilter, 'since'>): Promise<EventQueryResult>;
  get(id: string): Promise<Event | null>;

  // Checkpointing
  getCheckpoint(taskId: string): Promise<string | null>;
  setCheckpoint(taskId: string, eventId: string): Promise<void>;
  eventsSinceCheckpoint(taskId: string, filter?: EventQueryFilter): Promise<EventQueryResult>;

  // Maintenance
  cleanup(retentionDays: number): Promise<number>;  // Returns deleted count
}
```

### Wildcard Matching Implementation

Type filtering supports wildcards using SQL `LIKE` with the namespaced structure:

```typescript
const buildTypeFilter = (types: string[]): string[] => {
  // Convert wildcards to SQL LIKE patterns
  // 'calendar.*' → 'calendar.%'
  // 'tasks.task.completed' → 'tasks.task.completed' (exact match)
  return types.map(t => t.replace(/\.\*$/, '.%'));
};

// Query: WHERE type LIKE 'calendar.%' OR type = 'tasks.task.completed'
```

The index on `(type, timestamp)` enables efficient prefix matching for patterns like `calendar.%`.

### Deduplication Strategy

Events are deduplicated while preserving the append-only log semantics.

**Key distinction:**
- **`externalId`**: Unique identifier for this specific event/state (should include version for mutable entities)
- **`entityId`**: The underlying entity being referenced (stable across edits)

**Example: Slack message edited twice**
```typescript
// Message received
{ type: 'communication.slack.message.received',
  externalId: 'msg-123-1675000000',  // ID + timestamp = unique per state
  entityId: 'msg-123',                // Stable entity reference
  entityType: 'slack-message' }

// First edit - new event, not an update
{ type: 'communication.slack.message.edited',
  externalId: 'msg-123-1675001000',  // Different timestamp = new event
  entityId: 'msg-123',
  entityType: 'slack-message' }

// Second edit - another new event
{ type: 'communication.slack.message.edited',
  externalId: 'msg-123-1675002000',
  entityId: 'msg-123',
  entityType: 'slack-message' }
```

This enables:
- Query all events for an entity: `WHERE entity_id = 'msg-123'`
- Get latest state: `WHERE entity_id = 'msg-123' ORDER BY timestamp DESC LIMIT 1`
- Full history preserved (append-only maintained)

**Deduplication layers:**

1. **External ID uniqueness**: `(source, external_id)` must be unique
   - If identical externalId exists with identical content → skip (idempotent retry)
   - If identical externalId exists with different content → error (source should version its IDs)

2. **Content hash**: For events without externalId, hash key fields to detect duplicates
   - Hash: `sha256(type + entityId + timestamp + JSON(data))`
   - If hash matches within time window → skip

```typescript
const emitEvent = async (input: EmitEventInput): Promise<Event | null> => {
  // Generate hash for content-based dedup
  const hash = !input.externalId ? generateContentHash(input) : undefined;

  // Check for existing event
  const existing = await findExisting(input.source, input.externalId, hash);

  if (existing) {
    if (contentMatches(existing, input)) {
      return null; // Idempotent skip
    }
    // Same externalId but different content - source should use versioned IDs
    throw new Error(
      `Event with externalId ${input.externalId} already exists with different content. ` +
      `For mutable entities, include version/timestamp in externalId.`
    );
  }

  return insert(input, hash);
};
```

**Guidelines for sources:**

| Entity Type | ExternalId Strategy | Example |
|-------------|---------------------|---------|
| Immutable (trigger fired) | Entity ID only | `trigger-abc-fired-1675000000` |
| Mutable (message, event) | Entity ID + version/timestamp | `slack-msg-123-1675001000` |
| Derived (daily summary) | Deterministic from inputs | `daily-summary-2024-01-15` |

---

## Agent Tools

### query_events

Query events by time range and filters.

```typescript
type QueryEventsTool = {
  name: 'query_events';
  description: `Query the event log for system events.

    Use this to understand what happened in a time period:
    - "What happened today?" → query with since: today's midnight
    - "What calendar changes were made?" → query with types: ['calendar.*']
    - "What tasks were completed?" → query with types: ['tasks.task.completed']
    - "What happened with project X?" → query with entityId: project ID

    Event types use dot-notation namespacing. Use wildcards for broader matches:
    - 'calendar.*' matches all calendar events
    - 'health.sleep.*' matches all sleep events
    - 'system.trigger.fired' matches exactly that event type`;

  parameters: {
    since?: string;           // ISO8601 datetime or event ID
    until?: string;           // ISO8601 datetime
    types?: string[];         // Namespaced with wildcards: ['calendar.*', 'tasks.task.completed']
    entityId?: string;        // Filter by related entity
    limit?: number;           // Default 50, max 200
  };

  returns: {
    events: Array<{
      id: string;
      type: string;
      timestamp: string;
      summary?: string;
      data: Record<string, unknown>;
    }>;
    total: number;            // Total matching events (helps decide if query needs narrowing)
    hasMore: boolean;
  };
};
```

### get_recent_changes

Convenience tool for common "what changed" queries.

```typescript
type GetRecentChangesTool = {
  name: 'get_recent_changes';
  description: `Get a summary of recent changes across the system.

    This is a convenience wrapper around query_events that provides
    a human-friendly summary of what happened recently.

    Use this when the user asks:
    - "What did I miss?"
    - "What happened while I was away?"
    - "Catch me up on today"`;

  parameters: {
    since?: string;           // 'today', 'yesterday', 'this_week', or ISO8601
    types?: string[];         // Filter with wildcards: ['calendar.*', 'tasks.*']
  };

  returns: {
    summary: string;          // Human-readable summary
    eventCount: number;
    byDomain: Record<string, number>;  // Count per top-level domain
  };
};
```

---

## Source Integration

Each service that generates events emits them to the EventService **after** completing its primary operation. The event log is downstream of the operation, not part of it.

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│  External API   │ ──── │  Sync Service   │ ──── │   Local DB      │
│  (Google Cal)   │      │  (CalendarSync) │      │   (calendar)    │
└─────────────────┘      └────────┬────────┘      └─────────────────┘
                                  │
                                  │ after update
                                  ▼
                         ┌─────────────────┐
                         │   Event Log     │
                         │   (events)      │
                         └────────┬────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐
              │  Agent   │ │ Triggers │ │ Briefing │
              │  queries │ │  react   │ │ summary  │
              └──────────┘ └──────────┘ └──────────┘
```

Event emission is done at the service layer, not the store layer.

### Calendar Events

```typescript
// In CalendarService
async createEvent(input: CreateEventInput): Promise<CalendarEvent> {
  const event = await this.store.create(input);

  await this.eventService.emit({
    type: 'calendar.event.created',
    source: 'calendar-service',
    externalId: event.id,
    summary: `Calendar event '${event.title}' created`,
    data: {
      eventId: event.id,
      title: event.title,
      startTime: event.startTime,
      endTime: event.endTime,
    },
    entityId: event.id,
    entityType: 'calendar-event',
  });

  return event;
}
```

### Task Events

```typescript
// In TaskService
async completeTask(taskId: string): Promise<Task> {
  const task = await this.store.complete(taskId);

  await this.eventService.emit({
    type: 'tasks.task.completed',
    source: 'task-service',
    externalId: `task-completed-${task.id}`,
    summary: `Task '${task.title}' completed`,
    data: {
      taskId: task.id,
      title: task.title,
      completedAt: new Date().toISOString(),
    },
    entityId: task.id,
    entityType: 'task',
  });

  return task;
}
```

### Location Events

```typescript
// In LocationService
async updateLocation(input: LocationUpdate): Promise<void> {
  const previousLocation = await this.store.getCurrentLocation();
  await this.store.update(input);

  // Emit arrival/departure events based on zone changes
  if (previousLocation?.zone !== input.zone && input.zone) {
    await this.eventService.emit({
      type: 'location.zone.arrived',
      source: 'location-service',
      // No summary needed - type + data is self-describing
      data: {
        zone: input.zone,
        coordinates: input.coordinates,
        previousZone: previousLocation?.zone,
      },
    });
  }
}
```

### System Events

```typescript
// In TriggerService
async #fire(trigger: Trigger): Promise<void> {
  await this.eventService.emit({
    type: 'system.trigger.fired',
    source: 'trigger-service',
    externalId: `trigger-${trigger.id}-${Date.now()}`,
    summary: `Trigger '${trigger.name}' fired`,
    data: {
      triggerId: trigger.id,
      triggerName: trigger.name,
      goal: trigger.goal,
      invocationCount: trigger.invocationCount + 1,
    },
    entityId: trigger.id,
    entityType: 'trigger',
  });

  // ... rest of fire logic
}
```

### Health Events

```typescript
// Example: Sleep logged from wearable integration
await this.eventService.emit({
  type: 'health.sleep.logged',
  source: 'apple-health',
  externalId: sleepSession.id,
  // No summary needed - health.sleep.logged + timestamp is clear
  data: {
    startTime: sleepSession.startTime,
    endTime: sleepSession.endTime,
    durationMinutes: sleepSession.duration,
    quality: sleepSession.quality,
  },
});
```

### Mutable Entity Events (Slack Message Example)

```typescript
// In SlackService - handling message events from Slack API

// New message received
async onMessageReceived(message: SlackMessage): Promise<void> {
  await this.eventService.emit({
    type: 'communication.slack.message.received',
    source: 'slack',
    // Version the externalId with timestamp for mutable entities
    externalId: `${message.ts}-${message.ts}`,  // ts is unique, use twice for initial
    entityId: message.ts,                        // Stable message identifier
    entityType: 'slack-message',
    data: {
      channel: message.channel,
      user: message.user,
      text: message.text,
      threadTs: message.thread_ts,
    },
  });
}

// Message edited
async onMessageEdited(message: SlackMessage, editedTs: string): Promise<void> {
  await this.eventService.emit({
    type: 'communication.slack.message.edited',
    source: 'slack',
    // Include edit timestamp for uniqueness
    externalId: `${message.ts}-${editedTs}`,
    entityId: message.ts,
    entityType: 'slack-message',
    data: {
      channel: message.channel,
      user: message.user,
      text: message.text,              // New content
      previousText: message.old_text,  // Optional: include old content
      editedAt: editedTs,
    },
  });
}

// Message deleted
async onMessageDeleted(channel: string, ts: string, deletedTs: string): Promise<void> {
  await this.eventService.emit({
    type: 'communication.slack.message.deleted',
    source: 'slack',
    externalId: `${ts}-deleted-${deletedTs}`,
    entityId: ts,
    entityType: 'slack-message',
    data: {
      channel,
      deletedAt: deletedTs,
    },
  });
}
```

This pattern ensures:
- Each state change is a separate event (append-only preserved)
- All events for a message can be queried via `entityId`
- Retries are idempotent (same externalId + content = skip)
- Edit history is fully preserved

---

## Background Task Integration

Background tasks use checkpointing to process only new events since their last run.

```typescript
// Example: Daily summary task
const runDailySummary = async (eventService: EventService) => {
  const taskId = 'daily-summary';

  // Get events since last run
  const { events, total } = await eventService.eventsSinceCheckpoint(taskId, {
    types: ['calendar.*', 'tasks.*'],
    limit: 500,
  });

  if (events.length === 0) {
    return; // Nothing new
  }

  // If there are many more events, might want to summarize differently
  if (total > 500) {
    // Consider grouping by type or narrowing the query
  }

  // Process events...
  const summary = generateSummary(events);

  // Update checkpoint to last processed event
  const lastEvent = events[events.length - 1];
  await eventService.setCheckpoint(taskId, lastEvent.id);

  return summary;
};
```

---

## Retention & Cleanup

Events are retained based on a configurable policy:

```typescript
type RetentionConfig = {
  // Default retention
  defaultRetentionDays: number;         // Default: 30 days

  // Category-specific retention (optional)
  categoryRetention?: Partial<Record<EventCategory, number>>;

  // Never delete events referenced by other records
  preserveReferencedEvents: boolean;    // Default: true
};
```

Cleanup runs periodically (e.g., daily via trigger):

```typescript
const cleanupEvents = async (eventService: EventService, config: RetentionConfig) => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - config.defaultRetentionDays);

  const deleted = await eventService.cleanup(config.defaultRetentionDays);

  return { deleted, cutoffDate: cutoff.toISOString() };
};
```

---

## Use Cases

### Agent Awareness

```typescript
// In context builder
const getRecentEvents = async (eventService: EventService) => {
  const { events, total } = await eventService.query({
    since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Last 24h
    limit: 50,
  });

  // Use summary if available, otherwise derive from type
  const summaries = events.map(e => e.summary ?? `${e.type} at ${e.timestamp}`);

  return { summaries: summaries.join('\n'), totalEvents: total };
};
```

Example queries an agent might make:
- "You received 3 Slack messages from Alice while in your meeting"
- "Your location changed to 'Office' 20 minutes ago"
- "2 calendar events were added to tomorrow's schedule"

### What Happened While Away

```
User: "What did I miss this morning?"

Agent uses query_events:
  - since: today 00:00
  - until: now

Returns (total: 12):
  - calendar.event.*: 3 events (2 updated, 1 created)
  - tasks.task.*: 3 events (all completed)
  - system.trigger.fired: 1 event (morning briefing)
```

### Reacting to Calendar Changes

```typescript
// Example: A background task that notifies user of calendar additions
// The calendar sync EMITS events; this task REACTS to them
const notifyCalendarAdditions = async (eventService: EventService, notify: NotifyFn) => {
  const { events } = await eventService.eventsSinceCheckpoint('calendar-addition-notifier', {
    types: ['calendar.event.created'],
  });

  if (events.length > 0) {
    const summaries = events.map(e => e.data.title).join(', ');
    await notify(`${events.length} new calendar events: ${summaries}`);

    // Update checkpoint
    const lastEvent = events[events.length - 1];
    await eventService.setCheckpoint('calendar-addition-notifier', lastEvent.id);
  }
};
```

**Important:** The calendar sync service is the **producer** of events. It fetches from external calendars, updates the local database, and then emits events. Other systems are **consumers** that react to those events. The event log is not an intermediary in the sync pipeline.

---

## Configuration

```typescript
type EventLogConfig = {
  // Retention
  retentionDays: number;                // Default: 30

  // Deduplication
  dedupeWindowSeconds: number;          // For hash-based dedupe (default: 300)

  // Query limits
  defaultQueryLimit: number;            // Default: 100
  maxQueryLimit: number;                // Default: 1000

  // Cleanup
  cleanupIntervalHours: number;         // Default: 24
};
```

---

## Error Handling

### Event Emission

- **Duplicate events**: Silently ignored (idempotent)
- **Invalid category/type**: Validation error, event not stored
- **Database errors**: Logged, may retry

### Event Queries

- **Invalid filters**: Validation error with helpful message
- **Large result sets**: Pagination enforced, hasMore indicator
- **Missing checkpoint**: Returns all events (first run behavior)

---

## Testing Strategy

### Unit Tests

- Event schema validation
- Deduplication logic
- Query filter building
- Checkpoint management

### Integration Tests

- Event emission and retrieval
- Category/type filtering
- Time range queries
- Checkpoint-based queries
- Retention cleanup

### Flow Tests

- Service emits event, agent queries it
- Background task processes events with checkpoint
- Multiple sources emit, unified query returns all
- Deduplication prevents duplicates

---

## Implementation Phases

### Phase 1: Core Infrastructure

- [x] Event schemas and types (`src/events/events.schemas.ts`)
- [x] Database migration (`src/database/migrations/023_events.ts`)
- [x] EventStore with CRUD operations (`src/events/events.store.ts`)
- [x] EventService with emit and query (`src/events/events.ts`)

### Phase 2: Query & Checkpointing

- [x] Query filtering (time range, type with wildcards, entity)
- [x] Pagination support
- [x] Checkpoint table and management
- [x] `eventsSinceCheckpoint` method

### Phase 3: Source Integration

- [x] CalendarService event emission
- [x] TaskService event emission
- [x] LocationService event emission
- [x] TriggerService event emission

### Phase 4: Agent Tools

- [x] `query_events` tool
- [x] `get_recent_changes` tool
- [x] `get_event` tool (bonus)
- [x] Tool registration and documentation

### Phase 5: Maintenance

- [x] Retention configuration (30-day default, configurable)
- [x] Cleanup tool (`events.cleanup`) for agent-triggered maintenance
- [x] Stats tool (`events.stats`) for monitoring
- [x] Deduplication by content hash (5-minute window)

### Phase 6: Context Integration

- [x] Add recent events to context builder (`recentActivity` field)
- [x] Checkpoint infrastructure for background tasks (already in EventService)
- [x] Event tools available for daily briefing triggers

---

## Migration Path

The Event Log is additive infrastructure and doesn't replace existing systems. It provides a unified view of changes for downstream consumers.

**What it enables:**
1. **Simplified context building**: Query recent events instead of polling each service
2. **Episodic awareness**: Agent can answer "what happened while I was away?"
3. **Reactive triggers** (future): Fire triggers on event patterns, not just time

**What it does NOT replace:**
- Services still own their data and sync logic
- Services emit events after operations, not as part of them
- The event log is read-only for consumers (only producers write)

---

## Open Questions

1. **Event granularity**: Should every field change be an event, or only significant changes? Current design: significant changes only, determined by source service.

2. **Backfill**: Should we emit events for historical data? Current design: no, events start from when the system is enabled.

3. **Event ordering**: ULID provides rough ordering but not strict. Is this sufficient? Current design: yes, for our use cases.

4. **Subscription system**: Should v1 include event subscriptions for reactive triggers? Current design: deferred to future version.
