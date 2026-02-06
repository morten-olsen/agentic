import type { Knex } from 'knex';

import type { LogEntry, LogQueryFilters, LogStats, LogLevel } from './logging.schemas.ts';

// ============================================================================
// Database Row Type
// ============================================================================

type LogRow = {
  id: string;
  timestamp: string;
  level: string;
  source: string;
  message: string;
  conversation_id: string | null;
  trigger_id: string | null;
  tool_name: string | null;
  error_name: string | null;
  error_message: string | null;
  error_stack: string | null;
  metadata: string | null;
  created_at: string;
};

// ============================================================================
// Conversion Functions
// ============================================================================

const rowToLogEntry = (row: LogRow): LogEntry => ({
  id: row.id,
  timestamp: row.timestamp,
  level: row.level as LogLevel,
  source: row.source,
  message: row.message,
  conversationId: row.conversation_id ?? undefined,
  triggerId: row.trigger_id ?? undefined,
  toolName: row.tool_name ?? undefined,
  errorName: row.error_name ?? undefined,
  errorMessage: row.error_message ?? undefined,
  errorStack: row.error_stack ?? undefined,
  metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
});

const logEntryToRow = (entry: LogEntry): Omit<LogRow, 'created_at'> => ({
  id: entry.id,
  timestamp: entry.timestamp,
  level: entry.level,
  source: entry.source,
  message: entry.message,
  conversation_id: entry.conversationId ?? null,
  trigger_id: entry.triggerId ?? null,
  tool_name: entry.toolName ?? null,
  error_name: entry.errorName ?? null,
  error_message: entry.errorMessage ?? null,
  error_stack: entry.errorStack ?? null,
  metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
});

// ============================================================================
// Store Functions
// ============================================================================

/**
 * Insert a log entry into the database.
 */
const insertLog = async (db: Knex, entry: LogEntry): Promise<void> => {
  const row = logEntryToRow(entry);
  await db('logs').insert({
    ...row,
    created_at: new Date().toISOString(),
  });
};

/**
 * Insert multiple log entries (batch insert).
 */
const insertLogs = async (db: Knex, entries: LogEntry[]): Promise<void> => {
  if (entries.length === 0) return;

  const now = new Date().toISOString();
  const rows = entries.map((entry) => ({
    ...logEntryToRow(entry),
    created_at: now,
  }));

  await db('logs').insert(rows);
};

/**
 * Query logs with filters.
 */
const queryLogs = async (db: Knex, filters: LogQueryFilters): Promise<{ logs: LogEntry[]; total: number }> => {
  let query = db('logs');
  let countQuery = db('logs');

  // Apply filters
  const applyFilters = (q: Knex.QueryBuilder): Knex.QueryBuilder => {
    if (filters.level) {
      const levels = Array.isArray(filters.level) ? filters.level : [filters.level];
      q = q.whereIn('level', levels);
    }

    if (filters.source) {
      const sources = Array.isArray(filters.source) ? filters.source : [filters.source];
      // Support wildcards with LIKE
      if (sources.some((s) => s.includes('*'))) {
        q = q.where((builder) => {
          for (const source of sources) {
            if (source.includes('*')) {
              builder.orWhere('source', 'like', source.replace(/\*/g, '%'));
            } else {
              builder.orWhere('source', source);
            }
          }
        });
      } else {
        q = q.whereIn('source', sources);
      }
    }

    if (filters.conversationId) {
      q = q.where('conversation_id', filters.conversationId);
    }

    if (filters.triggerId) {
      q = q.where('trigger_id', filters.triggerId);
    }

    if (filters.toolName) {
      q = q.where('tool_name', filters.toolName);
    }

    if (filters.since) {
      q = q.where('timestamp', '>=', filters.since);
    }

    if (filters.until) {
      q = q.where('timestamp', '<=', filters.until);
    }

    if (filters.search) {
      q = q.where('message', 'like', `%${filters.search}%`);
    }

    return q;
  };

  query = applyFilters(query);
  countQuery = applyFilters(countQuery);

  // Get total count
  const countResult = await countQuery.count('* as count').first();
  const total = (countResult?.count as number) ?? 0;

  // Apply ordering and pagination
  query = query.orderBy('timestamp', filters.order ?? 'desc');

  if (filters.limit) {
    query = query.limit(filters.limit);
  }

  if (filters.offset) {
    query = query.offset(filters.offset);
  }

  const rows = (await query) as LogRow[];
  const logs = rows.map(rowToLogEntry);

  return { logs, total };
};

/**
 * Get a single log entry by ID.
 */
const getLog = async (db: Knex, id: string): Promise<LogEntry | null> => {
  const row = (await db('logs').where({ id }).first()) as LogRow | undefined;
  return row ? rowToLogEntry(row) : null;
};

/**
 * Get log statistics.
 */
const getLogStats = async (db: Knex, since?: string): Promise<LogStats> => {
  let baseQuery = db('logs');
  if (since) {
    baseQuery = baseQuery.where('timestamp', '>=', since);
  }

  // Total count
  const totalResult = await baseQuery.clone().count('* as count').first();
  const total = (totalResult?.count as number) ?? 0;

  // Count by level
  const levelCounts = await baseQuery
    .clone()
    .select('level')
    .count('* as count')
    .groupBy('level');

  const byLevel = {
    debug: 0,
    info: 0,
    warn: 0,
    error: 0,
  };
  for (const row of levelCounts as { level: string; count: number }[]) {
    byLevel[row.level as LogLevel] = row.count;
  }

  // Count by source (top 20)
  const sourceCounts = await baseQuery
    .clone()
    .select('source')
    .count('* as count')
    .groupBy('source')
    .orderBy('count', 'desc')
    .limit(20);

  const bySource: Record<string, number> = {};
  for (const row of sourceCounts as { source: string; count: number }[]) {
    bySource[row.source] = row.count;
  }

  // Time range
  const timeRange = await baseQuery
    .clone()
    .select(db.raw('MIN(timestamp) as oldest, MAX(timestamp) as newest'))
    .first();

  // Errors and warnings in last 24h
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const last24hCounts = await db('logs')
    .select('level')
    .count('* as count')
    .where('timestamp', '>=', last24h)
    .whereIn('level', ['error', 'warn'])
    .groupBy('level');

  let errorsLast24h = 0;
  let warningsLast24h = 0;
  for (const row of last24hCounts as { level: string; count: number }[]) {
    if (row.level === 'error') errorsLast24h = row.count;
    if (row.level === 'warn') warningsLast24h = row.count;
  }

  return {
    total,
    byLevel,
    bySource,
    timeRange: {
      oldest: (timeRange as { oldest: string | null; newest: string | null })?.oldest ?? null,
      newest: (timeRange as { oldest: string | null; newest: string | null })?.newest ?? null,
    },
    errorsLast24h,
    warningsLast24h,
  };
};

/**
 * Delete logs older than a certain date.
 */
const deleteLogs = async (db: Knex, before: string): Promise<number> => {
  const result = await db('logs').where('timestamp', '<', before).delete();
  return result;
};

/**
 * Get logs surrounding a specific log entry.
 */
const getLogContext = async (
  db: Knex,
  logId: string,
  options: { before?: number; after?: number; sameSourceOnly?: boolean },
): Promise<{ target: LogEntry | null; before: LogEntry[]; after: LogEntry[] }> => {
  const target = await getLog(db, logId);
  if (!target) {
    return { target: null, before: [], after: [] };
  }

  const beforeLimit = options.before ?? 10;
  const afterLimit = options.after ?? 10;

  let beforeQuery = db('logs').where('timestamp', '<', target.timestamp).orderBy('timestamp', 'desc').limit(beforeLimit);

  let afterQuery = db('logs').where('timestamp', '>', target.timestamp).orderBy('timestamp', 'asc').limit(afterLimit);

  if (options.sameSourceOnly) {
    beforeQuery = beforeQuery.where('source', target.source);
    afterQuery = afterQuery.where('source', target.source);
  }

  const beforeRows = (await beforeQuery) as LogRow[];
  const afterRows = (await afterQuery) as LogRow[];

  return {
    target,
    before: beforeRows.map(rowToLogEntry).reverse(), // Oldest first
    after: afterRows.map(rowToLogEntry),
  };
};

// ============================================================================
// Exports
// ============================================================================

export { insertLog, insertLogs, queryLogs, getLog, getLogStats, deleteLogs, getLogContext, rowToLogEntry, logEntryToRow };
