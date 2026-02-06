# Working with Specifications

This document explains how to work with specifications in the GLaDOS project.

## Purpose

Specifications are design documents for features:

- Written **before** implementation to clarify requirements
- Reference **during** development for guidance
- Updated **after** implementation if deviations were necessary

Specs are authoritative for their domain. If code and spec disagree, one must be updated.

## Location

Specifications live in the `spec/` directory with numbered prefixes:

- `001-agent.md` - Main system specification
- `002-telegram.md`, `003-triggers.md`, etc. - Feature specifications
- `future-phases.md` - Planned but not yet implemented features
- `*-future.md` - Future extensions to existing features

## Spec Status

Each spec declares its status in the frontmatter:

| Status | Meaning |
|--------|---------|
| **Draft** | Initial design, not yet implemented |
| **In Progress** | Being actively implemented |
| **Implemented** | Complete, tests passing |
| **Deprecated** | Superseded by another spec |

## Standard Format

Every spec should follow this format:

```markdown
# {Feature} Specification

> One-line description

**Version**: 1.0
**Status**: Draft | In Progress | Implemented | Deprecated
**Dependencies**: List of dependent specs/features (if any)

## Overview

Brief description and context.

### Goals

1. What this feature should accomplish

### Non-Goals (for v1)

- What this feature explicitly won't do

---

## Architecture

Diagram and explanation of components.

---

## Data Model

TypeScript types and schemas.

---

## Database Schema

SQL migrations (if applicable).

---

## Implementation Phases

Checklist of implementation steps:

### Phase 1: Core Infrastructure

- [x] Completed item
- [ ] Pending item

### Phase 2: Integration

- [ ] Items for phase 2

---

## Future Considerations

Ideas for future enhancement (out of scope for current version).
```

## Workflow

### Creating a New Spec

1. Create `spec/NNN-feature-name.md` (next available number)
2. Set **Status: Draft**
3. Write the Overview, Goals, Non-Goals sections
4. Design the architecture and data model
5. Create Implementation Phases checklist

### During Implementation

1. Update **Status: In Progress**
2. Mark completed items with `[x]` as you go
3. Update the spec if you deviate from the design
4. Document why changes were made

### After Implementation

1. Ensure all Implementation Phases are marked complete
2. Update **Status: Implemented**
3. Update the Version if significant changes were made

### Deprecating a Spec

1. Update **Status: Deprecated**
2. Add a note at the top pointing to the replacement
3. Keep the file for historical reference

## Current Specs

| Spec | Status | Description |
|------|--------|-------------|
| 001-agent.md | Implemented | Main system architecture (Phases 1-8) |
| 002-telegram.md | Implemented | Telegram bot integration |
| 003-triggers.md | Implemented | Agent-managed scheduled invocations |
| 004-day-planner.md | Implemented | Daily planning sessions |
| 005-trigger-continuation.md | Implemented | Stateful triggers through continuation notes |
| 006-skills.md | Implemented | Domain-specific capabilities with gated activation |
| 008-artifacts.md | Implemented | Server-side storage for large data |
| 009-external-services.md | Implemented | Third-party service integration |
| 010-debugging-skill.md | In Progress | System introspection and debugging |
| 011-logging.md | Draft | Structured logging system |
| 012-calendar-sync.md | Completed | Calendar synchronization from external sources |
| 013-context-change-detection.md | Draft | Incremental context updates with change detection |

## Tips for AI Agents

When working with specs:

1. **Read the spec first** before implementing a feature
2. **Check Implementation Phases** for what's done vs pending
3. **Update the spec** if you make different design decisions
4. **Keep status current** - mark items complete as you go
5. **Reference the spec** in commit messages when implementing features
