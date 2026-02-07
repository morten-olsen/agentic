// Main service
export { LogService, extractErrorDetails } from './logging.ts';
export type { Logger } from './logging.ts';

// Schemas and types
export type {
  LogLevel,
  LogEntry,
  LogContext,
  LogQueryFilters,
  LogStats,
  LogConfig,
  LogConfigInput,
} from './logging.schemas.ts';

export {
  logLevelSchema,
  logEntrySchema,
  logContextSchema,
  logQueryFiltersSchema,
  logStatsSchema,
  logConfigSchema,
  LOG_LEVEL_PRIORITY,
} from './logging.schemas.ts';

// Terminal formatting (for testing/customization)
export { formatLogEntry, writeToTerminal, COLORS, LEVEL_COLORS } from './logging.terminal.ts';
