import { z } from 'zod';

import type { ToolDefinition, ToolContext, ToolRegistry } from '../tools.ts';
import {
  NotificationRouter,
  notificationSchema,
  notificationStatusSchema,
  urgencySchema,
  attentionBudgetSchema,
} from '../../notifications/notifications.ts';

// ============================================================================
// Utilities
// ============================================================================

/** Converts null to undefined for service boundary compatibility */
const nullToUndefined = <T>(value: T | null | undefined): T | undefined => (value === null ? undefined : value);

// ============================================================================
// List Notifications
// ============================================================================

const listNotificationsInputSchema = z.object({
  status: notificationStatusSchema.nullish().describe('Filter by status'),
  urgency: urgencySchema.nullish().describe('Filter by urgency'),
  limit: z.number().positive().nullish().describe('Maximum number of results'),
});

const listNotificationsOutputSchema = z.object({
  notifications: z.array(notificationSchema),
  count: z.number(),
});

type ListNotificationsInput = z.infer<typeof listNotificationsInputSchema>;
type ListNotificationsOutput = z.infer<typeof listNotificationsOutputSchema>;

const listNotificationsTool: ToolDefinition<ListNotificationsInput, ListNotificationsOutput> = {
  id: 'notifications.list',
  name: 'ListNotifications',
  description: 'List notifications with optional filtering by status or urgency.',
  category: 'notifications',
  inputSchema: listNotificationsInputSchema,
  outputSchema: listNotificationsOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['notifications', 'read', 'list'],
  examples: [
    { input: {}, description: 'List all notifications' },
    { input: { status: 'pending' }, description: 'List pending notifications' },
    { input: { urgency: 'high' }, description: 'List high urgency notifications' },
  ],
  execute: async (input: ListNotificationsInput, context: ToolContext): Promise<ListNotificationsOutput> => {
    const router = context.services.get(NotificationRouter);
    const notifications = await router.listNotifications({
      status: nullToUndefined(input.status),
      urgency: nullToUndefined(input.urgency),
      limit: nullToUndefined(input.limit),
    });
    return { notifications, count: notifications.length };
  },
};

// ============================================================================
// Get Notification
// ============================================================================

const getNotificationInputSchema = z.object({
  id: z.string().describe('Notification ID'),
});

const getNotificationOutputSchema = z.object({
  notification: notificationSchema.nullable(),
  found: z.boolean(),
});

type GetNotificationInput = z.infer<typeof getNotificationInputSchema>;
type GetNotificationOutput = z.infer<typeof getNotificationOutputSchema>;

const getNotificationTool: ToolDefinition<GetNotificationInput, GetNotificationOutput> = {
  id: 'notifications.get',
  name: 'GetNotification',
  description: 'Get a notification by ID.',
  category: 'notifications',
  inputSchema: getNotificationInputSchema,
  outputSchema: getNotificationOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['notifications', 'read'],
  examples: [{ input: { id: 'notif-123' }, description: 'Get a notification by ID' }],
  execute: async (input: GetNotificationInput, context: ToolContext): Promise<GetNotificationOutput> => {
    const router = context.services.get(NotificationRouter);
    const notification = await router.getNotification(input.id);
    return { notification, found: notification !== null };
  },
};

// ============================================================================
// Dismiss Notification
// ============================================================================

const dismissNotificationInputSchema = z.object({
  id: z.string().describe('Notification ID to dismiss'),
});

const dismissNotificationOutputSchema = notificationSchema;

type DismissNotificationInput = z.infer<typeof dismissNotificationInputSchema>;
type DismissNotificationOutput = z.infer<typeof dismissNotificationOutputSchema>;

const dismissNotificationTool: ToolDefinition<DismissNotificationInput, DismissNotificationOutput> = {
  id: 'notifications.dismiss',
  name: 'DismissNotification',
  description: 'Dismiss a notification.',
  category: 'notifications',
  inputSchema: dismissNotificationInputSchema,
  outputSchema: dismissNotificationOutputSchema,
  risk: {
    level: 'low',
    reason: 'Updates notification status',
    potentialImpact: 'Notification will be dismissed',
    reversible: false,
    categories: ['data_modification'],
  },
  tags: ['notifications', 'write'],
  examples: [{ input: { id: 'notif-123' }, description: 'Dismiss a notification' }],
  execute: async (input: DismissNotificationInput, context: ToolContext): Promise<DismissNotificationOutput> => {
    const router = context.services.get(NotificationRouter);
    return router.dismiss(input.id);
  },
};

// ============================================================================
// Mark Notification as Read
// ============================================================================

const markAsReadInputSchema = z.object({
  id: z.string().describe('Notification ID to mark as read'),
});

const markAsReadOutputSchema = notificationSchema;

type MarkAsReadInput = z.infer<typeof markAsReadInputSchema>;
type MarkAsReadOutput = z.infer<typeof markAsReadOutputSchema>;

const markAsReadTool: ToolDefinition<MarkAsReadInput, MarkAsReadOutput> = {
  id: 'notifications.mark_read',
  name: 'MarkNotificationAsRead',
  description: 'Mark a notification as read.',
  category: 'notifications',
  inputSchema: markAsReadInputSchema,
  outputSchema: markAsReadOutputSchema,
  risk: {
    level: 'low',
    reason: 'Updates notification status',
    potentialImpact: 'Notification will be marked as read',
    reversible: false,
    categories: ['data_modification'],
  },
  tags: ['notifications', 'write'],
  examples: [{ input: { id: 'notif-123' }, description: 'Mark a notification as read' }],
  execute: async (input: MarkAsReadInput, context: ToolContext): Promise<MarkAsReadOutput> => {
    const router = context.services.get(NotificationRouter);
    return router.markAsRead(input.id);
  },
};

// ============================================================================
// Snooze Notification
// ============================================================================

const snoozeNotificationInputSchema = z.object({
  id: z.string().describe('Notification ID to snooze'),
  minutes: z.number().positive().describe('Number of minutes to snooze'),
});

const snoozeNotificationOutputSchema = notificationSchema;

type SnoozeNotificationInput = z.infer<typeof snoozeNotificationInputSchema>;
type SnoozeNotificationOutput = z.infer<typeof snoozeNotificationOutputSchema>;

const snoozeNotificationTool: ToolDefinition<SnoozeNotificationInput, SnoozeNotificationOutput> = {
  id: 'notifications.snooze',
  name: 'SnoozeNotification',
  description: 'Snooze a notification for a specified number of minutes.',
  category: 'notifications',
  inputSchema: snoozeNotificationInputSchema,
  outputSchema: snoozeNotificationOutputSchema,
  risk: {
    level: 'low',
    reason: 'Temporarily delays notification',
    potentialImpact: 'Notification will reappear later',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['notifications', 'write'],
  examples: [
    { input: { id: 'notif-123', minutes: 30 }, description: 'Snooze for 30 minutes' },
    { input: { id: 'notif-123', minutes: 60 }, description: 'Snooze for 1 hour' },
  ],
  execute: async (input: SnoozeNotificationInput, context: ToolContext): Promise<SnoozeNotificationOutput> => {
    const router = context.services.get(NotificationRouter);
    const until = new Date(Date.now() + input.minutes * 60 * 1000);
    return router.snooze(input.id, until);
  },
};

// ============================================================================
// Set Do Not Disturb
// ============================================================================

const setDndInputSchema = z.object({
  enabled: z.boolean().describe('Whether to enable DND mode'),
  minutes: z.number().positive().nullish().describe('Duration in minutes (if enabling)'),
});

const setDndOutputSchema = attentionBudgetSchema;

type SetDndInput = z.infer<typeof setDndInputSchema>;
type SetDndOutput = z.infer<typeof setDndOutputSchema>;

const setDndTool: ToolDefinition<SetDndInput, SetDndOutput> = {
  id: 'notifications.set_dnd',
  name: 'SetDoNotDisturb',
  description: 'Enable or disable Do Not Disturb mode. When enabled, only critical notifications will interrupt.',
  category: 'notifications',
  inputSchema: setDndInputSchema,
  outputSchema: setDndOutputSchema,
  risk: {
    level: 'low',
    reason: 'Updates notification preferences',
    potentialImpact: 'May delay non-critical notifications',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['notifications', 'write', 'settings'],
  examples: [
    { input: { enabled: true, minutes: 60 }, description: 'Enable DND for 1 hour' },
    { input: { enabled: false }, description: 'Disable DND' },
  ],
  execute: async (input: SetDndInput, context: ToolContext): Promise<SetDndOutput> => {
    const router = context.services.get(NotificationRouter);

    if (input.enabled) {
      const until = input.minutes ? new Date(Date.now() + input.minutes * 60 * 1000) : null;
      return router.setDoNotDisturb(until);
    } else {
      return router.setDoNotDisturb(null);
    }
  },
};

// ============================================================================
// Get Attention Budget
// ============================================================================

const getAttentionBudgetInputSchema = z.object({});

const getAttentionBudgetOutputSchema = attentionBudgetSchema;

type GetAttentionBudgetInput = z.infer<typeof getAttentionBudgetInputSchema>;
type GetAttentionBudgetOutput = z.infer<typeof getAttentionBudgetOutputSchema>;

const getAttentionBudgetTool: ToolDefinition<GetAttentionBudgetInput, GetAttentionBudgetOutput> = {
  id: 'notifications.get_attention_budget',
  name: 'GetAttentionBudget',
  description: 'Get the current attention budget status, including interruption count and quiet hours.',
  category: 'notifications',
  inputSchema: getAttentionBudgetInputSchema,
  outputSchema: getAttentionBudgetOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['notifications', 'read', 'settings'],
  examples: [{ input: {}, description: 'Get attention budget status' }],
  execute: async (_input: GetAttentionBudgetInput, context: ToolContext): Promise<GetAttentionBudgetOutput> => {
    const router = context.services.get(NotificationRouter);
    return router.getAttentionBudget();
  },
};

// ============================================================================
// Registration
// ============================================================================

const registerNotificationTools = (registry: ToolRegistry): void => {
  registry.register(listNotificationsTool);
  registry.register(getNotificationTool);
  registry.register(dismissNotificationTool);
  registry.register(markAsReadTool);
  registry.register(snoozeNotificationTool);
  registry.register(setDndTool);
  registry.register(getAttentionBudgetTool);
};

// ============================================================================
// Exports
// ============================================================================

export {
  listNotificationsTool,
  getNotificationTool,
  dismissNotificationTool,
  markAsReadTool,
  snoozeNotificationTool,
  setDndTool,
  getAttentionBudgetTool,
  registerNotificationTools,
};
