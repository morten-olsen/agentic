import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import type { Services } from '../services/services.ts';
import { DatabaseService } from '../database/database.ts';
import { EventService } from '../events/events.ts';

import type {
  HealthRecord,
  HealthRecordType,
  NormalizedHealthRecordInput,
  HealthQueryFilter,
  SleepSummary,
  HealthWebhookState,
  HealthProvider,
  SleepData,
} from './health.schemas.ts';
import {
  upsertRecord,
  getRecord,
  getRecords,
  getLatestByType,
  getSleepRecords,
  deleteByExternalId,
  getWebhookState,
  upsertWebhookState,
  updateLastEventAt,
} from './health.store.ts';

// ============================================================================
// Configuration
// ============================================================================

type HealthServiceConfig = {
  defaultQueryLimit?: number;
  maxQueryLimit?: number;
};

const DEFAULT_CONFIG: Required<HealthServiceConfig> = {
  defaultQueryLimit: 7,
  maxQueryLimit: 100,
};

// ============================================================================
// HealthService
// ============================================================================

/**
 * HealthService - manages health and wellness data from wearable devices.
 *
 * Provides:
 * - Health record ingestion from webhook handlers
 * - Querying and summarizing health data
 * - Webhook subscription state tracking
 * - Event emission to the Event Log
 */
class HealthService {
  #services: Services;
  #config: Required<HealthServiceConfig>;

  constructor(services: Services, config?: HealthServiceConfig) {
    this.#services = services;
    this.#config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Gets the Knex instance from the database service.
   */
  #db = (): Knex => {
    return this.#services.get(DatabaseService).knex;
  };

  /**
   * Gets the event service for emitting health events.
   */
  #events = (): EventService => {
    return this.#services.get(EventService);
  };

  // ==========================================================================
  // Record Ingestion
  // ==========================================================================

  /**
   * Ingests a normalized health record.
   * Called by webhook handlers after normalizing provider data.
   */
  ingestRecord = async (input: NormalizedHealthRecordInput): Promise<HealthRecord> => {
    const id = uuidv4();
    const record = await upsertRecord(this.#db(), id, input);

    // Emit event to Event Log
    await this.#emitHealthEvent('logged', record);

    // Update webhook last event timestamp
    await updateLastEventAt(this.#db(), input.provider);

    return record;
  };

  /**
   * Handles a record update (from webhook update event).
   */
  updateRecord = async (input: NormalizedHealthRecordInput): Promise<HealthRecord> => {
    const record = await upsertRecord(this.#db(), uuidv4(), input);

    // Emit update event
    await this.#emitHealthEvent('updated', record);

    // Update webhook last event timestamp
    await updateLastEventAt(this.#db(), input.provider);

    return record;
  };

  /**
   * Handles a record deletion (from webhook delete event).
   */
  deleteRecordByExternalId = async (
    provider: HealthProvider,
    externalId: string,
    type: HealthRecordType,
  ): Promise<boolean> => {
    const deleted = await deleteByExternalId(this.#db(), provider, externalId);

    if (deleted) {
      // Emit delete event
      await this.#events().emit({
        type: `health.${type}.deleted`,
        source: 'health-service',
        externalId: `${provider}-${externalId}`,
        summary: `${type} data deleted from ${provider}`,
        data: { provider, externalId, type },
      });

      // Update webhook last event timestamp
      await updateLastEventAt(this.#db(), provider);
    }

    return deleted;
  };

  // ==========================================================================
  // Record Queries
  // ==========================================================================

  /**
   * Gets a health record by ID.
   */
  getRecord = async (id: string): Promise<HealthRecord | null> => {
    return getRecord(this.#db(), id);
  };

  /**
   * Gets health records by filter.
   */
  getRecords = async (filter: HealthQueryFilter = {}): Promise<HealthRecord[]> => {
    return getRecords(this.#db(), {
      ...filter,
      limit: Math.min(filter.limit ?? this.#config.defaultQueryLimit, this.#config.maxQueryLimit),
    });
  };

  /**
   * Gets the latest record of a specific type.
   */
  getLatestByType = async (type: HealthRecordType): Promise<HealthRecord | null> => {
    return getLatestByType(this.#db(), type);
  };

  // ==========================================================================
  // Summaries
  // ==========================================================================

  /**
   * Gets a summary of sleep data over a date range.
   */
  getSleepSummary = async (startDate: string, endDate: string): Promise<SleepSummary> => {
    const records = await getSleepRecords(this.#db(), startDate, endDate);

    if (records.length === 0) {
      return {
        averageDurationMinutes: 0,
        averageScore: null,
        averageEfficiency: null,
        totalNights: 0,
        trend: 'stable',
      };
    }

    // Calculate averages
    let totalDuration = 0;
    let totalScore = 0;
    let totalEfficiency = 0;
    let scoreCount = 0;
    let efficiencyCount = 0;

    for (const record of records) {
      const sleepData = record.normalizedData as SleepData;
      totalDuration += sleepData.totalSleepMinutes;

      if (sleepData.score !== null) {
        totalScore += sleepData.score;
        scoreCount++;
      }

      if (sleepData.efficiency !== null) {
        totalEfficiency += sleepData.efficiency;
        efficiencyCount++;
      }
    }

    const avgDuration = totalDuration / records.length;
    const avgScore = scoreCount > 0 ? totalScore / scoreCount : null;
    const avgEfficiency = efficiencyCount > 0 ? totalEfficiency / efficiencyCount : null;

    // Calculate trend (compare first half to second half)
    const trend = this.#calculateTrend(records);

    return {
      averageDurationMinutes: Math.round(avgDuration),
      averageScore: avgScore !== null ? Math.round(avgScore) : null,
      averageEfficiency: avgEfficiency !== null ? Math.round(avgEfficiency) : null,
      totalNights: records.length,
      trend,
    };
  };

  /**
   * Gets the readiness score for a specific date.
   */
  getReadinessScore = async (date: string): Promise<number | null> => {
    const records = await getRecords(this.#db(), { type: 'readiness', startDate: date, endDate: date, limit: 1 });
    if (records.length === 0) return null;
    return records[0].score;
  };

  // ==========================================================================
  // Webhook State
  // ==========================================================================

  /**
   * Gets the webhook state for a provider.
   */
  getWebhookState = async (provider: string): Promise<HealthWebhookState | null> => {
    return getWebhookState(this.#db(), provider);
  };

  /**
   * Updates the webhook state for a provider.
   */
  updateWebhookState = async (state: HealthWebhookState): Promise<HealthWebhookState> => {
    return upsertWebhookState(this.#db(), state);
  };

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Emits a health event to the Event Log.
   * Uses record.id and UUID to ensure uniqueness for each event emission.
   */
  #emitHealthEvent = async (action: 'logged' | 'updated', record: HealthRecord): Promise<void> => {
    const eventId = uuidv4();
    await this.#events().emit({
      type: `health.${record.type}.${action}`,
      source: 'health-service',
      externalId: `${record.provider}-${record.id}-${action}-${eventId}`,
      summary: this.#buildHealthSummary(record),
      data: {
        provider: record.provider,
        type: record.type,
        date: record.date,
        score: record.score,
      },
      entityId: record.id,
      entityType: 'health-record',
    });
  };

  /**
   * Builds a human-readable summary for a health record.
   */
  #buildHealthSummary = (record: HealthRecord): string => {
    const scoreText = record.score !== null ? ` (score: ${record.score})` : '';
    return `${record.type} data from ${record.provider} for ${record.date}${scoreText}`;
  };

  /**
   * Calculates trend based on comparing first half to second half of records.
   */
  #calculateTrend = (records: HealthRecord[]): 'improving' | 'declining' | 'stable' => {
    if (records.length < 2) return 'stable';

    const midpoint = Math.floor(records.length / 2);
    const recentRecords = records.slice(0, midpoint);
    const olderRecords = records.slice(midpoint);

    const recentAvg = this.#averageScore(recentRecords);
    const olderAvg = this.#averageScore(olderRecords);

    if (recentAvg === null || olderAvg === null) return 'stable';

    const diff = recentAvg - olderAvg;
    if (diff > 5) return 'improving';
    if (diff < -5) return 'declining';
    return 'stable';
  };

  /**
   * Calculates average score from records.
   */
  #averageScore = (records: HealthRecord[]): number | null => {
    const scores = records.filter((r) => r.score !== null).map((r) => r.score as number);
    if (scores.length === 0) return null;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  };

  // ==========================================================================
  // Configuration
  // ==========================================================================

  /**
   * Gets the current configuration.
   */
  get config(): Required<HealthServiceConfig> {
    return { ...this.#config };
  }
}

// ============================================================================
// Re-exports
// ============================================================================

export type {
  HealthRecordType,
  HealthProvider,
  SleepData,
  ActivityData,
  ReadinessData,
  GenericHealthData,
  NormalizedData,
  HealthRecord,
  NormalizedHealthRecordInput,
  HealthQueryFilter,
  SleepSummary,
  WebhookStatus,
  HealthWebhookState,
} from './health.schemas.ts';

export {
  healthRecordTypeSchema,
  healthProviderSchema,
  sleepDataSchema,
  activityDataSchema,
  readinessDataSchema,
  healthRecordSchema,
  normalizedHealthRecordInputSchema,
  healthQueryFilterSchema,
  sleepSummarySchema,
  healthWebhookStateSchema,
} from './health.schemas.ts';

export type { HealthServiceConfig };
export { HealthService };
