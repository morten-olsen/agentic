import type { Knex } from 'knex';

import type {
  OperatorManual,
  CreateManualInput,
  UpdateManualInput,
  AddCorrectionInput,
  ManualRow,
  UserCorrection,
} from './operator-manuals.schemas.ts';
import { createManualInputSchema, addCorrectionInputSchema } from './operator-manuals.schemas.ts';

// ============================================================================
// Helpers
// ============================================================================

const generateId = (): string => crypto.randomUUID();
const now = (): string => new Date().toISOString();

const rowToManual = (row: ManualRow): OperatorManual => ({
  id: row.id,
  name: row.name,
  domain: row.domain,
  description: row.description ?? undefined,
  steps: JSON.parse(row.steps),
  bestPractices: row.best_practices ? JSON.parse(row.best_practices) : [],
  commonMistakes: row.common_mistakes ? JSON.parse(row.common_mistakes) : [],
  userCorrections: row.user_corrections ? JSON.parse(row.user_corrections) : [],
  lastUsedAt: row.last_used_at ?? undefined,
  useCount: row.use_count,
  successRate: row.success_rate,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// ============================================================================
// Manual CRUD
// ============================================================================

const createManual = async (db: Knex, input: CreateManualInput): Promise<OperatorManual> => {
  const validated = createManualInputSchema.parse(input);
  const id = generateId();
  const timestamp = now();

  const row: ManualRow = {
    id,
    name: validated.name,
    domain: validated.domain,
    description: validated.description ?? null,
    steps: JSON.stringify(validated.steps),
    best_practices: JSON.stringify(validated.bestPractices),
    common_mistakes: JSON.stringify(validated.commonMistakes),
    user_corrections: JSON.stringify([]),
    last_used_at: null,
    use_count: 0,
    success_rate: 1.0,
    created_at: timestamp,
    updated_at: timestamp,
  };

  await db('operator_manuals').insert(row);
  return rowToManual(row);
};

const getManual = async (db: Knex, id: string): Promise<OperatorManual | null> => {
  const row = await db<ManualRow>('operator_manuals').where({ id }).first();
  return row ? rowToManual(row) : null;
};

const updateManual = async (db: Knex, id: string, updates: UpdateManualInput): Promise<OperatorManual | null> => {
  const timestamp = now();

  const updateData: Partial<ManualRow> = {
    updated_at: timestamp,
  };

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.domain !== undefined) updateData.domain = updates.domain;
  if (updates.description !== undefined) updateData.description = updates.description;
  if (updates.steps !== undefined) updateData.steps = JSON.stringify(updates.steps);
  if (updates.bestPractices !== undefined) updateData.best_practices = JSON.stringify(updates.bestPractices);
  if (updates.commonMistakes !== undefined) updateData.common_mistakes = JSON.stringify(updates.commonMistakes);

  const count = await db('operator_manuals').where({ id }).update(updateData);
  if (count === 0) return null;

  return getManual(db, id);
};

const deleteManual = async (db: Knex, id: string): Promise<boolean> => {
  const count = await db('operator_manuals').where({ id }).delete();
  return count > 0;
};

// ============================================================================
// Manual Queries
// ============================================================================

const findByName = async (db: Knex, name: string): Promise<OperatorManual | null> => {
  const row = await db<ManualRow>('operator_manuals').where({ name }).first();
  return row ? rowToManual(row) : null;
};

const findByDomain = async (db: Knex, domain: string): Promise<OperatorManual[]> => {
  const rows = await db<ManualRow>('operator_manuals').where({ domain }).orderBy('use_count', 'desc');
  return rows.map(rowToManual);
};

const searchManuals = async (db: Knex, query: string): Promise<OperatorManual[]> => {
  const rows = await db<ManualRow>('operator_manuals')
    .where('name', 'like', `%${query}%`)
    .orWhere('description', 'like', `%${query}%`)
    .orderBy('use_count', 'desc')
    .limit(20);
  return rows.map(rowToManual);
};

const listManuals = async (db: Knex, options?: { domain?: string; limit?: number }): Promise<OperatorManual[]> => {
  let query = db<ManualRow>('operator_manuals');

  if (options?.domain) {
    query = query.where({ domain: options.domain });
  }

  query = query.orderBy('last_used_at', 'desc');

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const rows = await query;
  return rows.map(rowToManual);
};

// ============================================================================
// Usage Tracking
// ============================================================================

const recordUsage = async (db: Knex, id: string, success: boolean): Promise<void> => {
  const manual = await getManual(db, id);
  if (!manual) return;

  const timestamp = now();
  const newUseCount = manual.useCount + 1;

  // Calculate new success rate as running average
  const newSuccessRate = (manual.successRate * manual.useCount + (success ? 1 : 0)) / newUseCount;

  await db('operator_manuals').where({ id }).update({
    last_used_at: timestamp,
    use_count: newUseCount,
    success_rate: newSuccessRate,
    updated_at: timestamp,
  });
};

// ============================================================================
// Learning
// ============================================================================

const addCorrection = async (db: Knex, id: string, input: AddCorrectionInput): Promise<OperatorManual | null> => {
  const manual = await getManual(db, id);
  if (!manual) return null;

  const validated = addCorrectionInputSchema.parse(input);
  const timestamp = now();

  const newCorrection: UserCorrection = {
    timestamp,
    ...validated,
  };

  const corrections = [...manual.userCorrections, newCorrection];

  await db('operator_manuals')
    .where({ id })
    .update({
      user_corrections: JSON.stringify(corrections),
      updated_at: timestamp,
    });

  return getManual(db, id);
};

const addBestPractice = async (db: Knex, id: string, practice: string): Promise<OperatorManual | null> => {
  const manual = await getManual(db, id);
  if (!manual) return null;

  const timestamp = now();
  const practices = [...manual.bestPractices, practice];

  await db('operator_manuals')
    .where({ id })
    .update({
      best_practices: JSON.stringify(practices),
      updated_at: timestamp,
    });

  return getManual(db, id);
};

const addCommonMistake = async (db: Knex, id: string, mistake: string): Promise<OperatorManual | null> => {
  const manual = await getManual(db, id);
  if (!manual) return null;

  const timestamp = now();
  const mistakes = [...manual.commonMistakes, mistake];

  await db('operator_manuals')
    .where({ id })
    .update({
      common_mistakes: JSON.stringify(mistakes),
      updated_at: timestamp,
    });

  return getManual(db, id);
};

// ============================================================================
// Exports
// ============================================================================

export {
  createManual,
  getManual,
  updateManual,
  deleteManual,
  findByName,
  findByDomain,
  searchManuals,
  listManuals,
  recordUsage,
  addCorrection,
  addBestPractice,
  addCommonMistake,
};
