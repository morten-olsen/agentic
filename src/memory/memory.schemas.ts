import { z } from 'zod';

// ============================================================================
// Memory Type
// ============================================================================

const memoryTypeSchema = z.enum([
  'conversation', // Past conversation summaries
  'fact', // Learned facts about user/world
  'preference', // User preferences
  'procedure', // How to do things
  'feedback', // User corrections and guidance
  'event', // External events that occurred
  'entity', // Knowledge about things in user's world (links to EntityKnowledge)
  'operator_manual', // Procedural knowledge for recurring tasks
]);

type MemoryType = z.infer<typeof memoryTypeSchema>;

// ============================================================================
// Memory Entry
// ============================================================================

const memoryEntrySchema = z.object({
  id: z.string(),
  type: memoryTypeSchema,
  content: z.string(),
  embedding: z.array(z.number()).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  importance: z.number().min(0).max(1),
  createdAt: z.string(),
  lastAccessedAt: z.string(),
  accessCount: z.number(),
});

type MemoryEntry = z.infer<typeof memoryEntrySchema>;

// ============================================================================
// Recall Options
// ============================================================================

const recallOptionsSchema = z.object({
  limit: z.number().positive().optional(),
  types: z.array(memoryTypeSchema).optional(),
  minImportance: z.number().min(0).max(1).optional(),
  timeRange: z
    .object({
      start: z.string(),
      end: z.string(),
    })
    .optional(),
});

type RecallOptions = z.infer<typeof recallOptionsSchema>;

// ============================================================================
// Create Memory Input
// ============================================================================

const createMemoryInputSchema = z.object({
  type: memoryTypeSchema,
  content: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
  importance: z.number().min(0).max(1).optional().default(0.5),
});

type CreateMemoryInput = z.input<typeof createMemoryInputSchema>;

// ============================================================================
// Update Memory Input
// ============================================================================

const updateMemoryInputSchema = z.object({
  content: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  importance: z.number().min(0).max(1).optional(),
  embedding: z.array(z.number()).optional(),
});

type UpdateMemoryInput = z.infer<typeof updateMemoryInputSchema>;

// ============================================================================
// Database Row
// ============================================================================

const memoryRowSchema = z.object({
  id: z.string(),
  type: z.string(),
  content: z.string(),
  embedding: z.instanceof(Buffer).nullable(),
  metadata: z.string().nullable(), // JSON
  importance: z.number(),
  created_at: z.string(),
  last_accessed_at: z.string(),
  access_count: z.number(),
});

type MemoryRow = z.infer<typeof memoryRowSchema>;

// ============================================================================
// Memory Config
// ============================================================================

const memoryConfigSchema = z.object({
  embeddingModel: z.string().default('openai/text-embedding-3-small'),
  embeddingDimensions: z.number().positive().default(1536),
  recallLimit: z.number().positive().default(10),
  minImportanceForRecall: z.number().min(0).max(1).default(0.2),
});

type MemoryConfig = z.infer<typeof memoryConfigSchema>;

// ============================================================================
// Conversation Summary (for consolidation)
// ============================================================================

const conversationSummarySchema = z.object({
  summary: z.string(),
  extractedFacts: z.array(z.string()),
  extractedPreferences: z.array(z.string()),
});

type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export type {
  MemoryType,
  MemoryEntry,
  RecallOptions,
  CreateMemoryInput,
  UpdateMemoryInput,
  MemoryRow,
  MemoryConfig,
  ConversationSummary,
};

export {
  memoryTypeSchema,
  memoryEntrySchema,
  recallOptionsSchema,
  createMemoryInputSchema,
  updateMemoryInputSchema,
  memoryRowSchema,
  memoryConfigSchema,
  conversationSummarySchema,
};
