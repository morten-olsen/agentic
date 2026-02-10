import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Knex } from 'knex';

import { Services } from '../../../core/services/services.ts';
import { createDatabaseService, DatabaseService } from '../../../core/database/database.ts';
import { LogService } from '../../../core/logging/logging.ts';

import { ConsolidationJobService } from './consolidation.job.ts';
import { OpenLoopStore } from './openloop.store.ts';
import { ActivationStore } from './activation.store.ts';
import { ConsolidatedMemoryStore } from './consolidated.store.ts';

// ============================================================================
// Test Setup
// ============================================================================

const createTestDb = async (): Promise<{ db: Knex; services: Services; cleanup: () => Promise<void> }> => {
  const services = new Services();
  const dbService = createDatabaseService(services, { path: ':memory:' });
  services.set(DatabaseService, dbService);
  await dbService.migrate();
  const db = dbService.knex;

  // Add LogService
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

const createTestMemories = async (
  db: Knex,
  count: number,
  options?: { entityIds?: string[]; topics?: string[] },
): Promise<void> => {
  const now = new Date();

  for (let i = 0; i < count; i++) {
    const createdAt = new Date(now.getTime() - (60 - i) * 24 * 60 * 60 * 1000);

    await db('memories').insert({
      id: `mem-job-${i}`,
      type: 'fact',
      content: `Test memory ${i} for job testing`,
      importance: 0.5,
      entity_ids: JSON.stringify(options?.entityIds ?? []),
      topics: JSON.stringify(options?.topics ?? ['testing']),
      index_status: 'hot',
      created_at: createdAt.toISOString(),
      last_accessed_at: createdAt.toISOString(),
      access_count: 0,
    });
  }
};

// ============================================================================
// ConsolidationJobService Tests
// ============================================================================

describe('ConsolidationJobService', () => {
  let db: Knex;
  let services: Services;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = await createTestDb();
    db = setup.db;
    services = setup.services;
    cleanup = setup.cleanup;
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe('lifecycle', () => {
    it('should start and stop', async () => {
      const jobService = new ConsolidationJobService(services);

      expect(jobService.isRunning).toBe(false);

      await jobService.start();
      expect(jobService.isRunning).toBe(true);

      await jobService.stop();
      expect(jobService.isRunning).toBe(false);
    });

    it('should not start twice', async () => {
      const jobService = new ConsolidationJobService(services);

      await jobService.start();
      await jobService.start(); // Should be no-op

      expect(jobService.isRunning).toBe(true);

      await jobService.stop();
    });

    it('should provide next scheduled times', async () => {
      const jobService = new ConsolidationJobService(services);

      const times = jobService.getNextScheduledTimes();

      expect(times.consolidation).toBeInstanceOf(Date);
      expect(times.decay).toBeInstanceOf(Date);
    });
  });

  describe('runConsolidation', () => {
    it('should return completed report with no memories', async () => {
      const jobService = new ConsolidationJobService(services);

      const report = await jobService.runConsolidation();

      expect(report.type).toBe('consolidation');
      expect(report.status).toBe('completed');
      expect(report.stats.memoriesProcessed).toBe(0);
      expect(report.stats.consolidatedCreated).toBe(0);
      expect(report.stats.errors).toEqual([]);
    });

    it('should consolidate memories when available', async () => {
      await createTestMemories(db, 5, { topics: ['project-alpha'] });

      const jobService = new ConsolidationJobService(services);
      const report = await jobService.runConsolidation();

      expect(report.type).toBe('consolidation');
      expect(report.status).toBe('completed');
      expect(report.stats.consolidatedCreated).toBeGreaterThan(0);
    });

    it('should use custom knowledge extractor', async () => {
      await createTestMemories(db, 5, { topics: ['project-beta'] });

      const jobService = new ConsolidationJobService(services);

      let extractorCalled = false;
      jobService.setKnowledgeExtractor(async () => {
        extractorCalled = true;
        return {
          summary: 'Custom summary from job',
          structuredData: { job: true },
          keyPoints: ['Point 1'],
          lessons: [],
          supersededInfo: [],
        };
      });

      const report = await jobService.runConsolidation();

      expect(extractorCalled).toBe(true);
      expect(report.status).toBe('completed');
    });

    it('should handle errors gracefully', async () => {
      await createTestMemories(db, 5, { topics: ['project-error'] });

      const jobService = new ConsolidationJobService(services);

      // Set a failing extractor
      jobService.setKnowledgeExtractor(async () => {
        throw new Error('Extraction error');
      });

      const report = await jobService.runConsolidation();

      // Job should complete (with errors logged), not fail entirely
      expect(report.stats.errors.length).toBeGreaterThan(0);
    });
  });

  describe('runDecay', () => {
    it('should apply decay to memory activations', async () => {
      // Create some activation records
      const activationStore = new ActivationStore(db);
      await activationStore.ensure('mem-decay-1', 0.8, 0.02);
      await activationStore.ensure('mem-decay-2', 0.6, 0.02);

      // Set last_decay_at to yesterday
      const yesterday = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      await db('memory_activation').update({ last_decay_at: yesterday });

      const jobService = new ConsolidationJobService(services);
      const report = await jobService.runDecay();

      expect(report.type).toBe('decay');
      expect(report.status).toBe('completed');
      expect(report.stats.decayProcessed).toBe(2);
      expect(report.stats.decayUpdated).toBe(2);
    });

    it('should apply decay to consolidated memories', async () => {
      const consolidatedStore = new ConsolidatedMemoryStore(db);
      await consolidatedStore.create({
        type: 'entity',
        content: {
          summary: 'Test consolidated',
          keyPoints: ['Point'],
          structuredData: {},
          lessons: [],
        },
        timespanStart: new Date().toISOString(),
        timespanEnd: new Date().toISOString(),
        sourceMemoryIds: ['mem-1'],
      });

      // Update activation score to something high
      await db('consolidated_memories').update({ activation_score: 0.9 });

      const jobService = new ConsolidationJobService(services);
      const report = await jobService.runDecay();

      expect(report.status).toBe('completed');
      expect(report.stats.consolidatedMemoriesDecayed).toBe(1);

      // Verify decay was applied
      const after = await consolidatedStore.getHighActivation(0, 10);
      expect(after[0]?.activationScore).toBeLessThan(0.9);
    });

    it('should mark stale open loops', async () => {
      const openLoopStore = new OpenLoopStore(db);

      // Create an old open loop that should be stale
      const staleDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(); // 40 days ago
      await db('open_loops').insert({
        id: 'loop-stale-1',
        topic: 'Old decision',
        description: 'This should be stale',
        activation_patterns: JSON.stringify(['old']),
        linked_memory_ids: JSON.stringify([]),
        linked_consolidated_ids: JSON.stringify([]),
        status: 'active',
        stale_after_days: 30,
        created_at: staleDate,
      });

      const jobService = new ConsolidationJobService(services);
      const report = await jobService.runDecay();

      expect(report.status).toBe('completed');
      expect(report.stats.staleLoopsMarked).toBe(1);

      // Verify it was marked stale
      const loop = await openLoopStore.get('loop-stale-1');
      expect(loop?.status).toBe('stale');
    });
  });

  describe('runStaleCleanup', () => {
    it('should mark stale loops independently', async () => {
      // Create stale open loops
      const staleDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
      await db('open_loops').insert({
        id: 'loop-cleanup-1',
        topic: 'Stale loop for cleanup',
        description: 'Test description',
        activation_patterns: JSON.stringify(['cleanup']),
        linked_memory_ids: JSON.stringify([]),
        linked_consolidated_ids: JSON.stringify([]),
        status: 'active',
        stale_after_days: 30,
        created_at: staleDate,
      });

      const jobService = new ConsolidationJobService(services);
      const report = await jobService.runStaleCleanup();

      expect(report.type).toBe('stale_cleanup');
      expect(report.status).toBe('completed');
      expect(report.stats.staleLoopsMarked).toBe(1);
    });
  });

  describe('config', () => {
    it('should use default config', () => {
      const jobService = new ConsolidationJobService(services);
      const times = jobService.getNextScheduledTimes();

      // Should have valid scheduled times based on default cron
      expect(times.consolidation).not.toBeNull();
      expect(times.decay).not.toBeNull();
    });

    it('should accept custom config', () => {
      const customConfig = {
        consolidationSchedule: '0 0 * * *', // Midnight daily
        decaySchedule: '0 12 * * *', // Noon daily
      };

      const jobService = new ConsolidationJobService(services, customConfig);
      const times = jobService.getNextScheduledTimes();

      // Should have valid scheduled times
      expect(times.consolidation).not.toBeNull();
      expect(times.decay).not.toBeNull();
    });
  });
});
