import { randomUUID } from 'crypto';

import type { Knex } from 'knex';

import type { Artifact, ArtifactMeta, ArtifactRow, CreateArtifactInput } from './artifacts.schemas.ts';
import { artifactRowSchema, createArtifactInputSchema, rowToArtifact, rowToArtifactMeta } from './artifacts.schemas.ts';

/**
 * Generates a prefixed artifact ID.
 */
const generateArtifactId = (): string => `art_${randomUUID()}`;

/**
 * Creates an artifact in the database.
 */
const createArtifact = async (db: Knex, input: CreateArtifactInput): Promise<Artifact> => {
  const parsed = createArtifactInputSchema.parse(input);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + parsed.ttlMinutes * 60 * 1000);

  // Serialize data
  const serialized = parsed.mimeType === 'application/json' ? JSON.stringify(parsed.data) : (parsed.data as string);

  const sizeBytes = Buffer.byteLength(serialized, 'utf8');
  const id = generateArtifactId();

  const row: ArtifactRow = {
    id,
    conversation_id: parsed.conversationId,
    message_id: parsed.messageId,
    type: parsed.type,
    mime_type: parsed.mimeType,
    data: serialized,
    size_bytes: sizeBytes,
    summary_provided: parsed.summaryProvided ? 1 : 0,
    ttl_minutes: parsed.ttlMinutes,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    accessed_at: now.toISOString(),
  };

  await db('artifacts').insert(row);
  return rowToArtifact(row);
};

/**
 * Gets an artifact by ID.
 */
const getArtifact = async (db: Knex, id: string): Promise<Artifact | null> => {
  const row = await db('artifacts').where({ id }).first();
  if (!row) return null;
  return rowToArtifact(artifactRowSchema.parse(row));
};

/**
 * Gets artifact metadata (without data) by ID.
 */
const getArtifactMeta = async (db: Knex, id: string): Promise<ArtifactMeta | null> => {
  const row = await db('artifacts')
    .select(
      'id',
      'conversation_id',
      'message_id',
      'type',
      'mime_type',
      'size_bytes',
      'summary_provided',
      'ttl_minutes',
      'created_at',
      'expires_at',
      'accessed_at',
    )
    .where({ id })
    .first();
  if (!row) return null;
  return rowToArtifactMeta(artifactRowSchema.parse({ ...row, data: null }));
};

/**
 * Deletes an artifact by ID.
 */
const deleteArtifact = async (db: Knex, id: string): Promise<boolean> => {
  const deleted = await db('artifacts').where({ id }).delete();
  return deleted > 0;
};

/**
 * Gets all artifacts for a conversation.
 */
const getArtifactsByConversation = async (db: Knex, conversationId: string): Promise<Artifact[]> => {
  const rows = await db('artifacts').where({ conversation_id: conversationId }).orderBy('created_at', 'desc');
  return rows.map((row) => rowToArtifact(artifactRowSchema.parse(row)));
};

/**
 * Gets artifact metadata (without data) for a conversation.
 */
const getArtifactMetaByConversation = async (db: Knex, conversationId: string): Promise<ArtifactMeta[]> => {
  const rows = await db('artifacts')
    .select(
      'id',
      'conversation_id',
      'message_id',
      'type',
      'mime_type',
      'size_bytes',
      'summary_provided',
      'ttl_minutes',
      'created_at',
      'expires_at',
      'accessed_at',
    )
    .where({ conversation_id: conversationId })
    .orderBy('created_at', 'desc');
  return rows.map((row) => rowToArtifactMeta(artifactRowSchema.parse({ ...row, data: null })));
};

/**
 * Gets all artifacts for a message.
 */
const getArtifactsByMessage = async (db: Knex, messageId: string): Promise<Artifact[]> => {
  const rows = await db('artifacts').where({ message_id: messageId }).orderBy('created_at', 'desc');
  return rows.map((row) => rowToArtifact(artifactRowSchema.parse(row)));
};

/**
 * Gets artifacts by type, optionally filtered by conversation.
 */
const getArtifactsByType = async (db: Knex, type: string, conversationId?: string): Promise<Artifact[]> => {
  let query = db('artifacts').where({ type });
  if (conversationId) {
    query = query.andWhere({ conversation_id: conversationId });
  }
  const rows = await query.orderBy('created_at', 'desc');
  return rows.map((row) => rowToArtifact(artifactRowSchema.parse(row)));
};

/**
 * Deletes expired artifacts.
 */
const deleteExpiredArtifacts = async (db: Knex): Promise<number> => {
  const now = new Date().toISOString();
  const deleted = await db('artifacts').where('expires_at', '<', now).delete();
  return deleted;
};

/**
 * Deletes all artifacts for a conversation.
 */
const deleteArtifactsByConversation = async (db: Knex, conversationId: string): Promise<number> => {
  const deleted = await db('artifacts').where({ conversation_id: conversationId }).delete();
  return deleted;
};

/**
 * Updates the accessed_at timestamp for an artifact.
 */
const touchArtifact = async (db: Knex, id: string): Promise<boolean> => {
  const now = new Date().toISOString();
  const updated = await db('artifacts').where({ id }).update({ accessed_at: now });
  return updated > 0;
};

/**
 * Counts artifacts for a conversation.
 */
const countArtifactsByConversation = async (db: Knex, conversationId: string): Promise<number> => {
  const result = await db('artifacts').where({ conversation_id: conversationId }).count('* as count').first();
  return (result?.count as number) ?? 0;
};

/**
 * Gets total size of artifacts for a conversation.
 */
const getTotalArtifactSize = async (db: Knex, conversationId: string): Promise<number> => {
  const result = await db('artifacts').where({ conversation_id: conversationId }).sum('size_bytes as total').first();
  return (result?.total as number) ?? 0;
};

export {
  generateArtifactId,
  createArtifact,
  getArtifact,
  getArtifactMeta,
  deleteArtifact,
  getArtifactsByConversation,
  getArtifactMetaByConversation,
  getArtifactsByMessage,
  getArtifactsByType,
  deleteExpiredArtifacts,
  deleteArtifactsByConversation,
  touchArtifact,
  countArtifactsByConversation,
  getTotalArtifactSize,
};
