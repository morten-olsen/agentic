/**
 * Flow tests for memory consolidation.
 * Tests open loops, consolidated memory access, and activation.
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest';

import { Services } from '../../src/core/services/services.ts';
import { createDatabaseService, DatabaseService } from '../../src/core/database/database.ts';
import { LogService } from '../../src/core/logging/logging.ts';
import { OpenLoopService } from '../../src/agent/memory/consolidation/openloop.service.ts';
import { ConsolidatedMemoryStore } from '../../src/agent/memory/consolidation/consolidated.store.ts';
import {
  ActivationService,
  DEFAULT_ACTIVATION_CONFIG,
} from '../../src/agent/memory/consolidation/activation.service.ts';
import { ConsolidationJobService } from '../../src/agent/memory/consolidation/consolidation.job.ts';

// ============================================================================
// Test Setup
// ============================================================================

const createTestServices = async (): Promise<{
  services: Services;
  db: ReturnType<typeof createDatabaseService>['knex'];
  cleanup: () => Promise<void>;
}> => {
  const services = new Services();
  const dbService = createDatabaseService(services, { path: ':memory:' });
  services.set(DatabaseService, dbService);
  await dbService.migrate();
  const db = dbService.knex;

  const logService = new LogService(services, { terminalEnabled: false, databaseEnabled: false });
  services.set(LogService, logService);

  return {
    services,
    db,
    cleanup: async () => {
      await services.destroy();
    },
  };
};

// ============================================================================
// Tests
// ============================================================================

describe('Memory Consolidation Flow', () => {
  let services: Services;
  let db: ReturnType<typeof createDatabaseService>['knex'];
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = await createTestServices();
    services = setup.services;
    db = setup.db;
    cleanup = setup.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('Open Loops Workflow', () => {
    it('creates an open loop and matches it against messages', async () => {
      const openLoopService = new OpenLoopService(services);

      // Create an open loop
      const loop = await openLoopService.create({
        topic: 'Job offer decision',
        description: 'Deciding whether to accept the offer from Acme Corp',
        activationPatterns: ['job', 'offer', 'acme', 'career'],
      });

      expect(loop.id).toBeDefined();
      expect(loop.status).toBe('active');

      // Match against a message mentioning the topic
      const matched = await openLoopService.matchMessage('What should I do about that job offer?');

      expect(matched.length).toBe(1);
      expect(matched[0]?.topic).toBe('Job offer decision');

      // Generate hints from matched loops
      const hints = openLoopService.generateHints(matched);

      expect(hints.length).toBe(1);
      expect(hints[0]?.type).toBe('open_loop');
      expect(hints[0]?.hint).toContain('Job offer decision');
    });

    it('resolves an open loop when situation is concluded', async () => {
      const openLoopService = new OpenLoopService(services);

      // Create and then resolve
      const loop = await openLoopService.create({
        topic: 'Doctor appointment',
        description: 'Need to schedule annual checkup',
        activationPatterns: ['doctor', 'appointment', 'checkup'],
      });

      expect(loop.status).toBe('active');

      const resolved = await openLoopService.resolve(loop.id, 'Scheduled for next week');

      expect(resolved?.status).toBe('resolved');
      expect(resolved?.resolvedAt).toBeDefined();

      // Should no longer match
      const matched = await openLoopService.matchMessage('I need to see the doctor');
      expect(matched.length).toBe(0);
    });

    it('marks stale open loops after configured period', async () => {
      // Create an old open loop directly in DB
      const staleDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(); // 35 days ago
      await db('open_loops').insert({
        id: 'loop-stale-flow',
        topic: 'Old decision',
        description: 'This should become stale',
        activation_patterns: JSON.stringify(['old']),
        linked_memory_ids: JSON.stringify([]),
        linked_consolidated_ids: JSON.stringify([]),
        status: 'active',
        stale_after_days: 30,
        created_at: staleDate,
      });

      const openLoopService = new OpenLoopService(services);
      const result = await openLoopService.markStale();

      expect(result.marked).toBe(1);

      const loop = await openLoopService.get('loop-stale-flow');
      expect(loop?.status).toBe('stale');
    });

    it('reactivates a stale or resolved loop', async () => {
      const openLoopService = new OpenLoopService(services);

      const loop = await openLoopService.create({
        topic: 'Vacation planning',
        description: 'Need to book flights',
        activationPatterns: ['vacation', 'flights'],
      });

      // Resolve it
      await openLoopService.resolve(loop.id);

      // Reactivate it
      const reactivated = await openLoopService.reactivate(loop.id);

      expect(reactivated?.status).toBe('active');
    });
  });

  describe('Consolidated Memories Workflow', () => {
    it('creates and retrieves consolidated memories', async () => {
      const store = new ConsolidatedMemoryStore(db);

      // Create consolidated memory
      const consolidated = await store.create({
        type: 'entity',
        content: {
          summary: 'Alice is a software engineer who lives in Seattle',
          keyPoints: ['Software engineer', 'Lives in Seattle'],
          structuredData: { occupation: 'software engineer', location: 'Seattle' },
          lessons: [],
        },
        timespanStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        timespanEnd: new Date().toISOString(),
        sourceMemoryIds: ['mem-1', 'mem-2'],
        entityIds: ['alice'],
        topics: ['people', 'contacts'],
      });

      expect(consolidated.id).toBeDefined();
      expect(consolidated.type).toBe('entity');

      // Retrieve by ID
      const retrieved = await store.get(consolidated.id);
      expect(retrieved?.content.summary).toContain('Alice');

      // Retrieve by type
      const byType = await store.getByType('entity', 10);
      expect(byType.length).toBe(1);
      expect(byType[0]?.entityIds).toContain('alice');
    });

    it('drills down to source memories', async () => {
      const store = new ConsolidatedMemoryStore(db);

      // Create source memories
      await db('memories').insert({
        id: 'mem-drill-1',
        type: 'fact',
        content: 'Bob mentioned he started a new job at TechCorp',
        importance: 0.6,
        entity_ids: JSON.stringify(['bob']),
        topics: JSON.stringify(['career']),
        index_status: 'hot',
        created_at: new Date().toISOString(),
        last_accessed_at: new Date().toISOString(),
        access_count: 0,
      });

      await db('memories').insert({
        id: 'mem-drill-2',
        type: 'fact',
        content: 'Bob got promoted to senior engineer',
        importance: 0.7,
        entity_ids: JSON.stringify(['bob']),
        topics: JSON.stringify(['career']),
        index_status: 'hot',
        created_at: new Date().toISOString(),
        last_accessed_at: new Date().toISOString(),
        access_count: 0,
      });

      // Create consolidated memory
      const consolidated = await store.create({
        type: 'entity',
        content: {
          summary: 'Bob works at TechCorp as a senior engineer',
          keyPoints: ['Works at TechCorp', 'Senior engineer'],
          structuredData: { employer: 'TechCorp', title: 'Senior Engineer' },
          lessons: [],
        },
        timespanStart: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        timespanEnd: new Date().toISOString(),
        sourceMemoryIds: ['mem-drill-1', 'mem-drill-2'],
        entityIds: ['bob'],
        topics: ['career', 'people'],
      });

      // Mark as consolidated
      await store.markMemoriesConsolidated(['mem-drill-1', 'mem-drill-2'], consolidated.id);

      // Get source memories
      const sources = await store.getSourceMemories(consolidated.id);
      expect(sources).toContain('mem-drill-1');
      expect(sources).toContain('mem-drill-2');

      // Verify memories were marked
      const mem1 = await db('memories').where('id', 'mem-drill-1').first();
      expect(mem1.consolidated_into_id).toBe(consolidated.id);
      expect(mem1.index_status).toBe('archived');
    });

    it('updates consolidated memory with new information', async () => {
      const store = new ConsolidatedMemoryStore(db);

      const consolidated = await store.create({
        type: 'preference',
        content: {
          summary: 'User prefers dark mode',
          keyPoints: ['Dark mode'],
          structuredData: {},
          lessons: [],
        },
        timespanStart: new Date().toISOString(),
        timespanEnd: new Date().toISOString(),
        sourceMemoryIds: ['mem-pref-1'],
      });

      // Update with new information
      const updated = await store.update(consolidated.id, {
        content: {
          summary: 'User prefers dark mode and large fonts',
          keyPoints: ['Dark mode', 'Large fonts'],
          structuredData: { theme: 'dark', fontSize: 'large' },
          lessons: [],
        },
        sourceMemoryIds: ['mem-pref-1', 'mem-pref-2'],
      });

      expect(updated?.version).toBe(2);
      expect(updated?.content.keyPoints).toContain('Large fonts');
      expect(updated?.sourceMemoryCount).toBe(2);
    });
  });

  describe('Activation System Workflow', () => {
    it('applies decay to memory activations', async () => {
      const logService = services.get(LogService);
      const activationService = new ActivationService(
        db,
        logService.child({ source: 'ActivationService' }),
        DEFAULT_ACTIVATION_CONFIG,
      );

      // Create activation record
      await activationService.ensureActivation('mem-decay-test', 0.8);

      // Set last decay to 2 days ago
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      await db('memory_activation').where('memory_id', 'mem-decay-test').update({ last_decay_at: twoDaysAgo });

      // Run decay
      const result = await activationService.runDecay();

      expect(result.processed).toBe(1);
      expect(result.updated).toBe(1);

      // Check score decreased
      const updated = await activationService.getActivation('mem-decay-test');
      expect(updated?.activationScore).toBeLessThan(0.8);
    });

    it('boosts activation on memory access', async () => {
      const logService = services.get(LogService);
      const activationService = new ActivationService(
        db,
        logService.child({ source: 'ActivationService' }),
        DEFAULT_ACTIVATION_CONFIG,
      );

      // Create with medium score
      await activationService.ensureActivation('mem-boost-test', 0.5);

      // Boost for user mention
      const boosted = await activationService.boost('mem-boost-test', 'user_mention');

      expect(boosted.activationScore).toBeGreaterThan(0.5);
      expect(boosted.boostHistory.length).toBe(1);
      expect(boosted.boostHistory[0]?.reason).toBe('user_mention');
    });

    it('applies decay to consolidated memories', async () => {
      const store = new ConsolidatedMemoryStore(db);

      await store.create({
        type: 'insight',
        content: {
          summary: 'Test insight for decay',
          keyPoints: ['Point 1'],
          structuredData: {},
          lessons: [],
        },
        timespanStart: new Date().toISOString(),
        timespanEnd: new Date().toISOString(),
        sourceMemoryIds: ['mem-x'],
      });

      // Set high activation score
      await db('consolidated_memories').update({ activation_score: 0.9 });

      // Apply decay
      const decayed = await store.applyDecay(DEFAULT_ACTIVATION_CONFIG.dailyDecayRate);

      expect(decayed).toBe(1);

      // Check score decreased
      const memories = await store.getHighActivation(0, 10);
      expect(memories[0]?.activationScore).toBeLessThan(0.9);
    });

    it('boosts consolidated memory activation on access', async () => {
      const store = new ConsolidatedMemoryStore(db);

      const consolidated = await store.create({
        type: 'preference',
        content: {
          summary: 'User prefers dark mode',
          keyPoints: ['Dark mode preferred'],
          structuredData: {},
          lessons: [],
        },
        timespanStart: new Date().toISOString(),
        timespanEnd: new Date().toISOString(),
        sourceMemoryIds: ['mem-pref-1'],
      });

      // Set lower activation for testing
      await db('consolidated_memories').update({ activation_score: 0.4 });

      // Record access
      const accessed = await store.recordAccess(consolidated.id);

      expect(accessed?.activationScore).toBeGreaterThan(0.4);
    });
  });

  describe('Background Jobs Workflow', () => {
    it('runs decay job successfully', async () => {
      // Create some data to decay
      const logService = services.get(LogService);
      const activationService = new ActivationService(
        db,
        logService.child({ source: 'ActivationService' }),
        DEFAULT_ACTIVATION_CONFIG,
      );
      await activationService.ensureActivation('job-decay-mem', 0.8);

      // Set last decay to yesterday
      const yesterday = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      await db('memory_activation').update({ last_decay_at: yesterday });

      // Create stale open loop
      const staleDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
      await db('open_loops').insert({
        id: 'loop-job-stale',
        topic: 'Job test stale',
        description: 'Should be marked stale',
        activation_patterns: JSON.stringify(['test']),
        linked_memory_ids: JSON.stringify([]),
        linked_consolidated_ids: JSON.stringify([]),
        status: 'active',
        stale_after_days: 30,
        created_at: staleDate,
      });

      // Run decay job
      const jobService = new ConsolidationJobService(services);
      const report = await jobService.runDecay();

      expect(report.status).toBe('completed');
      expect(report.stats.decayUpdated).toBeGreaterThan(0);
      expect(report.stats.staleLoopsMarked).toBe(1);
    });

    it('runs consolidation job successfully', async () => {
      // Create memories to consolidate
      const now = new Date();
      for (let i = 0; i < 5; i++) {
        const createdAt = new Date(now.getTime() - (60 - i) * 24 * 60 * 60 * 1000);
        await db('memories').insert({
          id: `mem-job-cons-${i}`,
          type: 'fact',
          content: `Project Alpha update ${i}`,
          importance: 0.5,
          entity_ids: JSON.stringify([]),
          topics: JSON.stringify(['project-alpha']),
          index_status: 'hot',
          created_at: createdAt.toISOString(),
          last_accessed_at: createdAt.toISOString(),
          access_count: 0,
        });
      }

      const jobService = new ConsolidationJobService(services);
      const report = await jobService.runConsolidation();

      expect(report.status).toBe('completed');
      expect(report.stats.memoriesProcessed).toBeGreaterThanOrEqual(0);
    });

    it('provides next scheduled times', () => {
      const jobService = new ConsolidationJobService(services);
      const times = jobService.getNextScheduledTimes();

      expect(times.consolidation).toBeInstanceOf(Date);
      expect(times.decay).toBeInstanceOf(Date);
    });
  });

  describe('Memory Hints Workflow', () => {
    it('generates hints from matched open loops', async () => {
      const openLoopService = new OpenLoopService(services);

      // Create multiple open loops
      await openLoopService.create({
        topic: 'Vacation planning',
        description: 'Need to book flights for summer vacation',
        activationPatterns: ['vacation', 'flights', 'travel', 'summer'],
      });

      await openLoopService.create({
        topic: 'Birthday gift',
        description: 'Need to find birthday gift for mom',
        activationPatterns: ['birthday', 'gift', 'mom'],
      });

      // Match against message mentioning vacation
      const matched = await openLoopService.matchMessage(
        'I was thinking about our summer vacation plans and need to book flights',
      );

      expect(matched.length).toBe(1);

      // Generate hints
      const hints = openLoopService.generateHints(matched, 5);

      expect(hints.length).toBe(1);
      expect(hints[0]?.type).toBe('open_loop');
      expect(hints[0]?.hint).toContain('Vacation planning');
      expect(hints[0]?.relevanceScore).toBe(0.9);
    });
  });
});
