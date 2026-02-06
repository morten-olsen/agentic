import { z } from 'zod';

// ============================================================================
// Urgency Levels
// ============================================================================

const urgencySchema = z.enum(['low', 'medium', 'high', 'critical']);

type Urgency = z.infer<typeof urgencySchema>;

// ============================================================================
// Notification Types
// ============================================================================

const notificationTypeSchema = z.enum(['info', 'action_required', 'reminder', 'alert']);

type NotificationType = z.infer<typeof notificationTypeSchema>;

// ============================================================================
// Notification Status
// ============================================================================

const notificationStatusSchema = z.enum(['pending', 'delivered', 'read', 'dismissed', 'expired', 'snoozed']);

type NotificationStatus = z.infer<typeof notificationStatusSchema>;

// ============================================================================
// Notification Action
// ============================================================================

const notificationActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['primary', 'secondary', 'destructive']),
  action: z.string(), // Action identifier to handle
  data: z.record(z.string(), z.unknown()).optional(),
});

type NotificationAction = z.infer<typeof notificationActionSchema>;

// ============================================================================
// Notification
// ============================================================================

const notificationSchema = z.object({
  id: z.string(),
  type: notificationTypeSchema,
  title: z.string(),
  body: z.string(),
  urgency: urgencySchema,
  status: notificationStatusSchema,

  // Delivery
  deliveredVia: z.string().optional(),
  deliveredAt: z.string().optional(),
  readAt: z.string().optional(),
  dismissedAt: z.string().optional(),
  expiresAt: z.string().optional(),
  snoozedUntil: z.string().optional(),

  // Actions
  actions: z.array(notificationActionSchema).default([]),

  // Source tracking
  sourceType: z.enum(['trigger', 'task', 'user', 'system']).optional(),
  sourceId: z.string().optional(),

  // Metadata
  metadata: z.record(z.string(), z.unknown()).optional(),

  // Timestamps
  createdAt: z.string(),
  updatedAt: z.string(),
});

type Notification = z.infer<typeof notificationSchema>;

// ============================================================================
// Create Notification Input
// ============================================================================

const createNotificationInputSchema = z.object({
  type: notificationTypeSchema,
  title: z.string().min(1),
  body: z.string().min(1),
  urgency: urgencySchema.optional().default('low'),
  actions: z.array(notificationActionSchema).optional().default([]),
  sourceType: z.enum(['trigger', 'task', 'user', 'system']).optional(),
  sourceId: z.string().optional(),
  expiresAt: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

type CreateNotificationInput = z.input<typeof createNotificationInputSchema>;

// ============================================================================
// Update Notification Input
// ============================================================================

const updateNotificationInputSchema = z.object({
  status: notificationStatusSchema.optional(),
  deliveredVia: z.string().optional(),
  deliveredAt: z.string().optional(),
  readAt: z.string().optional(),
  dismissedAt: z.string().optional(),
  snoozedUntil: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

type UpdateNotificationInput = z.infer<typeof updateNotificationInputSchema>;

// ============================================================================
// Notification Database Row
// ============================================================================

const notificationRowSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  urgency: z.string(),
  status: z.string(),
  delivered_via: z.string().nullable(),
  delivered_at: z.string().nullable(),
  read_at: z.string().nullable(),
  dismissed_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  snoozed_until: z.string().nullable(),
  actions: z.string().nullable(), // JSON
  source_type: z.string().nullable(),
  source_id: z.string().nullable(),
  metadata: z.string().nullable(), // JSON
  created_at: z.string(),
  updated_at: z.string(),
});

type NotificationRow = z.infer<typeof notificationRowSchema>;

// ============================================================================
// Channel Types
// ============================================================================

const channelTypeSchema = z.enum(['cli', 'telegram', 'email', 'sms', 'slack', 'webhook']);

type ChannelType = z.infer<typeof channelTypeSchema>;

// ============================================================================
// Notification Channel
// ============================================================================

const notificationChannelSchema = z.object({
  id: z.string(),
  type: channelTypeSchema,
  name: z.string(),
  enabled: z.boolean(),
  minUrgency: urgencySchema,
  priority: z.number().int(),
  config: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

type NotificationChannel = z.infer<typeof notificationChannelSchema>;

// ============================================================================
// Create Channel Input
// ============================================================================

const createChannelInputSchema = z.object({
  type: channelTypeSchema,
  name: z.string().min(1),
  enabled: z.boolean().optional().default(true),
  minUrgency: urgencySchema.optional().default('low'),
  priority: z.number().int().optional().default(0),
  config: z.record(z.string(), z.unknown()).optional(),
});

type CreateChannelInput = z.input<typeof createChannelInputSchema>;

// ============================================================================
// Channel Database Row
// ============================================================================

const channelRowSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  enabled: z.number(), // SQLite boolean
  min_urgency: z.string(),
  priority: z.number(),
  config: z.string().nullable(), // JSON
  created_at: z.string(),
  updated_at: z.string(),
});

type ChannelRow = z.infer<typeof channelRowSchema>;

// ============================================================================
// User Responsiveness
// ============================================================================

const userResponsivenessSchema = z.enum(['high', 'medium', 'low']);

type UserResponsiveness = z.infer<typeof userResponsivenessSchema>;

// ============================================================================
// Attention Budget
// ============================================================================

const attentionBudgetSchema = z.object({
  recentInterruptions: z.number().int().min(0),
  lastInterruptionAt: z.string().optional(),
  userResponsiveness: userResponsivenessSchema,
  quietHoursActive: z.boolean(),
  focusBlockActive: z.boolean(),
  manualDndUntil: z.string().optional(),
  lastResetAt: z.string(),
  updatedAt: z.string(),
});

type AttentionBudget = z.infer<typeof attentionBudgetSchema>;

// ============================================================================
// Attention Budget Database Row
// ============================================================================

const attentionBudgetRowSchema = z.object({
  id: z.string(),
  recent_interruptions: z.number(),
  last_interruption_at: z.string().nullable(),
  user_responsiveness: z.string(),
  quiet_hours_active: z.number(), // SQLite boolean
  focus_block_active: z.number(), // SQLite boolean
  manual_dnd_until: z.string().nullable(),
  last_reset_at: z.string(),
  updated_at: z.string(),
});

type AttentionBudgetRow = z.infer<typeof attentionBudgetRowSchema>;

// ============================================================================
// Notification Tier
// ============================================================================

const notificationTierSchema = z.enum(['critical', 'high', 'medium', 'low', 'background']);

type NotificationTier = z.infer<typeof notificationTierSchema>;

// ============================================================================
// Notification Decision
// ============================================================================

const notificationDecisionSchema = z.object({
  shouldNotify: z.boolean(),
  tier: notificationTierSchema,
  channel: z.string().optional(),
  reason: z.string(),
  delayUntil: z.string().optional(),
});

type NotificationDecision = z.infer<typeof notificationDecisionSchema>;

// ============================================================================
// Delivery Status
// ============================================================================

const deliveryStatusSchema = z.enum(['pending', 'sent', 'delivered', 'failed']);

type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

// ============================================================================
// Notification Delivery
// ============================================================================

const notificationDeliverySchema = z.object({
  id: z.string(),
  notificationId: z.string(),
  channelId: z.string(),
  status: deliveryStatusSchema,
  attemptedAt: z.string(),
  deliveredAt: z.string().optional(),
  error: z.string().optional(),
  externalId: z.string().optional(),
});

type NotificationDelivery = z.infer<typeof notificationDeliverySchema>;

// ============================================================================
// Delivery Database Row
// ============================================================================

const deliveryRowSchema = z.object({
  id: z.string(),
  notification_id: z.string(),
  channel_id: z.string(),
  status: z.string(),
  attempted_at: z.string(),
  delivered_at: z.string().nullable(),
  error: z.string().nullable(),
  external_id: z.string().nullable(),
});

type DeliveryRow = z.infer<typeof deliveryRowSchema>;

// ============================================================================
// Channel Sender (runtime interface)
// ============================================================================

type ChannelSender = {
  channelId: string;
  send: (notification: Notification) => Promise<{ externalId?: string }>;
};

// ============================================================================
// Exports
// ============================================================================

export type {
  Urgency,
  NotificationType,
  NotificationStatus,
  NotificationAction,
  Notification,
  CreateNotificationInput,
  UpdateNotificationInput,
  NotificationRow,
  ChannelType,
  NotificationChannel,
  CreateChannelInput,
  ChannelRow,
  UserResponsiveness,
  AttentionBudget,
  AttentionBudgetRow,
  NotificationTier,
  NotificationDecision,
  DeliveryStatus,
  NotificationDelivery,
  DeliveryRow,
  ChannelSender,
};

export {
  urgencySchema,
  notificationTypeSchema,
  notificationStatusSchema,
  notificationActionSchema,
  notificationSchema,
  createNotificationInputSchema,
  updateNotificationInputSchema,
  notificationRowSchema,
  channelTypeSchema,
  notificationChannelSchema,
  createChannelInputSchema,
  channelRowSchema,
  userResponsivenessSchema,
  attentionBudgetSchema,
  attentionBudgetRowSchema,
  notificationTierSchema,
  notificationDecisionSchema,
  deliveryStatusSchema,
  notificationDeliverySchema,
  deliveryRowSchema,
};
