# Telegram Bot Integration Specification

> External client for mobile interaction with GLaDOS

## Overview

The Telegram bot provides a mobile-friendly interface to GLaDOS, allowing users to interact with their personal assistant from anywhere. This is the first external client implementation, establishing patterns for future channels (Slack, Discord, web UI, etc.).

### Goals

1. **Mobile Access**: Chat with GLaDOS from Telegram on any device
2. **Conversation Persistence**: Maintain conversation context across sessions
3. **Interrupt Handling**: Support human-in-the-loop approval flows via inline keyboards
4. **Security**: Restrict access to authorized user(s) only
5. **Reusable Patterns**: Establish client integration patterns for future channels

### Non-Goals (for v1)

- Webhook mode (polling only for simplicity)
- Voice message support
- Image/document processing
- Group chat support
- Multiple bot instances

---

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Telegram   │────▶│  TelegramClient  │────▶│  Orchestrator   │
│   User      │◀────│  Service         │◀────│  Service        │
└─────────────┘     └──────────────────┘     └─────────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   Database   │
                    │ (chat map)   │
                    └──────────────┘
```

### Components

| Component | Purpose |
|-----------|---------|
| `TelegramClientService` | Main service managing bot lifecycle and message handling |
| `telegram.handlers.ts` | Message formatting, interrupt rendering, callback parsing |
| `telegram.store.ts` | Chat ID → Conversation ID mapping persistence |
| `telegram.schemas.ts` | Zod schemas for configuration and data types |
| `telegram.cli.ts` | Standalone entry point for running the bot |

### Technology Choice: grammy

**Why grammy over alternatives:**

| Option | Pros | Cons |
|--------|------|------|
| grammy | TypeScript-first, modern async API, good docs, active | Newer library |
| node-telegram-bot-api | Popular, mature | Callback-based, weaker types |
| telegraf | Feature-rich | Less active development |

grammy was chosen for its TypeScript-first design and modern API patterns.

---

## Database Schema

### Migration: `008_telegram_chats.ts`

```sql
CREATE TABLE telegram_chats (
  telegram_chat_id INTEGER PRIMARY KEY,
  telegram_user_id INTEGER NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL
);

CREATE INDEX idx_telegram_chats_conversation ON telegram_chats(conversation_id);
CREATE INDEX idx_telegram_chats_user ON telegram_chats(telegram_user_id);
```

### Data Flow

1. User sends message to bot
2. Service checks `telegram_chats` for existing conversation mapping
3. If found, updates `last_activity_at` and uses existing conversation
4. If not found, creates new conversation via orchestrator, stores mapping
5. Message forwarded to orchestrator with conversation ID

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GLADOS_TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `GLADOS_TELEGRAM_OWNER_ID` | Yes | Telegram user ID for authorization |
| `GLADOS_LLM_API_KEY` | Yes | Required for orchestrator |

### Configuration Schema

```typescript
type TelegramConfig = {
  botToken: string;   // From @BotFather
  ownerId: number;    // Authorized user's Telegram ID
};
```

---

## Message Handling

### Incoming Messages

```typescript
// Text message flow
#handleMessage = async (ctx: Context): Promise<void> => {
  // 1. Get or create conversation mapping
  const conversationId = await this.#getOrCreateConversation(chatId, userId);

  // 2. Show typing indicator
  await ctx.replyWithChatAction('typing');

  // 3. Stream response from orchestrator
  for await (const chunk of orchestrator.chat(conversationId, message)) {
    // Handle token, interrupt, done, error chunks
  }
};
```

### Response Buffering

Telegram has a 4096 character limit per message. Responses are:
1. Accumulated during streaming
2. Split by paragraphs if exceeding limit
3. Further split by sentences if needed
4. Sent as multiple messages

### Interrupt Handling

Interrupts (tool approvals) are rendered as inline keyboards:

```
┌─────────────────────────────────────┐
│ Tool Request                        │
│ Tool: send_email                    │
│ Risk: medium                        │
│ Reason: Sends external email        │
│                                     │
│ [✓ Approve]  [✗ Deny]              │
└─────────────────────────────────────┘
```

Callback data format: `{action}:{interruptId}[:optionId]`
- `approve:int-123`
- `deny:int-123`
- `option:int-123:opt-456`

---

## Authorization

### Single-Owner Model

For v1, the bot only responds to one user (the owner):

```typescript
#isAuthorized = (userId: number): boolean => {
  return userId === this.#config?.ownerId;
};
```

Unauthorized messages receive a friendly rejection with setup instructions.

### Future: Multi-User

Could be extended to support an allowlist:

```typescript
type TelegramConfig = {
  botToken: string;
  ownerId: number;
  allowedUsers?: number[];  // Future: additional authorized users
};
```

---

## Commands

| Command | Handler | Description |
|---------|---------|-------------|
| `/start` | `#handleStart` | Welcome message, ensure conversation exists |
| `/new` | `#handleNew` | Delete existing mapping, start fresh conversation |
| `/help` | `#handleHelp` | Show available commands |

---

## Error Handling

### Network Errors

The bot uses grammy's built-in retry logic for API calls.

### Orchestrator Errors

Errors from the orchestrator are caught and displayed to the user:

```typescript
} catch (error) {
  await ctx.reply(`❌ Error: ${error.message}`);
}
```

### Invalid Callbacks

Expired or invalid callback queries are handled gracefully:

```typescript
if (pendingInterruptId !== parsed.interruptId) {
  await ctx.answerCallbackQuery({ text: 'This action has expired' });
  return;
}
```

---

## Module Structure

```
src/clients/telegram/
├── telegram.ts              # Main TelegramClientService
├── telegram.schemas.ts      # Zod schemas and types
├── telegram.store.ts        # Database operations
├── telegram.handlers.ts     # Message formatting utilities
├── telegram.cli.ts          # Entry point
└── telegram.test.ts         # Unit tests (23 tests)
```

---

## Usage

### Starting the Bot

```bash
# Set required environment variables
export GLADOS_LLM_API_KEY=sk-or-v1-...
export GLADOS_TELEGRAM_BOT_TOKEN=123456:ABC-DEF
export GLADOS_TELEGRAM_OWNER_ID=12345678

# Start the bot
pnpm telegram
```

### Output

```
Initializing database...
Starting GLaDOS Telegram bot...
Authorized user ID: 12345678
Bot started as @your_bot_username
```

### Graceful Shutdown

The bot handles SIGINT and SIGTERM for clean shutdown:

```typescript
process.on('SIGINT', async () => {
  await telegram.stop();
  await services.destroy();
  process.exit(0);
});
```

---

## Design Decisions

### 1. Polling vs Webhook

**Decision: Start with polling**

Polling is simpler for development:
- No server/HTTPS setup required
- Works behind NAT/firewalls
- Good for prototyping

Webhook support can be added later for production deployments.

### 2. Conversation Mapping

**Decision: One conversation per chat**

Each Telegram chat maps to exactly one GLaDOS conversation. The `/new` command creates a fresh conversation.

Alternative considered: Multiple conversations per chat with selection UI - rejected as over-engineering for v1.

### 3. Interrupt Persistence

**Decision: Track pending interrupts in memory**

Pending interrupts are tracked in a Map:
```typescript
#pendingInterrupts = new Map<number, string>(); // chatId -> interruptId
```

This is cleared on bot restart. The orchestrator's interrupt persistence handles long-term storage.

### 4. Message Formatting

**Decision: Markdown for rich formatting**

Uses Telegram's Markdown parse mode for:
- Tool names in backticks
- Bold headers
- Emoji indicators

---

## Future Enhancements

| Enhancement | Priority | Description |
|-------------|----------|-------------|
| Webhook mode | Medium | For production deployments |
| Voice messages | Low | Transcription via Whisper |
| Image handling | Low | Send images to vision models |
| Group support | Low | Multi-user conversations |
| Bot commands registration | Low | Register commands with BotFather |
| Rate limiting | Medium | Prevent abuse |

---

## Related Documentation

- `docs/external-clients.md` - General client integration guide
- `docs/configuration.md` - Configuration reference
- `spec/agent.md` - Main system specification
