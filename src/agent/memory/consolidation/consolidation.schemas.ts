import { z } from 'zod';

// ============================================================================
// Activation
// ============================================================================

const boostReasonSchema = z.enum([
  'user_mention', // User explicitly mentions entity
  'agent_retrieval', // Agent retrieves memory
  'related_entity', // Related entity was mentioned
  'scheduled_event', // Calendar event involving entity
]);

type BoostReason = z.infer<typeof boostReasonSchema>;

const boostHistoryEntrySchema = z.object({
  timestamp: z.string(),
  reason: boostReasonSchema,
  boostAmount: z.number(),
});

type BoostHistoryEntry = z.infer<typeof boostHistoryEntrySchema>;

const memoryActivationSchema = z.object({
  memoryId: z.string(),
  activationScore: z.number().min(0).max(1),
  decayRate: z.number().default(0.02),
  lastDecayAt: z.string(),
  boostHistory: z.array(boostHistoryEntrySchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

type MemoryActivation = z.infer<typeof memoryActivationSchema>;

// ============================================================================
// Consolidated Memory
// ============================================================================

const consolidatedMemoryTypeSchema = z.enum([
  'entity', // Knowledge about a person, project, place, etc.
  'decision', // A decision with rationale and alternatives
  'period', // Summary of a time period
  'insight', // A learned pattern or lesson
  'preference', // A preference with evolution history
]);

type ConsolidatedMemoryType = z.infer<typeof consolidatedMemoryTypeSchema>;

const consolidatedContentSchema = z.object({
  summary: z.string(),
  structuredData: z.record(z.string(), z.unknown()).optional(),
  keyPoints: z.array(z.string()),
  lessons: z.array(z.string()).optional(),
});

type ConsolidatedContent = z.infer<typeof consolidatedContentSchema>;

const consolidatedMemorySchema = z.object({
  id: z.string(),
  type: consolidatedMemoryTypeSchema,
  content: consolidatedContentSchema,
  timespan: z.object({
    start: z.string(),
    end: z.string(),
    consolidatedAt: z.string(),
  }),
  sourceMemoryIds: z.array(z.string()),
  sourceMemoryCount: z.number(),
  version: z.number(),
  supersedesId: z.string().optional(),
  embedding: z.array(z.number()).optional(),
  activationScore: z.number().min(0).max(1),
  lastAccessedAt: z.string(),
  entityIds: z.array(z.string()),
  topics: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

type ConsolidatedMemory = z.infer<typeof consolidatedMemorySchema>;

// ============================================================================
// Open Loop
// ============================================================================

const openLoopStatusSchema = z.enum(['active', 'resolved', 'stale']);

type OpenLoopStatus = z.infer<typeof openLoopStatusSchema>;

const openLoopSchema = z.object({
  id: z.string(),
  topic: z.string(),
  description: z.string(),
  activationPatterns: z.array(z.string()),
  linkedMemoryIds: z.array(z.string()),
  linkedConsolidatedIds: z.array(z.string()),
  status: openLoopStatusSchema,
  staleAfterDays: z.number().default(30),
  createdAt: z.string(),
  lastTriggeredAt: z.string().optional(),
  resolvedAt: z.string().optional(),
});

type OpenLoop = z.infer<typeof openLoopSchema>;

const createOpenLoopInputSchema = z.object({
  topic: z.string().min(1),
  description: z.string().min(1),
  activationPatterns: z.array(z.string().min(1)).min(1),
  linkedMemoryIds: z.array(z.string()).optional().default([]),
  linkedConsolidatedIds: z.array(z.string()).optional().default([]),
  staleAfterDays: z.number().optional().default(30),
});

type CreateOpenLoopInput = z.input<typeof createOpenLoopInputSchema>;

// ============================================================================
// Memory Index
// ============================================================================

const activeEntitySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  snippet: z.string(),
  activationScore: z.number(),
});

type ActiveEntity = z.infer<typeof activeEntitySchema>;

const openLoopSummarySchema = z.object({
  id: z.string(),
  topic: z.string(),
  daysSinceCreated: z.number(),
});

type OpenLoopSummary = z.infer<typeof openLoopSummarySchema>;

const memoryCategorySchema = z.object({
  name: z.string(),
  count: z.number(),
  lastActivity: z.string(),
});

type MemoryCategory = z.infer<typeof memoryCategorySchema>;

const memoryLandscapeSchema = z.object({
  totalMemories: z.number(),
  totalConsolidated: z.number(),
  categories: z.array(memoryCategorySchema),
});

type MemoryLandscape = z.infer<typeof memoryLandscapeSchema>;

const sessionContextSchema = z.object({
  mentionedEntities: z.array(z.string()),
  retrievedMemoryIds: z.array(z.string()),
  topicsDiscussed: z.array(z.string()),
});

type SessionContext = z.infer<typeof sessionContextSchema>;

const memoryIndexSchema = z.object({
  activeEntities: z.array(activeEntitySchema),
  openLoops: z.array(openLoopSummarySchema),
  memoryLandscape: memoryLandscapeSchema,
  sessionContext: sessionContextSchema,
});

type MemoryIndex = z.infer<typeof memoryIndexSchema>;

// ============================================================================
// Memory Hint
// ============================================================================

const memoryHintTypeSchema = z.enum(['memory', 'consolidated', 'open_loop']);

type MemoryHintType = z.infer<typeof memoryHintTypeSchema>;

const memoryHintSchema = z.object({
  memoryId: z.string(),
  type: memoryHintTypeSchema,
  hint: z.string(),
  relevanceScore: z.number(),
  entityMatch: z.string().optional(),
});

type MemoryHint = z.infer<typeof memoryHintSchema>;

// ============================================================================
// Consolidation Run
// ============================================================================

const consolidationRunStatusSchema = z.enum(['running', 'completed', 'failed']);

type ConsolidationRunStatus = z.infer<typeof consolidationRunStatusSchema>;

const consolidationRunSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  status: consolidationRunStatusSchema,
  memoriesProcessed: z.number(),
  consolidatedCreated: z.number(),
  consolidatedUpdated: z.number(),
  errors: z.array(z.string()),
  createdAt: z.string(),
});

type ConsolidationRun = z.infer<typeof consolidationRunSchema>;

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_BOOSTS = {
  user_mention: 0.4,
  agent_retrieval: 0.2,
  related_entity: 0.1,
  scheduled_event: 0.3,
} as const;

const activationBoostsSchema = z.object({
  user_mention: z.number(),
  agent_retrieval: z.number(),
  related_entity: z.number(),
  scheduled_event: z.number(),
});

const activationConfigSchema = z.object({
  dailyDecayRate: z.number().default(0.02),
  boosts: activationBoostsSchema.default(DEFAULT_BOOSTS),
  hotThreshold: z.number().default(0.5),
  warmThreshold: z.number().default(0.2),
  indexThreshold: z.number().default(0.3),
});

type ActivationConfig = z.infer<typeof activationConfigSchema>;

const consolidationConfigSchema = z.object({
  maxActiveEntities: z.number().default(15),
  maxOpenLoops: z.number().default(10),
  maxSessionEntities: z.number().default(20),
  indexActivationThreshold: z.number().default(0.3),
  hotTierThreshold: z.number().default(0.5),
  warmTierThreshold: z.number().default(0.2),
  dailyDecayRate: z.number().default(0.02),
  entityConsolidationThreshold: z.number().default(20),
  ageConsolidationDays: z.number().default(90),
  maxMemoryHints: z.number().default(5),
  hintRelevanceThreshold: z.number().default(0.6),
  defaultStaleAfterDays: z.number().default(30),
});

type ConsolidationConfig = z.infer<typeof consolidationConfigSchema>;

// ============================================================================
// Index Status (for memories table)
// ============================================================================

const indexStatusSchema = z.enum(['hot', 'warm', 'cold', 'archived']);

type IndexStatus = z.infer<typeof indexStatusSchema>;

// ============================================================================
// Exports
// ============================================================================

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
};

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
};
