# Trigger Continuation Context Specification

> Stateful triggers through continuation context

**Version**: 1.0
**Status**: Implemented
**Dependencies**: Trigger System (spec/003-triggers.md)

## Overview

Currently, trigger invocations are stateless - each invocation runs independently with no knowledge of previous runs. This spec introduces **continuation context**: a plain text note that the agent writes at the end of each invocation to inform its future self.

### Problem

Without state, triggers cannot:

- Remember what they've already notified the user about
- Track changes over time (only notify when something _changes_)
- Build up knowledge across invocations
- Avoid redundant notifications

**Example**: A train delay monitor running hourly:

1. **Hour 1**: Sees 15-minute delay → notifies user
2. **Hour 2**: Same 15-minute delay → notifies again (redundant!)
3. **Hour 3**: Delay resolved → doesn't know to notify about resolution

With continuation context:

1. **Hour 1**: Sees delay → notifies user → writes "Notified user about 15-minute delay on the 8:30 train"
2. **Hour 2**: Same delay → reads note → skips (already notified)
3. **Hour 3**: Resolved → reads note → notifies about resolution → writes "Delay resolved, notified user"

### Goals

1. **Simple State Persistence**: A plain text note that persists between invocations
2. **Agent-Controlled**: The agent writes whatever is useful for continuity
3. **Natural Language**: No structured schema - just a note to future self
4. **Minimal Schema Change**: Single text field addition to existing trigger table

### Non-Goals

- Complex state machines or workflows (use delegated tasks for that)
- Structured data or JSON schemas
- Version history of continuation context
- Size limits or quotas (keep simple for v1)

---

## Data Model

### Schema Changes

Add two fields to the `triggers` table:

```sql
ALTER TABLE triggers ADD COLUMN continuation TEXT;
ALTER TABLE triggers ADD COLUMN continuation_updated_at TEXT;
```

The `continuation` field stores the agent's plain text note. The `continuation_updated_at` field stores the ISO8601 timestamp of when the continuation was last updated, helping the agent understand how fresh the information is.

### TypeScript Types

```typescript
// Extended Trigger type (additions to existing schema)
type Trigger = {
  // ... existing fields from spec/003-triggers.md ...

  continuation: string | null;          // Plain text note from last invocation
  continuationUpdatedAt: string | null; // ISO8601 timestamp of when continuation was updated
};
```

### Update Trigger Input

```typescript
type UpdateTriggerInput = {
  // ... existing fields ...

  continuation?: string | null; // Set the continuation note (null to clear)
};
```

---

## Agent Integration

### Context Injection

When a trigger fires, the continuation note is included in the agent's system prompt:

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
    continuation: string | null;         // Note from previous invocation
    continuationUpdatedAt: string | null; // When the note was written
  };
  instructions: `You are running from a scheduled trigger. The user will not see
    this conversation directly.

    Your goal: ${trigger.goal}
    ${trigger.setupContext ? `Context: ${trigger.setupContext}` : ''}
    ${trigger.continuation ? `

    Note from your previous invocation (written ${formatRelativeTime(trigger.continuationUpdatedAt)}):
    "${trigger.continuation}"
    ` : ''}

    If you discover something the user should know, use the notify tool.

    Before completing, use update_trigger with a "continuation" note for your
    next invocation. This helps you remember what you've already reported and
    only notify about changes. Write it like a note to your future self.

    If this trigger is no longer needed, use delete_trigger (no ID needed).
    If the trigger parameters need adjustment, use update_trigger (no ID needed).`;
};
```

### Tool Changes

The existing `update_trigger` tool is extended to support the continuation note:

```typescript
type UpdateTriggerTool = {
  name: 'update_trigger';
  description: `Update a trigger's configuration or state.

    When running from a trigger invocation, omit triggerId to update the trigger that
    invoked this conversation.

    Use "continuation" to leave a note for your next invocation. Write it like a
    message to your future self - what did you find? What did you notify the user
    about? This helps avoid redundant notifications and track changes over time.

    Use status='paused' to temporarily disable a trigger.
    Use status='active' to resume a paused trigger.`;

  parameters: {
    triggerId?: string;
    name?: string;
    goal?: string;
    schedule?: TriggerSchedule;
    setupContext?: string;
    maxInvocations?: number;
    endsAt?: string;
    status?: 'active' | 'paused';
    continuation?: string | null; // NEW: Note for next invocation (null to clear)
  };
};
```

---

## Usage Patterns

### Pattern 1: Change Detection

Only notify when a value changes from the last known state.

```
Goal: "Check train status and notify me of delays"

Invocation 1:
  - Checks train API: 15 min delay
  - No previous continuation
  - Notifies user: "Train delayed 15 minutes"
  - Writes continuation: "Notified user about 15-minute delay on the 8:30 Northern line train."

Invocation 2:
  - Checks train API: 15 min delay
  - Reads continuation: already notified about 15-min delay
  - Same delay, skips notification
  - Writes continuation: "Still a 15-minute delay on 8:30 Northern line. Already notified, no action taken."

Invocation 3:
  - Checks train API: no delay
  - Reads continuation: was tracking 15-min delay
  - Delay resolved! Notifies user: "Good news - the Northern line delay has cleared"
  - Writes continuation: "Delays cleared. Notified user that service is back to normal."
```

### Pattern 2: Threshold Tracking

Track a metric and only alert when it crosses thresholds.

```
Goal: "Monitor my portfolio and alert on significant changes (>5%)"

Invocation 1:
  - Checks portfolio: $50,000
  - No previous continuation
  - Writes continuation: "Portfolio at $50,000. This is the baseline."

Invocation 2:
  - Checks portfolio: $51,200 (+2.4%)
  - Reads continuation: baseline was $50k
  - Change under 5%, no alert
  - Writes continuation: "Portfolio at $51,200. Up 2.4% from $50k baseline. No alert sent."

Invocation 3:
  - Checks portfolio: $46,000 (-8%)
  - Reads continuation: baseline was $50k
  - Down 8%! Notifies user
  - Writes continuation: "Portfolio dropped to $46,000 (-8%). Alerted user. New baseline for alerts: $46,000."
```

### Pattern 3: Accumulation

Build up information across multiple runs.

```
Goal: "Compile a weekly summary of interesting tech news"

Monday:
  - Finds 2 interesting articles
  - Writes continuation: "Week of Jan 15. Found: (1) Apple Vision Pro launch details, (2) OpenAI board changes."

Tuesday:
  - Finds 1 article
  - Reads previous items
  - Writes continuation: "Week of Jan 15. Found: (1) Apple Vision Pro launch, (2) OpenAI board changes, (3) EU AI Act passed."

Friday (summary trigger):
  - Reads accumulated items
  - Sends digest to user
  - Writes continuation: "Sent weekly digest for Jan 15-19. Starting fresh next week."
```

### Pattern 4: Retry Tracking

Track failed operations for context on retry.

```
Goal: "Generate and send daily analytics report"

Invocation 1:
  - Generates report successfully
  - Email fails: SMTP timeout
  - Writes continuation: "Report for Jan 15 generated but email failed (SMTP timeout). Report saved locally. Need to retry send."

Invocation 2:
  - Reads continuation: knows report exists, just needs sending
  - Retries email send
  - Success!
  - Writes continuation: "Jan 15 report sent successfully on second attempt."
```

---

## Implementation

### Database Migration

```typescript
// src/database/migrations/014_trigger_continuation.ts
import type { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.alterTable('triggers', (table) => {
    table.text('continuation').nullable();
    table.text('continuation_updated_at').nullable();
  });
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.alterTable('triggers', (table) => {
    table.dropColumn('continuation_updated_at');
    table.dropColumn('continuation');
  });
};
```

### Store Changes

```typescript
// In triggers.store.ts

// Serialization
const toRow = (trigger: Trigger): TriggerRow => ({
  // ... existing fields ...
  continuation: trigger.continuation,
  continuation_updated_at: trigger.continuationUpdatedAt,
});

// Deserialization
const fromRow = (row: TriggerRow): Trigger => ({
  // ... existing fields ...
  continuation: row.continuation ?? null,
  continuationUpdatedAt: row.continuation_updated_at ?? null,
});
```

### Service Changes

```typescript
// In triggers.store.ts - updateTrigger handles timestamp automatically

if (updates.continuation !== undefined) {
  updateData.continuation = updates.continuation;
  // Update timestamp when continuation changes (including clearing)
  updateData.continuation_updated_at = updates.continuation === null ? null : timestamp;
}

// In triggers.ts - #fire includes continuation in agent invocation

const triggerContext: TriggerContext = {
  triggerId: trigger.id,
  triggerName: trigger.name,
  goal: trigger.goal,
  setupContext: trigger.setupContext,
  invocationCount: trigger.invocationCount + 1,
  schedule: trigger.schedule,
  continuation: trigger.continuation,
  continuationUpdatedAt: trigger.continuationUpdatedAt,
};
```

### Schema Changes

```typescript
// In triggers.schemas.ts

export const triggerSchema = z.object({
  // ... existing fields ...
  continuation: z.string().nullable(),
  continuationUpdatedAt: z.string().nullable(), // ISO8601 timestamp
});

export const triggerContextSchema = z.object({
  // ... existing fields ...
  continuation: z.string().nullable(),
  continuationUpdatedAt: z.string().nullable(),
});

export const updateTriggerInputSchema = z.object({
  // ... existing fields ...
  continuation: z.string().nullish(), // string to set, null to clear, undefined to leave unchanged
  // Note: continuationUpdatedAt is set automatically by the store
});
```

---

## Considerations

### Continuation Size

For v1, no explicit size limit is enforced. The continuation is stored as TEXT in SQLite which can handle large values. Agents should keep notes concise - a few sentences, not pages. If abuse becomes an issue, a future version could add:

- Size limit (e.g., 4KB)
- Truncation warning in agent instructions

### Continuation Lifecycle

- **Created**: When agent first calls `update_trigger` with `continuation`
- **Updated**: On subsequent `update_trigger` calls with `continuation`
- **Cleared**: When agent passes `continuation: null`
- **Preserved**: When trigger is paused/resumed (continuation persists)
- **Deleted**: When trigger is deleted (continuation deleted with trigger)

### Debugging

The continuation should be visible when inspecting triggers:

```bash
# List triggers with their continuation notes
pnpm triggers list --show-continuation

# View specific trigger's full state
pnpm triggers show <trigger-id>
```

The conversation debug tools should also show what continuation was available at invocation time.

---

## Testing Strategy

### Unit Tests

- Update with continuation
- Update with null clears continuation
- Continuation preserved across pause/resume

### Integration Tests

- Trigger fires with continuation in agent prompt
- Agent updates continuation via update_trigger tool
- Continuation persists to next invocation
- Continuation cleared with null

### Flow Tests

1. **Change Detection Flow**
   - Create trigger with hourly schedule
   - First invocation: detect condition, notify, write continuation
   - Second invocation: same condition, read continuation, skip notification
   - Third invocation: condition changed, notify, update continuation

2. **Continuation Reset Flow**
   - Trigger accumulates notes over multiple runs
   - Agent decides to clear and start fresh
   - Next invocation starts with no continuation

---

## Implementation Phases

### Phase 1: Core Infrastructure

- [x] Database migration for `continuation` column
- [x] Schema updates (triggerSchema, updateTriggerInputSchema)
- [x] Store changes

### Phase 2: Service Integration

- [x] TriggerService.update handles continuation
- [x] TriggerService.#fire includes continuation in trigger context
- [x] Tool definition updated with continuation parameter

### Phase 3: Agent Instructions

- [x] Update trigger context system prompt with continuation guidance
- [x] Test agent understanding and usage

### Phase 4: Debugging Support

- [x] CLI commands to view trigger continuation
- [x] Continuation included in conversation debug output
- [x] Documentation updates

---

## Open Questions

1. **Should continuation updates be atomic with conversation completion?**
   If agent updates continuation but conversation fails, should it be rolled back?
   Decision: No transaction needed for v1. Continuation updates take effect immediately.

2. **Should we track continuation history?**
   Could be useful for debugging to see how continuations evolved.
   Decision: Not for v1. Keep it simple - just the current note.
