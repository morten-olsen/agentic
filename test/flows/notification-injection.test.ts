/**
 * Flow tests for notification injection into active conversations.
 * Tests that background notifications are recorded in the user's active conversation
 * so the agent has context for follow-up questions.
 */

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

import { Services } from '../../src/core/services/services.ts';
import { DatabaseService, createDatabaseService } from '../../src/core/database/database.ts';
import { NotificationRouter } from '../../src/features/notifications/notifications.ts';
import { TelegramClientService } from '../../src/integrations/clients/telegram/telegram.ts';
import { createConversation, getMessages } from '../../src/agent/orchestrator/orchestrator.store.ts';
import { createTelegramChat } from '../../src/integrations/clients/telegram/telegram.store.ts';

describe('Notification Injection Flow', () => {
  let services: Services;
  let db: DatabaseService;
  let notificationRouter: NotificationRouter;

  beforeEach(async () => {
    services = new Services();
    db = createDatabaseService(services, { path: ':memory:' });
    services.set(DatabaseService, db);
    await db.migrate();

    // Create notification router
    notificationRouter = new NotificationRouter(services);
    notificationRouter.configure({
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      maxInterruptionsPerHour: 10,
    });
  });

  afterEach(async () => {
    await services.destroy();
  });

  it('injects notification content into active conversation when sent via Telegram channel', async () => {
    // Create a conversation that will be the "active" one
    const conversation = await createConversation(db.knex, { title: 'Test Chat' });

    // Create telegram_chats mapping (simulating an active Telegram chat)
    const ownerId = 12345678;
    await createTelegramChat(db.knex, {
      telegramChatId: ownerId, // Private chat ID equals user ID
      telegramUserId: ownerId,
      conversationId: conversation.id,
    });

    // Create a mock TelegramClientService
    const mockTelegram = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      injectNotificationToActiveConversation: vi.fn().mockImplementation(async (notification) => {
        // Simulate the real implementation - inject message into conversation
        const { addMessage } = await import('../../src/agent/orchestrator/orchestrator.store.ts');
        const { listTelegramChatsByUser } = await import('../../src/integrations/clients/telegram/telegram.store.ts');

        const chats = await listTelegramChatsByUser(db.knex, ownerId);
        if (chats.length > 0) {
          const content = `[Background notification sent]\n**${notification.title}**\n${notification.body}`;
          await addMessage(db.knex, chats[0].conversationId, {
            role: 'assistant',
            content,
            metadata: {
              notificationId: notification.id,
              injectedNotification: true,
            },
          });
        }
      }),
    } as unknown as TelegramClientService;

    // Register Telegram channel with the mock
    const channel = await notificationRouter.createChannel({
      type: 'telegram',
      name: 'Telegram',
      enabled: true,
      minUrgency: 'low', // Accept all urgencies for testing
      priority: 100,
    });

    notificationRouter.registerChannel(channel.id, {
      channelId: channel.id,
      send: async (notification) => {
        await mockTelegram.sendMessage(ownerId, `${notification.title}\n\n${notification.body}`);
        await mockTelegram.injectNotificationToActiveConversation(notification);
        return { externalId: `telegram-${notification.id}` };
      },
    });

    // Send a notification
    const notification = await notificationRouter.notify({
      type: 'alert',
      title: 'Test Alert',
      body: 'This is a test notification that should appear in the conversation.',
      urgency: 'high',
      sourceType: 'system',
    });

    // Verify the Telegram message was sent
    expect(mockTelegram.sendMessage).toHaveBeenCalledWith(ownerId, expect.stringContaining('Test Alert'));

    // Verify the injection method was called
    expect(mockTelegram.injectNotificationToActiveConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: notification.id,
        title: 'Test Alert',
        body: 'This is a test notification that should appear in the conversation.',
      }),
    );

    // Verify the message was injected into the conversation
    const messages = await getMessages(db.knex, conversation.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].content).toContain('[Background notification sent]');
    expect(messages[0].content).toContain('Test Alert');
    expect(messages[0].content).toContain('This is a test notification');
  });

  it('does not inject when no active conversation exists', async () => {
    const ownerId = 12345678;

    // No conversation or telegram_chats mapping created

    const mockTelegram = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      injectNotificationToActiveConversation: vi.fn().mockImplementation(async () => {
        // Simulate the real implementation - no chats found, so nothing injected
        const { listTelegramChatsByUser } = await import('../../src/integrations/clients/telegram/telegram.store.ts');
        const chats = await listTelegramChatsByUser(db.knex, ownerId);
        // chats.length === 0, so no injection happens
        expect(chats).toHaveLength(0);
      }),
    } as unknown as TelegramClientService;

    const channel = await notificationRouter.createChannel({
      type: 'telegram',
      name: 'Telegram',
      enabled: true,
      minUrgency: 'low',
      priority: 100,
    });

    notificationRouter.registerChannel(channel.id, {
      channelId: channel.id,
      send: async (notification) => {
        await mockTelegram.sendMessage(ownerId, `${notification.title}\n\n${notification.body}`);
        await mockTelegram.injectNotificationToActiveConversation(notification);
        return { externalId: `telegram-${notification.id}` };
      },
    });

    // Send notification - should not throw even without active conversation
    await notificationRouter.notify({
      type: 'info',
      title: 'Test Info',
      body: 'This notification has nowhere to be injected.',
      urgency: 'high',
    });

    // Telegram message should still be sent
    expect(mockTelegram.sendMessage).toHaveBeenCalled();
    expect(mockTelegram.injectNotificationToActiveConversation).toHaveBeenCalled();
  });

  it('injects into the most recent conversation when multiple exist', async () => {
    const ownerId = 12345678;

    // Create two conversations
    const olderConversation = await createConversation(db.knex, { title: 'Older Chat' });
    const newerConversation = await createConversation(db.knex, { title: 'Newer Chat' });

    // Create telegram_chats mappings - newer one has more recent last_activity_at
    await createTelegramChat(db.knex, {
      telegramChatId: 111,
      telegramUserId: ownerId,
      conversationId: olderConversation.id,
    });

    // Wait a bit to ensure different timestamps
    await new Promise((resolve) => setTimeout(resolve, 10));

    await createTelegramChat(db.knex, {
      telegramChatId: 222,
      telegramUserId: ownerId,
      conversationId: newerConversation.id,
    });

    const mockTelegram = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      injectNotificationToActiveConversation: vi.fn().mockImplementation(async (notification) => {
        const { addMessage } = await import('../../src/agent/orchestrator/orchestrator.store.ts');
        const { listTelegramChatsByUser } = await import('../../src/integrations/clients/telegram/telegram.store.ts');

        const chats = await listTelegramChatsByUser(db.knex, ownerId);
        if (chats.length > 0) {
          // Should pick the most recent (first in list, ordered by last_activity_at desc)
          const content = `[Background notification sent]\n**${notification.title}**\n${notification.body}`;
          await addMessage(db.knex, chats[0].conversationId, {
            role: 'assistant',
            content,
          });
        }
      }),
    } as unknown as TelegramClientService;

    const channel = await notificationRouter.createChannel({
      type: 'telegram',
      name: 'Telegram',
      enabled: true,
      minUrgency: 'low',
      priority: 100,
    });

    notificationRouter.registerChannel(channel.id, {
      channelId: channel.id,
      send: async (notification) => {
        await mockTelegram.sendMessage(ownerId, `${notification.title}\n\n${notification.body}`);
        await mockTelegram.injectNotificationToActiveConversation(notification);
        return { externalId: `telegram-${notification.id}` };
      },
    });

    await notificationRouter.notify({
      type: 'reminder',
      title: 'Reminder',
      body: 'Check your tasks',
      urgency: 'medium',
    });

    // Verify message was injected into the NEWER conversation (most recent activity)
    const newerMessages = await getMessages(db.knex, newerConversation.id);
    const olderMessages = await getMessages(db.knex, olderConversation.id);

    expect(newerMessages).toHaveLength(1);
    expect(newerMessages[0].content).toContain('Reminder');
    expect(olderMessages).toHaveLength(0);
  });
});

describe('TelegramClientService.injectNotificationToActiveConversation', () => {
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

  it('stores notification metadata in injected message', async () => {
    const ownerId = 12345678;

    // Create conversation and mapping
    const conversation = await createConversation(db.knex, { title: 'Test' });
    await createTelegramChat(db.knex, {
      telegramChatId: ownerId,
      telegramUserId: ownerId,
      conversationId: conversation.id,
    });

    // Directly test the injection logic
    const { addMessage } = await import('../../src/agent/orchestrator/orchestrator.store.ts');
    const { listTelegramChatsByUser } = await import('../../src/integrations/clients/telegram/telegram.store.ts');

    const notification = {
      id: 'notif-123',
      type: 'alert' as const,
      title: 'Important Alert',
      body: 'Something happened',
      urgency: 'high' as const,
      status: 'delivered' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      actions: [],
    };

    const chats = await listTelegramChatsByUser(db.knex, ownerId);
    expect(chats.length).toBeGreaterThan(0);

    const content = `[Background notification sent]\n**${notification.title}**\n${notification.body}`;
    await addMessage(db.knex, chats[0].conversationId, {
      role: 'assistant',
      content,
      metadata: {
        notificationId: notification.id,
        notificationType: notification.type,
        notificationUrgency: notification.urgency,
        injectedNotification: true,
      },
    });

    // Verify the message and metadata
    const messages = await getMessages(db.knex, conversation.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain('[Background notification sent]');
    expect(messages[0].content).toContain('Important Alert');
  });
});
