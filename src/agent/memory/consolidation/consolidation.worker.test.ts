import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';

import { Services } from '../../../core/services/services.ts';
import { createDatabaseService, DatabaseService } from '../../../core/database/database.ts';
import { LogService } from '../../../core/logging/logging.ts';

import { ConsolidationWorker } from './consolidation.worker.ts';
import type { MemoryForConsolidation, ExtractedKnowledge } from './consolidation.service.ts';

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
    const createdAt = new Date(now.getTime() - (60 - i) * 24 * 60 * 60 * 1000); // 60 days ago to now

    await db('memories').insert({
      id: `mem-${i}`,
      type: 'fact',
      content: `Test memory ${i} about testing`,
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
// ConsolidationWorker Tests
// ============================================================================

describe('ConsolidationWorker', () => {
  let db: Knex;
  let services: Services;
  let worker: ConsolidationWorker;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = await createTestDb();
    db = setup.db;
    services = setup.services;
    cleanup = setup.cleanup;
    worker = new ConsolidationWorker(services);
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('run', () => {
    it('should complete with no memories', async () => {
      const result = await worker.run();

      expect(result.run.status).toBe('completed');
      expect(result.run.memoriesProcessed).toBe(0);
      expect(result.created.length).toBe(0);
      expect(result.updated.length).toBe(0);
      expect(result.errors.length).toBe(0);
    });

    it('should not consolidate when too few memories', async () => {
      // Create only 2 memories (below default threshold of 3)
      await createTestMemories(db, 2, { topics: ['work'] });

      const result = await worker.run();

      expect(result.run.status).toBe('completed');
      expect(result.created.length).toBe(0);
    });

    it('should consolidate memories when threshold is met', async () => {
      // Create 5 memories with the same topic
      await createTestMemories(db, 5, { topics: ['work'] });

      const result = await worker.run();

      expect(result.run.status).toBe('completed');
      expect(result.created.length).toBeGreaterThan(0);
    });

    it('should use custom knowledge extractor', async () => {
      await createTestMemories(db, 5, { topics: ['work'] });

      let extractorCalled = false;
      worker.setKnowledgeExtractor(async (): Promise<ExtractedKnowledge> => {
        extractorCalled = true;
        return {
          summary: 'Custom extracted summary',
          structuredData: { custom: true },
          keyPoints: ['Custom point 1'],
          lessons: [],
          supersededInfo: [],
        };
      });

      const result = await worker.run();

      expect(extractorCalled).toBe(true);
      expect(result.created.length).toBeGreaterThan(0);
      expect(result.created[0]?.content.summary).toBe('Custom extracted summary');
    });

    it('should use custom embedding generator', async () => {
      await createTestMemories(db, 5, { topics: ['work'] });

      let embeddingCalled = false;
      worker.setEmbeddingGenerator(async (): Promise<number[]> => {
        embeddingCalled = true;
        return [0.1, 0.2, 0.3];
      });

      const result = await worker.run();

      expect(embeddingCalled).toBe(true);
      expect(result.created[0]?.embedding).toBeDefined();
      expect(result.created[0]?.embedding?.length).toBe(3);
    });

    it('should create consolidation run record', async () => {
      await createTestMemories(db, 5, { topics: ['work'] });

      const result = await worker.run();

      expect(result.run.id).toBeDefined();
      expect(result.run.startedAt).toBeDefined();
      expect(result.run.completedAt).toBeDefined();
      expect(result.run.status).toBe('completed');
    });

    it('should mark source memories as consolidated', async () => {
      await createTestMemories(db, 5, { topics: ['work'] });

      const result = await worker.run();

      // Check that memories were marked as consolidated
      const consolidated = await db('memories').whereNotNull('consolidated_into_id');

      expect(consolidated.length).toBeGreaterThan(0);
      expect(result.created[0]?.sourceMemoryCount).toBeGreaterThan(0);
    });

    it('should handle errors gracefully', async () => {
      await createTestMemories(db, 5, { topics: ['work'] });

      // Set a failing knowledge extractor
      worker.setKnowledgeExtractor(async (): Promise<ExtractedKnowledge | null> => {
        throw new Error('Extraction failed');
      });

      const result = await worker.run();

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Extraction failed');
    });

    it('should abort after too many errors', async () => {
      // Create many memories with different topics to generate multiple groups
      const now = new Date();
      for (let i = 0; i < 30; i++) {
        const topicIndex = Math.floor(i / 5); // 5 memories per topic, 6 topics total
        const createdAt = new Date(now.getTime() - (60 - i) * 24 * 60 * 60 * 1000);
        await db('memories').insert({
          id: `mem-multi-${i}`,
          type: 'fact',
          content: `Test memory ${i} about topic ${topicIndex}`,
          importance: 0.5,
          entity_ids: JSON.stringify([]),
          topics: JSON.stringify([`topic-${topicIndex}`]),
          index_status: 'hot',
          created_at: createdAt.toISOString(),
          last_accessed_at: createdAt.toISOString(),
          access_count: 0,
        });
      }

      // Set a failing knowledge extractor
      let errorCount = 0;
      worker.setKnowledgeExtractor(async (): Promise<ExtractedKnowledge | null> => {
        errorCount++;
        throw new Error(`Error ${errorCount}`);
      });

      const result = await worker.run();

      // Should stop after max errors (default 5)
      expect(result.errors.length).toBe(5);
      expect(result.run.status).toBe('failed');
    });
  });

  describe('consolidateEntity', () => {
    it('should return null when not enough entity memories', async () => {
      await createTestMemories(db, 2, { entityIds: ['alice'] });

      const result = await worker.consolidateEntity('alice');

      expect(result).toBeNull();
    });

    it('should consolidate entity memories', async () => {
      await createTestMemories(db, 5, { entityIds: ['alice'] });

      const result = await worker.consolidateEntity('alice');

      expect(result).not.toBeNull();
      expect(result?.type).toBe('entity');
      expect(result?.entityIds).toContain('alice');
    });
  });

  describe('incrementalUpdate', () => {
    it('should return null for non-existent consolidated memory', async () => {
      const newMemories: MemoryForConsolidation[] = [
        {
          id: 'new-1',
          type: 'fact',
          content: 'New info',
          createdAt: new Date().toISOString(),
        },
      ];

      const result = await worker.incrementalUpdate('non-existent', newMemories);

      expect(result).toBeNull();
    });

    it('should update existing consolidated memory with new info', async () => {
      // First create a consolidated memory
      await createTestMemories(db, 5, { entityIds: ['alice'] });
      const initial = await worker.consolidateEntity('alice');
      expect(initial).not.toBeNull();
      if (!initial) return; // TypeScript guard

      const initialId = initial.id;
      const initialSourceCount = initial.sourceMemoryCount;

      // Now add new memories incrementally
      const newMemories: MemoryForConsolidation[] = [
        {
          id: 'new-1',
          type: 'fact',
          content: 'Alice got promoted',
          createdAt: new Date().toISOString(),
          entityIds: ['alice'],
        },
        {
          id: 'new-2',
          type: 'fact',
          content: 'Alice moved to Seattle',
          createdAt: new Date().toISOString(),
          entityIds: ['alice'],
        },
      ];

      const result = await worker.incrementalUpdate(initialId, newMemories);

      expect(result).not.toBeNull();
      expect(result?.version).toBe(2);
      expect(result?.sourceMemoryCount).toBe(initialSourceCount + 2);
    });
  });

  describe('config', () => {
    it('should use default config', () => {
      expect(worker.consolidationService).toBeDefined();
    });

    it('should allow custom config', () => {
      const customWorker = new ConsolidationWorker(services, {
        minMemoriesForConsolidation: 10,
        maxGroupsPerRun: 5,
      });

      expect(customWorker.consolidationService).toBeDefined();
    });
  });

  describe('grouping strategies', () => {
    it('should respect enableEntityConsolidation flag', async () => {
      await createTestMemories(db, 5, { entityIds: ['alice'] });

      const disabledWorker = new ConsolidationWorker(services, {
        enableEntityConsolidation: false,
        enableTopicConsolidation: true,
        enableTemporalConsolidation: false,
      });

      const result = await disabledWorker.run();

      // Should consolidate by topic instead
      for (const created of result.created) {
        expect(created.type).not.toBe('entity');
      }
    });
  });
});
