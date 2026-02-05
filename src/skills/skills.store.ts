import { randomUUID } from 'crypto';

import type { Knex } from 'knex';

import type { SkillActivationRow, CreateSkillActivationInput } from './skills.schemas.ts';
import { skillActivationRowSchema } from './skills.schemas.ts';
import { SkillActivationNotFoundError } from './skills.errors.ts';

/**
 * Creates a skill activation record.
 */
const createSkillActivation = async (db: Knex, input: CreateSkillActivationInput): Promise<SkillActivationRow> => {
  const now = new Date().toISOString();
  const id = randomUUID();

  const row: SkillActivationRow = {
    id,
    conversation_id: input.conversationId,
    skill_id: input.skillId,
    activated_at: now,
    deactivated_at: null,
    activation_params: input.activationParams ? JSON.stringify(input.activationParams) : null,
    activation_risk: input.activationRisk,
    required_approval: input.requiredApproval ? 1 : 0,
    approved_at: input.approvedAt ?? null,
    created_at: now,
  };

  await db('skill_activations').insert(row);
  return row;
};

/**
 * Gets a skill activation by ID.
 */
const getSkillActivation = async (db: Knex, id: string): Promise<SkillActivationRow | null> => {
  const row = await db('skill_activations').where({ id }).first();
  if (!row) return null;
  return skillActivationRowSchema.parse(row);
};

/**
 * Gets skill activations for a conversation.
 */
const getSkillActivationsForConversation = async (db: Knex, conversationId: string): Promise<SkillActivationRow[]> => {
  const rows = await db('skill_activations').where({ conversation_id: conversationId }).orderBy('activated_at', 'desc');
  return rows.map((row) => skillActivationRowSchema.parse(row));
};

/**
 * Gets active skill activations for a conversation (not deactivated).
 */
const getActiveSkillActivations = async (db: Knex, conversationId: string): Promise<SkillActivationRow[]> => {
  const rows = await db('skill_activations')
    .where({ conversation_id: conversationId })
    .whereNull('deactivated_at')
    .orderBy('activated_at', 'desc');
  return rows.map((row) => skillActivationRowSchema.parse(row));
};

/**
 * Marks a skill as deactivated.
 */
const deactivateSkillActivation = async (db: Knex, id: string): Promise<SkillActivationRow> => {
  const now = new Date().toISOString();
  const updated = await db('skill_activations').where({ id }).update({ deactivated_at: now });

  if (updated === 0) {
    throw new SkillActivationNotFoundError(id);
  }

  const row = await getSkillActivation(db, id);
  if (!row) {
    throw new SkillActivationNotFoundError(id);
  }
  return row;
};

/**
 * Deactivates a skill by skill ID and conversation ID.
 */
const deactivateSkillBySkillId = async (
  db: Knex,
  conversationId: string,
  skillId: string,
): Promise<SkillActivationRow | null> => {
  const now = new Date().toISOString();

  // Find the active activation
  const row = await db('skill_activations')
    .where({ conversation_id: conversationId, skill_id: skillId })
    .whereNull('deactivated_at')
    .first();

  if (!row) return null;

  // Mark as deactivated
  await db('skill_activations').where({ id: row.id }).update({ deactivated_at: now });

  return skillActivationRowSchema.parse({ ...row, deactivated_at: now });
};

/**
 * Lists skill activations with optional filters.
 */
const listSkillActivations = async (
  db: Knex,
  options?: {
    skillId?: string;
    conversationId?: string;
    limit?: number;
    offset?: number;
  },
): Promise<SkillActivationRow[]> => {
  let query = db('skill_activations').orderBy('created_at', 'desc');

  if (options?.skillId) {
    query = query.where({ skill_id: options.skillId });
  }
  if (options?.conversationId) {
    query = query.where({ conversation_id: options.conversationId });
  }
  if (options?.limit) {
    query = query.limit(options.limit);
  }
  if (options?.offset) {
    query = query.offset(options.offset);
  }

  const rows = await query;
  return rows.map((row) => skillActivationRowSchema.parse(row));
};

export {
  createSkillActivation,
  getSkillActivation,
  getSkillActivationsForConversation,
  getActiveSkillActivations,
  deactivateSkillActivation,
  deactivateSkillBySkillId,
  listSkillActivations,
};
