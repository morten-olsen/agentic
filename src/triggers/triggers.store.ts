import type { Knex } from 'knex';

import type {
  Trigger,
  TriggerRow,
  TriggerStatus,
  TriggerSchedule,
  CreateTriggerInput,
  UpdateTriggerInput,
  TriggerConversation,
  TriggerConversationRow,
} from './triggers.schemas.ts';
import { createTriggerInputSchema } from './triggers.schemas.ts';

// ============================================================================
// Helpers
// ============================================================================

const generateId = (): string => crypto.randomUUID();
const now = (): string => new Date().toISOString();

// ============================================================================
// Row Conversion
// ============================================================================

/**
 * Converts a database row to a Trigger object.
 */
const rowToTrigger = (row: TriggerRow): Trigger => {
  const schedule: TriggerSchedule =
    row.schedule_type === 'once'
      ? { type: 'once', at: row.schedule_value }
      : { type: 'cron', expression: row.schedule_value };

  return {
    id: row.id,
    name: row.name,
    goal: row.goal,
    schedule,
    modelTier: row.model_tier as Trigger['modelTier'],
    setupContext: row.setup_context ?? undefined,
    maxInvocations: row.max_invocations ?? undefined,
    endsAt: row.ends_at ?? undefined,
    status: row.status as TriggerStatus,
    invocationCount: row.invocation_count,
    consecutiveFailures: row.consecutive_failures,
    lastInvokedAt: row.last_invoked_at ?? undefined,
    nextInvocationAt: row.next_invocation_at ?? undefined,
    lastError: row.last_error ?? undefined,
    createdByConversationId: row.created_by_conversation_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

/**
 * Converts a TriggerConversation row to object.
 */
const rowToTriggerConversation = (row: TriggerConversationRow): TriggerConversation => {
  return {
    triggerId: row.trigger_id,
    conversationId: row.conversation_id,
    invokedAt: row.invoked_at,
  };
};

// ============================================================================
// Trigger CRUD
// ============================================================================

/**
 * Creates a new trigger.
 */
const createTrigger = async (db: Knex, input: CreateTriggerInput, conversationId?: string): Promise<Trigger> => {
  const validated = createTriggerInputSchema.parse(input);
  const id = generateId();
  const timestamp = now();

  const row: TriggerRow = {
    id,
    name: validated.name,
    goal: validated.goal,
    schedule_type: validated.schedule.type,
    schedule_value: validated.schedule.type === 'once' ? validated.schedule.at : validated.schedule.expression,
    model_tier: validated.modelTier ?? null,
    setup_context: validated.setupContext ?? null,
    max_invocations: validated.maxInvocations ?? null,
    ends_at: validated.endsAt ?? null,
    status: 'active',
    invocation_count: 0,
    consecutive_failures: 0,
    last_invoked_at: null,
    next_invocation_at: null,
    last_error: null,
    created_by_conversation_id: conversationId ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  await db('triggers').insert(row);
  return rowToTrigger(row);
};

/**
 * Gets a trigger by ID.
 */
const getTrigger = async (db: Knex, id: string): Promise<Trigger | null> => {
  const row = await db<TriggerRow>('triggers').where({ id }).first();
  return row ? rowToTrigger(row) : null;
};

/**
 * Gets a trigger by name.
 */
const getTriggerByName = async (db: Knex, name: string): Promise<Trigger | null> => {
  const row = await db<TriggerRow>('triggers').where({ name }).first();
  return row ? rowToTrigger(row) : null;
};

/**
 * Internal update type that extends the public input with internal-only fields.
 */
type InternalTriggerUpdate = Omit<UpdateTriggerInput, 'status'> & {
  invocationCount?: number;
  consecutiveFailures?: number;
  lastInvokedAt?: string;
  nextInvocationAt?: string | null;
  lastError?: string | null;
  status?: TriggerStatus; // Internal can set any status
};

/**
 * Updates a trigger.
 */
const updateTrigger = async (db: Knex, id: string, updates: InternalTriggerUpdate): Promise<Trigger | null> => {
  const timestamp = now();

  const updateData: Partial<TriggerRow> = {
    updated_at: timestamp,
  };

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.goal !== undefined) updateData.goal = updates.goal;
  if (updates.schedule !== undefined) {
    updateData.schedule_type = updates.schedule.type;
    updateData.schedule_value = updates.schedule.type === 'once' ? updates.schedule.at : updates.schedule.expression;
  }
  if (updates.modelTier !== undefined) updateData.model_tier = updates.modelTier;
  if (updates.setupContext !== undefined) updateData.setup_context = updates.setupContext;
  if (updates.maxInvocations !== undefined) updateData.max_invocations = updates.maxInvocations;
  if (updates.endsAt !== undefined) updateData.ends_at = updates.endsAt;
  if (updates.status !== undefined) updateData.status = updates.status;
  if (updates.invocationCount !== undefined) updateData.invocation_count = updates.invocationCount;
  if (updates.consecutiveFailures !== undefined) updateData.consecutive_failures = updates.consecutiveFailures;
  if (updates.lastInvokedAt !== undefined) updateData.last_invoked_at = updates.lastInvokedAt;
  if (updates.nextInvocationAt !== undefined) updateData.next_invocation_at = updates.nextInvocationAt;
  if (updates.lastError !== undefined) updateData.last_error = updates.lastError;

  const count = await db('triggers').where({ id }).update(updateData);
  if (count === 0) return null;

  return getTrigger(db, id);
};

/**
 * Deletes a trigger.
 */
const deleteTrigger = async (db: Knex, id: string): Promise<boolean> => {
  const count = await db('triggers').where({ id }).delete();
  return count > 0;
};

// ============================================================================
// Trigger Queries
// ============================================================================

/**
 * Lists triggers with optional filtering.
 */
const listTriggers = async (db: Knex, options?: { status?: TriggerStatus; limit?: number }): Promise<Trigger[]> => {
  let query = db<TriggerRow>('triggers');

  if (options?.status) {
    query = query.where({ status: options.status });
  }

  query = query.orderBy('created_at', 'desc');

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const rows = await query;
  return rows.map(rowToTrigger);
};

/**
 * Gets all active triggers.
 */
const getActiveTriggers = async (db: Knex): Promise<Trigger[]> => {
  const rows = await db<TriggerRow>('triggers').where({ status: 'active' }).orderBy('next_invocation_at', 'asc');
  return rows.map(rowToTrigger);
};

/**
 * Counts the number of triggers (for limit checking).
 */
const countTriggers = async (db: Knex): Promise<number> => {
  const result = await db('triggers').count('* as count').first();
  return (result?.count as number) ?? 0;
};

// ============================================================================
// Trigger-Conversation Junction
// ============================================================================

/**
 * Adds a conversation to a trigger's history.
 */
const addTriggerConversation = async (
  db: Knex,
  triggerId: string,
  conversationId: string,
): Promise<TriggerConversation> => {
  const timestamp = now();

  const row: TriggerConversationRow = {
    trigger_id: triggerId,
    conversation_id: conversationId,
    invoked_at: timestamp,
  };

  await db('trigger_conversations').insert(row);
  return rowToTriggerConversation(row);
};

/**
 * Gets all conversation IDs for a trigger.
 */
const getTriggerConversations = async (
  db: Knex,
  triggerId: string,
  options?: { limit?: number },
): Promise<TriggerConversation[]> => {
  let query = db<TriggerConversationRow>('trigger_conversations')
    .where({ trigger_id: triggerId })
    .orderBy('invoked_at', 'desc');

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const rows = await query;
  return rows.map(rowToTriggerConversation);
};

/**
 * Gets the trigger that created a conversation (if any).
 */
const getTriggerByConversation = async (db: Knex, conversationId: string): Promise<Trigger | null> => {
  const junction = await db<TriggerConversationRow>('trigger_conversations')
    .where({ conversation_id: conversationId })
    .first();

  if (!junction) return null;

  return getTrigger(db, junction.trigger_id);
};

// ============================================================================
// Exports
// ============================================================================

export {
  // Conversion helpers
  rowToTrigger,
  rowToTriggerConversation,
  // Trigger CRUD
  createTrigger,
  getTrigger,
  getTriggerByName,
  updateTrigger,
  deleteTrigger,
  // Trigger queries
  listTriggers,
  getActiveTriggers,
  countTriggers,
  // Trigger-Conversation junction
  addTriggerConversation,
  getTriggerConversations,
  getTriggerByConversation,
};
