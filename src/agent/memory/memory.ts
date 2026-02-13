import type { Embeddings } from '@langchain/core/embeddings';

import type { Services } from '../../core/services/services.ts';
import { KnexStore, cosineSimilarity } from '../../core/store/store.ts';
import type { Item, IndexConfig } from '../../core/store/store.ts';
import { createEmbeddingService } from '../../agent/embeddings/embeddings.ts';
import type { EmbeddingConfig } from '../../agent/embeddings/embeddings.ts';

import type { MemoryEntry, MemoryType, CreateMemoryInput, RecallOptions, MemoryConfig } from './memory.schemas.ts';
import { memoryConfigSchema, createMemoryInputSchema } from './memory.schemas.ts';

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
// Constants
// ============================================================================

/**
 * Namespace prefix for all memories.
 */
const MEMORIES_NAMESPACE = 'memories';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generates a unique ID for a memory.
 */
const generateId = (): string => crypto.randomUUID();

/**
 * Gets the current timestamp as ISO string.
 */
const now = (): string => new Date().toISOString();

/**
 * Converts a store Item to a MemoryEntry.
 */
const itemToMemory = (item: Item, type: MemoryType): MemoryEntry => {
  const value = item.value;
  return {
    id: item.key,
    type,
    content: value['content'] as string,
    embedding: value['embedding'] as number[] | undefined,
    metadata: (value['metadata'] as Record<string, unknown>) ?? {},
    importance: value['importance'] as number,
    createdAt: item.createdAt.toISOString(),
    lastAccessedAt: value['lastAccessedAt'] as string,
    accessCount: value['accessCount'] as number,
  };
};

/**
 * Converts a MemoryEntry to a store value.
 */
const memoryToValue = (memory: {
  content: string;
  metadata?: Record<string, unknown>;
  importance: number;
  lastAccessedAt: string;
  accessCount: number;
  embedding?: number[];
}): Record<string, unknown> => {
  return {
    content: memory.content,
    metadata: memory.metadata ?? {},
    importance: memory.importance,
    lastAccessedAt: memory.lastAccessedAt,
    accessCount: memory.accessCount,
    embedding: memory.embedding,
  };
};

// ============================================================================
// Memory Service
// ============================================================================

/**
 * Memory Service - provides long-term memory capabilities for the agent.
 *
 * This is a facade over KnexStore that provides a domain-specific API for memories.
 *
 * Features:
 * - Store memories with automatic embedding generation
 * - Semantic search via cosine similarity
 * - Importance-based filtering
 * - Access tracking for reinforcement
 */
class MemoryService {
  #config: MemoryConfig;
  #store: KnexStore;
  #embeddings: Embeddings | null = null;

  constructor(services: Services, config?: Partial<MemoryConfig>) {
    this.#config = memoryConfigSchema.parse(config ?? {});
    this.#store = services.get(KnexStore);
  }

  /**
   * Configures the embedding service.
   * @param embeddingConfig - Configuration for the embedding provider (local or openai)
   */
  configure = async (embeddingConfig: EmbeddingConfig): Promise<void> => {
    const embeddingService = createEmbeddingService(embeddingConfig);
    this.#embeddings = embeddingService;

    // Get dimensions from the config
    const dims = embeddingConfig.provider === 'local' ? embeddingConfig.dimensions : embeddingConfig.dimensions;

    // Configure the store's index
    const indexConfig: IndexConfig = {
      dims,
      embeddings: this.#embeddings,
      fields: ['content'],
    };
    await this.#store.configure(indexConfig);
  };

  /**
   * Checks if the embedding service is configured.
   */
  get isConfigured(): boolean {
    return this.#embeddings !== null;
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
    const validated = createMemoryInputSchema.parse(input);
    const id = generateId();
    const timestamp = now();

    let embedding: number[] | undefined;

    // Generate embedding if service is configured
    if (this.#embeddings) {
      const embeddings = await this.#embeddings.embedDocuments([validated.content]);
      embedding = embeddings[0];
    }

    const value = memoryToValue({
      content: validated.content,
      metadata: validated.metadata,
      importance: validated.importance ?? 0.5,
      lastAccessedAt: timestamp,
      accessCount: 0,
      embedding,
    });

    await this.#store.put([MEMORIES_NAMESPACE, validated.type], id, value);

    return {
      id,
      type: validated.type,
      content: validated.content,
      embedding,
      metadata: validated.metadata ?? {},
      importance: validated.importance ?? 0.5,
      createdAt: timestamp,
      lastAccessedAt: timestamp,
      accessCount: 0,
    };
  };

  /**
   * Performs semantic search to recall relevant memories.
   */
  recall = async (query: string, options?: RecallOptions): Promise<MemoryEntry[]> => {
    const limit = options?.limit ?? this.#config.recallLimit;
    const minImportance = options?.minImportance ?? this.#config.minImportanceForRecall;

    // If embedding service is not configured, fall back to listing by recency
    if (!this.#embeddings) {
      return this.list({
        ...options,
        limit,
        minImportance,
      });
    }

    // Generate query embedding
    const queryEmbedding = await this.#embeddings.embedQuery(query);

    // Get all memories with embeddings that match criteria
    const allMemories: MemoryEntry[] = [];

    // Get memories of requested types, or all types if not specified
    const types = options?.types ?? ['conversation', 'fact', 'preference', 'procedure', 'event', 'entity'];

    for (const type of types) {
      const items = await this.#store.search([MEMORIES_NAMESPACE, type], {
        limit: 1000, // Get all, we'll filter and limit later
      });

      for (const item of items) {
        const memory = itemToMemory(item, type as MemoryType);

        // Filter by importance
        if (memory.importance < minImportance) {
          continue;
        }

        // Filter by time range if specified
        if (options?.timeRange) {
          if (memory.createdAt < options.timeRange.start || memory.createdAt > options.timeRange.end) {
            continue;
          }
        }

        allMemories.push(memory);
      }
    }

    // Calculate similarity scores and filter
    const scored = allMemories
      .filter((m): m is MemoryEntry & { embedding: number[] } => Boolean(m.embedding && m.embedding.length > 0))
      .map((memory) => ({
        memory,
        score: cosineSimilarity(queryEmbedding, memory.embedding),
      }));

    // Sort by similarity (descending) and take top results
    scored.sort((a, b) => b.score - a.score);
    const topMemories = scored.slice(0, limit);

    // Update access for retrieved memories
    await Promise.all(topMemories.map((item) => this.#updateAccess(item.memory)));

    return topMemories.map((item) => item.memory);
  };

  /**
   * Recalls memories by type without semantic search.
   */
  recallByType = async (type: MemoryType, limit?: number): Promise<MemoryEntry[]> => {
    return this.list({
      types: [type],
      limit: limit ?? this.#config.recallLimit,
    });
  };

  /**
   * Gets a specific memory by ID.
   */
  get = async (id: string): Promise<MemoryEntry | null> => {
    // We need to search across all memory types to find by ID
    const types: MemoryType[] = ['conversation', 'fact', 'preference', 'procedure', 'event', 'entity'];

    for (const type of types) {
      const item = await this.#store.get([MEMORIES_NAMESPACE, type], id);
      if (item) {
        return itemToMemory(item, type);
      }
    }

    return null;
  };

  /**
   * Reinforces a memory by increasing its importance.
   */
  reinforce = async (id: string, boost = 0.1): Promise<MemoryEntry> => {
    const memory = await this.get(id);
    if (!memory) {
      throw new MemoryNotFoundError(id);
    }

    const newImportance = Math.min(1.0, memory.importance + boost);
    const timestamp = now();

    const value = memoryToValue({
      content: memory.content,
      metadata: memory.metadata,
      importance: newImportance,
      lastAccessedAt: timestamp,
      accessCount: memory.accessCount + 1,
      embedding: memory.embedding,
    });

    await this.#store.put([MEMORIES_NAMESPACE, memory.type], id, value);

    return {
      ...memory,
      importance: newImportance,
      lastAccessedAt: timestamp,
      accessCount: memory.accessCount + 1,
    };
  };

  /**
   * Corrects a memory with new content.
   * Regenerates the embedding if the service is configured.
   */
  correct = async (id: string, newContent: string): Promise<MemoryEntry> => {
    const existing = await this.get(id);
    if (!existing) {
      throw new MemoryNotFoundError(id);
    }

    let embedding: number[] | undefined;
    if (this.#embeddings) {
      const embeddings = await this.#embeddings.embedDocuments([newContent]);
      embedding = embeddings[0];
    }

    const timestamp = now();
    const value = memoryToValue({
      content: newContent,
      metadata: existing.metadata,
      importance: existing.importance,
      lastAccessedAt: timestamp,
      accessCount: existing.accessCount,
      embedding,
    });

    await this.#store.put([MEMORIES_NAMESPACE, existing.type], id, value);

    return {
      ...existing,
      content: newContent,
      embedding,
      lastAccessedAt: timestamp,
    };
  };

  /**
   * Deletes a memory.
   */
  forget = async (id: string): Promise<boolean> => {
    const memory = await this.get(id);
    if (!memory) {
      return false;
    }

    await this.#store.delete([MEMORIES_NAMESPACE, memory.type], id);
    return true;
  };

  /**
   * Gets recent topics for context building.
   */
  getRecentTopics = async (limit = 5): Promise<string[]> => {
    const types: MemoryType[] = ['conversation', 'fact'];
    const topics: string[] = [];

    for (const type of types) {
      const items = await this.#store.search([MEMORIES_NAMESPACE, type], {
        limit,
      });

      for (const item of items) {
        topics.push(item.value['content'] as string);
      }
    }

    // Sort by recency (items are already sorted by updated_at desc from store)
    return topics.slice(0, limit);
  };

  /**
   * Lists memories with optional filtering.
   */
  list = async (options?: RecallOptions): Promise<MemoryEntry[]> => {
    const types = options?.types ?? ['conversation', 'fact', 'preference', 'procedure', 'event', 'entity'];
    const limit = options?.limit ?? this.#config.recallLimit;
    const minImportance = options?.minImportance ?? 0;

    const allMemories: MemoryEntry[] = [];

    for (const type of types) {
      const items = await this.#store.search([MEMORIES_NAMESPACE, type], {
        limit: 1000, // Get more than needed, filter later
      });

      for (const item of items) {
        const memory = itemToMemory(item, type as MemoryType);

        // Filter by importance
        if (memory.importance < minImportance) {
          continue;
        }

        // Filter by time range if specified
        if (options?.timeRange) {
          if (memory.createdAt < options.timeRange.start || memory.createdAt > options.timeRange.end) {
            continue;
          }
        }

        allMemories.push(memory);
      }
    }

    // Sort by lastAccessedAt descending
    allMemories.sort((a, b) => new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime());

    return allMemories.slice(0, limit);
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
    if (this.#embeddings) {
      embeddings = await this.#embeddings.embedDocuments(inputs.map((i) => i.content));
    }

    const memories: MemoryEntry[] = [];
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      if (input) {
        const validated = createMemoryInputSchema.parse(input);
        const id = generateId();
        const timestamp = now();
        const embedding = embeddings?.[i];

        const value = memoryToValue({
          content: validated.content,
          metadata: validated.metadata,
          importance: validated.importance ?? 0.5,
          lastAccessedAt: timestamp,
          accessCount: 0,
          embedding,
        });

        await this.#store.put([MEMORIES_NAMESPACE, validated.type], id, value);

        memories.push({
          id,
          type: validated.type,
          content: validated.content,
          embedding,
          metadata: validated.metadata ?? {},
          importance: validated.importance ?? 0.5,
          createdAt: timestamp,
          lastAccessedAt: timestamp,
          accessCount: 0,
        });
      }
    }

    return memories;
  };

  /**
   * Updates access timestamp and count for a memory.
   */
  #updateAccess = async (memory: MemoryEntry): Promise<void> => {
    const timestamp = now();
    const value = memoryToValue({
      content: memory.content,
      metadata: memory.metadata,
      importance: memory.importance,
      lastAccessedAt: timestamp,
      accessCount: memory.accessCount + 1,
      embedding: memory.embedding,
    });

    await this.#store.put([MEMORIES_NAMESPACE, memory.type], memory.id, value);
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
export { cosineSimilarity } from '../../core/store/store.ts';
export { EmbeddingService, createEmbeddingService } from './memory.embeddings.ts';
