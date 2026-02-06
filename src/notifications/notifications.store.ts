import type { Knex } from 'knex';

import type {
  Notification,
  NotificationRow,
  CreateNotificationInput,
  UpdateNotificationInput,
  NotificationStatus,
  NotificationChannel,
  ChannelRow,
  CreateChannelInput,
  AttentionBudget,
  AttentionBudgetRow,
  NotificationDelivery,
  DeliveryRow,
  DeliveryStatus,
  Urgency,
} from './notifications.schemas.ts';
import { createNotificationInputSchema, createChannelInputSchema } from './notifications.schemas.ts';

// ============================================================================
// Helpers
// ============================================================================

const generateId = (): string => crypto.randomUUID();
const now = (): string => new Date().toISOString();

// ============================================================================
// Notification Row Conversion
// ============================================================================

const rowToNotification = (row: NotificationRow): Notification => {
  return {
    id: row.id,
    type: row.type as Notification['type'],
    title: row.title,
    body: row.body,
    urgency: row.urgency as Urgency,
    status: row.status as NotificationStatus,
    deliveredVia: row.delivered_via ?? undefined,
    deliveredAt: row.delivered_at ?? undefined,
    readAt: row.read_at ?? undefined,
    dismissedAt: row.dismissed_at ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    snoozedUntil: row.snoozed_until ?? undefined,
    actions: row.actions ? JSON.parse(row.actions) : [],
    sourceType: row.source_type as Notification['sourceType'],
    sourceId: row.source_id ?? undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// ============================================================================
// Notification CRUD
// ============================================================================

const createNotification = async (db: Knex, input: CreateNotificationInput): Promise<Notification> => {
  const validated = createNotificationInputSchema.parse(input);
  const id = generateId();
  const timestamp = now();

  const row: NotificationRow = {
    id,
    type: validated.type,
    title: validated.title,
    body: validated.body,
    urgency: validated.urgency,
    status: 'pending',
    delivered_via: null,
    delivered_at: null,
    read_at: null,
    dismissed_at: null,
    expires_at: validated.expiresAt ?? null,
    snoozed_until: null,
    actions: validated.actions.length > 0 ? JSON.stringify(validated.actions) : null,
    source_type: validated.sourceType ?? null,
    source_id: validated.sourceId ?? null,
    metadata: validated.metadata ? JSON.stringify(validated.metadata) : null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  await db('notifications').insert(row);
  return rowToNotification(row);
};

const getNotification = async (db: Knex, id: string): Promise<Notification | null> => {
  const row = await db<NotificationRow>('notifications').where({ id }).first();
  return row ? rowToNotification(row) : null;
};

const updateNotification = async (
  db: Knex,
  id: string,
  updates: UpdateNotificationInput,
): Promise<Notification | null> => {
  const timestamp = now();

  const updateData: Partial<NotificationRow> = {
    updated_at: timestamp,
  };

  if (updates.status !== undefined) updateData.status = updates.status;
  if (updates.deliveredVia !== undefined) updateData.delivered_via = updates.deliveredVia;
  if (updates.deliveredAt !== undefined) updateData.delivered_at = updates.deliveredAt;
  if (updates.readAt !== undefined) updateData.read_at = updates.readAt;
  if (updates.dismissedAt !== undefined) updateData.dismissed_at = updates.dismissedAt;
  if (updates.snoozedUntil !== undefined) updateData.snoozed_until = updates.snoozedUntil;
  if (updates.metadata !== undefined) updateData.metadata = JSON.stringify(updates.metadata);

  const count = await db('notifications').where({ id }).update(updateData);
  if (count === 0) return null;

  return getNotification(db, id);
};

const deleteNotification = async (db: Knex, id: string): Promise<boolean> => {
  const count = await db('notifications').where({ id }).delete();
  return count > 0;
};

// ============================================================================
// Notification Queries
// ============================================================================

const listNotifications = async (
  db: Knex,
  options?: {
    status?: NotificationStatus;
    urgency?: Urgency;
    sourceType?: string;
    limit?: number;
  },
): Promise<Notification[]> => {
  let query = db<NotificationRow>('notifications');

  if (options?.status) {
    query = query.where({ status: options.status });
  }

  if (options?.urgency) {
    query = query.where({ urgency: options.urgency });
  }

  if (options?.sourceType) {
    query = query.where({ source_type: options.sourceType });
  }

  query = query.orderBy('created_at', 'desc');

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const rows = await query;
  return rows.map(rowToNotification);
};

const getPendingNotifications = async (db: Knex): Promise<Notification[]> => {
  const rows = await db<NotificationRow>('notifications').where({ status: 'pending' }).orderBy('created_at', 'asc');
  return rows.map(rowToNotification);
};

const getSnoozedNotifications = async (db: Knex, beforeTime: Date): Promise<Notification[]> => {
  const isoTime = beforeTime.toISOString();
  const rows = await db<NotificationRow>('notifications')
    .where({ status: 'snoozed' })
    .where('snoozed_until', '<=', isoTime)
    .orderBy('snoozed_until', 'asc');
  return rows.map(rowToNotification);
};

const getExpiredNotifications = async (db: Knex, beforeTime: Date): Promise<Notification[]> => {
  const isoTime = beforeTime.toISOString();
  const rows = await db<NotificationRow>('notifications')
    .whereIn('status', ['pending', 'delivered'])
    .whereNotNull('expires_at')
    .where('expires_at', '<=', isoTime)
    .orderBy('expires_at', 'asc');
  return rows.map(rowToNotification);
};

// ============================================================================
// Channel Row Conversion
// ============================================================================

const rowToChannel = (row: ChannelRow): NotificationChannel => {
  return {
    id: row.id,
    type: row.type as NotificationChannel['type'],
    name: row.name,
    enabled: row.enabled === 1,
    minUrgency: row.min_urgency as Urgency,
    priority: row.priority,
    config: row.config ? JSON.parse(row.config) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// ============================================================================
// Channel CRUD
// ============================================================================

const createChannel = async (db: Knex, input: CreateChannelInput): Promise<NotificationChannel> => {
  const validated = createChannelInputSchema.parse(input);
  const id = generateId();
  const timestamp = now();

  const row: ChannelRow = {
    id,
    type: validated.type,
    name: validated.name,
    enabled: validated.enabled ? 1 : 0,
    min_urgency: validated.minUrgency,
    priority: validated.priority,
    config: validated.config ? JSON.stringify(validated.config) : null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  await db('notification_channels').insert(row);
  return rowToChannel(row);
};

const getChannel = async (db: Knex, id: string): Promise<NotificationChannel | null> => {
  const row = await db<ChannelRow>('notification_channels').where({ id }).first();
  return row ? rowToChannel(row) : null;
};

const getChannelByType = async (db: Knex, type: string): Promise<NotificationChannel | null> => {
  const row = await db<ChannelRow>('notification_channels').where({ type }).first();
  return row ? rowToChannel(row) : null;
};

const updateChannel = async (
  db: Knex,
  id: string,
  updates: Partial<Omit<CreateChannelInput, 'type'>>,
): Promise<NotificationChannel | null> => {
  const timestamp = now();

  const updateData: Partial<ChannelRow> = {
    updated_at: timestamp,
  };

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.enabled !== undefined) updateData.enabled = updates.enabled ? 1 : 0;
  if (updates.minUrgency !== undefined) updateData.min_urgency = updates.minUrgency;
  if (updates.priority !== undefined) updateData.priority = updates.priority;
  if (updates.config !== undefined) updateData.config = JSON.stringify(updates.config);

  const count = await db('notification_channels').where({ id }).update(updateData);
  if (count === 0) return null;

  return getChannel(db, id);
};

const deleteChannel = async (db: Knex, id: string): Promise<boolean> => {
  const count = await db('notification_channels').where({ id }).delete();
  return count > 0;
};

const listChannels = async (db: Knex, options?: { enabled?: boolean }): Promise<NotificationChannel[]> => {
  let query = db<ChannelRow>('notification_channels');

  if (options?.enabled !== undefined) {
    query = query.where({ enabled: options.enabled ? 1 : 0 });
  }

  const rows = await query.orderBy('priority', 'desc');
  return rows.map(rowToChannel);
};

const getEligibleChannels = async (db: Knex, urgency: Urgency): Promise<NotificationChannel[]> => {
  // Map urgency to numeric value for comparison
  const urgencyOrder: Record<Urgency, number> = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };

  const channels = await listChannels(db, { enabled: true });

  // Filter channels that accept this urgency level
  return channels.filter((channel) => urgencyOrder[urgency] >= urgencyOrder[channel.minUrgency]);
};

// ============================================================================
// Attention Budget
// ============================================================================

const rowToAttentionBudget = (row: AttentionBudgetRow): AttentionBudget => {
  return {
    recentInterruptions: row.recent_interruptions,
    lastInterruptionAt: row.last_interruption_at ?? undefined,
    userResponsiveness: row.user_responsiveness as AttentionBudget['userResponsiveness'],
    quietHoursActive: row.quiet_hours_active === 1,
    focusBlockActive: row.focus_block_active === 1,
    manualDndUntil: row.manual_dnd_until ?? undefined,
    lastResetAt: row.last_reset_at,
    updatedAt: row.updated_at,
  };
};

const getAttentionBudget = async (db: Knex): Promise<AttentionBudget> => {
  const row = await db<AttentionBudgetRow>('attention_budget').where({ id: 'singleton' }).first();

  if (!row) {
    // Create default if missing (shouldn't happen with migration)
    const timestamp = now();
    const defaultRow: AttentionBudgetRow = {
      id: 'singleton',
      recent_interruptions: 0,
      last_interruption_at: null,
      user_responsiveness: 'medium',
      quiet_hours_active: 0,
      focus_block_active: 0,
      manual_dnd_until: null,
      last_reset_at: timestamp,
      updated_at: timestamp,
    };
    await db('attention_budget').insert(defaultRow);
    return rowToAttentionBudget(defaultRow);
  }

  return rowToAttentionBudget(row);
};

const updateAttentionBudget = async (
  db: Knex,
  updates: Partial<Omit<AttentionBudget, 'updatedAt'>> & { manualDndUntil?: string | null },
): Promise<AttentionBudget> => {
  const timestamp = now();

  const updateData: Partial<AttentionBudgetRow> = {
    updated_at: timestamp,
  };

  if (updates.recentInterruptions !== undefined) updateData.recent_interruptions = updates.recentInterruptions;
  if (updates.lastInterruptionAt !== undefined) updateData.last_interruption_at = updates.lastInterruptionAt;
  if (updates.userResponsiveness !== undefined) updateData.user_responsiveness = updates.userResponsiveness;
  if (updates.quietHoursActive !== undefined) updateData.quiet_hours_active = updates.quietHoursActive ? 1 : 0;
  if (updates.focusBlockActive !== undefined) updateData.focus_block_active = updates.focusBlockActive ? 1 : 0;
  // Handle manualDndUntil: allow explicit null to clear the value
  if ('manualDndUntil' in updates) updateData.manual_dnd_until = updates.manualDndUntil ?? null;
  if (updates.lastResetAt !== undefined) updateData.last_reset_at = updates.lastResetAt;

  await db('attention_budget').where({ id: 'singleton' }).update(updateData);
  return getAttentionBudget(db);
};

const incrementInterruptions = async (db: Knex): Promise<AttentionBudget> => {
  const timestamp = now();
  await db('attention_budget')
    .where({ id: 'singleton' })
    .update({
      recent_interruptions: db.raw('recent_interruptions + 1'),
      last_interruption_at: timestamp,
      updated_at: timestamp,
    });
  return getAttentionBudget(db);
};

const resetInterruptions = async (db: Knex): Promise<AttentionBudget> => {
  const timestamp = now();
  await db('attention_budget').where({ id: 'singleton' }).update({
    recent_interruptions: 0,
    last_reset_at: timestamp,
    updated_at: timestamp,
  });
  return getAttentionBudget(db);
};

// ============================================================================
// Delivery Record
// ============================================================================

const rowToDelivery = (row: DeliveryRow): NotificationDelivery => {
  return {
    id: row.id,
    notificationId: row.notification_id,
    channelId: row.channel_id,
    status: row.status as DeliveryStatus,
    attemptedAt: row.attempted_at,
    deliveredAt: row.delivered_at ?? undefined,
    error: row.error ?? undefined,
    externalId: row.external_id ?? undefined,
  };
};

const createDelivery = async (
  db: Knex,
  input: { notificationId: string; channelId: string },
): Promise<NotificationDelivery> => {
  const id = generateId();
  const timestamp = now();

  const row: DeliveryRow = {
    id,
    notification_id: input.notificationId,
    channel_id: input.channelId,
    status: 'pending',
    attempted_at: timestamp,
    delivered_at: null,
    error: null,
    external_id: null,
  };

  await db('notification_deliveries').insert(row);
  return rowToDelivery(row);
};

const updateDelivery = async (
  db: Knex,
  id: string,
  updates: { status?: DeliveryStatus; deliveredAt?: string; error?: string; externalId?: string },
): Promise<NotificationDelivery | null> => {
  const updateData: Partial<DeliveryRow> = {};

  if (updates.status !== undefined) updateData.status = updates.status;
  if (updates.deliveredAt !== undefined) updateData.delivered_at = updates.deliveredAt;
  if (updates.error !== undefined) updateData.error = updates.error;
  if (updates.externalId !== undefined) updateData.external_id = updates.externalId;

  const count = await db('notification_deliveries').where({ id }).update(updateData);
  if (count === 0) return null;

  const row = await db<DeliveryRow>('notification_deliveries').where({ id }).first();
  return row ? rowToDelivery(row) : null;
};

const getDeliveriesForNotification = async (db: Knex, notificationId: string): Promise<NotificationDelivery[]> => {
  const rows = await db<DeliveryRow>('notification_deliveries')
    .where({ notification_id: notificationId })
    .orderBy('attempted_at', 'desc');
  return rows.map(rowToDelivery);
};

// ============================================================================
// Exports
// ============================================================================

export {
  // Notifications
  createNotification,
  getNotification,
  updateNotification,
  deleteNotification,
  listNotifications,
  getPendingNotifications,
  getSnoozedNotifications,
  getExpiredNotifications,
  // Channels
  createChannel,
  getChannel,
  getChannelByType,
  updateChannel,
  deleteChannel,
  listChannels,
  getEligibleChannels,
  // Attention budget
  getAttentionBudget,
  updateAttentionBudget,
  incrementInterruptions,
  resetInterruptions,
  // Deliveries
  createDelivery,
  updateDelivery,
  getDeliveriesForNotification,
};
