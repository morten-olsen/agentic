import type { LogLevel, LogEntry } from './logging.schemas.ts';

// ============================================================================
// ANSI Color Codes
// ============================================================================

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  white: '\x1b[37m',
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: COLORS.gray,
  info: COLORS.blue,
  warn: COLORS.yellow,
  error: COLORS.red,
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
};

// ============================================================================
// Formatter
// ============================================================================

/**
 * Format a timestamp for terminal output.
 */
const formatTimestamp = (timestamp: string): string => {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  const ms = date.getMilliseconds().toString().padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${ms}`;
};

/**
 * Format metadata as key=value pairs.
 */
const formatMetadata = (metadata: Record<string, unknown>): string => {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || value === null) continue;
    const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
    // Truncate long values
    const truncated = strValue.length > 50 ? strValue.slice(0, 47) + '...' : strValue;
    pairs.push(`${key}=${truncated}`);
  }
  return pairs.join(' ');
};

/**
 * Format a log entry for terminal output.
 */
const formatLogEntry = (entry: LogEntry): string => {
  const levelColor = LEVEL_COLORS[entry.level];
  const levelLabel = LEVEL_LABELS[entry.level];

  // Build the main line
  const timestamp = `${COLORS.dim}[${formatTimestamp(entry.timestamp)}]${COLORS.reset}`;
  const level = `${levelColor}${levelLabel}${COLORS.reset}`;
  const source = `${COLORS.cyan}${entry.source.padEnd(12)}${COLORS.reset}`;

  let line = `${timestamp} ${level} ${source} ${entry.message}`;

  // Add context metadata
  const contextMeta: Record<string, unknown> = {};
  if (entry.conversationId) contextMeta.conversation_id = entry.conversationId.slice(0, 8);
  if (entry.triggerId) contextMeta.trigger_id = entry.triggerId.slice(0, 8);
  if (entry.toolName) contextMeta.tool = entry.toolName;
  if (entry.metadata) Object.assign(contextMeta, entry.metadata);

  if (Object.keys(contextMeta).length > 0) {
    line += ` ${COLORS.dim}${formatMetadata(contextMeta)}${COLORS.reset}`;
  }

  // Add error details for error level
  if (entry.level === 'error' && (entry.errorMessage || entry.errorStack)) {
    const errorLines: string[] = [];

    if (entry.errorName && entry.errorMessage) {
      errorLines.push(`${COLORS.red}${entry.errorName}: ${entry.errorMessage}${COLORS.reset}`);
    } else if (entry.errorMessage) {
      errorLines.push(`${COLORS.red}${entry.errorMessage}${COLORS.reset}`);
    }

    if (entry.errorStack) {
      // Indent stack trace
      const stackLines = entry.errorStack.split('\n').slice(1, 6); // Skip first line, show up to 5 frames
      for (const stackLine of stackLines) {
        errorLines.push(`${COLORS.dim}${stackLine}${COLORS.reset}`);
      }
      if (entry.errorStack.split('\n').length > 6) {
        errorLines.push(`${COLORS.dim}  ... (${entry.errorStack.split('\n').length - 6} more frames)${COLORS.reset}`);
      }
    }

    if (errorLines.length > 0) {
      const indent = ' '.repeat(34); // Align with message
      line += '\n' + errorLines.map((l) => indent + l).join('\n');
    }
  }

  return line;
};

/**
 * Write a log entry to the terminal.
 */
const writeToTerminal = (entry: LogEntry): void => {
  const formatted = formatLogEntry(entry);

  if (entry.level === 'error') {
    console.error(formatted);
  } else if (entry.level === 'warn') {
    console.warn(formatted);
  } else {
    console.log(formatted);
  }
};

// ============================================================================
// Exports
// ============================================================================

export { formatLogEntry, formatTimestamp, formatMetadata, writeToTerminal, COLORS, LEVEL_COLORS, LEVEL_LABELS };
