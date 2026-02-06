import type { SkillDefinition } from '../skills.schemas.ts';
import type { ToolDefinition } from '../../tools/tools.types.ts';

import {
  debugListTriggersTool,
  debugGetTriggerTool,
  debugTriggerHistoryTool,
  debugSchedulerStateTool,
  debugGetConversationTool,
  debugListConversationsTool,
  debugSystemHealthTool,
  debugSearchLogsTool,
  debugGetLogContextTool,
  debugLogStatsTool,
} from './debugging.tools.ts';

// ============================================================================
// Domain Knowledge
// ============================================================================

const DEBUGGING_DOMAIN_KNOWLEDGE = `# Debugging Skill

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
- **continuation**: Plain text note the agent can use to track state between invocations

### Scheduler State vs Database State
The database stores the persistent trigger configuration. The in-memory scheduler
manages actual timers. These can get out of sync if:
- The service was restarted and failed to load a trigger
- A trigger was created but scheduling failed
- There was an error updating the next invocation time

Use \`DebugSchedulerState\` to see what's actually scheduled in memory.

## Debugging Flow

### "Why didn't my trigger run?"

1. Use \`debugging_get_trigger\` with the trigger name to see full state
2. Check \`status\` - is it still 'active'?
3. Check \`consecutiveFailures\` and \`lastError\` for failure info
4. Check \`nextInvocationAt\` - when should it fire?
5. Use \`debugging_scheduler_state\` to verify it's in the scheduler queue
6. Compare database \`nextInvocationAt\` with scheduler \`scheduledFireTime\`

### "What happened when the trigger ran?"

1. Use \`debugging_get_trigger\` to get the conversation IDs
2. Use \`debugging_get_conversation\` on the relevant conversation
3. Review the messages and tool calls to see what the agent did
4. Check if the agent used \`notify\` to send a message

### "Is the system working?"

1. Use \`debugging_system_health\` for overall status
2. Check if triggerService is running
3. Check scheduledCount matches expected active triggers
4. Use \`debugging_list_triggers\` to see all trigger states

### "What triggered recently?"

1. Use \`debugging_trigger_history\` to see recent invocations
2. Filter by \`triggerId\` to see history for a specific trigger
3. Use \`since\` parameter to limit to a time range

## Common Issues

### Trigger shows 'active' but never fires
- Check \`debugging_scheduler_state\` - is it in the scheduler?
- If not, the trigger service may need restart or there was a startup error
- Compare \`nextInvocationAt\` in the trigger with \`scheduledFireTime\` in scheduler

### Trigger fires but nothing happens
- Use \`debugging_trigger_history\` to confirm invocations occurred
- Use \`debugging_get_conversation\` on the conversation to see tool calls
- Agent may have run but decided no notification was needed
- Check if the continuation note indicates why (agent tracks state there)

### Trigger marked as 'failed'
- Check \`lastError\` for the error message
- Check \`consecutiveFailures\` - it failed this many times in a row
- To retry: use update_trigger to set status='active' (this is a normal trigger tool, not a debug tool)

### Scheduler state empty
- Check if \`running\` is true in scheduler state
- If not running, the trigger service hasn't been started
- If running but empty, no triggers are scheduled (all may be paused/completed/failed)

## Tool Summary

| Tool | Purpose |
|------|---------|
| \`debugging_list_triggers\` | Overview of all triggers with scheduler state |
| \`debugging_get_trigger\` | Deep dive into single trigger with conversation history |
| \`debugging_trigger_history\` | When triggers fired, which conversations created |
| \`debugging_scheduler_state\` | Live in-memory scheduler queue |
| \`debugging_get_conversation\` | Full conversation with messages and tool calls |
| \`debugging_list_conversations\` | Find conversations (filter by trigger) |
| \`debugging_system_health\` | Service status and statistics |
| \`debugging_search_logs\` | Search and filter system logs |
| \`debugging_get_log_context\` | Get logs surrounding a specific entry |
| \`debugging_log_stats\` | Aggregate log statistics |

## Log Inspection

You have access to system logs for debugging errors and tracing execution.

### Searching Logs

Use \`debugging_search_logs\` to find relevant entries:
- Filter by level: \`{ level: 'error' }\` or \`{ level: ['error', 'warn'] }\`
- Filter by time: \`{ since: '2024-01-15T10:00:00Z' }\`
- Filter by context: \`{ conversationId: '...' }\` or \`{ triggerId: '...' }\`
- Search text: \`{ search: '400' }\` matches message content
- Filter by source: \`{ source: 'llm' }\` or \`{ source: 'tool:*' }\` (wildcards supported)

### Common Log Sources

- \`orchestrator\` - Main conversation handling
- \`llm\` - LLM API calls and responses
- \`tool:*\` - Tool execution (e.g., \`tool:notify\`, \`tool:create_trigger\`)
- \`trigger-service\` - Trigger scheduling and firing
- \`skill-activation\` - Skill activation flow

### Understanding Error Logs

Error logs include detailed information:
- \`errorName\`: The error class (e.g., 'TypeError', 'APIError')
- \`errorMessage\`: The error message
- \`errorStack\`: Full stack trace
- \`metadata\`: Additional context including:
  - API response bodies (for HTTP errors)
  - Request details (URL, method)
  - Error codes and status codes
  - Cause chain for nested errors

### Debugging Flow with Logs

1. **Find the error**: \`{ level: 'error', since: '...' }\`
2. **Check error details**: Look at \`errorMessage\` and \`metadata\` for API response details
3. **Get context**: Use \`debugging_get_log_context\` with the error's log ID
4. **Trace the conversation**: \`{ conversationId: '...' }\` to see full flow
5. **Check related systems**: Filter by relevant source
`;

// ============================================================================
// Skill Definition
// ============================================================================

const debuggingSkill: SkillDefinition = {
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
    debugSearchLogsTool,
    debugGetLogContextTool,
    debugLogStatsTool,
  ] as ToolDefinition[],

  domainKnowledge: DEBUGGING_DOMAIN_KNOWLEDGE,

  tags: ['debugging', 'system', 'admin'],
  relatedSkills: [],
};

// ============================================================================
// Exports
// ============================================================================

export { debuggingSkill, DEBUGGING_DOMAIN_KNOWLEDGE };
