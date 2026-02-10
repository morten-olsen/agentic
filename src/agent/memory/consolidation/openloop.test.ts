import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';

import { Services } from '../../../core/services/services.ts';
import { createDatabaseService, DatabaseService } from '../../../core/database/database.ts';
import { LogService } from '../../../core/logging/logging.ts';

import { OpenLoopStore } from './openloop.store.ts';
import { OpenLoopService, extractKeywords } from './openloop.service.ts';

// ============================================================================
// Test Setup
// ============================================================================

const createTestDb = async (): Promise<{ db: Knex; services: Services; cleanup: () => Promise<void> }> => {
  const services = new Services();
  const dbService = createDatabaseService(services, { path: ':memory:' });
  services.set(DatabaseService, dbService);
  await dbService.migrate();
  const db = dbService.knex;

  // Add LogService for OpenLoopService
  const logService = new LogService(services, { terminalEnabled: false, databaseEnabled: false });
  services.set(LogService, logService);

  return {
    db,
    services,
    cleanup: async () => {
      await services.destroy();
    },
  };
};

// ============================================================================
// extractKeywords Tests
// ============================================================================

describe('extractKeywords', () => {
  it('should extract meaningful words', () => {
    const keywords = extractKeywords('Should I take the job offer from Acme?');
    expect(keywords).toContain('job');
    expect(keywords).toContain('offer');
    expect(keywords).toContain('acme');
  });

  it('should filter stop words', () => {
    const keywords = extractKeywords('The quick brown fox jumps over the lazy dog');
    expect(keywords).not.toContain('the');
    // 'over' has 4 letters and isn't a stop word, so it's included
    expect(keywords).toContain('quick');
    expect(keywords).toContain('brown');
    expect(keywords).toContain('fox');
    expect(keywords).toContain('jumps');
    expect(keywords).toContain('lazy');
    expect(keywords).toContain('dog');
  });

  it('should filter short words', () => {
    const keywords = extractKeywords('I am at a store');
    expect(keywords).not.toContain('am');
    expect(keywords).not.toContain('at');
    expect(keywords).toContain('store');
  });

  it('should remove duplicates', () => {
    const keywords = extractKeywords('job job job offer offer');
    expect(keywords.filter((k) => k === 'job').length).toBe(1);
    expect(keywords.filter((k) => k === 'offer').length).toBe(1);
  });

  it('should handle empty string', () => {
    const keywords = extractKeywords('');
    expect(keywords).toEqual([]);
  });
});

// ============================================================================
// OpenLoopStore Tests
// ============================================================================

describe('OpenLoopStore', () => {
  let db: Knex;
  let store: OpenLoopStore;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = await createTestDb();
    db = setup.db;
    cleanup = setup.cleanup;
    store = new OpenLoopStore(db);
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('create', () => {
    it('should create an open loop', async () => {
      const loop = await store.create({
        topic: 'Job decision',
        description: 'Need to decide on job offer',
        activationPatterns: ['job', 'offer', 'career'],
      });

      expect(loop.id).toBeDefined();
      expect(loop.topic).toBe('Job decision');
      expect(loop.status).toBe('active');
      expect(loop.activationPatterns).toEqual(['job', 'offer', 'career']);
    });

    it('should use default staleAfterDays', async () => {
      const loop = await store.create({
        topic: 'Test',
        description: 'Test loop',
        activationPatterns: ['test'],
      });

      expect(loop.staleAfterDays).toBe(30);
    });

    it('should use custom staleAfterDays', async () => {
      const loop = await store.create({
        topic: 'Test',
        description: 'Test loop',
        activationPatterns: ['test'],
        staleAfterDays: 14,
      });

      expect(loop.staleAfterDays).toBe(14);
    });
  });

  describe('get', () => {
    it('should return null for non-existent loop', async () => {
      const result = await store.get('non-existent');
      expect(result).toBeNull();
    });

    it('should return existing loop', async () => {
      const created = await store.create({
        topic: 'Test',
        description: 'Test',
        activationPatterns: ['test'],
      });

      const retrieved = await store.get(created.id);
      expect(retrieved?.topic).toBe('Test');
    });
  });

  describe('update', () => {
    it('should update topic', async () => {
      const loop = await store.create({
        topic: 'Original',
        description: 'Desc',
        activationPatterns: ['test'],
      });

      const updated = await store.update(loop.id, { topic: 'Updated' });
      expect(updated?.topic).toBe('Updated');
    });

    it('should update activation patterns', async () => {
      const loop = await store.create({
        topic: 'Test',
        description: 'Desc',
        activationPatterns: ['old'],
      });

      const updated = await store.update(loop.id, { activationPatterns: ['new', 'patterns'] });
      expect(updated?.activationPatterns).toEqual(['new', 'patterns']);
    });

    it('should return null for non-existent loop', async () => {
      const result = await store.update('non-existent', { topic: 'Updated' });
      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete existing loop', async () => {
      const loop = await store.create({
        topic: 'Test',
        description: 'Desc',
        activationPatterns: ['test'],
      });

      const deleted = await store.delete(loop.id);
      expect(deleted).toBe(true);

      const retrieved = await store.get(loop.id);
      expect(retrieved).toBeNull();
    });

    it('should return false for non-existent loop', async () => {
      const deleted = await store.delete('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('getActive', () => {
    it('should return only active loops', async () => {
      await store.create({
        topic: 'Active 1',
        description: 'Desc',
        activationPatterns: ['active'],
      });
      const loop2 = await store.create({
        topic: 'Active 2',
        description: 'Desc',
        activationPatterns: ['active'],
      });
      await store.resolve(loop2.id);

      const active = await store.getActive();
      expect(active.length).toBe(1);
      expect(active[0]?.topic).toBe('Active 1');
    });

    it('should respect limit', async () => {
      for (let i = 0; i < 5; i++) {
        await store.create({
          topic: `Loop ${i}`,
          description: 'Desc',
          activationPatterns: ['test'],
        });
      }

      const active = await store.getActive(2);
      expect(active.length).toBe(2);
    });
  });

  describe('findByPatternMatch', () => {
    it('should find loops matching patterns', async () => {
      await store.create({
        topic: 'Job decision',
        description: 'Desc',
        activationPatterns: ['job', 'offer', 'career'],
      });
      await store.create({
        topic: 'Vacation planning',
        description: 'Desc',
        activationPatterns: ['vacation', 'travel', 'trip'],
      });

      const matches = await store.findByPatternMatch(['job', 'salary']);
      expect(matches.length).toBe(1);
      expect(matches[0]?.topic).toBe('Job decision');
    });

    it('should be case insensitive', async () => {
      await store.create({
        topic: 'Test',
        description: 'Desc',
        activationPatterns: ['UPPERCASE'],
      });

      const matches = await store.findByPatternMatch(['uppercase']);
      expect(matches.length).toBe(1);
    });

    it('should return empty for no patterns', async () => {
      const matches = await store.findByPatternMatch([]);
      expect(matches).toEqual([]);
    });
  });

  describe('resolve', () => {
    it('should resolve a loop', async () => {
      const loop = await store.create({
        topic: 'Test',
        description: 'Desc',
        activationPatterns: ['test'],
      });

      const resolved = await store.resolve(loop.id);
      expect(resolved?.status).toBe('resolved');
      expect(resolved?.resolvedAt).toBeDefined();
    });
  });

  describe('reactivate', () => {
    it('should reactivate a resolved loop', async () => {
      const loop = await store.create({
        topic: 'Test',
        description: 'Desc',
        activationPatterns: ['test'],
      });
      await store.resolve(loop.id);

      const reactivated = await store.reactivate(loop.id);
      expect(reactivated?.status).toBe('active');
    });
  });

  describe('recordTrigger', () => {
    it('should update lastTriggeredAt', async () => {
      const loop = await store.create({
        topic: 'Test',
        description: 'Desc',
        activationPatterns: ['test'],
      });

      expect(loop.lastTriggeredAt).toBeUndefined();

      const triggered = await store.recordTrigger(loop.id);
      expect(triggered?.lastTriggeredAt).toBeDefined();
    });
  });

  describe('markStale', () => {
    it('should mark old untriggered loops as stale', async () => {
      // Create a loop with old createdAt
      const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(); // 40 days ago
      await db('open_loops').insert({
        id: 'old-loop',
        topic: 'Old loop',
        description: 'Desc',
        activation_patterns: JSON.stringify(['old']),
        linked_memory_ids: JSON.stringify([]),
        linked_consolidated_ids: JSON.stringify([]),
        status: 'active',
        stale_after_days: 30,
        created_at: oldDate,
        last_triggered_at: null,
        resolved_at: null,
      });

      const marked = await store.markStale();
      expect(marked).toBe(1);

      const loop = await store.get('old-loop');
      expect(loop?.status).toBe('stale');
    });

    it('should not mark recently triggered loops as stale', async () => {
      // Create a loop with old createdAt but recent trigger
      const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
      const recentDate = new Date().toISOString();
      await db('open_loops').insert({
        id: 'triggered-loop',
        topic: 'Triggered loop',
        description: 'Desc',
        activation_patterns: JSON.stringify(['test']),
        linked_memory_ids: JSON.stringify([]),
        linked_consolidated_ids: JSON.stringify([]),
        status: 'active',
        stale_after_days: 30,
        created_at: oldDate,
        last_triggered_at: recentDate,
        resolved_at: null,
      });

      const marked = await store.markStale();
      expect(marked).toBe(0);
    });
  });
});

// ============================================================================
// OpenLoopService Tests
// ============================================================================

describe('OpenLoopService', () => {
  let services: Services;
  let service: OpenLoopService;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = await createTestDb();
    services = setup.services;
    cleanup = setup.cleanup;
    service = new OpenLoopService(services);
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('create', () => {
    it('should create an open loop', async () => {
      const loop = await service.create({
        topic: 'Test',
        description: 'Test loop',
        activationPatterns: ['test'],
      });

      expect(loop.id).toBeDefined();
      expect(loop.topic).toBe('Test');
      expect(loop.status).toBe('active');
    });
  });

  describe('matchMessage', () => {
    it('should match open loops from message', async () => {
      await service.create({
        topic: 'Job decision',
        description: 'Desc',
        activationPatterns: ['job', 'offer', 'acme'],
      });

      const matches = await service.matchMessage('Did you hear back about the job offer?');
      expect(matches.length).toBe(1);
      expect(matches[0]?.topic).toBe('Job decision');
    });

    it('should record triggers on match', async () => {
      const loop = await service.create({
        topic: 'Test',
        description: 'Desc',
        activationPatterns: ['special'],
      });

      expect(loop.lastTriggeredAt).toBeUndefined();

      await service.matchMessage('Something special happened');

      const updated = await service.get(loop.id);
      expect(updated?.lastTriggeredAt).toBeDefined();
    });

    it('should return empty for no matches', async () => {
      await service.create({
        topic: 'Job decision',
        description: 'Desc',
        activationPatterns: ['job', 'offer'],
      });

      const matches = await service.matchMessage('What is the weather like?');
      expect(matches.length).toBe(0);
    });
  });

  describe('generateHints', () => {
    it('should generate hints from matched loops', async () => {
      const loop = await service.create({
        topic: 'Job decision',
        description: 'Desc',
        activationPatterns: ['job'],
      });

      const hints = service.generateHints([loop]);
      expect(hints.length).toBe(1);
      expect(hints[0]?.type).toBe('open_loop');
      expect(hints[0]?.hint).toContain('Job decision');
      expect(hints[0]?.relevanceScore).toBe(0.9);
    });

    it('should respect maxHints', async () => {
      const loops = [];
      for (let i = 0; i < 5; i++) {
        loops.push(
          await service.create({
            topic: `Loop ${i}`,
            description: 'Desc',
            activationPatterns: ['test'],
          }),
        );
      }

      const hints = service.generateHints(loops, 2);
      expect(hints.length).toBe(2);
    });
  });

  describe('resolve', () => {
    it('should resolve an open loop', async () => {
      const loop = await service.create({
        topic: 'Test',
        description: 'Desc',
        activationPatterns: ['test'],
      });

      const resolved = await service.resolve(loop.id, 'Decided to accept');
      expect(resolved?.status).toBe('resolved');
      expect(resolved?.resolvedAt).toBeDefined();
    });
  });

  describe('addPattern', () => {
    it('should add new pattern', async () => {
      const loop = await service.create({
        topic: 'Test',
        description: 'Desc',
        activationPatterns: ['original'],
      });

      const updated = await service.addPattern(loop.id, 'newpattern');
      expect(updated?.activationPatterns).toContain('original');
      expect(updated?.activationPatterns).toContain('newpattern');
    });

    it('should not duplicate patterns', async () => {
      const loop = await service.create({
        topic: 'Test',
        description: 'Desc',
        activationPatterns: ['existing'],
      });

      const updated = await service.addPattern(loop.id, 'EXISTING'); // Same pattern, different case
      expect(updated?.activationPatterns.length).toBe(1);
    });
  });

  describe('addMemoryLink', () => {
    it('should add memory link', async () => {
      const loop = await service.create({
        topic: 'Test',
        description: 'Desc',
        activationPatterns: ['test'],
      });

      const updated = await service.addMemoryLink(loop.id, 'mem-123');
      expect(updated?.linkedMemoryIds).toContain('mem-123');
    });
  });

  describe('markStale', () => {
    it('should return count of marked loops', async () => {
      const result = await service.markStale();
      expect(result.marked).toBe(0); // No old loops
    });
  });
});
