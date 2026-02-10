import type { Knex } from 'knex';

import type { MemoryActivation, BoostHistoryEntry } from './consolidation.schemas.ts';

// ============================================================================
// Row Types
// ============================================================================

type MemoryActivationRow = {
  memory_id: string;
  activation_score: number;
  decay_rate: number;
  last_decay_at: string;
  boost_history: string; // JSON
  created_at: string;
  updated_at: string;
};

// ============================================================================
// Conversions
// ============================================================================

const rowToActivation = (row: MemoryActivationRow): MemoryActivation => ({
  memoryId: row.memory_id,
  activationScore: row.activation_score,
  decayRate: row.decay_rate,
  lastDecayAt: row.last_decay_at,
  boostHistory: JSON.parse(row.boost_history) as BoostHistoryEntry[],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const activationToRow = (activation: MemoryActivation): MemoryActivationRow => ({
  memory_id: activation.memoryId,
  activation_score: activation.activationScore,
  decay_rate: activation.decayRate,
  last_decay_at: activation.lastDecayAt,
  boost_history: JSON.stringify(activation.boostHistory),
  created_at: activation.createdAt,
  updated_at: activation.updatedAt,
});

// ============================================================================
// Store
// ============================================================================

class ActivationStore {
  #db: Knex;

  constructor(db: Knex) {
    this.#db = db;
  }

  /**
   * Get activation record for a memory.
   */
  get = async (memoryId: string): Promise<MemoryActivation | null> => {
    const row = await this.#db<MemoryActivationRow>('memory_activation').where('memory_id', memoryId).first();

    return row ? rowToActivation(row) : null;
  };

  /**
   * Get activation records for multiple memories.
   */
  getMany = async (memoryIds: string[]): Promise<Map<string, MemoryActivation>> => {
    if (memoryIds.length === 0) {
      return new Map();
    }

    const rows = await this.#db<MemoryActivationRow>('memory_activation').whereIn('memory_id', memoryIds);

    const map = new Map<string, MemoryActivation>();
    for (const row of rows) {
      map.set(row.memory_id, rowToActivation(row));
    }
    return map;
  };

  /**
   * Create activation record for a memory.
   */
  create = async (memoryId: string, initialScore = 0.5, decayRate = 0.02): Promise<MemoryActivation> => {
    const now = new Date().toISOString();
    const activation: MemoryActivation = {
      memoryId,
      activationScore: initialScore,
      decayRate,
      lastDecayAt: now,
      boostHistory: [],
      createdAt: now,
      updatedAt: now,
    };

    await this.#db<MemoryActivationRow>('memory_activation').insert(activationToRow(activation));

    return activation;
  };

  /**
   * Update activation score and history.
   */
  update = async (
    memoryId: string,
    updates: {
      activationScore?: number;
      lastDecayAt?: string;
      boostHistory?: BoostHistoryEntry[];
    },
  ): Promise<MemoryActivation | null> => {
    const existing = await this.get(memoryId);
    if (!existing) {
      return null;
    }

    const now = new Date().toISOString();
    const updateData: Partial<MemoryActivationRow> = {
      updated_at: now,
    };

    if (updates.activationScore !== undefined) {
      updateData.activation_score = updates.activationScore;
    }
    if (updates.lastDecayAt !== undefined) {
      updateData.last_decay_at = updates.lastDecayAt;
    }
    if (updates.boostHistory !== undefined) {
      updateData.boost_history = JSON.stringify(updates.boostHistory);
    }

    await this.#db<MemoryActivationRow>('memory_activation').where('memory_id', memoryId).update(updateData);

    return this.get(memoryId);
  };

  /**
   * Ensure activation record exists for a memory.
   * Creates one if it doesn't exist.
   */
  ensure = async (memoryId: string, initialScore = 0.5, decayRate = 0.02): Promise<MemoryActivation> => {
    const existing = await this.get(memoryId);
    if (existing) {
      return existing;
    }
    return this.create(memoryId, initialScore, decayRate);
  };

  /**
   * Delete activation record.
   */
  delete = async (memoryId: string): Promise<boolean> => {
    const deleted = await this.#db<MemoryActivationRow>('memory_activation').where('memory_id', memoryId).delete();

    return deleted > 0;
  };

  /**
   * Get all activation records with score above threshold.
   */
  getAboveThreshold = async (threshold: number, limit?: number): Promise<MemoryActivation[]> => {
    let query = this.#db<MemoryActivationRow>('memory_activation')
      .where('activation_score', '>', threshold)
      .orderBy('activation_score', 'desc');

    if (limit) {
      query = query.limit(limit);
    }

    const rows = await query;
    return rows.map(rowToActivation);
  };

  /**
   * Get all activation records for batch decay processing.
   */
  getAllForDecay = async (): Promise<MemoryActivation[]> => {
    const rows = await this.#db<MemoryActivationRow>('memory_activation').select('*');
    return rows.map(rowToActivation);
  };

  /**
   * Batch update activation scores (for decay job).
   */
  batchUpdateScores = async (
    updates: { memoryId: string; activationScore: number; lastDecayAt: string }[],
  ): Promise<void> => {
    if (updates.length === 0) {
      return;
    }

    const now = new Date().toISOString();

    // Use transaction for batch update
    await this.#db.transaction(async (trx) => {
      for (const update of updates) {
        await trx<MemoryActivationRow>('memory_activation').where('memory_id', update.memoryId).update({
          activation_score: update.activationScore,
          last_decay_at: update.lastDecayAt,
          updated_at: now,
        });
      }
    });
  };
}

export { ActivationStore };
export type { MemoryActivationRow };
