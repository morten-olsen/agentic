/**
 * Error thrown when an invalid namespace is provided.
 */
class InvalidNamespaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidNamespaceError';
  }
}

/**
 * Error thrown when a store operation fails.
 */
class StoreOperationError extends Error {
  readonly cause?: Error;

  constructor(operation: string, message: string, cause?: Error) {
    super(`Store ${operation} failed: ${message}`);
    this.name = 'StoreOperationError';
    this.cause = cause;
  }
}

/**
 * Error thrown when sqlite-vec extension is not available.
 */
class VectorSearchUnavailableError extends Error {
  constructor() {
    super('Vector search is not available. sqlite-vec extension could not be loaded.');
    this.name = 'VectorSearchUnavailableError';
  }
}

/**
 * Error thrown when vector search is used before initialization.
 */
class VectorSearchNotInitializedError extends Error {
  constructor(message?: string) {
    super(message ?? 'Vector search is not initialized. Call configure() with an IndexConfig first.');
    this.name = 'VectorSearchNotInitializedError';
  }
}

export { InvalidNamespaceError, StoreOperationError, VectorSearchUnavailableError, VectorSearchNotInitializedError };
