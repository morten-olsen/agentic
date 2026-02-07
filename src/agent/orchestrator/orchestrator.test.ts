import { describe, it, beforeEach, afterEach, expect } from 'vitest';

import { Services } from '../../core/services/services.ts';
import { DatabaseService, createDatabaseService } from '../../core/database/database.ts';
import { UserModelService } from '../../domain/user-model/user-model.ts';
import { LocationService } from '../../domain/location/location.ts';
import { CalendarService } from '../../domain/calendar/calendar.ts';
import { ContextBuilderService } from '../../agent/context/context.ts';
import { PersonalityService } from '../../agent/personality/personality.ts';

import { OrchestratorService, OrchestratorNotConfiguredError, ConversationNotFoundError } from './orchestrator.ts';

describe('OrchestratorService', () => {
  let services: Services;

  beforeEach(async () => {
    services = new Services();
    const db = createDatabaseService(services, { path: ':memory:' });
    services.set(DatabaseService, db);
    await db.migrate();

    // Initialize required services
    services.get(UserModelService);
    services.get(LocationService);
    services.get(CalendarService);
    services.get(ContextBuilderService);
    services.get(PersonalityService);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('configuration', () => {
    it('starts unconfigured', () => {
      const orchestrator = new OrchestratorService(services);
      expect(orchestrator.isConfigured).toBe(false);
    });

    it('becomes configured after configure()', () => {
      const orchestrator = new OrchestratorService(services);
      orchestrator.configure({
        llm: {
          apiKey: 'test-key',
        },
      });
      expect(orchestrator.isConfigured).toBe(true);
    });

    it('throws when accessing toolRegistry before configure()', () => {
      const orchestrator = new OrchestratorService(services);
      expect(() => orchestrator.toolRegistry).toThrow(OrchestratorNotConfiguredError);
    });

    it('provides toolRegistry after configure()', () => {
      const orchestrator = new OrchestratorService(services);
      orchestrator.configure({ llm: { apiKey: 'test-key' } });
      expect(orchestrator.toolRegistry).toBeDefined();
      expect(orchestrator.toolRegistry.has('builtin.echo')).toBe(true);
    });
  });

  describe('conversation management', () => {
    let orchestrator: OrchestratorService;

    beforeEach(() => {
      orchestrator = new OrchestratorService(services);
      orchestrator.configure({ llm: { apiKey: 'test-key' } });
    });

    it('creates a conversation', async () => {
      const id = await orchestrator.startConversation();
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
    });

    it('creates a conversation with title', async () => {
      const id = await orchestrator.startConversation({ title: 'Test Chat' });
      const conversation = await orchestrator.getConversation(id);
      expect(conversation?.title).toBe('Test Chat');
    });

    it('retrieves a conversation', async () => {
      const id = await orchestrator.startConversation({ title: 'Test' });
      const conversation = await orchestrator.getConversation(id);

      expect(conversation).toBeDefined();
      expect(conversation?.id).toBe(id);
      expect(conversation?.title).toBe('Test');
      expect(conversation?.messageCount).toBe(0);
    });

    it('returns null for non-existent conversation', async () => {
      const conversation = await orchestrator.getConversation('non-existent');
      expect(conversation).toBeNull();
    });

    it('lists conversations', async () => {
      await orchestrator.startConversation({ title: 'First' });
      await orchestrator.startConversation({ title: 'Second' });

      const conversations = await orchestrator.listConversations();
      expect(conversations).toHaveLength(2);
      // Most recent first
      expect(conversations[0]?.title).toBe('Second');
      expect(conversations[1]?.title).toBe('First');
    });

    it('lists conversations with limit', async () => {
      await orchestrator.startConversation({ title: 'First' });
      await orchestrator.startConversation({ title: 'Second' });
      await orchestrator.startConversation({ title: 'Third' });

      const conversations = await orchestrator.listConversations({ limit: 2 });
      expect(conversations).toHaveLength(2);
    });

    it('deletes a conversation', async () => {
      const id = await orchestrator.startConversation();
      expect(await orchestrator.getConversation(id)).not.toBeNull();

      const deleted = await orchestrator.deleteConversation(id);
      expect(deleted).toBe(true);
      expect(await orchestrator.getConversation(id)).toBeNull();
    });

    it('returns false when deleting non-existent conversation', async () => {
      const deleted = await orchestrator.deleteConversation('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('message history', () => {
    let orchestrator: OrchestratorService;

    beforeEach(() => {
      orchestrator = new OrchestratorService(services);
      orchestrator.configure({ llm: { apiKey: 'test-key' } });
    });

    it('returns empty history for new conversation', async () => {
      const id = await orchestrator.startConversation();
      const history = await orchestrator.getHistory(id);
      expect(history).toEqual([]);
    });
  });

  describe('chat', () => {
    let orchestrator: OrchestratorService;

    beforeEach(() => {
      orchestrator = new OrchestratorService(services);
    });

    it('throws when not configured', async () => {
      const id = await orchestrator.startConversation();

      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of orchestrator.chat(id, 'Hello')) {
          // consume
        }
      }).rejects.toThrow(OrchestratorNotConfiguredError);
    });

    it('throws for non-existent conversation', async () => {
      orchestrator.configure({ llm: { apiKey: 'test-key' } });

      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of orchestrator.chat('non-existent', 'Hello')) {
          // consume
        }
      }).rejects.toThrow(ConversationNotFoundError);
    });

    // Note: Actual LLM interaction tests would require mocking the ChatOpenAI class
    // or using an integration test with a real API key
  });

  describe('getState', () => {
    let orchestrator: OrchestratorService;

    beforeEach(() => {
      orchestrator = new OrchestratorService(services);
      orchestrator.configure({ llm: { apiKey: 'test-key' } });
    });

    it('returns empty/default state for conversation without prior graph execution', async () => {
      const id = await orchestrator.startConversation();
      const state = await orchestrator.getState(id);
      // LangGraph returns empty object or null depending on checkpointer state
      expect(state === null || (typeof state === 'object' && Object.keys(state as object).length === 0)).toBe(true);
    });
  });
});
