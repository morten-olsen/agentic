# Trigger System

The Trigger System enables agents to schedule future invocations of themselves. When a trigger fires, the system invokes the agent in the background with a predefined goal. The agent can notify the user via Telegram if it discovers something relevant.

## Overview

### What is a Trigger?

A trigger is a scheduled invocation consisting of:

- **Name**: Human-readable identifier
- **Goal**: What the agent should accomplish when invoked
- **Schedule**: When to fire (one-time datetime or recurring cron)
- **Continuation**: Optional note from the previous invocation for state tracking

### Why Triggers?

1. **Proactive Assistance**: Monitor conditions and alert users without manual checking
2. **Scheduled Tasks**: Run reports, summaries, or checks at specific times
3. **Stateful Monitoring**: Track changes over time with continuation context
4. **Self-Management**: Agents can update or delete their own triggers

## Schedule Types

### One-Time Triggers

Fire once at a specific datetime:

```typescript
{
  type: 'once',
  at: '2024-03-15T09:00:00Z'  // ISO8601 datetime
}
```

After firing, one-time triggers are marked as `completed`.

### Recurring Triggers (Cron)

Fire repeatedly according to a cron expression:

```typescript
{
  type: 'cron',
  expression: '0 9 * * 1-5'  // Weekdays at 9 AM
}
```

Cron format: `minute hour day-of-month month day-of-week`

| Expression | Description |
|------------|-------------|
| `0 9 * * *` | Every day at 9:00 AM |
| `0 9 * * 1-5` | Weekdays at 9:00 AM |
| `*/15 * * * *` | Every 15 minutes |
| `0 8,12,18 * * *` | At 8 AM, 12 PM, and 6 PM |
| `0 0 1 * *` | First day of each month at midnight |

Times are interpreted in the user's timezone.

## Agent Tools

### `create_trigger`

Creates a new scheduled trigger.

**Input**:
```typescript
{
  name: string;           // Human-readable name
  goal: string;           // What the agent should accomplish
  schedule: {
    type: 'once' | 'cron';
    at?: string;          // ISO8601 for 'once'
    expression?: string;  // Cron for 'cron'
  };
  setupContext?: string;  // Why this trigger exists (for agent context)
  maxInvocations?: number; // For recurring: stop after N times
  endsAt?: string;        // For recurring: stop after this datetime
}
```

**Output**:
```typescript
{
  triggerId: string;
  nextInvocationAt: string;
}
```

### `update_trigger`

Updates an existing trigger. When running from a trigger invocation, the agent can update its own trigger without specifying the ID.

**Input**:
```typescript
{
  triggerId?: string;     // Optional when invoked by a trigger
  name?: string;
  goal?: string;
  schedule?: TriggerSchedule;
  setupContext?: string;
  maxInvocations?: number;
  endsAt?: string;
  status?: 'active' | 'paused';
  continuation?: string | null;  // Note for next invocation
}
```

### `delete_trigger`

Deletes a trigger permanently. When running from a trigger invocation, the agent can delete its own trigger without specifying the ID.

**Input**:
```typescript
{
  triggerId?: string;     // Optional when invoked by a trigger
}
```

### `list_triggers`

Lists triggers, optionally filtered by status.

**Input**:
```typescript
{
  status?: 'active' | 'paused' | 'completed' | 'failed';
  limit?: number;         // Default 50
}
```

### `notify`

Sends a notification to the user via Telegram. Only available in trigger-invoked sessions.

**Input**:
```typescript
{
  title: string;          // Short title (max 100 chars)
  body: string;           // Notification content (max 1000 chars)
  urgency?: 'low' | 'medium' | 'high' | 'critical';
}
```

## Trigger-Invoked Sessions

When a trigger fires, it creates a background agent session. The user does not see this conversation directly - the agent must use the `notify` tool to communicate.

### Context Injection

The agent receives trigger context in its system prompt:

```
You are running from a scheduled trigger. The user will not see
this conversation directly.

Your goal: [trigger.goal]
Context: [trigger.setupContext]

Note from your previous invocation (written 2 hours ago):
"[trigger.continuation]"

If you discover something the user should know, use the notify tool.
Before completing, use update_trigger with a "continuation" note for your
next invocation.
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

## Continuation Context

Continuation context allows triggers to maintain state across invocations. The agent writes a note at the end of each run to inform its future self.

### Why Continuation?

Without state, triggers cannot:

- Remember what they've already notified the user about
- Track changes over time (only notify when something changes)
- Build up knowledge across invocations
- Avoid redundant notifications

### Usage Patterns

#### Change Detection

```
Invocation 1:
  - Checks train API: 15 min delay
  - Notifies user: "Train delayed 15 minutes"
  - Writes continuation: "Notified about 15-minute delay on 8:30 train"

Invocation 2:
  - Same delay, reads continuation
  - Skips notification (already notified)
  - Writes: "Still 15-minute delay. Already notified."

Invocation 3:
  - Delay resolved, reads continuation
  - Notifies: "Good news - delay has cleared"
  - Writes: "Delays cleared. Notified user."
```

#### Threshold Tracking

```
Invocation 1:
  - Portfolio at $50,000
  - Writes: "Portfolio at $50,000. Baseline established."

Invocation 2:
  - Portfolio at $51,200 (+2.4%)
  - Under 5% threshold, no alert
  - Writes: "Portfolio at $51,200. Up 2.4%, no alert sent."

Invocation 3:
  - Portfolio at $46,000 (-8%)
  - Over threshold, alerts user
  - Writes: "Portfolio dropped to $46,000 (-8%). Alerted user."
```

#### Accumulation

```
Monday:
  - Finds 2 interesting articles
  - Writes: "Week of Jan 15. Found: (1) Apple Vision Pro, (2) OpenAI changes."

Tuesday:
  - Finds 1 more article
  - Writes: "Week of Jan 15. Found: (1) Apple Vision Pro, (2) OpenAI, (3) EU AI Act."

Friday:
  - Sends weekly digest
  - Writes: "Sent digest for Jan 15-19. Starting fresh next week."
```

## Trigger Status

| Status | Description |
|--------|-------------|
| `active` | Trigger is scheduled and will fire |
| `paused` | Temporarily disabled, can be resumed |
| `completed` | One-time trigger has fired, or limits reached |
| `failed` | Multiple consecutive failures |

## Error Handling

### Invocation Failures

1. Error logged with full context
2. `lastError` set on trigger
3. For recurring triggers: continue scheduling
4. After 3 consecutive failures: status set to `failed`, user notified

### Notification Failures

1. Error logged
2. Delivery failure recorded
3. Agent continues execution (notification is best-effort)

## Configuration

```typescript
type TriggerConfig = {
  catchUpMissed: boolean;         // Fire missed triggers on startup (default: true)
  maxCatchUpAge: number;          // Max age in ms for catch-up (default: 1 hour)
  maxConsecutiveFailures: number; // Before marking failed (default: 3)
  maxTriggersPerUser: number;     // Prevent runaway creation (default: 100)
  minIntervalSeconds: number;     // Minimum cron interval (default: 60)
};
```

## Database Schema

### Triggers Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | Primary key |
| `name` | TEXT | Human-readable name |
| `goal` | TEXT | What the agent should do |
| `schedule_type` | TEXT | 'once' or 'cron' |
| `schedule_value` | TEXT | ISO8601 or cron expression |
| `status` | TEXT | 'active', 'paused', 'completed', 'failed' |
| `invocation_count` | INTEGER | Number of times fired |
| `last_invoked_at` | TEXT | Last fire time |
| `next_invocation_at` | TEXT | Calculated next fire time |
| `continuation` | TEXT | State note from last invocation |
| `continuation_updated_at` | TEXT | When continuation was last updated |

### Trigger-Conversation Junction

Tracks which conversations were created by which triggers:

| Column | Type | Description |
|--------|------|-------------|
| `trigger_id` | TEXT | FK to triggers |
| `conversation_id` | TEXT | FK to conversations |
| `invoked_at` | TEXT | When the trigger fired |

## Usage Examples

### Creating a Daily Briefing

```
User: Set up a daily briefing for weekday mornings

Agent: [Calls create_trigger]
  name: "Daily Briefing"
  goal: "Provide a morning briefing covering calendar, weather, and news"
  schedule: { type: "cron", expression: "0 8 * * 1-5" }
  setupContext: "User wants weekday morning briefings at 8 AM"
```

### Monitoring Something

```
User: Monitor the Apple stock price and alert me if it drops more than 5%

Agent: [Calls create_trigger]
  name: "Apple Stock Monitor"
  goal: "Check Apple stock price and notify if it drops more than 5% from baseline"
  schedule: { type: "cron", expression: "0 * * * *" }  // Hourly
  setupContext: "Alert threshold is 5% drop. User wants to track significant declines."
```

### One-Time Reminder

```
User: Remind me to call Mom on Sunday at 3pm

Agent: [Calls create_trigger]
  name: "Call Mom Reminder"
  goal: "Remind user to call their mother"
  schedule: { type: "once", at: "2024-03-17T15:00:00" }
```

## Querying Trigger History

Users can ask about trigger-related conversations:

```
User: Show me the conversations from my daily briefing trigger
User: What happened the last time the reminder trigger ran?
```

The orchestrator can query conversations by trigger ID to answer these.
