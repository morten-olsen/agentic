import type { Services } from '../services/services.ts';
import { DatabaseService } from '../database/database.ts';

import type { MemoryEntry, MemoryType, CreateMemoryInput, RecallOptions, MemoryConfig } from './memory.schemas.ts';
import { memoryConfigSchema } from './memory.schemas.ts';
import {
  createMemory,
  getMemory,
  updateMemory,
  deleteMemory,
  listMemories,
  getMemoriesWithEmbeddings,
  updateAccess,
  getRecentTopics as getRecentTopicsFromStore,
  reinforceMemory,
} from './memory.store.ts';
import { EmbeddingService, cosineSimilarity } from './memory.embeddings.ts';

// ============================================================================
// Errors
// ============================================================================

class MemoryNotFoundError extends Error {
  constructor(id: string) {
    super(`Memory not found: ${id}`);
    this.name = 'MemoryNotFoundError';
  }
}

class EmbeddingServiceNotConfiguredError extends Error {
  constructor() {
    super('Embedding service not configured. Call configure() first.');
    this.name = 'EmbeddingServiceNotConfiguredError';
  }
}

// ============================================================================
// Memory Service
// ============================================================================

/**
 * Memory Service - provides long-term memory capabilities for the agent.
 *
 * Features:
 * - Store memories with automatic embedding generation
 * - Semantic search via cosine similarity
 * - Importance-based filtering
 * - Access tracking for reinforcement
 */
class MemoryService {
  #services: Services;
  #config: MemoryConfig;
  #embeddingService: EmbeddingService | null = null;

  constructor(services: Services, config?: Partial<MemoryConfig>) {
    this.#services = services;
    this.#config = memoryConfigSchema.parse(config ?? {});
  }

  /**
   * Gets the Knex instance from the database service.
   */
  #db = () => {
    return this.#services.get(DatabaseService).knex;
  };

  /**
   * Configures the embedding service with LLM credentials.
   */
  configure = (llmConfig: { baseUrl: string; apiKey: string }): void => {
    this.#embeddingService = new EmbeddingService({
      model: this.#config.embeddingModel,
      dimensions: this.#config.embeddingDimensions,
      baseUrl: llmConfig.baseUrl,
      apiKey: llmConfig.apiKey,
    });
  };

  /**
   * Checks if the embedding service is configured.
   */
  get isConfigured(): boolean {
    return this.#embeddingService !== null;
  }

  /**
   * Gets the memory configuration.
   */
  get config(): MemoryConfig {
    return this.#config;
  }

  /**
   * Stores a new memory with automatic embedding generation.
   */
  remember = async (input: CreateMemoryInput): Promise<MemoryEntry> => {
    let embedding: number[] | undefined;

    // Generate embedding if service is configured
    if (this.#embeddingService) {
      embedding = await this.#embeddingService.generateEmbedding(input.content);
    }

    return createMemory(this.#db(), input, embedding);
  };

  /**
   * Performs semantic search to recall relevant memories.
   */
  recall = async (query: string, options?: RecallOptions): Promise<MemoryEntry[]> => {
    const limit = options?.limit ?? this.#config.recallLimit;
    const minImportance = options?.minImportance ?? this.#config.minImportanceForRecall;

    // If embedding service is not configured, fall back to listing by recency
    if (!this.#embeddingService) {
      return listMemories(this.#db(), {
        ...options,
        limit,
        minImportance,
      });
    }

    // Generate query embedding
    const queryEmbedding = await this.#embeddingService.generateQueryEmbedding(query);

    // Get all memories with embeddings
    const memories = await getMemoriesWithEmbeddings(this.#db(), {
      ...options,
      minImportance,
    });

    // Calculate similarity scores
    const scored = memories
      .filter((m): m is MemoryEntry & { embedding: number[] } => Boolean(m.embedding && m.embedding.length > 0))
      .map((memory) => ({
        memory,
        score: cosineSimilarity(queryEmbedding, memory.embedding),
      }));

    // Sort by similarity (descending) and take top results
    scored.sort((a, b) => b.score - a.score);
    const topMemories = scored.slice(0, limit);

    // Update access for retrieved memories
    await Promise.all(topMemories.map((item) => updateAccess(this.#db(), item.memory.id)));

    return topMemories.map((item) => item.memory);
  };

  /**
   * Recalls memories by type without semantic search.
   */
  recallByType = async (type: MemoryType, limit?: number): Promise<MemoryEntry[]> => {
    return listMemories(this.#db(), {
      types: [type],
      limit: limit ?? this.#config.recallLimit,
    });
  };

  /**
   * Gets a specific memory by ID.
   */
  get = async (id: string): Promise<MemoryEntry | null> => {
    return getMemory(this.#db(), id);
  };

  /**
   * Reinforces a memory by increasing its importance.
   */
  reinforce = async (id: string): Promise<MemoryEntry> => {
    const memory = await reinforceMemory(this.#db(), id);
    if (!memory) {
      throw new MemoryNotFoundError(id);
    }
    return memory;
  };

  /**
   * Corrects a memory with new content.
   * Regenerates the embedding if the service is configured.
   */
  correct = async (id: string, newContent: string): Promise<MemoryEntry> => {
    const existing = await getMemory(this.#db(), id);
    if (!existing) {
      throw new MemoryNotFoundError(id);
    }

    let embedding: number[] | undefined;
    if (this.#embeddingService) {
      embedding = await this.#embeddingService.generateEmbedding(newContent);
    }

    const updated = await updateMemory(this.#db(), id, {
      content: newContent,
      embedding,
    });

    if (!updated) {
      throw new MemoryNotFoundError(id);
    }

    return updated;
  };

  /**
   * Deletes a memory.
   */
  forget = async (id: string): Promise<boolean> => {
    return deleteMemory(this.#db(), id);
  };

  /**
   * Gets recent topics for context building.
   */
  getRecentTopics = async (limit?: number): Promise<string[]> => {
    return getRecentTopicsFromStore(this.#db(), limit ?? 5);
  };

  /**
   * Lists memories with optional filtering.
   */
  list = async (options?: RecallOptions): Promise<MemoryEntry[]> => {
    return listMemories(this.#db(), options);
  };

  /**
   * Stores multiple memories at once.
   * More efficient when batch embedding is supported.
   */
  rememberBatch = async (inputs: CreateMemoryInput[]): Promise<MemoryEntry[]> => {
    if (inputs.length === 0) {
      return [];
    }

    let embeddings: number[][] | undefined;

    // Generate embeddings in batch if service is configured
    if (this.#embeddingService) {
      embeddings = await this.#embeddingService.generateEmbeddings(inputs.map((i) => i.content));
    }

    const memories: MemoryEntry[] = [];
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      if (input) {
        const memory = await createMemory(this.#db(), input, embeddings?.[i]);
        memories.push(memory);
      }
    }

    return memories;
  };
}

// Re-export types and schemas
export type {
  MemoryType,
  MemoryEntry,
  RecallOptions,
  CreateMemoryInput,
  UpdateMemoryInput,
  MemoryConfig,
  ConversationSummary,
} from './memory.schemas.ts';

export {
  memoryTypeSchema,
  memoryEntrySchema,
  recallOptionsSchema,
  createMemoryInputSchema,
  updateMemoryInputSchema,
  memoryConfigSchema,
  conversationSummarySchema,
} from './memory.schemas.ts';

export { MemoryService, MemoryNotFoundError, EmbeddingServiceNotConfiguredError };

// Export embedding utilities for testing
export { cosineSimilarity } from './memory.embeddings.ts';
export { EmbeddingService, createEmbeddingService } from './memory.embeddings.ts';
