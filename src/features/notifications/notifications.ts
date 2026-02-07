import type { Knex } from 'knex';

import type { Services } from '../../core/services/services.ts';
import { DatabaseService } from '../../core/database/database.ts';

import type {
  Notification,
  CreateNotificationInput,
  UpdateNotificationInput,
  NotificationStatus,
  NotificationChannel,
  CreateChannelInput,
  AttentionBudget,
  Urgency,
  ChannelSender,
  NotificationDecision,
} from './notifications.schemas.ts';
import {
  createNotification,
  getNotification,
  updateNotification,
  deleteNotification,
  listNotifications,
  getPendingNotifications,
  getSnoozedNotifications,
  getExpiredNotifications,
  createChannel,
  getChannel,
  getChannelByType,
  updateChannel,
  deleteChannel,
  listChannels,
  getEligibleChannels,
  getAttentionBudget,
  incrementInterruptions,
  createDelivery,
  updateDelivery,
  getDeliveriesForNotification,
} from './notifications.store.ts';
import {
  type AttentionConfig,
  DEFAULT_CONFIG,
  makeRoutingDecision,
  setDoNotDisturb,
  setFocusBlock,
} from './notifications.attention.ts';
import {
  NotificationNotFoundError,
  ChannelNotFoundError,
  ChannelNotRegisteredError,
  NotificationDeliveryError,
  InvalidNotificationStateError,
} from './notifications.errors.ts';

// ============================================================================
// Notification Router Service
// ============================================================================

/**
 * NotificationRouter - manages notification creation, routing, and delivery.
 *
 * Handles:
 * - Notification creation and storage
 * - Attention budget calculations
 * - Channel selection and routing
 * - Delivery through registered channel senders
 */
class NotificationRouter {
  #services: Services;
  #channels = new Map<string, ChannelSender>();
  #config: AttentionConfig = DEFAULT_CONFIG;

  constructor(services: Services) {
    this.#services = services;
  }

  /**
   * Gets the Knex instance from the database service.
   */
  #db = (): Knex => {
    return this.#services.get(DatabaseService).knex;
  };

  /**
   * Configures the notification router.
   */
  configure = (config: Partial<AttentionConfig>): void => {
    this.#config = { ...DEFAULT_CONFIG, ...config };
  };

  // ==========================================================================
  // Channel Registration
  // ==========================================================================

  /**
   * Registers a channel sender for runtime delivery.
   */
  registerChannel = (channelId: string, sender: ChannelSender): void => {
    this.#channels.set(channelId, sender);
  };

  /**
   * Unregisters a channel sender.
   */
  unregisterChannel = (channelId: string): void => {
    this.#channels.delete(channelId);
  };

  /**
   * Checks if a channel sender is registered.
   */
  isChannelRegistered = (channelId: string): boolean => {
    return this.#channels.has(channelId);
  };

  // ==========================================================================
  // Notification Operations
  // ==========================================================================

  /**
   * Creates a notification and optionally routes it for delivery.
   */
  notify = async (input: CreateNotificationInput, options?: { skipRouting?: boolean }): Promise<Notification> => {
    const notification = await createNotification(this.#db(), input);

    if (!options?.skipRouting) {
      await this.#routeAndDeliver(notification);
    }

    // Return fresh state
    return (await getNotification(this.#db(), notification.id)) ?? notification;
  };

  /**
   * Gets a notification by ID.
   */
  getNotification = async (id: string): Promise<Notification | null> => {
    return getNotification(this.#db(), id);
  };

  /**
   * Gets a notification by ID, throws if not found.
   */
  requireNotification = async (id: string): Promise<Notification> => {
    const notification = await this.getNotification(id);
    if (!notification) {
      throw new NotificationNotFoundError(id);
    }
    return notification;
  };

  /**
   * Updates a notification.
   */
  updateNotification = async (id: string, updates: UpdateNotificationInput): Promise<Notification> => {
    const notification = await updateNotification(this.#db(), id, updates);
    if (!notification) {
      throw new NotificationNotFoundError(id);
    }
    return notification;
  };

  /**
   * Deletes a notification.
   */
  deleteNotification = async (id: string): Promise<boolean> => {
    return deleteNotification(this.#db(), id);
  };

  /**
   * Lists notifications with optional filtering.
   */
  listNotifications = async (options?: {
    status?: NotificationStatus;
    urgency?: Urgency;
    sourceType?: string;
    limit?: number;
  }): Promise<Notification[]> => {
    return listNotifications(this.#db(), options);
  };

  /**
   * Gets all pending notifications.
   */
  getPendingNotifications = async (): Promise<Notification[]> => {
    return getPendingNotifications(this.#db());
  };

  // ==========================================================================
  // Notification Actions
  // ==========================================================================

  /**
   * Marks a notification as read.
   */
  markAsRead = async (id: string): Promise<Notification> => {
    const notification = await this.requireNotification(id);

    if (notification.status === 'dismissed' || notification.status === 'expired') {
      throw new InvalidNotificationStateError(id, notification.status, 'mark as read');
    }

    return this.updateNotification(id, {
      status: 'read',
      readAt: new Date().toISOString(),
    });
  };

  /**
   * Dismisses a notification.
   */
  dismiss = async (id: string): Promise<Notification> => {
    const notification = await this.requireNotification(id);

    if (notification.status === 'expired') {
      throw new InvalidNotificationStateError(id, notification.status, 'dismiss');
    }

    return this.updateNotification(id, {
      status: 'dismissed',
      dismissedAt: new Date().toISOString(),
    });
  };

  /**
   * Snoozes a notification until a specified time.
   */
  snooze = async (id: string, until: Date): Promise<Notification> => {
    const notification = await this.requireNotification(id);

    if (notification.status === 'dismissed' || notification.status === 'expired') {
      throw new InvalidNotificationStateError(id, notification.status, 'snooze');
    }

    return this.updateNotification(id, {
      status: 'snoozed',
      snoozedUntil: until.toISOString(),
    });
  };

  /**
   * Processes snoozed notifications that are ready to wake up.
   */
  processSnoozedNotifications = async (): Promise<Notification[]> => {
    const snoozed = await getSnoozedNotifications(this.#db(), new Date());
    const processed: Notification[] = [];

    for (const notification of snoozed) {
      // Reset to pending and reroute
      const updated = await this.updateNotification(notification.id, {
        status: 'pending',
        snoozedUntil: null,
      });

      await this.#routeAndDeliver(updated);
      const final = await this.requireNotification(notification.id);
      processed.push(final);
    }

    return processed;
  };

  /**
   * Marks expired notifications.
   */
  processExpiredNotifications = async (): Promise<Notification[]> => {
    const expired = await getExpiredNotifications(this.#db(), new Date());
    const processed: Notification[] = [];

    for (const notification of expired) {
      const updated = await this.updateNotification(notification.id, {
        status: 'expired',
      });
      processed.push(updated);
    }

    return processed;
  };

  // ==========================================================================
  // Channel Operations
  // ==========================================================================

  /**
   * Creates a notification channel configuration.
   */
  createChannel = async (input: CreateChannelInput): Promise<NotificationChannel> => {
    return createChannel(this.#db(), input);
  };

  /**
   * Gets a channel by ID.
   */
  getChannel = async (id: string): Promise<NotificationChannel | null> => {
    return getChannel(this.#db(), id);
  };

  /**
   * Gets a channel by type.
   */
  getChannelByType = async (type: string): Promise<NotificationChannel | null> => {
    return getChannelByType(this.#db(), type);
  };

  /**
   * Updates a channel configuration.
   */
  updateChannel = async (
    id: string,
    updates: Partial<Omit<CreateChannelInput, 'type'>>,
  ): Promise<NotificationChannel> => {
    const channel = await updateChannel(this.#db(), id, updates);
    if (!channel) {
      throw new ChannelNotFoundError(id);
    }
    return channel;
  };

  /**
   * Deletes a channel configuration.
   */
  deleteChannel = async (id: string): Promise<boolean> => {
    this.unregisterChannel(id);
    return deleteChannel(this.#db(), id);
  };

  /**
   * Lists all channel configurations.
   */
  listChannels = async (options?: { enabled?: boolean }): Promise<NotificationChannel[]> => {
    return listChannels(this.#db(), options);
  };

  // ==========================================================================
  // Attention Budget
  // ==========================================================================

  /**
   * Gets the current attention budget.
   */
  getAttentionBudget = async (): Promise<AttentionBudget> => {
    return getAttentionBudget(this.#db());
  };

  /**
   * Sets Do Not Disturb mode.
   */
  setDoNotDisturb = async (until: Date | null): Promise<AttentionBudget> => {
    return setDoNotDisturb(this.#db(), until);
  };

  /**
   * Sets focus block mode.
   */
  setFocusBlock = async (active: boolean): Promise<AttentionBudget> => {
    return setFocusBlock(this.#db(), active);
  };

  /**
   * Makes a routing decision for a given urgency level.
   */
  makeRoutingDecision = async (urgency: Urgency): Promise<NotificationDecision> => {
    return makeRoutingDecision(this.#db(), urgency, this.#config);
  };

  // ==========================================================================
  // Delivery
  // ==========================================================================

  /**
   * Routes and delivers a notification.
   */
  #routeAndDeliver = async (notification: Notification): Promise<void> => {
    // Get routing decision
    const decision = await makeRoutingDecision(this.#db(), notification.urgency, this.#config);

    if (!decision.shouldNotify) {
      // Store the decision reason in metadata but don't deliver
      await updateNotification(this.#db(), notification.id, {
        metadata: {
          ...notification.metadata,
          routingDecision: decision,
        },
      });
      return;
    }

    // Get eligible channels for this urgency
    const channels = await getEligibleChannels(this.#db(), notification.urgency);

    // Find a registered channel to use
    const eligibleChannel = channels.find((channel) => this.#channels.has(channel.id));

    if (!eligibleChannel) {
      // No channel available - keep as pending
      return;
    }

    // Deliver through the channel
    await this.#deliver(notification, eligibleChannel.id);
  };

  /**
   * Delivers a notification through a specific channel.
   */
  #deliver = async (notification: Notification, channelId: string): Promise<void> => {
    const sender = this.#channels.get(channelId);
    if (!sender) {
      throw new ChannelNotRegisteredError(channelId);
    }

    // Create delivery record
    const delivery = await createDelivery(this.#db(), {
      notificationId: notification.id,
      channelId,
    });

    try {
      // Attempt delivery
      const result = await sender.send(notification);

      // Update delivery record
      await updateDelivery(this.#db(), delivery.id, {
        status: 'delivered',
        deliveredAt: new Date().toISOString(),
        externalId: result.externalId,
      });

      // Update notification status
      await updateNotification(this.#db(), notification.id, {
        status: 'delivered',
        deliveredVia: channelId,
        deliveredAt: new Date().toISOString(),
      });

      // Increment interruption counter
      await incrementInterruptions(this.#db());
    } catch (error) {
      // Update delivery record with error
      await updateDelivery(this.#db(), delivery.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });

      throw new NotificationDeliveryError(notification.id, channelId, error instanceof Error ? error : undefined);
    }
  };

  /**
   * Manually delivers a notification to a specific channel.
   */
  deliverTo = async (notificationId: string, channelId: string): Promise<Notification> => {
    const notification = await this.requireNotification(notificationId);

    const channel = await getChannel(this.#db(), channelId);
    if (!channel) {
      throw new ChannelNotFoundError(channelId);
    }

    if (!this.#channels.has(channelId)) {
      throw new ChannelNotRegisteredError(channelId);
    }

    await this.#deliver(notification, channelId);

    return this.requireNotification(notificationId);
  };

  /**
   * Gets delivery history for a notification.
   */
  getDeliveryHistory = async (
    notificationId: string,
  ): Promise<Awaited<ReturnType<typeof getDeliveriesForNotification>>> => {
    return getDeliveriesForNotification(this.#db(), notificationId);
  };
}

// ============================================================================
// Re-exports
// ============================================================================

export type {
  Urgency,
  NotificationType,
  NotificationStatus,
  NotificationAction,
  Notification,
  CreateNotificationInput,
  UpdateNotificationInput,
  ChannelType,
  NotificationChannel,
  CreateChannelInput,
  UserResponsiveness,
  AttentionBudget,
  NotificationTier,
  NotificationDecision,
  DeliveryStatus,
  NotificationDelivery,
  ChannelSender,
} from './notifications.schemas.ts';

export {
  urgencySchema,
  notificationTypeSchema,
  notificationStatusSchema,
  notificationActionSchema,
  notificationSchema,
  createNotificationInputSchema,
  updateNotificationInputSchema,
  channelTypeSchema,
  notificationChannelSchema,
  createChannelInputSchema,
  userResponsivenessSchema,
  attentionBudgetSchema,
  notificationTierSchema,
  notificationDecisionSchema,
  deliveryStatusSchema,
  notificationDeliverySchema,
} from './notifications.schemas.ts';

export {
  NotificationNotFoundError,
  ChannelNotFoundError,
  ChannelNotRegisteredError,
  NotificationDeliveryError,
  InvalidNotificationStateError,
} from './notifications.errors.ts';

export type { AttentionConfig } from './notifications.attention.ts';
export { DEFAULT_CONFIG, isQuietHours, getQuietHoursEnd } from './notifications.attention.ts';

export { NotificationRouter };
