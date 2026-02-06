# Trigger System Specification (v2)

> Agent-managed scheduled invocations

**Version**: 2.0
**Status**: Implemented
**Replaces**: ProactiveScheduler, ProactiveChecks

## Overview

The trigger system enables agents to schedule future invocations of themselves. When a trigger fires, the system invokes the agent in the background with a predefined goal. The agent can notify the user via Telegram if it discovers something relevant.

### Goals

1. **Agent-Managed**: Agents create, update, pause, and delete their own triggers
2. **Reliable Scheduling**: In-memory scheduling for precision, DB for persistence
3. **Two Schedule Types**: One-time (datetime) and recurring (cron)
4. **Background Execution**: Trigger-invoked agents run without user interaction, notifying when relevant
5. **Simple Notifications**: Telegram-only for v1, no attention budget complexity

### Non-Goals (for v2)

- Spatial triggers (location-based) - requires location tracking infrastructure
- External triggers (email arrives, webhook received) - requires event ingress
- Cascading triggers (trigger A schedules trigger B)
- Multi-channel notification routing
- Attention budget / interruption limiting

### Future Considerations

The following are documented in `spec/notifications-future.md` for later implementation:
- Attention budget and interruption limits
- Multi-channel notifications (email, SMS, Slack, webhook)
- Smart routing based on urgency and user state
- Quiet hours and focus blocks

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Trigger System                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│   ┌───────────────┐                    ┌───────────────────┐        │
│   │ Agent (tools) │                    │   TriggerService  │        │
│   │               │───create/update───▶│                   │        │
│   │ - createTrig  │                    │ - In-memory queue │        │
│   │ - updateTrig  │◀──self-reference──│ - DB persistence  │        │
│   │ - deleteTrig  │                    │ - Schedule calc   │        │
│   │ - listTrigs   │                    └─────────┬─────────┘        │
│   └───────────────┘                              │                   │
│                                                   │ fires             │
│                                                   ▼                   │
│                                         ┌─────────────────┐          │
│                                         │  Orchestrator   │          │
│                                         │                 │          │
│                                         │ - New convo     │          │
│                                         │ - Goal from     │          │
│                                         │   trigger       │          │
│                                         │ - Background    │          │
│                                         │   mode          │          │
│                                         └────────┬────────┘          │
│                                                  │                    │
│                                                  ▼                    │
│                                         ┌─────────────────┐          │
│                                         │  Background     │          │
│                                         │  Agent Run      │──────┐   │
│                                         │                 │      │   │
│                                         │ - Execute goal  │      ▼   │
│                                         │ - Manage self   │  ┌───────┐│
│                                         │ - Notify user   │  │Notify ││
│                                         └─────────────────┘  │(Tgram)││
│                                                              └───────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **In-Memory Scheduling**: Triggers are loaded into memory at startup and managed with precise timers. The database is the source of truth for persistence across restarts.

2. **Agent Self-Reference**: The trigger definition is included in the agent's context so it can update/delete itself without needing the ID.

3. **Replaces ProactiveScheduler**: The old system of "checks" that inspect state is replaced by agent invocations with specific goals. Built-in checks become pre-installed triggers.

4. **Conversation Tracking**: Each trigger invocation creates a conversation. Triggers track their associated conversations for debugging and user queries.

---

## Data Model

### Trigger Schema

```typescript
type TriggerSchedule =
  | { type: 'once'; at: string }           // ISO8601 datetime
  | { type: 'cron'; expression: string };  // Standard cron (user's timezone)

type TriggerStatus = 'active' | 'paused' | 'completed' | 'failed';

type Trigger = {
  id: string;
  name: string;                           // Human-readable identifier
  goal: string;                           // What the agent should accomplish
  schedule: TriggerSchedule;

  // Optional configuration
  modelTier?: 'fast' | 'balanced' | 'capable' | 'premium';
  setupContext?: string;                  // Why this trigger was created

  // Limits (for recurring triggers)
  maxInvocations?: number;                // Stop after N invocations
  endsAt?: string;                        // ISO8601 - stop after this time

  // State
  status: TriggerStatus;
  invocationCount: number;
  lastInvokedAt?: string;                 // ISO8601
  nextInvocationAt?: string;              // ISO8601 (calculated)
  lastError?: string;                     // If status is 'failed'

  // Relationships
  createdByConversationId?: string;       // Conversation that created this
  conversationIds: string[];              // Conversations created by this trigger

  // Timestamps
  createdAt: string;
  updatedAt: string;
};
```

### Create Trigger Input

```typescript
type CreateTriggerInput = {
  name: string;
  goal: string;
  schedule: TriggerSchedule;
  modelTier?: 'fast' | 'balanced' | 'capable' | 'premium';
  setupContext?: string;
  maxInvocations?: number;
  endsAt?: string;
};
```

### Update Trigger Input

```typescript
type UpdateTriggerInput = {
  name?: string;
  goal?: string;
  schedule?: TriggerSchedule;
  modelTier?: 'fast' | 'balanced' | 'capable' | 'premium';
  setupContext?: string;
  maxInvocations?: number;
  endsAt?: string;
  status?: 'active' | 'paused';           // Can pause/resume
};
```

---

## Database Schema

### Migration: `xxx_triggers.ts`

```sql
CREATE TABLE triggers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  goal TEXT NOT NULL,
  schedule_type TEXT NOT NULL,            -- 'once' | 'cron'
  schedule_value TEXT NOT NULL,           -- ISO8601 or cron expression
  model_tier TEXT,
  setup_context TEXT,
  max_invocations INTEGER,
  ends_at TEXT,

  -- State
  status TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'paused' | 'completed' | 'failed'
  invocation_count INTEGER NOT NULL DEFAULT 0,
  last_invoked_at TEXT,
  next_invocation_at TEXT,
  last_error TEXT,

  -- Relationships
  created_by_conversation_id TEXT REFERENCES conversations(id),

  -- Timestamps
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_triggers_status ON triggers(status);
CREATE INDEX idx_triggers_next_invocation ON triggers(next_invocation_at);
CREATE INDEX idx_triggers_created_by ON triggers(created_by_conversation_id);
```

### Trigger-Conversation Junction

```sql
CREATE TABLE trigger_conversations (
  trigger_id TEXT NOT NULL REFERENCES triggers(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  invoked_at TEXT NOT NULL,
  PRIMARY KEY (trigger_id, conversation_id)
);

CREATE INDEX idx_trigger_conversations_trigger ON trigger_conversations(trigger_id);
CREATE INDEX idx_trigger_conversations_conversation ON trigger_conversations(conversation_id);
```

---

## Agent Tools

### create_trigger

Creates a new trigger for future agent invocation.

```typescript
type CreateTriggerTool = {
  name: 'create_trigger';
  description: `Create a scheduled trigger that will invoke the agent at a specified time.

    For one-time triggers, provide schedule.type='once' with an ISO8601 datetime.
    For recurring triggers, provide schedule.type='cron' with a cron expression.

    Cron format: minute hour day-of-month month day-of-week
    Examples:
      - "0 9 * * *" = Every day at 9:00 AM
      - "0 9 * * 1-5" = Weekdays at 9:00 AM
      - "*/15 * * * *" = Every 15 minutes
      - "0 8,12,18 * * *" = At 8 AM, 12 PM, and 6 PM

    Times are in the user's timezone.`;

  parameters: {
    name: string;           // Human-readable name
    goal: string;           // What the agent should accomplish when invoked
    schedule: {
      type: 'once' | 'cron';
      at?: string;          // ISO8601 for 'once'
      expression?: string;  // Cron for 'cron'
    };
    setupContext?: string;  // Why this trigger is being created (for agent context)
    maxInvocations?: number; // For recurring: stop after N times
    endsAt?: string;        // For recurring: stop after this datetime
  };

  returns: {
    triggerId: string;
    nextInvocationAt: string;
  };
};
```

### update_trigger

Updates an existing trigger. When running from a trigger invocation, the agent can update its own trigger without specifying the ID.

```typescript
type UpdateTriggerTool = {
  name: 'update_trigger';
  description: `Update a trigger's configuration.

    When running from a trigger invocation, omit triggerId to update the trigger that
    invoked this conversation. When called from a user conversation, triggerId is required.

    Use status='paused' to temporarily disable a trigger.
    Use status='active' to resume a paused trigger.`;

  parameters: {
    triggerId?: string;     // Optional when invoked by a trigger
    name?: string;
    goal?: string;
    schedule?: {
      type: 'once' | 'cron';
      at?: string;
      expression?: string;
    };
    setupContext?: string;
    maxInvocations?: number;
    endsAt?: string;
    status?: 'active' | 'paused';
  };

  returns: {
    trigger: Trigger;
  };
};
```

### delete_trigger

Deletes a trigger. When running from a trigger invocation, the agent can delete its own trigger without specifying the ID.

```typescript
type DeleteTriggerTool = {
  name: 'delete_trigger';
  description: `Delete a trigger permanently.

    When running from a trigger invocation, omit triggerId to delete the trigger that
    invoked this conversation. When called from a user conversation, triggerId is required.`;

  parameters: {
    triggerId?: string;     // Optional when invoked by a trigger
  };

  returns: {
    deleted: boolean;
  };
};
```

### list_triggers

Lists triggers, optionally filtered by status.

```typescript
type ListTriggersTool = {
  name: 'list_triggers';
  description: 'List all triggers or filter by status.';

  parameters: {
    status?: 'active' | 'paused' | 'completed' | 'failed';
    limit?: number;         // Default 50
  };

  returns: {
    triggers: Trigger[];
  };
};
```

### notify

Sends a notification to the user via Telegram. Only available in trigger-invoked sessions.

```typescript
type NotifyTool = {
  name: 'notify';
  description: `Send a notification to the user via Telegram.

    Use this when you have completed a background task and have information
    the user should know about. Keep notifications concise and actionable.

    This tool is only available when running from a trigger invocation (not in
    user-initiated conversations, where you can respond directly).`;

  parameters: {
    title: string;          // Short title (max 100 chars)
    body: string;           // Notification content (max 1000 chars)
    urgency?: 'low' | 'medium' | 'high' | 'critical'; // Default 'medium'
  };

  returns: {
    notificationId: string;
    delivered: boolean;
  };
};
```

---

## TriggerService

### Responsibilities

1. **CRUD Operations**: Create, read, update, delete triggers
2. **Schedule Management**: Calculate next invocation times, manage in-memory timers
3. **Invocation**: Fire triggers by invoking the orchestrator with the trigger's goal
4. **Lifecycle**: Handle completion (one-time, max invocations reached, end date passed)
5. **Persistence**: Sync state to database for restart recovery

### Interface

```typescript
class TriggerService {
  constructor(deps: {
    db: Knex;
    orchestrator: OrchestratorService;
    userModel: UserModelService;        // For timezone
    telegramClient?: TelegramClientService; // For notifications
  });

  // Lifecycle
  start(): Promise<void>;               // Load triggers, start scheduling
  stop(): Promise<void>;                // Cancel all timers

  // CRUD
  create(input: CreateTriggerInput, conversationId?: string): Promise<Trigger>;
  get(id: string): Promise<Trigger | null>;
  update(id: string, input: UpdateTriggerInput): Promise<Trigger>;
  delete(id: string): Promise<void>;
  list(filter?: { status?: TriggerStatus }): Promise<Trigger[]>;

  // Queries
  getByConversation(conversationId: string): Promise<Trigger | null>;
  getConversationsForTrigger(triggerId: string): Promise<string[]>;

  // Internal
  #scheduleNext(trigger: Trigger): void;
  #fire(trigger: Trigger): Promise<void>;
  #calculateNextInvocation(trigger: Trigger): Date | null;
}
```

### Scheduling Algorithm

```
On service start:
  1. Load all triggers with status='active' from DB
  2. For each trigger:
     a. Calculate next invocation time
     b. If in the past, fire immediately (catch-up)
     c. If in the future, schedule timer

On trigger create/update:
  1. Cancel existing timer if any
  2. Calculate next invocation time
  3. Schedule timer

On timer fire:
  1. Update lastInvokedAt, invocationCount
  2. Check if completed (one-time, max reached, end date passed)
  3. If completed, set status='completed'
  4. If not completed, schedule next invocation
  5. Invoke orchestrator with trigger context
```

### Next Invocation Calculation

For `once` triggers:
```
nextInvocation = schedule.at (if in future, else null)
```

For `cron` triggers:
```
nextInvocation = next matching time from cron expression
                 (using user's timezone from UserModel)

If nextInvocation > endsAt: return null
If invocationCount >= maxInvocations: return null
```

---

## Trigger-Invoked Sessions

When a trigger fires, it creates a background agent session. The user does not see this conversation directly - the agent must use the `notify` tool to communicate with the user.

### Agent Context

The agent receives trigger context in its system prompt:

```typescript
type TriggerContext = {
  mode: 'trigger';
  trigger: {
    id: string;
    name: string;
    goal: string;
    setupContext?: string;
    invocationCount: number;
    schedule: TriggerSchedule;
  };
  instructions: `You are running from a scheduled trigger. The user will not see
    this conversation directly.

    Your goal: ${trigger.goal}
    ${trigger.setupContext ? `Context: ${trigger.setupContext}` : ''}

    If you discover something the user should know, use the notify tool.
    If this trigger is no longer needed, use delete_trigger (no ID needed).
    If the trigger parameters need adjustment, use update_trigger (no ID needed).

    You have access to all normal tools plus trigger management and notify tools.`;
};
```

### Tool Availability

| Tool | User Conversation | Trigger Invocation |
|------|-------------------|-------------------|
| All normal tools | Yes | Yes |
| create_trigger | Yes | Yes |
| update_trigger | Yes (requires ID) | Yes (ID optional) |
| delete_trigger | Yes (requires ID) | Yes (ID optional) |
| list_triggers | Yes | Yes |
| notify | No (respond directly) | Yes |

### Notification Delivery

In v2, notifications are delivered exclusively via Telegram:

1. Agent calls `notify` tool with title, body, urgency
2. TriggerService formats message for Telegram
3. Message sent to configured owner's Telegram chat
4. Delivery success/failure recorded

If Telegram is not configured or delivery fails, the notification is logged but not retried (simple approach for v1).

---

## Conversation Integration

### Tracking

Every trigger invocation creates a conversation with metadata:

```typescript
// Conversation metadata when created by trigger
{
  triggerId: string;
  triggerName: string;
  invocationNumber: number;
}
```

### Queries

Users can ask about trigger-related conversations:

- "Show me the conversations from my daily briefing trigger"
- "What happened the last time the reminder trigger ran?"

The orchestrator can query conversations by trigger ID to answer these.

---

## Migration from v1

### What's Removed

- `ProactiveScheduler` - Replaced by TriggerService
- `ProactiveCheck` - Replaced by Trigger
- `proactive_checks` table - Replaced by `triggers` table
- `proactive_runs` table - Trigger invocations tracked via conversation junction
- Attention budget - Moved to future spec
- Multi-channel routing - Simplified to Telegram only

### Built-in Triggers

The old built-in checks become pre-installed triggers:

| Old Check | New Trigger |
|-----------|-------------|
| `daily-briefing` | Pre-installed trigger: "0 8 * * 1-5", goal: "Provide daily briefing" |
| `calendar-lookahead` | Pre-installed trigger: "0 * * * *", goal: "Check upcoming calendar" |
| `deadline-reminders` | Integrated into task system (not a separate trigger) |
| `stale-followups` | Pre-installed trigger: "0 9 * * *", goal: "Check stale follow-ups" |
| `deferred-tasks` | Pre-installed trigger: "0 9 * * *", goal: "Review deferred tasks" |

Pre-installed triggers are created on first startup if they don't exist. Users can pause or delete them.

---

## Error Handling

### Invocation Failures

If agent invocation fails:

1. Log the error with full context
2. Set `lastError` on trigger
3. For recurring triggers: continue scheduling (don't fail permanently)
4. If 3 consecutive failures: set status='failed', notify user

### Notification Failures

If Telegram notification fails:

1. Log the error
2. Record delivery failure
3. Don't retry (keep v1 simple)
4. Agent continues execution (notification is best-effort)

---

## Configuration

```typescript
type TriggerConfig = {
  // Startup behavior
  catchUpMissed: boolean;              // Fire missed triggers on startup (default: true)
  maxCatchUpAge: number;               // Max age in ms for catch-up (default: 1 hour)

  // Failure handling
  maxConsecutiveFailures: number;      // Before marking failed (default: 3)

  // Limits
  maxTriggersPerUser: number;          // Prevent runaway creation (default: 100)
  minIntervalSeconds: number;          // Minimum time between cron runs (default: 60)
};
```

---

## Testing Strategy

### Unit Tests

- Schedule parsing (cron expressions, datetime)
- Next invocation calculation
- Status transitions
- Tool parameter validation

### Integration Tests

- Trigger CRUD operations
- Timer firing (with time mocking)
- Orchestrator invocation
- Notification delivery (mocked Telegram)

### Flow Tests

- Create trigger via agent tool
- Trigger fires and invokes agent
- Trigger-invoked agent uses notify
- Agent updates its own trigger
- Agent deletes its own trigger
- Trigger reaches max invocations

---

## Implementation Phases

### Phase 1: Core Infrastructure

- [x] Trigger schemas and types
- [x] Database migration
- [x] TriggerStore (CRUD operations)
- [x] Basic TriggerService (no scheduling)

### Phase 2: Scheduling

- [x] Cron expression parsing
- [x] Next invocation calculation
- [x] In-memory timer management
- [x] Startup loading and catch-up

### Phase 3: Agent Integration

- [x] Trigger tools (create, update, delete, list)
- [x] Trigger context injection
- [x] Self-reference for ID-less updates

### Phase 4: Notifications

- [x] Simplified notify tool
- [x] Telegram delivery
- [x] Basic notification store

### Phase 5: Migration

- [x] Remove ProactiveScheduler
- [x] Create pre-installed triggers
- [x] Update CLI and Telegram entry points

---

## Open Questions

1. **Catch-up behavior**: If server is down and misses a trigger, should it fire immediately on restart? Current design: yes, up to 1 hour old.

2. **Concurrent runs**: If trigger interval is shorter than execution time, what happens? Current design: allow parallel (keep simple).

3. **User-created vs agent-created**: Should there be a distinction? Current design: no, all triggers are equal.
