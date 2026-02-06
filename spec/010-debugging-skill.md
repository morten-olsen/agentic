# Debugging Skill Specification

> Agent-activated capability for system introspection and debugging

**Version**: 1.0
**Status**: In Progress
**Dependencies**: Skills System (Phase 8), Trigger System (Phase 3), Orchestrator

## Overview

The Debugging Skill provides the agent with tools to inspect GLaDOS system state, helping users understand what the system is doing and diagnose issues. When activated, the agent gains read-only access to internal data structures including triggers, conversations, scheduler state, and system health information.

### Goals

1. **System Transparency**: Let users (via the agent) see what's happening inside GLaDOS
2. **Trigger Debugging**: Inspect trigger state, execution history, and scheduling information
3. **Conversation Tracing**: View conversation history and flow for any conversation
4. **Live State Inspection**: See current scheduler state, pending timers, and active processes
5. **Non-Destructive**: All tools are read-only queries, no modification capabilities

### Non-Goals (for v1)

- Modifying triggers or conversations (use existing tools for that)
- Performance profiling or metrics collection
- Log file access or aggregation
- Remote debugging of other instances
- Automated issue detection or alerting

### Use Cases

1. **"Why didn't my trigger run?"** - Inspect trigger state, last invocation, next scheduled time, consecutive failures
2. **"What happened when the trigger ran?"** - View the conversation it created, see tool calls and results
3. **"What triggers are scheduled?"** - List all scheduled timers with their next fire times
4. **"Show me the recent trigger history"** - List recent trigger invocations across all triggers
5. **"Is the system healthy?"** - Check scheduler state, service configuration, active processes

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Debugging Skill                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Activation: Low risk (read-only queries)                          │
│                                                                      │
│   ┌───────────────────────────────────────────────────────────────┐ │
│   │                      Debug Tools                               │ │
│   │                                                                │ │
│   │  Trigger Inspection:                                           │ │
│   │  - debug_list_triggers    (all triggers with full state)      │ │
│   │  - debug_get_trigger      (detailed single trigger view)       │ │
│   │  - debug_trigger_history  (invocation history for a trigger)   │ │
│   │  - debug_scheduler_state  (in-memory timer queue)              │ │
│   │                                                                │ │
│   │  Conversation Inspection:                                      │ │
│   │  - debug_get_conversation (full conversation with messages)    │ │
│   │  - debug_list_conversations (recent conversations)             │ │
│   │                                                                │ │
│   │  System State:                                                 │ │
│   │  - debug_system_health    (service states, configuration)      │ │
│   └───────────────────────────────────────────────────────────────┘ │
│                                                                      │
│   Domain Knowledge:                                                  │
│   - How to interpret trigger states and errors                       │
│   - Understanding conversation flow and tool calls                   │
│   - Scheduler internals and timing behavior                          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Low Activation Risk**: All debugging tools are read-only queries. No user approval required for activation, but activation is logged.

2. **Comprehensive Data**: Unlike normal list tools that return summaries, debug tools return full state including internal fields (consecutive failures, last error, etc.).

3. **Cross-Reference Capability**: Tools are designed to support tracing from trigger → conversation → messages, enabling full investigation flows.

4. **Live Scheduler Access**: Unique access to in-memory scheduler state (scheduled timers, next fire times) not available through normal tools.

---

## Data Model

### Trigger Debug View

Extended trigger information for debugging:

```typescript
type TriggerDebugView = Trigger & {
  // Additional debugging info
  schedulerState: {
    isScheduled: boolean;
    scheduledFireTime?: string;      // When the in-memory timer will fire
    timerDelayMs?: number;           // Milliseconds until next fire
  };
  recentInvocations: Array<{
    conversationId: string;
    invokedAt: string;
    durationMs?: number;             // How long the invocation took
  }>;
};
```

### Conversation Debug View

Full conversation with all messages and related data:

```typescript
type ConversationDebugView = Conversation & {
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'tool';
    content: string;
    toolCallId?: string;
    toolCalls?: unknown;             // Parsed JSON
    inputTokens?: number;
    outputTokens?: number;
    createdAt: string;
  }>;
  trigger?: {
    id: string;
    name: string;
    invocationNumber: number;
  };
  telegramChat?: {
    chatId: number;
    userId: number;
  };
  pendingInterrupts: Array<{
    id: string;
    type: string;
    prompt: string;
    createdAt: string;
  }>;
};
```

### Scheduler State

In-memory scheduler state snapshot:

```typescript
type SchedulerState = {
  running: boolean;
  scheduledCount: number;
  scheduledTriggers: Array<{
    triggerId: string;
    triggerName: string;
    scheduledFireTime: string;
    delayMs: number;
  }>;
};
```

### System Health

System-wide health information:

```typescript
type SystemHealth = {
  services: {
    database: { configured: boolean };
    orchestrator: { configured: boolean };
    triggerService: { configured: boolean; running: boolean; scheduledCount: number };
    telegramClient: { configured: boolean; ownerId?: number };
    externalServices: Array<{ id: string; configured: boolean }>;
  };
  triggers: {
    total: number;
    active: number;
    paused: number;
    completed: number;
    failed: number;
  };
  conversations: {
    total: number;
    recentCount: number;           // Last 24 hours
  };
};
```

---

## Agent Tools

### debug_list_triggers

Lists all triggers with full state information.

```typescript
type DebugListTriggersTool = {
  name: 'debug_list_triggers';
  description: `List all triggers with complete state information for debugging.

    Unlike the normal list_triggers tool, this includes:
    - Internal state (consecutive failures, last error)
    - Scheduler state (is timer scheduled, when will it fire)
    - Recent invocation history

    Use this to get an overview of trigger system health.`;

  parameters: {
    status?: 'active' | 'paused' | 'completed' | 'failed';  // Filter by status
    includeSchedulerState?: boolean;  // Default: true
    limit?: number;                   // Default: 50
  };

  returns: {
    triggers: TriggerDebugView[];
    schedulerRunning: boolean;
    totalScheduled: number;
  };

  risk: {
    level: 'low';
    reason: 'Read-only query of trigger data';
  };
};
```

### debug_get_trigger

Gets detailed information about a single trigger.

```typescript
type DebugGetTriggerTool = {
  name: 'debug_get_trigger';
  description: `Get complete debugging information for a specific trigger.

    Includes:
    - Full trigger configuration and state
    - Scheduler timer state
    - Recent invocation history with conversation IDs
    - Any errors or failure information

    Use this after debug_list_triggers to drill into a specific trigger.`;

  parameters: {
    triggerId?: string;               // Trigger ID
    triggerName?: string;             // Or lookup by name
    includeConversations?: boolean;   // Include conversation summaries, default: true
    conversationLimit?: number;       // How many recent conversations, default: 10
  };

  returns: {
    trigger: TriggerDebugView;
    conversations: Array<{
      id: string;
      invokedAt: string;
      messageCount: number;
      summary?: string;
    }>;
  };

  risk: {
    level: 'low';
    reason: 'Read-only query of trigger data';
  };
};
```

### debug_trigger_history

Gets the invocation history across all or specific triggers.

```typescript
type DebugTriggerHistoryTool = {
  name: 'debug_trigger_history';
  description: `Get recent trigger invocation history.

    Shows when triggers fired, which conversations they created, and whether
    they succeeded or failed. Useful for understanding trigger activity over time.

    Can filter to a specific trigger or show all trigger activity.`;

  parameters: {
    triggerId?: string;               // Optional: filter to specific trigger
    since?: string;                   // ISO8601: only invocations after this time
    limit?: number;                   // Default: 50
  };

  returns: {
    invocations: Array<{
      triggerId: string;
      triggerName: string;
      conversationId: string;
      invokedAt: string;
      invocationNumber: number;
      status: 'success' | 'failed';
      error?: string;
    }>;
  };

  risk: {
    level: 'low';
    reason: 'Read-only query of historical data';
  };
};
```

### debug_scheduler_state

Gets the current in-memory scheduler state.

```typescript
type DebugSchedulerStateTool = {
  name: 'debug_scheduler_state';
  description: `Get the current state of the in-memory trigger scheduler.

    Shows:
    - Whether the scheduler is running
    - All currently scheduled timers
    - When each timer will fire
    - How long until each timer fires

    This shows the LIVE scheduler state, not just database state.
    A trigger might be 'active' in the database but not scheduled in memory
    if there was an issue during startup.`;

  parameters: {};

  returns: SchedulerState;

  risk: {
    level: 'low';
    reason: 'Read-only query of scheduler state';
  };
};
```

### debug_get_conversation

Gets complete conversation data including all messages.

```typescript
type DebugGetConversationTool = {
  name: 'debug_get_conversation';
  description: `Get complete conversation data for debugging.

    Includes:
    - Conversation metadata
    - All messages with full content
    - Tool calls and their results
    - Any pending interrupts
    - Trigger association (if trigger-invoked)
    - Telegram chat mapping (if applicable)

    Use this to trace exactly what happened in a conversation.`;

  parameters: {
    conversationId: string;
  };

  returns: ConversationDebugView;

  risk: {
    level: 'low';
    reason: 'Read-only query of conversation data';
  };
};
```

### debug_list_conversations

Lists recent conversations with metadata.

```typescript
type DebugListConversationsTool = {
  name: 'debug_list_conversations';
  description: `List recent conversations for debugging.

    Can filter to trigger-created conversations only, or include all.
    Useful for finding conversation IDs to inspect with debug_get_conversation.`;

  parameters: {
    triggerOnly?: boolean;            // Only trigger-invoked conversations
    triggerId?: string;               // Only conversations from this trigger
    since?: string;                   // ISO8601: only after this time
    limit?: number;                   // Default: 20
  };

  returns: {
    conversations: Array<{
      id: string;
      title?: string;
      startedAt: string;
      lastActivityAt: string;
      messageCount: number;
      trigger?: {
        id: string;
        name: string;
      };
    }>;
  };

  risk: {
    level: 'low';
    reason: 'Read-only query of conversation list';
  };
};
```

### debug_system_health

Gets overall system health and configuration status.

```typescript
type DebugSystemHealthTool = {
  name: 'debug_system_health';
  description: `Get GLaDOS system health and configuration status.

    Shows:
    - Service configuration status
    - Trigger system statistics
    - Recent conversation counts
    - External service status

    Use this for a quick overview of system state.`;

  parameters: {};

  returns: SystemHealth;

  risk: {
    level: 'low';
    reason: 'Read-only system status query';
  };
};
```

---

## Domain Knowledge

The debugging skill injects this knowledge when activated:

```markdown
# Debugging Skill

You now have access to debugging tools for inspecting GLaDOS system state.

## Understanding Trigger State

Triggers have several states and fields that help diagnose issues:

### Trigger Status
- **active**: Trigger is enabled and will fire according to schedule
- **paused**: Manually paused, won't fire until resumed
- **completed**: One-time trigger that has fired, or recurring trigger that reached limits
- **failed**: Trigger failed multiple times consecutively and was automatically paused

### Key Fields for Debugging
- **nextInvocationAt**: When the trigger is scheduled to fire next (database state)
- **lastInvokedAt**: When the trigger last fired
- **invocationCount**: Total times the trigger has fired
- **consecutiveFailures**: Failure count since last success (resets on success)
- **lastError**: The error message from the most recent failure

### Scheduler State vs Database State
The database stores the persistent trigger configuration. The in-memory scheduler
manages actual timers. These can get out of sync if:
- The service was restarted and failed to load a trigger
- A trigger was created but scheduling failed
- There was an error updating the next invocation time

Use `debug_scheduler_state` to see what's actually scheduled in memory.

## Debugging Flow

### "Why didn't my trigger run?"

1. Use `debug_get_trigger` with the trigger name to see full state
2. Check `status` - is it still 'active'?
3. Check `consecutiveFailures` and `lastError` for failure info
4. Check `nextInvocationAt` - when should it fire?
5. Use `debug_scheduler_state` to verify it's in the scheduler queue

### "What happened when the trigger ran?"

1. Use `debug_get_trigger` to get the conversation IDs
2. Use `debug_get_conversation` on the relevant conversation
3. Review the messages and tool calls to see what the agent did

### "Is the system working?"

1. Use `debug_system_health` for overall status
2. Check if triggerService is running
3. Check scheduledCount matches expected active triggers
4. Use `debug_list_triggers` to see all trigger states

## Common Issues

### Trigger shows 'active' but never fires
- Check `debug_scheduler_state` - is it in the scheduler?
- If not, the trigger service may need restart or there was a startup error

### Trigger fires but nothing happens
- Use `debug_trigger_history` to see if invocations succeeded
- Use `debug_get_conversation` on the conversation to see tool calls
- Agent may have run but decided no notification was needed

### Trigger marked as 'failed'
- Check `lastError` for the error message
- Check `consecutiveFailures` - it failed this many times in a row
- Fix the underlying issue, then use update_trigger to set status='active'
```

---

## Skill Definition

```typescript
import { z } from 'zod';
import type { SkillDefinition } from '../skills.schemas.ts';
import {
  debugListTriggersTool,
  debugGetTriggerTool,
  debugTriggerHistoryTool,
  debugSchedulerStateTool,
  debugGetConversationTool,
  debugListConversationsTool,
  debugSystemHealthTool,
} from './debugging.tools.ts';

export const debuggingSkill: SkillDefinition = {
  id: 'debugging',
  name: 'System Debugging',
  description: 'Inspect GLaDOS system state including triggers, conversations, and scheduler',

  activationRisk: 'low',
  activationReason: 'All debugging tools are read-only queries',

  tools: [
    debugListTriggersTool,
    debugGetTriggerTool,
    debugTriggerHistoryTool,
    debugSchedulerStateTool,
    debugGetConversationTool,
    debugListConversationsTool,
    debugSystemHealthTool,
  ],

  domainKnowledge: DEBUGGING_DOMAIN_KNOWLEDGE,  // The markdown above

  tags: ['debugging', 'system', 'admin'],
  relatedSkills: [],
};
```

---

## Implementation

### File Structure

```
src/skills/debugging/
├── index.ts                    # Barrel export
├── debugging.ts                # Skill definition
├── debugging.tools.ts          # Tool implementations
├── debugging.schemas.ts        # Debug view schemas
└── debugging.test.ts           # Tests
```

### Tool Implementation Notes

#### Accessing Scheduler State

The `TriggerScheduler` needs to expose its internal state:

```typescript
// In triggers.scheduler.ts
class TriggerScheduler {
  // Add method to expose state
  getState(): SchedulerStateSnapshot {
    return {
      running: this.#running,
      scheduledTriggers: Array.from(this.#timers.entries()).map(([id, timer]) => ({
        triggerId: id,
        scheduledFireTime: timer.fireTime.toISOString(),
        delayMs: timer.fireTime.getTime() - Date.now(),
      })),
    };
  }
}
```

#### Trigger Service Exposure

The `TriggerService` needs to expose scheduler state:

```typescript
// In triggers.ts
class TriggerService {
  // Add method for debugging
  getSchedulerState(): SchedulerState {
    const state = this.#scheduler.getState();
    return {
      running: this.#running,
      scheduledCount: state.scheduledTriggers.length,
      scheduledTriggers: state.scheduledTriggers,
    };
  }
}
```

#### Service Access Pattern

Debug tools need access to services. Use the skill context:

```typescript
const debugGetTrigger: ToolDefinition = {
  // ...
  execute: async (input, context) => {
    const triggerService = context.services.get(TriggerService);
    const trigger = input.triggerId
      ? await triggerService.get(input.triggerId)
      : await triggerService.getByName(input.triggerName);

    if (!trigger) {
      throw new TriggerNotFoundError(input.triggerId ?? input.triggerName);
    }

    // Get scheduler state for this trigger
    const schedulerState = triggerService.getSchedulerState();
    const scheduled = schedulerState.scheduledTriggers.find(t => t.triggerId === trigger.id);

    // Get recent conversations
    const conversations = await triggerService.getConversations(trigger.id, {
      limit: input.conversationLimit ?? 10,
    });

    return {
      trigger: {
        ...trigger,
        schedulerState: {
          isScheduled: !!scheduled,
          scheduledFireTime: scheduled?.scheduledFireTime,
          timerDelayMs: scheduled?.delayMs,
        },
      },
      conversations,
    };
  },
};
```

---

## Testing Strategy

### Unit Tests

- Schema validation for debug views
- Tool parameter validation
- Mock service responses

### Integration Tests

- Full tool execution with real database
- Scheduler state inspection
- Cross-reference between triggers and conversations

### Test Scenarios

```typescript
describe('debugging skill', () => {
  describe('debug_list_triggers', () => {
    it('returns all triggers with scheduler state');
    it('filters by status');
    it('includes recent invocations');
  });

  describe('debug_get_trigger', () => {
    it('returns full trigger state by ID');
    it('returns full trigger state by name');
    it('includes scheduler state');
    it('includes conversation history');
    it('throws for unknown trigger');
  });

  describe('debug_scheduler_state', () => {
    it('returns running state when service is running');
    it('returns scheduled triggers with fire times');
    it('handles empty scheduler');
  });

  describe('debug_get_conversation', () => {
    it('returns full conversation with messages');
    it('includes tool calls parsed as JSON');
    it('includes trigger association');
    it('includes pending interrupts');
  });

  describe('debug_system_health', () => {
    it('returns service configuration status');
    it('returns trigger statistics');
    it('returns conversation counts');
  });
});
```

---

## Implementation Phases

### Phase 1: Core Infrastructure

- [ ] Debug view schemas
- [ ] Skill definition
- [ ] Expose scheduler state on TriggerScheduler
- [ ] Expose scheduler state on TriggerService

### Phase 2: Trigger Debug Tools

- [ ] debug_list_triggers
- [ ] debug_get_trigger
- [ ] debug_trigger_history
- [ ] debug_scheduler_state

### Phase 3: Conversation Debug Tools

- [ ] debug_get_conversation
- [ ] debug_list_conversations

### Phase 4: System Health

- [ ] debug_system_health
- [ ] Service state aggregation

### Phase 5: Documentation

- [ ] Update docs/debugging.md with skill usage
- [ ] Update CLAUDE.md with skill reference
- [ ] Domain knowledge refinement

---

## Future Considerations

1. **Log Access**: Add tools to search and view system logs

2. **Performance Metrics**: Track and expose invocation durations, token usage

3. **Historical Analysis**: Trend analysis for trigger failures, conversation patterns

4. **Automated Diagnostics**: Agent-driven issue detection based on patterns

5. **Configuration Inspection**: View effective configuration without modification capability

6. **Memory Debugging**: Inspect memory entries and embedding state

7. **Checkpoint Inspection**: View LangGraph checkpoint data for conversation state debugging
