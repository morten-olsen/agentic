import { z } from 'zod';

import { urgencySchema } from '../notifications/notifications.schemas.ts';

// ============================================================================
// Check Types
// ============================================================================

const checkTypeSchema = z.enum(['builtin', 'custom']);

type CheckType = z.infer<typeof checkTypeSchema>;

// ============================================================================
// Run Status
// ============================================================================

const runStatusSchema = z.enum(['running', 'completed', 'failed', 'skipped']);

type RunStatus = z.infer<typeof runStatusSchema>;

// ============================================================================
// Suggested Action
// ============================================================================

const suggestedActionTypeSchema = z.enum(['notify', 'task', 'question']);

const suggestedActionSchema = z.object({
  type: suggestedActionTypeSchema,
  content: z.string(),
  options: z.array(z.string()).optional(),
});

type SuggestedAction = z.infer<typeof suggestedActionSchema>;

// ============================================================================
// Proactive Result
// ============================================================================

const proactiveResultSchema = z.object({
  finding: z.string(),
  urgency: urgencySchema,
  suggestedAction: suggestedActionSchema,
  shouldNotify: z.boolean(),
  notificationChannel: z.string().optional(),
});

type ProactiveResult = z.infer<typeof proactiveResultSchema>;

// ============================================================================
// Proactive Check
// ============================================================================

const proactiveCheckSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  schedule: z.string(), // Cron expression
  checkType: checkTypeSchema,
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
  lastRunAt: z.string().optional(),
  lastResult: proactiveResultSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

type ProactiveCheck = z.infer<typeof proactiveCheckSchema>;

// ============================================================================
// Create Check Input
// ============================================================================

const createCheckInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  schedule: z.string().min(1), // Cron expression
  checkType: checkTypeSchema.optional().default('custom'),
  enabled: z.boolean().optional().default(true),
  config: z.record(z.string(), z.unknown()).optional(),
});

type CreateCheckInput = z.input<typeof createCheckInputSchema>;

// ============================================================================
// Update Check Input
// ============================================================================

const updateCheckInputSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  schedule: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  lastRunAt: z.string().optional(),
  lastResult: proactiveResultSchema.nullable().optional(),
});

type UpdateCheckInput = z.infer<typeof updateCheckInputSchema>;

// ============================================================================
// Check Database Row
// ============================================================================

const checkRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  schedule: z.string(),
  check_type: z.string(),
  enabled: z.number(), // SQLite boolean
  config: z.string().nullable(), // JSON
  last_run_at: z.string().nullable(),
  last_result: z.string().nullable(), // JSON
  created_at: z.string(),
  updated_at: z.string(),
});

type CheckRow = z.infer<typeof checkRowSchema>;

// ============================================================================
// Proactive Run
// ============================================================================

const proactiveRunSchema = z.object({
  id: z.string(),
  checkId: z.string(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  status: runStatusSchema,
  result: proactiveResultSchema.optional(),
  error: z.string().optional(),
  notificationId: z.string().optional(),
});

type ProactiveRun = z.infer<typeof proactiveRunSchema>;

// ============================================================================
// Run Database Row
// ============================================================================

const runRowSchema = z.object({
  id: z.string(),
  check_id: z.string(),
  started_at: z.string(),
  completed_at: z.string().nullable(),
  status: z.string(),
  result: z.string().nullable(), // JSON
  error: z.string().nullable(),
  notification_id: z.string().nullable(),
});

type RunRow = z.infer<typeof runRowSchema>;

// ============================================================================
// Check Executor (runtime interface)
// ============================================================================

type CheckContext = {
  checkId: string;
  config: Record<string, unknown>;
};

type CheckExecutor = (context: CheckContext) => Promise<ProactiveResult | null>;

// ============================================================================
// Exports
// ============================================================================

export type {
  CheckType,
  RunStatus,
  SuggestedAction,
  ProactiveResult,
  ProactiveCheck,
  CreateCheckInput,
  UpdateCheckInput,
  CheckRow,
  ProactiveRun,
  RunRow,
  CheckContext,
  CheckExecutor,
};

export {
  checkTypeSchema,
  runStatusSchema,
  suggestedActionTypeSchema,
  suggestedActionSchema,
  proactiveResultSchema,
  proactiveCheckSchema,
  createCheckInputSchema,
  updateCheckInputSchema,
  checkRowSchema,
  proactiveRunSchema,
  runRowSchema,
};
