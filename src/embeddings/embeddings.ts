import type { Embeddings } from '@langchain/core/embeddings';

import type { EmbeddingConfig, LocalEmbeddingConfig, OpenAIEmbeddingConfig } from './embeddings.schemas.ts';
import { embeddingConfigSchema } from './embeddings.schemas.ts';

// ============================================================================
// Errors
// ============================================================================

class EmbeddingInitializationError extends Error {
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'EmbeddingInitializationError';
    this.cause = cause;
  }
}

class EmbeddingGenerationError extends Error {
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'EmbeddingGenerationError';
    this.cause = cause;
  }
}

// ============================================================================
// Local Embeddings (HuggingFace Transformers)
// ============================================================================

/**
 * Local embeddings using @huggingface/transformers.
 * Runs models locally without requiring an API key.
 */
class LocalEmbeddings implements Embeddings {
  #config: LocalEmbeddingConfig;
  #pipeline: unknown | null = null;
  #initPromise: Promise<void> | null = null;

  constructor(config: LocalEmbeddingConfig) {
    this.#config = config;
  }

  /**
   * Lazily initializes the pipeline on first use.
   */
  async #ensureInitialized(): Promise<void> {
    if (this.#pipeline) return;

    if (this.#initPromise) {
      await this.#initPromise;
      return;
    }

    this.#initPromise = this.#initialize();
    await this.#initPromise;
  }

  async #initialize(): Promise<void> {
    try {
      // Dynamic import to avoid loading the heavy library at startup
      const { pipeline } = await import('@huggingface/transformers');

      this.#pipeline = await pipeline('feature-extraction', this.#config.model, {
        dtype: 'fp32', // Use fp32 for better compatibility
      });
    } catch (error) {
      throw new EmbeddingInitializationError(
        `Failed to initialize local embedding model: ${this.#config.model}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Embeds a list of documents.
   */
  async embedDocuments(texts: string[]): Promise<number[][]> {
    await this.#ensureInitialized();

    const results: number[][] = [];

    for (const text of texts) {
      try {
        // The pipeline returns a Tensor, we need to extract the values
        const output = await (this.#pipeline as (text: string, options: object) => Promise<{ data: Float32Array }>)(
          text,
          { pooling: 'mean', normalize: true },
        );

        // Convert to regular array
        results.push(Array.from(output.data));
      } catch (error) {
        throw new EmbeddingGenerationError(
          `Failed to generate embedding for text`,
          error instanceof Error ? error : undefined,
        );
      }
    }

    return results;
  }

  /**
   * Embeds a single query.
   */
  async embedQuery(text: string): Promise<number[]> {
    const results = await this.embedDocuments([text]);
    const result = results[0];
    if (!result) {
      throw new EmbeddingGenerationError('No embedding result returned');
    }
    return result;
  }

  /**
   * Gets the embedding dimensions.
   */
  get dimensions(): number {
    return this.#config.dimensions;
  }
}

// ============================================================================
// OpenAI-Compatible Embeddings
// ============================================================================

/**
 * OpenAI-compatible embeddings using the OpenAI API format.
 * Works with OpenAI, OpenRouter, and other compatible providers.
 */
class OpenAICompatibleEmbeddings implements Embeddings {
  #config: OpenAIEmbeddingConfig;

  constructor(config: OpenAIEmbeddingConfig) {
    this.#config = config;
  }

  /**
   * Embeds a list of documents.
   */
  async embedDocuments(texts: string[]): Promise<number[][]> {
    try {
      const response = await fetch(`${this.#config.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.#config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.#config.model,
          input: texts,
          dimensions: this.#config.dimensions,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new EmbeddingGenerationError(`API error: ${response.status} ${error}`);
      }

      const data = (await response.json()) as {
        data: { embedding: number[]; index: number }[];
      };

      // Sort by index to maintain order
      const sorted = data.data.sort((a, b) => a.index - b.index);
      return sorted.map((item) => item.embedding);
    } catch (error) {
      if (error instanceof EmbeddingGenerationError) throw error;
      throw new EmbeddingGenerationError(
        'Failed to generate embeddings via API',
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Embeds a single query.
   */
  async embedQuery(text: string): Promise<number[]> {
    const results = await this.embedDocuments([text]);
    const result = results[0];
    if (!result) {
      throw new EmbeddingGenerationError('No embedding result returned');
    }
    return result;
  }

  /**
   * Gets the embedding dimensions.
   */
  get dimensions(): number {
    return this.#config.dimensions;
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates an embedding service based on configuration.
 */
const createEmbeddingService = (config: EmbeddingConfig): Embeddings & { dimensions: number } => {
  const validated = embeddingConfigSchema.parse(config);

  if (validated.provider === 'local') {
    return new LocalEmbeddings(validated);
  } else {
    return new OpenAICompatibleEmbeddings(validated);
  }
};

/**
 * Creates a default local embedding service.
 * Uses Xenova/all-MiniLM-L6-v2 which is fast and good quality.
 */
const createDefaultEmbeddingService = (): Embeddings & { dimensions: number } => {
  return new LocalEmbeddings({
    provider: 'local',
    model: 'Xenova/all-MiniLM-L6-v2',
    dimensions: 384,
  });
};

// ============================================================================
// Exports
// ============================================================================

export type { EmbeddingConfig };

export {
  LocalEmbeddings,
  OpenAICompatibleEmbeddings,
  createEmbeddingService,
  createDefaultEmbeddingService,
  EmbeddingInitializationError,
  EmbeddingGenerationError,
};

// Re-export schemas
export type { EmbeddingProvider, LocalEmbeddingConfig, OpenAIEmbeddingConfig } from './embeddings.schemas.ts';
export {
  embeddingProviderSchema,
  localEmbeddingConfigSchema,
  openaiEmbeddingConfigSchema,
  embeddingConfigSchema,
} from './embeddings.schemas.ts';
