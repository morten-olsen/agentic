import type { Knex } from 'knex';

import type {
  ProactiveCheck,
  CheckRow,
  CreateCheckInput,
  UpdateCheckInput,
  ProactiveRun,
  RunRow,
  RunStatus,
  ProactiveResult,
} from './proactive.schemas.ts';
import { createCheckInputSchema } from './proactive.schemas.ts';

// ============================================================================
// Helpers
// ============================================================================

const generateId = (): string => crypto.randomUUID();
const now = (): string => new Date().toISOString();

// ============================================================================
// Check Row Conversion
// ============================================================================

const rowToCheck = (row: CheckRow): ProactiveCheck => {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    schedule: row.schedule,
    checkType: row.check_type as ProactiveCheck['checkType'],
    enabled: row.enabled === 1,
    config: row.config ? JSON.parse(row.config) : undefined,
    lastRunAt: row.last_run_at ?? undefined,
    lastResult: row.last_result ? JSON.parse(row.last_result) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// ============================================================================
// Check CRUD
// ============================================================================

const createCheck = async (db: Knex, input: CreateCheckInput): Promise<ProactiveCheck> => {
  const validated = createCheckInputSchema.parse(input);
  const id = generateId();
  const timestamp = now();

  const row: CheckRow = {
    id,
    name: validated.name,
    description: validated.description,
    schedule: validated.schedule,
    check_type: validated.checkType,
    enabled: validated.enabled ? 1 : 0,
    config: validated.config ? JSON.stringify(validated.config) : null,
    last_run_at: null,
    last_result: null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  await db('proactive_checks').insert(row);
  return rowToCheck(row);
};

const getCheck = async (db: Knex, id: string): Promise<ProactiveCheck | null> => {
  const row = await db<CheckRow>('proactive_checks').where({ id }).first();
  return row ? rowToCheck(row) : null;
};

const getCheckByName = async (db: Knex, name: string): Promise<ProactiveCheck | null> => {
  const row = await db<CheckRow>('proactive_checks').where({ name }).first();
  return row ? rowToCheck(row) : null;
};

const updateCheck = async (db: Knex, id: string, updates: UpdateCheckInput): Promise<ProactiveCheck | null> => {
  const timestamp = now();

  const updateData: Partial<CheckRow> = {
    updated_at: timestamp,
  };

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.description !== undefined) updateData.description = updates.description;
  if (updates.schedule !== undefined) updateData.schedule = updates.schedule;
  if (updates.enabled !== undefined) updateData.enabled = updates.enabled ? 1 : 0;
  if (updates.config !== undefined) updateData.config = JSON.stringify(updates.config);
  if (updates.lastRunAt !== undefined) updateData.last_run_at = updates.lastRunAt;
  if (updates.lastResult !== undefined)
    updateData.last_result = updates.lastResult ? JSON.stringify(updates.lastResult) : null;

  const count = await db('proactive_checks').where({ id }).update(updateData);
  if (count === 0) return null;

  return getCheck(db, id);
};

const deleteCheck = async (db: Knex, id: string): Promise<boolean> => {
  const count = await db('proactive_checks').where({ id }).delete();
  return count > 0;
};

// ============================================================================
// Check Queries
// ============================================================================

const listChecks = async (db: Knex, options?: { enabled?: boolean; checkType?: string }): Promise<ProactiveCheck[]> => {
  let query = db<CheckRow>('proactive_checks');

  if (options?.enabled !== undefined) {
    query = query.where({ enabled: options.enabled ? 1 : 0 });
  }

  if (options?.checkType) {
    query = query.where({ check_type: options.checkType });
  }

  const rows = await query.orderBy('name', 'asc');
  return rows.map(rowToCheck);
};

const getEnabledChecks = async (db: Knex): Promise<ProactiveCheck[]> => {
  return listChecks(db, { enabled: true });
};

// ============================================================================
// Run Row Conversion
// ============================================================================

const rowToRun = (row: RunRow): ProactiveRun => {
  return {
    id: row.id,
    checkId: row.check_id,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    status: row.status as RunStatus,
    result: row.result ? JSON.parse(row.result) : undefined,
    error: row.error ?? undefined,
    notificationId: row.notification_id ?? undefined,
  };
};

// ============================================================================
// Run CRUD
// ============================================================================

const createRun = async (db: Knex, checkId: string): Promise<ProactiveRun> => {
  const id = generateId();
  const timestamp = now();

  const row: RunRow = {
    id,
    check_id: checkId,
    started_at: timestamp,
    completed_at: null,
    status: 'running',
    result: null,
    error: null,
    notification_id: null,
  };

  await db('proactive_runs').insert(row);
  return rowToRun(row);
};

const getRun = async (db: Knex, id: string): Promise<ProactiveRun | null> => {
  const row = await db<RunRow>('proactive_runs').where({ id }).first();
  return row ? rowToRun(row) : null;
};

const updateRun = async (
  db: Knex,
  id: string,
  updates: {
    status?: RunStatus;
    result?: ProactiveResult;
    error?: string;
    notificationId?: string;
    completedAt?: string;
  },
): Promise<ProactiveRun | null> => {
  const updateData: Partial<RunRow> = {};

  if (updates.status !== undefined) updateData.status = updates.status;
  if (updates.result !== undefined) updateData.result = JSON.stringify(updates.result);
  if (updates.error !== undefined) updateData.error = updates.error;
  if (updates.notificationId !== undefined) updateData.notification_id = updates.notificationId;
  if (updates.completedAt !== undefined) updateData.completed_at = updates.completedAt;

  const count = await db('proactive_runs').where({ id }).update(updateData);
  if (count === 0) return null;

  return getRun(db, id);
};

const completeRun = async (
  db: Knex,
  id: string,
  result: ProactiveResult | null,
  notificationId?: string,
): Promise<ProactiveRun | null> => {
  const timestamp = now();

  const updateData: Partial<RunRow> = {
    status: result ? 'completed' : 'skipped',
    completed_at: timestamp,
    notification_id: notificationId ?? null,
  };

  if (result) {
    updateData.result = JSON.stringify(result);
  }

  const count = await db('proactive_runs').where({ id }).update(updateData);
  if (count === 0) return null;

  return getRun(db, id);
};

const failRun = async (db: Knex, id: string, error: string): Promise<ProactiveRun | null> => {
  const timestamp = now();

  const updateData: Partial<RunRow> = {
    status: 'failed',
    completed_at: timestamp,
    error,
  };

  const count = await db('proactive_runs').where({ id }).update(updateData);
  if (count === 0) return null;

  return getRun(db, id);
};

// ============================================================================
// Run Queries
// ============================================================================

const listRuns = async (
  db: Knex,
  options?: { checkId?: string; status?: RunStatus; limit?: number },
): Promise<ProactiveRun[]> => {
  let query = db<RunRow>('proactive_runs');

  if (options?.checkId) {
    query = query.where({ check_id: options.checkId });
  }

  if (options?.status) {
    query = query.where({ status: options.status });
  }

  query = query.orderBy('started_at', 'desc');

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const rows = await query;
  return rows.map(rowToRun);
};

const getLatestRun = async (db: Knex, checkId: string): Promise<ProactiveRun | null> => {
  const row = await db<RunRow>('proactive_runs')
    .where({ check_id: checkId })
    .orderBy('started_at', 'desc')
    .orderBy('rowid', 'desc') // Secondary sort for deterministic ordering when timestamps match
    .first();
  return row ? rowToRun(row) : null;
};

const getRunningRuns = async (db: Knex): Promise<ProactiveRun[]> => {
  const rows = await db<RunRow>('proactive_runs').where({ status: 'running' });
  return rows.map(rowToRun);
};

// ============================================================================
// Exports
// ============================================================================

export {
  // Checks
  createCheck,
  getCheck,
  getCheckByName,
  updateCheck,
  deleteCheck,
  listChecks,
  getEnabledChecks,
  // Runs
  createRun,
  getRun,
  updateRun,
  completeRun,
  failRun,
  listRuns,
  getLatestRun,
  getRunningRuns,
};
