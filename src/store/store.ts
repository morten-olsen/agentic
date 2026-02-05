import type { Knex } from 'knex';
import type { Embeddings } from '@langchain/core/embeddings';
import type Database from 'better-sqlite3';
import {
  BaseStore,
  type Item,
  type Operation,
  type GetOperation,
  type SearchOperation,
  type PutOperation,
  type ListNamespacesOperation,
  type OperationResults,
} from '@langchain/langgraph';
import type { SearchItem, IndexConfig } from '@langchain/langgraph-checkpoint';

import type { Services } from '../services/services.ts';
import { DatabaseService } from '../database/database.ts';
import { destroySymbol } from '../services/services.ts';

import type { StoreConfig, StoreItemRow } from './store.schemas.ts';
import { storeConfigSchema } from './store.schemas.ts';
import { InvalidNamespaceError, VectorSearchNotInitializedError } from './store.errors.ts';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Serializes a namespace array to JSON string for storage.
 */
const serializeNamespace = (namespace: string[]): string => {
  return JSON.stringify(namespace);
};

/**
 * Deserializes a namespace JSON string back to array.
 */
const deserializeNamespace = (namespace: string): string[] => {
  try {
    const parsed = JSON.parse(namespace);
    if (!Array.isArray(parsed)) {
      throw new InvalidNamespaceError(`Invalid namespace format: ${namespace}`);
    }
    return parsed as string[];
  } catch (error) {
    if (error instanceof InvalidNamespaceError) throw error;
    throw new InvalidNamespaceError(`Failed to parse namespace: ${namespace}`);
  }
};

/**
 * Converts a database row to an Item.
 */
const rowToItem = (row: StoreItemRow): Item => {
  return {
    namespace: deserializeNamespace(row.namespace),
    key: row.key,
    value: JSON.parse(row.value) as Record<string, unknown>,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
};

/**
 * Computes cosine similarity between two embedding vectors.
 * Returns a value between -1 and 1, where 1 means identical.
 * Kept for utility/testing purposes.
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

/**
 * Serializes an embedding array to a JSON string for storage.
 */
const serializeEmbedding = (embedding: number[]): string => {
  return JSON.stringify(embedding);
};

/**
 * Deserializes an embedding JSON string back to array.
 */
const deserializeEmbedding = (embedding: string): number[] => {
  return JSON.parse(embedding) as number[];
};

/**
 * Serializes an embedding to a Float32Array buffer for sqlite-vec.
 */
const embeddingToBuffer = (embedding: number[]): Buffer => {
  const float32Array = new Float32Array(embedding);
  return Buffer.from(float32Array.buffer);
};

/**
 * Checks if a namespace matches a prefix.
 */
const namespaceMatchesPrefix = (namespace: string[], prefix: string[]): boolean => {
  if (prefix.length > namespace.length) {
    return false;
  }
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] !== namespace[i]) {
      return false;
    }
  }
  return true;
};

/**
 * Checks if a namespace matches a suffix.
 */
const namespaceMatchesSuffix = (namespace: string[], suffix: string[]): boolean => {
  if (suffix.length > namespace.length) {
    return false;
  }
  const startIndex = namespace.length - suffix.length;
  for (let i = 0; i < suffix.length; i++) {
    if (suffix[i] !== namespace[startIndex + i]) {
      return false;
    }
  }
  return true;
};

/**
 * Checks if a value matches a filter.
 */
const matchesFilter = (value: Record<string, unknown>, filter: Record<string, unknown>): boolean => {
  for (const [key, filterValue] of Object.entries(filter)) {
    const itemValue = value[key];

    // Handle comparison operators
    if (filterValue !== null && typeof filterValue === 'object' && !Array.isArray(filterValue)) {
      const operators = filterValue as Record<string, unknown>;

      if ('$eq' in operators && itemValue !== operators.$eq) return false;
      if ('$ne' in operators && itemValue === operators.$ne) return false;
      if ('$gt' in operators) {
        if (typeof itemValue !== 'number' || typeof operators.$gt !== 'number') return false;
        if (itemValue <= operators.$gt) return false;
      }
      if ('$gte' in operators) {
        if (typeof itemValue !== 'number' || typeof operators.$gte !== 'number') return false;
        if (itemValue < operators.$gte) return false;
      }
      if ('$lt' in operators) {
        if (typeof itemValue !== 'number' || typeof operators.$lt !== 'number') return false;
        if (itemValue >= operators.$lt) return false;
      }
      if ('$lte' in operators) {
        if (typeof itemValue !== 'number' || typeof operators.$lte !== 'number') return false;
        if (itemValue > operators.$lte) return false;
      }
    } else {
      // Exact match
      if (itemValue !== filterValue) return false;
    }
  }
  return true;
};

// ============================================================================
// KnexStore
// ============================================================================

/**
 * LangGraph BaseStore implementation using Knex/SQLite with sqlite-vec.
 *
 * Features:
 * - Hierarchical namespaces stored as JSON arrays
 * - Key-value storage with metadata
 * - Vector similarity search using sqlite-vec
 * - Filtering and pagination
 */
class KnexStore extends BaseStore {
  #services: Services;
  #config: StoreConfig;
  #indexConfig: IndexConfig | null = null;
  #vectorSearchInitialized = false;

  constructor(services: Services, config?: Partial<StoreConfig>) {
    super();
    this.#services = services;
    this.#config = storeConfigSchema.parse(config ?? {});
  }

  /**
   * Gets the Knex instance from the database service.
   */
  #db = (): Knex => {
    return this.#services.get(DatabaseService).knex;
  };

  /**
   * Executes a function with a raw better-sqlite3 connection.
   * Acquires the connection, runs the function, and releases it.
   * Note: sqlite-vec extension is loaded by DatabaseService on connection creation.
   */
  #withRawConnection = async <T>(fn: (db: Database.Database) => T): Promise<T> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = this.#db().client as any;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    const connection = (await client.acquireConnection()) as Database.Database;

    try {
      return fn(connection);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      client.releaseConnection(connection);
    }
  };

  /**
   * Verifies that the vec_items table exists.
   * The table is created by migration 018_store_items.ts.
   * Note: sqlite-vec extension is already loaded by DatabaseService.
   */
  #verifyVectorSearchTable = async (): Promise<void> => {
    if (this.#vectorSearchInitialized) return;

    const tableExists = await this.#withRawConnection((db) => {
      return db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vec_items'")
        .get() as { name: string } | undefined;
    });

    if (!tableExists) {
      throw new VectorSearchNotInitializedError(
        'vec_items table not found. Run database migrations to create it.',
      );
    }

    this.#vectorSearchInitialized = true;
  };

  /**
   * Configures the embedding service for vector search.
   */
  configure = async (indexConfig: IndexConfig): Promise<void> => {
    this.#indexConfig = indexConfig;

    // Verify the vec_items table exists (created by migration)
    await this.#verifyVectorSearchTable();
  };

  /**
   * Gets the store configuration.
   */
  get config(): StoreConfig {
    return this.#config;
  }

  /**
   * Checks if the embedding service is configured.
   */
  get isConfigured(): boolean {
    return this.#indexConfig !== null && this.#vectorSearchInitialized;
  }

  /**
   * Gets the embeddings service if configured.
   */
  get embeddings(): Embeddings | null {
    return this.#indexConfig?.embeddings ?? null;
  }

  // ==========================================================================
  // BaseStore Implementation
  // ==========================================================================

  /**
   * Execute multiple operations in a single batch.
   */
  async batch<Op extends Operation[]>(operations: Op): Promise<OperationResults<Op>> {
    const results: unknown[] = [];

    for (const op of operations) {
      if ('key' in op && 'value' in op) {
        // PutOperation
        const putOp = op as PutOperation;
        await this.#executePut(putOp);
        results.push(undefined);
      } else if ('key' in op && !('value' in op) && !('namespacePrefix' in op)) {
        // GetOperation
        const getOp = op as GetOperation;
        const item = await this.#executeGet(getOp);
        results.push(item);
      } else if ('namespacePrefix' in op) {
        // SearchOperation
        const searchOp = op as SearchOperation;
        const items = await this.#executeSearch(searchOp);
        results.push(items);
      } else if ('matchConditions' in op || ('limit' in op && 'offset' in op && !('namespacePrefix' in op))) {
        // ListNamespacesOperation
        const listOp = op as ListNamespacesOperation;
        const namespaces = await this.#executeListNamespaces(listOp);
        results.push(namespaces);
      }
    }

    return results as OperationResults<Op>;
  }

  // ==========================================================================
  // Operation Implementations
  // ==========================================================================

  /**
   * Executes a GET operation.
   */
  async #executeGet(op: GetOperation): Promise<Item | null> {
    const namespace = serializeNamespace(op.namespace);

    const row = await this.#db()<StoreItemRow>('store_items').where({ namespace, key: op.key }).first();

    return row ? rowToItem(row) : null;
  }

  /**
   * Executes a PUT operation.
   */
  async #executePut(op: PutOperation): Promise<void> {
    const namespace = serializeNamespace(op.namespace);
    const now = new Date().toISOString();

    if (op.value === null) {
      // Delete operation
      await this.#db()('store_items').where({ namespace, key: op.key }).delete();

      // Also delete from embedding index
      await this.#db()('store_embedding_index').where({ namespace, key: op.key }).delete();

      // Delete from vec_items if vector search is initialized
      if (this.#vectorSearchInitialized) {
        const indexRow = await this.#db()('store_embedding_index').where({ namespace, key: op.key }).first();
        if (indexRow) {
          await this.#withRawConnection((db) => {
            db.prepare('DELETE FROM vec_items WHERE rowid = ?').run((indexRow as { rowid: number }).rowid);
          });
        }
      }
      return;
    }

    // Check if item exists
    const existing = await this.#db()<StoreItemRow>('store_items').where({ namespace, key: op.key }).first();

    if (existing) {
      // Update
      await this.#db()('store_items')
        .where({ namespace, key: op.key })
        .update({
          value: JSON.stringify(op.value),
          updated_at: now,
        });
    } else {
      // Insert
      await this.#db()('store_items').insert({
        namespace,
        key: op.key,
        value: JSON.stringify(op.value),
        created_at: now,
        updated_at: now,
      });
    }

    // Handle embedding indexing
    if (op.index !== false && this.#indexConfig) {
      await this.#updateEmbedding(namespace, op.key, op.value, op.index);
    }
  }

  /**
   * Executes a SEARCH operation.
   */
  async #executeSearch(op: SearchOperation): Promise<SearchItem[]> {
    const limit = op.limit ?? 10;
    const offset = op.offset ?? 0;

    // If we have a query and embeddings configured, do vector search
    if (op.query && this.#indexConfig && this.#vectorSearchInitialized) {
      return this.#searchWithVec(op.namespacePrefix, op.query, op.filter, limit, offset);
    }

    // Otherwise, do a regular search with filtering
    return this.#searchWithFilter(op.namespacePrefix, op.filter, limit, offset);
  }

  /**
   * Search using sqlite-vec for vector similarity.
   */
  async #searchWithVec(
    namespacePrefix: string[],
    query: string,
    filter?: Record<string, unknown>,
    limit = 10,
    offset = 0,
  ): Promise<SearchItem[]> {
    if (!this.#indexConfig) {
      throw new VectorSearchNotInitializedError();
    }

    // Generate query embedding
    const queryEmbedding = await this.#indexConfig.embeddings.embedQuery(query);
    const queryBuffer = embeddingToBuffer(queryEmbedding);

    // Query sqlite-vec for nearest neighbors
    // We get more results than needed to allow for filtering
    const searchLimit = (limit + offset) * 3;

    const vecResults = await this.#withRawConnection((db) => {
      return db
        .prepare(
          `
          SELECT
            rowid,
            distance
          FROM vec_items
          WHERE embedding MATCH ?
          ORDER BY distance
          LIMIT ?
        `,
        )
        .all(queryBuffer, searchLimit) as { rowid: number; distance: number }[];
    });

    if (vecResults.length === 0) {
      return [];
    }

    // Get the mapping from rowids to namespace/key
    const rowids = vecResults.map((r) => r.rowid);
    const indexRows = await this.#db()('store_embedding_index').whereIn('rowid', rowids).select('rowid', 'namespace', 'key');

    // Create a map for quick lookup
    const rowidToIndex = new Map<number, { namespace: string; key: string }>();
    for (const row of indexRows as { rowid: number; namespace: string; key: string }[]) {
      rowidToIndex.set(row.rowid, { namespace: row.namespace, key: row.key });
    }

    // Get the full items and apply filters
    const results: SearchItem[] = [];

    for (const vecResult of vecResults) {
      const indexRow = rowidToIndex.get(vecResult.rowid);
      if (!indexRow) continue;

      // Check namespace prefix
      const namespace = deserializeNamespace(indexRow.namespace);
      if (!namespaceMatchesPrefix(namespace, namespacePrefix)) {
        continue;
      }

      // Get the full item
      const itemRow = await this.#db()<StoreItemRow>('store_items')
        .where({ namespace: indexRow.namespace, key: indexRow.key })
        .first();

      if (!itemRow) continue;

      const item = rowToItem(itemRow);

      // Apply filter
      if (filter && !matchesFilter(item.value, filter)) {
        continue;
      }

      // Convert distance to similarity score (sqlite-vec uses L2 distance)
      // For normalized vectors, similarity ≈ 1 - (distance² / 2)
      const score = 1 - (vecResult.distance * vecResult.distance) / 2;

      results.push({
        ...item,
        score,
      });

      // Stop if we have enough results after offset
      if (results.length >= limit + offset) {
        break;
      }
    }

    // Apply offset and limit
    return results.slice(offset, offset + limit);
  }

  /**
   * Search with filter only (no vector search).
   */
  async #searchWithFilter(
    namespacePrefix: string[],
    filter?: Record<string, unknown>,
    limit = 10,
    offset = 0,
  ): Promise<SearchItem[]> {
    const prefixJson = serializeNamespace(namespacePrefix);

    // Build query - need to handle empty prefix
    let query = this.#db()<StoreItemRow>('store_items');

    if (namespacePrefix.length === 0) {
      // Match everything
    } else {
      // Match items whose namespace starts with the prefix
      // Use LIKE for prefix matching on JSON arrays
      query = query.where('namespace', 'like', `${prefixJson.slice(0, -1)}%`);
    }

    query = query.orderBy('updated_at', 'desc');

    const rows = await query;

    // Filter by prefix properly and apply filter
    const items: SearchItem[] = [];

    for (const row of rows) {
      const item = rowToItem(row);
      if (!namespaceMatchesPrefix(item.namespace, namespacePrefix)) {
        continue;
      }

      // Apply filter
      if (filter && !matchesFilter(item.value, filter)) {
        continue;
      }

      items.push(item);
    }

    // Apply offset and limit
    return items.slice(offset, offset + limit);
  }

  /**
   * Executes a LIST_NAMESPACES operation.
   */
  async #executeListNamespaces(op: ListNamespacesOperation): Promise<string[][]> {
    const rows = await this.#db()<StoreItemRow>('store_items').distinct('namespace').orderBy('namespace');

    const allNamespaces = rows.map((row) => deserializeNamespace(row.namespace));

    // Apply match conditions
    let filtered = allNamespaces;

    if (op.matchConditions) {
      for (const condition of op.matchConditions) {
        if (condition.matchType === 'prefix') {
          const prefix = condition.path.filter((p) => p !== '*');
          filtered = filtered.filter((ns) => namespaceMatchesPrefix(ns, prefix));
        } else if (condition.matchType === 'suffix') {
          const suffix = condition.path.filter((p) => p !== '*');
          filtered = filtered.filter((ns) => namespaceMatchesSuffix(ns, suffix));
        }
      }
    }

    // Apply max depth
    if (op.maxDepth !== undefined) {
      const maxDepth = op.maxDepth;
      filtered = filtered.filter((ns) => ns.length <= maxDepth);
    }

    // Apply offset and limit
    return filtered.slice(op.offset, op.offset + op.limit);
  }

  /**
   * Updates the embedding for an item using sqlite-vec.
   */
  async #updateEmbedding(
    namespace: string,
    key: string,
    value: Record<string, unknown>,
    indexFields?: string[],
  ): Promise<void> {
    if (!this.#indexConfig || !this.#vectorSearchInitialized) return;

    // Extract text to embed from the value
    let textToEmbed: string;

    if (indexFields && indexFields.length > 0) {
      // Extract specific fields
      const texts: string[] = [];
      for (const field of indexFields) {
        const fieldValue = this.#getNestedValue(value, field);
        if (typeof fieldValue === 'string') {
          texts.push(fieldValue);
        }
      }
      textToEmbed = texts.join(' ');
    } else {
      // Use default field or content
      const content = value['content'];
      if (typeof content === 'string') {
        textToEmbed = content;
      } else {
        textToEmbed = JSON.stringify(value);
      }
    }

    if (!textToEmbed.trim()) return;

    try {
      // Generate embedding
      const embeddings = await this.#indexConfig.embeddings.embedDocuments([textToEmbed]);
      const embedding = embeddings[0];
      if (!embedding) return;

      const embeddingBuffer = embeddingToBuffer(embedding);

      // Check if we already have an embedding for this item
      const existingIndex = await this.#db()('store_embedding_index').where({ namespace, key }).first();

      if (existingIndex) {
        // Update existing embedding in vec_items
        const rowid = (existingIndex as { rowid: number }).rowid;
        await this.#withRawConnection((db) => {
          db.prepare('UPDATE vec_items SET embedding = ? WHERE rowid = ?').run(embeddingBuffer, rowid);
        });
      } else {
        // Insert new embedding into vec_items
        const rowid = await this.#withRawConnection((db) => {
          const result = db.prepare('INSERT INTO vec_items(embedding) VALUES (?)').run(embeddingBuffer);
          return result.lastInsertRowid;
        });

        // Insert into embedding index
        await this.#db()('store_embedding_index').insert({
          rowid,
          namespace,
          key,
        });
      }

      // Also store embedding in the value for backwards compatibility
      const existingValue = await this.#db()<StoreItemRow>('store_items').where({ namespace, key }).first();

      if (existingValue) {
        const parsedValue = JSON.parse(existingValue.value) as Record<string, unknown>;
        parsedValue['embedding'] = embedding;

        await this.#db()('store_items')
          .where({ namespace, key })
          .update({
            value: JSON.stringify(parsedValue),
            updated_at: new Date().toISOString(),
          });
      }
    } catch (error) {
      // Log but don't fail the operation
      console.error('Failed to generate embedding:', error);
    }
  }

  /**
   * Gets a nested value from an object using dot notation.
   */
  #getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Start the store (no-op for this implementation).
   */
  start(): void {
    // No initialization needed
  }

  /**
   * Stop the store (no-op for this implementation).
   */
  stop(): void {
    // Cleanup handled by DatabaseService
  }

  /**
   * Destroys the store (for Services container).
   */
  [destroySymbol] = async (): Promise<void> => {
    this.stop();
  };
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates a KnexStore with custom config.
 */
const createKnexStore = (services: Services, config?: Partial<StoreConfig>): KnexStore => {
  return new KnexStore(services, config);
};

// ============================================================================
// Exports
// ============================================================================

export type { StoreConfig };

export {
  KnexStore,
  createKnexStore,
  serializeNamespace,
  deserializeNamespace,
  cosineSimilarity,
  serializeEmbedding,
  deserializeEmbedding,
  embeddingToBuffer,
  namespaceMatchesPrefix,
  namespaceMatchesSuffix,
  matchesFilter,
};

// Re-export LangGraph types for convenience
export type {
  Item,
  Operation,
  GetOperation,
  SearchOperation,
  PutOperation,
  ListNamespacesOperation,
  OperationResults,
} from '@langchain/langgraph';

export type { SearchItem, IndexConfig } from '@langchain/langgraph-checkpoint';
