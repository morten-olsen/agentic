import type { Knex } from 'knex';

import type { CalendarSyncState, SyncStatus } from './calendar-sync.schemas.ts';

// ============================================================================
// Row Type
// ============================================================================

type CalendarSyncStateRow = {
  source_id: string;
  last_sync_at: string;
  last_sync_status: string;
  error_message: string | null;
  events_in_window: number;
};

// ============================================================================
// Converters
// ============================================================================

const stateFromRow = (row: CalendarSyncStateRow): CalendarSyncState => ({
  sourceId: row.source_id,
  lastSyncAt: row.last_sync_at,
  lastSyncStatus: row.last_sync_status as SyncStatus,
  errorMessage: row.error_message ?? undefined,
  eventsInWindow: row.events_in_window,
});

// ============================================================================
// Operations
// ============================================================================

const getSyncState = async (knex: Knex, sourceId: string): Promise<CalendarSyncState | null> => {
  const row = await knex<CalendarSyncStateRow>('calendar_sync_state').where('source_id', sourceId).first();
  return row ? stateFromRow(row) : null;
};

const getAllSyncStates = async (knex: Knex): Promise<CalendarSyncState[]> => {
  const rows = await knex<CalendarSyncStateRow>('calendar_sync_state').orderBy('source_id');
  return rows.map(stateFromRow);
};

type UpdateSyncStateInput = {
  lastSyncAt: string;
  lastSyncStatus: SyncStatus;
  errorMessage?: string;
  eventsInWindow: number;
};

const updateSyncState = async (
  knex: Knex,
  sourceId: string,
  input: UpdateSyncStateInput,
): Promise<CalendarSyncState> => {
  const row: CalendarSyncStateRow = {
    source_id: sourceId,
    last_sync_at: input.lastSyncAt,
    last_sync_status: input.lastSyncStatus,
    error_message: input.errorMessage ?? null,
    events_in_window: input.eventsInWindow,
  };

  // Upsert - insert or update on conflict
  await knex('calendar_sync_state')
    .insert(row)
    .onConflict('source_id')
    .merge(['last_sync_at', 'last_sync_status', 'error_message', 'events_in_window']);

  const result = await getSyncState(knex, sourceId);
  if (!result) {
    throw new Error('Failed to update sync state');
  }
  return result;
};

const deleteSyncState = async (knex: Knex, sourceId: string): Promise<void> => {
  await knex('calendar_sync_state').where('source_id', sourceId).delete();
};

export type { UpdateSyncStateInput };
export { getSyncState, getAllSyncStates, updateSyncState, deleteSyncState };
