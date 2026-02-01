import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import type { MemoryEntry, MemoryRow, CreateMemoryInput, UpdateMemoryInput, RecallOptions } from './memory.schemas.ts';
import { createMemoryInputSchema } from './memory.schemas.ts';

// ============================================================================
// Embedding Serialization
// ============================================================================

/**
 * Serializes an embedding array to a Buffer for storage.
 */
const serializeEmbedding = (embedding: number[]): Buffer => {
  const float32Array = new Float32Array(embedding);
  return Buffer.from(float32Array.buffer);
};

/**
 * Deserializes a Buffer back to an embedding array.
 */
const deserializeEmbedding = (buffer: Buffer): number[] => {
  const float32Array = new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  return Array.from(float32Array);
};

// ============================================================================
// Row Conversion
// ============================================================================

/**
 * Converts a database row to a MemoryEntry.
 */
const rowToMemory = (row: MemoryRow): MemoryEntry => {
  return {
    id: row.id,
    type: row.type as MemoryEntry['type'],
    content: row.content,
    embedding: row.embedding ? deserializeEmbedding(row.embedding) : undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
    importance: row.importance,
    createdAt: row.created_at,
    lastAccessedAt: row.last_accessed_at,
    accessCount: row.access_count,
  };
};

/**
 * Converts a MemoryEntry to a database row.
 */
const memoryToRow = (memory: MemoryEntry): MemoryRow => {
  return {
    id: memory.id,
    type: memory.type,
    content: memory.content,
    embedding: memory.embedding ? serializeEmbedding(memory.embedding) : null,
    metadata: JSON.stringify(memory.metadata),
    importance: memory.importance,
    created_at: memory.createdAt,
    last_accessed_at: memory.lastAccessedAt,
    access_count: memory.accessCount,
  };
};

// ============================================================================
// Store Operations
// ============================================================================

/**
 * Creates a new memory.
 */
const createMemory = async (db: Knex, input: CreateMemoryInput, embedding?: number[]): Promise<MemoryEntry> => {
  const validated = createMemoryInputSchema.parse(input);
  const now = new Date().toISOString();
  const id = uuidv4();

  const memory: MemoryEntry = {
    id,
    type: validated.type,
    content: validated.content,
    embedding,
    metadata: validated.metadata ?? {},
    importance: validated.importance ?? 0.5,
    createdAt: now,
    lastAccessedAt: now,
    accessCount: 0,
  };

  const row = memoryToRow(memory);
  await db('memories').insert(row);

  return memory;
};

/**
 * Gets a memory by ID.
 */
const getMemory = async (db: Knex, id: string): Promise<MemoryEntry | null> => {
  const row = await db('memories').where({ id }).first();
  return row ? rowToMemory(row) : null;
};

/**
 * Updates a memory.
 */
const updateMemory = async (db: Knex, id: string, updates: UpdateMemoryInput): Promise<MemoryEntry | null> => {
  const existing = await getMemory(db, id);
  if (!existing) {
    return null;
  }

  const updateData: Partial<MemoryRow> = {};

  if (updates.content !== undefined) {
    updateData.content = updates.content;
  }
  if (updates.metadata !== undefined) {
    updateData.metadata = JSON.stringify(updates.metadata);
  }
  if (updates.importance !== undefined) {
    updateData.importance = updates.importance;
  }
  if (updates.embedding !== undefined) {
    updateData.embedding = serializeEmbedding(updates.embedding);
  }

  if (Object.keys(updateData).length > 0) {
    await db('memories').where({ id }).update(updateData);
  }

  return getMemory(db, id);
};

/**
 * Deletes a memory by ID.
 */
const deleteMemory = async (db: Knex, id: string): Promise<boolean> => {
  const deleted = await db('memories').where({ id }).delete();
  return deleted > 0;
};

/**
 * Lists memories with optional filtering.
 */
const listMemories = async (db: Knex, options?: RecallOptions): Promise<MemoryEntry[]> => {
  let query = db('memories').orderBy('last_accessed_at', 'desc');

  if (options?.types && options.types.length > 0) {
    query = query.whereIn('type', options.types);
  }

  if (options?.minImportance !== undefined) {
    query = query.where('importance', '>=', options.minImportance);
  }

  if (options?.timeRange) {
    query = query.where('created_at', '>=', options.timeRange.start).where('created_at', '<=', options.timeRange.end);
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const rows = await query;
  return rows.map(rowToMemory);
};

/**
 * Gets all memories with embeddings for semantic search.
 */
const getMemoriesWithEmbeddings = async (db: Knex, options?: RecallOptions): Promise<MemoryEntry[]> => {
  let query = db('memories').whereNotNull('embedding');

  if (options?.types && options.types.length > 0) {
    query = query.whereIn('type', options.types);
  }

  if (options?.minImportance !== undefined) {
    query = query.where('importance', '>=', options.minImportance);
  }

  if (options?.timeRange) {
    query = query.where('created_at', '>=', options.timeRange.start).where('created_at', '<=', options.timeRange.end);
  }

  const rows = await query;
  return rows.map(rowToMemory);
};

/**
 * Updates the access timestamp and count for a memory.
 */
const updateAccess = async (db: Knex, id: string): Promise<void> => {
  const now = new Date().toISOString();
  await db('memories')
    .where({ id })
    .update({
      last_accessed_at: now,
    })
    .increment('access_count', 1);
};

/**
 * Gets recent topics from conversation memories.
 */
const getRecentTopics = async (db: Knex, limit = 5): Promise<string[]> => {
  const rows = await db('memories')
    .whereIn('type', ['conversation', 'fact'])
    .orderBy('last_accessed_at', 'desc')
    .limit(limit)
    .select('content');

  return rows.map((row: { content: string }) => row.content);
};

/**
 * Increases the importance of a memory (reinforcement).
 */
const reinforceMemory = async (db: Knex, id: string, boost = 0.1): Promise<MemoryEntry | null> => {
  const existing = await getMemory(db, id);
  if (!existing) {
    return null;
  }

  const newImportance = Math.min(1.0, existing.importance + boost);
  await updateAccess(db, id);
  await db('memories').where({ id }).update({ importance: newImportance });

  return getMemory(db, id);
};

export {
  serializeEmbedding,
  deserializeEmbedding,
  rowToMemory,
  memoryToRow,
  createMemory,
  getMemory,
  updateMemory,
  deleteMemory,
  listMemories,
  getMemoriesWithEmbeddings,
  updateAccess,
  getRecentTopics,
  reinforceMemory,
};
