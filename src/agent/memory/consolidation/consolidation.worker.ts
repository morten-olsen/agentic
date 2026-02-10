import type { Services } from '../../../core/services/services.ts';
import { LogService } from '../../../core/logging/logging.ts';
import type { Logger } from '../../../core/logging/logging.ts';

import type { ConsolidatedMemory, ConsolidationRun } from './consolidation.schemas.ts';
import {
  ConsolidationService,
  type MemoryForConsolidation,
  type MemoryGroup,
  type ExtractedKnowledge,
} from './consolidation.service.ts';

// ============================================================================
// Types
// ============================================================================

type ConsolidationWorkerConfig = {
  // Thresholds
  minMemoriesForConsolidation: number;
  maxMemoriesPerBatch: number;
  oldMemoryDays: number;

  // Strategies to use
  enableEntityConsolidation: boolean;
  enableTopicConsolidation: boolean;
  enableTemporalConsolidation: boolean;

  // Processing limits
  maxGroupsPerRun: number;
  maxErrorsBeforeAbort: number;
};

const DEFAULT_WORKER_CONFIG: ConsolidationWorkerConfig = {
  minMemoriesForConsolidation: 3,
  maxMemoriesPerBatch: 100,
  oldMemoryDays: 30,
  enableEntityConsolidation: true,
  enableTopicConsolidation: true,
  enableTemporalConsolidation: true,
  maxGroupsPerRun: 20,
  maxErrorsBeforeAbort: 5,
};

type ConsolidationResult = {
  run: ConsolidationRun;
  created: ConsolidatedMemory[];
  updated: ConsolidatedMemory[];
  errors: string[];
};

type KnowledgeExtractor = (groupKey: string, memories: MemoryForConsolidation[]) => Promise<ExtractedKnowledge | null>;

type EmbeddingGenerator = (text: string) => Promise<number[]>;

// ============================================================================
// Consolidation Worker
// ============================================================================

/**
 * Consolidation Worker - orchestrates the full consolidation process.
 *
 * The worker:
 * 1. Finds memories needing consolidation
 * 2. Groups them by strategy (entity, topic, temporal)
 * 3. Extracts knowledge using LLM
 * 4. Creates or updates consolidated memories
 * 5. Marks source memories as consolidated
 *
 * See spec/019-memory-consolidation.md
 */
class ConsolidationWorker {
  #consolidationService: ConsolidationService;
  #logger: Logger;
  #config: ConsolidationWorkerConfig;
  #knowledgeExtractor?: KnowledgeExtractor;
  #embeddingGenerator?: EmbeddingGenerator;

  constructor(services: Services, config?: Partial<ConsolidationWorkerConfig>) {
    this.#consolidationService = new ConsolidationService(services);
    this.#config = { ...DEFAULT_WORKER_CONFIG, ...config };

    const logService = services.get(LogService);
    this.#logger = logService.child({ source: 'ConsolidationWorker' });
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  /**
   * Set the knowledge extractor (LLM-based extraction).
   */
  setKnowledgeExtractor = (extractor: KnowledgeExtractor): void => {
    this.#knowledgeExtractor = extractor;
  };

  /**
   * Set the embedding generator.
   */
  setEmbeddingGenerator = (generator: EmbeddingGenerator): void => {
    this.#embeddingGenerator = generator;
  };

  /**
   * Get the consolidation service for direct access.
   */
  get consolidationService(): ConsolidationService {
    return this.#consolidationService;
  }

  // ==========================================================================
  // Main Consolidation Process
  // ==========================================================================

  /**
   * Run the full consolidation process.
   */
  run = async (): Promise<ConsolidationResult> => {
    const run = await this.#consolidationService.createRun();
    const result: ConsolidationResult = {
      run,
      created: [],
      updated: [],
      errors: [],
    };

    this.#logger.info('Starting consolidation run', { runId: run.id });

    try {
      // 1. Find memories needing consolidation
      const memories = await this.#consolidationService.findOldUnconsolidatedMemories(
        this.#config.oldMemoryDays,
        this.#config.maxMemoriesPerBatch,
      );

      if (memories.length === 0) {
        this.#logger.info('No memories needing consolidation');
        await this.#consolidationService.updateRun(run.id, {
          status: 'completed',
          memoriesProcessed: 0,
        });
        result.run = (await this.#consolidationService.getLatestRun()) ?? run;
        return result;
      }

      this.#logger.info('Found memories for consolidation', { count: memories.length });

      // 2. Group memories by enabled strategies
      const allGroups = await this.#groupMemoriesByStrategies(memories);

      // 3. Limit groups per run
      const groups = allGroups.slice(0, this.#config.maxGroupsPerRun);

      this.#logger.info('Grouped memories', {
        totalGroups: allGroups.length,
        processingGroups: groups.length,
      });

      // 4. Process each group
      for (const group of groups) {
        if (result.errors.length >= this.#config.maxErrorsBeforeAbort) {
          this.#logger.warn('Aborting due to too many errors', { errorCount: result.errors.length });
          break;
        }

        try {
          const consolidated = await this.#processGroup(group);
          if (consolidated.isNew) {
            result.created.push(consolidated.memory);
          } else {
            result.updated.push(consolidated.memory);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          result.errors.push(`Group ${group.groupKey}: ${errorMessage}`);
          this.#logger.error('Failed to process group', { groupKey: group.groupKey, error: errorMessage });
        }
      }

      // 5. Update run status
      const totalProcessed = new Set(groups.flatMap((g) => g.memories.map((m) => m.id))).size;

      await this.#consolidationService.updateRun(run.id, {
        status: result.errors.length >= this.#config.maxErrorsBeforeAbort ? 'failed' : 'completed',
        memoriesProcessed: totalProcessed,
        consolidatedCreated: result.created.length,
        consolidatedUpdated: result.updated.length,
        errors: result.errors,
      });

      result.run = (await this.#consolidationService.getLatestRun()) ?? run;

      this.#logger.info('Consolidation run completed', {
        runId: run.id,
        memoriesProcessed: totalProcessed,
        created: result.created.length,
        updated: result.updated.length,
        errors: result.errors.length,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(`Run failed: ${errorMessage}`);

      await this.#consolidationService.updateRun(run.id, {
        status: 'failed',
        errors: result.errors,
      });

      result.run = (await this.#consolidationService.getLatestRun()) ?? run;
      this.#logger.error('Consolidation run failed', { runId: run.id, error: errorMessage });
    }

    return result;
  };

  /**
   * Consolidate memories for a specific entity.
   */
  consolidateEntity = async (entityId: string): Promise<ConsolidatedMemory | null> => {
    this.#logger.info('Consolidating entity', { entityId });

    // Find memories for this entity
    const memories = await this.#findMemoriesForEntity(entityId);

    if (memories.length < this.#config.minMemoriesForConsolidation) {
      this.#logger.debug('Not enough memories for entity consolidation', {
        entityId,
        found: memories.length,
        required: this.#config.minMemoriesForConsolidation,
      });
      return null;
    }

    const group: MemoryGroup = {
      groupKey: `entity:${entityId}`,
      groupingReason: 'same_entity',
      memories,
    };

    const result = await this.#processGroup(group);
    return result.memory;
  };

  /**
   * Incrementally add memories to an existing consolidated memory.
   */
  incrementalUpdate = async (
    consolidatedId: string,
    newMemories: MemoryForConsolidation[],
  ): Promise<ConsolidatedMemory | null> => {
    const existing = await this.#consolidationService.store.get(consolidatedId);
    if (!existing) {
      this.#logger.warn('Cannot update non-existent consolidated memory', { consolidatedId });
      return null;
    }

    this.#logger.info('Incremental update', {
      consolidatedId,
      newMemoryCount: newMemories.length,
      existingSourceCount: existing.sourceMemoryCount,
    });

    // Combine existing source summary with new memories for extraction
    const combinedContent = this.#buildIncrementalContext(existing, newMemories);

    // Extract knowledge
    const extracted = await this.#extractKnowledge(existing.type, combinedContent);
    if (!extracted) {
      this.#logger.warn('Failed to extract knowledge for incremental update');
      return null;
    }

    // Generate embedding for the updated content
    const embedding = await this.#generateEmbedding(extracted.summary);

    // Update the consolidated memory
    const group: MemoryGroup = {
      groupKey: `incremental:${consolidatedId}`,
      groupingReason:
        existing.type === 'entity' ? 'same_entity' : existing.type === 'period' ? 'same_period' : 'same_topic',
      memories: newMemories,
    };

    const updated = await this.#consolidationService.updateConsolidated(consolidatedId, group, extracted, embedding);

    if (updated) {
      // Mark new source memories as consolidated
      await this.#consolidationService.store.markMemoriesConsolidated(
        newMemories.map((m) => m.id),
        consolidatedId,
      );
    }

    return updated;
  };

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Group memories using all enabled strategies.
   */
  #groupMemoriesByStrategies = async (memories: MemoryForConsolidation[]): Promise<MemoryGroup[]> => {
    const allGroups: MemoryGroup[] = [];

    if (this.#config.enableEntityConsolidation) {
      const entityGroups = await this.#consolidationService.groupMemories(memories, 'entity');
      allGroups.push(...entityGroups);
    }

    if (this.#config.enableTopicConsolidation) {
      const topicGroups = await this.#consolidationService.groupMemories(memories, 'topic');
      allGroups.push(...topicGroups);
    }

    if (this.#config.enableTemporalConsolidation) {
      const temporalGroups = await this.#consolidationService.groupMemories(memories, 'temporal');
      allGroups.push(...temporalGroups);
    }

    // Deduplicate: prefer entity > topic > temporal
    return this.#deduplicateGroups(allGroups);
  };

  /**
   * Remove groups with significant overlap.
   */
  #deduplicateGroups = (groups: MemoryGroup[]): MemoryGroup[] => {
    const finalGroups: MemoryGroup[] = [];
    const usedMemoryIds = new Set<string>();

    // Sort by priority: entity first, then topic, then temporal
    const sorted = [...groups].sort((a, b) => {
      const priorityA = a.groupingReason === 'same_entity' ? 0 : a.groupingReason === 'same_topic' ? 1 : 2;
      const priorityB = b.groupingReason === 'same_entity' ? 0 : b.groupingReason === 'same_topic' ? 1 : 2;
      return priorityA - priorityB;
    });

    for (const group of sorted) {
      const groupMemoryIds = new Set(group.memories.map((m) => m.id));
      const overlapCount = [...groupMemoryIds].filter((id) => usedMemoryIds.has(id)).length;
      const overlapRatio = overlapCount / group.memories.length;

      // Only include if less than 50% overlap
      if (overlapRatio < 0.5) {
        finalGroups.push(group);
        for (const id of groupMemoryIds) {
          usedMemoryIds.add(id);
        }
      }
    }

    return finalGroups;
  };

  /**
   * Process a single memory group.
   */
  #processGroup = async (group: MemoryGroup): Promise<{ memory: ConsolidatedMemory; isNew: boolean }> => {
    this.#logger.debug('Processing group', {
      groupKey: group.groupKey,
      memoryCount: group.memories.length,
    });

    // Check for existing consolidated memory for this group
    const existingId = await this.#findExistingConsolidated(group);

    // Extract knowledge
    const extracted = await this.#extractKnowledge(group.groupKey, group.memories);
    if (!extracted) {
      throw new Error('Failed to extract knowledge');
    }

    // Generate embedding
    const embedding = await this.#generateEmbedding(extracted.summary);

    let memory: ConsolidatedMemory;
    let isNew: boolean;

    if (existingId) {
      // Update existing
      const updated = await this.#consolidationService.updateConsolidated(existingId, group, extracted, embedding);
      if (!updated) {
        throw new Error('Failed to update consolidated memory');
      }
      memory = updated;
      isNew = false;
    } else {
      // Create new
      memory = await this.#consolidationService.createConsolidated(group, extracted, embedding);
      isNew = true;
    }

    // Mark source memories as consolidated
    await this.#consolidationService.store.markMemoriesConsolidated(
      group.memories.map((m) => m.id),
      memory.id,
    );

    return { memory, isNew };
  };

  /**
   * Extract knowledge from memories using LLM or default extraction.
   */
  #extractKnowledge = async (
    groupKey: string,
    memories: MemoryForConsolidation[] | string,
  ): Promise<ExtractedKnowledge | null> => {
    // If we have a string context (incremental update), use it directly
    if (typeof memories === 'string') {
      if (this.#knowledgeExtractor) {
        // Create a fake memory for the extractor
        const fakeMemories: MemoryForConsolidation[] = [
          {
            id: 'context',
            type: 'consolidated',
            content: memories,
            createdAt: new Date().toISOString(),
          },
        ];
        return this.#knowledgeExtractor(groupKey, fakeMemories);
      }
      // Default: simple extraction
      return {
        summary: memories.slice(0, 500),
        structuredData: {},
        keyPoints: [],
        lessons: [],
        supersededInfo: [],
      };
    }

    // Normal memory array
    if (this.#knowledgeExtractor) {
      return this.#knowledgeExtractor(groupKey, memories);
    }

    // Default: simple extraction without LLM
    return this.#defaultExtraction(groupKey, memories);
  };

  /**
   * Default knowledge extraction without LLM.
   */
  #defaultExtraction = (groupKey: string, memories: MemoryForConsolidation[]): ExtractedKnowledge => {
    const contents = memories.map((m) => m.content);
    return {
      summary: `Consolidated ${memories.length} memories about ${groupKey}`,
      structuredData: {
        memoryTypes: [...new Set(memories.map((m) => m.type))],
        dateRange: {
          start: memories.reduce((min, m) => (m.createdAt < min ? m.createdAt : min), memories[0]?.createdAt ?? ''),
          end: memories.reduce((max, m) => (m.createdAt > max ? m.createdAt : max), memories[0]?.createdAt ?? ''),
        },
      },
      keyPoints: contents.slice(0, 5),
      lessons: [],
      supersededInfo: [],
    };
  };

  /**
   * Generate embedding for text.
   */
  #generateEmbedding = async (text: string): Promise<number[] | undefined> => {
    if (!this.#embeddingGenerator) {
      return undefined;
    }

    try {
      return await this.#embeddingGenerator(text);
    } catch (error) {
      this.#logger.warn('Failed to generate embedding', { error });
      return undefined;
    }
  };

  /**
   * Find existing consolidated memory for a group.
   */
  #findExistingConsolidated = async (group: MemoryGroup): Promise<string | null> => {
    // For entity groups, check if we have an existing entity consolidated memory
    if (group.groupingReason === 'same_entity') {
      const entityId = group.groupKey.replace('entity:', '');
      const existing = await this.#consolidationService.store.getByEntityId(entityId, 1);
      if (existing.length > 0 && existing[0]?.type === 'entity') {
        return existing[0].id;
      }
    }

    // For other types, we create new consolidated memories
    return null;
  };

  /**
   * Find memories for a specific entity.
   */
  #findMemoriesForEntity = async (entityId: string): Promise<MemoryForConsolidation[]> => {
    // This would query the memories table for memories linked to this entity
    // For now, delegate to the consolidation service
    return this.#consolidationService
      .findOldUnconsolidatedMemories(0, 100)
      .then((memories) => memories.filter((m) => m.entityIds?.includes(entityId)));
  };

  /**
   * Build context for incremental update.
   */
  #buildIncrementalContext = (existing: ConsolidatedMemory, newMemories: MemoryForConsolidation[]): string => {
    const existingContext = `
Existing Knowledge (${existing.sourceMemoryCount} memories):
Summary: ${existing.content.summary}
Key Points:
${existing.content.keyPoints.map((p) => `- ${p}`).join('\n')}
${existing.content.lessons?.length ? `Lessons:\n${existing.content.lessons.map((l) => `- ${l}`).join('\n')}` : ''}
`;

    const newContext = `
New Information (${newMemories.length} memories):
${newMemories.map((m, i) => `[${i + 1}] (${m.createdAt.split('T')[0]}): ${m.content}`).join('\n')}
`;

    return existingContext + newContext;
  };
}

// ============================================================================
// Exports
// ============================================================================

export type { ConsolidationWorkerConfig, ConsolidationResult, KnowledgeExtractor, EmbeddingGenerator };

export { ConsolidationWorker, DEFAULT_WORKER_CONFIG };
