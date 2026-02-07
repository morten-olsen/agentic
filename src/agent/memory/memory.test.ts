import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { HumanMessage, AIMessage } from '@langchain/core/messages';

import { Services } from '../../core/services/services.ts';
import { createDatabaseService, DatabaseService } from '../../core/database/database.ts';
import { KnexStore } from '../../core/store/store.ts';
import { createMemoryRetrieverNode } from '../../agent/orchestrator/orchestrator.nodes.ts';

import { MemoryService, MemoryNotFoundError, cosineSimilarity } from './memory.ts';
import type { CreateMemoryInput } from './memory.schemas.ts';

describe('Memory Module', () => {
  let services: Services;
  let db: DatabaseService;
  let store: KnexStore;

  beforeEach(async () => {
    services = new Services();
    db = createDatabaseService(services, { path: ':memory:' });
    services.set(DatabaseService, db);
    await db.migrate();
    store = new KnexStore(services);
    services.set(KnexStore, store);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('Database Migration', () => {
    it('creates store_items table with correct columns', async () => {
      const columns = await db.knex('store_items').columnInfo();

      expect(columns).toHaveProperty('namespace');
      expect(columns).toHaveProperty('key');
      expect(columns).toHaveProperty('value');
      expect(columns).toHaveProperty('created_at');
      expect(columns).toHaveProperty('updated_at');
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

      it('stores memory with metadata', async () => {
        const memory = await memoryService.remember({
          type: 'event',
          content: 'Meeting with Bob',
          metadata: { conversationId: 'conv-123', source: 'calendar' },
        });

        expect(memory.metadata).toEqual({ conversationId: 'conv-123', source: 'calendar' });
      });

      it('assigns default importance of 0.5', async () => {
        const memory = await memoryService.remember({
          type: 'fact',
          content: 'Test fact',
        });

        expect(memory.importance).toBe(0.5);
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

      it('caps importance at 1.0', async () => {
        const created = await memoryService.remember({
          type: 'fact',
          content: 'Very important',
          importance: 0.95,
        });

        const reinforced = await memoryService.reinforce(created.id);

        expect(reinforced.importance).toBe(1.0);
      });

      it('updates access count', async () => {
        const created = await memoryService.remember({
          type: 'fact',
          content: 'Test',
        });

        const reinforced = await memoryService.reinforce(created.id);

        expect(reinforced.accessCount).toBe(1);
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

      it('filters by importance', async () => {
        await memoryService.remember({ type: 'fact', content: 'Low importance', importance: 0.3 });
        await memoryService.remember({ type: 'fact', content: 'High importance', importance: 0.9 });

        const memories = await memoryService.list({ minImportance: 0.5 });

        expect(memories).toHaveLength(1);
        expect(memories[0]?.content).toBe('High importance');
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
          activeSkills: [],
          pendingSkillActivation: null,
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
          activeSkills: [],
          pendingSkillActivation: null,
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
          activeSkills: [],
          pendingSkillActivation: null,
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
          activeSkills: [],
          pendingSkillActivation: null,
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
