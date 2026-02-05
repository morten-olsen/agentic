import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import convict from 'convict';

/**
 * GLaDOS configuration schema using convict.
 *
 * Configuration is loaded from multiple sources (later overrides earlier):
 * 1. Schema defaults
 * 2. Global config: /etc/glados/glados.json (Linux) or /Library/Application Support/glados/glados.json (macOS)
 * 3. User config: ~/.config/glados/config.json
 * 4. Project default: ./config/default.json
 * 5. Project local: ./config/local.json (gitignored)
 * 6. Environment variables (GLADOS_*)
 */
const configSchema = convict({
  env: {
    doc: 'The application environment',
    format: ['production', 'development', 'test'],
    default: 'development',
    env: 'NODE_ENV',
  },

  database: {
    path: {
      doc: 'Path to the SQLite database file',
      format: String,
      default: './glados.db',
      env: 'GLADOS_DB_PATH',
    },
  },

  llm: {
    baseUrl: {
      doc: 'Base URL for the OpenAI-compatible API (e.g., OpenRouter)',
      format: String,
      default: 'https://openrouter.ai/api/v1',
      env: 'GLADOS_LLM_BASE_URL',
    },
    apiKey: {
      doc: 'API key for the LLM provider',
      format: String,
      default: '',
      env: 'GLADOS_LLM_API_KEY',
      sensitive: true,
    },
    model: {
      doc: 'Model identifier to use',
      format: String,
      default: 'anthropic/claude-sonnet-4',
      env: 'GLADOS_LLM_MODEL',
    },
    temperature: {
      doc: 'Temperature for LLM responses (0-2)',
      format: Number,
      default: 0.1,
      env: 'GLADOS_LLM_TEMPERATURE',
    },
    maxTokens: {
      doc: 'Maximum tokens per response',
      format: 'int',
      default: 4096,
      env: 'GLADOS_LLM_MAX_TOKENS',
    },
  },

  personality: {
    name: {
      doc: 'Default agent name',
      format: String,
      default: 'GLaDOS',
      env: 'GLADOS_PERSONALITY_NAME',
    },
    role: {
      doc: 'Default agent role',
      format: String,
      default: 'personal assistant',
      env: 'GLADOS_PERSONALITY_ROLE',
    },
  },

  cli: {
    historyFile: {
      doc: 'Path to CLI history file',
      format: String,
      default: '.glados_history',
      env: 'GLADOS_HISTORY_FILE',
    },
  },

  telegram: {
    botToken: {
      doc: 'Telegram bot token from @BotFather',
      format: String,
      default: '',
      env: 'GLADOS_TELEGRAM_BOT_TOKEN',
      sensitive: true,
    },
    ownerId: {
      doc: 'Telegram user ID of the bot owner (for authorization)',
      format: 'int',
      default: 0,
      env: 'GLADOS_TELEGRAM_OWNER_ID',
    },
  },

  memory: {
    recallLimit: {
      doc: 'Default number of memories to recall',
      format: 'int',
      default: 10,
      env: 'GLADOS_MEMORY_RECALL_LIMIT',
    },
    minImportanceForRecall: {
      doc: 'Minimum importance threshold for memory recall (0-1)',
      format: Number,
      default: 0.2,
      env: 'GLADOS_MEMORY_MIN_IMPORTANCE',
    },
  },

  embeddings: {
    provider: {
      doc: 'Embedding provider: "local" (HuggingFace, no API key) or "openai" (API-based)',
      format: ['local', 'openai'],
      default: 'local',
      env: 'GLADOS_EMBEDDING_PROVIDER',
    },
    localModel: {
      doc: 'HuggingFace model for local embeddings',
      format: String,
      default: 'Xenova/all-MiniLM-L6-v2',
      env: 'GLADOS_EMBEDDING_LOCAL_MODEL',
    },
    localDimensions: {
      doc: 'Dimensions for local embedding model',
      format: 'int',
      default: 384,
      env: 'GLADOS_EMBEDDING_LOCAL_DIMENSIONS',
    },
    openaiBaseUrl: {
      doc: 'Base URL for OpenAI-compatible embedding API',
      format: String,
      default: 'https://openrouter.ai/api/v1',
      env: 'GLADOS_EMBEDDING_OPENAI_BASE_URL',
    },
    openaiApiKey: {
      doc: 'API key for OpenAI-compatible embedding API',
      format: String,
      default: '',
      env: 'GLADOS_EMBEDDING_OPENAI_API_KEY',
      sensitive: true,
    },
    openaiModel: {
      doc: 'Model for OpenAI-compatible embeddings',
      format: String,
      default: 'text-embedding-3-small',
      env: 'GLADOS_EMBEDDING_OPENAI_MODEL',
    },
    openaiDimensions: {
      doc: 'Dimensions for OpenAI embeddings',
      format: 'int',
      default: 1536,
      env: 'GLADOS_EMBEDDING_OPENAI_DIMENSIONS',
    },
  },

  proactive: {
    enabled: {
      doc: 'Enable proactive scheduler',
      format: Boolean,
      default: true,
      env: 'GLADOS_PROACTIVE_ENABLED',
    },
    checkIntervalMs: {
      doc: 'Interval between scheduler checks in milliseconds',
      format: 'int',
      default: 60000,
      env: 'GLADOS_PROACTIVE_INTERVAL',
    },
  },

  notifications: {
    quietHoursStart: {
      doc: 'Start of quiet hours (HH:mm format)',
      format: String,
      default: '22:00',
      env: 'GLADOS_QUIET_HOURS_START',
    },
    quietHoursEnd: {
      doc: 'End of quiet hours (HH:mm format)',
      format: String,
      default: '07:00',
      env: 'GLADOS_QUIET_HOURS_END',
    },
    maxInterruptionsPerHour: {
      doc: 'Maximum number of interruptions per hour',
      format: 'int',
      default: 5,
      env: 'GLADOS_MAX_INTERRUPTIONS_PER_HOUR',
    },
  },

  homeassistant: {
    url: {
      doc: 'Home Assistant URL',
      format: String,
      default: '',
      env: 'GLADOS_HOMEASSISTANT_URL',
    },
    token: {
      doc: 'Home Assistant long-lived access token',
      format: String,
      default: '',
      env: 'GLADOS_HOMEASSISTANT_TOKEN',
      sensitive: true,
    },
    calendarEntities: {
      doc: 'Home Assistant calendar entity IDs to include in agenda (comma-separated)',
      format: Array,
      default: [],
      env: 'GLADOS_HOMEASSISTANT_CALENDARS',
    },
    personEntity: {
      doc: 'Home Assistant person entity ID for location tracking (e.g., person.morten)',
      format: String,
      default: '',
      env: 'GLADOS_HOMEASSISTANT_PERSON_ENTITY',
    },
  },

  triggers: {
    enabled: {
      doc: 'Enable trigger system',
      format: Boolean,
      default: true,
      env: 'GLADOS_TRIGGERS_ENABLED',
    },
    catchUpMissed: {
      doc: 'Fire missed triggers on startup',
      format: Boolean,
      default: true,
      env: 'GLADOS_TRIGGERS_CATCH_UP',
    },
    maxCatchUpAgeMs: {
      doc: 'Max age in ms for catch-up (default: 1 hour)',
      format: 'int',
      default: 3600000,
      env: 'GLADOS_TRIGGERS_MAX_CATCH_UP_AGE',
    },
    maxConsecutiveFailures: {
      doc: 'Max consecutive failures before marking trigger as failed',
      format: 'int',
      default: 3,
      env: 'GLADOS_TRIGGERS_MAX_FAILURES',
    },
    maxTriggersPerUser: {
      doc: 'Maximum number of triggers per user',
      format: 'int',
      default: 100,
      env: 'GLADOS_TRIGGERS_MAX_COUNT',
    },
  },
});

/**
 * Configuration type inferred from the schema.
 */
type Config = {
  env: 'production' | 'development' | 'test';
  database: {
    path: string;
  };
  llm: {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    maxTokens: number;
  };
  personality: {
    name: string;
    role: string;
  };
  cli: {
    historyFile: string;
  };
  telegram: {
    botToken: string;
    ownerId: number;
  };
  memory: {
    recallLimit: number;
    minImportanceForRecall: number;
  };
  embeddings: {
    provider: 'local' | 'openai';
    localModel: string;
    localDimensions: number;
    openaiBaseUrl: string;
    openaiApiKey: string;
    openaiModel: string;
    openaiDimensions: number;
  };
  proactive: {
    enabled: boolean;
    checkIntervalMs: number;
  };
  notifications: {
    quietHoursStart: string;
    quietHoursEnd: string;
    maxInterruptionsPerHour: number;
  };
  homeassistant: {
    url: string;
    token: string;
    calendarEntities: string[];
    personEntity: string;
  };
  triggers: {
    enabled: boolean;
    catchUpMissed: boolean;
    maxCatchUpAgeMs: number;
    maxConsecutiveFailures: number;
    maxTriggersPerUser: number;
  };
};

/**
 * Gets the global config directory based on platform.
 */
const getGlobalConfigDir = (): string => {
  const platform = os.platform();
  if (platform === 'darwin') {
    return '/Library/Application Support/glados';
  } else if (platform === 'win32') {
    return path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'glados');
  }
  // Linux and others
  return '/etc/glados';
};

/**
 * Gets the user config directory (XDG-compliant).
 */
const getUserConfigDir = (): string => {
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  if (xdgConfig) {
    return path.join(xdgConfig, 'glados');
  }
  return path.join(os.homedir(), '.config', 'glados');
};

/**
 * Gets all config file paths in load order (lowest to highest priority).
 */
const getConfigPaths = (): string[] => {
  return [
    // 1. Global system config
    path.join(getGlobalConfigDir(), 'glados.json'),
    // 2. User config (~/.config/glados/config.json)
    path.join(getUserConfigDir(), 'config.json'),
    // 3. Project default config (committed to git)
    path.resolve('./config/default.json'),
    // 4. Project local config (gitignored)
    path.resolve('./config/local.json'),
  ];
};

/**
 * Loads configuration files that exist.
 * Returns list of files that were loaded.
 */
const loadConfigFiles = (): string[] => {
  const loaded: string[] = [];
  const configPaths = getConfigPaths();

  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      try {
        configSchema.loadFile(configPath);
        loaded.push(configPath);
      } catch (error) {
        // Log but don't fail - other config sources may work
        console.warn(`Warning: Failed to load config from ${configPath}:`, error);
      }
    }
  }

  return loaded;
};

// Track which files were loaded
let loadedConfigFiles: string[] = [];

/**
 * Loads configuration from all sources.
 *
 * Load order (later overrides earlier):
 * 1. Schema defaults
 * 2. Global config: /etc/glados/glados.json (or platform equivalent)
 * 3. User config: ~/.config/glados/config.json
 * 4. Project default: ./config/default.json
 * 5. Project local: ./config/local.json (gitignored)
 * 6. Environment variables
 *
 * @param additionalConfigPath - Optional additional config file to load last (before env vars)
 */
const loadConfig = (additionalConfigPath?: string): Config => {
  // Load all config files in order
  loadedConfigFiles = loadConfigFiles();

  // Load additional config file if provided
  if (additionalConfigPath && fs.existsSync(additionalConfigPath)) {
    configSchema.loadFile(additionalConfigPath);
    loadedConfigFiles.push(additionalConfigPath);
  }

  // Environment variables are automatically loaded by convict and take highest priority

  // Validate configuration
  configSchema.validate({ allowed: 'strict' });

  return configSchema.getProperties() as Config;
};

/**
 * Gets the current configuration without validation.
 * Useful for checking values before full initialization.
 */
const getConfig = (): Config => {
  return configSchema.getProperties() as Config;
};

/**
 * Gets the list of config files that were loaded.
 */
const getLoadedConfigFiles = (): string[] => {
  return [...loadedConfigFiles];
};

/**
 * Gets all potential config file paths (whether they exist or not).
 */
const getAllConfigPaths = (): string[] => {
  return getConfigPaths();
};

/**
 * Checks if the LLM API key is configured.
 */
const isLLMConfigured = (): boolean => {
  const config = getConfig();
  return config.llm.apiKey.length > 0;
};

/**
 * Checks if the Telegram bot is configured.
 */
const isTelegramConfigured = (): boolean => {
  const config = getConfig();
  return config.telegram.botToken.length > 0 && config.telegram.ownerId > 0;
};

/**
 * Checks if Home Assistant is configured.
 */
const isHomeAssistantConfigured = (): boolean => {
  const config = getConfig();
  return config.homeassistant.url.length > 0 && config.homeassistant.token.length > 0;
};

/**
 * Gets a formatted string of configuration for display (hides sensitive values).
 */
const getConfigDisplay = (): string => {
  const config = getConfig();
  const loaded = getLoadedConfigFiles();

  return `
Configuration:
  Environment: ${config.env}
  Database: ${config.database.path}
  LLM:
    Base URL: ${config.llm.baseUrl}
    API Key: ${config.llm.apiKey ? '***configured***' : '(not set)'}
    Model: ${config.llm.model}
    Temperature: ${config.llm.temperature}
    Max Tokens: ${config.llm.maxTokens}
  Memory:
    Recall Limit: ${config.memory.recallLimit}
    Min Importance: ${config.memory.minImportanceForRecall}
  Embeddings:
    Provider: ${config.embeddings.provider}
    ${config.embeddings.provider === 'local' ? `Model: ${config.embeddings.localModel}` : `Model: ${config.embeddings.openaiModel}`}
    ${config.embeddings.provider === 'local' ? `Dimensions: ${config.embeddings.localDimensions}` : `Dimensions: ${config.embeddings.openaiDimensions}`}
    ${config.embeddings.provider === 'openai' ? `API Key: ${config.embeddings.openaiApiKey ? '***configured***' : '(not set)'}` : ''}
  Personality:
    Name: ${config.personality.name}
    Role: ${config.personality.role}
  Telegram:
    Bot Token: ${config.telegram.botToken ? '***configured***' : '(not set)'}
    Owner ID: ${config.telegram.ownerId || '(not set)'}
  Home Assistant:
    URL: ${config.homeassistant.url || '(not set)'}
    Token: ${config.homeassistant.token ? '***configured***' : '(not set)'}
    Calendars: ${config.homeassistant.calendarEntities.length > 0 ? config.homeassistant.calendarEntities.join(', ') : '(none)'}
    Person Entity: ${config.homeassistant.personEntity || '(not set)'}

Config files loaded:
${loaded.length > 0 ? loaded.map((f) => `  - ${f}`).join('\n') : '  (none)'}
`.trim();
};

export type { Config };
export {
  configSchema,
  loadConfig,
  getConfig,
  getLoadedConfigFiles,
  getAllConfigPaths,
  isLLMConfigured,
  isTelegramConfigured,
  isHomeAssistantConfigured,
  getConfigDisplay,
  getGlobalConfigDir,
  getUserConfigDir,
};
