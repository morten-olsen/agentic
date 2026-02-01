# Debugging Guide

This guide covers tools and techniques for debugging GLaDOS conversations and the orchestrator.

## Conversation-Level Debugging

When a conversation doesn't behave as expected, use these tools to investigate what happened.

### Getting the Conversation ID

#### From Telegram

Send the `/id` command to the bot. It will respond with:
- The conversation ID (a UUID)
- Instructions for using the debug script

```
/id

> Debug Info
> Conversation ID: 94f3a92a-e3d8-4527-b64f-db195bf74fa8
> Use this ID with `pnpm conversation <id>` to inspect the conversation.
```

#### From the CLI

The conversation ID is displayed when you start a session. You can also find recent conversations in the database.

### Inspecting a Conversation

Use the `pnpm conversation` command to inspect a conversation's full history:

```bash
pnpm conversation <conversation-id>
```

This displays:

- **Conversation metadata**: ID, title, timestamps, message count
- **Telegram mapping** (if applicable): Chat ID, user ID, activity timestamps
- **All messages**: In chronological order with:
  - Role (user/assistant/tool)
  - Timestamps
  - Token usage (for assistant messages)
  - Tool calls and their arguments
  - Full content
- **Pending interrupts**: Any unanswered approval requests

#### Example Output

```
================================================================================
CONVERSATION
================================================================================
ID:            94f3a92a-e3d8-4527-b64f-db195bf74fa8
Title:         Telegram Chat 12345678
Started:       2026-01-15T10:30:00.000Z
Last Activity: 2026-01-15T10:35:00.000Z
Message Count: 4

Telegram Chat:
  Chat ID:     12345678
  User ID:     87654321
  Created:     2026-01-15T10:30:00.000Z
  Last Active: 2026-01-15T10:35:00.000Z

================================================================================
MESSAGES (4)
================================================================================

👤 [USER] 2026-01-15T10:30:00.000Z
   ID: abc123...
   Content: What's on my calendar today?

🤖 [ASSISTANT] 2026-01-15T10:30:05.000Z
   ID: def456...
   Tokens: 150 in / 85 out
   Content: Let me check your calendar...
   Tool Calls: [{"name": "calendar.get_events_in_range", ...}]

🔧 [TOOL] 2026-01-15T10:30:06.000Z
   ID: ghi789...
   Tool Call ID: call_xyz
   Content: {"events": [...]}

🤖 [ASSISTANT] 2026-01-15T10:30:08.000Z
   ID: jkl012...
   Tokens: 200 in / 120 out
   Content: You have 2 meetings today...

================================================================================
PENDING INTERRUPTS
================================================================================

(none)
```

### Interactive Testing

For debugging interrupt flows or testing fixes, use the interactive test script:

```bash
# Start a new conversation
pnpm conversation:test new

# Send a message
pnpm conversation:test send <conversation-id> "your message here"

# Approve an interrupt
pnpm conversation:test approve <interrupt-id>

# Deny an interrupt
pnpm conversation:test deny <interrupt-id>

# Check conversation status
pnpm conversation:test status <conversation-id>
```

This is useful for:
- Reproducing issues step-by-step
- Testing interrupt approval flows
- Verifying fixes before deploying

## Common Issues

### Repeated Interrupt Prompts

**Symptom**: User approves a tool, but gets prompted for the same tool again.

**Cause**: Usually indicates an issue with how approved tools are tracked across graph iterations.

**Debug steps**:
1. Get the conversation ID with `/id`
2. Run `pnpm conversation <id>` to see the message history
3. Check if tool messages are present (tools should execute after approval)
4. Look at pending interrupts to see if duplicates exist

### Tools Not Executing

**Symptom**: User approves a tool, but the action doesn't happen.

**Cause**: Could be checkpoint state not being preserved, or tool execution errors.

**Debug steps**:
1. Check the conversation for tool result messages
2. Look for error messages in the conversation
3. Check the database directly to see if the expected changes occurred

### Conversation Context Lost

**Symptom**: Agent doesn't remember previous messages or tool results.

**Cause**: Usually indicates checkpoint state not being loaded correctly on resume.

**Debug steps**:
1. Check the message count in conversation output
2. Compare messages in conversation vs what was actually said
3. Look at checkpoint data (see Advanced Debugging below)

## Advanced Debugging

### Inspecting Checkpoints

Checkpoints store the LangGraph state at each step. To inspect them:

```javascript
// In a Node.js script or REPL
const knex = db.knex;

const checkpoints = await knex('checkpoints')
  .where({ conversation_id: '<conversation-id>' })
  .orderBy('created_at', 'desc')
  .limit(5);

for (const cp of checkpoints) {
  const state = JSON.parse(cp.state);
  console.log('Checkpoint:', cp.checkpoint_id);
  console.log('Messages:', state.channel_values?.messages?.length);
  console.log('Approved tools:', state.channel_values?.approvedToolCalls);
  console.log('Interrupt required:', state.channel_values?.interruptRequired);
  console.log('Pending tool:', state.channel_values?.pendingToolCall?.name);
}
```

### Inspecting Interrupts

To see all interrupts for a conversation:

```javascript
const interrupts = await knex('interrupts')
  .where({ conversation_id: '<conversation-id>' })
  .orderBy('created_at', 'asc');

for (const i of interrupts) {
  console.log('ID:', i.id);
  console.log('Status:', i.status);
  console.log('Type:', i.type);
  console.log('Tool:', JSON.parse(i.tool_call)?.toolName);
  console.log('Created:', i.created_at);
  console.log('Response:', i.response);
}
```

### Database Tables Reference

| Table | Purpose |
|-------|---------|
| `conversations` | Conversation metadata |
| `messages` | Stored messages (user + final assistant responses) |
| `checkpoints` | LangGraph state snapshots |
| `interrupts` | Human-in-the-loop approval requests |
| `telegram_chats` | Telegram chat → conversation mapping |

## Working with AI Agents

When debugging issues with an AI coding agent (like Claude):

1. **Get the conversation ID** from `/id` in Telegram
2. **Run the inspection command** and share the output:
   ```bash
   pnpm conversation <id>
   ```
3. **Describe the expected vs actual behavior**
4. **The agent can analyze**:
   - Message flow and tool calls
   - Whether tools executed correctly
   - Checkpoint state for context issues
   - Interrupt patterns for approval loops

This workflow enables efficient debugging without needing to reproduce the issue manually.
