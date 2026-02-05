/**
 * Error thrown when an artifact is not found.
 */
class ArtifactNotFoundError extends Error {
  readonly artifactId: string;

  constructor(artifactId: string) {
    super(`Artifact not found: ${artifactId}`);
    this.name = 'ArtifactNotFoundError';
    this.artifactId = artifactId;
  }
}

/**
 * Error thrown when an artifact has expired.
 */
class ArtifactExpiredError extends Error {
  readonly artifactId: string;
  readonly expiredAt: string;

  constructor(artifactId: string, expiredAt: string) {
    super(`Artifact expired: ${artifactId} (expired at ${expiredAt})`);
    this.name = 'ArtifactExpiredError';
    this.artifactId = artifactId;
    this.expiredAt = expiredAt;
  }
}

/**
 * Error thrown when artifact data exceeds size limit.
 */
class ArtifactSizeLimitError extends Error {
  readonly sizeBytes: number;
  readonly maxBytes: number;

  constructor(sizeBytes: number, maxBytes: number) {
    super(`Artifact size ${sizeBytes} bytes exceeds limit of ${maxBytes} bytes`);
    this.name = 'ArtifactSizeLimitError';
    this.sizeBytes = sizeBytes;
    this.maxBytes = maxBytes;
  }
}

/**
 * Error thrown when conversation has too many artifacts.
 */
class ArtifactLimitExceededError extends Error {
  readonly conversationId: string;
  readonly limit: number;

  constructor(conversationId: string, limit: number) {
    super(`Conversation ${conversationId} has reached artifact limit of ${limit}`);
    this.name = 'ArtifactLimitExceededError';
    this.conversationId = conversationId;
    this.limit = limit;
  }
}

export { ArtifactNotFoundError, ArtifactExpiredError, ArtifactSizeLimitError, ArtifactLimitExceededError };
