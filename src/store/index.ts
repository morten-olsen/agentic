// Store module - LangGraph BaseStore implementation using Knex/SQLite

export type {
  StoreConfig,
  Item,
  Operation,
  GetOperation,
  SearchOperation,
  PutOperation,
  ListNamespacesOperation,
  OperationResults,
} from './store.ts';

export type { SearchItem, IndexConfig } from './store.ts';

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
} from './store.ts';

export type { StoreValue, MemoryValue, EntityValue, StoreItemRow, EmbeddingIndexRow } from './store.schemas.ts';

export {
  storeValueSchema,
  memoryValueSchema,
  entityValueSchema,
  storeItemRowSchema,
  embeddingIndexRowSchema,
  storeConfigSchema,
} from './store.schemas.ts';

export {
  InvalidNamespaceError,
  StoreOperationError,
  VectorSearchUnavailableError,
  VectorSearchNotInitializedError,
} from './store.errors.ts';
