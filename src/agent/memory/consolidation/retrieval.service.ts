import type { Services } from '../../../core/services/services.ts';
import { LogService } from '../../../core/logging/logging.ts';
import type { Logger } from '../../../core/logging/logging.ts';

import type { MemoryHint, MemoryIndex, OpenLoop } from './consolidation.schemas.ts';
import { OpenLoopService } from './openloop.service.ts';
import { MemoryIndexService } from './index.service.ts';

// ============================================================================
// Types
// ============================================================================

type ExtractedEntity = {
  text: string;
  type: 'person' | 'project' | 'place' | 'organization' | 'topic';
  confidence: number;
};

type ExtractedEntities = {
  entities: ExtractedEntity[];
  topics: string[];
};

type RetrievalResult = {
  hints: MemoryHint[];
  matchedOpenLoops: OpenLoop[];
  extractedEntities: ExtractedEntities;
};

type RetrievalConfig = {
  maxHints: number;
  hintRelevanceThreshold: number;
};

const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  maxHints: 5,
  hintRelevanceThreshold: 0.6,
};

// ============================================================================
// Message Retrieval Service
// ============================================================================

/**
 * Message Retrieval Service - handles per-message memory hint generation.
 *
 * On each user message:
 * 1. Extracts entities/topics from the message
 * 2. Checks open loops for pattern matches
 * 3. Generates memory hints for matched entities
 * 4. Returns hints to inject into context
 *
 * See spec/019-memory-consolidation.md
 */
class MessageRetrievalService {
  #openLoopService: OpenLoopService;
  #memoryIndexService: MemoryIndexService;
  #logger: Logger;
  #config: RetrievalConfig;

  constructor(services: Services, config?: Partial<RetrievalConfig>) {
    this.#config = { ...DEFAULT_RETRIEVAL_CONFIG, ...config };

    this.#openLoopService = services.get(OpenLoopService);
    this.#memoryIndexService = services.get(MemoryIndexService);

    const logService = services.get(LogService);
    this.#logger = logService.child({ source: 'MessageRetrievalService' });
  }

  // ==========================================================================
  // Main Retrieval Method
  // ==========================================================================

  /**
   * Process a user message and retrieve relevant memory hints.
   *
   * @param message - The user's message
   * @returns Retrieval result with hints and matched loops
   */
  retrieveForMessage = async (message: string): Promise<RetrievalResult> => {
    // 1. Get current memory index for known entities
    const memoryIndex = await this.#memoryIndexService.getMemoryIndex();

    // 2. Extract entities/topics from message
    const knownEntityNames = memoryIndex.activeEntities.map((e) => e.name);
    const extractedEntities = this.extractEntitiesFromMessage(message, knownEntityNames);

    // 3. Match open loops
    const matchedOpenLoops = await this.#openLoopService.matchMessage(message);

    // 4. Generate hints
    const hints = await this.generateHints(extractedEntities, matchedOpenLoops, memoryIndex);

    // 5. Record entity mentions in session context
    for (const entity of extractedEntities.entities) {
      this.#memoryIndexService.recordEntityMention(entity.text);
    }

    if (hints.length > 0) {
      this.#logger.debug('Generated memory hints for message', {
        messageLength: message.length,
        hintCount: hints.length,
        matchedLoops: matchedOpenLoops.length,
        extractedEntities: extractedEntities.entities.length,
      });
    }

    return {
      hints,
      matchedOpenLoops,
      extractedEntities,
    };
  };

  // ==========================================================================
  // Entity Extraction
  // ==========================================================================

  /**
   * Extract entities and topics from a user message.
   *
   * Uses a two-phase approach:
   * 1. Pattern matching against known entities
   * 2. Simple topic keyword extraction
   *
   * @param message - The user's message
   * @param knownEntities - List of known entity names from memory index
   * @returns Extracted entities and topics
   */
  extractEntitiesFromMessage = (message: string, knownEntities: string[]): ExtractedEntities => {
    const matched: ExtractedEntity[] = [];

    // Phase 1: Pattern match known entities
    for (const entity of knownEntities) {
      const entityLower = entity.toLowerCase();

      // Check for whole word match (avoid partial matches)
      const regex = new RegExp(`\\b${escapeRegex(entityLower)}\\b`, 'i');
      if (regex.test(message)) {
        matched.push({
          text: entity,
          type: 'topic', // Would be enriched from entity data in future
          confidence: 0.9,
        });
      }
    }

    // Phase 2: Extract topic keywords (nouns and important words)
    const topics = extractTopicKeywords(message);

    return {
      entities: matched,
      topics,
    };
  };

  // ==========================================================================
  // Hint Generation
  // ==========================================================================

  /**
   * Generate memory hints from extracted entities and matched loops.
   *
   * @param entities - Extracted entities from message
   * @param matchedLoops - Open loops that matched the message
   * @param memoryIndex - Current memory index
   * @returns Array of memory hints sorted by relevance
   */
  generateHints = async (
    entities: ExtractedEntities,
    matchedLoops: OpenLoop[],
    memoryIndex: MemoryIndex,
  ): Promise<MemoryHint[]> => {
    const hints: MemoryHint[] = [];

    // Hints from open loops (highest priority)
    const loopHints = this.#openLoopService.generateHints(matchedLoops, 2);
    hints.push(...loopHints);

    // Hints from matched entities
    for (const entity of entities.entities) {
      // Find the entity in the memory index for more context
      const indexEntry = memoryIndex.activeEntities.find((e) => e.name.toLowerCase() === entity.text.toLowerCase());

      if (indexEntry) {
        hints.push({
          memoryId: indexEntry.id,
          type: 'consolidated',
          hint: `${indexEntry.name} (${indexEntry.type}): ${indexEntry.snippet}`,
          relevanceScore: entity.confidence * indexEntry.activationScore,
          entityMatch: entity.text,
        });
      }
    }

    // Sort by relevance and limit
    return hints
      .filter((h) => h.relevanceScore >= this.#config.hintRelevanceThreshold)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, this.#config.maxHints);
  };

  // ==========================================================================
  // Message Injection
  // ==========================================================================

  /**
   * Inject memory hints into a user message.
   *
   * @param message - Original user message
   * @param hints - Memory hints to inject
   * @returns Message with hints appended, or original if no hints
   */
  injectHints = (message: string, hints: MemoryHint[]): string => {
    if (hints.length === 0) {
      return message;
    }

    const hintText = hints.map((h) => `- ${h.hint}`).join('\n');

    return `${message}

<memory-context>
Relevant memories detected:
${hintText}
</memory-context>`;
  };

  // ==========================================================================
  // Configuration
  // ==========================================================================

  /**
   * Get current configuration.
   */
  get config(): RetrievalConfig {
    return { ...this.#config };
  }

  /**
   * Update configuration.
   */
  setConfig = (config: Partial<RetrievalConfig>): void => {
    this.#config = { ...this.#config, ...config };
  };
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Escape special regex characters in a string.
 */
const escapeRegex = (str: string): string => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * Extract topic keywords from a message.
 * Filters out common stop words and short words.
 */
const extractTopicKeywords = (message: string): string[] => {
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
    'and',
    'but',
    'or',
    'nor',
    'so',
    'yet',
    'not',
    'only',
    'just',
    'i',
    'me',
    'my',
    'we',
    'our',
    'you',
    'your',
    'he',
    'him',
    'his',
    'she',
    'her',
    'it',
    'its',
    'they',
    'them',
    'their',
    'what',
    'which',
    'who',
    'this',
    'that',
    'these',
    'those',
    'am',
    'about',
    'if',
    'how',
    'all',
    'some',
    'any',
    'no',
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
    .filter((word) => word.length > 3 && !stopWords.has(word));

  // Remove duplicates
  return [...new Set(words)];
};

// ============================================================================
// Exports
// ============================================================================

export type { ExtractedEntity, ExtractedEntities, RetrievalResult, RetrievalConfig };

export { MessageRetrievalService, DEFAULT_RETRIEVAL_CONFIG, extractTopicKeywords };
