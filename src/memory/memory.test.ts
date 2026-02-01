import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { HumanMessage, AIMessage } from '@langchain/core/messages';

import { Services } from '../services/services.ts';
import { createDatabaseService, DatabaseService } from '../database/database.ts';
import { createMemoryRetrieverNode } from '../orchestrator/orchestrator.nodes.ts';

import { MemoryService, MemoryNotFoundError, cosineSimilarity } from './memory.ts';
import type { CreateMemoryInput } from './memory.schemas.ts';
import {
  createMemory,
  getMemory,
  updateMemory,
  deleteMemory,
  listMemories,
  updateAccess,
  getRecentTopics,
  reinforceMemory,
  serializeEmbedding,
  deserializeEmbedding,
} from './memory.store.ts';

describe('Memory Module', () => {
  let services: Services;
  let db: DatabaseService;

  beforeEach(async () => {
    services = new Services();
    db = createDatabaseService(services, { path: ':memory:' });
    services.set(DatabaseService, db);
    await db.migrate();
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('Database Migration', () => {
    it('creates memories table with correct columns', async () => {
      const columns = await db.knex('memories').columnInfo();

      expect(columns).toHaveProperty('id');
      expect(columns).toHaveProperty('type');
      expect(columns).toHaveProperty('content');
      expect(columns).toHaveProperty('embedding');
      expect(columns).toHaveProperty('metadata');
      expect(columns).toHaveProperty('importance');
      expect(columns).toHaveProperty('created_at');
      expect(columns).toHaveProperty('last_accessed_at');
      expect(columns).toHaveProperty('access_count');
    });
  });

  describe('Embedding Serialization', () => {
    it('serializes and deserializes embeddings correctly', () => {
      const original = [0.1, 0.2, 0.3, -0.5, 0.0, 1.0];
      const serialized = serializeEmbedding(original);
      const deserialized = deserializeEmbedding(serialized);

      expect(deserialized).toHaveLength(original.length);
      for (let i = 0; i < original.length; i++) {
        expect(deserialized[i]).toBeCloseTo(original[i] ?? 0, 5);
      }
    });

    it('handles empty array', () => {
      const original: number[] = [];
      const serialized = serializeEmbedding(original);
      const deserialized = deserializeEmbedding(serialized);

      expect(deserialized).toHaveLength(0);
    });

    it('handles large embeddings', () => {
      const original = Array.from({ length: 1536 }, (_, i) => Math.sin(i));
      const serialized = serializeEmbedding(original);
      const deserialized = deserializeEmbedding(serialized);

      expect(deserialized).toHaveLength(1536);
      for (let i = 0; i < 10; i++) {
        expect(deserialized[i]).toBeCloseTo(original[i] ?? 0, 5);
      }
    });
  });

  describe('Cosine Similarity', () => {
    it('returns 1 for identical vectors', () => {
      const vec = [0.5, 0.5, 0.5];
      expect(cosineSimilarity(vec, vec)).toBeCloseTo(1.0);
    });

    it('returns -1 for opposite vectors', () => {
      const vec1 = [1, 0, 0];
      const vec2 = [-1, 0, 0];
      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(-1.0);
    });

    it('returns 0 for orthogonal vectors', () => {
      const vec1 = [1, 0, 0];
      const vec2 = [0, 1, 0];
      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(0.0);
    });

    it('throws for mismatched dimensions', () => {
      const vec1 = [1, 0, 0];
      const vec2 = [1, 0];
      expect(() => cosineSimilarity(vec1, vec2)).toThrow('dimension mismatch');
    });

    it('returns 0 for zero vectors', () => {
      const vec1 = [0, 0, 0];
      const vec2 = [1, 2, 3];
      expect(cosineSimilarity(vec1, vec2)).toBe(0);
    });
  });

  describe('Memory Store', () => {
    const knex = () => db.knex;

    describe('createMemory', () => {
      it('creates a memory without embedding', async () => {
        const input: CreateMemoryInput = {
          type: 'fact',
          content: 'The user lives in San Francisco',
        };

        const memory = await createMemory(knex(), input);

        expect(memory.id).toBeDefined();
        expect(memory.type).toBe('fact');
        expect(memory.content).toBe('The user lives in San Francisco');
        expect(memory.embedding).toBeUndefined();
        expect(memory.importance).toBe(0.5);
        expect(memory.accessCount).toBe(0);
      });

      it('creates a memory with embedding', async () => {
        const input: CreateMemoryInput = {
          type: 'fact',
          content: 'Test content',
        };
        const embedding = [0.1, 0.2, 0.3];

        const memory = await createMemory(knex(), input, embedding);

        expect(memory.embedding).toBeDefined();
        expect(memory.embedding).toHaveLength(3);
      });

      it('creates a memory with custom importance', async () => {
        const input: CreateMemoryInput = {
          type: 'preference',
          content: 'Prefers dark mode',
          importance: 0.9,
        };

        const memory = await createMemory(knex(), input);

        expect(memory.importance).toBe(0.9);
      });

      it('creates a memory with metadata', async () => {
        const input: CreateMemoryInput = {
          type: 'event',
          content: 'Meeting with Bob',
          metadata: { conversationId: 'conv-123', source: 'calendar' },
        };

        const memory = await createMemory(knex(), input);

        expect(memory.metadata).toEqual({ conversationId: 'conv-123', source: 'calendar' });
      });
    });

    describe('getMemory', () => {
      it('returns null for non-existent memory', async () => {
        const result = await getMemory(knex(), 'non-existent');
        expect(result).toBeNull();
      });

      it('returns memory by ID', async () => {
        const created = await createMemory(knex(), {
          type: 'fact',
          content: 'Test fact',
        });

        const retrieved = await getMemory(knex(), created.id);

        expect(retrieved).not.toBeNull();
        expect(retrieved?.id).toBe(created.id);
        expect(retrieved?.content).toBe('Test fact');
      });
    });

    describe('updateMemory', () => {
      it('returns null for non-existent memory', async () => {
        const result = await updateMemory(knex(), 'non-existent', { content: 'new' });
        expect(result).toBeNull();
      });

      it('updates content', async () => {
        const created = await createMemory(knex(), {
          type: 'fact',
          content: 'Original content',
        });

        const updated = await updateMemory(knex(), created.id, {
          content: 'Updated content',
        });

        expect(updated?.content).toBe('Updated content');
      });

      it('updates importance', async () => {
        const created = await createMemory(knex(), {
          type: 'fact',
          content: 'Test',
          importance: 0.5,
        });

        const updated = await updateMemory(knex(), created.id, {
          importance: 0.8,
        });

        expect(updated?.importance).toBe(0.8);
      });

      it('updates embedding', async () => {
        const created = await createMemory(knex(), {
          type: 'fact',
          content: 'Test',
        });

        const updated = await updateMemory(knex(), created.id, {
          embedding: [0.1, 0.2, 0.3],
        });

        expect(updated?.embedding).toHaveLength(3);
      });
    });

    describe('deleteMemory', () => {
      it('returns false for non-existent memory', async () => {
        const result = await deleteMemory(knex(), 'non-existent');
        expect(result).toBe(false);
      });

      it('deletes memory', async () => {
        const created = await createMemory(knex(), {
          type: 'fact',
          content: 'To be deleted',
        });

        const deleted = await deleteMemory(knex(), created.id);
        expect(deleted).toBe(true);

        const retrieved = await getMemory(knex(), created.id);
        expect(retrieved).toBeNull();
      });
    });

    describe('listMemories', () => {
      beforeEach(async () => {
        // Create some test memories
        await createMemory(knex(), { type: 'fact', content: 'Fact 1', importance: 0.5 });
        await createMemory(knex(), { type: 'fact', content: 'Fact 2', importance: 0.8 });
        await createMemory(knex(), { type: 'preference', content: 'Pref 1', importance: 0.9 });
        await createMemory(knex(), { type: 'conversation', content: 'Conv 1', importance: 0.3 });
      });

      it('lists all memories', async () => {
        const memories = await listMemories(knex());
        expect(memories).toHaveLength(4);
      });

      it('filters by type', async () => {
        const facts = await listMemories(knex(), { types: ['fact'] });
        expect(facts).toHaveLength(2);
        expect(facts.every((m) => m.type === 'fact')).toBe(true);
      });

      it('filters by multiple types', async () => {
        const memories = await listMemories(knex(), { types: ['fact', 'preference'] });
        expect(memories).toHaveLength(3);
      });

      it('filters by minimum importance', async () => {
        const important = await listMemories(knex(), { minImportance: 0.7 });
        expect(important).toHaveLength(2);
        expect(important.every((m) => m.importance >= 0.7)).toBe(true);
      });

      it('limits results', async () => {
        const limited = await listMemories(knex(), { limit: 2 });
        expect(limited).toHaveLength(2);
      });
    });

    describe('updateAccess', () => {
      it('updates last accessed time and count', async () => {
        const created = await createMemory(knex(), {
          type: 'fact',
          content: 'Test',
        });

        expect(created.accessCount).toBe(0);

        await updateAccess(knex(), created.id);

        const updated = await getMemory(knex(), created.id);
        expect(updated?.accessCount).toBe(1);
        expect(new Date(updated?.lastAccessedAt ?? '').getTime()).toBeGreaterThanOrEqual(
          new Date(created.lastAccessedAt).getTime(),
        );
      });
    });

    describe('getRecentTopics', () => {
      it('returns empty array when no memories', async () => {
        const topics = await getRecentTopics(knex());
        expect(topics).toEqual([]);
      });

      it('returns recent conversation and fact topics', async () => {
        await createMemory(knex(), { type: 'conversation', content: 'Topic A' });
        await createMemory(knex(), { type: 'fact', content: 'Topic B' });
        await createMemory(knex(), { type: 'preference', content: 'Should not appear' });

        const topics = await getRecentTopics(knex(), 5);

        expect(topics).toContain('Topic A');
        expect(topics).toContain('Topic B');
        expect(topics).not.toContain('Should not appear');
      });
    });

    describe('reinforceMemory', () => {
      it('returns null for non-existent memory', async () => {
        const result = await reinforceMemory(knex(), 'non-existent');
        expect(result).toBeNull();
      });

      it('increases importance', async () => {
        const created = await createMemory(knex(), {
          type: 'fact',
          content: 'Test',
          importance: 0.5,
        });

        const reinforced = await reinforceMemory(knex(), created.id);

        expect(reinforced?.importance).toBe(0.6);
      });

      it('caps importance at 1.0', async () => {
        const created = await createMemory(knex(), {
          type: 'fact',
          content: 'Test',
          importance: 0.95,
        });

        const reinforced = await reinforceMemory(knex(), created.id);

        expect(reinforced?.importance).toBe(1.0);
      });

      it('updates access count', async () => {
        const created = await createMemory(knex(), {
          type: 'fact',
          content: 'Test',
        });

        const reinforced = await reinforceMemory(knex(), created.id);

        expect(reinforced?.accessCount).toBe(1);
      });
    });
  });

  describe('MemoryService', () => {
    let memoryService: MemoryService;

    beforeEach(() => {
      memoryService = new MemoryService(services);
    });

    describe('remember', () => {
      it('stores a memory without embedding when not configured', async () => {
        const memory = await memoryService.remember({
          type: 'fact',
          content: 'User prefers coffee',
        });

        expect(memory.id).toBeDefined();
        expect(memory.content).toBe('User prefers coffee');
        expect(memory.embedding).toBeUndefined();
      });

      it('stores memory with custom importance', async () => {
        const memory = await memoryService.remember({
          type: 'preference',
          content: 'Likes dark mode',
          importance: 0.9,
        });

        expect(memory.importance).toBe(0.9);
      });
    });

    describe('recall', () => {
      beforeEach(async () => {
        // Create some test memories
        await memoryService.remember({ type: 'fact', content: 'User lives in New York' });
        await memoryService.remember({ type: 'fact', content: 'User works as an engineer' });
        await memoryService.remember({ type: 'preference', content: 'Prefers morning meetings' });
      });

      it('returns memories by recency when not configured', async () => {
        const memories = await memoryService.recall('Where does the user live?');

        expect(memories.length).toBeGreaterThan(0);
      });

      it('respects limit option', async () => {
        const memories = await memoryService.recall('test', { limit: 1 });

        expect(memories).toHaveLength(1);
      });

      it('filters by type', async () => {
        const memories = await memoryService.recall('test', { types: ['preference'] });

        expect(memories).toHaveLength(1);
        expect(memories[0]?.type).toBe('preference');
      });
    });

    describe('recallByType', () => {
      beforeEach(async () => {
        await memoryService.remember({ type: 'fact', content: 'Fact 1' });
        await memoryService.remember({ type: 'fact', content: 'Fact 2' });
        await memoryService.remember({ type: 'preference', content: 'Pref 1' });
      });

      it('returns only memories of specified type', async () => {
        const facts = await memoryService.recallByType('fact');

        expect(facts).toHaveLength(2);
        expect(facts.every((m) => m.type === 'fact')).toBe(true);
      });
    });

    describe('get', () => {
      it('returns memory by ID', async () => {
        const created = await memoryService.remember({
          type: 'fact',
          content: 'Test content',
        });

        const retrieved = await memoryService.get(created.id);

        expect(retrieved).not.toBeNull();
        expect(retrieved?.content).toBe('Test content');
      });

      it('returns null for non-existent ID', async () => {
        const result = await memoryService.get('non-existent');
        expect(result).toBeNull();
      });
    });

    describe('reinforce', () => {
      it('increases memory importance', async () => {
        const created = await memoryService.remember({
          type: 'fact',
          content: 'Important fact',
          importance: 0.5,
        });

        const reinforced = await memoryService.reinforce(created.id);

        expect(reinforced.importance).toBeGreaterThan(0.5);
      });

      it('throws for non-existent memory', async () => {
        await expect(memoryService.reinforce('non-existent')).rejects.toThrow(MemoryNotFoundError);
      });
    });

    describe('correct', () => {
      it('updates memory content', async () => {
        const created = await memoryService.remember({
          type: 'fact',
          content: 'User likes tea',
        });

        const corrected = await memoryService.correct(created.id, 'User likes coffee');

        expect(corrected.content).toBe('User likes coffee');
      });

      it('throws for non-existent memory', async () => {
        await expect(memoryService.correct('non-existent', 'new content')).rejects.toThrow(MemoryNotFoundError);
      });
    });

    describe('forget', () => {
      it('deletes memory', async () => {
        const created = await memoryService.remember({
          type: 'fact',
          content: 'Temporary memory',
        });

        const deleted = await memoryService.forget(created.id);
        expect(deleted).toBe(true);

        const retrieved = await memoryService.get(created.id);
        expect(retrieved).toBeNull();
      });

      it('returns false for non-existent memory', async () => {
        const result = await memoryService.forget('non-existent');
        expect(result).toBe(false);
      });
    });

    describe('getRecentTopics', () => {
      it('returns recent topics from memories', async () => {
        await memoryService.remember({ type: 'conversation', content: 'Discussed project planning' });
        await memoryService.remember({ type: 'fact', content: 'User mentioned vacation plans' });

        const topics = await memoryService.getRecentTopics();

        expect(topics.length).toBeGreaterThan(0);
      });
    });

    describe('list', () => {
      it('lists all memories', async () => {
        await memoryService.remember({ type: 'fact', content: 'Fact 1' });
        await memoryService.remember({ type: 'preference', content: 'Pref 1' });

        const memories = await memoryService.list();

        expect(memories).toHaveLength(2);
      });
    });

    describe('rememberBatch', () => {
      it('stores multiple memories', async () => {
        const inputs: CreateMemoryInput[] = [
          { type: 'fact', content: 'Fact 1' },
          { type: 'fact', content: 'Fact 2' },
          { type: 'preference', content: 'Pref 1' },
        ];

        const memories = await memoryService.rememberBatch(inputs);

        expect(memories).toHaveLength(3);
      });

      it('returns empty array for empty input', async () => {
        const memories = await memoryService.rememberBatch([]);
        expect(memories).toEqual([]);
      });
    });

    describe('isConfigured', () => {
      it('returns false when not configured', () => {
        expect(memoryService.isConfigured).toBe(false);
      });
    });
  });

  describe('Memory Retriever Node', () => {
    let memoryService: MemoryService;

    beforeEach(async () => {
      memoryService = new MemoryService(services);
      // Add some test memories
      await memoryService.remember({ type: 'fact', content: 'User prefers TypeScript' });
      await memoryService.remember({ type: 'preference', content: 'Likes functional programming' });
    });

    describe('createMemoryRetrieverNode', () => {
      it('returns empty context when no memory service', async () => {
        const node = createMemoryRetrieverNode();
        const state = {
          messages: [new HumanMessage('Hello')],
          conversationId: 'test',
          activeToolSets: [],
          currentTaskId: null,
          pendingToolCall: null,
          approvedToolCalls: [],
          interruptRequired: false,
          currentInterrupt: null,
          memoryContext: [],
          turnCount: 0,
          maxTurns: 20,
          turnLimitReached: false,
        };

        const result = await node(state);

        expect(result.memoryContext).toEqual([]);
      });

      it('returns empty context when no user message', async () => {
        const node = createMemoryRetrieverNode(memoryService);
        const state = {
          messages: [new AIMessage('Hello')],
          conversationId: 'test',
          activeToolSets: [],
          currentTaskId: null,
          pendingToolCall: null,
          approvedToolCalls: [],
          interruptRequired: false,
          currentInterrupt: null,
          memoryContext: [],
          turnCount: 0,
          maxTurns: 20,
          turnLimitReached: false,
        };

        const result = await node(state);

        expect(result.memoryContext).toEqual([]);
      });

      it('retrieves memories based on user query', async () => {
        const node = createMemoryRetrieverNode(memoryService);
        const state = {
          messages: [new HumanMessage('What programming language do I like?')],
          conversationId: 'test',
          activeToolSets: [],
          currentTaskId: null,
          pendingToolCall: null,
          approvedToolCalls: [],
          interruptRequired: false,
          currentInterrupt: null,
          memoryContext: [],
          turnCount: 0,
          maxTurns: 20,
          turnLimitReached: false,
        };

        const result = await node(state);

        expect(result.memoryContext).toBeDefined();
        expect(Array.isArray(result.memoryContext)).toBe(true);
      });

      it('formats memories with type prefix', async () => {
        const node = createMemoryRetrieverNode(memoryService);
        const state = {
          messages: [new HumanMessage('TypeScript')],
          conversationId: 'test',
          activeToolSets: [],
          currentTaskId: null,
          pendingToolCall: null,
          approvedToolCalls: [],
          interruptRequired: false,
          currentInterrupt: null,
          memoryContext: [],
          turnCount: 0,
          maxTurns: 20,
          turnLimitReached: false,
        };

        const result = await node(state);

        if (result.memoryContext && result.memoryContext.length > 0) {
          expect(result.memoryContext[0]).toMatch(/^\[.+\]/);
        }
      });
    });
  });
});
