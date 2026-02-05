# Development Guide

This document provides a high-level overview of the GLaDOS architecture and how to contribute new functionality.

## Architecture Overview

GLaDOS is built with a two-layer architecture:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              GLaDOS Core                                  │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                        Foundation Layer                              │ │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌────────┐│ │
│  │  │User Model │ │ Contacts  │ │ Calendar  │ │ Location  │ │ Memory ││ │
│  │  │ (who am I)│ │  (who)    │ │  (when)   │ │  (where)  │ │(recall)││ │
│  │  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └───┬────┘│ │
│  │        └─────────────┴─────────────┴─────────────┴───────────┘     │ │
│  │                                │                                    │ │
│  │                                ▼                                    │ │
│  │                      ┌─────────────────┐                           │ │
│  │     ┌───────────┐    │ Context Builder │    ┌───────────┐          │ │
│  │     │   Tasks   │───▶│ (unified view)  │◀───│Agent Reg. │          │ │
│  │     │(workflows)│    └────────┬────────┘    │(sub-agents)│         │ │
│  │     └───────────┘             │             └───────────┘          │ │
│  └───────────────────────────────┼─────────────────────────────────────┘ │
│                                  │                                       │
│  ┌───────────────────────────────┼───────────────────────────────────┐  │
│  │                    Orchestration Layer                             │  │
│  │                               │                                    │  │
│  │    ┌──────────────┐          ▼           ┌──────────────┐         │  │
│  │    │   Proactive  │   ┌─────────────┐    │  Clients     │         │  │
│  │    │   Scheduler  │──▶│Orchestrator │◀───│  CLI/Telegram│         │  │
│  │    │   (cron)     │   │ (LangGraph) │    └──────────────┘         │  │
│  │    └──────────────┘   └──────┬──────┘                             │  │
│  │                              │                                     │  │
│  │              ┌───────────────┼───────────────┐                    │  │
│  │              ▼               ▼               ▼                    │  │
│  │       ┌───────────┐   ┌───────────┐   ┌───────────┐              │  │
│  │       │   Tool    │   │  Interrupt│   │ Notify    │              │  │
│  │       │  Registry │   │   Gate    │   │  Router   │              │  │
│  │       │(risk gate)│   │ (HITL)    │   │(channels) │              │  │
│  │       └───────────┘   └───────────┘   └───────────┘              │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Foundation Layer

The foundation layer contains core data that shapes every interaction. These are **not tools** - they're always-available context that the agent can access:

| Module | Purpose | Key Files |
|--------|---------|-----------|
| **User Model** | Identity, projects, goals, routines | `src/user-model/` |
| **Contacts** | People and relationships | `src/contacts/` |
| **Calendar** | Events and scheduling | `src/calendar/` |
| **Location** | Places and location tracking | `src/location/` |
| **Memory** | Long-term recall, embeddings, entity knowledge | `src/memory/` |
| **Tasks** | User tasks and delegated workflows | `src/tasks/` |
| **Context Builder** | Aggregates all context for agent | `src/context/` |

### Orchestration Layer

The orchestration layer handles agent execution and tool management:

| Module | Purpose | Key Files |
|--------|---------|-----------|
| **Orchestrator** | LangGraph-based agent graph | `src/orchestrator/` |
| **Tools** | Tool registry and execution | `src/tools/` |
| **Interrupts** | Human-in-the-loop approvals | `src/orchestrator/interrupts/` |
| **Agent Registry** | Sub-agent management and evolution | `src/orchestrator/agent-registry/` |
| **Personality** | Agent persona and prompts | `src/personality/` |
| **Proactive** | Scheduled checks and background tasks | `src/proactive/` |
| **Notifications** | Multi-channel notification routing | `src/notifications/` |

## Services Container

GLaDOS uses a simple dependency injection container. Services are lazily instantiated and share a single database connection.

```typescript
import { Services } from './services/services.ts';
import { DatabaseService } from './database/database.ts';
import { UserModelService } from './user-model/user-model.ts';

// Create container
const services = new Services();

// Services are lazy-loaded
const userModel = services.get(UserModelService);

// Clean up on shutdown
await services.destroy();
```

### Creating a New Service

```typescript
import type { Services } from '../services/services.ts';
import { DatabaseService } from '../database/database.ts';

class MyService {
  #services: Services;

  constructor(services: Services) {
    this.#services = services;
  }

  // Access database lazily in methods (not constructor)
  #db = () => this.#services.get(DatabaseService).knex;

  myMethod = async (): Promise<void> => {
    const db = this.#db();
    // Use db...
  };
}

export { MyService };
```

## Module Structure

Every module follows the same file organization:

```
{module}/
├── {module}.ts            # Main file (public API)
├── {module}.schemas.ts    # Zod schemas and types
├── {module}.store.ts      # Database persistence (if needed)
├── {module}.errors.ts     # Custom errors
├── {module}.utils.ts      # Utility functions
└── {module}.test.ts       # Unit tests
```

**Key conventions:**
- Import only from the main module file (`{module}.ts`), never from support files
- The main file re-exports everything consumers need
- All exports consolidated at end of file

See [Coding Standards](./coding-standards.md) for detailed conventions.

## Database

GLaDOS uses SQLite via Knex for persistence. Migrations are in `src/database/migrations/`.

### Adding a Migration

1. Create a new file: `src/database/migrations/{number}_{name}.ts`

```typescript
import type { Knex } from 'knex';

const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('my_table', (table) => {
    table.text('id').primary();
    table.text('name').notNullable();
    table.text('created_at').notNullable();
  });
};

const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('my_table');
};

export { up, down };
```

2. Register it in `src/database/database.ts`:

```typescript
import * as migration010 from './migrations/010_my_feature.ts';

const migrations = {
  // ... existing migrations
  '010_my_feature': migration010,
};
```

## Adding New Features

### 1. Foundation Service (User Data)

For new types of user data (like a new entity type):

1. Create the module structure
2. Add Zod schemas for validation
3. Create store functions for persistence
4. Create service class for business logic
5. Add database migration
6. Write unit tests
7. Export from `src/exports.ts`

### 2. Tools

For adding new agent capabilities, see [Adding Tools](./adding-tools.md).

### 3. External Clients

For new interfaces (Slack, Discord, etc.), see [External Clients](./external-clients.md).

## Testing

GLaDOS uses two test layers:

### Unit Tests (`src/**/*.test.ts`)

Test individual modules in isolation with in-memory databases:

```typescript
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { Services } from '../services/services.ts';
import { DatabaseService, createDatabaseService } from '../database/database.ts';

describe('MyService', () => {
  let services: Services;

  beforeEach(async () => {
    services = new Services();
    const db = createDatabaseService(services, { path: ':memory:' });
    services.set(DatabaseService, db);
    await db.migrate();
  });

  afterEach(async () => {
    await services.destroy();
  });

  it('does something', async () => {
    // Test code
  });
});
```

### Flow Tests (`test/flows/*.test.ts`)

Test end-to-end flows with HTTP mocking via MSW:

```typescript
import { server } from '../setup.ts';
import { createTestServices } from '../utils/services.ts';
import { createChatCompletion } from '../mocks/openai-responses.ts';

// Mock LLM responses
server.use(
  http.post('*/chat/completions', () => {
    return HttpResponse.json(createChatCompletion('Hello!'));
  }),
);
```

See [Testing Strategy](./testing-strategy.md) for more details.

## Development Workflow

### Running Locally

```bash
# Install dependencies
pnpm install

# Set up config
cp config/local.json.example config/local.json
# Edit config/local.json with your API key

# Start the CLI
pnpm cli

# Or start the Telegram bot
pnpm telegram
```

### Running Tests

```bash
pnpm test              # All tests (lint + unit)
pnpm test:lint         # ESLint only
pnpm test:unit         # Vitest only

# Run specific test file
pnpm test:unit src/tasks/tasks.test.ts
```

### Code Quality

- **Linting**: ESLint with TypeScript rules
- **Formatting**: Prettier (via ESLint)
- **Type checking**: TypeScript strict mode

Run `pnpm test:lint` before committing.

## Key Design Decisions

### 1. Human-in-the-Loop

All tools declare a risk profile. Medium and high-risk tools require user approval:

```typescript
risk: {
  level: 'medium',
  reason: 'Modifies user data',
  potentialImpact: 'Changes will be persisted',
  reversible: true,
  categories: ['data_modification'],
}
```

### 2. Context-Aware Agent

The Context Builder aggregates all foundation data into a single view for the agent's system prompt. This includes:

- Current time and timezone
- User's projects and goals
- Today's calendar
- Location context
- Pending tasks
- Recent conversation topics

### 3. Streaming Responses

The orchestrator uses async iterators for streaming:

```typescript
for await (const chunk of orchestrator.chat(conversationId, message)) {
  switch (chunk.type) {
    case 'token': // Text token
    case 'tool_start': // Tool execution starting
    case 'tool_end': // Tool execution complete
    case 'interrupt': // Approval needed
    case 'done': // Response complete
    case 'error': // Error occurred
  }
}
```

### 4. Task Queue

Long-running tasks are managed by the TaskService:

- **User Tasks**: Items on the user's to-do list with flexible triggers
- **Delegated Tasks**: Multi-step workflows the agent performs autonomously

Tasks can pause (waiting for user input, external events) and resume.

### 5. Proactive Scheduler

The ProactiveScheduler runs periodic checks that can create notifications or trigger agent actions:

```typescript
// Built-in checks
- calendar-lookahead  // Events needing prep in next 30 min
- stale-followups     // Delegated tasks waiting > 3 days
- daily-briefing      // Morning summary of day ahead
- deferred-tasks      // Tasks that are now relevant
```

Run with: `pnpm proactive`

### 6. Notification System

Notifications route through the NotificationRouter with attention budget awareness:

```typescript
// Attention budget respects:
- Quiet hours (configurable)
- Do Not Disturb mode
- Interruption limits per hour
- Focus blocks
```

Channels can be registered at runtime (CLI, Telegram, etc.).

## Documentation

Update documentation when you:

- Add new modules or features
- Change existing behavior
- Discover undocumented patterns

Key files:
- `CLAUDE.md` - AI agent guide (for Claude Code)
- `README.md` - User-facing documentation
- `spec/agent.md` - Technical specification
- `docs/` - Developer guides

## Related Documentation

- [Coding Standards](./coding-standards.md) - TypeScript conventions
- [Testing Strategy](./testing-strategy.md) - Test patterns
- [Adding Tools](./adding-tools.md) - How to add new tools
- [External Clients](./external-clients.md) - Building new interfaces
- [Configuration](./configuration.md) - Config system
