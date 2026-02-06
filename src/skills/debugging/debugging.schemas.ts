import { z } from 'zod';

// ============================================================================
// Scheduler State
// ============================================================================

/**
 * Snapshot of a scheduled trigger from the in-memory scheduler.
 */
const scheduledTriggerSnapshotSchema = z.object({
  triggerId: z.string(),
  triggerName: z.string().optional(),
  scheduledFireTime: z.string(),
  delayMs: z.number(),
});

type ScheduledTriggerSnapshot = z.infer<typeof scheduledTriggerSnapshotSchema>;

/**
 * In-memory scheduler state.
 */
const schedulerStateSchema = z.object({
  running: z.boolean(),
  scheduledCount: z.number(),
  scheduledTriggers: z.array(scheduledTriggerSnapshotSchema),
});

type SchedulerState = z.infer<typeof schedulerStateSchema>;

// ============================================================================
// Trigger Debug Views
// ============================================================================

/**
 * Extended trigger information for debugging.
 */
const triggerSchedulerStateSchema = z.object({
  isScheduled: z.boolean(),
  scheduledFireTime: z.string().nullable(),
  timerDelayMs: z.number().nullable(),
});

type TriggerSchedulerState = z.infer<typeof triggerSchedulerStateSchema>;

/**
 * Trigger invocation record for debugging.
 */
const triggerInvocationSchema = z.object({
  triggerId: z.string(),
  triggerName: z.string(),
  conversationId: z.string(),
  invokedAt: z.string(),
  invocationNumber: z.number().optional(),
});

type TriggerInvocation = z.infer<typeof triggerInvocationSchema>;

// ============================================================================
// Conversation Debug Views
// ============================================================================

/**
 * Debug view of a message.
 */
const debugMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'tool']),
  content: z.string(),
  toolCallId: z.string().optional(),
  toolCalls: z.unknown().optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  createdAt: z.string(),
});

type DebugMessage = z.infer<typeof debugMessageSchema>;

/**
 * Debug view of an interrupt.
 */
const debugInterruptSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string(),
  prompt: z.string(),
  createdAt: z.string(),
});

type DebugInterrupt = z.infer<typeof debugInterruptSchema>;

/**
 * Conversation debug view with full details.
 */
const conversationDebugViewSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  summary: z.string().optional(),
  startedAt: z.string(),
  lastActivityAt: z.string(),
  messageCount: z.number(),
  messages: z.array(debugMessageSchema),
  trigger: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .optional(),
  telegramChat: z
    .object({
      chatId: z.number(),
      userId: z.number(),
    })
    .optional(),
  pendingInterrupts: z.array(debugInterruptSchema),
});

type ConversationDebugView = z.infer<typeof conversationDebugViewSchema>;

// ============================================================================
// System Health
// ============================================================================

/**
 * Service status for health check.
 */
const serviceStatusSchema = z.object({
  configured: z.boolean(),
  running: z.boolean().optional(),
  scheduledCount: z.number().optional(),
  ownerId: z.number().optional(),
});

type ServiceStatus = z.infer<typeof serviceStatusSchema>;

/**
 * Trigger statistics.
 */
const triggerStatsSchema = z.object({
  total: z.number(),
  active: z.number(),
  paused: z.number(),
  completed: z.number(),
  failed: z.number(),
});

type TriggerStats = z.infer<typeof triggerStatsSchema>;

/**
 * System health response.
 */
const systemHealthSchema = z.object({
  services: z.object({
    database: serviceStatusSchema,
    orchestrator: serviceStatusSchema,
    triggerService: serviceStatusSchema,
    telegramClient: serviceStatusSchema,
  }),
  triggers: triggerStatsSchema,
  conversations: z.object({
    total: z.number(),
    recentCount: z.number(),
  }),
});

type SystemHealth = z.infer<typeof systemHealthSchema>;

// ============================================================================
// Exports
// ============================================================================

export type {
  ScheduledTriggerSnapshot,
  SchedulerState,
  TriggerSchedulerState,
  TriggerInvocation,
  DebugMessage,
  DebugInterrupt,
  ConversationDebugView,
  ServiceStatus,
  TriggerStats,
  SystemHealth,
};

export {
  scheduledTriggerSnapshotSchema,
  schedulerStateSchema,
  triggerSchedulerStateSchema,
  triggerInvocationSchema,
  debugMessageSchema,
  debugInterruptSchema,
  conversationDebugViewSchema,
  serviceStatusSchema,
  triggerStatsSchema,
  systemHealthSchema,
};
