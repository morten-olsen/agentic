# External Clients Guide

This document describes how to build external clients that connect to GLaDOS. External clients provide alternative interfaces to the agent beyond the built-in CLI.

## Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  External       │────▶│  Client Service  │────▶│  Orchestrator   │
│  Interface      │◀────│  (Your code)     │◀────│  Service        │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────┐
                        │   Database   │
                        │  (session    │
                        │   mapping)   │
                        └──────────────┘
```

External clients:
1. Receive messages from an external interface (Telegram, Slack, Discord, web UI, etc.)
2. Map external sessions to GLaDOS conversation IDs
3. Forward messages to the `OrchestratorService`
4. Handle streaming responses and interrupts
5. Send responses back to the external interface

## Core Integration Pattern

### Service Initialization

All external clients follow the same initialization pattern:

```typescript
import { Services } from '../services/services.ts';
import { DatabaseService, createDatabaseService } from '../database/database.ts';
import { UserModelService } from '../user-model/user-model.ts';
import { LocationService } from '../location/location.ts';
import { CalendarService } from '../calendar/calendar.ts';
import { ContextBuilderService } from '../context/context.ts';
import { PersonalityService } from '../personality/personality.ts';
import { OrchestratorService } from '../orchestrator/orchestrator.ts';
import { loadConfig } from '../config/config.ts';

const initializeServices = async (): Promise<{
  services: Services;
  orchestrator: OrchestratorService;
}> => {
  const config = loadConfig();
  const services = new Services();

  // Initialize database
  const db = createDatabaseService(services, { path: config.database.path });
  services.set(DatabaseService, db);
  await db.migrate();

  // Initialize required services (triggers registration)
  services.get(UserModelService);
  services.get(LocationService);
  services.get(CalendarService);
  services.get(ContextBuilderService);
  services.get(PersonalityService);

  // Create and configure orchestrator
  const orchestrator = new OrchestratorService(services);
  orchestrator.configure({
    llm: {
      baseUrl: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
      model: config.llm.model,
      temperature: config.llm.temperature,
      maxTokens: config.llm.maxTokens,
    },
  });

  return { services, orchestrator };
};
```

### Conversation Lifecycle

#### Starting a Conversation

```typescript
// Create a new conversation
const conversationId = await orchestrator.startConversation({
  title: 'Telegram Chat with User 12345',  // Optional
});
```

#### Sending Messages

```typescript
// Send a message and process the response stream
for await (const chunk of orchestrator.chat(conversationId, userMessage)) {
  switch (chunk.type) {
    case 'token':
      // Accumulate response text
      responseBuffer += chunk.content;
      break;

    case 'tool_start':
      // Agent is starting to use a tool
      console.log(`Using tool: ${chunk.name}`);
      break;

    case 'tool_end':
      // Tool finished executing
      console.log('Tool complete');
      break;

    case 'interrupt':
      // Human-in-the-loop approval needed
      await handleInterrupt(chunk.interrupt);
      break;

    case 'interrupt_resolved':
      // Interrupt was resolved (approved or denied)
      if (chunk.approved) {
        console.log('Tool approved');
      } else {
        console.log('Tool denied');
      }
      break;

    case 'done':
      // Response complete
      await sendResponseToUser(responseBuffer);
      responseBuffer = '';
      break;

    case 'error':
      // Error occurred
      await sendErrorToUser(chunk.error);
      break;
  }
}
```

### Handling Interrupts

Interrupts occur when the agent needs human approval (e.g., for risky tool calls).

```typescript
import type { Interrupt, InterruptResponse } from '../orchestrator/orchestrator.ts';

const handleInterrupt = async (interrupt: Interrupt): Promise<void> => {
  // Display the approval request to the user
  const prompt = interrupt.prompt;
  const options = interrupt.options;
  const toolInfo = interrupt.toolCall;

  // For tool approvals, show what tool is being requested
  if (interrupt.type === 'tool_approval' && toolInfo) {
    await sendToUser(`
Tool: ${toolInfo.toolName}
Risk Level: ${toolInfo.riskLevel}
Reason: ${toolInfo.riskReason}

${prompt}
    `);
  }

  // Present options if available
  if (options && options.length > 0) {
    const optionText = options
      .map((opt, i) => `${i + 1}. ${opt.label}${opt.isRecommended ? ' (recommended)' : ''}`)
      .join('\n');
    await sendToUser(optionText);
  }
};
```

#### Responding to Interrupts

Users can respond to interrupts through the normal chat flow:

```typescript
// Simple approval responses are parsed automatically:
// "y", "yes", "approve" -> approved
// "n", "no", "deny", "reject" -> denied
// Anything else -> freeform response (treated as denial with feedback)

// Example: user types "yes"
for await (const chunk of orchestrator.chat(conversationId, 'yes')) {
  // Will receive 'interrupt_resolved' chunk with approved: true
  // Then continue with normal response processing
}
```

Or use the programmatic API:

```typescript
const response: InterruptResponse = {
  approved: true,
  // Or for denial:
  // approved: false,
  // freeformResponse: 'Use a different approach instead',
};

for await (const chunk of orchestrator.respondToInterrupt(interrupt.id, response)) {
  // Process response...
}
```

### Session Mapping

External clients need to persist the mapping between their session identifiers and GLaDOS conversation IDs.

```typescript
// Example schema for session mapping
const sessionMappingSchema = z.object({
  externalId: z.string(),       // e.g., Telegram chat ID
  externalUserId: z.string(),   // e.g., Telegram user ID
  conversationId: z.string(),   // GLaDOS conversation ID
  createdAt: z.string(),
  lastActivityAt: z.string(),
});
```

#### Getting or Creating a Conversation

```typescript
const getOrCreateConversation = async (
  externalId: string,
  externalUserId: string,
): Promise<string> => {
  // Check for existing mapping
  const existing = await db('session_mappings')
    .where('external_id', externalId)
    .first();

  if (existing) {
    // Update last activity
    await db('session_mappings')
      .where('external_id', externalId)
      .update({ last_activity_at: new Date().toISOString() });
    return existing.conversation_id;
  }

  // Create new conversation
  const conversationId = await orchestrator.startConversation({
    title: `External session ${externalId}`,
  });

  // Store mapping
  await db('session_mappings').insert({
    external_id: externalId,
    external_user_id: externalUserId,
    conversation_id: conversationId,
    created_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
  });

  return conversationId;
};
```

## Implementation Checklist

When building a new external client:

1. **Configuration**
   - Add client-specific config to `src/config/config.ts`
   - Document environment variables

2. **Database**
   - Create migration for session mapping table
   - Register migration in `src/database/database.ts`

3. **Module Structure**
   ```
   src/clients/{client-name}/
   ├── {client-name}.ts           # Main service
   ├── {client-name}.schemas.ts   # Types and Zod schemas
   ├── {client-name}.store.ts     # Database operations
   ├── {client-name}.handlers.ts  # Message handlers (optional)
   ├── {client-name}.cli.ts       # Entry point
   └── {client-name}.test.ts      # Tests
   ```

4. **Authorization**
   - Implement user authorization (e.g., allowlist)
   - Reject unauthorized users gracefully

5. **Error Handling**
   - Handle network errors gracefully
   - Provide meaningful error messages to users
   - Log errors for debugging

6. **Graceful Shutdown**
   - Handle SIGINT/SIGTERM signals
   - Clean up resources (close connections, etc.)
   - Destroy the services container

## Example: Telegram Client

See `src/clients/telegram/` for a complete implementation example.

Key features:
- Maps Telegram chat IDs to GLaDOS conversations
- Buffers streaming responses for Telegram's message format
- Renders interrupts as inline keyboards
- Supports `/new` command to start fresh conversations
- Restricts access to authorized user(s) only

## Best Practices

### Message Buffering

External APIs often have different message formats than streaming tokens. Buffer the response:

```typescript
let buffer = '';

for await (const chunk of orchestrator.chat(conversationId, message)) {
  if (chunk.type === 'token') {
    buffer += chunk.content;
  } else if (chunk.type === 'done') {
    // Send the complete message
    await sendMessage(buffer);
    buffer = '';
  }
}
```

### Rate Limiting

Consider rate limiting to prevent abuse:

```typescript
const rateLimiter = new Map<string, number>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_MESSAGES = 10;

const checkRateLimit = (userId: string): boolean => {
  const now = Date.now();
  const lastTime = rateLimiter.get(userId) ?? 0;

  if (now - lastTime < RATE_LIMIT_WINDOW / MAX_MESSAGES) {
    return false; // Rate limited
  }

  rateLimiter.set(userId, now);
  return true;
};
```

### Typing Indicators

Show typing indicators while processing:

```typescript
// Start typing indicator
await client.sendChatAction(chatId, 'typing');

// Process message
for await (const chunk of orchestrator.chat(conversationId, message)) {
  // Periodically refresh typing indicator for long responses
  if (chunk.type === 'tool_start') {
    await client.sendChatAction(chatId, 'typing');
  }
  // ...
}
```

### Conversation Commands

Implement standard commands:

| Command | Description |
|---------|-------------|
| `/start` | Welcome message, create conversation |
| `/new` | Start a new conversation |
| `/help` | Show available commands |
| `/history` | Show recent messages (optional) |

## Cleanup

Always clean up resources on shutdown:

```typescript
const shutdown = async (): Promise<void> => {
  console.log('Shutting down...');

  // Stop accepting new messages
  await client.stop();

  // Destroy services (closes database connections, etc.)
  await services.destroy();

  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```
