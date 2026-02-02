import { z } from 'zod';

// ============================================================================
// Model Tier
// ============================================================================

const modelTierSchema = z.enum(['fast', 'balanced', 'capable', 'premium']);

type ModelTier = z.infer<typeof modelTierSchema>;

// ============================================================================
// Trigger Schedule (Discriminated Union)
// ============================================================================

const triggerScheduleOnceSchema = z.object({
  type: z.literal('once'),
  at: z.string(), // ISO8601 datetime
});

const triggerScheduleCronSchema = z.object({
  type: z.literal('cron'),
  expression: z.string(), // Standard cron expression
});

const triggerScheduleSchema = z.discriminatedUnion('type', [triggerScheduleOnceSchema, triggerScheduleCronSchema]);

type TriggerSchedule = z.infer<typeof triggerScheduleSchema>;

// ============================================================================
// Trigger Status
// ============================================================================

const triggerStatusSchema = z.enum(['active', 'paused', 'completed', 'failed']);

type TriggerStatus = z.infer<typeof triggerStatusSchema>;

// ============================================================================
// Trigger
// ============================================================================

const triggerSchema = z.object({
  id: z.string(),
  name: z.string(),
  goal: z.string(),
  schedule: triggerScheduleSchema,

  // Optional configuration
  modelTier: modelTierSchema.optional(),
  setupContext: z.string().optional(),

  // Limits (for recurring triggers)
  maxInvocations: z.number().int().positive().optional(),
  endsAt: z.string().optional(), // ISO8601

  // State
  status: triggerStatusSchema,
  invocationCount: z.number().int().nonnegative(),
  consecutiveFailures: z.number().int().nonnegative(),
  lastInvokedAt: z.string().optional(), // ISO8601
  nextInvocationAt: z.string().optional(), // ISO8601 (calculated)
  lastError: z.string().optional(),

  // Relationships
  createdByConversationId: z.string().optional(),

  // Timestamps
  createdAt: z.string(),
  updatedAt: z.string(),
});

type Trigger = z.infer<typeof triggerSchema>;

// ============================================================================
// Create Trigger Input
// ============================================================================

const createTriggerInputSchema = z.object({
  name: z.string().min(1),
  goal: z.string().min(1),
  schedule: triggerScheduleSchema,
  modelTier: modelTierSchema.optional(),
  setupContext: z.string().optional(),
  maxInvocations: z.number().int().positive().optional(),
  endsAt: z.string().optional(),
});

type CreateTriggerInput = z.input<typeof createTriggerInputSchema>;

// ============================================================================
// Update Trigger Input
// ============================================================================

const updateTriggerInputSchema = z.object({
  name: z.string().min(1).optional(),
  goal: z.string().min(1).optional(),
  schedule: triggerScheduleSchema.optional(),
  modelTier: modelTierSchema.optional(),
  setupContext: z.string().optional(),
  maxInvocations: z.number().int().positive().nullable().optional(),
  endsAt: z.string().nullable().optional(),
  status: z.enum(['active', 'paused']).optional(), // Can only pause/resume via update
});

type UpdateTriggerInput = z.input<typeof updateTriggerInputSchema>;

// ============================================================================
// Trigger Database Row
// ============================================================================

const triggerRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  goal: z.string(),
  schedule_type: z.string(), // 'once' | 'cron'
  schedule_value: z.string(), // ISO8601 or cron expression
  model_tier: z.string().nullable(),
  setup_context: z.string().nullable(),
  max_invocations: z.number().nullable(),
  ends_at: z.string().nullable(),

  // State
  status: z.string(),
  invocation_count: z.number(),
  consecutive_failures: z.number(),
  last_invoked_at: z.string().nullable(),
  next_invocation_at: z.string().nullable(),
  last_error: z.string().nullable(),

  // Relationships
  created_by_conversation_id: z.string().nullable(),

  // Timestamps
  created_at: z.string(),
  updated_at: z.string(),
});

type TriggerRow = z.infer<typeof triggerRowSchema>;

// ============================================================================
// Trigger Conversation Junction
// ============================================================================

const triggerConversationSchema = z.object({
  triggerId: z.string(),
  conversationId: z.string(),
  invokedAt: z.string(),
});

type TriggerConversation = z.infer<typeof triggerConversationSchema>;

const triggerConversationRowSchema = z.object({
  trigger_id: z.string(),
  conversation_id: z.string(),
  invoked_at: z.string(),
});

type TriggerConversationRow = z.infer<typeof triggerConversationRowSchema>;

// ============================================================================
// Notify Input (for the notify tool)
// ============================================================================

const notifyInputSchema = z.object({
  title: z.string().max(100),
  body: z.string().max(1000),
  urgency: z.enum(['low', 'medium', 'high', 'critical']).optional().default('medium'),
});

type NotifyInput = z.infer<typeof notifyInputSchema>;

// ============================================================================
// Notify Result
// ============================================================================

const notifyResultSchema = z.object({
  notificationId: z.string(),
  delivered: z.boolean(),
});

type NotifyResult = z.infer<typeof notifyResultSchema>;

// ============================================================================
// Trigger Context (injected into agent when running from trigger)
// ============================================================================

const triggerContextSchema = z.object({
  triggerId: z.string(),
  triggerName: z.string(),
  goal: z.string(),
  setupContext: z.string().optional(),
  invocationCount: z.number(),
  schedule: triggerScheduleSchema,
});

type TriggerContext = z.infer<typeof triggerContextSchema>;

// ============================================================================
// Exports
// ============================================================================

export type {
  ModelTier,
  TriggerSchedule,
  TriggerStatus,
  Trigger,
  CreateTriggerInput,
  UpdateTriggerInput,
  TriggerRow,
  TriggerConversation,
  TriggerConversationRow,
  NotifyInput,
  NotifyResult,
  TriggerContext,
};

export {
  modelTierSchema,
  triggerScheduleOnceSchema,
  triggerScheduleCronSchema,
  triggerScheduleSchema,
  triggerStatusSchema,
  triggerSchema,
  createTriggerInputSchema,
  updateTriggerInputSchema,
  triggerRowSchema,
  triggerConversationSchema,
  triggerConversationRowSchema,
  notifyInputSchema,
  notifyResultSchema,
  triggerContextSchema,
};
