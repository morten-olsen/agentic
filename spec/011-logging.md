# Logging System Specification

> Structured logging to database with terminal output and debugging tools

**Version**: 1.0
**Status**: Draft
**Dependencies**: Database, Debugging Skill (spec 010)

## Overview

The Logging System provides structured logging that writes to both the terminal (for real-time monitoring) and the database (for historical debugging). When combined with the Debugging Skill, the agent can query and analyze logs to diagnose issues like the "400 Provider returned error" scenario.

### Goals

1. **Dual Output**: Logs go to both terminal (immediate visibility) and database (queryable history)
2. **Structured Data**: Logs include level, timestamp, source, message, and arbitrary metadata
3. **Contextual Information**: Capture conversation ID, trigger ID, tool calls, and other context
4. **Efficient Storage**: Log rotation/retention to prevent unbounded growth
5. **Debug Integration**: Extend the Debugging Skill with log inspection tools

### Non-Goals (for v1)

- External log aggregation (Datadog, Splunk, etc.)
- Log streaming to external services
- Alerting based on log patterns
- Log encryption or access control
- Distributed tracing / correlation IDs across services

### Use Cases

1. **"Why did I get a 400 error?"** - Query recent error logs with context about what was being attempted
2. **"What happened during this trigger invocation?"** - Filter logs by trigger ID to see the full execution flow
3. **"Show me all errors in the last hour"** - Time-based filtering with level filter
4. **"What tool calls failed?"** - Filter by source (tools) and level (error)
5. **"Debug this conversation"** - Filter logs by conversation ID to trace issues

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Logging System                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │                      LogService                              │   │
│   │                                                              │   │
│   │  - log(level, message, context)                             │   │
│   │  - error(message, error, context)                           │   │
│   │  - warn(message, context)                                   │   │
│   │  - info(message, context)                                   │   │
│   │  - debug(message, context)                                  │   │
│   │                                                              │   │
│   │  Configuration:                                              │   │
│   │  - minLevel: 'debug' | 'info' | 'warn' | 'error'           │   │
│   │  - retentionDays: number (default: 7)                       │   │
│   │  - terminalOutput: boolean (default: true)                  │   │
│   │  - databaseOutput: boolean (default: true)                  │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│              ┌───────────────┼───────────────┐                      │
│              ▼               ▼               ▼                       │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│   │   Terminal   │  │   Database   │  │   (Future)   │             │
│   │   Output     │  │   Storage    │  │   External   │             │
│   │              │  │              │  │   Service    │             │
│   │  - Colors    │  │  - logs      │  │              │             │
│   │  - Formatting│  │    table     │  │              │             │
│   │  - Level     │  │  - Indexed   │  │              │             │
│   │    filtering │  │  - Retention │  │              │             │
│   └──────────────┘  └──────────────┘  └──────────────┘             │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    Debugging Skill Extension                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   New Tools:                                                         │
│   - debugging_search_logs     (query logs with filters)             │
│   - debugging_get_log_context (get surrounding logs for an entry)   │
│   - debugging_log_stats       (aggregate statistics)                │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Service-Based Logging**: Central `LogService` that all components use, ensuring consistent formatting and storage.

2. **Lazy Database Writes**: Logs are batched and written asynchronously to avoid blocking the main execution path.

3. **Structured Context**: Every log entry can include arbitrary metadata (conversation ID, trigger ID, tool name, error details, etc.).

4. **Retention Policy**: Automatic cleanup of old logs to prevent unbounded database growth.

5. **Level Hierarchy**: `debug` < `info` < `warn` < `error`. Terminal and database can have different minimum levels.

---

## Data Model

### Log Entry

```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogEntry = {
  id: string;                    // UUID
  timestamp: string;             // ISO8601
  level: LogLevel;
  source: string;                // Component name (e.g., 'orchestrator', 'trigger-service', 'tool:notify')
  message: string;               // Human-readable message

  // Optional context
  conversationId?: string;
  triggerId?: string;
  toolName?: string;

  // Error details (for level='error')
  errorName?: string;            // Error class name
  errorMessage?: string;         // Error message
  errorStack?: string;           // Stack trace

  // Arbitrary metadata as JSON
  metadata?: Record<string, unknown>;
};
```

### Database Schema

```sql
CREATE TABLE logs (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  level TEXT NOT NULL,
  source TEXT NOT NULL,
  message TEXT NOT NULL,

  conversation_id TEXT,
  trigger_id TEXT,
  tool_name TEXT,

  error_name TEXT,
  error_message TEXT,
  error_stack TEXT,

  metadata TEXT,  -- JSON

  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for common query patterns
CREATE INDEX logs_timestamp_idx ON logs(timestamp);
CREATE INDEX logs_level_idx ON logs(level);
CREATE INDEX logs_source_idx ON logs(source);
CREATE INDEX logs_conversation_id_idx ON logs(conversation_id);
CREATE INDEX logs_trigger_id_idx ON logs(trigger_id);
```

### Log Context

Context that can be attached to log calls:

```typescript
type LogContext = {
  conversationId?: string;
  triggerId?: string;
  toolName?: string;
  metadata?: Record<string, unknown>;
};
```

---

## LogService API

### Core Methods

```typescript
class LogService {
  /**
   * Log at a specific level.
   */
  log(level: LogLevel, source: string, message: string, context?: LogContext): void;

  /**
   * Log an error with full error details.
   */
  error(source: string, message: string, error: Error, context?: LogContext): void;

  /**
   * Convenience methods for each level.
   */
  warn(source: string, message: string, context?: LogContext): void;
  info(source: string, message: string, context?: LogContext): void;
  debug(source: string, message: string, context?: LogContext): void;

  /**
   * Create a child logger with preset context.
   * Useful for request-scoped logging.
   */
  child(context: LogContext): Logger;

  /**
   * Query logs from the database.
   */
  query(filters: LogQueryFilters): Promise<LogEntry[]>;

  /**
   * Get log statistics.
   */
  stats(filters?: LogQueryFilters): Promise<LogStats>;

  /**
   * Clean up old logs based on retention policy.
   */
  cleanup(): Promise<number>;  // Returns count of deleted logs
}
```

### Child Logger

For scoped logging within a context:

```typescript
type Logger = {
  error(message: string, error?: Error, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  debug(message: string, metadata?: Record<string, unknown>): void;
};

// Usage
const log = logService.child({
  source: 'orchestrator',
  conversationId: '123'
});

log.info('Starting chat');
log.error('LLM call failed', error, { model: 'gpt-4' });
```

### Query Filters

```typescript
type LogQueryFilters = {
  level?: LogLevel | LogLevel[];         // Filter by level(s)
  source?: string | string[];            // Filter by source(s)
  conversationId?: string;
  triggerId?: string;
  toolName?: string;

  since?: string;                        // ISO8601: logs after this time
  until?: string;                        // ISO8601: logs before this time

  search?: string;                       // Full-text search in message

  limit?: number;                        // Default: 100
  offset?: number;                       // For pagination
  order?: 'asc' | 'desc';               // Default: 'desc' (newest first)
};
```

### Log Statistics

```typescript
type LogStats = {
  total: number;
  byLevel: Record<LogLevel, number>;
  bySource: Record<string, number>;
  timeRange: {
    oldest: string;
    newest: string;
  };
  errorsLast24h: number;
  warningsLast24h: number;
};
```

---

## Debug Tools Extension

New tools added to the Debugging Skill:

### debugging_search_logs

Search and filter log entries.

```typescript
type DebugSearchLogsTool = {
  name: 'debugging_search_logs';
  description: `Search system logs with filters.

    Use this to investigate errors, trace execution flow, or understand
    what happened during a specific conversation or trigger invocation.

    Examples:
    - Find all errors: { level: 'error' }
    - Errors in last hour: { level: 'error', since: '1 hour ago' }
    - Logs for a conversation: { conversationId: '...' }
    - Tool execution logs: { source: 'tool:*' }
    - Search for specific text: { search: '400' }`;

  parameters: {
    level?: 'debug' | 'info' | 'warn' | 'error' | ('debug' | 'info' | 'warn' | 'error')[];
    source?: string | string[];
    conversationId?: string;
    triggerId?: string;
    toolName?: string;
    since?: string;              // Natural language or ISO8601
    until?: string;
    search?: string;
    limit?: number;              // Default: 50
  };

  returns: {
    logs: LogEntry[];
    total: number;               // Total matching (may be > logs.length)
    hasMore: boolean;
  };

  risk: {
    level: 'low';
    reason: 'Read-only query of log data';
  };
};
```

### debugging_get_log_context

Get surrounding log entries for context.

```typescript
type DebugGetLogContextTool = {
  name: 'debugging_get_log_context';
  description: `Get log entries surrounding a specific log entry.

    Useful when you find an error and want to see what happened
    before and after it. Returns logs within a time window.`;

  parameters: {
    logId: string;               // The log entry to center on
    before?: number;             // Entries before (default: 10)
    after?: number;              // Entries after (default: 10)
    sameSourceOnly?: boolean;    // Only logs from same source
  };

  returns: {
    target: LogEntry;
    before: LogEntry[];
    after: LogEntry[];
  };

  risk: {
    level: 'low';
    reason: 'Read-only query of log data';
  };
};
```

### debugging_log_stats

Get aggregate statistics about logs.

```typescript
type DebugLogStatsTool = {
  name: 'debugging_log_stats';
  description: `Get aggregate statistics about system logs.

    Shows error/warning counts, logs by source, time ranges, etc.
    Useful for getting an overview of system health.`;

  parameters: {
    since?: string;              // Only stats for logs after this time
  };

  returns: LogStats;

  risk: {
    level: 'low';
    reason: 'Read-only aggregate query';
  };
};
```

---

## Integration Points

### Orchestrator

```typescript
// In chat() method
const log = this.#logService.child({
  source: 'orchestrator',
  conversationId,
});

log.info('Starting chat');

try {
  const result = await compiledGraph.invoke(...);
  log.info('Chat completed', { turns: result.turnCount });
} catch (error) {
  log.error('Chat failed', error, {
    messageLength: message.length,
  });
  throw error;
}
```

### Tool Execution

```typescript
// In tool node
const log = logService.child({
  source: `tool:${tool.id}`,
  conversationId,
  toolName: tool.id,
});

log.debug('Executing tool', { input });

try {
  const result = await tool.execute(input, context);
  log.debug('Tool completed', { outputSize: JSON.stringify(result).length });
  return result;
} catch (error) {
  log.error('Tool failed', error);
  throw error;
}
```

### Trigger Service

```typescript
// In fire() method
const log = this.#logService.child({
  source: 'trigger-service',
  triggerId: trigger.id,
});

log.info('Firing trigger', { triggerName: trigger.name });

try {
  const conversationId = await orchestrator.invokeBackground(...);
  log.info('Trigger completed', { conversationId });
} catch (error) {
  log.error('Trigger failed', error);
}
```

### LLM Calls

```typescript
// In router node
const log = logService.child({
  source: 'llm',
  conversationId: state.conversationId,
});

log.debug('Calling LLM', {
  model: this.#config.model,
  messageCount: messages.length,
});

try {
  const response = await llm.invoke(messages);
  log.debug('LLM response received', {
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens,
    hasToolCalls: !!response.tool_calls?.length,
  });
  return response;
} catch (error) {
  log.error('LLM call failed', error, {
    model: this.#config.model,
  });
  throw error;
}
```

---

## Terminal Output Format

Colorized, human-readable format for terminal:

```
[17:23:45.123] INFO  orchestrator Starting chat conversation_id=abc123
[17:23:45.456] DEBUG llm          Calling LLM model=gpt-4 message_count=5
[17:23:46.789] DEBUG llm          LLM response input_tokens=1234 output_tokens=567
[17:23:46.800] DEBUG tool:notify  Executing tool
[17:23:47.100] ERROR tool:notify  Tool failed: Connection refused
                                  Error: ECONNREFUSED 127.0.0.1:8080
                                    at TCPConnectWrap.afterConnect [as oncomplete] (net.js:1141:16)
```

Colors:
- `DEBUG`: gray
- `INFO`: blue
- `WARN`: yellow
- `ERROR`: red
- Timestamps: dim
- Source: cyan

---

## Configuration

```typescript
type LogConfig = {
  /** Minimum level for terminal output */
  terminalLevel: LogLevel;       // Default: 'info'

  /** Minimum level for database storage */
  databaseLevel: LogLevel;       // Default: 'info'

  /** Days to retain logs in database */
  retentionDays: number;         // Default: 7

  /** Enable terminal output */
  terminalEnabled: boolean;      // Default: true

  /** Enable database storage */
  databaseEnabled: boolean;      // Default: true

  /** Batch size for async database writes */
  batchSize: number;             // Default: 100

  /** Flush interval for batched writes (ms) */
  flushInterval: number;         // Default: 1000
};
```

Environment variables:

```bash
GLADOS_LOG_TERMINAL_LEVEL=info
GLADOS_LOG_DATABASE_LEVEL=debug
GLADOS_LOG_RETENTION_DAYS=7
```

---

## Implementation

### File Structure

```
src/logging/
├── index.ts                    # Barrel export
├── logging.ts                  # LogService class
├── logging.schemas.ts          # Zod schemas
├── logging.store.ts            # Database operations
├── logging.terminal.ts         # Terminal formatter
├── logging.config.ts           # Configuration
├── logging.errors.ts           # Custom errors
└── logging.test.ts             # Tests

src/skills/debugging/
├── debugging.tools.ts          # Add new log tools
└── debugging.ts                # Update domain knowledge
```

### Migration

```typescript
// src/database/migrations/021_create_logs.ts
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('logs', (table) => {
    table.text('id').primary();
    table.text('timestamp').notNullable();
    table.text('level').notNullable();
    table.text('source').notNullable();
    table.text('message').notNullable();

    table.text('conversation_id');
    table.text('trigger_id');
    table.text('tool_name');

    table.text('error_name');
    table.text('error_message');
    table.text('error_stack');

    table.text('metadata');  // JSON

    table.text('created_at').notNullable().defaultTo(knex.fn.now());

    table.index('timestamp');
    table.index('level');
    table.index('source');
    table.index('conversation_id');
    table.index('trigger_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('logs');
}
```

---

## Domain Knowledge Extension

Add to debugging skill domain knowledge:

```markdown
## Log Inspection

You have access to system logs for debugging:

### Searching Logs

Use `debugging_search_logs` to find relevant entries:
- Filter by level: `{ level: 'error' }` or `{ level: ['error', 'warn'] }`
- Filter by time: `{ since: '1 hour ago' }` or `{ since: '2024-01-15T10:00:00Z' }`
- Filter by context: `{ conversationId: '...' }` or `{ triggerId: '...' }`
- Search text: `{ search: '400' }` matches message content

### Common Log Sources

- `orchestrator` - Main conversation handling
- `llm` - LLM API calls and responses
- `tool:*` - Tool execution (e.g., `tool:notify`, `tool:create_trigger`)
- `trigger-service` - Trigger scheduling and firing
- `skill-activation` - Skill activation flow

### Debugging Flow with Logs

1. **Find the error**: `{ level: 'error', since: '1 hour ago' }`
2. **Get context**: Use `debugging_get_log_context` with the error's log ID
3. **Trace the conversation**: `{ conversationId: '...', order: 'asc' }`
4. **Check related systems**: Filter by relevant source

### Understanding Error Logs

Error logs include:
- `errorName`: The error class (e.g., 'TypeError', 'APIError')
- `errorMessage`: The error message
- `errorStack`: Full stack trace
- `metadata`: Additional context (model, input size, etc.)
```

---

## Testing Strategy

### Unit Tests

```typescript
describe('LogService', () => {
  describe('logging methods', () => {
    it('writes to terminal with correct formatting');
    it('writes to database with all fields');
    it('respects minimum level configuration');
    it('batches database writes');
    it('flushes on interval');
  });

  describe('child logger', () => {
    it('inherits context from parent');
    it('merges additional context');
    it('uses child source');
  });

  describe('query', () => {
    it('filters by level');
    it('filters by source pattern');
    it('filters by time range');
    it('searches message text');
    it('paginates results');
  });

  describe('cleanup', () => {
    it('deletes logs older than retention period');
    it('returns count of deleted logs');
  });
});
```

### Integration Tests

```typescript
describe('logging integration', () => {
  it('logs LLM errors with full context');
  it('logs tool execution flow');
  it('logs trigger invocation lifecycle');
  it('logs are queryable via debug tools');
});
```

---

## Implementation Phases

### Phase 1: Core Infrastructure

- [ ] Log entry schema
- [ ] Database migration
- [ ] LogService class
- [ ] Terminal formatter
- [ ] Configuration

### Phase 2: Integration

- [ ] Integrate with OrchestratorService
- [ ] Integrate with TriggerService
- [ ] Integrate with tool execution
- [ ] Integrate with LLM calls

### Phase 3: Debug Tools

- [ ] debugging_search_logs
- [ ] debugging_get_log_context
- [ ] debugging_log_stats
- [ ] Update domain knowledge

### Phase 4: Maintenance

- [ ] Automatic cleanup job
- [ ] Log rotation
- [ ] Documentation

---

## Future Considerations

1. **Log Aggregation**: Integration with external services (Datadog, etc.)

2. **Structured Queries**: More advanced query language for complex filters

3. **Real-time Streaming**: WebSocket endpoint for live log tailing

4. **Correlation IDs**: Track requests across components with correlation IDs

5. **Log Sampling**: Sample debug logs in production to reduce volume

6. **Alerting**: Trigger notifications based on log patterns (error rate, etc.)

7. **Log Annotations**: Allow marking logs with notes for investigation

8. **Export**: Export logs to file for sharing/analysis
