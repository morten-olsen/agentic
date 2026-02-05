import { z } from 'zod';

// ============================================================================
// Store Item Value Schemas
// ============================================================================

/**
 * Base schema for all stored values.
 * Values are JSON objects with string keys.
 */
const storeValueSchema = z.record(z.string(), z.unknown());

type StoreValue = z.infer<typeof storeValueSchema>;

// ============================================================================
// Memory Value Schema
// ============================================================================

/**
 * Schema for memory entries stored in ['memories', type] namespace.
 */
const memoryValueSchema = z.object({
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  importance: z.number().min(0).max(1),
  lastAccessedAt: z.string(),
  accessCount: z.number().int().min(0),
  embedding: z.array(z.number()).optional(),
});

type MemoryValue = z.infer<typeof memoryValueSchema>;

// ============================================================================
// Entity Value Schema
// ============================================================================

/**
 * Schema for entity knowledge stored in ['entities', type] namespace.
 */
const entityValueSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  attributes: z.record(z.string(), z.unknown()).default({}),
  source: z.enum(['explicit', 'inferred']),
  confidence: z.number().min(0).max(1),
  lastReferencedAt: z.string(),
  referenceCount: z.number().int().min(0),
});

type EntityValue = z.infer<typeof entityValueSchema>;

// ============================================================================
// Database Row Schema
// ============================================================================

/**
 * Schema for store_items database row.
 */
const storeItemRowSchema = z.object({
  namespace: z.string(), // JSON array
  key: z.string(),
  value: z.string(), // JSON object
  created_at: z.string(),
  updated_at: z.string(),
});

type StoreItemRow = z.infer<typeof storeItemRowSchema>;

/**
 * Schema for store_embedding_index row.
 */
const embeddingIndexRowSchema = z.object({
  rowid: z.number(),
  namespace: z.string(),
  key: z.string(),
});

type EmbeddingIndexRow = z.infer<typeof embeddingIndexRowSchema>;

// ============================================================================
// Store Configuration
// ============================================================================

/**
 * Configuration for the KnexStore.
 */
const storeConfigSchema = z.object({
  /**
   * Whether to enable vector search using sqlite-vss.
   * If false or if vss is not available, falls back to in-memory cosine similarity.
   */
  enableVectorSearch: z.boolean().default(true),
  /**
   * Embedding dimensions (must match the embedding model).
   */
  embeddingDimensions: z.number().positive().default(1536),
});

type StoreConfig = z.infer<typeof storeConfigSchema>;

// ============================================================================
// Exports
// ============================================================================

export type { StoreValue, MemoryValue, EntityValue, StoreItemRow, EmbeddingIndexRow, StoreConfig };

export {
  storeValueSchema,
  memoryValueSchema,
  entityValueSchema,
  storeItemRowSchema,
  embeddingIndexRowSchema,
  storeConfigSchema,
};
