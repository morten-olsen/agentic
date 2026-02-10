import type { Knex } from 'knex';

import type { OpenLoop, OpenLoopStatus, CreateOpenLoopInput } from './consolidation.schemas.ts';

// ============================================================================
// Row Types
// ============================================================================

type OpenLoopRow = {
  id: string;
  topic: string;
  description: string;
  activation_patterns: string; // JSON
  linked_memory_ids: string; // JSON
  linked_consolidated_ids: string; // JSON
  status: string;
  stale_after_days: number;
  created_at: string;
  last_triggered_at: string | null;
  resolved_at: string | null;
};

// ============================================================================
// Conversions
// ============================================================================

const rowToOpenLoop = (row: OpenLoopRow): OpenLoop => ({
  id: row.id,
  topic: row.topic,
  description: row.description,
  activationPatterns: JSON.parse(row.activation_patterns) as string[],
  linkedMemoryIds: JSON.parse(row.linked_memory_ids) as string[],
  linkedConsolidatedIds: JSON.parse(row.linked_consolidated_ids) as string[],
  status: row.status as OpenLoopStatus,
  staleAfterDays: row.stale_after_days,
  createdAt: row.created_at,
  lastTriggeredAt: row.last_triggered_at ?? undefined,
  resolvedAt: row.resolved_at ?? undefined,
});

const openLoopToRow = (loop: OpenLoop): OpenLoopRow => ({
  id: loop.id,
  topic: loop.topic,
  description: loop.description,
  activation_patterns: JSON.stringify(loop.activationPatterns),
  linked_memory_ids: JSON.stringify(loop.linkedMemoryIds),
  linked_consolidated_ids: JSON.stringify(loop.linkedConsolidatedIds),
  status: loop.status,
  stale_after_days: loop.staleAfterDays,
  created_at: loop.createdAt,
  last_triggered_at: loop.lastTriggeredAt ?? null,
  resolved_at: loop.resolvedAt ?? null,
});

// ============================================================================
// Store
// ============================================================================

class OpenLoopStore {
  #db: Knex;

  constructor(db: Knex) {
    this.#db = db;
  }

  /**
   * Get an open loop by ID.
   */
  get = async (id: string): Promise<OpenLoop | null> => {
    const row = await this.#db<OpenLoopRow>('open_loops').where('id', id).first();
    return row ? rowToOpenLoop(row) : null;
  };

  /**
   * Create a new open loop.
   */
  create = async (input: CreateOpenLoopInput): Promise<OpenLoop> => {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const loop: OpenLoop = {
      id,
      topic: input.topic,
      description: input.description,
      activationPatterns: input.activationPatterns,
      linkedMemoryIds: input.linkedMemoryIds ?? [],
      linkedConsolidatedIds: input.linkedConsolidatedIds ?? [],
      status: 'active',
      staleAfterDays: input.staleAfterDays ?? 30,
      createdAt: now,
      lastTriggeredAt: undefined,
      resolvedAt: undefined,
    };

    await this.#db<OpenLoopRow>('open_loops').insert(openLoopToRow(loop));
    return loop;
  };

  /**
   * Update an open loop.
   */
  update = async (
    id: string,
    updates: Partial<{
      topic: string;
      description: string;
      activationPatterns: string[];
      linkedMemoryIds: string[];
      linkedConsolidatedIds: string[];
      status: OpenLoopStatus;
      staleAfterDays: number;
      lastTriggeredAt: string;
      resolvedAt: string;
    }>,
  ): Promise<OpenLoop | null> => {
    const existing = await this.get(id);
    if (!existing) {
      return null;
    }

    const updateData: Partial<OpenLoopRow> = {};

    if (updates.topic !== undefined) {
      updateData.topic = updates.topic;
    }
    if (updates.description !== undefined) {
      updateData.description = updates.description;
    }
    if (updates.activationPatterns !== undefined) {
      updateData.activation_patterns = JSON.stringify(updates.activationPatterns);
    }
    if (updates.linkedMemoryIds !== undefined) {
      updateData.linked_memory_ids = JSON.stringify(updates.linkedMemoryIds);
    }
    if (updates.linkedConsolidatedIds !== undefined) {
      updateData.linked_consolidated_ids = JSON.stringify(updates.linkedConsolidatedIds);
    }
    if (updates.status !== undefined) {
      updateData.status = updates.status;
    }
    if (updates.staleAfterDays !== undefined) {
      updateData.stale_after_days = updates.staleAfterDays;
    }
    if (updates.lastTriggeredAt !== undefined) {
      updateData.last_triggered_at = updates.lastTriggeredAt;
    }
    if (updates.resolvedAt !== undefined) {
      updateData.resolved_at = updates.resolvedAt;
    }

    if (Object.keys(updateData).length > 0) {
      await this.#db<OpenLoopRow>('open_loops').where('id', id).update(updateData);
    }

    return this.get(id);
  };

  /**
   * Delete an open loop.
   */
  delete = async (id: string): Promise<boolean> => {
    const deleted = await this.#db<OpenLoopRow>('open_loops').where('id', id).delete();
    return deleted > 0;
  };

  /**
   * Get all active open loops.
   */
  getActive = async (limit?: number): Promise<OpenLoop[]> => {
    let query = this.#db<OpenLoopRow>('open_loops').where('status', 'active').orderBy('created_at', 'desc');

    if (limit) {
      query = query.limit(limit);
    }

    const rows = await query;
    return rows.map(rowToOpenLoop);
  };

  /**
   * Get open loops by status.
   */
  getByStatus = async (status: OpenLoopStatus, limit?: number): Promise<OpenLoop[]> => {
    let query = this.#db<OpenLoopRow>('open_loops').where('status', status).orderBy('created_at', 'desc');

    if (limit) {
      query = query.limit(limit);
    }

    const rows = await query;
    return rows.map(rowToOpenLoop);
  };

  /**
   * Find open loops that match any of the given patterns.
   * Used for per-message retrieval.
   */
  findByPatternMatch = async (patterns: string[]): Promise<OpenLoop[]> => {
    if (patterns.length === 0) {
      return [];
    }

    // Get all active loops and filter in memory
    // SQLite doesn't have great JSON array search, so we do this in JS
    const activeLoops = await this.getActive();

    return activeLoops.filter((loop) => {
      const loopPatternsLower = loop.activationPatterns.map((p) => p.toLowerCase());
      return patterns.some((pattern) => loopPatternsLower.some((lp) => lp.includes(pattern.toLowerCase())));
    });
  };

  /**
   * Mark stale open loops.
   * Loops that haven't been triggered within their staleAfterDays are marked stale.
   */
  markStale = async (): Promise<number> => {
    const now = new Date();
    const activeLoops = await this.getActive();
    let marked = 0;

    for (const loop of activeLoops) {
      const createdAt = new Date(loop.createdAt);
      const lastActivity = loop.lastTriggeredAt ? new Date(loop.lastTriggeredAt) : createdAt;
      const daysSinceActivity = (now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24);

      if (daysSinceActivity > loop.staleAfterDays) {
        await this.update(loop.id, { status: 'stale' });
        marked++;
      }
    }

    return marked;
  };

  /**
   * Record a trigger for an open loop.
   */
  recordTrigger = async (id: string): Promise<OpenLoop | null> => {
    return this.update(id, { lastTriggeredAt: new Date().toISOString() });
  };

  /**
   * Resolve an open loop.
   */
  resolve = async (id: string): Promise<OpenLoop | null> => {
    const now = new Date().toISOString();
    return this.update(id, { status: 'resolved', resolvedAt: now });
  };

  /**
   * Reactivate a resolved or stale open loop.
   */
  reactivate = async (id: string): Promise<OpenLoop | null> => {
    return this.update(id, { status: 'active', resolvedAt: undefined });
  };
}

export { OpenLoopStore };
export type { OpenLoopRow };
