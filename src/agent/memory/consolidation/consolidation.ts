/**
 * Memory Consolidation Module
 *
 * Provides scalable memory through:
 * - Activation scoring with decay
 * - Consolidated memories (knowledge distilled from multiple memories)
 * - Open loops (unresolved situations to track)
 * - Dynamic memory index
 *
 * See spec/019-memory-consolidation.md
 */

// Re-export schemas and types
export type {
  BoostReason,
  BoostHistoryEntry,
  MemoryActivation,
  ConsolidatedMemoryType,
  ConsolidatedContent,
  ConsolidatedMemory,
  OpenLoopStatus,
  OpenLoop,
  CreateOpenLoopInput,
  ActiveEntity,
  OpenLoopSummary,
  MemoryCategory,
  MemoryLandscape,
  SessionContext,
  MemoryIndex,
  MemoryHintType,
  MemoryHint,
  ConsolidationRunStatus,
  ConsolidationRun,
  ActivationConfig,
  ConsolidationConfig,
  IndexStatus,
} from './consolidation.schemas.ts';

export {
  boostReasonSchema,
  boostHistoryEntrySchema,
  memoryActivationSchema,
  consolidatedMemoryTypeSchema,
  consolidatedContentSchema,
  consolidatedMemorySchema,
  openLoopStatusSchema,
  openLoopSchema,
  createOpenLoopInputSchema,
  activeEntitySchema,
  openLoopSummarySchema,
  memoryCategorySchema,
  memoryLandscapeSchema,
  sessionContextSchema,
  memoryIndexSchema,
  memoryHintTypeSchema,
  memoryHintSchema,
  consolidationRunStatusSchema,
  consolidationRunSchema,
  activationConfigSchema,
  consolidationConfigSchema,
  indexStatusSchema,
} from './consolidation.schemas.ts';

// Re-export services
export { ActivationService, DEFAULT_ACTIVATION_CONFIG } from './activation.service.ts';
export { ActivationStore } from './activation.store.ts';
export { MemoryIndexService, DEFAULT_CONSOLIDATION_CONFIG } from './index.service.ts';
export { OpenLoopStore } from './openloop.store.ts';
export { OpenLoopService, extractKeywords } from './openloop.service.ts';
export { MessageRetrievalService, DEFAULT_RETRIEVAL_CONFIG, extractTopicKeywords } from './retrieval.service.ts';
export type { ExtractedEntity, ExtractedEntities, RetrievalResult, RetrievalConfig } from './retrieval.service.ts';

// Consolidation infrastructure (Phase 5)
export { ConsolidatedMemoryStore } from './consolidated.store.ts';
export type { CreateConsolidatedInput, UpdateConsolidatedInput } from './consolidated.store.ts';
export { ConsolidationService, DEFAULT_CONSOLIDATION_SERVICE_CONFIG } from './consolidation.service.ts';
export type {
  MemoryForConsolidation,
  MemoryGroup,
  ExtractedKnowledge,
  GroupingStrategy,
  ConsolidationServiceConfig,
} from './consolidation.service.ts';

// Consolidation worker (Phase 6)
export { ConsolidationWorker, DEFAULT_WORKER_CONFIG } from './consolidation.worker.ts';
export type {
  ConsolidationWorkerConfig,
  ConsolidationResult,
  KnowledgeExtractor,
  EmbeddingGenerator,
} from './consolidation.worker.ts';

// Background jobs (Phase 7)
export { ConsolidationJobService, DEFAULT_JOB_CONFIG } from './consolidation.job.ts';
export type { ConsolidationJobConfig, ConsolidationJobReport } from './consolidation.job.ts';
