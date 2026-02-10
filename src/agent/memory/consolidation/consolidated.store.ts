import { randomUUID } from 'crypto';

import type { Knex } from 'knex';

import type {
  ConsolidatedMemory,
  ConsolidatedMemoryType,
  ConsolidatedContent,
  IndexStatus,
} from './consolidation.schemas.ts';

// ============================================================================
// Types
// ============================================================================

type CreateConsolidatedInput = {
  type: ConsolidatedMemoryType;
  content: ConsolidatedContent;
  timespanStart: string;
  timespanEnd: string;
  sourceMemoryIds: string[];
  embedding?: number[];
  entityIds?: string[];
  topics?: string[];
  supersedesId?: string;
};

type UpdateConsolidatedInput = Partial<{
  content: ConsolidatedContent;
  timespanEnd: string;
  sourceMemoryIds: string[];
  embedding: number[];
  entityIds: string[];
  topics: string[];
  activationScore: number;
}>;

type ConsolidatedRow = {
  id: string;
  type: string;
  content: string;
  timespan_start: string;
  timespan_end: string;
  consolidated_at: string;
  source_memory_ids: string;
  source_memory_count: number;
  version: number;
  supersedes_id: string | null;
  embedding: Buffer | null;
  activation_score: number;
  last_accessed_at: string;
  entity_ids: string;
  topics: string;
  created_at: string;
  updated_at: string;
};

// ============================================================================
// Consolidated Memory Store
// ============================================================================

/**
 * Store for consolidated memories.
 * Handles CRUD operations and queries for distilled knowledge.
 */
class ConsolidatedMemoryStore {
  #db: Knex;

  constructor(db: Knex) {
    this.#db = db;
  }

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  /**
   * Get a consolidated memory by ID.
   */
  get = async (id: string): Promise<ConsolidatedMemory | null> => {
    const row = await this.#db<ConsolidatedRow>('consolidated_memories').where('id', id).first();

    if (!row) {
      return null;
    }

    return this.#rowToMemory(row);
  };

  /**
   * Create a new consolidated memory.
   */
  create = async (input: CreateConsolidatedInput): Promise<ConsolidatedMemory> => {
    const now = new Date().toISOString();
    const id = randomUUID();

    const row: ConsolidatedRow = {
      id,
      type: input.type,
      content: JSON.stringify(input.content),
      timespan_start: input.timespanStart,
      timespan_end: input.timespanEnd,
      consolidated_at: now,
      source_memory_ids: JSON.stringify(input.sourceMemoryIds),
      source_memory_count: input.sourceMemoryIds.length,
      version: 1,
      supersedes_id: input.supersedesId ?? null,
      embedding: input.embedding ? Buffer.from(new Float32Array(input.embedding).buffer) : null,
      activation_score: 0.5,
      last_accessed_at: now,
      entity_ids: JSON.stringify(input.entityIds ?? []),
      topics: JSON.stringify(input.topics ?? []),
      created_at: now,
      updated_at: now,
    };

    await this.#db('consolidated_memories').insert(row);

    return this.#rowToMemory(row);
  };

  /**
   * Update a consolidated memory.
   * Increments the version number.
   */
  update = async (id: string, updates: UpdateConsolidatedInput): Promise<ConsolidatedMemory | null> => {
    const existing = await this.get(id);
    if (!existing) {
      return null;
    }

    const now = new Date().toISOString();
    const updateFields: Partial<ConsolidatedRow> = {
      updated_at: now,
      version: existing.version + 1,
      consolidated_at: now,
    };

    if (updates.content !== undefined) {
      updateFields.content = JSON.stringify(updates.content);
    }
    if (updates.timespanEnd !== undefined) {
      updateFields.timespan_end = updates.timespanEnd;
    }
    if (updates.sourceMemoryIds !== undefined) {
      updateFields.source_memory_ids = JSON.stringify(updates.sourceMemoryIds);
      updateFields.source_memory_count = updates.sourceMemoryIds.length;
    }
    if (updates.embedding !== undefined) {
      updateFields.embedding = Buffer.from(new Float32Array(updates.embedding).buffer);
    }
    if (updates.entityIds !== undefined) {
      updateFields.entity_ids = JSON.stringify(updates.entityIds);
    }
    if (updates.topics !== undefined) {
      updateFields.topics = JSON.stringify(updates.topics);
    }
    if (updates.activationScore !== undefined) {
      updateFields.activation_score = updates.activationScore;
    }

    await this.#db('consolidated_memories').where('id', id).update(updateFields);

    return this.get(id);
  };

  /**
   * Delete a consolidated memory.
   */
  delete = async (id: string): Promise<boolean> => {
    const deleted = await this.#db('consolidated_memories').where('id', id).delete();
    return deleted > 0;
  };

  // ==========================================================================
  // Query Operations
  // ==========================================================================

  /**
   * Get consolidated memories by type.
   */
  getByType = async (type: ConsolidatedMemoryType, limit?: number): Promise<ConsolidatedMemory[]> => {
    let query = this.#db<ConsolidatedRow>('consolidated_memories')
      .where('type', type)
      .orderBy('activation_score', 'desc');

    if (limit) {
      query = query.limit(limit);
    }

    const rows = await query;
    return rows.map((row) => this.#rowToMemory(row));
  };

  /**
   * Get consolidated memories by entity ID.
   */
  getByEntityId = async (entityId: string, limit?: number): Promise<ConsolidatedMemory[]> => {
    // SQLite JSON contains check
    let query = this.#db<ConsolidatedRow>('consolidated_memories')
      .whereRaw("json_extract(entity_ids, '$') LIKE ?", [`%"${entityId}"%`])
      .orderBy('activation_score', 'desc');

    if (limit) {
      query = query.limit(limit);
    }

    const rows = await query;
    return rows.map((row) => this.#rowToMemory(row));
  };

  /**
   * Get high-activation consolidated memories.
   */
  getHighActivation = async (minScore: number, limit?: number): Promise<ConsolidatedMemory[]> => {
    let query = this.#db<ConsolidatedRow>('consolidated_memories')
      .where('activation_score', '>=', minScore)
      .orderBy('activation_score', 'desc');

    if (limit) {
      query = query.limit(limit);
    }

    const rows = await query;
    return rows.map((row) => this.#rowToMemory(row));
  };

  /**
   * Get consolidated memories that supersede a given ID.
   */
  getSuperseding = async (supersedesId: string): Promise<ConsolidatedMemory | null> => {
    const row = await this.#db<ConsolidatedRow>('consolidated_memories').where('supersedes_id', supersedesId).first();

    return row ? this.#rowToMemory(row) : null;
  };

  /**
   * Get total count of consolidated memories.
   */
  getCount = async (): Promise<number> => {
    const result = await this.#db('consolidated_memories').count('* as count').first();
    return Number(result?.count ?? 0);
  };

  /**
   * Get count by type.
   */
  getCountByType = async (): Promise<Record<string, number>> => {
    const rows = await this.#db('consolidated_memories').select('type').count('* as count').groupBy('type');

    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.type as string] = Number(row.count);
    }
    return counts;
  };

  // ==========================================================================
  // Activation Operations
  // ==========================================================================

  /**
   * Record access to a consolidated memory (boosts activation).
   */
  recordAccess = async (id: string): Promise<ConsolidatedMemory | null> => {
    const now = new Date().toISOString();

    await this.#db('consolidated_memories')
      .where('id', id)
      .update({
        last_accessed_at: now,
        activation_score: this.#db.raw('MIN(1.0, activation_score + 0.1)'),
        updated_at: now,
      });

    return this.get(id);
  };

  /**
   * Apply decay to all consolidated memories.
   */
  applyDecay = async (decayRate: number): Promise<number> => {
    const now = new Date().toISOString();

    const updated = await this.#db('consolidated_memories')
      .where('activation_score', '>', 0.1)
      .update({
        activation_score: this.#db.raw('activation_score * ?', [1 - decayRate]),
        updated_at: now,
      });

    return updated;
  };

  // ==========================================================================
  // Source Memory Operations
  // ==========================================================================

  /**
   * Mark source memories as consolidated.
   */
  markMemoriesConsolidated = async (
    memoryIds: string[],
    consolidatedId: string,
    status: IndexStatus = 'archived',
  ): Promise<number> => {
    if (memoryIds.length === 0) {
      return 0;
    }

    const updated = await this.#db('memories').whereIn('id', memoryIds).update({
      consolidated_into_id: consolidatedId,
      index_status: status,
    });

    return updated;
  };

  /**
   * Get source memories for a consolidated memory.
   */
  getSourceMemories = async (consolidatedId: string): Promise<string[]> => {
    const consolidated = await this.get(consolidatedId);
    return consolidated?.sourceMemoryIds ?? [];
  };

  // ==========================================================================
  // Helpers
  // ==========================================================================

  #rowToMemory = (row: ConsolidatedRow): ConsolidatedMemory => {
    return {
      id: row.id,
      type: row.type as ConsolidatedMemoryType,
      content: JSON.parse(row.content) as ConsolidatedContent,
      timespan: {
        start: row.timespan_start,
        end: row.timespan_end,
        consolidatedAt: row.consolidated_at,
      },
      sourceMemoryIds: JSON.parse(row.source_memory_ids) as string[],
      sourceMemoryCount: row.source_memory_count,
      version: row.version,
      supersedesId: row.supersedes_id ?? undefined,
      embedding: row.embedding ? Array.from(new Float32Array(row.embedding.buffer)) : undefined,
      activationScore: row.activation_score,
      lastAccessedAt: row.last_accessed_at,
      entityIds: JSON.parse(row.entity_ids) as string[],
      topics: JSON.parse(row.topics) as string[],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  };
}

// ============================================================================
// Exports
// ============================================================================

export type { CreateConsolidatedInput, UpdateConsolidatedInput };

export { ConsolidatedMemoryStore };
