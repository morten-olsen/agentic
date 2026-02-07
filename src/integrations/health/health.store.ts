import type { Knex } from 'knex';

import type {
  HealthRecord,
  NormalizedHealthRecordInput,
  HealthQueryFilter,
  HealthWebhookState,
  HealthRecordType,
  HealthProvider,
  NormalizedData,
  WebhookStatus,
} from './health.schemas.ts';
import { healthQueryFilterSchema } from './health.schemas.ts';

// ============================================================================
// Row Types
// ============================================================================

type HealthRecordRow = {
  id: string;
  provider: string;
  external_id: string;
  type: string;
  date: string;
  period_start: string;
  period_end: string;
  score: number | null;
  normalized_data: string;
  raw_data: string;
  recorded_at: string;
  received_at: string;
  created_at: string;
};

type WebhookStateRow = {
  id: string;
  subscription_id: string | null;
  subscribed_types: string;
  callback_url: string;
  expires_at: string | null;
  last_event_at: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

// ============================================================================
// Converters
// ============================================================================

const now = (): string => new Date().toISOString();

const recordFromRow = (row: HealthRecordRow): HealthRecord => ({
  id: row.id,
  provider: row.provider as HealthProvider,
  externalId: row.external_id,
  type: row.type as HealthRecordType,
  date: row.date,
  periodStart: row.period_start,
  periodEnd: row.period_end,
  score: row.score,
  normalizedData: JSON.parse(row.normalized_data) as NormalizedData,
  rawData: JSON.parse(row.raw_data) as Record<string, unknown>,
  recordedAt: row.recorded_at,
  receivedAt: row.received_at,
  createdAt: row.created_at,
});

const webhookStateFromRow = (row: WebhookStateRow): HealthWebhookState => ({
  id: row.id,
  subscriptionId: row.subscription_id,
  subscribedTypes: JSON.parse(row.subscribed_types) as string[],
  callbackUrl: row.callback_url,
  expiresAt: row.expires_at,
  lastEventAt: row.last_event_at,
  status: row.status as WebhookStatus,
  errorMessage: row.error_message,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// ============================================================================
// Health Record Operations
// ============================================================================

/**
 * Upserts a health record.
 * If a record with the same provider and external_id exists, updates it.
 */
const upsertRecord = async (knex: Knex, id: string, input: NormalizedHealthRecordInput): Promise<HealthRecord> => {
  const timestamp = now();

  const row: HealthRecordRow = {
    id,
    provider: input.provider,
    external_id: input.externalId,
    type: input.type,
    date: input.date,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    score: input.score,
    normalized_data: JSON.stringify(input.normalizedData),
    raw_data: JSON.stringify(input.rawData),
    recorded_at: input.recordedAt,
    received_at: timestamp,
    created_at: timestamp,
  };

  // Check if record exists
  const existing = await knex<HealthRecordRow>('health_records')
    .where('provider', input.provider)
    .where('external_id', input.externalId)
    .first();

  if (existing) {
    // Update existing record
    await knex('health_records').where('id', existing.id).update({
      type: row.type,
      date: row.date,
      period_start: row.period_start,
      period_end: row.period_end,
      score: row.score,
      normalized_data: row.normalized_data,
      raw_data: row.raw_data,
      recorded_at: row.recorded_at,
      received_at: row.received_at,
    });

    const updated = await getRecord(knex, existing.id);
    if (!updated) {
      throw new Error('Failed to update health record');
    }
    return updated;
  }

  // Insert new record
  await knex('health_records').insert(row);

  const created = await getRecord(knex, id);
  if (!created) {
    throw new Error('Failed to create health record');
  }
  return created;
};

/**
 * Gets a health record by ID.
 */
const getRecord = async (knex: Knex, id: string): Promise<HealthRecord | null> => {
  const row = await knex<HealthRecordRow>('health_records').where('id', id).first();
  return row ? recordFromRow(row) : null;
};

/**
 * Gets health records by filter.
 */
const getRecords = async (knex: Knex, filter: HealthQueryFilter): Promise<HealthRecord[]> => {
  const parsed = healthQueryFilterSchema.parse(filter);

  let query = knex<HealthRecordRow>('health_records');

  if (parsed.type) {
    query = query.where('type', parsed.type);
  }

  if (parsed.provider) {
    query = query.where('provider', parsed.provider);
  }

  if (parsed.startDate) {
    query = query.where('date', '>=', parsed.startDate);
  }

  if (parsed.endDate) {
    query = query.where('date', '<=', parsed.endDate);
  }

  query = query.orderBy('date', 'desc').limit(parsed.limit ?? 7);

  const rows = await query;
  return rows.map(recordFromRow);
};

/**
 * Gets the latest record of a specific type.
 */
const getLatestByType = async (knex: Knex, type: HealthRecordType): Promise<HealthRecord | null> => {
  const row = await knex<HealthRecordRow>('health_records').where('type', type).orderBy('date', 'desc').first();
  return row ? recordFromRow(row) : null;
};

/**
 * Gets sleep records for a date range and calculates summary.
 */
const getSleepRecords = async (knex: Knex, startDate: string, endDate: string): Promise<HealthRecord[]> => {
  const rows = await knex<HealthRecordRow>('health_records')
    .where('type', 'sleep')
    .where('date', '>=', startDate)
    .where('date', '<=', endDate)
    .orderBy('date', 'desc');

  return rows.map(recordFromRow);
};

/**
 * Deletes a health record by ID.
 */
const deleteRecord = async (knex: Knex, id: string): Promise<boolean> => {
  const deleted = await knex('health_records').where('id', id).delete();
  return deleted > 0;
};

/**
 * Deletes health records by provider and external ID.
 */
const deleteByExternalId = async (knex: Knex, provider: HealthProvider, externalId: string): Promise<boolean> => {
  const deleted = await knex('health_records').where('provider', provider).where('external_id', externalId).delete();
  return deleted > 0;
};

// ============================================================================
// Webhook State Operations
// ============================================================================

/**
 * Gets webhook state for a provider.
 */
const getWebhookState = async (knex: Knex, provider: string): Promise<HealthWebhookState | null> => {
  const row = await knex<WebhookStateRow>('health_webhook_state').where('id', provider).first();
  return row ? webhookStateFromRow(row) : null;
};

/**
 * Upserts webhook state.
 */
const upsertWebhookState = async (knex: Knex, state: HealthWebhookState): Promise<HealthWebhookState> => {
  const timestamp = now();

  const row: WebhookStateRow = {
    id: state.id,
    subscription_id: state.subscriptionId,
    subscribed_types: JSON.stringify(state.subscribedTypes),
    callback_url: state.callbackUrl,
    expires_at: state.expiresAt,
    last_event_at: state.lastEventAt,
    status: state.status,
    error_message: state.errorMessage,
    created_at: state.createdAt ?? timestamp,
    updated_at: timestamp,
  };

  const existing = await getWebhookState(knex, state.id);

  if (existing) {
    await knex('health_webhook_state').where('id', state.id).update({
      subscription_id: row.subscription_id,
      subscribed_types: row.subscribed_types,
      callback_url: row.callback_url,
      expires_at: row.expires_at,
      last_event_at: row.last_event_at,
      status: row.status,
      error_message: row.error_message,
      updated_at: row.updated_at,
    });
  } else {
    await knex('health_webhook_state').insert(row);
  }

  const result = await getWebhookState(knex, state.id);
  if (!result) {
    throw new Error('Failed to upsert webhook state');
  }
  return result;
};

/**
 * Updates last event timestamp for a provider.
 */
const updateLastEventAt = async (knex: Knex, provider: string): Promise<void> => {
  const timestamp = now();
  await knex('health_webhook_state').where('id', provider).update({
    last_event_at: timestamp,
    updated_at: timestamp,
  });
};

// ============================================================================
// Exports
// ============================================================================

export {
  upsertRecord,
  getRecord,
  getRecords,
  getLatestByType,
  getSleepRecords,
  deleteRecord,
  deleteByExternalId,
  getWebhookState,
  upsertWebhookState,
  updateLastEventAt,
};
