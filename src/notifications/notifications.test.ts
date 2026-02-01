import { describe, it, beforeEach, afterEach, expect } from 'vitest';

import { Services } from '../services/services.ts';
import { DatabaseService, createDatabaseService } from '../database/database.ts';

import {
  NotificationRouter,
  NotificationNotFoundError,
  InvalidNotificationStateError,
  ChannelNotFoundError,
  ChannelNotRegisteredError,
} from './notifications.ts';
import type { Notification, ChannelSender } from './notifications.ts';
import { isQuietHours, calculateTier, makeRoutingDecision, DEFAULT_CONFIG } from './notifications.attention.ts';
import type { AttentionBudget } from './notifications.schemas.ts';

// ============================================================================
// Test Setup
// ============================================================================

const createTestServices = async (): Promise<Services> => {
  const services = new Services();
  const db = createDatabaseService(services, { path: ':memory:' });
  services.set(DatabaseService, db);
  await db.migrate();
  return services;
};

const createMockSender = (): ChannelSender & { calls: Notification[] } => {
  const calls: Notification[] = [];
  return {
    channelId: 'mock-channel',
    calls,
    send: async (notification: Notification) => {
      calls.push(notification);
      return { externalId: `ext-${notification.id}` };
    },
  };
};

// ============================================================================
// NotificationRouter Tests
// ============================================================================

describe('NotificationRouter', () => {
  let services: Services;
  let router: NotificationRouter;

  beforeEach(async () => {
    services = await createTestServices();
    router = new NotificationRouter(services);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('notify', () => {
    it('creates a notification', async () => {
      const notification = await router.notify(
        {
          type: 'info',
          title: 'Test notification',
          body: 'This is a test',
        },
        { skipRouting: true },
      );

      expect(notification.id).toBeDefined();
      expect(notification.title).toBe('Test notification');
      expect(notification.body).toBe('This is a test');
      expect(notification.type).toBe('info');
      expect(notification.status).toBe('pending');
      expect(notification.urgency).toBe('low');
    });

    it('creates a notification with urgency', async () => {
      const notification = await router.notify(
        {
          type: 'alert',
          title: 'Critical alert',
          body: 'Immediate attention required',
          urgency: 'critical',
        },
        { skipRouting: true },
      );

      expect(notification.urgency).toBe('critical');
    });

    it('creates a notification with source tracking', async () => {
      const notification = await router.notify(
        {
          type: 'reminder',
          title: 'Task reminder',
          body: 'Complete your task',
          sourceType: 'task',
          sourceId: 'task-123',
        },
        { skipRouting: true },
      );

      expect(notification.sourceType).toBe('task');
      expect(notification.sourceId).toBe('task-123');
    });
  });

  describe('getNotification', () => {
    it('returns null for non-existent notification', async () => {
      const notification = await router.getNotification('non-existent');
      expect(notification).toBeNull();
    });

    it('retrieves an existing notification', async () => {
      const created = await router.notify(
        {
          type: 'info',
          title: 'Test',
          body: 'Test body',
        },
        { skipRouting: true },
      );

      const retrieved = await router.getNotification(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.title).toBe('Test');
    });
  });

  describe('requireNotification', () => {
    it('throws NotificationNotFoundError for non-existent notification', async () => {
      await expect(router.requireNotification('non-existent')).rejects.toThrow(NotificationNotFoundError);
    });
  });

  describe('listNotifications', () => {
    it('lists all notifications', async () => {
      await router.notify({ type: 'info', title: 'N1', body: 'Body 1' }, { skipRouting: true });
      await router.notify({ type: 'alert', title: 'N2', body: 'Body 2' }, { skipRouting: true });

      const notifications = await router.listNotifications();
      expect(notifications).toHaveLength(2);
    });

    it('filters by status', async () => {
      const n1 = await router.notify({ type: 'info', title: 'N1', body: 'Body 1' }, { skipRouting: true });
      await router.notify({ type: 'info', title: 'N2', body: 'Body 2' }, { skipRouting: true });

      await router.dismiss(n1.id);

      const pending = await router.listNotifications({ status: 'pending' });
      expect(pending).toHaveLength(1);
      expect(pending[0].title).toBe('N2');
    });

    it('filters by urgency', async () => {
      await router.notify({ type: 'info', title: 'Low', body: 'Body', urgency: 'low' }, { skipRouting: true });
      await router.notify({ type: 'alert', title: 'High', body: 'Body', urgency: 'high' }, { skipRouting: true });

      const high = await router.listNotifications({ urgency: 'high' });
      expect(high).toHaveLength(1);
      expect(high[0].title).toBe('High');
    });
  });

  describe('markAsRead', () => {
    it('marks a notification as read', async () => {
      const notification = await router.notify({ type: 'info', title: 'Test', body: 'Body' }, { skipRouting: true });

      const read = await router.markAsRead(notification.id);
      expect(read.status).toBe('read');
      expect(read.readAt).toBeDefined();
    });

    it('throws InvalidNotificationStateError for dismissed notification', async () => {
      const notification = await router.notify({ type: 'info', title: 'Test', body: 'Body' }, { skipRouting: true });

      await router.dismiss(notification.id);
      await expect(router.markAsRead(notification.id)).rejects.toThrow(InvalidNotificationStateError);
    });
  });

  describe('dismiss', () => {
    it('dismisses a notification', async () => {
      const notification = await router.notify({ type: 'info', title: 'Test', body: 'Body' }, { skipRouting: true });

      const dismissed = await router.dismiss(notification.id);
      expect(dismissed.status).toBe('dismissed');
      expect(dismissed.dismissedAt).toBeDefined();
    });
  });

  describe('snooze', () => {
    it('snoozes a notification', async () => {
      const notification = await router.notify({ type: 'info', title: 'Test', body: 'Body' }, { skipRouting: true });

      const until = new Date(Date.now() + 30 * 60 * 1000);
      const snoozed = await router.snooze(notification.id, until);

      expect(snoozed.status).toBe('snoozed');
      expect(snoozed.snoozedUntil).toBe(until.toISOString());
    });

    it('throws InvalidNotificationStateError for dismissed notification', async () => {
      const notification = await router.notify({ type: 'info', title: 'Test', body: 'Body' }, { skipRouting: true });

      await router.dismiss(notification.id);
      await expect(router.snooze(notification.id, new Date())).rejects.toThrow(InvalidNotificationStateError);
    });
  });

  describe('processSnoozedNotifications', () => {
    it('resets snoozed notifications that are ready', async () => {
      const notification = await router.notify({ type: 'info', title: 'Test', body: 'Body' }, { skipRouting: true });

      // Snooze to the past
      const past = new Date(Date.now() - 1000);
      await router.snooze(notification.id, past);

      const processed = await router.processSnoozedNotifications();
      expect(processed).toHaveLength(1);
      expect(processed[0].status).toBe('pending');
    });
  });

  describe('Channel Operations', () => {
    it('creates and retrieves a channel', async () => {
      const channel = await router.createChannel({
        type: 'cli',
        name: 'CLI Channel',
      });

      expect(channel.id).toBeDefined();
      expect(channel.type).toBe('cli');
      expect(channel.name).toBe('CLI Channel');
      expect(channel.enabled).toBe(true);

      const retrieved = await router.getChannel(channel.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('CLI Channel');
    });

    it('updates a channel', async () => {
      const channel = await router.createChannel({
        type: 'telegram',
        name: 'Telegram',
      });

      const updated = await router.updateChannel(channel.id, {
        enabled: false,
        minUrgency: 'high',
      });

      expect(updated.enabled).toBe(false);
      expect(updated.minUrgency).toBe('high');
    });

    it('throws ChannelNotFoundError for non-existent channel', async () => {
      await expect(router.updateChannel('non-existent', { enabled: false })).rejects.toThrow(ChannelNotFoundError);
    });

    it('lists channels', async () => {
      await router.createChannel({ type: 'cli', name: 'CLI', enabled: true });
      await router.createChannel({ type: 'telegram', name: 'Telegram', enabled: false });

      const all = await router.listChannels();
      expect(all).toHaveLength(2);

      const enabled = await router.listChannels({ enabled: true });
      expect(enabled).toHaveLength(1);
      expect(enabled[0].name).toBe('CLI');
    });
  });

  describe('Channel Registration', () => {
    it('registers and unregisters a channel sender', async () => {
      const sender = createMockSender();

      router.registerChannel('test-channel', sender);
      expect(router.isChannelRegistered('test-channel')).toBe(true);

      router.unregisterChannel('test-channel');
      expect(router.isChannelRegistered('test-channel')).toBe(false);
    });
  });

  describe('Delivery', () => {
    it('delivers a notification through a registered channel', async () => {
      // Create and configure channel
      const channel = await router.createChannel({
        type: 'cli',
        name: 'CLI',
        minUrgency: 'low',
      });

      const sender = createMockSender();
      router.registerChannel(channel.id, sender);

      // Create notification with routing
      const notification = await router.notify({
        type: 'info',
        title: 'Test delivery',
        body: 'This should be delivered',
        urgency: 'critical', // Critical always delivers
      });

      expect(notification.status).toBe('delivered');
      expect(notification.deliveredVia).toBe(channel.id);
      expect(sender.calls).toHaveLength(1);
    });

    it('throws ChannelNotRegisteredError when delivering to unregistered channel', async () => {
      const channel = await router.createChannel({
        type: 'cli',
        name: 'CLI',
      });

      const notification = await router.notify({ type: 'info', title: 'Test', body: 'Body' }, { skipRouting: true });

      await expect(router.deliverTo(notification.id, channel.id)).rejects.toThrow(ChannelNotRegisteredError);
    });

    it('records delivery history', async () => {
      const channel = await router.createChannel({
        type: 'cli',
        name: 'CLI',
      });

      const sender = createMockSender();
      router.registerChannel(channel.id, sender);

      const notification = await router.notify({ type: 'info', title: 'Test', body: 'Body', urgency: 'critical' });

      const history = await router.getDeliveryHistory(notification.id);
      expect(history).toHaveLength(1);
      expect(history[0].status).toBe('delivered');
      expect(history[0].externalId).toBe(`ext-${notification.id}`);
    });
  });

  describe('Attention Budget', () => {
    it('gets attention budget', async () => {
      const budget = await router.getAttentionBudget();

      expect(budget.recentInterruptions).toBe(0);
      expect(budget.userResponsiveness).toBe('medium');
      expect(budget.quietHoursActive).toBe(false);
      expect(budget.focusBlockActive).toBe(false);
    });

    it('sets Do Not Disturb mode', async () => {
      const until = new Date(Date.now() + 60 * 60 * 1000);
      const budget = await router.setDoNotDisturb(until);

      expect(budget.manualDndUntil).toBe(until.toISOString());
    });

    it('clears Do Not Disturb mode', async () => {
      await router.setDoNotDisturb(new Date(Date.now() + 60 * 60 * 1000));
      const budget = await router.setDoNotDisturb(null);

      expect(budget.manualDndUntil).toBeUndefined();
    });

    it('sets focus block mode', async () => {
      const budget = await router.setFocusBlock(true);
      expect(budget.focusBlockActive).toBe(true);

      const cleared = await router.setFocusBlock(false);
      expect(cleared.focusBlockActive).toBe(false);
    });

    it('makes routing decision', async () => {
      const decision = await router.makeRoutingDecision('critical');

      expect(decision.shouldNotify).toBe(true);
      expect(decision.tier).toBe('critical');
    });
  });
});

// ============================================================================
// Attention Budget Logic Tests
// ============================================================================

describe('Attention Budget Logic', () => {
  describe('isQuietHours', () => {
    it('detects quiet hours within same day', () => {
      const config = { ...DEFAULT_CONFIG, quietHoursStart: '12:00', quietHoursEnd: '14:00' };

      const during = new Date('2024-03-15T13:00:00');
      expect(isQuietHours(config, during)).toBe(true);

      const before = new Date('2024-03-15T11:00:00');
      expect(isQuietHours(config, before)).toBe(false);

      const after = new Date('2024-03-15T15:00:00');
      expect(isQuietHours(config, after)).toBe(false);
    });

    it('detects quiet hours spanning midnight', () => {
      const config = { ...DEFAULT_CONFIG, quietHoursStart: '22:00', quietHoursEnd: '07:00' };

      const lateNight = new Date('2024-03-15T23:00:00');
      expect(isQuietHours(config, lateNight)).toBe(true);

      const earlyMorning = new Date('2024-03-15T05:00:00');
      expect(isQuietHours(config, earlyMorning)).toBe(true);

      const afternoon = new Date('2024-03-15T14:00:00');
      expect(isQuietHours(config, afternoon)).toBe(false);
    });
  });

  describe('calculateTier', () => {
    const baseBudget: AttentionBudget = {
      recentInterruptions: 0,
      userResponsiveness: 'medium',
      quietHoursActive: false,
      focusBlockActive: false,
      lastResetAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    it('critical urgency always maps to critical tier', () => {
      const budget: AttentionBudget = { ...baseBudget, quietHoursActive: true, focusBlockActive: true };
      expect(calculateTier('critical', budget)).toBe('critical');
    });

    it('high urgency maps to high tier normally', () => {
      expect(calculateTier('high', baseBudget)).toBe('high');
    });

    it('demotes urgency during focus block', () => {
      const budget: AttentionBudget = { ...baseBudget, focusBlockActive: true };

      expect(calculateTier('high', budget)).toBe('medium');
      expect(calculateTier('medium', budget)).toBe('background');
      expect(calculateTier('low', budget)).toBe('background');
    });

    it('demotes urgency during quiet hours', () => {
      const budget: AttentionBudget = { ...baseBudget, quietHoursActive: true };

      expect(calculateTier('high', budget)).toBe('medium');
      expect(calculateTier('medium', budget)).toBe('low');
      expect(calculateTier('low', budget)).toBe('background');
    });

    it('demotes to background during DND', () => {
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const budget: AttentionBudget = { ...baseBudget, manualDndUntil: future };

      expect(calculateTier('high', budget)).toBe('background');
      expect(calculateTier('medium', budget)).toBe('background');
      expect(calculateTier('low', budget)).toBe('background');
    });
  });

  describe('makeRoutingDecision', () => {
    let services: Services;

    beforeEach(async () => {
      services = await createTestServices();
    });

    afterEach(async () => {
      await services.destroy();
    });

    it('critical urgency always notifies', async () => {
      const db = services.get(DatabaseService).knex;
      const decision = await makeRoutingDecision(db, 'critical');

      expect(decision.shouldNotify).toBe(true);
      expect(decision.tier).toBe('critical');
    });

    it('blocks low urgency during quiet hours', async () => {
      const db = services.get(DatabaseService).knex;

      // Use a config that forces quiet hours to be active now
      // Set quiet hours from 00:00 to 23:59 so current time is always within
      const quietConfig = {
        ...DEFAULT_CONFIG,
        quietHoursStart: '00:00',
        quietHoursEnd: '23:59',
      };

      const decision = await makeRoutingDecision(db, 'low', quietConfig);

      expect(decision.shouldNotify).toBe(false);
      expect(decision.tier).toBe('background');
    });

    it('respects interruption limit', async () => {
      const db = services.get(DatabaseService).knex;

      // Set interruptions to max
      await db('attention_budget').where({ id: 'singleton' }).update({
        recent_interruptions: 5,
        updated_at: new Date().toISOString(),
      });

      const decision = await makeRoutingDecision(db, 'medium');

      expect(decision.shouldNotify).toBe(false);
      expect(decision.reason).toContain('limit reached');
    });
  });
});
