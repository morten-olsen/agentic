import { describe, it, beforeEach, afterEach, expect } from 'vitest';

import { Services } from '../services/services.ts';
import { DatabaseService, createDatabaseService } from '../database/database.ts';

import { ArtifactService } from './artifacts.ts';
import {
  artifactMimeTypeSchema,
  artifactSchema,
  createArtifactInputSchema,
  createArtifactResultSchema,
} from './artifacts.schemas.ts';
import {
  ArtifactNotFoundError,
  ArtifactExpiredError,
  ArtifactSizeLimitError,
  ArtifactLimitExceededError,
} from './artifacts.errors.ts';
import {
  createArtifact,
  getArtifact,
  getArtifactMeta,
  deleteArtifact,
  getArtifactsByConversation,
  getArtifactsByMessage,
  deleteExpiredArtifacts,
  deleteArtifactsByConversation,
  touchArtifact,
  countArtifactsByConversation,
  getTotalArtifactSize,
} from './artifacts.store.ts';

// ============================================================================
// Test Setup
// ============================================================================

const createTestServices = async (): Promise<Services> => {
  const services = new Services();
  const db = createDatabaseService(services, { path: ':memory:' });
  services.set(DatabaseService, db);
  await db.migrate();
  return services;
};

const createTestConversation = async (db: ReturnType<typeof createDatabaseService>['knex']): Promise<string> => {
  const now = new Date().toISOString();
  const conversationId = 'test-conv-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  await db('conversations').insert({
    id: conversationId,
    title: 'Test Conversation',
    started_at: now,
    last_activity_at: now,
    created_at: now,
    updated_at: now,
  });
  return conversationId;
};

// ============================================================================
// Schema Tests
// ============================================================================

describe('Artifact Schemas', () => {
  describe('artifactMimeTypeSchema', () => {
    it('accepts valid MIME types', () => {
      expect(artifactMimeTypeSchema.parse('application/json')).toBe('application/json');
      expect(artifactMimeTypeSchema.parse('application/pdf')).toBe('application/pdf');
      expect(artifactMimeTypeSchema.parse('image/png')).toBe('image/png');
      expect(artifactMimeTypeSchema.parse('image/jpeg')).toBe('image/jpeg');
      expect(artifactMimeTypeSchema.parse('text/csv')).toBe('text/csv');
      expect(artifactMimeTypeSchema.parse('text/plain')).toBe('text/plain');
    });

    it('rejects invalid MIME types', () => {
      expect(() => artifactMimeTypeSchema.parse('invalid')).toThrow();
      expect(() => artifactMimeTypeSchema.parse('text/html')).toThrow();
    });
  });

  describe('createArtifactInputSchema', () => {
    it('parses input with defaults', () => {
      const input = createArtifactInputSchema.parse({
        conversationId: 'conv-123',
        messageId: 'msg-123',
        type: 'test-artifact',
        data: { key: 'value' },
      });

      expect(input.conversationId).toBe('conv-123');
      expect(input.messageId).toBe('msg-123');
      expect(input.type).toBe('test-artifact');
      expect(input.data).toEqual({ key: 'value' });
      expect(input.mimeType).toBe('application/json');
      expect(input.ttlMinutes).toBe(60);
      expect(input.summaryProvided).toBe(false);
    });

    it('parses input with custom values', () => {
      const input = createArtifactInputSchema.parse({
        conversationId: 'conv-123',
        messageId: 'msg-123',
        type: 'test-artifact',
        data: 'base64data',
        mimeType: 'application/pdf',
        ttlMinutes: 120,
        summaryProvided: true,
      });

      expect(input.mimeType).toBe('application/pdf');
      expect(input.ttlMinutes).toBe(120);
      expect(input.summaryProvided).toBe(true);
    });
  });

  describe('createArtifactResultSchema', () => {
    it('parses result', () => {
      const result = createArtifactResultSchema.parse({
        id: 'art_123',
        expiresAt: '2024-01-01T01:00:00Z',
      });

      expect(result.id).toBe('art_123');
      expect(result.expiresAt).toBe('2024-01-01T01:00:00Z');
    });
  });

  describe('artifactSchema', () => {
    it('parses artifact', () => {
      const artifact = artifactSchema.parse({
        id: 'art_123',
        conversationId: 'conv-123',
        messageId: 'msg-123',
        type: 'test-artifact',
        mimeType: 'application/json',
        data: { key: 'value' },
        sizeBytes: 100,
        summaryProvided: true,
        ttlMinutes: 60,
        createdAt: '2024-01-01T00:00:00Z',
        expiresAt: '2024-01-01T01:00:00Z',
        accessedAt: '2024-01-01T00:00:00Z',
      });

      expect(artifact.id).toBe('art_123');
      expect(artifact.type).toBe('test-artifact');
    });
  });
});

// ============================================================================
// Store Tests
// ============================================================================

describe('Artifact Store', () => {
  let services: Services;
  let db: ReturnType<typeof createDatabaseService>['knex'];
  let conversationId: string;

  beforeEach(async () => {
    services = await createTestServices();
    db = services.get(DatabaseService).knex;
    conversationId = await createTestConversation(db);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('createArtifact', () => {
    it('creates an artifact with JSON data', async () => {
      const artifact = await createArtifact(db, {
        conversationId,
        messageId: 'msg-123',
        type: 'test-data',
        data: { routes: [{ name: 'Route 1' }] },
      });

      expect(artifact.id).toMatch(/^art_/);
      expect(artifact.conversationId).toBe(conversationId);
      expect(artifact.messageId).toBe('msg-123');
      expect(artifact.type).toBe('test-data');
      expect(artifact.mimeType).toBe('application/json');
      expect(artifact.data).toEqual({ routes: [{ name: 'Route 1' }] });
      expect(artifact.sizeBytes).toBeGreaterThan(0);
    });

    it('creates an artifact with binary data', async () => {
      const base64Data = Buffer.from('test binary data').toString('base64');
      const artifact = await createArtifact(db, {
        conversationId,
        messageId: 'msg-123',
        type: 'test-binary',
        data: base64Data,
        mimeType: 'application/pdf',
      });

      expect(artifact.mimeType).toBe('application/pdf');
      expect(artifact.data).toBe(base64Data);
    });

    it('sets expiration time based on TTL', async () => {
      const artifact = await createArtifact(db, {
        conversationId,
        messageId: 'msg-123',
        type: 'test-data',
        data: {},
        ttlMinutes: 30,
      });

      const created = new Date(artifact.createdAt).getTime();
      const expires = new Date(artifact.expiresAt).getTime();
      const expectedTtlMs = 30 * 60 * 1000;

      expect(expires - created).toBe(expectedTtlMs);
    });
  });

  describe('getArtifact', () => {
    it('retrieves an artifact by ID', async () => {
      const created = await createArtifact(db, {
        conversationId,
        messageId: 'msg-123',
        type: 'test-data',
        data: { key: 'value' },
      });

      const retrieved = await getArtifact(db, created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.data).toEqual({ key: 'value' });
    });

    it('returns null for non-existent artifact', async () => {
      const retrieved = await getArtifact(db, 'art_non-existent');
      expect(retrieved).toBeNull();
    });
  });

  describe('getArtifactMeta', () => {
    it('retrieves artifact metadata without data', async () => {
      const created = await createArtifact(db, {
        conversationId,
        messageId: 'msg-123',
        type: 'test-data',
        data: { key: 'value' },
      });

      const meta = await getArtifactMeta(db, created.id);

      expect(meta).not.toBeNull();
      expect(meta?.id).toBe(created.id);
      expect(meta?.type).toBe('test-data');
      // Meta should not have data property
      expect(meta && 'data' in meta).toBe(false);
    });
  });

  describe('deleteArtifact', () => {
    it('deletes an artifact', async () => {
      const created = await createArtifact(db, {
        conversationId,
        messageId: 'msg-123',
        type: 'test-data',
        data: {},
      });

      const deleted = await deleteArtifact(db, created.id);
      expect(deleted).toBe(true);

      const retrieved = await getArtifact(db, created.id);
      expect(retrieved).toBeNull();
    });

    it('returns false for non-existent artifact', async () => {
      const deleted = await deleteArtifact(db, 'art_non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('getArtifactsByConversation', () => {
    it('retrieves all artifacts for a conversation', async () => {
      await createArtifact(db, {
        conversationId,
        messageId: 'msg-1',
        type: 'type-1',
        data: { id: 1 },
      });

      await createArtifact(db, {
        conversationId,
        messageId: 'msg-2',
        type: 'type-2',
        data: { id: 2 },
      });

      const artifacts = await getArtifactsByConversation(db, conversationId);

      expect(artifacts).toHaveLength(2);
    });

    it('returns empty array for conversation with no artifacts', async () => {
      const artifacts = await getArtifactsByConversation(db, 'non-existent-conv');
      expect(artifacts).toEqual([]);
    });
  });

  describe('getArtifactsByMessage', () => {
    it('retrieves all artifacts for a message', async () => {
      const messageId = 'shared-msg-123';

      await createArtifact(db, {
        conversationId,
        messageId,
        type: 'type-1',
        data: { id: 1 },
      });

      await createArtifact(db, {
        conversationId,
        messageId,
        type: 'type-2',
        data: { id: 2 },
      });

      await createArtifact(db, {
        conversationId,
        messageId: 'different-msg',
        type: 'type-3',
        data: { id: 3 },
      });

      const artifacts = await getArtifactsByMessage(db, messageId);

      expect(artifacts).toHaveLength(2);
      expect(artifacts.every((a) => a.messageId === messageId)).toBe(true);
    });
  });

  describe('deleteExpiredArtifacts', () => {
    it('deletes expired artifacts', async () => {
      // Create an artifact with very short TTL (we'll manually expire it)
      const artifact = await createArtifact(db, {
        conversationId,
        messageId: 'msg-123',
        type: 'test-data',
        data: {},
        ttlMinutes: 1,
      });

      // Manually set expires_at to the past
      await db('artifacts').where({ id: artifact.id }).update({
        expires_at: '2020-01-01T00:00:00Z',
      });

      const deletedCount = await deleteExpiredArtifacts(db);
      expect(deletedCount).toBe(1);

      const retrieved = await getArtifact(db, artifact.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('deleteArtifactsByConversation', () => {
    it('deletes all artifacts for a conversation', async () => {
      await createArtifact(db, {
        conversationId,
        messageId: 'msg-1',
        type: 'type-1',
        data: {},
      });

      await createArtifact(db, {
        conversationId,
        messageId: 'msg-2',
        type: 'type-2',
        data: {},
      });

      const deletedCount = await deleteArtifactsByConversation(db, conversationId);
      expect(deletedCount).toBe(2);

      const artifacts = await getArtifactsByConversation(db, conversationId);
      expect(artifacts).toHaveLength(0);
    });
  });

  describe('touchArtifact', () => {
    it('updates accessedAt timestamp', async () => {
      const created = await createArtifact(db, {
        conversationId,
        messageId: 'msg-123',
        type: 'test-data',
        data: {},
      });

      const originalAccessedAt = created.accessedAt;

      // Wait a tiny bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      await touchArtifact(db, created.id);

      const retrieved = await getArtifact(db, created.id);
      expect(retrieved).not.toBeNull();
      expect(new Date(retrieved?.accessedAt ?? 0).getTime()).toBeGreaterThanOrEqual(
        new Date(originalAccessedAt).getTime(),
      );
    });
  });

  describe('countArtifactsByConversation', () => {
    it('counts artifacts for a conversation', async () => {
      await createArtifact(db, { conversationId, messageId: 'msg-1', type: 't', data: {} });
      await createArtifact(db, { conversationId, messageId: 'msg-2', type: 't', data: {} });

      const count = await countArtifactsByConversation(db, conversationId);
      expect(count).toBe(2);
    });
  });

  describe('getTotalArtifactSize', () => {
    it('returns total size of artifacts for a conversation', async () => {
      await createArtifact(db, {
        conversationId,
        messageId: 'msg-1',
        type: 't',
        data: { key: 'value1' },
      });

      await createArtifact(db, {
        conversationId,
        messageId: 'msg-2',
        type: 't',
        data: { key: 'value2' },
      });

      const totalSize = await getTotalArtifactSize(db, conversationId);
      expect(totalSize).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// ArtifactService Tests
// ============================================================================

describe('ArtifactService', () => {
  let services: Services;
  let artifactService: ArtifactService;
  let conversationId: string;

  beforeEach(async () => {
    services = await createTestServices();
    artifactService = new ArtifactService(services);
    services.set(ArtifactService, artifactService);
    const db = services.get(DatabaseService).knex;
    conversationId = await createTestConversation(db);
  });

  afterEach(async () => {
    artifactService.stopCleanup();
    await services.destroy();
  });

  describe('store', () => {
    it('stores an artifact and returns ID', async () => {
      const result = await artifactService.store(conversationId, 'msg-123', 'test-type', {
        routes: [{ name: 'Route 1' }],
      });

      expect(result.id).toMatch(/^art_/);
      expect(result.expiresAt).toBeDefined();
    });

    it('clamps TTL to max', async () => {
      const result = await artifactService.store(
        conversationId,
        'msg-123',
        'test-type',
        {},
        { ttlMinutes: 10000 }, // Way over max
      );

      const artifact = await artifactService.get(result.id);
      expect(artifact?.ttlMinutes).toBe(artifactService.config.maxTtlMinutes);
    });

    it('throws on size limit exceeded', async () => {
      const smallService = new ArtifactService(services, { maxArtifactSizeBytes: 10 });

      await expect(
        smallService.store(conversationId, 'msg-123', 'test-type', { largeData: 'a'.repeat(100) }),
      ).rejects.toThrow(ArtifactSizeLimitError);
    });

    it('throws on artifact limit exceeded', async () => {
      const limitedService = new ArtifactService(services, { maxArtifactsPerConversation: 2 });

      await limitedService.store(conversationId, 'msg-1', 't', {});
      await limitedService.store(conversationId, 'msg-2', 't', {});

      await expect(limitedService.store(conversationId, 'msg-3', 't', {})).rejects.toThrow(ArtifactLimitExceededError);
    });
  });

  describe('get', () => {
    it('retrieves an artifact', async () => {
      const result = await artifactService.store(conversationId, 'msg-123', 'test-type', {
        key: 'value',
      });

      const artifact = await artifactService.get(result.id);

      expect(artifact).not.toBeNull();
      expect(artifact?.data).toEqual({ key: 'value' });
    });

    it('returns null for non-existent artifact', async () => {
      const artifact = await artifactService.get('art_non-existent');
      expect(artifact).toBeNull();
    });
  });

  describe('getOrThrow', () => {
    it('retrieves an artifact', async () => {
      const result = await artifactService.store(conversationId, 'msg-123', 'test-type', {});

      const artifact = await artifactService.getOrThrow(result.id);
      expect(artifact.id).toBe(result.id);
    });

    it('throws for non-existent artifact', async () => {
      await expect(artifactService.getOrThrow('art_non-existent')).rejects.toThrow(ArtifactNotFoundError);
    });
  });

  describe('getMeta', () => {
    it('retrieves artifact metadata', async () => {
      const result = await artifactService.store(conversationId, 'msg-123', 'test-type', {
        key: 'value',
      });

      const meta = await artifactService.getMeta(result.id);

      expect(meta).not.toBeNull();
      expect(meta?.id).toBe(result.id);
      // Meta should not have data property
      expect(meta && 'data' in meta).toBe(false);
    });
  });

  describe('delete', () => {
    it('deletes an artifact', async () => {
      const result = await artifactService.store(conversationId, 'msg-123', 'test-type', {});

      const deleted = await artifactService.delete(result.id);
      expect(deleted).toBe(true);

      const artifact = await artifactService.get(result.id);
      expect(artifact).toBeNull();
    });
  });

  describe('getByConversation', () => {
    it('retrieves all artifacts for a conversation', async () => {
      await artifactService.store(conversationId, 'msg-1', 't1', {});
      await artifactService.store(conversationId, 'msg-2', 't2', {});

      const artifacts = await artifactService.getByConversation(conversationId);
      expect(artifacts).toHaveLength(2);
    });
  });

  describe('getByMessage', () => {
    it('retrieves artifacts by message ID', async () => {
      await artifactService.store(conversationId, 'msg-shared', 't1', {});
      await artifactService.store(conversationId, 'msg-shared', 't2', {});
      await artifactService.store(conversationId, 'msg-other', 't3', {});

      const artifacts = await artifactService.getByMessage('msg-shared');
      expect(artifacts).toHaveLength(2);
    });
  });

  describe('getByType', () => {
    it('retrieves artifacts by type', async () => {
      await artifactService.store(conversationId, 'msg-1', 'route_optimization', {});
      await artifactService.store(conversationId, 'msg-2', 'route_optimization', {});
      await artifactService.store(conversationId, 'msg-3', 'data_analysis', {});

      const artifacts = await artifactService.getByType('route_optimization');
      expect(artifacts).toHaveLength(2);
    });

    it('filters by conversation when provided', async () => {
      const db = services.get(DatabaseService).knex;
      const otherConvId = await createTestConversation(db);

      await artifactService.store(conversationId, 'msg-1', 'test-type', {});
      await artifactService.store(otherConvId, 'msg-2', 'test-type', {});

      const artifacts = await artifactService.getByType('test-type', conversationId);
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0].conversationId).toBe(conversationId);
    });
  });

  describe('deleteExpired', () => {
    it('deletes expired artifacts', async () => {
      const db = services.get(DatabaseService).knex;

      const result = await artifactService.store(conversationId, 'msg-123', 'test-type', {});

      // Manually expire the artifact
      await db('artifacts').where({ id: result.id }).update({
        expires_at: '2020-01-01T00:00:00Z',
      });

      const count = await artifactService.deleteExpired();
      expect(count).toBe(1);
    });
  });

  describe('deleteByConversation', () => {
    it('deletes all artifacts for a conversation', async () => {
      await artifactService.store(conversationId, 'msg-1', 't', {});
      await artifactService.store(conversationId, 'msg-2', 't', {});

      const count = await artifactService.deleteByConversation(conversationId);
      expect(count).toBe(2);
    });
  });

  describe('touch', () => {
    it('updates accessedAt', async () => {
      const result = await artifactService.store(conversationId, 'msg-123', 'test-type', {});

      const success = await artifactService.touch(result.id);
      expect(success).toBe(true);
    });
  });

  describe('countByConversation', () => {
    it('counts artifacts', async () => {
      await artifactService.store(conversationId, 'msg-1', 't', {});
      await artifactService.store(conversationId, 'msg-2', 't', {});

      const count = await artifactService.countByConversation(conversationId);
      expect(count).toBe(2);
    });
  });

  describe('getTotalSize', () => {
    it('returns total size', async () => {
      await artifactService.store(conversationId, 'msg-1', 't', { data: 'value' });
      await artifactService.store(conversationId, 'msg-2', 't', { data: 'value' });

      const size = await artifactService.getTotalSize(conversationId);
      expect(size).toBeGreaterThan(0);
    });
  });

  describe('cleanup', () => {
    it('starts and stops cleanup', () => {
      artifactService.startCleanup();
      // Calling again should be a no-op
      artifactService.startCleanup();

      artifactService.stopCleanup();
      // Calling again should be safe
      artifactService.stopCleanup();
    });
  });
});

// ============================================================================
// Error Tests
// ============================================================================

describe('Artifact Errors', () => {
  describe('ArtifactNotFoundError', () => {
    it('includes artifact ID in message', () => {
      const error = new ArtifactNotFoundError('art_123');
      expect(error.message).toContain('art_123');
      expect(error.artifactId).toBe('art_123');
      expect(error.name).toBe('ArtifactNotFoundError');
    });
  });

  describe('ArtifactExpiredError', () => {
    it('includes artifact ID and expiration in message', () => {
      const error = new ArtifactExpiredError('art_123', '2024-01-01T00:00:00Z');
      expect(error.message).toContain('art_123');
      expect(error.message).toContain('2024-01-01T00:00:00Z');
      expect(error.artifactId).toBe('art_123');
      expect(error.expiredAt).toBe('2024-01-01T00:00:00Z');
    });
  });

  describe('ArtifactSizeLimitError', () => {
    it('includes sizes in message', () => {
      const error = new ArtifactSizeLimitError(1000000, 500000);
      expect(error.message).toContain('1000000');
      expect(error.message).toContain('500000');
      expect(error.sizeBytes).toBe(1000000);
      expect(error.maxBytes).toBe(500000);
    });
  });

  describe('ArtifactLimitExceededError', () => {
    it('includes conversation ID and limit in message', () => {
      const error = new ArtifactLimitExceededError('conv-123', 50);
      expect(error.message).toContain('conv-123');
      expect(error.message).toContain('50');
      expect(error.conversationId).toBe('conv-123');
      expect(error.limit).toBe(50);
    });
  });
});
