import type { Services } from '../../../core/services/services.ts';
import { DatabaseService } from '../../../core/database/database.ts';
import { LogService } from '../../../core/logging/logging.ts';
import type { Logger } from '../../../core/logging/logging.ts';

import type { OpenLoop, OpenLoopStatus, CreateOpenLoopInput, MemoryHint } from './consolidation.schemas.ts';
import { OpenLoopStore } from './openloop.store.ts';

// ============================================================================
// Open Loop Service
// ============================================================================

/**
 * Open Loop Service - manages unresolved situations that should be surfaced when relevant.
 *
 * Open loops are situations the user mentioned but haven't resolved yet:
 * - "I need to decide on that job offer"
 * - "I'm waiting to hear back from Alice"
 * - "I should follow up on that bug report"
 *
 * The system tracks these and surfaces them when the user mentions related topics.
 *
 * See spec/019-memory-consolidation.md
 */
class OpenLoopService {
  #store: OpenLoopStore;
  #logger: Logger;

  constructor(services: Services) {
    const dbService = services.get(DatabaseService);
    this.#store = new OpenLoopStore(dbService.knex);
    const logService = services.get(LogService);
    this.#logger = logService.child({ source: 'OpenLoopService' });
  }

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  /**
   * Create a new open loop.
   */
  create = async (input: CreateOpenLoopInput): Promise<OpenLoop> => {
    const loop = await this.#store.create(input);

    this.#logger.info('Created open loop', {
      id: loop.id,
      topic: loop.topic,
      patterns: loop.activationPatterns,
    });

    return loop;
  };

  /**
   * Get an open loop by ID.
   */
  get = async (id: string): Promise<OpenLoop | null> => {
    return this.#store.get(id);
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
      staleAfterDays: number;
    }>,
  ): Promise<OpenLoop | null> => {
    const updated = await this.#store.update(id, updates);

    if (updated) {
      this.#logger.debug('Updated open loop', { id, updates });
    }

    return updated;
  };

  /**
   * Delete an open loop.
   */
  delete = async (id: string): Promise<boolean> => {
    const deleted = await this.#store.delete(id);

    if (deleted) {
      this.#logger.info('Deleted open loop', { id });
    }

    return deleted;
  };

  // ==========================================================================
  // Query Operations
  // ==========================================================================

  /**
   * Get all active open loops.
   */
  getActive = async (limit?: number): Promise<OpenLoop[]> => {
    return this.#store.getActive(limit);
  };

  /**
   * Get open loops by status.
   */
  getByStatus = async (status: OpenLoopStatus, limit?: number): Promise<OpenLoop[]> => {
    return this.#store.getByStatus(status, limit);
  };

  /**
   * List all open loops (for admin/debug purposes).
   */
  list = async (options?: { status?: OpenLoopStatus; limit?: number }): Promise<OpenLoop[]> => {
    if (options?.status) {
      return this.#store.getByStatus(options.status, options.limit);
    }
    return this.#store.getActive(options?.limit);
  };

  // ==========================================================================
  // Pattern Matching
  // ==========================================================================

  /**
   * Match open loops against a user message.
   * Returns loops whose activation patterns match keywords in the message.
   */
  matchMessage = async (message: string): Promise<OpenLoop[]> => {
    // Extract keywords from message (simple word extraction)
    const keywords = extractKeywords(message);

    if (keywords.length === 0) {
      return [];
    }

    // Find loops that match any of the keywords
    const matches = await this.#store.findByPatternMatch(keywords);

    // Record trigger for matched loops
    for (const loop of matches) {
      await this.#store.recordTrigger(loop.id);
    }

    if (matches.length > 0) {
      this.#logger.debug('Matched open loops', {
        messageKeywords: keywords,
        matchedLoops: matches.map((l) => l.id),
      });
    }

    return matches;
  };

  /**
   * Generate memory hints from matched open loops.
   */
  generateHints = (matchedLoops: OpenLoop[], maxHints = 3): MemoryHint[] => {
    const now = new Date();

    return matchedLoops.slice(0, maxHints).map((loop) => {
      const daysSince = Math.floor((now.getTime() - new Date(loop.createdAt).getTime()) / (1000 * 60 * 60 * 24));

      return {
        memoryId: loop.id,
        type: 'open_loop' as const,
        hint: `Open: ${loop.topic} (${daysSince} days ago)`,
        relevanceScore: 0.9, // Open loops are high priority
      };
    });
  };

  // ==========================================================================
  // Status Management
  // ==========================================================================

  /**
   * Resolve an open loop.
   */
  resolve = async (id: string, resolution?: string): Promise<OpenLoop | null> => {
    const resolved = await this.#store.resolve(id);

    if (resolved) {
      this.#logger.info('Resolved open loop', { id, resolution });
    }

    return resolved;
  };

  /**
   * Reactivate a resolved or stale open loop.
   */
  reactivate = async (id: string): Promise<OpenLoop | null> => {
    const reactivated = await this.#store.reactivate(id);

    if (reactivated) {
      this.#logger.info('Reactivated open loop', { id });
    }

    return reactivated;
  };

  /**
   * Mark stale open loops.
   * Should be called periodically (e.g., daily).
   */
  markStale = async (): Promise<{ marked: number }> => {
    const marked = await this.#store.markStale();

    if (marked > 0) {
      this.#logger.info('Marked stale open loops', { count: marked });
    }

    return { marked };
  };

  // ==========================================================================
  // Link Management
  // ==========================================================================

  /**
   * Add a memory link to an open loop.
   */
  addMemoryLink = async (loopId: string, memoryId: string): Promise<OpenLoop | null> => {
    const loop = await this.#store.get(loopId);
    if (!loop) {
      return null;
    }

    if (loop.linkedMemoryIds.includes(memoryId)) {
      return loop; // Already linked
    }

    return this.#store.update(loopId, {
      linkedMemoryIds: [...loop.linkedMemoryIds, memoryId],
    });
  };

  /**
   * Add a consolidated memory link to an open loop.
   */
  addConsolidatedLink = async (loopId: string, consolidatedId: string): Promise<OpenLoop | null> => {
    const loop = await this.#store.get(loopId);
    if (!loop) {
      return null;
    }

    if (loop.linkedConsolidatedIds.includes(consolidatedId)) {
      return loop; // Already linked
    }

    return this.#store.update(loopId, {
      linkedConsolidatedIds: [...loop.linkedConsolidatedIds, consolidatedId],
    });
  };

  /**
   * Add an activation pattern to an open loop.
   */
  addPattern = async (loopId: string, pattern: string): Promise<OpenLoop | null> => {
    const loop = await this.#store.get(loopId);
    if (!loop) {
      return null;
    }

    const normalizedPattern = pattern.toLowerCase().trim();
    if (loop.activationPatterns.map((p) => p.toLowerCase()).includes(normalizedPattern)) {
      return loop; // Already has pattern
    }

    return this.#store.update(loopId, {
      activationPatterns: [...loop.activationPatterns, pattern.trim()],
    });
  };
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Extract keywords from a message for pattern matching.
 * Filters out common stop words and short words.
 */
const extractKeywords = (message: string): string[] => {
  const stopWords = new Set([
    'a',
    'an',
    'the',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'could',
    'should',
    'may',
    'might',
    'must',
    'shall',
    'can',
    'need',
    'dare',
    'ought',
    'used',
    'to',
    'of',
    'in',
    'for',
    'on',
    'with',
    'at',
    'by',
    'from',
    'as',
    'into',
    'through',
    'during',
    'before',
    'after',
    'above',
    'below',
    'between',
    'under',
    'again',
    'further',
    'then',
    'once',
    'and',
    'but',
    'or',
    'nor',
    'so',
    'yet',
    'both',
    'either',
    'neither',
    'not',
    'only',
    'own',
    'same',
    'than',
    'too',
    'very',
    'just',
    'i',
    'me',
    'my',
    'myself',
    'we',
    'our',
    'ours',
    'ourselves',
    'you',
    'your',
    'yours',
    'yourself',
    'yourselves',
    'he',
    'him',
    'his',
    'himself',
    'she',
    'her',
    'hers',
    'herself',
    'it',
    'its',
    'itself',
    'they',
    'them',
    'their',
    'theirs',
    'themselves',
    'what',
    'which',
    'who',
    'whom',
    'this',
    'that',
    'these',
    'those',
    'am',
    'about',
    'if',
    'because',
    'until',
    'while',
    'how',
    'all',
    'each',
    'few',
    'more',
    'most',
    'other',
    'some',
    'such',
    'no',
    'any',
    'here',
    'there',
    'when',
    'where',
    'why',
    'now',
  ]);

  // Split on non-word characters, filter stop words and short words
  const words = message
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));

  // Remove duplicates
  return [...new Set(words)];
};

export { OpenLoopService, extractKeywords };
