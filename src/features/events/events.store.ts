import crypto from 'node:crypto';

import type { Knex } from 'knex';

import type {
  Event,
  EmitEventInput,
  EventQueryFilter,
  EventQueryResult,
  EventRow,
  Checkpoint,
  CheckpointRow,
} from './events.schemas.ts';
import { emitEventInputSchema, eventQueryFilterSchema } from './events.schemas.ts';

// ============================================================================
// Helpers
// ============================================================================

const generateId = (): string => crypto.randomUUID();
const now = (): string => new Date().toISOString();

/**
 * Generates a content hash for deduplication when no externalId is provided.
 */
const generateContentHash = (input: EmitEventInput): string => {
  const hashContent = JSON.stringify({
    type: input.type,
    entityId: input.entityId,
    timestamp: input.timestamp,
    data: input.data,
  });
  return crypto.createHash('sha256').update(hashContent).digest('hex').slice(0, 16);
};

/**
 * Converts wildcard patterns to SQL LIKE patterns.
 * 'calendar.*' → 'calendar.%'
 * 'tasks.task.completed' → exact match (no wildcard)
 */
const convertWildcardToLike = (pattern: string): { pattern: string; isWildcard: boolean } => {
  if (pattern.endsWith('.*')) {
    return { pattern: pattern.slice(0, -1) + '%', isWildcard: true };
  }
  return { pattern, isWildcard: false };
};

// ============================================================================
// Row Conversion
// ============================================================================

/**
 * Converts a database row to an Event object.
 */
const rowToEvent = (row: EventRow): Event => {
  return {
    id: row.id,
    type: row.type,
    timestamp: row.timestamp,
    source: row.source,
    externalId: row.external_id ?? undefined,
    hash: row.hash ?? undefined,
    summary: row.summary ?? undefined,
    data: JSON.parse(row.data) as Record<string, unknown>,
    entityId: row.entity_id ?? undefined,
    entityType: row.entity_type ?? undefined,
    conversationId: row.conversation_id ?? undefined,
    messageId: row.message_id ?? undefined,
    createdAt: row.created_at,
  };
};

/**
 * Converts a checkpoint row to a Checkpoint object.
 */
const rowToCheckpoint = (row: CheckpointRow): Checkpoint => {
  return {
    taskId: row.task_id,
    lastEventId: row.last_event_id,
    updatedAt: row.updated_at,
  };
};

// ============================================================================
// Event Emission
// ============================================================================

/**
 * Result of an emit operation.
 */
type EmitResult = {
  event: Event | null;
  status: 'created' | 'skipped' | 'error';
  error?: string;
};

/**
 * Emits an event to the event log.
 * Handles deduplication based on externalId or content hash.
 *
 * Returns:
 * - { event, status: 'created' } if a new event was created
 * - { event: null, status: 'skipped' } if duplicate was detected
 * - { event: null, status: 'error', error } if emission failed
 */
const emitEvent = async (db: Knex, input: EmitEventInput): Promise<EmitResult> => {
  const validated = emitEventInputSchema.parse(input);
  const timestamp = validated.timestamp ?? now();
  const createdAt = now();

  // Generate hash for content-based dedup if no externalId
  const hash = validated.externalId ? null : generateContentHash({ ...validated, timestamp });

  // Check for existing event
  if (validated.externalId) {
    const existing = await db<EventRow>('events')
      .where({ source: validated.source, external_id: validated.externalId })
      .first();

    if (existing) {
      // Check if content matches (idempotent retry)
      const existingData = JSON.parse(existing.data);
      const newDataStr = JSON.stringify(validated.data ?? {});
      const existingDataStr = JSON.stringify(existingData);

      if (
        existing.type === validated.type &&
        existing.summary === (validated.summary ?? null) &&
        existingDataStr === newDataStr
      ) {
        // Identical event - skip
        return { event: null, status: 'skipped' };
      }

      // Same externalId but different content - error
      return {
        event: null,
        status: 'error',
        error:
          `Event with externalId '${validated.externalId}' already exists with different content. ` +
          `For mutable entities, include version/timestamp in externalId.`,
      };
    }
  } else if (hash) {
    // Check for duplicate by hash within a time window (5 minutes)
    const windowStart = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const existing = await db<EventRow>('events')
      .where({ source: validated.source, hash })
      .where('timestamp', '>=', windowStart)
      .first();

    if (existing) {
      return { event: null, status: 'skipped' };
    }
  }

  // Insert the event
  const id = generateId();
  const row: EventRow = {
    id,
    type: validated.type,
    timestamp,
    source: validated.source,
    external_id: validated.externalId ?? null,
    hash,
    summary: validated.summary ?? null,
    data: JSON.stringify(validated.data ?? {}),
    entity_id: validated.entityId ?? null,
    entity_type: validated.entityType ?? null,
    conversation_id: validated.conversationId ?? null,
    message_id: validated.messageId ?? null,
    created_at: createdAt,
  };

  await db('events').insert(row);
  return { event: rowToEvent(row), status: 'created' };
};

/**
 * Emits multiple events in a batch.
 */
const emitEvents = async (db: Knex, inputs: EmitEventInput[]): Promise<EmitResult[]> => {
  const results: EmitResult[] = [];
  for (const input of inputs) {
    const result = await emitEvent(db, input);
    results.push(result);
  }
  return results;
};

// ============================================================================
// Event Queries
// ============================================================================

/**
 * Applies query filters to a Knex query builder.
 */
const applyEventFilters = (
  query: Knex.QueryBuilder,
  validated: EventQueryFilter,
  sinceTimestamp?: string,
): Knex.QueryBuilder => {
  let q = query;

  // Time range filtering
  if (sinceTimestamp) {
    q = q.where('timestamp', '>', sinceTimestamp);
  } else if (validated.since) {
    q = q.where('timestamp', '>=', validated.since);
  }

  if (validated.until) {
    q = q.where('timestamp', '<=', validated.until);
  }

  // Type filtering with wildcards
  if (validated.types && validated.types.length > 0) {
    const types = validated.types;
    q = q.where((builder) => {
      for (const typePattern of types) {
        const { pattern, isWildcard } = convertWildcardToLike(typePattern);
        if (isWildcard) {
          builder.orWhere('type', 'LIKE', pattern);
        } else {
          builder.orWhere('type', '=', pattern);
        }
      }
    });
  }

  // Entity filtering
  if (validated.entityId) {
    q = q.where('entity_id', validated.entityId);
  }
  if (validated.entityType) {
    q = q.where('entity_type', validated.entityType);
  }

  // Conversation filtering
  if (validated.conversationId) {
    q = q.where('conversation_id', validated.conversationId);
  }
  if (validated.messageId) {
    q = q.where('message_id', validated.messageId);
  }

  return q;
};

/**
 * Queries events with filtering and pagination.
 */
const queryEvents = async (db: Knex, filter: EventQueryFilter = {}): Promise<EventQueryResult> => {
  const validated = eventQueryFilterSchema.parse(filter);
  const { limit, offset } = validated;
  const maxLimit = Math.min(limit, 1000); // Cap at 1000

  // Check if 'since' is an event ID (UUID) and resolve to timestamp
  let sinceTimestamp: string | undefined;
  if (validated.since) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(validated.since);
    if (isUuid) {
      const refEvent = await db<EventRow>('events').where({ id: validated.since }).first();
      if (refEvent) {
        sinceTimestamp = refEvent.timestamp;
      }
    }
  }

  // Build and apply filters
  const baseQuery = applyEventFilters(db('events'), validated, sinceTimestamp);

  // Get total count
  const countResult = await baseQuery.clone().count('* as count').first();
  const total = Number(countResult?.count ?? 0);

  // Get paginated results
  const rows = (await baseQuery.clone().orderBy('timestamp', 'desc').limit(maxLimit).offset(offset)) as EventRow[];

  const events = rows.map(rowToEvent);
  const hasMore = offset + events.length < total;

  return {
    events,
    total,
    hasMore,
    nextOffset: hasMore ? offset + events.length : undefined,
  };
};

/**
 * Gets a single event by ID.
 */
const getEvent = async (db: Knex, id: string): Promise<Event | null> => {
  const row = await db<EventRow>('events').where({ id }).first();
  return row ? rowToEvent(row) : null;
};

/**
 * Gets the most recent event (useful for initialization).
 */
const getMostRecentEvent = async (db: Knex): Promise<Event | null> => {
  const row = await db<EventRow>('events').orderBy('timestamp', 'desc').first();
  return row ? rowToEvent(row) : null;
};

// ============================================================================
// Checkpoint Management
// ============================================================================

/**
 * Gets the checkpoint for a task.
 */
const getCheckpoint = async (db: Knex, taskId: string): Promise<string | null> => {
  const row = await db<CheckpointRow>('event_checkpoints').where({ task_id: taskId }).first();
  return row ? row.last_event_id : null;
};

/**
 * Sets the checkpoint for a task.
 */
const setCheckpoint = async (db: Knex, taskId: string, lastEventId: string): Promise<void> => {
  const timestamp = now();

  await db('event_checkpoints')
    .insert({
      task_id: taskId,
      last_event_id: lastEventId,
      updated_at: timestamp,
    })
    .onConflict('task_id')
    .merge({
      last_event_id: lastEventId,
      updated_at: timestamp,
    });
};

/**
 * Deletes a checkpoint for a task.
 */
const deleteCheckpoint = async (db: Knex, taskId: string): Promise<boolean> => {
  const count = await db('event_checkpoints').where({ task_id: taskId }).delete();
  return count > 0;
};

/**
 * Lists all checkpoints.
 */
const listCheckpoints = async (db: Knex): Promise<Checkpoint[]> => {
  const rows = await db<CheckpointRow>('event_checkpoints').orderBy('updated_at', 'desc');
  return rows.map(rowToCheckpoint);
};

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Deletes events older than the specified number of days.
 * Returns the number of deleted events.
 */
const cleanupEvents = async (db: Knex, retentionDays: number): Promise<number> => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const cutoffStr = cutoff.toISOString();

  const count = await db('events').where('timestamp', '<', cutoffStr).delete();
  return count;
};

/**
 * Gets the count of events in the log.
 */
const countEvents = async (db: Knex): Promise<number> => {
  const result = await db('events').count('* as count').first();
  return (result?.count as number) ?? 0;
};

/**
 * Gets event counts grouped by type prefix (domain).
 */
const countEventsByDomain = async (db: Knex): Promise<Record<string, number>> => {
  // SQLite doesn't have a split function, so we'll do this in JS
  const rows = await db<EventRow>('events').select('type');

  const counts: Record<string, number> = {};
  for (const row of rows) {
    const domain = row.type.split('.')[0];
    counts[domain] = (counts[domain] ?? 0) + 1;
  }

  return counts;
};

// ============================================================================
// Exports
// ============================================================================

export {
  // Helpers
  generateContentHash,
  convertWildcardToLike,
  // Row conversion
  rowToEvent,
  rowToCheckpoint,
  // Event operations
  emitEvent,
  emitEvents,
  queryEvents,
  getEvent,
  getMostRecentEvent,
  // Checkpoint operations
  getCheckpoint,
  setCheckpoint,
  deleteCheckpoint,
  listCheckpoints,
  // Cleanup
  cleanupEvents,
  countEvents,
  countEventsByDomain,
};

export type { EmitResult };
