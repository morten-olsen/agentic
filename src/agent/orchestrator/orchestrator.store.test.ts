import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

import { Services } from '../../core/services/services.ts';
import { DatabaseService, createDatabaseService } from '../../core/database/database.ts';

import { ConversationStore } from './orchestrator.store.ts';
import type { DatabaseCheckpointer } from './orchestrator.checkpointer.ts';

describe('ConversationStore', () => {
  let services: Services;
  let store: ConversationStore;

  beforeEach(async () => {
    services = new Services();
    const db = createDatabaseService(services, { path: ':memory:' });
    services.set(DatabaseService, db);
    await db.migrate();

    store = new ConversationStore(db.knex);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('create', () => {
    it('creates a conversation with generated id', async () => {
      const conversation = await store.create();

      expect(conversation.id).toBeDefined();
      expect(typeof conversation.id).toBe('string');
      expect(conversation.messageCount).toBe(0);
    });

    it('creates a conversation with title', async () => {
      const conversation = await store.create({ title: 'Test Chat' });

      expect(conversation.title).toBe('Test Chat');
    });

    it('creates a conversation with metadata', async () => {
      const conversation = await store.create({
        title: 'Test',
        metadata: { source: 'test', priority: 1 },
      });

      expect(conversation.metadata).toEqual({ source: 'test', priority: 1 });
    });
  });

  describe('get', () => {
    it('retrieves an existing conversation', async () => {
      const created = await store.create({ title: 'Test' });
      const retrieved = await store.get(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.title).toBe('Test');
    });

    it('returns null for non-existent conversation', async () => {
      const result = await store.get('non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('updates conversation title', async () => {
      const created = await store.create({ title: 'Original' });
      const updated = await store.update(created.id, { title: 'Updated' });

      expect(updated?.title).toBe('Updated');
    });

    it('updates conversation summary', async () => {
      const created = await store.create();
      const updated = await store.update(created.id, { summary: 'A summary' });

      expect(updated?.summary).toBe('A summary');
    });

    it('updates conversation metadata', async () => {
      const created = await store.create({ metadata: { key: 'old' } });
      const updated = await store.update(created.id, { metadata: { key: 'new' } });

      expect(updated?.metadata).toEqual({ key: 'new' });
    });

    it('returns null for non-existent conversation', async () => {
      const result = await store.update('non-existent', { title: 'Test' });

      expect(result).toBeNull();
    });
  });

  describe('list', () => {
    it('returns empty array when no conversations', async () => {
      const conversations = await store.list();

      expect(conversations).toEqual([]);
    });

    it('lists conversations most recent first', async () => {
      await store.create({ title: 'First' });
      await store.create({ title: 'Second' });
      await store.create({ title: 'Third' });

      const conversations = await store.list();

      expect(conversations).toHaveLength(3);
      expect(conversations[0]?.title).toBe('Third');
      expect(conversations[1]?.title).toBe('Second');
      expect(conversations[2]?.title).toBe('First');
    });

    it('respects limit option', async () => {
      await store.create({ title: 'First' });
      await store.create({ title: 'Second' });
      await store.create({ title: 'Third' });

      const conversations = await store.list({ limit: 2 });

      expect(conversations).toHaveLength(2);
    });

    it('respects offset option', async () => {
      await store.create({ title: 'First' });
      await store.create({ title: 'Second' });
      await store.create({ title: 'Third' });

      const conversations = await store.list({ offset: 1 });

      expect(conversations).toHaveLength(2);
      expect(conversations[0]?.title).toBe('Second');
    });
  });

  describe('delete', () => {
    it('deletes an existing conversation', async () => {
      const created = await store.create();

      const deleted = await store.delete(created.id);

      expect(deleted).toBe(true);
      expect(await store.get(created.id)).toBeNull();
    });

    it('returns false for non-existent conversation', async () => {
      const deleted = await store.delete('non-existent');

      expect(deleted).toBe(false);
    });

    it('deletes checkpoints when checkpointer is set', async () => {
      const mockCheckpointer = {
        deleteThread: vi.fn().mockResolvedValue(undefined),
      } as unknown as DatabaseCheckpointer;

      store.setCheckpointer(mockCheckpointer);
      const created = await store.create();

      await store.delete(created.id);

      expect(mockCheckpointer.deleteThread).toHaveBeenCalledWith(created.id);
    });

    it('does not call checkpointer when not set', async () => {
      const created = await store.create();

      // Should not throw even without checkpointer
      await expect(store.delete(created.id)).resolves.toBe(true);
    });
  });

  describe('addMessage', () => {
    it('adds a user message', async () => {
      const conversation = await store.create();

      const message = await store.addMessage(conversation.id, {
        role: 'user',
        content: 'Hello',
      });

      expect(message.id).toBeDefined();
      expect(message.conversationId).toBe(conversation.id);
      expect(message.role).toBe('user');
      expect(message.content).toBe('Hello');
    });

    it('adds an assistant message', async () => {
      const conversation = await store.create();

      const message = await store.addMessage(conversation.id, {
        role: 'assistant',
        content: 'Hi there!',
      });

      expect(message.role).toBe('assistant');
    });

    it('increments conversation message count', async () => {
      const conversation = await store.create();
      expect(conversation.messageCount).toBe(0);

      await store.addMessage(conversation.id, { role: 'user', content: 'First' });
      await store.addMessage(conversation.id, { role: 'assistant', content: 'Second' });

      const updated = await store.get(conversation.id);
      expect(updated?.messageCount).toBe(2);
    });

    it('includes optional fields', async () => {
      const conversation = await store.create();

      const message = await store.addMessage(conversation.id, {
        role: 'assistant',
        content: 'Response',
        inputTokens: 10,
        outputTokens: 20,
      });

      expect(message.inputTokens).toBe(10);
      expect(message.outputTokens).toBe(20);
    });
  });

  describe('getMessages', () => {
    it('returns empty array for conversation with no messages', async () => {
      const conversation = await store.create();

      const messages = await store.getMessages(conversation.id);

      expect(messages).toEqual([]);
    });

    it('returns messages in chronological order', async () => {
      const conversation = await store.create();
      await store.addMessage(conversation.id, { role: 'user', content: 'First' });
      await store.addMessage(conversation.id, { role: 'assistant', content: 'Second' });
      await store.addMessage(conversation.id, { role: 'user', content: 'Third' });

      const messages = await store.getMessages(conversation.id);

      expect(messages).toHaveLength(3);
      expect(messages[0]?.content).toBe('First');
      expect(messages[1]?.content).toBe('Second');
      expect(messages[2]?.content).toBe('Third');
    });

    it('respects limit option', async () => {
      const conversation = await store.create();
      await store.addMessage(conversation.id, { role: 'user', content: 'First' });
      await store.addMessage(conversation.id, { role: 'assistant', content: 'Second' });
      await store.addMessage(conversation.id, { role: 'user', content: 'Third' });

      const messages = await store.getMessages(conversation.id, { limit: 2 });

      expect(messages).toHaveLength(2);
    });
  });

  describe('getRecentMessages', () => {
    it('returns limited number of messages in chronological order', async () => {
      const conversation = await store.create();
      await store.addMessage(conversation.id, { role: 'user', content: 'Message 1' });
      await store.addMessage(conversation.id, { role: 'assistant', content: 'Message 2' });
      await store.addMessage(conversation.id, { role: 'user', content: 'Message 3' });
      await store.addMessage(conversation.id, { role: 'assistant', content: 'Message 4' });

      const messages = await store.getRecentMessages(conversation.id, 2);

      // Should return exactly the requested limit
      expect(messages).toHaveLength(2);
      // Messages should be in chronological order (first one before second)
      const firstTimestamp = new Date(messages[0]?.createdAt ?? 0).getTime();
      const secondTimestamp = new Date(messages[1]?.createdAt ?? 0).getTime();
      expect(firstTimestamp).toBeLessThanOrEqual(secondTimestamp);
    });

    it('returns all messages if limit exceeds count', async () => {
      const conversation = await store.create();
      await store.addMessage(conversation.id, { role: 'user', content: 'Only one' });

      const messages = await store.getRecentMessages(conversation.id, 10);

      expect(messages).toHaveLength(1);
    });
  });
});
