# Configuration Guide

GLaDOS uses [Convict](https://github.com/mozilla/node-convict) for configuration management, providing a robust system for layered configuration with validation and defaults.

## Configuration Sources

Configuration values are loaded from multiple sources. Later sources override earlier ones:

| Priority | Source | Path | Notes |
|----------|--------|------|-------|
| 1 (lowest) | Schema defaults | Built-in | Hardcoded defaults |
| 2 | Global config | `/etc/glados/glados.json` (Linux)<br>`/Library/Application Support/glados/glados.json` (macOS) | System-wide settings |
| 3 | User config | `~/.config/glados/config.json` | Per-user settings (XDG-compliant) |
| 4 | Project default | `./config/default.json` | Project defaults (committed to git) |
| 5 | Project local | `./config/local.json` | Local overrides (gitignored) |
| 6 (highest) | Environment variables | `GLADOS_*` | Runtime overrides |

## Environment Variables

All configuration options can be set via environment variables prefixed with `GLADOS_`.

### Required Configuration

| Variable | Description |
|----------|-------------|
| `GLADOS_LLM_API_KEY` | API key for your LLM provider |

### Database Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GLADOS_DB_PATH` | `./glados.db` | Path to SQLite database file |

### LLM Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GLADOS_LLM_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible API endpoint |
| `GLADOS_LLM_API_KEY` | *(required)* | API authentication key |
| `GLADOS_LLM_MODEL` | `anthropic/claude-sonnet-4` | Model identifier |
| `GLADOS_LLM_TEMPERATURE` | `0.1` | Response randomness (0-2) |
| `GLADOS_LLM_MAX_TOKENS` | `4096` | Maximum response length |

### Personality Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GLADOS_PERSONALITY_NAME` | `GLaDOS` | Agent's display name |
| `GLADOS_PERSONALITY_ROLE` | `personal assistant` | Agent's role description |

### CLI Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GLADOS_HISTORY_FILE` | `.glados_history` | Path to command history file |

### Telegram Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GLADOS_TELEGRAM_BOT_TOKEN` | *(none)* | Bot token from @BotFather |
| `GLADOS_TELEGRAM_OWNER_ID` | *(none)* | Your Telegram user ID for authorization |

Both values are required to run the Telegram bot. The bot will only respond to messages from the configured owner ID.

## LLM Provider Examples

### OpenRouter (Recommended)

OpenRouter provides access to multiple AI models through a single API:

```bash
export GLADOS_LLM_BASE_URL=https://openrouter.ai/api/v1
export GLADOS_LLM_API_KEY=sk-or-v1-your-key
export GLADOS_LLM_MODEL=anthropic/claude-sonnet-4
```

Popular models on OpenRouter:
- `anthropic/claude-sonnet-4` - Claude 4 Sonnet
- `anthropic/claude-3-haiku` - Fast and affordable
- `openai/gpt-4-turbo` - GPT-4 Turbo
- `meta-llama/llama-3-70b-instruct` - Open source

### OpenAI Direct

```bash
export GLADOS_LLM_BASE_URL=https://api.openai.com/v1
export GLADOS_LLM_API_KEY=sk-your-openai-key
export GLADOS_LLM_MODEL=gpt-4-turbo
```

### Azure OpenAI

```bash
export GLADOS_LLM_BASE_URL=https://your-resource.openai.azure.com
export GLADOS_LLM_API_KEY=your-azure-key
export GLADOS_LLM_MODEL=your-deployment-name
```

### Local Models (Ollama)

```bash
export GLADOS_LLM_BASE_URL=http://localhost:11434/v1
export GLADOS_LLM_API_KEY=ollama
export GLADOS_LLM_MODEL=llama2
```

### Together AI

```bash
export GLADOS_LLM_BASE_URL=https://api.together.xyz/v1
export GLADOS_LLM_API_KEY=your-together-key
export GLADOS_LLM_MODEL=mistralai/Mixtral-8x7B-Instruct-v0.1
```

## Configuration Files

GLaDOS loads configuration from multiple JSON files. Each file can contain any subset of the configuration - you don't need to specify everything.

### Project Configuration

The recommended setup for a project:

**`config/default.json`** (committed to git):
```json
{
  "database": {
    "path": "./glados.db"
  },
  "llm": {
    "model": "anthropic/claude-sonnet-4",
    "temperature": 0.1
  },
  "personality": {
    "name": "GLaDOS"
  }
}
```

**`config/local.json`** (gitignored - for your secrets):
```json
{
  "llm": {
    "apiKey": "sk-or-v1-your-api-key-here"
  },
  "telegram": {
    "botToken": "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
    "ownerId": 12345678
  }
}
```

To create your local config:
```bash
cp config/local.json.example config/local.json
# Edit config/local.json with your API key
```

### User Configuration

For settings that apply across all your GLaDOS projects:

**`~/.config/glados/config.json`**:
```json
{
  "llm": {
    "apiKey": "sk-or-v1-your-api-key-here",
    "model": "anthropic/claude-sonnet-4"
  },
  "personality": {
    "name": "Jarvis"
  }
}
```

Create the directory if needed:
```bash
mkdir -p ~/.config/glados
```

### Global Configuration

For system-wide defaults (requires admin privileges):

- **Linux**: `/etc/glados/glados.json`
- **macOS**: `/Library/Application Support/glados/glados.json`
- **Windows**: `C:\ProgramData\glados\glados.json`

## Shell Configuration

Create a file to source before running GLaDOS:

```bash
# ~/.glados.env

# Required
export GLADOS_LLM_API_KEY=sk-or-v1-your-key

# Optional overrides
export GLADOS_LLM_MODEL=anthropic/claude-sonnet-4
export GLADOS_DB_PATH=$HOME/.glados/glados.db

# Development
export NODE_ENV=development
```

Usage:

```bash
source ~/.glados.env
pnpm cli
```

Or add to your shell profile (`~/.bashrc`, `~/.zshrc`):

```bash
# Load GLaDOS configuration
[ -f ~/.glados.env ] && source ~/.glados.env
```

## Validation

Convict validates all configuration values on startup. Invalid values will cause an error:

```
Error: llm.temperature: must be a Number
```

## Programmatic Access

In code, access configuration through the config module:

```typescript
import { getConfig, loadConfig, isLLMConfigured } from './config/config.ts';

// Load and validate configuration
const config = loadConfig();

// Check if LLM is configured
if (!isLLMConfigured()) {
  console.error('Please set GLADOS_LLM_API_KEY');
  process.exit(1);
}

// Access values
console.log(config.llm.model);
console.log(config.database.path);
```

## Security Notes

1. **Never commit API keys** - Use environment variables or gitignored config files
2. **API keys are marked sensitive** - They won't appear in debug output
3. **Use minimal permissions** - Create API keys with only necessary scopes
4. **Rotate keys regularly** - Especially if accidentally exposed
