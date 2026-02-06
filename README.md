# GLaDOS

**General Learning and Decision Orchestration System**

A personal AI assistant that knows who you are, anticipates your needs, and handles complex multi-step tasks - like having Jarvis for yourself.

## What Makes GLaDOS Different

Unlike generic chatbots, GLaDOS maintains a **rich model of you**:

- **Identity**: Your projects, goals, and routines shape every interaction
- **Relationships**: Knows who's important in your life and work
- **Context**: Calendar awareness, location context, and time-sensitive information
- **Memory**: Remembers past conversations, learns procedures, builds knowledge

And it's **proactive, not just reactive**:

- Morning briefings with your day ahead
- Follows up on stale tasks
- Reminds you about upcoming meetings needing prep
- Learns how you like things done

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm
- An LLM API key (OpenRouter recommended)

### Setup

```bash
# Clone and install
git clone <repo-url>
cd glados
pnpm install

# Configure (get a key from openrouter.ai/keys)
cp config/local.json.example config/local.json
# Edit config/local.json with your API key

# Start the CLI
pnpm cli
```

### Running the Telegram Bot

For mobile access, GLaDOS can run as a Telegram bot:

```bash
export GLADOS_TELEGRAM_BOT_TOKEN=your-token    # From @BotFather
export GLADOS_TELEGRAM_OWNER_ID=your-user-id   # From @userinfobot
pnpm telegram
```

## Example Interaction

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

  The requirements doc has 3 items worth discussing:
  1. They're proposing React (you've preferred Vue)
  2. Timeline assumes 2 sprints - aggressive
  3. No accessibility requirements mentioned

  Want me to add these to your notes for the call?
```

See [Usage Examples](docs/usage-examples.md) for more conversation patterns.

## Features

### Foundation Layer
- **User Model** - Identity, projects, goals, routines
- **Contacts** - People, relationships, interaction history
- **Calendar** - Events, scheduling, time awareness
- **Location** - Places, travel context
- **Memory** - Semantic search, entity knowledge, procedural memory

### Intelligent Behavior
- **Tool System** - Extensible tools with risk-based approval
- **Human-in-the-Loop** - Approval flows for risky actions
- **Task Management** - Multi-step workflows that span hours or days
- **Proactive Checks** - Scheduled background processing
- **Smart Notifications** - Attention-aware delivery

### Multiple Interfaces
- **CLI** - Desktop terminal interface
- **Telegram** - Mobile chat interface

## Architecture

```
Foundation Layer          Orchestration Layer
┌─────────────────┐      ┌─────────────────────┐
│ User Model      │      │ LangGraph Agent     │
│ Contacts        │ ───▶ │ Tool Registry       │
│ Calendar        │      │ Interrupt Gate      │
│ Location        │      │ Proactive Scheduler │
│ Memory          │      │ Notification Router │
│ Tasks           │      └─────────────────────┘
└─────────────────┘
```

**Tech Stack**: Node.js 22+ | LangChain + LangGraph | SQLite | Zod | Vitest

## Commands

| Command | Description |
|---------|-------------|
| `pnpm cli` | Start interactive CLI |
| `pnpm telegram` | Start Telegram bot |
| `pnpm proactive` | Run proactive scheduler |
| `pnpm test` | Run all tests |

## Configuration

GLaDOS uses layered configuration. Set via environment or `config/local.json`:

| Variable | Description | Default |
|----------|-------------|---------|
| `GLADOS_LLM_API_KEY` | LLM API key | *required* |
| `GLADOS_LLM_MODEL` | Model identifier | `anthropic/claude-sonnet-4` |
| `GLADOS_DB_PATH` | Database location | `./glados.db` |
| `GLADOS_TELEGRAM_BOT_TOKEN` | Telegram bot token | - |
| `GLADOS_TELEGRAM_OWNER_ID` | Authorized user ID | - |

See [Configuration Guide](docs/configuration.md) for all options.

## Documentation

| Document | Description |
|----------|-------------|
| [Usage Examples](docs/usage-examples.md) | Example conversations and interaction patterns |
| [Getting Started](docs/getting-started.md) | Full setup guide |
| [Development Guide](docs/development.md) | Architecture and contributing |
| [Adding Tools](docs/adding-tools.md) | Extending agent capabilities |
| [External Clients](docs/external-clients.md) | Building new interfaces |
| [Coding Standards](docs/coding-standards.md) | TypeScript conventions |
| [Specification](spec/001-agent.md) | Technical specification |

## Project Status

**Version 1.0** - Initial implementation complete with 897+ passing tests.

Implemented:
- Foundation Layer (User Model, Contacts, Calendar, Location, Memory)
- Orchestration (Tools, Interrupts, Agent Registry)
- Task Management (User Tasks, Delegated Workflows)
- Trigger System for scheduled agent invocations
- Notification System with attention budget
- Skills System for domain-specific capabilities
- Artifacts System for large data storage
- CLI and Telegram clients

See [spec/future-phases.md](spec/future-phases.md) for planned features.

## License

MIT
