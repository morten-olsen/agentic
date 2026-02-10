import type { Knex } from 'knex';

import type { Services } from '../../../core/services/services.ts';
import { DatabaseService } from '../../../core/database/database.ts';

import type {
  MemoryIndex,
  ActiveEntity,
  OpenLoopSummary,
  MemoryLandscape,
  MemoryCategory,
  SessionContext,
  ConsolidationConfig,
} from './consolidation.schemas.ts';
import { consolidationConfigSchema } from './consolidation.schemas.ts';

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONSOLIDATION_CONFIG: ConsolidationConfig = consolidationConfigSchema.parse({});

// ============================================================================
// Memory Index Service
// ============================================================================

/**
 * Memory Index Service - generates a bounded memory index for the agent context.
 *
 * The index includes:
 * - Active entities (high activation, max 15)
 * - Open loops (unresolved situations, max 10)
 * - Memory landscape (categories + stats, not individual items)
 * - Session context (entities mentioned this conversation)
 *
 * See spec/019-memory-consolidation.md
 */
class MemoryIndexService {
  #db: Knex;
  #config: ConsolidationConfig;

  // Session-specific state (not persisted)
  #sessionContext: SessionContext = {
    mentionedEntities: [],
    retrievedMemoryIds: [],
    topicsDiscussed: [],
  };

  constructor(services: Services, config?: Partial<ConsolidationConfig>) {
    const dbService = services.get(DatabaseService);
    this.#db = dbService.knex;
    this.#config = { ...DEFAULT_CONSOLIDATION_CONFIG, ...config };
  }

  /**
   * Get the current configuration.
   */
  get config(): ConsolidationConfig {
    return this.#config;
  }

  /**
   * Build the dynamic memory index.
   * This is bounded to ~500-800 tokens regardless of total data volume.
   */
  getMemoryIndex = async (): Promise<MemoryIndex> => {
    const [activeEntities, openLoops, memoryLandscape] = await Promise.all([
      this.#getActiveEntities(),
      this.#getOpenLoops(),
      this.#getMemoryLandscape(),
    ]);

    return {
      activeEntities,
      openLoops,
      memoryLandscape,
      sessionContext: this.#sessionContext,
    };
  };

  /**
   * Get high-activation entities.
   * Returns top entities ordered by activation score.
   */
  #getActiveEntities = async (): Promise<ActiveEntity[]> => {
    // Get entities from entity knowledge table that have activation records
    // Join with memory_activation on entity ID
    const result = await this.#db.raw(
      `
      SELECT
        si.key as id,
        json_extract(si.value, '$.name') as name,
        SUBSTR(si.namespace, 10) as type,
        json_extract(si.value, '$.description') as description,
        COALESCE(ma.activation_score, 0.3) as activation_score
      FROM store_items si
      LEFT JOIN memory_activation ma ON ma.memory_id = si.key
      WHERE si.namespace LIKE 'entities.%'
        AND COALESCE(ma.activation_score, 0.3) >= ?
      ORDER BY COALESCE(ma.activation_score, 0.3) DESC
      LIMIT ?
      `,
      [this.#config.indexActivationThreshold, this.#config.maxActiveEntities],
    );

    // better-sqlite3 returns rows directly, not in a nested object
    const rows = Array.isArray(result) ? result : [];

    return rows.map((row: EntityRow) => ({
      id: row.id,
      name: row.name ?? 'Unknown',
      type: row.type ?? 'other',
      snippet: row.description ? row.description.slice(0, 100) : '',
      activationScore: row.activation_score,
    }));
  };

  /**
   * Get active open loops.
   */
  #getOpenLoops = async (): Promise<OpenLoopSummary[]> => {
    const rows = await this.#db<OpenLoopRow>('open_loops')
      .where('status', 'active')
      .orderBy('created_at', 'desc')
      .limit(this.#config.maxOpenLoops);

    const now = new Date();
    return rows.map((row) => ({
      id: row.id,
      topic: row.topic,
      daysSinceCreated: Math.floor((now.getTime() - new Date(row.created_at).getTime()) / (1000 * 60 * 60 * 24)),
    }));
  };

  /**
   * Get memory landscape - category overview with counts.
   */
  #getMemoryLandscape = async (): Promise<MemoryLandscape> => {
    // Count total memories by type
    const memoryResult = await this.#db.raw(
      `
      SELECT
        namespace,
        COUNT(*) as count,
        MAX(updated_at) as last_activity
      FROM store_items
      WHERE namespace LIKE 'memories.%'
      GROUP BY namespace
      `,
    );

    // better-sqlite3 returns rows directly
    const memoryCounts: { namespace: string; count: number; last_activity: string }[] = Array.isArray(memoryResult)
      ? memoryResult
      : [];

    // Count consolidated memories
    type CountResult = { 'count(*)': number };
    const consolidatedResult = await this.#db('consolidated_memories').count('*').first();
    const consolidatedCount = (consolidatedResult as CountResult | undefined)?.['count(*)'] ?? 0;

    // Build categories with relative time
    const now = new Date();
    const categories: MemoryCategory[] = memoryCounts.map((row) => {
      const typeName = row.namespace.replace('memories.', '');
      const lastActivity = new Date(row.last_activity);
      const daysSince = Math.floor((now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24));

      return {
        name: typeName,
        count: row.count,
        lastActivity: formatRelativeTime(daysSince),
      };
    });

    // Sort by count descending
    categories.sort((a, b) => b.count - a.count);

    return {
      totalMemories: memoryCounts.reduce((sum, row) => sum + row.count, 0),
      totalConsolidated: Number(consolidatedCount),
      categories,
    };
  };

  // ============================================================================
  // Session Context Management
  // ============================================================================

  /**
   * Record an entity mention in the current session.
   */
  recordEntityMention = (entityName: string): void => {
    if (!this.#sessionContext.mentionedEntities.includes(entityName)) {
      this.#sessionContext.mentionedEntities.push(entityName);

      // Keep bounded
      if (this.#sessionContext.mentionedEntities.length > this.#config.maxSessionEntities) {
        this.#sessionContext.mentionedEntities.shift();
      }
    }
  };

  /**
   * Record a memory retrieval in the current session.
   */
  recordMemoryRetrieval = (memoryId: string): void => {
    if (!this.#sessionContext.retrievedMemoryIds.includes(memoryId)) {
      this.#sessionContext.retrievedMemoryIds.push(memoryId);

      // Keep bounded
      if (this.#sessionContext.retrievedMemoryIds.length > 50) {
        this.#sessionContext.retrievedMemoryIds.shift();
      }
    }
  };

  /**
   * Record a topic discussed in the current session.
   */
  recordTopicDiscussed = (topic: string): void => {
    if (!this.#sessionContext.topicsDiscussed.includes(topic)) {
      this.#sessionContext.topicsDiscussed.push(topic);

      // Keep bounded
      if (this.#sessionContext.topicsDiscussed.length > 20) {
        this.#sessionContext.topicsDiscussed.shift();
      }
    }
  };

  /**
   * Reset session context (for new conversation).
   */
  resetSessionContext = (): void => {
    this.#sessionContext = {
      mentionedEntities: [],
      retrievedMemoryIds: [],
      topicsDiscussed: [],
    };
  };

  /**
   * Get the current session context.
   */
  getSessionContext = (): SessionContext => {
    return { ...this.#sessionContext };
  };
}

// ============================================================================
// Helper Types
// ============================================================================

type EntityRow = {
  id: string;
  name: string | null;
  type: string | null;
  description: string | null;
  activation_score: number;
};

type OpenLoopRow = {
  id: string;
  topic: string;
  description: string;
  activation_patterns: string;
  linked_memory_ids: string;
  linked_consolidated_ids: string;
  status: string;
  stale_after_days: number;
  created_at: string;
  last_triggered_at: string | null;
  resolved_at: string | null;
};

// ============================================================================
// Utilities
// ============================================================================

/**
 * Format days since into a human-readable relative time.
 */
const formatRelativeTime = (daysSince: number): string => {
  if (daysSince === 0) return 'today';
  if (daysSince === 1) return 'yesterday';
  if (daysSince < 7) return `${daysSince} days ago`;
  if (daysSince < 14) return '1 week ago';
  if (daysSince < 30) return `${Math.floor(daysSince / 7)} weeks ago`;
  if (daysSince < 60) return '1 month ago';
  if (daysSince < 365) return `${Math.floor(daysSince / 30)} months ago`;
  return `${Math.floor(daysSince / 365)} year${Math.floor(daysSince / 365) > 1 ? 's' : ''} ago`;
};

export { MemoryIndexService, DEFAULT_CONSOLIDATION_CONFIG, formatRelativeTime };
