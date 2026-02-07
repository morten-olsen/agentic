# Source Directory Restructure Specification

> Reorganize the flat src/ directory into logical groupings for better discoverability and maintainability.

**Version**: 1.0
**Status**: Implemented
**Dependencies**: None

## Overview

The `src/` directory currently contains 29 top-level modules, making it difficult to understand the codebase structure at a glance. This spec proposes grouping related modules into logical categories.

### Goals

1. Make the codebase easier to navigate and understand
2. Group related functionality together
3. Clarify the architectural layers of the system
4. Maintain all existing functionality (pure refactor)

### Non-Goals (for v1)

- Changing any module's internal structure
- Renaming any modules
- Changing any public APIs
- Moving files within modules

---

## Current Structure

```
src/
├── api/                 # HTTP webhooks
├── artifacts/           # Large data storage
├── calendar/            # Events, scheduling
├── cli/                 # Interactive CLI
├── clients/             # External clients (Telegram)
├── config/              # Configuration
├── contacts/            # People and relationships
├── context/             # Context Builder
├── database/            # Knex + SQLite
├── day-planner/         # Daily planning
├── embeddings/          # Embedding generation
├── events/              # Event log
├── exports.ts           # Re-exports
├── external/            # External services (Home Assistant)
├── health/              # Health data (Oura)
├── location/            # Places, location tracking
├── logging/             # Structured logging
├── memory/              # Memory system
├── notifications/       # Multi-channel notifications
├── orchestrator/        # LangGraph orchestration
├── personality/         # Agent personality
├── scripts/             # Utility scripts
├── server/              # Server entry point
├── services/            # DI container
├── skills/              # Domain capabilities
├── store/               # Base store abstraction
├── tasks/               # User/delegated tasks
├── tools/               # Tool system
├── triggers/            # Scheduled invocations
├── user-model/          # Identity, projects, goals
└── utils/               # Utilities
```

**Problem**: 29 top-level directories makes it hard to:
- Understand what the system does
- Find where to make changes
- See the architectural layers

---

## Proposed Structure

```
src/
├── core/                    # Foundation infrastructure
│   ├── config/              # Convict configuration
│   ├── database/            # Knex + SQLite + migrations
│   ├── logging/             # Structured logging
│   ├── server/              # HTTP server entry point
│   ├── services/            # DI container
│   ├── store/               # Base store abstraction
│   └── utils/               # Shared utilities
│
├── domain/                  # User's world model
│   ├── calendar/            # Events, scheduling, sync
│   ├── contacts/            # People and relationships
│   ├── location/            # Places, location tracking
│   └── user-model/          # Identity, projects, goals
│
├── agent/                   # AI orchestration layer
│   ├── context/             # Context Builder
│   ├── embeddings/          # Embedding generation
│   ├── memory/              # Storage, recall, entity knowledge
│   ├── orchestrator/        # LangGraph orchestration
│   ├── personality/         # Agent personality config
│   ├── skills/              # Domain-specific capabilities
│   └── tools/               # Tool system + adapters
│
├── features/                # Proactive capabilities
│   ├── artifacts/           # Large data storage
│   ├── day-planner/         # Daily planning sessions
│   ├── events/              # Event log system
│   ├── notifications/       # Multi-channel notifications
│   ├── tasks/               # User & delegated tasks
│   └── triggers/            # Scheduled invocations
│
├── integrations/            # External world
│   ├── api/                 # HTTP webhooks
│   ├── cli/                 # Interactive CLI
│   ├── clients/             # External clients (Telegram)
│   ├── external/            # External services (Home Assistant)
│   └── health/              # Health data (Oura)
│
├── scripts/                 # Dev/debug scripts (stays top-level)
└── exports.ts               # Public re-exports
```

---

## Architecture

### Layer Dependencies

```
┌─────────────────────────────────────────────────────────────┐
│                      integrations/                          │
│         (api, cli, clients, external, health)               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        features/                            │
│  (artifacts, day-planner, events, notifications, tasks,     │
│   triggers)                                                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                         agent/                              │
│  (context, embeddings, memory, orchestrator, personality,   │
│   skills, tools)                                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                         domain/                             │
│         (calendar, contacts, location, user-model)          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                          core/                              │
│  (config, database, logging, server, services, store, utils)│
└─────────────────────────────────────────────────────────────┘
```

### Grouping Rationale

| Group | Purpose | Contents |
|-------|---------|----------|
| **core/** | Foundation that everything depends on | config, database, logging, server, services, store, utils |
| **domain/** | Model of the user's world | calendar, contacts, location, user-model |
| **agent/** | AI/LLM orchestration | context, embeddings, memory, orchestrator, personality, skills, tools |
| **features/** | Proactive capabilities built on top | artifacts, day-planner, events, notifications, tasks, triggers |
| **integrations/** | External interfaces and services | api, cli, clients, external, health |

---

## Implementation Phases

### Phase 1: Create Directory Structure

- [x] Create `core/` directory
- [x] Create `domain/` directory
- [x] Create `agent/` directory
- [x] Create `features/` directory
- [x] Create `integrations/` directory

### Phase 2: Move Core Modules

- [x] Move `config/` → `core/config/`
- [x] Move `database/` → `core/database/`
- [x] Move `logging/` → `core/logging/`
- [x] Move `server/` → `core/server/`
- [x] Move `services/` → `core/services/`
- [x] Move `store/` → `core/store/`
- [x] Move `utils/` → `core/utils/`

### Phase 3: Move Domain Modules

- [x] Move `calendar/` → `domain/calendar/`
- [x] Move `contacts/` → `domain/contacts/`
- [x] Move `location/` → `domain/location/`
- [x] Move `user-model/` → `domain/user-model/`

### Phase 4: Move Agent Modules

- [x] Move `context/` → `agent/context/`
- [x] Move `embeddings/` → `agent/embeddings/`
- [x] Move `memory/` → `agent/memory/`
- [x] Move `orchestrator/` → `agent/orchestrator/`
- [x] Move `personality/` → `agent/personality/`
- [x] Move `skills/` → `agent/skills/`
- [x] Move `tools/` → `agent/tools/`

### Phase 5: Move Feature Modules

- [x] Move `artifacts/` → `features/artifacts/`
- [x] Move `day-planner/` → `features/day-planner/`
- [x] Move `events/` → `features/events/`
- [x] Move `notifications/` → `features/notifications/`
- [x] Move `tasks/` → `features/tasks/`
- [x] Move `triggers/` → `features/triggers/`

### Phase 6: Move Integration Modules

- [x] Move `api/` → `integrations/api/`
- [x] Move `cli/` → `integrations/cli/`
- [x] Move `clients/` → `integrations/clients/`
- [x] Move `external/` → `integrations/external/`
- [x] Move `health/` → `integrations/health/`

### Phase 7: Update Imports

- [x] Update all import paths across the codebase
- [x] Update `exports.ts` with new paths
- [x] Verify TypeScript compilation passes

### Phase 8: Update Documentation

- [x] Update `CLAUDE.md` project structure section
- [x] Update `package.json` script paths

### Phase 9: Verify

- [x] Run full test suite (`pnpm test`) - 1039 tests passing
- [x] Run TypeScript build (`pnpm build`)
- [x] Verify CLI starts (`pnpm cli`)
- [ ] Verify Telegram bot starts (`pnpm telegram`) - requires API key

---

## Migration Strategy

Each phase should be a separate commit for easy rollback:

1. **Atomic moves**: Move one group at a time
2. **Update imports immediately**: After each group move, update all imports
3. **Test after each phase**: Run `pnpm test` after each phase
4. **Git moves**: Use `git mv` to preserve history

### Import Update Approach

After moving a module, all imports need updating. Example:

```typescript
// Before
import { Database } from '../database/database.ts'

// After
import { Database } from '../core/database/database.ts'
```

Use find-and-replace with regex:
- Pattern: `from '([^']*)/database/`
- Replace: `from '$1/core/database/`

---

## Future Considerations

- Consider adding `index.ts` barrel files to each group directory
- Could add stricter import rules (e.g., features can't import from integrations)
- May want to split `memory/` if it grows (embeddings is already separate)
