# Getting Started with GLaDOS

This guide walks you through setting up and using GLaDOS for the first time.

## Prerequisites

- **Node.js 22+**: GLaDOS uses native TypeScript execution via `--experimental-strip-types`
- **pnpm**: Package manager (install with `npm install -g pnpm`)
- **LLM API Key**: Access to an OpenAI-compatible API (OpenRouter recommended)

## Installation

### 1. Clone and Install

```bash
git clone <repo-url>
cd glados
pnpm install
```

### 2. Configure Your LLM Provider

GLaDOS needs an API key to communicate with a language model. We recommend OpenRouter for its flexibility and model selection.

#### Option A: Local Config File (Recommended)

1. Create an account at [openrouter.ai](https://openrouter.ai)
2. Navigate to [API Keys](https://openrouter.ai/keys)
3. Create a new key and copy it
4. Create your local config:

```bash
cp config/local.json.example config/local.json
```

5. Edit `config/local.json`:

```json
{
  "llm": {
    "apiKey": "sk-or-v1-your-key-here"
  }
}
```

This file is gitignored so your API key stays private.

#### Option B: User Config (For All Projects)

Create a config file in your home directory:

```bash
mkdir -p ~/.config/glados
cat > ~/.config/glados/config.json << 'EOF'
{
  "llm": {
    "apiKey": "sk-or-v1-your-key-here"
  }
}
EOF
```

#### Option C: Environment Variable

```bash
export GLADOS_LLM_API_KEY=sk-or-v1-your-key-here
```

#### Using Different Models

The default model is `anthropic/claude-sonnet-4`. To change it, add to your config:

```json
{
  "llm": {
    "apiKey": "sk-or-v1-...",
    "model": "openai/gpt-4-turbo"
  }
}
```

Popular OpenRouter models:
- `anthropic/claude-sonnet-4` - Claude 4 Sonnet (default)
- `anthropic/claude-3-haiku` - Fast and affordable
- `openai/gpt-4-turbo` - GPT-4 Turbo
- `meta-llama/llama-3-70b-instruct` - Open source

#### Using OpenAI Direct

```json
{
  "llm": {
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "sk-your-openai-key",
    "model": "gpt-4-turbo"
  }
}
```

#### Using Local Models (Ollama)

First, start Ollama and pull a model:

```bash
ollama pull llama2
```

Then configure GLaDOS:

```json
{
  "llm": {
    "baseUrl": "http://localhost:11434/v1",
    "apiKey": "ollama",
    "model": "llama2"
  }
}
```

### 3. Start the CLI

```bash
pnpm cli
```

You should see:

```
Initializing database...

╔══════════════════════════════════════════════════╗
║                    GLaDOS                        ║
║        General Learning and Decision             ║
║           Orchestration System                   ║
╚══════════════════════════════════════════════════╝

Type a message to chat, or /help for commands.
────────────────────────────────────────────────────

Started new conversation.

You >
```

## First Conversation

Try asking GLaDOS about itself:

```
You > Hello! Who are you?
```

GLaDOS will respond based on its personality configuration. By default, it introduces itself as a personal assistant.

## Setting Up Your Identity

GLaDOS works best when it knows who you are. You can set up your identity through conversation:

```
You > My name is Alice. I work as a software engineer at TechCorp.
      I'm usually at work Monday through Friday, 9am to 5pm.
```

This information gets stored in the User Model and helps GLaDOS personalize its responses.

## CLI Commands

While chatting, you can use these commands:

| Command | What it does |
|---------|--------------|
| `/new` | Start a fresh conversation |
| `/history` | View the current conversation's messages |
| `/clear` | Clear the terminal screen |
| `/help` | Show all available commands |
| `/quit` | Exit GLaDOS |

## Configuration Files

GLaDOS supports multiple configuration files for flexibility:

### Project-Level Config

- `config/default.json` - Project defaults (committed to git)
- `config/local.json` - Your local overrides (gitignored)

### User-Level Config

`~/.config/glados/config.json` - Settings that apply to all your GLaDOS projects.

### Environment Variables

You can also use environment variables, which override all config files:

```bash
export GLADOS_LLM_API_KEY=sk-or-v1-your-key
export GLADOS_LLM_MODEL=anthropic/claude-sonnet-4
```

See [Configuration Guide](./configuration.md) for full details.

## Database Location

By default, GLaDOS stores its database in `./glados.db` (current directory). To change this:

```bash
export GLADOS_DB_PATH=/path/to/your/glados.db
```

The database is automatically created and migrated on first run.

## Customizing the Personality

GLaDOS's personality can be customized. The defaults are:

| Setting | Default |
|---------|---------|
| Name | GLaDOS |
| Role | personal assistant |
| Formality | professional |
| Verbosity | balanced |
| Humor | subtle |

These can be changed through the API or by modifying the personality configuration in the database.

## Troubleshooting

### "GLADOS_LLM_API_KEY environment variable is required"

You haven't set your API key. See the configuration section above.

### "fetch failed" or connection errors

Check that:
1. Your `GLADOS_LLM_BASE_URL` is correct
2. Your API key is valid
3. You have internet connectivity (unless using local models)

### Slow responses

Try:
- Using a faster model (e.g., `anthropic/claude-3-haiku` instead of `claude-sonnet`)
- Reducing `GLADOS_LLM_MAX_TOKENS`
- Using a local model if you have GPU

### Database errors

Delete the database file and restart:

```bash
rm glados.db
pnpm cli
```

## Running the Telegram Bot

GLaDOS can also be accessed via Telegram, which is great for mobile use.

### 1. Create a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/botfather)
2. Send `/newbot` and follow the prompts
3. Copy the bot token (looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 2. Get Your User ID

Message [@userinfobot](https://t.me/userinfobot) on Telegram. It will reply with your user ID.

### 3. Configure Environment

```bash
export GLADOS_TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
export GLADOS_TELEGRAM_OWNER_ID=12345678
```

Or add to your config file (`config/local.json` or `~/.config/glados/config.json`):

```json
{
  "llm": {
    "apiKey": "sk-or-v1-your-key"
  },
  "telegram": {
    "botToken": "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
    "ownerId": 12345678
  }
}
```

### 4. Start the Bot

```bash
pnpm telegram
```

You should see:

```
Initializing database...
Starting GLaDOS Telegram bot...
Authorized user ID: 12345678
Bot started as @your_bot_name
```

### 5. Chat with Your Bot

Open your bot in Telegram and send a message. Only messages from your configured user ID will be processed.

### Telegram Commands

| Command | What it does |
|---------|--------------|
| `/start` | Welcome message and create conversation |
| `/new` | Start a fresh conversation |
| `/help` | Show available commands |

### Running Both CLI and Telegram

You can run both interfaces simultaneously (they share the same database but use separate conversations):

```bash
# Terminal 1
pnpm cli

# Terminal 2
pnpm telegram
```

## Next Steps

- Read the [full README](../README.md) for architecture details
- Check `spec/agent.md` for the system specification
- See `docs/external-clients.md` for building custom clients
- Explore the codebase to understand how components work together

## Development

To run tests and verify everything works:

```bash
# Run all tests
pnpm test

# Just unit tests
pnpm test:unit

# Build TypeScript
pnpm build
```
