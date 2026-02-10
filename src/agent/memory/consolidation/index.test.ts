import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';

import { Services } from '../../../core/services/services.ts';
import { createDatabaseService, DatabaseService } from '../../../core/database/database.ts';

import { MemoryIndexService, formatRelativeTime } from './index.service.ts';

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
// formatRelativeTime Tests
// ============================================================================

describe('formatRelativeTime', () => {
  it('should format today', () => {
    expect(formatRelativeTime(0)).toBe('today');
  });

  it('should format yesterday', () => {
    expect(formatRelativeTime(1)).toBe('yesterday');
  });

  it('should format days ago', () => {
    expect(formatRelativeTime(3)).toBe('3 days ago');
    expect(formatRelativeTime(6)).toBe('6 days ago');
  });

  it('should format weeks ago', () => {
    expect(formatRelativeTime(7)).toBe('1 week ago');
    expect(formatRelativeTime(14)).toBe('2 weeks ago');
    expect(formatRelativeTime(21)).toBe('3 weeks ago');
  });

  it('should format months ago', () => {
    expect(formatRelativeTime(30)).toBe('1 month ago');
    expect(formatRelativeTime(60)).toBe('2 months ago');
    expect(formatRelativeTime(90)).toBe('3 months ago');
  });

  it('should format years ago', () => {
    expect(formatRelativeTime(365)).toBe('1 year ago');
    expect(formatRelativeTime(730)).toBe('2 years ago');
  });
});

// ============================================================================
// MemoryIndexService Tests
// ============================================================================

describe('MemoryIndexService', () => {
  let db: Knex;
  let services: Services;
  let service: MemoryIndexService;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = await createTestDb();
    db = setup.db;
    services = setup.services;
    cleanup = setup.cleanup;
    service = new MemoryIndexService(services);
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('getMemoryIndex', () => {
    it('should return empty index when no data exists', async () => {
      const index = await service.getMemoryIndex();

      expect(index.activeEntities).toEqual([]);
      expect(index.openLoops).toEqual([]);
      expect(index.memoryLandscape.totalMemories).toBe(0);
      expect(index.memoryLandscape.totalConsolidated).toBe(0);
      expect(index.memoryLandscape.categories).toEqual([]);
      expect(index.sessionContext.mentionedEntities).toEqual([]);
    });

    it('should return open loops ordered by created date', async () => {
      // Create some open loops
      const now = new Date();
      await db('open_loops').insert([
        {
          id: 'loop-1',
          topic: 'Job decision',
          description: 'Deciding on job offer',
          activation_patterns: JSON.stringify(['job', 'offer']),
          status: 'active',
          linked_memory_ids: JSON.stringify([]),
          linked_consolidated_ids: JSON.stringify([]),
          stale_after_days: 30,
          created_at: new Date(now.getTime() - 86400000).toISOString(), // 1 day ago
        },
        {
          id: 'loop-2',
          topic: 'Vacation planning',
          description: 'Planning summer vacation',
          activation_patterns: JSON.stringify(['vacation', 'travel']),
          status: 'active',
          linked_memory_ids: JSON.stringify([]),
          linked_consolidated_ids: JSON.stringify([]),
          stale_after_days: 30,
          created_at: now.toISOString(),
        },
      ]);

      const index = await service.getMemoryIndex();

      expect(index.openLoops).toHaveLength(2);
      expect(index.openLoops[0]?.topic).toBe('Vacation planning'); // Most recent first
      expect(index.openLoops[1]?.topic).toBe('Job decision');
    });

    it('should exclude resolved open loops', async () => {
      await db('open_loops').insert([
        {
          id: 'loop-1',
          topic: 'Active loop',
          description: 'This is active',
          activation_patterns: JSON.stringify(['active']),
          status: 'active',
          linked_memory_ids: JSON.stringify([]),
          linked_consolidated_ids: JSON.stringify([]),
          stale_after_days: 30,
          created_at: new Date().toISOString(),
        },
        {
          id: 'loop-2',
          topic: 'Resolved loop',
          description: 'This is resolved',
          activation_patterns: JSON.stringify(['resolved']),
          status: 'resolved',
          linked_memory_ids: JSON.stringify([]),
          linked_consolidated_ids: JSON.stringify([]),
          stale_after_days: 30,
          created_at: new Date().toISOString(),
          resolved_at: new Date().toISOString(),
        },
      ]);

      const index = await service.getMemoryIndex();

      expect(index.openLoops).toHaveLength(1);
      expect(index.openLoops[0]?.topic).toBe('Active loop');
    });

    it('should respect maxOpenLoops limit', async () => {
      // Create 15 open loops (more than max of 10)
      const loops = [];
      for (let i = 0; i < 15; i++) {
        loops.push({
          id: `loop-${i}`,
          topic: `Loop ${i}`,
          description: `Description ${i}`,
          activation_patterns: JSON.stringify(['test']),
          status: 'active',
          linked_memory_ids: JSON.stringify([]),
          linked_consolidated_ids: JSON.stringify([]),
          stale_after_days: 30,
          created_at: new Date().toISOString(),
        });
      }
      await db('open_loops').insert(loops);

      const index = await service.getMemoryIndex();

      expect(index.openLoops).toHaveLength(10); // Default max
    });

    it('should count consolidated memories', async () => {
      await db('consolidated_memories').insert([
        {
          id: 'cons-1',
          type: 'entity',
          content: JSON.stringify({ summary: 'Test', keyPoints: [] }),
          timespan_start: new Date().toISOString(),
          timespan_end: new Date().toISOString(),
          consolidated_at: new Date().toISOString(),
          source_memory_ids: JSON.stringify([]),
          source_memory_count: 0,
          version: 1,
          activation_score: 0.5,
          last_accessed_at: new Date().toISOString(),
          entity_ids: JSON.stringify([]),
          topics: JSON.stringify([]),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);

      const index = await service.getMemoryIndex();

      expect(index.memoryLandscape.totalConsolidated).toBe(1);
    });
  });

  describe('session context', () => {
    it('should record and return entity mentions', () => {
      service.recordEntityMention('Alice');
      service.recordEntityMention('Bob');

      const context = service.getSessionContext();
      expect(context.mentionedEntities).toContain('Alice');
      expect(context.mentionedEntities).toContain('Bob');
    });

    it('should not duplicate entity mentions', () => {
      service.recordEntityMention('Alice');
      service.recordEntityMention('Alice');

      const context = service.getSessionContext();
      expect(context.mentionedEntities.filter((e) => e === 'Alice')).toHaveLength(1);
    });

    it('should record memory retrievals', () => {
      service.recordMemoryRetrieval('mem-1');
      service.recordMemoryRetrieval('mem-2');

      const context = service.getSessionContext();
      expect(context.retrievedMemoryIds).toContain('mem-1');
      expect(context.retrievedMemoryIds).toContain('mem-2');
    });

    it('should record topics discussed', () => {
      service.recordTopicDiscussed('career');
      service.recordTopicDiscussed('travel');

      const context = service.getSessionContext();
      expect(context.topicsDiscussed).toContain('career');
      expect(context.topicsDiscussed).toContain('travel');
    });

    it('should reset session context', () => {
      service.recordEntityMention('Alice');
      service.recordTopicDiscussed('career');

      service.resetSessionContext();

      const context = service.getSessionContext();
      expect(context.mentionedEntities).toEqual([]);
      expect(context.topicsDiscussed).toEqual([]);
    });

    it('should include session context in index', async () => {
      service.recordEntityMention('Alice');
      service.recordTopicDiscussed('career');

      const index = await service.getMemoryIndex();

      expect(index.sessionContext.mentionedEntities).toContain('Alice');
      expect(index.sessionContext.topicsDiscussed).toContain('career');
    });

    it('should bound session entities', () => {
      // Add more than maxSessionEntities (default 20)
      for (let i = 0; i < 25; i++) {
        service.recordEntityMention(`Entity${i}`);
      }

      const context = service.getSessionContext();
      expect(context.mentionedEntities.length).toBeLessThanOrEqual(20);
    });
  });

  describe('config', () => {
    it('should use default config', () => {
      const config = service.config;

      expect(config.maxActiveEntities).toBe(15);
      expect(config.maxOpenLoops).toBe(10);
      expect(config.maxSessionEntities).toBe(20);
      expect(config.indexActivationThreshold).toBe(0.3);
    });

    it('should allow custom config', () => {
      const customService = new MemoryIndexService(services, {
        maxActiveEntities: 5,
        maxOpenLoops: 3,
      });

      expect(customService.config.maxActiveEntities).toBe(5);
      expect(customService.config.maxOpenLoops).toBe(3);
    });
  });
});
