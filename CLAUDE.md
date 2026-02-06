# GLaDOS - AI Coding Agent Guide

This document provides context for AI coding agents working on this codebase. **This is a living document** - update it when you discover new patterns, fix discrepancies, or when the project evolves.

## Project Overview

GLaDOS (General Learning and Decision Orchestration System) is a **personal AI assistant** designed to be "Jarvis for yourself". It maintains a rich model of you (identity, projects, goals, relationships), operates proactively (not just reactively), handles long-running tasks, and learns from every interaction.

**Key differentiators from a generic chatbot:**

- Knows _who you are_ (User Model, Contacts, Calendar as core infrastructure)
- Anticipates needs (Trigger System, daily briefings, day planning)
- Manages multi-step tasks that span hours/days (Task Queue)
- Human-in-the-loop for trust (risk-gated tools, approval flows)

## Tech Stack

| Component       | Technology                                    |
| --------------- | --------------------------------------------- |
| Runtime         | Node.js 22+ with `--experimental-strip-types` |
| Agent Framework | LangChain + LangGraph                         |
| Database        | Knex + SQLite                                 |
| Validation      | Zod 4                                         |
| Configuration   | Convict                                       |
| Testing         | Vitest                                        |

## Documentation

| Document | Description |
|----------|-------------|
| `docs/coding-standards.md` | TypeScript conventions (types, functions, exports, classes) |
| `docs/testing-strategy.md` | Testing patterns and infrastructure |
| `docs/debugging.md` | Conversation-level debugging tools and techniques |
| `docs/getting-started.md` | Full setup guide |
| `docs/configuration.md` | Configuration reference |
| `docs/external-clients.md` | Building new interfaces (Telegram, etc.) |
| `docs/external-services.md` | Integrating external services (Home Assistant, Oura) |
| `docs/skills.md` | Skills system usage and development |
| `docs/artifacts.md` | Server-side storage for large tool responses |
| `docs/specs.md` | How to work with specifications |
| `spec/001-agent.md` | Main technical specification |

Specifications live in `spec/` - see `docs/specs.md` for the workflow.

## Commands

| Command | Description |
|---------|-------------|
| `pnpm test` | Run all tests (lint + unit) |
| `pnpm test:lint` | ESLint |
| `pnpm test:unit` | Vitest |
| `pnpm build` | TypeScript build |
| `pnpm cli` | Start the interactive CLI |
| `pnpm telegram` | Start the Telegram bot |
| `pnpm conversation <id>` | Inspect a conversation by ID (debugging) |

## Quick Conventions Reference

See `docs/coding-standards.md` for full details. Key rules:

- **Types**: Use `type` over `interface`
- **Functions**: Arrow functions, explicit return types
- **Exports**: Consolidated at file end (`export type {}` and `export {}`)
- **Imports**: Include `.ts` extensions
- **Schemas**: Zod with `{name}Schema` naming, infer types with `z.infer`
- **Private fields**: Use `#` for private class fields
- **Naming**: Files `kebab-case.ts`, Types `PascalCase`, Functions `camelCase`

## Module Organization

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

## Project Structure

```
glados/
├── CLAUDE.md              # This file
├── README.md              # User-facing documentation
├── docs/                  # Documentation
├── spec/                  # Feature specifications
├── test/                  # Flow tests (MSW-based)
└── src/
    ├── config/            # Convict-based configuration
    ├── database/          # Knex + SQLite + migrations
    ├── services/          # Service container (DI)
    ├── user-model/        # Identity, projects, goals, routines
    ├── contacts/          # People and relationships
    ├── calendar/          # Events, scheduling
    ├── location/          # Places, location tracking
    ├── context/           # Context Builder
    ├── personality/       # Agent personality config
    ├── tools/             # Tool system + LangChain adapters
    ├── orchestrator/      # LangGraph agent orchestration
    ├── memory/            # Storage, embeddings, entity knowledge
    ├── tasks/             # User tasks, delegated tasks
    ├── triggers/          # Agent-managed scheduled invocations
    ├── day-planner/       # Daily planning sessions
    ├── notifications/     # Multi-channel notifications
    ├── skills/            # Domain-specific capabilities
    ├── artifacts/         # Large data storage
    ├── external/          # External service integrations (Home Assistant, Oura)
    ├── health/            # Health data from wearables (Oura Ring)
    ├── api/               # Fastify HTTP server for webhooks
    ├── cli/               # Interactive CLI
    └── clients/           # External client interfaces (Telegram)
```

## Debugging Conversations

When a conversation doesn't behave as expected:

```bash
# In Telegram: get the conversation ID
/id

# Inspect conversation history, tool calls, and interrupts
pnpm conversation <conversation-id>
```

See `docs/debugging.md` for detailed workflows.

## Current Status

**Version**: 1.0 - Initial Implementation Complete (Phases 1-8) - 1039+ passing tests

All initial phases are complete:

1. Foundation Layer - User Model, Contacts, Calendar, Location, Context Builder
2. Core Orchestration - Tools, Orchestrator, Personality, CLI
3. Human in the Loop - Interrupts, Risk Gate, Approvals
4. Memory - Storage, Embeddings, Recall, Entity Knowledge
5. Long-Running Tasks - User Tasks, Delegated Tasks, Multi-step workflows
6. Notifications - Channels, Attention Budget
7. Tool Discovery - Tool Sets, Discovery Agent
8. Skills System - Gated domain-specific capabilities, approval flow
9. Health Tracking - Oura Ring integration, webhook-based data ingestion

Future phases are documented in `spec/future-phases.md`.

## Running the CLI

```bash
export GLADOS_LLM_API_KEY=sk-or-v1-your-key
pnpm cli
```

## Running the Telegram Bot

```bash
export GLADOS_LLM_API_KEY=sk-or-v1-your-key
export GLADOS_TELEGRAM_BOT_TOKEN=123456:ABC-DEF
export GLADOS_TELEGRAM_OWNER_ID=12345678
pnpm telegram
```

## Documentation Maintenance

When working on this codebase:

1. **Update CLAUDE.md** when you:
   - Discover undocumented patterns or conventions
   - Add new modules or significant features
   - Find that documented information is incorrect

2. **Update spec files** when you:
   - Implement features that deviate from the spec
   - Discover the spec is ambiguous or incomplete
   - Make architectural decisions not covered by the spec

3. **Update docs/** when you:
   - Find patterns not documented
   - Discover exceptions or clarifications needed

4. **Fix discrepancies immediately** - If code doesn't match docs, either:
   - Update the code to match (if docs are correct)
   - Update the docs to match (if code is correct)
   - Ask the user if unclear which is authoritative

## Zod 4 Notes

This project uses Zod 4 which has some differences from Zod 3:

- **Input vs Output types**: Use `z.input<typeof schema>` for function parameter types when the schema has defaults. Use `z.infer` for output types.
- **Optional with defaults**: Use `.optional().default(value)` pattern for fields that should be optional in input but have defaults.
- **Records require key schema**: `z.record(z.string(), valueSchema)` instead of `z.record(valueSchema)`.

## Notes

- Configuration uses Convict - see `src/config/config.ts`
- Default LLM provider is OpenRouter (`https://openrouter.ai/api/v1`)
- External clients use the same OrchestratorService as the CLI
- The trigger system is integrated into the Telegram bot (triggers fire and notify via Telegram)
