import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { Services } from '../../services/services.ts';
import { DatabaseService, createDatabaseService } from '../../database/database.ts';

import type { TelegramChat, CreateTelegramChatInput } from './telegram.schemas.ts';
import { telegramConfigSchema, telegramChatSchema, createTelegramChatInputSchema } from './telegram.schemas.ts';
import {
  createTelegramChat,
  getTelegramChat,
  getTelegramChatByConversation,
  updateLastActivity,
  deleteTelegramChat,
  listTelegramChatsByUser,
} from './telegram.store.ts';
import {
  formatInterruptMessage,
  parseCallbackData,
  createWelcomeMessage,
  createHelpMessage,
  createUnauthorizedMessage,
} from './telegram.handlers.ts';

describe('telegram.schemas', () => {
  describe('telegramConfigSchema', () => {
    it('should validate valid config', () => {
      const config = {
        botToken: '123456:ABC-DEF',
        ownerId: 12345678,
      };

      const result = telegramConfigSchema.parse(config);
      expect(result).toEqual(config);
    });

    it('should reject empty bot token', () => {
      const config = {
        botToken: '',
        ownerId: 12345678,
      };

      expect(() => telegramConfigSchema.parse(config)).toThrow();
    });

    it('should reject negative owner ID', () => {
      const config = {
        botToken: '123456:ABC-DEF',
        ownerId: -1,
      };

      expect(() => telegramConfigSchema.parse(config)).toThrow();
    });
  });

  describe('telegramChatSchema', () => {
    it('should validate valid chat', () => {
      const chat: TelegramChat = {
        telegramChatId: 123,
        telegramUserId: 456,
        conversationId: 'conv-123',
        createdAt: '2024-01-01T00:00:00.000Z',
        lastActivityAt: '2024-01-01T00:00:00.000Z',
      };

      const result = telegramChatSchema.parse(chat);
      expect(result).toEqual(chat);
    });
  });

  describe('createTelegramChatInputSchema', () => {
    it('should validate valid input', () => {
      const input: CreateTelegramChatInput = {
        telegramChatId: 123,
        telegramUserId: 456,
        conversationId: 'conv-123',
      };

      const result = createTelegramChatInputSchema.parse(input);
      expect(result).toEqual(input);
    });
  });
});

describe('telegram.store', () => {
  let services: Services;
  let db: DatabaseService;

  beforeEach(async () => {
    services = new Services();
    db = createDatabaseService(services, { path: ':memory:' });
    services.set(DatabaseService, db);
    await db.migrate();

    // Create a test conversation for foreign key
    await db.knex('conversations').insert({
      id: 'test-conv-1',
      title: 'Test Conversation',
      started_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      message_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await db.knex('conversations').insert({
      id: 'test-conv-2',
      title: 'Test Conversation 2',
      started_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      message_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('createTelegramChat', () => {
    it('should create a chat mapping', async () => {
      const input: CreateTelegramChatInput = {
        telegramChatId: 123,
        telegramUserId: 456,
        conversationId: 'test-conv-1',
      };

      const chat = await createTelegramChat(db.knex, input);

      expect(chat.telegramChatId).toBe(123);
      expect(chat.telegramUserId).toBe(456);
      expect(chat.conversationId).toBe('test-conv-1');
      expect(chat.createdAt).toBeDefined();
      expect(chat.lastActivityAt).toBeDefined();
    });
  });

  describe('getTelegramChat', () => {
    it('should return chat by telegram chat ID', async () => {
      await createTelegramChat(db.knex, {
        telegramChatId: 123,
        telegramUserId: 456,
        conversationId: 'test-conv-1',
      });

      const chat = await getTelegramChat(db.knex, 123);

      expect(chat).not.toBeNull();
      expect(chat?.telegramChatId).toBe(123);
    });

    it('should return null for non-existent chat', async () => {
      const chat = await getTelegramChat(db.knex, 999);
      expect(chat).toBeNull();
    });
  });

  describe('getTelegramChatByConversation', () => {
    it('should return chat by conversation ID', async () => {
      await createTelegramChat(db.knex, {
        telegramChatId: 123,
        telegramUserId: 456,
        conversationId: 'test-conv-1',
      });

      const chat = await getTelegramChatByConversation(db.knex, 'test-conv-1');

      expect(chat).not.toBeNull();
      expect(chat?.conversationId).toBe('test-conv-1');
    });
  });

  describe('updateLastActivity', () => {
    it('should update last activity timestamp', async () => {
      const created = await createTelegramChat(db.knex, {
        telegramChatId: 123,
        telegramUserId: 456,
        conversationId: 'test-conv-1',
      });

      // Wait a bit to ensure timestamp changes
      await new Promise((resolve) => setTimeout(resolve, 10));

      await updateLastActivity(db.knex, 123);

      const updated = await getTelegramChat(db.knex, 123);
      expect(updated?.lastActivityAt).not.toBe(created.lastActivityAt);
    });
  });

  describe('deleteTelegramChat', () => {
    it('should delete chat mapping', async () => {
      await createTelegramChat(db.knex, {
        telegramChatId: 123,
        telegramUserId: 456,
        conversationId: 'test-conv-1',
      });

      const deleted = await deleteTelegramChat(db.knex, 123);
      expect(deleted).toBe(true);

      const chat = await getTelegramChat(db.knex, 123);
      expect(chat).toBeNull();
    });

    it('should return false for non-existent chat', async () => {
      const deleted = await deleteTelegramChat(db.knex, 999);
      expect(deleted).toBe(false);
    });
  });

  describe('listTelegramChatsByUser', () => {
    it('should list chats for a user', async () => {
      await createTelegramChat(db.knex, {
        telegramChatId: 123,
        telegramUserId: 456,
        conversationId: 'test-conv-1',
      });

      await createTelegramChat(db.knex, {
        telegramChatId: 124,
        telegramUserId: 456,
        conversationId: 'test-conv-2',
      });

      const chats = await listTelegramChatsByUser(db.knex, 456);

      expect(chats).toHaveLength(2);
    });

    it('should return empty array for user with no chats', async () => {
      const chats = await listTelegramChatsByUser(db.knex, 999);
      expect(chats).toHaveLength(0);
    });
  });
});

describe('telegram.handlers', () => {
  describe('parseCallbackData', () => {
    it('should parse approve action', () => {
      const result = parseCallbackData('approve:int-123');

      expect(result).toEqual({
        action: 'approve',
        interruptId: 'int-123',
      });
    });

    it('should parse deny action', () => {
      const result = parseCallbackData('deny:int-123');

      expect(result).toEqual({
        action: 'deny',
        interruptId: 'int-123',
      });
    });

    it('should parse option action', () => {
      const result = parseCallbackData('option:int-123:opt-456');

      expect(result).toEqual({
        action: 'option',
        interruptId: 'int-123',
        optionId: 'opt-456',
      });
    });

    it('should return null for invalid data', () => {
      expect(parseCallbackData('invalid')).toBeNull();
      expect(parseCallbackData('approve:')).toBeNull();
      expect(parseCallbackData('option:int-123')).toBeNull();
    });
  });

  describe('createWelcomeMessage', () => {
    it('should include assistant name', () => {
      const message = createWelcomeMessage('GLaDOS');

      expect(message).toContain('GLaDOS');
      expect(message).toContain('/new');
      expect(message).toContain('/help');
    });
  });

  describe('createHelpMessage', () => {
    it('should include all commands', () => {
      const message = createHelpMessage();

      expect(message).toContain('/start');
      expect(message).toContain('/new');
      expect(message).toContain('/help');
    });
  });

  describe('createUnauthorizedMessage', () => {
    it('should include instructions', () => {
      const message = createUnauthorizedMessage();

      expect(message).toContain('GLADOS_TELEGRAM_OWNER_ID');
      expect(message).toContain('@userinfobot');
    });
  });

  describe('formatInterruptMessage', () => {
    it('should format tool approval interrupt', () => {
      const interrupt = {
        id: 'int-123',
        conversationId: 'conv-123',
        type: 'tool_approval' as const,
        status: 'pending' as const,
        prompt: 'Do you want to proceed?',
        allowFreeform: false,
        toolCall: {
          toolId: 'tool-123',
          toolName: 'send_email',
          riskLevel: 'medium' as const,
          riskReason: 'Sends email externally',
          input: { to: 'test@example.com' },
        },
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      const { text, keyboard } = formatInterruptMessage(interrupt);

      expect(text).toContain('send_email');
      expect(text).toContain('medium');
      expect(text).toContain('Do you want to proceed?');
      expect(keyboard).toBeDefined();
    });

    it('should format question interrupt with options', () => {
      const interrupt = {
        id: 'int-123',
        conversationId: 'conv-123',
        type: 'question' as const,
        status: 'pending' as const,
        prompt: 'Which option?',
        allowFreeform: false,
        options: [
          { id: 'opt-1', label: 'Option A', isRecommended: true },
          { id: 'opt-2', label: 'Option B', isRecommended: false },
        ],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      const { text, keyboard } = formatInterruptMessage(interrupt);

      expect(text).toContain('Which option?');
      expect(keyboard).toBeDefined();
    });
  });
});
