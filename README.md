# GLaDOS

**General Learning and Decision Orchestration System**

A personal AI assistant that knows who you are, anticipates your needs, and handles complex multi-step tasks - like having Jarvis for yourself.

## Vision

Most AI assistants are stateless chatbots. You start every conversation from scratch, re-explaining context, preferences, and history. GLaDOS takes a different approach: it maintains a **persistent model of you** and operates as a true assistant rather than a question-answering service.

GLaDOS is designed to:

- **Know who you are** - Your projects, goals, relationships, and routines shape every interaction
- **Anticipate your needs** - Proactively surface information, follow up on tasks, and remind you about important things
- **Handle complex work** - Manage multi-step tasks that span hours or days, not just single-turn requests
- **Learn over time** - Build long-term memory, recognize patterns, and improve with every interaction
- **Maintain your trust** - Human-in-the-loop controls for risky actions, transparent about what it's doing

## How It Works

### The User Model

At the core of GLaDOS is a rich understanding of you:

- **Identity**: Name, timezone, working hours, communication preferences
- **Projects**: What you're working on, status, priorities, related people
- **Goals**: Short and long-term objectives you're pursuing
- **Routines**: Regular patterns in your day and week
- **Contacts**: People in your life, relationships, interaction history

This isn't just stored data - it actively shapes how GLaDOS responds. It knows that "the client meeting" refers to Acme Corp because that's your active project. It knows not to schedule things during your focus blocks. It remembers that Sarah prefers email over Slack.

### Memory System

GLaDOS maintains persistent memory across all conversations:

- **Episodic Memory**: Remembers past conversations and what was discussed
- **Semantic Memory**: Extracts and stores facts, preferences, and knowledge
- **Entity Knowledge**: Builds detailed profiles of people, projects, and places
- **Procedural Memory**: Learns how you like things done

The memory system uses activation-based decay - frequently accessed memories stay readily available, while older memories consolidate into higher-level knowledge. This keeps the system responsive even with years of accumulated information.

### Trigger System

GLaDOS can schedule future invocations of itself:

- **One-time triggers**: "Remind me to call Mom on Sunday at 3pm"
- **Recurring triggers**: Daily briefings, weekly reviews, hourly monitoring
- **Stateful monitoring**: Track changes over time, only notify when something actually changes

When a trigger fires, GLaDOS runs in the background with a specific goal. It can access all its normal capabilities and notify you via Telegram if it discovers something relevant.

### Task Management

For work that spans multiple interactions:

- **User Tasks**: Things you need to do, with deadlines and priorities
- **Delegated Tasks**: Multi-step work GLaDOS handles autonomously
- **Follow-ups**: Tracking items waiting on others

Delegated tasks can involve multiple tool calls, web searches, file operations, and more - all managed across sessions with human approval for risky steps.

### Tools and Skills

GLaDOS has access to tools organized into:

- **Core Tools**: Memory, calendar, contacts, tasks, notifications
- **External Tools**: Web search, file operations, API calls
- **Skills**: Domain-specific capability bundles that activate on demand

Tools are risk-gated. Low-risk actions (reading data, searching) happen immediately. High-risk actions (sending messages, modifying files, making purchases) require your approval.

### Integrations

Current external service integrations:

- **Calendar**: Google Calendar sync for scheduling awareness
- **Health**: Oura Ring data for sleep, activity, and readiness insights
- **Home**: Home Assistant for smart home awareness and control
- **Notifications**: Telegram for mobile alerts and conversations

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           GLaDOS Core                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Foundation Layer                                                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │  User    │ │ Contacts │ │ Calendar │ │ Location │ │  Memory  │  │
│  │  Model   │ │          │ │          │ │          │ │          │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘  │
│       └────────────┴────────────┴────────────┴────────────┘        │
│                                  │                                   │
│                                  ▼                                   │
│                        ┌─────────────────┐                          │
│                        │ Context Builder │                          │
│                        └────────┬────────┘                          │
│                                 │                                    │
│  Orchestration Layer            ▼                                    │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                                                               │   │
│  │  ┌─────────┐    ┌─────────────┐    ┌──────────┐             │   │
│  │  │Triggers │───▶│ Orchestrator│◀───│  Clients │             │   │
│  │  │         │    │ (LangGraph) │    │(CLI/Tgram)│            │   │
│  │  └─────────┘    └──────┬──────┘    └──────────┘             │   │
│  │                        │                                      │   │
│  │         ┌──────────────┼──────────────┐                      │   │
│  │         ▼              ▼              ▼                      │   │
│  │   ┌──────────┐  ┌───────────┐  ┌───────────┐                │   │
│  │   │  Tasks   │  │Risk Gate  │  │  Notify   │                │   │
│  │   │  Queue   │  │& Approvals│  │  Router   │                │   │
│  │   └──────────┘  └─────┬─────┘  └───────────┘                │   │
│  │                       │                                       │   │
│  │         ┌─────────────┼─────────────┐                        │   │
│  │         ▼             ▼             ▼                        │   │
│  │   ┌──────────┐  ┌──────────┐  ┌──────────┐                  │   │
│  │   │  Tools   │  │  Skills  │  │ External │                  │   │
│  │   │          │  │          │  │ Services │                  │   │
│  │   └──────────┘  └──────────┘  └──────────┘                  │   │
│  │                                                               │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Tech Stack**: Node.js 22+ | LangChain + LangGraph | SQLite | Zod | Vitest

## Interfaces

### Command Line Interface

The CLI provides a desktop terminal interface for direct interaction. Supports rich formatting, multi-turn conversations, and full access to all capabilities.

### Telegram Bot

For mobile access, GLaDOS runs as a Telegram bot. This is also the notification channel for trigger-invoked sessions - when GLaDOS discovers something important while running in the background, it notifies you here.

## Example Interactions

### Context-Aware Assistance

```
You: What's on my schedule today?

GLaDOS: Here's your day (Tuesday, Feb 4):

  9:00 AM  - Team standup (15 min)
  11:00 AM - Client call with Acme Corp
             Attendees: Sarah Chen, Mike Torres
  2:00 PM  - 1:1 with Jamie

  You have 2 hours free this morning. Would you like me
  to help you prepare for the client call?

You: Yes, summarize where we are with their project

GLaDOS: Acme Corp - Website Redesign (Phase 2)

  Status: In Progress (65% complete)

  Recent:
  - Approved homepage mockups last week
  - Mike sent technical requirements yesterday

  Open items:
  - Your review of the requirements doc
  - Schedule design review meeting

  The requirements doc has 3 items worth discussing...
```

### Proactive Monitoring

```
[8:00 AM - Trigger fires: Daily Briefing]

GLaDOS: Good morning! Here's your Tuesday briefing:

  Weather: 52°F, cloudy, rain expected after 4pm

  Calendar: 3 meetings today (standup, client call, 1:1)

  Tasks due: Review Acme requirements (due today)

  Heads up: Sarah's birthday is tomorrow
```

### Stateful Change Detection

```
[Hourly trigger: Train Status Monitor]

First check:
  - Detects 15-minute delay
  - Notifies you: "Northern line delayed 15 minutes"
  - Records: "Notified about delay"

Second check:
  - Same delay, reads previous note
  - Skips notification (already told you)

Third check:
  - Delay resolved
  - Notifies: "Good news - Northern line back on schedule"
```

## Project Status

**Version 1.1** - Memory Consolidation Complete

Implemented capabilities:

- **Foundation**: User Model, Contacts, Calendar, Location
- **Memory**: Semantic search, entity knowledge, activation decay, consolidation
- **Orchestration**: LangGraph agent, risk-gated tools, human-in-the-loop approvals
- **Tasks**: User tasks, delegated workflows, follow-ups
- **Triggers**: Scheduled invocations with continuation context
- **Notifications**: Telegram delivery with attention budget
- **Skills**: Domain-specific capability bundles with gated activation
- **Health**: Oura Ring integration for sleep and activity data
- **Interfaces**: CLI and Telegram bot

See [spec/future-phases.md](spec/future-phases.md) for planned features including reactive events (webhooks, email triggers) and advanced learning capabilities.

## Documentation

| Document | Description |
|----------|-------------|
| [Usage Examples](docs/usage-examples.md) | Conversation patterns and interaction examples |
| [Getting Started](docs/getting-started.md) | Setup and configuration guide |
| [Configuration](docs/configuration.md) | All configuration options |
| [Triggers](docs/triggers.md) | Scheduled agent invocations |
| [Skills](docs/skills.md) | Domain-specific capability system |
| [Memory Consolidation](docs/memory-consolidation.md) | Long-term memory management |
| [External Services](docs/external-services.md) | Integrating external services |

For development documentation, see [CLAUDE.md](CLAUDE.md).

## License

MIT
