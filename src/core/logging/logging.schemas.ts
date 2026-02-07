import { z } from 'zod';

// ============================================================================
// Log Levels
// ============================================================================

const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);

type LogLevel = z.infer<typeof logLevelSchema>;

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ============================================================================
// Log Entry
// ============================================================================

const logEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  level: logLevelSchema,
  source: z.string(),
  message: z.string(),

  // Context references
  conversationId: z.string().optional(),
  triggerId: z.string().optional(),
  toolName: z.string().optional(),

  // Error details
  errorName: z.string().optional(),
  errorMessage: z.string().optional(),
  errorStack: z.string().optional(),

  // Arbitrary metadata
  metadata: z.record(z.string(), z.unknown()).optional(),
});

type LogEntry = z.infer<typeof logEntrySchema>;

// ============================================================================
// Log Context
// ============================================================================

const logContextSchema = z.object({
  conversationId: z.string().optional(),
  triggerId: z.string().optional(),
  toolName: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

type LogContext = z.infer<typeof logContextSchema>;

// ============================================================================
// Query Filters
// ============================================================================

const logQueryFiltersSchema = z.object({
  level: z.union([logLevelSchema, z.array(logLevelSchema)]).optional(),
  source: z.union([z.string(), z.array(z.string())]).optional(),
  conversationId: z.string().optional(),
  triggerId: z.string().optional(),
  toolName: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  search: z.string().optional(),
  limit: z.number().optional().default(100),
  offset: z.number().optional().default(0),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

type LogQueryFilters = z.infer<typeof logQueryFiltersSchema>;

// ============================================================================
// Log Statistics
// ============================================================================

const logStatsSchema = z.object({
  total: z.number(),
  byLevel: z.object({
    debug: z.number(),
    info: z.number(),
    warn: z.number(),
    error: z.number(),
  }),
  bySource: z.record(z.string(), z.number()),
  timeRange: z.object({
    oldest: z.string().nullable(),
    newest: z.string().nullable(),
  }),
  errorsLast24h: z.number(),
  warningsLast24h: z.number(),
});

type LogStats = z.infer<typeof logStatsSchema>;

// ============================================================================
// Configuration
// ============================================================================

const logConfigSchema = z.object({
  terminalLevel: logLevelSchema.default('info'),
  databaseLevel: logLevelSchema.default('info'),
  retentionDays: z.number().default(7),
  terminalEnabled: z.boolean().default(true),
  databaseEnabled: z.boolean().default(true),
});

type LogConfig = z.infer<typeof logConfigSchema>;
type LogConfigInput = z.input<typeof logConfigSchema>;

// ============================================================================
// Exports
// ============================================================================

export type { LogLevel, LogEntry, LogContext, LogQueryFilters, LogStats, LogConfig, LogConfigInput };

export {
  logLevelSchema,
  logEntrySchema,
  logContextSchema,
  logQueryFiltersSchema,
  logStatsSchema,
  logConfigSchema,
  LOG_LEVEL_PRIORITY,
};
