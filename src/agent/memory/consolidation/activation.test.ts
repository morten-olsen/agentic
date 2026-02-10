import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Knex } from 'knex';

import { Services } from '../../../core/services/services.ts';
import { createDatabaseService, DatabaseService } from '../../../core/database/database.ts';
import type { Logger } from '../../../core/logging/logging.ts';

import { ActivationService } from './activation.service.ts';
import { ActivationStore } from './activation.store.ts';

// ============================================================================
// Mock Logger
// ============================================================================

const createMockLogger = (): Logger => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
});

// ============================================================================
// Test Setup
// ============================================================================

const createTestDb = async (): Promise<{ db: Knex; services: Services; cleanup: () => Promise<void> }> => {
  const services = new Services();
  const dbService = createDatabaseService(services, { path: ':memory:' });
  services.set(DatabaseService, dbService);
  await dbService.migrate();
  const db = dbService.knex;

  return {
    db,
    services,
    cleanup: async () => {
      await services.destroy();
    },
  };
};

// ============================================================================
// ActivationStore Tests
// ============================================================================

describe('ActivationStore', () => {
  let db: Knex;
  let store: ActivationStore;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = await createTestDb();
    db = setup.db;
    cleanup = setup.cleanup;
    store = new ActivationStore(db);
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('create', () => {
    it('should create activation record with default values', async () => {
      const activation = await store.create('mem-1');

      expect(activation.memoryId).toBe('mem-1');
      expect(activation.activationScore).toBe(0.5);
      expect(activation.decayRate).toBe(0.02);
      expect(activation.boostHistory).toEqual([]);
      expect(activation.createdAt).toBeDefined();
      expect(activation.updatedAt).toBeDefined();
    });

    it('should create activation record with custom values', async () => {
      const activation = await store.create('mem-2', 0.8, 0.05);

      expect(activation.memoryId).toBe('mem-2');
      expect(activation.activationScore).toBe(0.8);
      expect(activation.decayRate).toBe(0.05);
    });
  });

  describe('get', () => {
    it('should return null for non-existent memory', async () => {
      const result = await store.get('non-existent');
      expect(result).toBeNull();
    });

    it('should return activation record for existing memory', async () => {
      await store.create('mem-1', 0.7);

      const result = await store.get('mem-1');
      expect(result).not.toBeNull();
      expect(result?.activationScore).toBe(0.7);
    });
  });

  describe('update', () => {
    it('should update activation score', async () => {
      await store.create('mem-1', 0.5);

      const updated = await store.update('mem-1', { activationScore: 0.8 });

      expect(updated?.activationScore).toBe(0.8);
    });

    it('should update boost history', async () => {
      await store.create('mem-1');

      const boostHistory = [{ timestamp: new Date().toISOString(), reason: 'user_mention' as const, boostAmount: 0.4 }];
      const updated = await store.update('mem-1', { boostHistory });

      expect(updated?.boostHistory).toHaveLength(1);
      expect(updated?.boostHistory[0]?.reason).toBe('user_mention');
    });

    it('should return null for non-existent memory', async () => {
      const result = await store.update('non-existent', { activationScore: 0.8 });
      expect(result).toBeNull();
    });
  });

  describe('ensure', () => {
    it('should create if not exists', async () => {
      const activation = await store.ensure('mem-1', 0.6);

      expect(activation.memoryId).toBe('mem-1');
      expect(activation.activationScore).toBe(0.6);
    });

    it('should return existing if exists', async () => {
      await store.create('mem-1', 0.7);

      const activation = await store.ensure('mem-1', 0.6);

      expect(activation.activationScore).toBe(0.7); // Original value, not 0.6
    });
  });

  describe('getAboveThreshold', () => {
    it('should return memories above threshold', async () => {
      await store.create('mem-1', 0.3);
      await store.create('mem-2', 0.6);
      await store.create('mem-3', 0.8);

      const results = await store.getAboveThreshold(0.5);

      expect(results).toHaveLength(2);
      expect(results.map((r) => r.memoryId)).toContain('mem-2');
      expect(results.map((r) => r.memoryId)).toContain('mem-3');
    });

    it('should respect limit', async () => {
      await store.create('mem-1', 0.6);
      await store.create('mem-2', 0.7);
      await store.create('mem-3', 0.8);

      const results = await store.getAboveThreshold(0.5, 2);

      expect(results).toHaveLength(2);
      // Should be ordered by score descending
      expect(results[0]?.activationScore).toBe(0.8);
    });
  });

  describe('delete', () => {
    it('should delete existing record', async () => {
      await store.create('mem-1');

      const deleted = await store.delete('mem-1');
      expect(deleted).toBe(true);

      const result = await store.get('mem-1');
      expect(result).toBeNull();
    });

    it('should return false for non-existent', async () => {
      const deleted = await store.delete('non-existent');
      expect(deleted).toBe(false);
    });
  });
});

// ============================================================================
// ActivationService Tests
// ============================================================================

describe('ActivationService', () => {
  let db: Knex;
  let service: ActivationService;
  let cleanup: () => Promise<void>;
  const logger = createMockLogger();

  beforeEach(async () => {
    const setup = await createTestDb();
    db = setup.db;
    cleanup = setup.cleanup;
    service = new ActivationService(db, logger);
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('boost', () => {
    it('should boost activation score', async () => {
      await service.ensureActivation('mem-1', 0.5);

      const result = await service.boost('mem-1', 'user_mention');

      expect(result.activationScore).toBe(0.9); // 0.5 + 0.4 = 0.9
      expect(result.boostHistory).toHaveLength(1);
      expect(result.boostHistory[0]?.reason).toBe('user_mention');
    });

    it('should cap activation score at 1.0', async () => {
      await service.ensureActivation('mem-1', 0.9);

      const result = await service.boost('mem-1', 'user_mention');

      expect(result.activationScore).toBe(1.0);
    });

    it('should use different boost amounts for different reasons', async () => {
      await service.ensureActivation('mem-1', 0.5);
      await service.ensureActivation('mem-2', 0.5);

      const userMention = await service.boost('mem-1', 'user_mention');
      const agentRetrieval = await service.boost('mem-2', 'agent_retrieval');

      expect(userMention.activationScore).toBe(0.9); // 0.5 + 0.4
      expect(agentRetrieval.activationScore).toBe(0.7); // 0.5 + 0.2
    });

    it('should create activation record if not exists', async () => {
      const result = await service.boost('new-mem', 'user_mention');

      expect(result.memoryId).toBe('new-mem');
      expect(result.activationScore).toBe(0.9); // 0.5 default + 0.4 boost
    });
  });

  describe('applyDecay', () => {
    it('should decay score by configured rate', () => {
      const config = service.config;
      const originalScore = 1.0;

      // After 1 day
      const after1Day = service.applyDecay(originalScore, 1);
      expect(after1Day).toBeCloseTo(1.0 * (1 - config.dailyDecayRate), 5);

      // After 30 days
      const after30Days = service.applyDecay(originalScore, 30);
      expect(after30Days).toBeCloseTo(1.0 * Math.pow(1 - config.dailyDecayRate, 30), 5);
    });

    it('should not decay for 0 days', () => {
      const result = service.applyDecay(0.8, 0);
      expect(result).toBe(0.8);
    });

    it('should not decay for negative days', () => {
      const result = service.applyDecay(0.8, -1);
      expect(result).toBe(0.8);
    });
  });

  describe('tier classification', () => {
    it('should classify hot tier correctly', async () => {
      const activation = await service.ensureActivation('mem-1', 0.6);

      expect(service.isHot(activation)).toBe(true);
      expect(service.isWarm(activation)).toBe(false);
      expect(service.isCold(activation)).toBe(false);
      expect(service.getTier(activation)).toBe('hot');
    });

    it('should classify warm tier correctly', async () => {
      const activation = await service.ensureActivation('mem-1', 0.3);

      expect(service.isHot(activation)).toBe(false);
      expect(service.isWarm(activation)).toBe(true);
      expect(service.isCold(activation)).toBe(false);
      expect(service.getTier(activation)).toBe('warm');
    });

    it('should classify cold tier correctly', async () => {
      const activation = await service.ensureActivation('mem-1', 0.1);

      expect(service.isHot(activation)).toBe(false);
      expect(service.isWarm(activation)).toBe(false);
      expect(service.isCold(activation)).toBe(true);
      expect(service.getTier(activation)).toBe('cold');
    });
  });

  describe('getActiveMemories', () => {
    it('should return memories above default threshold', async () => {
      await service.ensureActivation('mem-1', 0.2); // Below threshold
      await service.ensureActivation('mem-2', 0.4); // Above threshold
      await service.ensureActivation('mem-3', 0.6); // Above threshold

      const results = await service.getActiveMemories();

      expect(results).toHaveLength(2);
      expect(results.map((r) => r.memoryId)).toContain('mem-2');
      expect(results.map((r) => r.memoryId)).toContain('mem-3');
    });

    it('should respect custom threshold', async () => {
      await service.ensureActivation('mem-1', 0.4);
      await service.ensureActivation('mem-2', 0.6);

      const results = await service.getActiveMemories(0.5);

      expect(results).toHaveLength(1);
      expect(results[0]?.memoryId).toBe('mem-2');
    });
  });

  describe('runDecay', () => {
    it('should decay all activations', async () => {
      // Create activations with lastDecayAt in the past
      const store = new ActivationStore(db);
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

      await store.create('mem-1', 0.8, 0.02);
      await store.update('mem-1', { lastDecayAt: twoDaysAgo });

      await store.create('mem-2', 0.6, 0.02);
      await store.update('mem-2', { lastDecayAt: twoDaysAgo });

      const result = await service.runDecay();

      expect(result.processed).toBe(2);
      expect(result.updated).toBe(2);

      // Check that scores were reduced
      const mem1 = await service.getActivation('mem-1');
      const mem2 = await service.getActivation('mem-2');

      expect(mem1?.activationScore).toBeLessThan(0.8);
      expect(mem2?.activationScore).toBeLessThan(0.6);
    });

    it('should not decay recently decayed activations', async () => {
      await service.ensureActivation('mem-1', 0.8);

      const result = await service.runDecay();

      expect(result.processed).toBe(1);
      expect(result.updated).toBe(0); // Not updated because lastDecayAt is recent

      const mem1 = await service.getActivation('mem-1');
      expect(mem1?.activationScore).toBe(0.8);
    });
  });
});
