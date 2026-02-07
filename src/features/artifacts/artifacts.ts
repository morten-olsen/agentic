import type { Knex } from 'knex';

import type { Services } from '../../core/services/services.ts';
import { DatabaseService } from '../../core/database/database.ts';

import type {
  Artifact,
  ArtifactMeta,
  ArtifactMimeType,
  CreateArtifactInput,
  CreateArtifactResult,
} from './artifacts.schemas.ts';
import {
  createArtifact,
  getArtifact,
  getArtifactMeta,
  deleteArtifact,
  getArtifactsByConversation,
  getArtifactMetaByConversation,
  getArtifactsByMessage,
  getArtifactsByType,
  deleteExpiredArtifacts,
  deleteArtifactsByConversation,
  touchArtifact,
  countArtifactsByConversation,
  getTotalArtifactSize,
} from './artifacts.store.ts';
import { ArtifactNotFoundError, ArtifactSizeLimitError, ArtifactLimitExceededError } from './artifacts.errors.ts';

// ============================================================================
// Configuration
// ============================================================================

type ArtifactServiceConfig = {
  /** Maximum size of a single artifact in bytes (default: 10MB) */
  maxArtifactSizeBytes?: number;
  /** Maximum number of artifacts per conversation (default: 50) */
  maxArtifactsPerConversation?: number;
  /** Default TTL in minutes (default: 60) */
  defaultTtlMinutes?: number;
  /** Maximum TTL in minutes (default: 1440 = 24 hours) */
  maxTtlMinutes?: number;
  /** Cleanup interval in milliseconds (default: 300000 = 5 minutes) */
  cleanupIntervalMs?: number;
};

const DEFAULT_CONFIG: Required<ArtifactServiceConfig> = {
  maxArtifactSizeBytes: 10 * 1024 * 1024, // 10MB
  maxArtifactsPerConversation: 50,
  defaultTtlMinutes: 60,
  maxTtlMinutes: 1440, // 24 hours
  cleanupIntervalMs: 300000, // 5 minutes
};

// ============================================================================
// ArtifactService
// ============================================================================

/**
 * ArtifactService - manages artifact storage and retrieval.
 */
class ArtifactService {
  #services: Services;
  #config: Required<ArtifactServiceConfig>;
  #cleanupInterval: NodeJS.Timeout | null = null;

  constructor(services: Services, config: ArtifactServiceConfig = {}) {
    this.#services = services;
    this.#config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Gets the Knex database instance.
   */
  get #db(): Knex {
    return this.#services.get(DatabaseService).knex;
  }

  /**
   * Gets the current configuration.
   */
  get config(): Required<ArtifactServiceConfig> {
    return { ...this.#config };
  }

  // ==========================================================================
  // Core Operations
  // ==========================================================================

  /**
   * Stores an artifact and returns its ID.
   */
  store = async (
    conversationId: string,
    messageId: string,
    type: string,
    data: unknown,
    options?: {
      mimeType?: ArtifactMimeType;
      ttlMinutes?: number;
      summaryProvided?: boolean;
    },
  ): Promise<CreateArtifactResult> => {
    // Check conversation artifact limit
    const count = await countArtifactsByConversation(this.#db, conversationId);
    if (count >= this.#config.maxArtifactsPerConversation) {
      throw new ArtifactLimitExceededError(conversationId, this.#config.maxArtifactsPerConversation);
    }

    // Calculate size and check limit
    const mimeType = options?.mimeType ?? 'application/json';
    const serialized = mimeType === 'application/json' ? JSON.stringify(data) : (data as string);
    const sizeBytes = Buffer.byteLength(serialized, 'utf8');

    if (sizeBytes > this.#config.maxArtifactSizeBytes) {
      throw new ArtifactSizeLimitError(sizeBytes, this.#config.maxArtifactSizeBytes);
    }

    // Clamp TTL to max
    let ttlMinutes = options?.ttlMinutes ?? this.#config.defaultTtlMinutes;
    if (ttlMinutes > this.#config.maxTtlMinutes) {
      ttlMinutes = this.#config.maxTtlMinutes;
    }

    const input: CreateArtifactInput = {
      conversationId,
      messageId,
      type,
      data,
      mimeType,
      ttlMinutes,
      summaryProvided: options?.summaryProvided ?? false,
    };

    const artifact = await createArtifact(this.#db, input);

    return {
      id: artifact.id,
      expiresAt: artifact.expiresAt,
    };
  };

  /**
   * Gets an artifact by ID.
   */
  get = async (id: string): Promise<Artifact | null> => {
    return getArtifact(this.#db, id);
  };

  /**
   * Gets an artifact by ID, throwing if not found.
   */
  getOrThrow = async (id: string): Promise<Artifact> => {
    const artifact = await this.get(id);
    if (!artifact) {
      throw new ArtifactNotFoundError(id);
    }
    return artifact;
  };

  /**
   * Gets artifact metadata (without data) by ID.
   */
  getMeta = async (id: string): Promise<ArtifactMeta | null> => {
    return getArtifactMeta(this.#db, id);
  };

  /**
   * Deletes an artifact by ID.
   */
  delete = async (id: string): Promise<boolean> => {
    return deleteArtifact(this.#db, id);
  };

  // ==========================================================================
  // Queries
  // ==========================================================================

  /**
   * Gets all artifacts for a conversation.
   */
  getByConversation = async (conversationId: string): Promise<Artifact[]> => {
    return getArtifactsByConversation(this.#db, conversationId);
  };

  /**
   * Gets artifact metadata (without data) for a conversation.
   */
  getMetaByConversation = async (conversationId: string): Promise<ArtifactMeta[]> => {
    return getArtifactMetaByConversation(this.#db, conversationId);
  };

  /**
   * Gets all artifacts for a message.
   */
  getByMessage = async (messageId: string): Promise<Artifact[]> => {
    return getArtifactsByMessage(this.#db, messageId);
  };

  /**
   * Gets artifacts by type, optionally filtered by conversation.
   */
  getByType = async (type: string, conversationId?: string): Promise<Artifact[]> => {
    return getArtifactsByType(this.#db, type, conversationId);
  };

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Deletes expired artifacts.
   */
  deleteExpired = async (): Promise<number> => {
    return deleteExpiredArtifacts(this.#db);
  };

  /**
   * Deletes all artifacts for a conversation.
   */
  deleteByConversation = async (conversationId: string): Promise<number> => {
    return deleteArtifactsByConversation(this.#db, conversationId);
  };

  /**
   * Updates the accessed_at timestamp for an artifact.
   */
  touch = async (id: string): Promise<boolean> => {
    return touchArtifact(this.#db, id);
  };

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Counts artifacts for a conversation.
   */
  countByConversation = async (conversationId: string): Promise<number> => {
    return countArtifactsByConversation(this.#db, conversationId);
  };

  /**
   * Gets total size of artifacts for a conversation.
   */
  getTotalSize = async (conversationId: string): Promise<number> => {
    return getTotalArtifactSize(this.#db, conversationId);
  };

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /**
   * Starts periodic cleanup of expired artifacts.
   */
  startCleanup = (): void => {
    if (this.#cleanupInterval) return;

    this.#cleanupInterval = setInterval(async () => {
      try {
        await this.deleteExpired();
      } catch {
        // Log error but don't crash
      }
    }, this.#config.cleanupIntervalMs);
  };

  /**
   * Stops periodic cleanup.
   */
  stopCleanup = (): void => {
    if (this.#cleanupInterval) {
      clearInterval(this.#cleanupInterval);
      this.#cleanupInterval = null;
    }
  };
}

export type { ArtifactServiceConfig };
export { ArtifactService, DEFAULT_CONFIG };
