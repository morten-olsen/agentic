import type { Knex } from 'knex';

import type { Services } from '../services/services.ts';
import { DatabaseService } from '../database/database.ts';

import type { Event, EmitEventInput, EventQueryFilter, EventQueryResult, Checkpoint } from './events.schemas.ts';
import {
  emitEvent,
  emitEvents,
  queryEvents,
  getEvent,
  getMostRecentEvent,
  getCheckpoint,
  setCheckpoint,
  deleteCheckpoint,
  listCheckpoints,
  cleanupEvents,
  countEvents,
  countEventsByDomain,
  type EmitResult,
} from './events.store.ts';

// ============================================================================
// Configuration
// ============================================================================

type EventServiceConfig = {
  // Retention
  retentionDays?: number;

  // Query limits
  defaultQueryLimit?: number;
  maxQueryLimit?: number;
};

const DEFAULT_CONFIG: Required<EventServiceConfig> = {
  retentionDays: 30,
  defaultQueryLimit: 100,
  maxQueryLimit: 1000,
};

// ============================================================================
// EventService
// ============================================================================

/**
 * EventService - unified event stream for system changes.
 *
 * Provides:
 * - Event emission with deduplication
 * - Event querying with wildcard filtering
 * - Checkpoint management for background tasks
 * - Retention-based cleanup
 */
class EventService {
  #services: Services;
  #config: Required<EventServiceConfig>;

  constructor(services: Services, config?: EventServiceConfig) {
    this.#services = services;
    this.#config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Gets the Knex instance from the database service.
   */
  #db = (): Knex => {
    return this.#services.get(DatabaseService).knex;
  };

  // ==========================================================================
  // Event Emission
  // ==========================================================================

  /**
   * Emits an event to the event log.
   *
   * Handles deduplication:
   * - If externalId matches existing event with same content → skip
   * - If externalId matches existing event with different content → error
   * - If no externalId, uses content hash for deduplication
   *
   * @returns The created event, or null if skipped/error
   */
  emit = async (input: EmitEventInput): Promise<Event | null> => {
    const result = await emitEvent(this.#db(), input);

    if (result.status === 'error') {
      throw new EventEmissionError(result.error ?? 'Unknown error');
    }

    return result.event;
  };

  /**
   * Emits an event and returns detailed result including status.
   */
  emitWithResult = async (input: EmitEventInput): Promise<EmitResult> => {
    return emitEvent(this.#db(), input);
  };

  /**
   * Emits multiple events in a batch.
   */
  emitBatch = async (inputs: EmitEventInput[]): Promise<(Event | null)[]> => {
    const results = await emitEvents(this.#db(), inputs);
    return results.map((r) => {
      if (r.status === 'error') {
        console.warn('Event emission error:', r.error);
      }
      return r.event;
    });
  };

  // ==========================================================================
  // Event Queries
  // ==========================================================================

  /**
   * Queries events with filtering and pagination.
   *
   * @param filter - Query filter options
   * @returns Events matching the filter with pagination info
   *
   * @example
   * // Get all calendar events from today
   * const result = await eventService.query({
   *   types: ['calendar.*'],
   *   since: '2024-01-15T00:00:00Z',
   * });
   *
   * @example
   * // Get events for a specific entity
   * const result = await eventService.query({
   *   entityId: 'task-123',
   *   entityType: 'task',
   * });
   */
  query = async (filter: EventQueryFilter = {}): Promise<EventQueryResult> => {
    return queryEvents(this.#db(), {
      ...filter,
      limit: Math.min(filter.limit ?? this.#config.defaultQueryLimit, this.#config.maxQueryLimit),
    });
  };

  /**
   * Gets events since a specific event ID.
   *
   * This is useful for consumers that process events incrementally.
   */
  since = async (eventId: string, filter?: Omit<EventQueryFilter, 'since'>): Promise<EventQueryResult> => {
    return this.query({ ...filter, since: eventId });
  };

  /**
   * Gets a single event by ID.
   */
  get = async (id: string): Promise<Event | null> => {
    return getEvent(this.#db(), id);
  };

  /**
   * Gets the most recent event.
   */
  getMostRecent = async (): Promise<Event | null> => {
    return getMostRecentEvent(this.#db());
  };

  // ==========================================================================
  // Checkpoint Management
  // ==========================================================================

  /**
   * Gets the checkpoint (last processed event ID) for a task.
   */
  getCheckpoint = async (taskId: string): Promise<string | null> => {
    return getCheckpoint(this.#db(), taskId);
  };

  /**
   * Sets the checkpoint for a task.
   */
  setCheckpoint = async (taskId: string, eventId: string): Promise<void> => {
    return setCheckpoint(this.#db(), taskId, eventId);
  };

  /**
   * Deletes a checkpoint for a task.
   */
  deleteCheckpoint = async (taskId: string): Promise<boolean> => {
    return deleteCheckpoint(this.#db(), taskId);
  };

  /**
   * Lists all checkpoints.
   */
  listCheckpoints = async (): Promise<Checkpoint[]> => {
    return listCheckpoints(this.#db());
  };

  /**
   * Gets events since the checkpoint for a task.
   *
   * If no checkpoint exists, returns all events matching the filter.
   *
   * @example
   * const { events, total } = await eventService.eventsSinceCheckpoint('daily-summary', {
   *   types: ['calendar.*', 'tasks.*'],
   * });
   *
   * if (events.length > 0) {
   *   // Process events...
   *   await eventService.setCheckpoint('daily-summary', events[events.length - 1].id);
   * }
   */
  eventsSinceCheckpoint = async (
    taskId: string,
    filter?: Omit<EventQueryFilter, 'since'>,
  ): Promise<EventQueryResult> => {
    const checkpoint = await this.getCheckpoint(taskId);
    if (checkpoint) {
      return this.since(checkpoint, filter);
    }
    return this.query(filter);
  };

  // ==========================================================================
  // Maintenance
  // ==========================================================================

  /**
   * Cleans up events older than the retention period.
   *
   * @param retentionDays - Number of days to retain (defaults to config)
   * @returns Number of deleted events
   */
  cleanup = async (retentionDays?: number): Promise<number> => {
    return cleanupEvents(this.#db(), retentionDays ?? this.#config.retentionDays);
  };

  /**
   * Gets the total count of events in the log.
   */
  count = async (): Promise<number> => {
    return countEvents(this.#db());
  };

  /**
   * Gets event counts grouped by domain (top-level type prefix).
   */
  countByDomain = async (): Promise<Record<string, number>> => {
    return countEventsByDomain(this.#db());
  };

  // ==========================================================================
  // Configuration
  // ==========================================================================

  /**
   * Gets the current configuration.
   */
  get config(): Required<EventServiceConfig> {
    return { ...this.#config };
  }
}

// ============================================================================
// Errors
// ============================================================================

class EventEmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventEmissionError';
  }
}

// ============================================================================
// Re-exports
// ============================================================================

export type { Event, EmitEventInput, EventQueryFilter, EventQueryResult, Checkpoint } from './events.schemas.ts';

export {
  eventSchema,
  emitEventInputSchema,
  eventQueryFilterSchema,
  eventQueryResultSchema,
  checkpointSchema,
} from './events.schemas.ts';

export type { EmitResult } from './events.store.ts';

export type { EventServiceConfig };
export { EventService, EventEmissionError };
