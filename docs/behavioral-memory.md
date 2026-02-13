# Behavioral Memory

Behavioral memory gives the agent a structured way to learn from interactions. Instead of improvising from first principles every time, the agent builds **behavioral templates** — lightweight strategy documents that describe how to act in specific situations. Templates evolve through user feedback, creating a closed loop between action and outcome.

## Overview

The core pattern:

1. **Index** — The agent's context includes the top 10 behavioral templates most relevant to the current conversation (selected by semantic search against user projects, goals, time of day, and priorities)
2. **Fetch** — When a template looks relevant, the agent fetches the full strategy via tool
3. **Act** — The agent follows the template's approach and guidelines
4. **Record** — After acting, the agent records the outcome (user reaction, engagement, corrections)

If no template matches, the agent acts on best judgment and creates a new template afterward.

```
Agent context includes: Top 10 Behavioral Templates (semantic match)
  ├── "Morning briefing" (planning, confidence: 0.8)
  ├── "Task reminders" (productivity, confidence: 0.4)
  └── ... ranked by relevance

Agent decides to act
    ↓
Template matches? → Fetch full strategy and follow it
No match?         → Act on best judgment, create template from outcome
    ↓
Observe outcome → Update template evidence → Refine strategy if needed
```

## Template Structure

Each behavioral template contains:

| Field | Description |
|-------|-------------|
| `situation` | What triggers this template — description, category, trigger patterns |
| `strategy` | The playbook — approach, guidelines, optional tone/timing/parameters |
| `evidence` | Track record — total interactions, positive/negative/neutral outcomes, confidence score |
| `activationScore` | How actively this template is used (decays over time, boosts on use) |
| `status` | `active`, `dormant`, or `retired` |

### Example Template

```
Situation: "User asks about their day plan"
Category: planning
Trigger patterns: ["day plan", "what should I do today", "priorities"]

Strategy:
  Approach: "Provide a structured summary with top 3 priorities"
  Guidelines:
    - Keep it under 5 items
    - Start with most urgent
    - Include time estimates when available

Evidence:
  Total interactions: 12
  Positive: 9, Negative: 1, Neutral: 2
  Confidence: 0.7
```

## Tools

The agent interacts with behavioral memory through four tools:

| Tool | Description |
|------|-------------|
| `behavioral.getTemplate` | Fetch full template by ID (from the context index) |
| `behavioral.searchTemplates` | Search templates by semantic similarity |
| `behavioral.createTemplate` | Create a new template for a novel situation |
| `behavioral.recordOutcome` | Record the outcome of an action |

### Recording Outcomes

Outcomes can be recorded in two scenarios:

1. **Current conversation** — provide `templateId` directly after acting
2. **Pending outcome** — for background actions (triggers, notifications), the agent creates a pending outcome that gets resolved when the user responds in a later conversation

Outcome signals:
- `positive` — user reacted well (thanked, engaged, asked follow-up)
- `negative` — user reacted poorly (dismissed, complained, ignored)
- `neutral` — no clear signal either way
- `correction` — user explicitly corrected the approach

When recording an outcome, the agent can also provide a `strategyChange` to refine the template's approach based on what happened.

## Pending Outcomes

Some actions happen outside of a direct conversation — like a scheduled notification or a triggered check-in. The agent can't immediately observe the user's reaction.

The **pending outcome** pattern handles this:

1. Agent takes action (e.g., sends morning briefing via trigger)
2. Agent creates a pending outcome: "Sent morning briefing with 3 priorities"
3. Pending outcomes appear in the behavioral index under "Awaiting Feedback"
4. When the user next responds, the agent sees the pending outcome and records what happened
5. Pending outcomes expire after 24 hours if no feedback arrives (recorded as neutral)

## Template Lifecycle

```
Creation (novel situation)
    ↓
Active use (matching, fetching, following)
    ↓ activation decays without use
Dormant (low activation, still searchable)
    ↓ continued poor performance
Retired (hidden from index, preserved for history)
```

### Confidence Score

Confidence is calculated from the evidence record:

- Base: positive outcome rate minus weighted negative rate
- Boost: more interactions increase confidence (up to +0.2)
- Range: 0.0 (untested/poor) to 1.0 (consistently effective)

New templates start at 0.3 confidence.

## Maintenance

Background maintenance runs periodically:

| Job | Description |
|-----|-------------|
| **Activation decay** | Templates lose activation score over time (1% daily). Keeps the index fresh — unused templates fade away. |
| **Pending outcome expiration** | Unresolved pending outcomes expire after 24 hours and are recorded as neutral. |
| **Poor template retirement** | Templates with enough interactions but consistently poor outcomes get retired. |

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `maxTemplatesInIndex` | 10 | Max templates shown in context |
| `maxPendingInIndex` | 10 | Max pending outcomes shown in context |
| `lastOutcomesWindowSize` | 20 | Rolling window of recent outcomes per template |
| `activationDecayRate` | 0.01 | Daily activation decay (1%) |
| `retirementThreshold` | 0.1 | Max positive rate before retirement |
| `retirementMinInteractions` | 10 | Min interactions before retirement eligible |
| `pendingOutcomeExpirationHours` | 24 | Hours before pending outcomes expire |

## Context Integration

The behavioral index is included in the agent's context alongside other context (user model, calendar, location, etc.). The index is built by:

1. Generating a compact summary from user projects, goals, time of day, and day plan priorities
2. Embedding this summary and searching for semantically similar templates
3. Formatting the top matches as a readable index with IDs and confidence scores
4. Including any pending outcomes awaiting feedback

This means the templates shown vary based on what the user is currently working on — a conversation about coding surfaces development-related templates, while a morning check-in surfaces planning templates.

## Further Reading

- `spec/020-behavioral-memory.md` — Full technical specification with schemas and implementation details
