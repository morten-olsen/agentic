import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';

import { Services } from '../../../core/services/services.ts';
import { createDatabaseService, DatabaseService } from '../../../core/database/database.ts';
import { LogService } from '../../../core/logging/logging.ts';

import { ConsolidatedMemoryStore } from './consolidated.store.ts';
import { ConsolidationService } from './consolidation.service.ts';
import type { MemoryForConsolidation } from './consolidation.service.ts';

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

// ============================================================================
// ConsolidatedMemoryStore Tests
// ============================================================================

describe('ConsolidatedMemoryStore', () => {
  let db: Knex;
  let store: ConsolidatedMemoryStore;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = await createTestDb();
    db = setup.db;
    cleanup = setup.cleanup;
    store = new ConsolidatedMemoryStore(db);
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('create', () => {
    it('should create a consolidated memory', async () => {
      const consolidated = await store.create({
        type: 'entity',
        content: {
          summary: 'Test summary about Alice',
          keyPoints: ['Point 1', 'Point 2'],
        },
        timespanStart: '2024-01-01T00:00:00Z',
        timespanEnd: '2024-01-31T00:00:00Z',
        sourceMemoryIds: ['mem-1', 'mem-2', 'mem-3'],
        entityIds: ['entity-alice'],
        topics: ['work', 'project'],
      });

      expect(consolidated.id).toBeDefined();
      expect(consolidated.type).toBe('entity');
      expect(consolidated.content.summary).toBe('Test summary about Alice');
      expect(consolidated.sourceMemoryCount).toBe(3);
      expect(consolidated.version).toBe(1);
    });

    it('should store embedding as buffer', async () => {
      const embedding = [0.1, 0.2, 0.3, 0.4];
      const consolidated = await store.create({
        type: 'insight',
        content: { summary: 'Test', keyPoints: [] },
        timespanStart: '2024-01-01T00:00:00Z',
        timespanEnd: '2024-01-31T00:00:00Z',
        sourceMemoryIds: ['mem-1'],
        embedding,
      });

      expect(consolidated.embedding).toBeDefined();
      expect(consolidated.embedding?.length).toBe(4);
    });
  });

  describe('get', () => {
    it('should return null for non-existent memory', async () => {
      const result = await store.get('non-existent');
      expect(result).toBeNull();
    });

    it('should return existing memory', async () => {
      const created = await store.create({
        type: 'entity',
        content: { summary: 'Test', keyPoints: ['Point'] },
        timespanStart: '2024-01-01T00:00:00Z',
        timespanEnd: '2024-01-31T00:00:00Z',
        sourceMemoryIds: ['mem-1'],
      });

      const retrieved = await store.get(created.id);
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.content.summary).toBe('Test');
    });
  });

  describe('update', () => {
    it('should update content and increment version', async () => {
      const created = await store.create({
        type: 'entity',
        content: { summary: 'Original', keyPoints: [] },
        timespanStart: '2024-01-01T00:00:00Z',
        timespanEnd: '2024-01-31T00:00:00Z',
        sourceMemoryIds: ['mem-1'],
      });

      const updated = await store.update(created.id, {
        content: { summary: 'Updated', keyPoints: ['New point'] },
      });

      expect(updated?.content.summary).toBe('Updated');
      expect(updated?.version).toBe(2);
    });

    it('should return null for non-existent memory', async () => {
      const result = await store.update('non-existent', { activationScore: 0.9 });
      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete existing memory', async () => {
      const created = await store.create({
        type: 'entity',
        content: { summary: 'Test', keyPoints: [] },
        timespanStart: '2024-01-01T00:00:00Z',
        timespanEnd: '2024-01-31T00:00:00Z',
        sourceMemoryIds: ['mem-1'],
      });

      const deleted = await store.delete(created.id);
      expect(deleted).toBe(true);

      const retrieved = await store.get(created.id);
      expect(retrieved).toBeNull();
    });

    it('should return false for non-existent memory', async () => {
      const deleted = await store.delete('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('getByType', () => {
    it('should return memories of specified type', async () => {
      await store.create({
        type: 'entity',
        content: { summary: 'Entity 1', keyPoints: [] },
        timespanStart: '2024-01-01T00:00:00Z',
        timespanEnd: '2024-01-31T00:00:00Z',
        sourceMemoryIds: ['mem-1'],
      });
      await store.create({
        type: 'insight',
        content: { summary: 'Insight 1', keyPoints: [] },
        timespanStart: '2024-01-01T00:00:00Z',
        timespanEnd: '2024-01-31T00:00:00Z',
        sourceMemoryIds: ['mem-2'],
      });

      const entities = await store.getByType('entity');
      expect(entities.length).toBe(1);
      expect(entities[0]?.type).toBe('entity');
    });
  });

  describe('getHighActivation', () => {
    it('should return memories above threshold', async () => {
      const created = await store.create({
        type: 'entity',
        content: { summary: 'Test', keyPoints: [] },
        timespanStart: '2024-01-01T00:00:00Z',
        timespanEnd: '2024-01-31T00:00:00Z',
        sourceMemoryIds: ['mem-1'],
      });

      // Boost activation
      await store.update(created.id, { activationScore: 0.9 });

      const high = await store.getHighActivation(0.7);
      expect(high.length).toBe(1);
      expect(high[0]?.activationScore).toBe(0.9);
    });
  });

  describe('recordAccess', () => {
    it('should update last accessed time', async () => {
      const created = await store.create({
        type: 'entity',
        content: { summary: 'Test', keyPoints: [] },
        timespanStart: '2024-01-01T00:00:00Z',
        timespanEnd: '2024-01-31T00:00:00Z',
        sourceMemoryIds: ['mem-1'],
      });

      const originalAccess = created.lastAccessedAt;

      // Wait a tiny bit to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const accessed = await store.recordAccess(created.id);
      expect(accessed?.lastAccessedAt).not.toBe(originalAccess);
    });
  });

  describe('getCount', () => {
    it('should return total count', async () => {
      await store.create({
        type: 'entity',
        content: { summary: 'Test 1', keyPoints: [] },
        timespanStart: '2024-01-01T00:00:00Z',
        timespanEnd: '2024-01-31T00:00:00Z',
        sourceMemoryIds: ['mem-1'],
      });
      await store.create({
        type: 'insight',
        content: { summary: 'Test 2', keyPoints: [] },
        timespanStart: '2024-01-01T00:00:00Z',
        timespanEnd: '2024-01-31T00:00:00Z',
        sourceMemoryIds: ['mem-2'],
      });

      const count = await store.getCount();
      expect(count).toBe(2);
    });
  });
});

// ============================================================================
// ConsolidationService Tests
// ============================================================================

describe('ConsolidationService', () => {
  let services: Services;
  let service: ConsolidationService;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = await createTestDb();
    services = setup.services;
    cleanup = setup.cleanup;
    service = new ConsolidationService(services);
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('groupMemories', () => {
    const testMemories: MemoryForConsolidation[] = [
      {
        id: '1',
        type: 'fact',
        content: 'Alice works at Acme',
        createdAt: '2024-01-15T10:00:00Z',
        entityIds: ['alice'],
        topics: ['work'],
      },
      {
        id: '2',
        type: 'fact',
        content: 'Alice likes coffee',
        createdAt: '2024-01-16T10:00:00Z',
        entityIds: ['alice'],
        topics: ['preferences'],
      },
      {
        id: '3',
        type: 'fact',
        content: 'Alice finished the project',
        createdAt: '2024-01-17T10:00:00Z',
        entityIds: ['alice'],
        topics: ['work'],
      },
      {
        id: '4',
        type: 'fact',
        content: 'Bob joined the team',
        createdAt: '2024-01-18T10:00:00Z',
        entityIds: ['bob'],
        topics: ['work'],
      },
      {
        id: '5',
        type: 'fact',
        content: 'Bob is from Seattle',
        createdAt: '2024-01-19T10:00:00Z',
        entityIds: ['bob'],
        topics: ['location'],
      },
    ];

    it('should group by entity', async () => {
      const groups = await service.groupMemories(testMemories, 'entity');

      // Should have groups for alice (3 memories) but not bob (only 2)
      expect(groups.length).toBe(1);
      expect(groups[0]?.groupKey).toBe('entity:alice');
      expect(groups[0]?.memories.length).toBe(3);
    });

    it('should group by topic', async () => {
      const groups = await service.groupMemories(testMemories, 'topic');

      // Should have group for 'work' (3 memories)
      expect(groups.length).toBe(1);
      expect(groups[0]?.groupKey).toBe('topic:work');
    });

    it('should group by temporal period', async () => {
      // Create memories spanning multiple periods
      const temporalMemories: MemoryForConsolidation[] = [];
      for (let i = 0; i < 5; i++) {
        temporalMemories.push({
          id: `mem-${i}`,
          type: 'fact',
          content: `Memory ${i}`,
          createdAt: `2024-01-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
        });
      }

      const groups = await service.groupMemories(temporalMemories, 'temporal');

      // With default 30-day periods and 5 memories in the same month, should have 1 group
      expect(groups.length).toBe(1);
      expect(groups[0]?.groupingReason).toBe('same_period');
    });
  });

  describe('generateExtractionPrompt', () => {
    it('should generate a valid prompt', () => {
      const memories: MemoryForConsolidation[] = [
        { id: '1', type: 'fact', content: 'Alice works at Acme', createdAt: '2024-01-15T10:00:00Z' },
        { id: '2', type: 'fact', content: 'Alice is a developer', createdAt: '2024-01-16T10:00:00Z' },
      ];

      const prompt = service.generateExtractionPrompt('entity:alice', memories);

      expect(prompt).toContain('entity:alice');
      expect(prompt).toContain('Alice works at Acme');
      expect(prompt).toContain('Alice is a developer');
      expect(prompt).toContain('JSON format');
    });
  });

  describe('parseExtractedKnowledge', () => {
    it('should parse valid JSON response', () => {
      const response = `Here is the analysis:
{
  "summary": "Alice is a developer at Acme",
  "structuredData": {"job": "developer", "company": "Acme"},
  "keyPoints": ["Works at Acme", "Is a developer"],
  "lessons": [],
  "supersededInfo": []
}`;

      const result = service.parseExtractedKnowledge(response);

      expect(result).not.toBeNull();
      expect(result?.summary).toBe('Alice is a developer at Acme');
      expect(result?.keyPoints.length).toBe(2);
    });

    it('should return null for invalid response', () => {
      const result = service.parseExtractedKnowledge('This is not JSON');
      expect(result).toBeNull();
    });
  });

  describe('createConsolidated', () => {
    it('should create a consolidated memory from group and extraction', async () => {
      const group = {
        groupKey: 'entity:alice',
        groupingReason: 'same_entity' as const,
        memories: [
          {
            id: '1',
            type: 'fact',
            content: 'Alice works at Acme',
            createdAt: '2024-01-15T10:00:00Z',
            entityIds: ['alice'],
          },
          {
            id: '2',
            type: 'fact',
            content: 'Alice is a developer',
            createdAt: '2024-01-16T10:00:00Z',
            entityIds: ['alice'],
          },
          {
            id: '3',
            type: 'fact',
            content: 'Alice finished the project',
            createdAt: '2024-01-17T10:00:00Z',
            entityIds: ['alice'],
          },
        ],
      };

      const extracted = {
        summary: 'Alice is a developer at Acme who completed a project',
        structuredData: { job: 'developer', company: 'Acme' },
        keyPoints: ['Works at Acme', 'Is a developer', 'Completed project'],
        lessons: [],
        supersededInfo: [],
      };

      const consolidated = await service.createConsolidated(group, extracted);

      expect(consolidated.type).toBe('entity');
      expect(consolidated.content.summary).toBe('Alice is a developer at Acme who completed a project');
      expect(consolidated.sourceMemoryCount).toBe(3);
      expect(consolidated.entityIds).toContain('alice');
    });
  });

  describe('run tracking', () => {
    it('should create and update consolidation run', async () => {
      const run = await service.createRun();

      expect(run.status).toBe('running');
      expect(run.memoriesProcessed).toBe(0);

      await service.updateRun(run.id, {
        status: 'completed',
        memoriesProcessed: 10,
        consolidatedCreated: 2,
      });

      const latest = await service.getLatestRun();

      expect(latest?.status).toBe('completed');
      expect(latest?.memoriesProcessed).toBe(10);
      expect(latest?.consolidatedCreated).toBe(2);
      expect(latest?.completedAt).toBeDefined();
    });
  });
});
