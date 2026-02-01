import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import type { Interrupt, InterruptResponse, CreateInterruptInput, InterruptRow } from './interrupts.schemas.ts';
import { createInterruptInputSchema } from './interrupts.schemas.ts';

/**
 * Converts a database row to an Interrupt object.
 */
const rowToInterrupt = (row: InterruptRow): Interrupt => {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    type: row.type as Interrupt['type'],
    prompt: row.prompt,
    context: row.context ?? undefined,
    options: row.options ? JSON.parse(row.options) : undefined,
    allowFreeform: row.allow_freeform === 1,
    toolCall: row.tool_call ? JSON.parse(row.tool_call) : undefined,
    status: row.status as Interrupt['status'],
    checkpointId: row.checkpoint_id ?? undefined,
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? undefined,
    respondedAt: row.responded_at ?? undefined,
    response: row.response ? JSON.parse(row.response) : undefined,
  };
};

/**
 * Creates a new interrupt.
 */
const createInterrupt = async (db: Knex, input: CreateInterruptInput): Promise<Interrupt> => {
  const validated = createInterruptInputSchema.parse(input);
  const now = new Date().toISOString();
  const id = uuidv4();

  const row: InterruptRow = {
    id,
    conversation_id: validated.conversationId,
    type: validated.type,
    prompt: validated.prompt,
    context: validated.context ?? null,
    options: validated.options ? JSON.stringify(validated.options) : null,
    allow_freeform: validated.allowFreeform ? 1 : 0,
    tool_call: validated.toolCall ? JSON.stringify(validated.toolCall) : null,
    status: 'pending',
    checkpoint_id: validated.checkpointId ?? null,
    created_at: now,
    expires_at: validated.expiresAt ?? null,
    responded_at: null,
    response: null,
  };

  await db('interrupts').insert(row);

  return rowToInterrupt(row);
};

/**
 * Gets an interrupt by ID.
 */
const getInterrupt = async (db: Knex, id: string): Promise<Interrupt | null> => {
  const row = await db('interrupts').where({ id }).first();
  return row ? rowToInterrupt(row) : null;
};

/**
 * Gets the pending interrupt for a conversation.
 * Returns null if no pending interrupt exists.
 */
const getPendingInterrupt = async (db: Knex, conversationId: string): Promise<Interrupt | null> => {
  const row = await db('interrupts')
    .where({ conversation_id: conversationId, status: 'pending' })
    .orderBy('created_at', 'desc')
    .first();
  return row ? rowToInterrupt(row) : null;
};

/**
 * Records a response to an interrupt.
 */
const respondToInterrupt = async (db: Knex, id: string, response: InterruptResponse): Promise<Interrupt> => {
  const now = new Date().toISOString();

  // Determine new status based on response
  let status: Interrupt['status'];
  if (response.approved === true) {
    status = 'approved';
  } else if (response.approved === false) {
    status = 'denied';
  } else {
    // For questions/confirmations, treat any response as approved
    status = 'approved';
  }

  await db('interrupts')
    .where({ id })
    .update({
      status,
      responded_at: now,
      response: JSON.stringify(response),
    });

  const updated = await getInterrupt(db, id);
  if (!updated) {
    throw new Error(`Interrupt ${id} not found after update`);
  }

  return updated;
};

/**
 * Expires an interrupt.
 */
const expireInterrupt = async (db: Knex, id: string): Promise<void> => {
  const now = new Date().toISOString();

  await db('interrupts').where({ id }).update({
    status: 'expired',
    responded_at: now,
  });
};

/**
 * Gets all expired interrupts (pending and past expiration).
 */
const getExpiredInterrupts = async (db: Knex): Promise<Interrupt[]> => {
  const now = new Date().toISOString();

  const rows = await db('interrupts')
    .where({ status: 'pending' })
    .whereNotNull('expires_at')
    .where('expires_at', '<', now);

  return rows.map(rowToInterrupt);
};

/**
 * Deletes an interrupt by ID.
 */
const deleteInterrupt = async (db: Knex, id: string): Promise<boolean> => {
  const deleted = await db('interrupts').where({ id }).delete();
  return deleted > 0;
};

/**
 * Lists interrupts for a conversation.
 */
const listInterrupts = async (
  db: Knex,
  conversationId: string,
  options?: { status?: Interrupt['status']; limit?: number },
): Promise<Interrupt[]> => {
  let query = db('interrupts').where({ conversation_id: conversationId }).orderBy('created_at', 'desc');

  if (options?.status) {
    query = query.where({ status: options.status });
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const rows = await query;
  return rows.map(rowToInterrupt);
};

export {
  createInterrupt,
  getInterrupt,
  getPendingInterrupt,
  respondToInterrupt,
  expireInterrupt,
  getExpiredInterrupts,
  deleteInterrupt,
  listInterrupts,
  rowToInterrupt,
};
