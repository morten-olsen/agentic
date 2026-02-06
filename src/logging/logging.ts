import { randomUUID } from 'crypto';

import type { Knex } from 'knex';

import type { Services } from '../services/services.ts';
import { destroySymbol } from '../services/services.ts';
import { DatabaseService } from '../database/database.ts';

import type {
  LogLevel,
  LogEntry,
  LogContext,
  LogQueryFilters,
  LogStats,
  LogConfig,
  LogConfigInput,
} from './logging.schemas.ts';
import { logConfigSchema, LOG_LEVEL_PRIORITY } from './logging.schemas.ts';
import { writeToTerminal } from './logging.terminal.ts';
import { insertLogs, queryLogs, getLog, getLogStats, deleteLogs, getLogContext } from './logging.store.ts';

// ============================================================================
// Logger Interface (for child loggers)
// ============================================================================

type Logger = {
  error: (message: string, error?: Error | unknown, metadata?: Record<string, unknown>) => void;
  warn: (message: string, metadata?: Record<string, unknown>) => void;
  info: (message: string, metadata?: Record<string, unknown>) => void;
  debug: (message: string, metadata?: Record<string, unknown>) => void;
};

// ============================================================================
// Error Detail Extraction
// ============================================================================

/**
 * Extract detailed information from an error, including nested causes
 * and response bodies from API errors.
 */
const extractErrorDetails = (
  error: unknown,
): { name: string; message: string; stack?: string; metadata?: Record<string, unknown> } => {
  if (!(error instanceof Error)) {
    return {
      name: 'UnknownError',
      message: String(error),
    };
  }

  const details: {
    name: string;
    message: string;
    stack?: string;
    metadata?: Record<string, unknown>;
  } = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };

  const metadata: Record<string, unknown> = {};

  // Extract cause chain
  if ('cause' in error && error.cause) {
    const causeDetails = extractErrorDetails(error.cause);
    metadata.cause = {
      name: causeDetails.name,
      message: causeDetails.message,
    };
    if (causeDetails.metadata) {
      metadata.causeMetadata = causeDetails.metadata;
    }
  }

  // Extract response body from fetch/API errors
  // Common patterns in various HTTP clients
  if ('response' in error) {
    const response = error.response as unknown;
    if (response && typeof response === 'object') {
      const resp = response as Record<string, unknown>;
      if ('data' in resp) metadata.responseData = resp.data;
      if ('body' in resp) metadata.responseBody = resp.body;
      if ('status' in resp) metadata.responseStatus = resp.status;
      if ('statusText' in resp) metadata.responseStatusText = resp.statusText;
    }
  }

  // LangChain/OpenAI specific error details
  if ('code' in error) metadata.errorCode = (error as { code: unknown }).code;
  if ('status' in error) metadata.httpStatus = (error as { status: unknown }).status;
  if ('statusCode' in error) metadata.httpStatusCode = (error as { statusCode: unknown }).statusCode;

  // OpenRouter/LLM API specific
  if ('error' in error) {
    const apiError = (error as { error: unknown }).error;
    if (apiError && typeof apiError === 'object') {
      metadata.apiError = apiError;
    }
  }

  // Request details if available
  if ('request' in error) {
    const request = error.request as unknown;
    if (request && typeof request === 'object') {
      const req = request as Record<string, unknown>;
      if ('url' in req) metadata.requestUrl = req.url;
      if ('method' in req) metadata.requestMethod = req.method;
    }
  }

  // Add any additional enumerable properties
  for (const key of Object.keys(error)) {
    if (
      !['name', 'message', 'stack', 'cause', 'response', 'request', 'code', 'status', 'statusCode', 'error'].includes(
        key,
      )
    ) {
      try {
        const value = (error as unknown as Record<string, unknown>)[key];
        if (value !== undefined && value !== null) {
          // Only include serializable values
          JSON.stringify(value);
          metadata[key] = value;
        }
      } catch {
        // Skip non-serializable values
      }
    }
  }

  if (Object.keys(metadata).length > 0) {
    details.metadata = metadata;
  }

  return details;
};

// ============================================================================
// LogService
// ============================================================================

class LogService {
  #services: Services;
  #config: LogConfig;
  #buffer: LogEntry[] = [];
  #flushTimer: NodeJS.Timeout | null = null;
  #flushPromise: Promise<void> | null = null;
  #configured = false;

  constructor(services: Services, config: LogConfigInput = {}) {
    this.#services = services;
    this.#config = logConfigSchema.parse(config);
  }

  /**
   * Destroy symbol for services container cleanup.
   */
  [destroySymbol] = async (): Promise<void> => {
    await this.shutdown();
  };

  /**
   * Gets the Knex instance from the database service.
   */
  #db = (): Knex | null => {
    try {
      return this.#services.get(DatabaseService).knex;
    } catch {
      return null;
    }
  };

  /**
   * Configure the log service (starts flush timer for database logging).
   * Called automatically when the database is ready.
   */
  configure = (): void => {
    if (this.#configured) return;
    this.#configured = true;

    // Start flush timer if database logging is enabled
    if (this.#config.databaseEnabled) {
      this.#startFlushTimer();
    }
  };

  /**
   * Update configuration.
   */
  setConfig = (config: Partial<LogConfigInput>): void => {
    this.#config = logConfigSchema.parse({ ...this.#config, ...config });
  };

  /**
   * Get current configuration.
   */
  get config(): LogConfig {
    return { ...this.#config };
  }

  /**
   * Check if a level should be logged to terminal.
   */
  #shouldLogToTerminal = (level: LogLevel): boolean => {
    if (!this.#config.terminalEnabled) return false;
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.#config.terminalLevel];
  };

  /**
   * Check if a level should be logged to database.
   */
  #shouldLogToDatabase = (level: LogLevel): boolean => {
    if (!this.#config.databaseEnabled || !this.#db()) return false;
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.#config.databaseLevel];
  };

  /**
   * Start the flush timer for batched database writes.
   */
  #startFlushTimer = (): void => {
    if (this.#flushTimer) return;
    this.#flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        console.error('Failed to flush logs:', err);
      });
    }, 1000);
  };

  /**
   * Stop the flush timer.
   */
  #stopFlushTimer = (): void => {
    if (this.#flushTimer) {
      clearInterval(this.#flushTimer);
      this.#flushTimer = null;
    }
  };

  /**
   * Flush buffered logs to the database.
   */
  flush = async (): Promise<void> => {
    const db = this.#db();
    if (this.#buffer.length === 0 || !db) return;

    // If a flush is already in progress, wait for it
    if (this.#flushPromise) {
      await this.#flushPromise;
      return;
    }

    const entries = this.#buffer.splice(0, this.#buffer.length);

    this.#flushPromise = insertLogs(db, entries)
      .catch((err) => {
        // Put entries back on failure
        this.#buffer.unshift(...entries);
        console.error('Failed to write logs to database:', err);
      })
      .finally(() => {
        this.#flushPromise = null;
      });

    await this.#flushPromise;
  };

  /**
   * Log at a specific level.
   */
  log = (level: LogLevel, source: string, message: string, context?: LogContext): void => {
    const entry: LogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      level,
      source,
      message,
      conversationId: context?.conversationId,
      triggerId: context?.triggerId,
      toolName: context?.toolName,
      metadata: context?.metadata,
    };

    // Write to terminal
    if (this.#shouldLogToTerminal(level)) {
      writeToTerminal(entry);
    }

    // Buffer for database
    if (this.#shouldLogToDatabase(level)) {
      this.#buffer.push(entry);
    }
  };

  /**
   * Log an error with full error details.
   */
  error = (source: string, message: string, error: Error | unknown, context?: LogContext): void => {
    const errorDetails = extractErrorDetails(error);

    // Merge error metadata with context metadata
    const mergedMetadata = {
      ...context?.metadata,
      ...errorDetails.metadata,
    };

    const entry: LogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      level: 'error',
      source,
      message,
      conversationId: context?.conversationId,
      triggerId: context?.triggerId,
      toolName: context?.toolName,
      errorName: errorDetails.name,
      errorMessage: errorDetails.message,
      errorStack: errorDetails.stack,
      metadata: Object.keys(mergedMetadata).length > 0 ? mergedMetadata : undefined,
    };

    // Write to terminal
    if (this.#shouldLogToTerminal('error')) {
      writeToTerminal(entry);
    }

    // Buffer for database
    if (this.#shouldLogToDatabase('error')) {
      this.#buffer.push(entry);
    }
  };

  /**
   * Log a warning.
   */
  warn = (source: string, message: string, context?: LogContext): void => {
    this.log('warn', source, message, context);
  };

  /**
   * Log an info message.
   */
  info = (source: string, message: string, context?: LogContext): void => {
    this.log('info', source, message, context);
  };

  /**
   * Log a debug message.
   */
  debug = (source: string, message: string, context?: LogContext): void => {
    this.log('debug', source, message, context);
  };

  /**
   * Create a child logger with preset context.
   */
  child = (baseContext: LogContext & { source: string }): Logger => {
    const { source, ...context } = baseContext;

    return {
      error: (message: string, error?: Error | unknown, metadata?: Record<string, unknown>) => {
        const mergedContext = { ...context, metadata: { ...context.metadata, ...metadata } };
        if (error) {
          this.error(source, message, error, mergedContext);
        } else {
          this.log('error', source, message, mergedContext);
        }
      },
      warn: (message: string, metadata?: Record<string, unknown>) => {
        this.warn(source, message, { ...context, metadata: { ...context.metadata, ...metadata } });
      },
      info: (message: string, metadata?: Record<string, unknown>) => {
        this.info(source, message, { ...context, metadata: { ...context.metadata, ...metadata } });
      },
      debug: (message: string, metadata?: Record<string, unknown>) => {
        this.debug(source, message, { ...context, metadata: { ...context.metadata, ...metadata } });
      },
    };
  };

  /**
   * Query logs from the database.
   */
  query = async (filters: LogQueryFilters): Promise<{ logs: LogEntry[]; total: number; hasMore: boolean }> => {
    const db = this.#db();
    if (!db) {
      throw new Error('LogService not configured with database');
    }

    // Flush before querying to ensure recent logs are included
    await this.flush();

    const result = await queryLogs(db, filters);
    const offset = filters.offset ?? 0;

    return {
      logs: result.logs,
      total: result.total,
      hasMore: offset + result.logs.length < result.total,
    };
  };

  /**
   * Get a single log entry.
   */
  get = async (id: string): Promise<LogEntry | null> => {
    const db = this.#db();
    if (!db) {
      throw new Error('LogService not configured with database');
    }
    return getLog(db, id);
  };

  /**
   * Get logs surrounding a specific log entry.
   */
  getContext = async (
    logId: string,
    options?: { before?: number; after?: number; sameSourceOnly?: boolean },
  ): Promise<{ target: LogEntry | null; before: LogEntry[]; after: LogEntry[] }> => {
    const db = this.#db();
    if (!db) {
      throw new Error('LogService not configured with database');
    }

    // Flush before querying
    await this.flush();

    return getLogContext(db, logId, options ?? {});
  };

  /**
   * Get log statistics.
   */
  stats = async (since?: string): Promise<LogStats> => {
    const db = this.#db();
    if (!db) {
      throw new Error('LogService not configured with database');
    }

    // Flush before getting stats
    await this.flush();

    return getLogStats(db, since);
  };

  /**
   * Clean up old logs based on retention policy.
   */
  cleanup = async (): Promise<number> => {
    const db = this.#db();
    if (!db) {
      throw new Error('LogService not configured with database');
    }

    const cutoff = new Date(Date.now() - this.#config.retentionDays * 24 * 60 * 60 * 1000).toISOString();
    return deleteLogs(db, cutoff);
  };

  /**
   * Shutdown the log service, flushing any remaining logs.
   */
  shutdown = async (): Promise<void> => {
    this.#stopFlushTimer();
    await this.flush();
  };
}

// ============================================================================
// Exports
// ============================================================================

export type { Logger };
export { LogService, extractErrorDetails };
