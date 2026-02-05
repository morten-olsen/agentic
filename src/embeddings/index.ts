// Embeddings module - abstraction over embedding providers

export type {
  EmbeddingConfig,
  EmbeddingProvider,
  LocalEmbeddingConfig,
  OpenAIEmbeddingConfig,
} from './embeddings.ts';

export {
  LocalEmbeddings,
  OpenAICompatibleEmbeddings,
  createEmbeddingService,
  createDefaultEmbeddingService,
  EmbeddingInitializationError,
  EmbeddingGenerationError,
  embeddingProviderSchema,
  localEmbeddingConfigSchema,
  openaiEmbeddingConfigSchema,
  embeddingConfigSchema,
} from './embeddings.ts';
