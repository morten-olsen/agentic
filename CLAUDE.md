# GLaDOS - AI Coding Agent Guide

This document provides context for AI coding agents working on this codebase. **This is a living document** - update it when you discover new patterns, fix discrepancies, or when the project evolves.

## Project Overview

GLaDOS (General Learning and Decision Orchestration System) is a **personal AI assistant** designed to be "Jarvis for yourself". It maintains a rich model of you (identity, projects, goals, relationships), operates proactively (not just reactively), handles long-running tasks, and learns from every interaction.

**Key differentiators from a generic chatbot:**
- Knows *who you are* (User Model, Contacts, Calendar as core infrastructure)
- Anticipates needs (Trigger System, daily briefings, day planning)
- Manages multi-step tasks that span hours/days (Task Queue)
- Human-in-the-loop for trust (risk-gated tools, approval flows)

**Key Documentation:**
- **Spec**: `spec/agent.md` - Technical specification (types, schemas, implementation phases)
- **Telegram Spec**: `spec/telegram.md` - Telegram bot integration specification
- **Triggers Spec**: `spec/triggers.md` - Trigger system specification
- **Day Planner Spec**: `spec/day-planner.md` - Daily planning sessions and context
- **Architecture**: `docs/agent-architecture.md` - Conceptual guide (how the agent thinks)
- **External Clients**: `docs/external-clients.md` - Guide for building external client integrations
- **Coding Standards**: `docs/coding-standards.md` - TypeScript conventions
- **Testing Strategy**: `docs/testing-strategy.md` - Testing patterns and infrastructure
- **Debugging**: `docs/debugging.md` - Conversation-level debugging tools and techniques

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 22+ with `--experimental-strip-types` |
| Agent Framework | LangChain + LangGraph |
| Database | Knex + SQLite (+ sqlite-vss for Phase 4) |
| Validation | Zod 4 |
| Configuration | Convict |
| Testing | Vitest |

## Project Structure

```
glados/
├── CLAUDE.md              # This file (AI agent guide)
├── README.md              # User-facing documentation
├── docs/
│   ├── coding-standards.md
│   ├── testing-strategy.md
│   ├── getting-started.md
│   └── configuration.md
├── spec/
│   ├── agent.md           # System specification
│   └── telegram.md        # Telegram integration spec
├── test/                  # Flow tests (MSW-based)
│   ├── setup.ts           # MSW server setup
│   ├── mocks/             # HTTP mock handlers
│   ├── utils/             # Test utilities
│   └── flows/             # End-to-end flow tests
├── src/
│   ├── config/            # Convict-based configuration
│   ├── database/          # Knex + SQLite + migrations
│   ├── services/          # Service container (DI)
│   ├── user-model/        # Identity, projects, goals, routines
│   ├── contacts/          # People and relationships
│   ├── calendar/          # Events, scheduling
│   ├── location/          # Places, location tracking
│   ├── context/           # Context Builder
│   ├── personality/       # Agent personality config
│   ├── tools/             # Tool system + LangChain adapters
│   ├── orchestrator/      # LangGraph agent orchestration
│   ├── cli/               # Interactive CLI
│   ├── clients/           # External client interfaces
│   │   └── telegram/      # Telegram bot client
│   └── exports.ts         # Package entry point
├── package.json
└── tsconfig.json
```

### Memory Modules (Phase 4)

```
src/memory/
├── memory.ts              # Core memory service
├── memory.schemas.ts      # Memory entry types and schemas
├── memory.store.ts        # SQLite storage
├── memory.embeddings.ts   # Embedding service
├── memory.consolidation.ts # Consolidation tiers
├── entity-knowledge/      # Knowledge about things in user's world
│   ├── entity-knowledge.ts
│   ├── entity-knowledge.schemas.ts
│   └── entity-knowledge.store.ts
└── operator-manuals/      # Procedural knowledge for recurring tasks
    ├── operator-manuals.ts
    ├── operator-manuals.schemas.ts
    └── operator-manuals.store.ts
```

### Orchestrator Modules (Phase 7)

```
src/orchestrator/
├── orchestrator.ts        # Main agent graph
├── orchestrator.state.ts  # State annotation
├── orchestrator.nodes.ts  # Graph nodes
├── interrupts/            # Human-in-the-loop
└── agent-registry/        # Sub-agent management
    ├── agent-registry.ts
    ├── agent-registry.schemas.ts
    └── agent-registry.store.ts
```

### External Clients

```
src/clients/
└── telegram/              # Telegram bot interface
    ├── telegram.ts        # Main TelegramClientService
    ├── telegram.schemas.ts # Zod schemas
    ├── telegram.store.ts  # Chat ID → Conversation mapping
    ├── telegram.handlers.ts # Message formatting utilities
    ├── telegram.cli.ts    # Entry point (pnpm telegram)
    └── telegram.test.ts   # Unit tests
```

External clients connect to the orchestrator to provide alternative interfaces. See `docs/external-clients.md` for the integration pattern.

### Task Modules (Phase 5)

```
src/tasks/
├── tasks.ts               # Main TaskService class
├── tasks.schemas.ts       # All Zod schemas
├── tasks.errors.ts        # Custom errors
├── user-tasks.store.ts    # User task persistence
├── delegated-tasks.store.ts # Delegated task persistence
└── tasks.test.ts          # Unit tests
```

### Proactive Modules (Phase 6 - DEPRECATED)

**Note**: The proactive scheduler is deprecated in favor of the new Trigger System (see below).

```
src/proactive/
├── proactive.ts           # ProactiveScheduler service (deprecated)
├── proactive.schemas.ts   # Check, Run, Result types
├── proactive.store.ts     # Check and run persistence
├── proactive.checks.ts    # Built-in check implementations
├── proactive.errors.ts    # Custom errors
├── proactive.cli.ts       # Entry point (pnpm proactive)
└── proactive.test.ts      # Unit tests
```

### Trigger System (replaces ProactiveScheduler)

```
src/triggers/
├── triggers.ts            # Main TriggerService class
├── triggers.schemas.ts    # Zod schemas (schedule, trigger, etc.)
├── triggers.store.ts      # Database CRUD operations
├── triggers.scheduler.ts  # In-memory timer management
├── triggers.errors.ts     # Custom error classes
└── triggers.test.ts       # Unit tests
```

The trigger system provides agent-managed scheduled invocations:
- **Schedules**: One-time (`at` datetime) or recurring (`cron` expression)
- **Agent tools**: `create_trigger`, `update_trigger`, `delete_trigger`, `list_triggers`, `notify`
- **Self-management**: Triggers can update or delete themselves
- **Notifications**: Background triggers can notify users via Telegram using the `notify` tool
- **Pre-installed triggers**: `daily-briefing`, `calendar-lookahead`, `stale-followups`

### Day Planner Module

```
src/day-planner/
├── day-planner.ts         # Main DayPlanService
├── day-planner.schemas.ts # DayPlan, Priority, FocusBlock types
├── day-planner.store.ts   # SQLite persistence
├── day-planner.errors.ts  # Custom errors
└── day-planner.test.ts    # Unit tests
```

The day planner provides:
- **Planning sessions**: Interactive daily planning with the agent
- **Day plan context**: Loaded into every agent interaction
- **Priorities**: Ordered list with completion tracking
- **Focus blocks**: Dedicated time for deep work
- **Energy tracking**: User's expected energy level

### Notification Modules (Phase 6)

```
src/notifications/
├── notifications.ts       # NotificationRouter service
├── notifications.schemas.ts # Notification, Channel, AttentionBudget types
├── notifications.store.ts # Notification and channel persistence
├── notifications.attention.ts # Attention budget calculations
├── notifications.errors.ts # Custom errors
└── notifications.test.ts  # Unit tests
```

### Future Modules (see spec/future-phases.md)

```
src/
├── ingress/               # Event sources (Phase 8)
└── learning/              # Feedback and consolidation (Phase 9)
```

## Key Conventions

### TypeScript (see `docs/coding-standards.md` for full details)

- Use `type` over `interface`
- Arrow functions for all function declarations
- Explicit return types
- Consolidated exports at file end (`export type {}` and `export {}`)
- Include `.ts` extensions in imports
- Use Zod for schemas, infer types with `z.infer<typeof schema>`
- Use `#` for private class fields

### Module Organization

```
{module}/
├── {module}.ts            # Main file (public API)
├── {module}.schemas.ts    # Zod schemas
├── {module}.types.ts      # Additional types
├── {module}.utils.ts      # Utilities
├── {module}.errors.ts     # Custom errors
└── {module}.test.ts       # Tests
```

Import from main module file only - never from support files directly.

### Naming

- Files: `kebab-case.ts`
- Types: `PascalCase`
- Schemas: `camelCaseSchema` (e.g., `userSchema`)
- Functions: `camelCase`

## Commands

```bash
pnpm test              # Run all tests (lint + unit)
pnpm test:lint         # ESLint
pnpm test:unit         # Vitest
pnpm build             # TypeScript build
pnpm cli               # Start the interactive CLI
pnpm telegram          # Start the Telegram bot
pnpm proactive         # Start the proactive scheduler
pnpm conversation <id> # Inspect a conversation by ID (debugging)
```

## Debugging Conversations

When a conversation doesn't behave as expected, use these tools to investigate:

```bash
# In Telegram: get the conversation ID
/id

# Inspect conversation history, tool calls, and interrupts
pnpm conversation <conversation-id>

# Interactive testing for reproducing issues
pnpm conversation:test new
pnpm conversation:test send <id> "message"
pnpm conversation:test approve <interrupt-id>
pnpm conversation:test status <id>
```

When working with an AI coding agent to debug:
1. Get the conversation ID from `/id` (Telegram) or the CLI
2. Run `pnpm conversation <id>` and share the output
3. The agent can analyze message flow, tool calls, checkpoint state, and interrupts

See `docs/debugging.md` for detailed debugging workflows, common issues, and advanced techniques.

## Documentation Maintenance

**You are responsible for keeping documentation accurate.**

When working on this codebase:

1. **Update CLAUDE.md** when you:
   - Discover undocumented patterns or conventions
   - Add new modules or significant features
   - Find that documented information is incorrect
   - Learn something that would help future agents

2. **Update spec/agent.md** when you:
   - Implement features that deviate from the spec
   - Discover the spec is ambiguous or incomplete
   - Make architectural decisions not covered by the spec

3. **Update docs/coding-standards.md** when you:
   - Find the team is using patterns not documented
   - Discover exceptions or clarifications needed

4. **Fix discrepancies immediately** - If code doesn't match docs, either:
   - Update the code to match (if docs are correct)
   - Update the docs to match (if code is correct)
   - Ask the user if unclear which is authoritative

## Current Status

**Version**: 1.0 - Initial Implementation Complete (Phases 1-7) - 580+ passing tests

**External Clients**: Telegram bot available (see `spec/telegram.md`)

### Implementation Phases

All initial phases are complete:

1. **Foundation Layer** - User Model, Contacts, Calendar, Location, Context Builder ✅
2. **Core Orchestration** - Tools, Orchestrator, Personality, CLI ✅
3. **Human in the Loop** - Interrupts, Risk Gate, Approvals ✅
4. **Memory** - Storage, Embeddings, Recall, Entity Knowledge, Operator Manuals ✅
5. **Long-Running Tasks** - User Tasks, Delegated Tasks, Multi-step workflows ✅
6. **Proactive & Notifications** - Scheduler, Channels, Attention Budget ✅
7. **Tool Discovery** - Tool Sets, Discovery Agent, Agent Registry ✅

### Future Phases

See `spec/future-phases.md` for planned capabilities:
- Phase 8: Reactive Events (webhooks, external integrations)
- Phase 9: Learning & Refinement (feedback, consolidation, pattern extraction)

### Running the CLI

```bash
# Set API key (required)
export GLADOS_LLM_API_KEY=sk-or-v1-your-key

# Optional: customize model
export GLADOS_LLM_MODEL=anthropic/claude-sonnet-4

# Start the CLI
pnpm cli
```

### Running the Telegram Bot

```bash
# Set required environment variables
export GLADOS_LLM_API_KEY=sk-or-v1-your-key
export GLADOS_TELEGRAM_BOT_TOKEN=123456:ABC-DEF  # From @BotFather
export GLADOS_TELEGRAM_OWNER_ID=12345678          # Your Telegram user ID

# Start the Telegram bot
pnpm telegram
```

See `docs/getting-started.md` for full setup instructions.

## Key Architectural Decisions

These have been decided and documented in the spec:

### Two-Layer Architecture

- **Foundation Layer**: User Model, Contacts, Calendar, Memory - always available context
- **Orchestration Layer**: Orchestrator, Trigger System, Task Queue, Notifications

### Core Infrastructure (not optional tools)

The "who, where, when" foundation:

- **User Model**: Identity, projects, goals, routines - shapes every interaction
- **Contacts**: First-class people/relationships - agent knows who's involved
- **Calendar**: Time awareness is fundamental - always knows what's coming
- **Location**: Where you are matters - travel times, context-aware suggestions, geofenced reminders

### Proactive, Not Just Reactive

- **Trigger System**: Agent-managed scheduled invocations (one-time or cron)
- **Pre-installed triggers**: Calendar lookahead, stale follow-ups, daily briefing
- **Day Planning**: Structured daily planning with priorities and focus blocks
- **Long-running tasks**: Multi-step workflows that span hours/days

### Memory

- **Storage**: sqlite-vss (vector search in SQLite)
- **Types**: conversation, fact, preference, procedure, feedback, event, entity, operator_manual
- **Entity Knowledge**: Knowledge about things in user's world (companies, products, documents)
- **Operator Manuals**: Procedural knowledge that evolves through user corrections
- **Consolidation**: 4-tier approach
  - Tier 1: Conversation summarization (per conversation)
  - Tier 2: Fact deduplication (daily)
  - Tier 3: Importance decay (weekly)
  - Tier 4: Pattern extraction (monthly)

### Human in the Loop

- **Risk Profiles**: Tools declare risk level (`low` | `medium` | `high` | `critical`)
- **Graph-enforced**: Risk Gate is a graph node - agent cannot bypass
- **Interrupts**: Persist to DB, support timeout behaviors, multi-channel escalation

### Notifications

- **Multi-channel**: CLI and Telegram (extensible to more channels)
- **Smart routing**: Based on urgency, time of day, user availability
- **Attention Budget**: Tracks interruption frequency to avoid over-notifying
- **Quiet hours**: Configurable, with critical override
- **Focus blocks**: Manual DND mode with automatic expiry

### Agent Registry (Phase 7)

- **Agent Specifications**: Define sub-agents with purpose, tools, model tier
- **Evolution**: Agents can be evolved from parents with modifications
- **Feedback Tracking**: Usage and outcome tracking for agent improvement
- **Model Selection**: fast | balanced | capable | premium tiers

## Zod 4 Notes

This project uses Zod 4 which has some differences from Zod 3:

- **Input vs Output types**: Use `z.input<typeof schema>` for function parameter types when the schema has defaults. Use `z.infer` for output types.
- **Optional with defaults**: Use `.optional().default(value)` pattern for fields that should be optional in input but have defaults.
- **Records require key schema**: `z.record(z.string(), valueSchema)` instead of `z.record(valueSchema)`.
- **Object defaults**: When using `.default({})` on object schemas, provide the full default object with all required values.

## Notes

- All initial phases (1-7) are complete with 580+ passing tests
- Configuration uses Convict - see `src/config/config.ts`
- The CLI requires `GLADOS_LLM_API_KEY` to be set
- The Telegram bot requires `GLADOS_TELEGRAM_BOT_TOKEN` and `GLADOS_TELEGRAM_OWNER_ID`
- The trigger system is integrated into the Telegram bot (triggers fire and notify via Telegram)
- Default LLM provider is OpenRouter (`https://openrouter.ai/api/v1`)
- External clients use the same OrchestratorService as the CLI
- Future phases (8-9) are documented in `spec/future-phases.md`
