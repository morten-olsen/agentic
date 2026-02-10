import { randomUUID } from 'crypto';

import type { Knex } from 'knex';

import type { Services } from '../../../core/services/services.ts';
import { DatabaseService } from '../../../core/database/database.ts';
import { LogService } from '../../../core/logging/logging.ts';
import type { Logger } from '../../../core/logging/logging.ts';

import type {
  ConsolidatedMemory,
  ConsolidatedMemoryType,
  ConsolidatedContent,
  ConsolidationRun,
  ConsolidationRunStatus,
} from './consolidation.schemas.ts';
import { ConsolidatedMemoryStore } from './consolidated.store.ts';
import type { CreateConsolidatedInput } from './consolidated.store.ts';

// ============================================================================
// Types
// ============================================================================

type MemoryForConsolidation = {
  id: string;
  type: string;
  content: string;
  createdAt: string;
  entityIds?: string[];
  topics?: string[];
};

type MemoryGroup = {
  groupKey: string;
  groupingReason: 'same_entity' | 'same_topic' | 'same_period' | 'semantic_cluster';
  memories: MemoryForConsolidation[];
};

type ExtractedKnowledge = {
  summary: string;
  structuredData: Record<string, unknown>;
  keyPoints: string[];
  lessons: string[];
  supersededInfo: string[];
};

type GroupingStrategy = 'entity' | 'topic' | 'temporal' | 'all';

type ConsolidationServiceConfig = {
  minMemoriesForConsolidation: number;
  maxMemoriesPerGroup: number;
  temporalGroupDays: number;
  entityConsolidationThreshold: number;
};

const DEFAULT_CONSOLIDATION_SERVICE_CONFIG: ConsolidationServiceConfig = {
  minMemoriesForConsolidation: 3,
  maxMemoriesPerGroup: 50,
  temporalGroupDays: 30,
  entityConsolidationThreshold: 5,
};

// ============================================================================
// Consolidation Service
// ============================================================================

/**
 * Consolidation Service - transforms discrete memories into consolidated knowledge.
 *
 * Handles:
 * - Grouping memories by entity, topic, or time period
 * - Extracting knowledge using LLM
 * - Creating and updating consolidated memories
 * - Tracking consolidation runs
 *
 * See spec/019-memory-consolidation.md
 */
class ConsolidationService {
  #db: Knex;
  #store: ConsolidatedMemoryStore;
  #logger: Logger;
  #config: ConsolidationServiceConfig;

  constructor(services: Services, config?: Partial<ConsolidationServiceConfig>) {
    const dbService = services.get(DatabaseService);
    this.#db = dbService.knex;
    this.#store = new ConsolidatedMemoryStore(this.#db);
    this.#config = { ...DEFAULT_CONSOLIDATION_SERVICE_CONFIG, ...config };

    const logService = services.get(LogService);
    this.#logger = logService.child({ source: 'ConsolidationService' });
  }

  // ==========================================================================
  // Store Access
  // ==========================================================================

  /**
   * Get the underlying store for direct access.
   */
  get store(): ConsolidatedMemoryStore {
    return this.#store;
  }

  // ==========================================================================
  // Grouping Strategies
  // ==========================================================================

  /**
   * Group memories for consolidation.
   */
  groupMemories = async (memories: MemoryForConsolidation[], strategy: GroupingStrategy): Promise<MemoryGroup[]> => {
    switch (strategy) {
      case 'entity':
        return this.#groupByEntity(memories);
      case 'topic':
        return this.#groupByTopic(memories);
      case 'temporal':
        return this.#groupByTemporal(memories);
      case 'all':
        return this.#groupAll(memories);
      default:
        return [];
    }
  };

  /**
   * Group memories by entity ID.
   */
  #groupByEntity = (memories: MemoryForConsolidation[]): MemoryGroup[] => {
    const entityGroups = new Map<string, MemoryForConsolidation[]>();

    for (const memory of memories) {
      const entityIds = memory.entityIds ?? [];
      for (const entityId of entityIds) {
        const existing = entityGroups.get(entityId) ?? [];
        existing.push(memory);
        entityGroups.set(entityId, existing);
      }
    }

    const groups: MemoryGroup[] = [];
    for (const [entityId, groupMemories] of entityGroups) {
      if (groupMemories.length >= this.#config.minMemoriesForConsolidation) {
        groups.push({
          groupKey: `entity:${entityId}`,
          groupingReason: 'same_entity',
          memories: groupMemories.slice(0, this.#config.maxMemoriesPerGroup),
        });
      }
    }

    return groups;
  };

  /**
   * Group memories by topic.
   */
  #groupByTopic = (memories: MemoryForConsolidation[]): MemoryGroup[] => {
    const topicGroups = new Map<string, MemoryForConsolidation[]>();

    for (const memory of memories) {
      const topics = memory.topics ?? [];
      for (const topic of topics) {
        const existing = topicGroups.get(topic) ?? [];
        existing.push(memory);
        topicGroups.set(topic, existing);
      }
    }

    const groups: MemoryGroup[] = [];
    for (const [topic, groupMemories] of topicGroups) {
      if (groupMemories.length >= this.#config.minMemoriesForConsolidation) {
        groups.push({
          groupKey: `topic:${topic}`,
          groupingReason: 'same_topic',
          memories: groupMemories.slice(0, this.#config.maxMemoriesPerGroup),
        });
      }
    }

    return groups;
  };

  /**
   * Group memories by time period.
   */
  #groupByTemporal = (memories: MemoryForConsolidation[]): MemoryGroup[] => {
    const periodGroups = new Map<string, MemoryForConsolidation[]>();
    const periodDays = this.#config.temporalGroupDays;

    for (const memory of memories) {
      const date = new Date(memory.createdAt);
      // Group by period (e.g., 30-day chunks)
      const periodStart = new Date(date);
      periodStart.setDate(periodStart.getDate() - (periodStart.getDate() % periodDays));
      const periodKey = periodStart.toISOString().split('T')[0] ?? '';

      const existing = periodGroups.get(periodKey) ?? [];
      existing.push(memory);
      periodGroups.set(periodKey, existing);
    }

    const groups: MemoryGroup[] = [];
    for (const [period, groupMemories] of periodGroups) {
      if (groupMemories.length >= this.#config.minMemoriesForConsolidation) {
        groups.push({
          groupKey: `period:${period}`,
          groupingReason: 'same_period',
          memories: groupMemories.slice(0, this.#config.maxMemoriesPerGroup),
        });
      }
    }

    return groups;
  };

  /**
   * Apply all grouping strategies and merge results.
   */
  #groupAll = async (memories: MemoryForConsolidation[]): Promise<MemoryGroup[]> => {
    const entityGroups = this.#groupByEntity(memories);
    const topicGroups = this.#groupByTopic(memories);
    const temporalGroups = this.#groupByTemporal(memories);

    // Combine and deduplicate (prefer entity > topic > temporal)
    const allGroups = [...entityGroups, ...topicGroups, ...temporalGroups];

    // Simple deduplication: remove groups with significant overlap
    const finalGroups: MemoryGroup[] = [];
    const usedMemoryIds = new Set<string>();

    for (const group of allGroups) {
      const groupMemoryIds = new Set(group.memories.map((m) => m.id));
      const overlapCount = [...groupMemoryIds].filter((id) => usedMemoryIds.has(id)).length;
      const overlapRatio = overlapCount / group.memories.length;

      // Only include if less than 50% overlap with already selected groups
      if (overlapRatio < 0.5) {
        finalGroups.push(group);
        for (const id of groupMemoryIds) {
          usedMemoryIds.add(id);
        }
      }
    }

    return finalGroups;
  };

  // ==========================================================================
  // Knowledge Extraction
  // ==========================================================================

  /**
   * Generate extraction prompt for LLM.
   */
  generateExtractionPrompt = (groupKey: string, memories: MemoryForConsolidation[]): string => {
    const memoriesText = memories.map((m, i) => `[${i + 1}] (${m.createdAt.split('T')[0]}): ${m.content}`).join('\n\n');

    return `Analyze the following memories about "${groupKey}" and extract:

1. **Summary**: A 2-3 sentence overview of what is known
2. **Key Facts**: Structured data (for people: job, location, interests; for projects: status, goals, etc.)
3. **Key Points**: Important things to remember (bullet points)
4. **Patterns/Lessons**: Any learned patterns or insights
5. **Superseded Info**: Any information that has been updated/replaced (old info that's no longer current)

Memories:
${memoriesText}

Respond in JSON format:
{
  "summary": "...",
  "structuredData": { ... },
  "keyPoints": ["...", "..."],
  "lessons": ["...", "..."],
  "supersededInfo": ["...", "..."]
}`;
  };

  /**
   * Parse extracted knowledge from LLM response.
   */
  parseExtractedKnowledge = (response: string): ExtractedKnowledge | null => {
    try {
      // Try to extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

      return {
        summary: String(parsed.summary ?? ''),
        structuredData: (parsed.structuredData as Record<string, unknown>) ?? {},
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.map(String) : [],
        lessons: Array.isArray(parsed.lessons) ? parsed.lessons.map(String) : [],
        supersededInfo: Array.isArray(parsed.supersededInfo) ? parsed.supersededInfo.map(String) : [],
      };
    } catch {
      this.#logger.warn('Failed to parse extracted knowledge', { response: response.slice(0, 200) });
      return null;
    }
  };

  // ==========================================================================
  // Consolidation Operations
  // ==========================================================================

  /**
   * Create a consolidated memory from a group and extracted knowledge.
   */
  createConsolidated = async (
    group: MemoryGroup,
    extracted: ExtractedKnowledge,
    embedding?: number[],
  ): Promise<ConsolidatedMemory> => {
    const type = this.#inferType(group);
    const content: ConsolidatedContent = {
      summary: extracted.summary,
      structuredData: extracted.structuredData,
      keyPoints: extracted.keyPoints,
      lessons: extracted.lessons.length > 0 ? extracted.lessons : undefined,
    };

    const input: CreateConsolidatedInput = {
      type,
      content,
      timespanStart: this.#minDate(group.memories.map((m) => m.createdAt)),
      timespanEnd: this.#maxDate(group.memories.map((m) => m.createdAt)),
      sourceMemoryIds: group.memories.map((m) => m.id),
      embedding,
      entityIds: this.#extractEntityIds(group),
      topics: this.#extractTopics(group),
    };

    const consolidated = await this.#store.create(input);

    this.#logger.info('Created consolidated memory', {
      id: consolidated.id,
      type: consolidated.type,
      sourceCount: consolidated.sourceMemoryCount,
      groupKey: group.groupKey,
    });

    return consolidated;
  };

  /**
   * Update an existing consolidated memory with new knowledge.
   */
  updateConsolidated = async (
    existingId: string,
    group: MemoryGroup,
    extracted: ExtractedKnowledge,
    embedding?: number[],
  ): Promise<ConsolidatedMemory | null> => {
    const existing = await this.#store.get(existingId);
    if (!existing) {
      return null;
    }

    // Merge content
    const mergedContent: ConsolidatedContent = {
      summary: extracted.summary, // Use new summary (LLM has all context)
      structuredData: { ...existing.content.structuredData, ...extracted.structuredData },
      keyPoints: this.#mergeArrays(existing.content.keyPoints, extracted.keyPoints),
      lessons: this.#mergeArrays(existing.content.lessons ?? [], extracted.lessons),
    };

    // Merge source memory IDs
    const allSourceIds = [...new Set([...existing.sourceMemoryIds, ...group.memories.map((m) => m.id)])];

    const updated = await this.#store.update(existingId, {
      content: mergedContent,
      timespanEnd: this.#maxDate([existing.timespan.end, ...group.memories.map((m) => m.createdAt)]),
      sourceMemoryIds: allSourceIds,
      embedding,
      entityIds: this.#mergeArrays(existing.entityIds, this.#extractEntityIds(group)),
      topics: this.#mergeArrays(existing.topics, this.#extractTopics(group)),
    });

    if (updated) {
      this.#logger.info('Updated consolidated memory', {
        id: updated.id,
        version: updated.version,
        sourceCount: updated.sourceMemoryCount,
      });
    }

    return updated;
  };

  // ==========================================================================
  // Run Tracking
  // ==========================================================================

  /**
   * Create a consolidation run record.
   */
  createRun = async (): Promise<ConsolidationRun> => {
    const now = new Date().toISOString();
    const id = randomUUID();

    await this.#db('consolidation_runs').insert({
      id,
      started_at: now,
      status: 'running',
      memories_processed: 0,
      consolidated_created: 0,
      consolidated_updated: 0,
      errors: JSON.stringify([]),
      created_at: now,
    });

    return {
      id,
      startedAt: now,
      status: 'running',
      memoriesProcessed: 0,
      consolidatedCreated: 0,
      consolidatedUpdated: 0,
      errors: [],
      createdAt: now,
    };
  };

  /**
   * Update a consolidation run.
   */
  updateRun = async (
    id: string,
    updates: Partial<{
      status: ConsolidationRunStatus;
      memoriesProcessed: number;
      consolidatedCreated: number;
      consolidatedUpdated: number;
      errors: string[];
    }>,
  ): Promise<void> => {
    const now = new Date().toISOString();
    const updateFields: Record<string, unknown> = {};

    if (updates.status !== undefined) {
      updateFields.status = updates.status;
      if (updates.status === 'completed' || updates.status === 'failed') {
        updateFields.completed_at = now;
      }
    }
    if (updates.memoriesProcessed !== undefined) {
      updateFields.memories_processed = updates.memoriesProcessed;
    }
    if (updates.consolidatedCreated !== undefined) {
      updateFields.consolidated_created = updates.consolidatedCreated;
    }
    if (updates.consolidatedUpdated !== undefined) {
      updateFields.consolidated_updated = updates.consolidatedUpdated;
    }
    if (updates.errors !== undefined) {
      updateFields.errors = JSON.stringify(updates.errors);
    }

    await this.#db('consolidation_runs').where('id', id).update(updateFields);
  };

  /**
   * Get the latest consolidation run.
   */
  getLatestRun = async (): Promise<ConsolidationRun | null> => {
    const row = await this.#db('consolidation_runs').orderBy('created_at', 'desc').first();

    if (!row) {
      return null;
    }

    return {
      id: row.id as string,
      startedAt: row.started_at as string,
      completedAt: (row.completed_at as string) ?? undefined,
      status: row.status as ConsolidationRunStatus,
      memoriesProcessed: row.memories_processed as number,
      consolidatedCreated: row.consolidated_created as number,
      consolidatedUpdated: row.consolidated_updated as number,
      errors: row.errors ? (JSON.parse(row.errors as string) as string[]) : [],
      createdAt: row.created_at as string,
    };
  };

  // ==========================================================================
  // Query Helpers
  // ==========================================================================

  /**
   * Find entities needing consolidation (too many unconsolidated memories).
   */
  findEntitiesNeedingConsolidation = async (limit = 10): Promise<string[]> => {
    // This query finds entity IDs with more than threshold unconsolidated memories
    // In a real implementation, you'd query the entity_knowledge table
    // For now, return empty as we don't have that infrastructure yet
    this.#logger.debug('Finding entities needing consolidation', { limit });
    return [];
  };

  /**
   * Find old unconsolidated memories.
   */
  findOldUnconsolidatedMemories = async (olderThanDays: number, limit: number): Promise<MemoryForConsolidation[]> => {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();

    const rows = await this.#db('memories')
      .where('created_at', '<', cutoff)
      .whereNull('consolidated_into_id')
      .where('index_status', '!=', 'archived')
      .orderBy('created_at', 'asc')
      .limit(limit);

    return rows.map((row) => ({
      id: row.id as string,
      type: row.type as string,
      content: row.content as string,
      createdAt: row.created_at as string,
      entityIds: row.entity_ids ? (JSON.parse(row.entity_ids as string) as string[]) : undefined,
      topics: row.topics ? (JSON.parse(row.topics as string) as string[]) : undefined,
    }));
  };

  // ==========================================================================
  // Helpers
  // ==========================================================================

  #inferType = (group: MemoryGroup): ConsolidatedMemoryType => {
    switch (group.groupingReason) {
      case 'same_entity':
        return 'entity';
      case 'same_topic':
        return 'insight';
      case 'same_period':
        return 'period';
      default:
        return 'insight';
    }
  };

  #extractEntityIds = (group: MemoryGroup): string[] => {
    const ids = new Set<string>();
    for (const memory of group.memories) {
      for (const id of memory.entityIds ?? []) {
        ids.add(id);
      }
    }
    return [...ids];
  };

  #extractTopics = (group: MemoryGroup): string[] => {
    const topics = new Set<string>();
    for (const memory of group.memories) {
      for (const topic of memory.topics ?? []) {
        topics.add(topic);
      }
    }
    return [...topics];
  };

  #minDate = (dates: string[]): string => {
    return dates.reduce((min, date) => (date < min ? date : min));
  };

  #maxDate = (dates: string[]): string => {
    return dates.reduce((max, date) => (date > max ? date : max));
  };

  #mergeArrays = <T>(arr1: T[], arr2: T[]): T[] => {
    // Simple deduplication for string arrays
    if (arr1.length === 0) return arr2;
    if (arr2.length === 0) return arr1;

    const seen = new Set<string>();
    const result: T[] = [];

    for (const item of [...arr1, ...arr2]) {
      const key = JSON.stringify(item);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }

    return result;
  };
}

// ============================================================================
// Exports
// ============================================================================

export type { MemoryForConsolidation, MemoryGroup, ExtractedKnowledge, GroupingStrategy, ConsolidationServiceConfig };

export { ConsolidationService, DEFAULT_CONSOLIDATION_SERVICE_CONFIG };
