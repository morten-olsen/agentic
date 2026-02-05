import { z } from 'zod';

// ============================================================================
// Embedding Provider Configuration
// ============================================================================

/**
 * Schema for embedding provider type.
 */
const embeddingProviderSchema = z.enum(['local', 'openai']);

type EmbeddingProvider = z.infer<typeof embeddingProviderSchema>;

/**
 * Schema for local embedding configuration.
 */
const localEmbeddingConfigSchema = z.object({
  provider: z.literal('local'),
  /**
   * HuggingFace model ID for local embeddings.
   * Default: Xenova/all-MiniLM-L6-v2 (384 dimensions, fast, good quality)
   */
  model: z.string().default('Xenova/all-MiniLM-L6-v2'),
  /**
   * Embedding dimensions (determined by the model).
   */
  dimensions: z.number().positive().default(384),
});

type LocalEmbeddingConfig = z.infer<typeof localEmbeddingConfigSchema>;

/**
 * Schema for OpenAI-compatible embedding configuration.
 */
const openaiEmbeddingConfigSchema = z.object({
  provider: z.literal('openai'),
  /**
   * Base URL for the OpenAI-compatible API.
   */
  baseUrl: z.string().url(),
  /**
   * API key for the embedding service.
   */
  apiKey: z.string().min(1),
  /**
   * Model identifier.
   */
  model: z.string().default('text-embedding-3-small'),
  /**
   * Embedding dimensions.
   */
  dimensions: z.number().positive().default(1536),
});

type OpenAIEmbeddingConfig = z.infer<typeof openaiEmbeddingConfigSchema>;

/**
 * Union schema for all embedding configurations.
 */
const embeddingConfigSchema = z.discriminatedUnion('provider', [
  localEmbeddingConfigSchema,
  openaiEmbeddingConfigSchema,
]);

type EmbeddingConfig = z.infer<typeof embeddingConfigSchema>;

// ============================================================================
// Exports
// ============================================================================

export type { EmbeddingProvider, LocalEmbeddingConfig, OpenAIEmbeddingConfig, EmbeddingConfig };

export {
  embeddingProviderSchema,
  localEmbeddingConfigSchema,
  openaiEmbeddingConfigSchema,
  embeddingConfigSchema,
};
