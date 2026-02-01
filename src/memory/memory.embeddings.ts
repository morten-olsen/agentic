import { OpenAIEmbeddings } from '@langchain/openai';

import type { MemoryConfig } from './memory.schemas.ts';

// ============================================================================
// Types
// ============================================================================

type EmbeddingServiceConfig = {
  model: string;
  dimensions: number;
  baseUrl: string;
  apiKey: string;
};

// ============================================================================
// Cosine Similarity
// ============================================================================

/**
 * Computes cosine similarity between two embedding vectors.
 * Returns a value between -1 and 1, where 1 means identical.
 */
const cosineSimilarity = (a: number[], b: number[]): number => {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    magA += ai * ai;
    magB += bi * bi;
  }

  const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
  if (magnitude === 0) {
    return 0;
  }

  return dot / magnitude;
};

// ============================================================================
// Embedding Service
// ============================================================================

/**
 * Service for generating text embeddings using an OpenAI-compatible API.
 */
class EmbeddingService {
  #embeddings: OpenAIEmbeddings;
  #dimensions: number;

  constructor(config: EmbeddingServiceConfig) {
    this.#dimensions = config.dimensions;
    this.#embeddings = new OpenAIEmbeddings({
      model: config.model,
      configuration: {
        baseURL: config.baseUrl,
      },
      openAIApiKey: config.apiKey,
      dimensions: config.dimensions,
    });
  }

  /**
   * Generates an embedding for a single text.
   */
  generateEmbedding = async (text: string): Promise<number[]> => {
    const embeddings = await this.#embeddings.embedDocuments([text]);
    return embeddings[0] ?? [];
  };

  /**
   * Generates embeddings for multiple texts.
   */
  generateEmbeddings = async (texts: string[]): Promise<number[][]> => {
    return this.#embeddings.embedDocuments(texts);
  };

  /**
   * Generates an embedding for a query (may use different model endpoint).
   */
  generateQueryEmbedding = async (query: string): Promise<number[]> => {
    return this.#embeddings.embedQuery(query);
  };

  /**
   * Gets the embedding dimensions.
   */
  get dimensions(): number {
    return this.#dimensions;
  }
}

/**
 * Creates an EmbeddingService from memory config and LLM credentials.
 */
const createEmbeddingService = (
  memoryConfig: MemoryConfig,
  llmConfig: { baseUrl: string; apiKey: string },
): EmbeddingService => {
  return new EmbeddingService({
    model: memoryConfig.embeddingModel,
    dimensions: memoryConfig.embeddingDimensions,
    baseUrl: llmConfig.baseUrl,
    apiKey: llmConfig.apiKey,
  });
};

export type { EmbeddingServiceConfig };
export { EmbeddingService, createEmbeddingService, cosineSimilarity };
