import { z } from 'zod';

// ============================================================================
// Task Triggers (for User Tasks)
// ============================================================================

const deadlineTriggerSchema = z.object({
  type: z.literal('deadline'),
  dueAt: z.string().datetime(),
});

const recurringTimeTriggerSchema = z.object({
  type: z.literal('recurring_time'),
  schedule: z.string(), // Cron expression
  lastRun: z.string().datetime().optional(),
});

const recurringCompletionTriggerSchema = z.object({
  type: z.literal('recurring_completion'),
  intervalDays: z.number().int().positive(),
  lastCompleted: z.string().datetime().optional(),
});

const opportunisticTriggerSchema = z.object({
  type: z.literal('opportunistic'),
  priority: z.number().int().min(1).max(10),
});

const deferredTriggerSchema = z.object({
  type: z.literal('deferred'),
  becomesRelevant: z.string().datetime(),
  condition: z.string().optional(),
});

const conditionalTriggerSchema = z.object({
  type: z.literal('conditional'),
  condition: z.string(),
  watchExpression: z.string(),
});

const taskTriggerSchema = z.discriminatedUnion('type', [
  deadlineTriggerSchema,
  recurringTimeTriggerSchema,
  recurringCompletionTriggerSchema,
  opportunisticTriggerSchema,
  deferredTriggerSchema,
  conditionalTriggerSchema,
]);

type TaskTrigger = z.infer<typeof taskTriggerSchema>;
type TaskTriggerType = TaskTrigger['type'];

// ============================================================================
// User Task Status
// ============================================================================

const userTaskStatusSchema = z.enum(['pending', 'active', 'waiting', 'completed', 'cancelled']);

type UserTaskStatus = z.infer<typeof userTaskStatusSchema>;

// ============================================================================
// User Task
// ============================================================================

const userTaskSchema = z.object({
  id: z.string(),
  description: z.string(),
  trigger: taskTriggerSchema,
  status: userTaskStatusSchema,

  // Context
  relatedProjects: z.array(z.string()).default([]),
  relatedContacts: z.array(z.string()).default([]),
  relatedEntities: z.array(z.string()).default([]),

  // Metadata
  notes: z.string().optional(),
  tags: z.array(z.string()).default([]),

  // Timestamps
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
});

type UserTask = z.infer<typeof userTaskSchema>;

// ============================================================================
// Create User Task Input
// ============================================================================

const createUserTaskInputSchema = z.object({
  description: z.string().min(1),
  trigger: taskTriggerSchema,
  relatedProjects: z.array(z.string()).optional().default([]),
  relatedContacts: z.array(z.string()).optional().default([]),
  relatedEntities: z.array(z.string()).optional().default([]),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
});

type CreateUserTaskInput = z.input<typeof createUserTaskInputSchema>;

// ============================================================================
// Update User Task Input
// ============================================================================

const updateUserTaskInputSchema = z.object({
  description: z.string().min(1).optional(),
  trigger: taskTriggerSchema.optional(),
  status: userTaskStatusSchema.optional(),
  relatedProjects: z.array(z.string()).optional(),
  relatedContacts: z.array(z.string()).optional(),
  relatedEntities: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

type UpdateUserTaskInput = z.infer<typeof updateUserTaskInputSchema>;

// ============================================================================
// User Task Database Row
// ============================================================================

const userTaskRowSchema = z.object({
  id: z.string(),
  description: z.string(),
  trigger_type: z.string(),
  trigger_config: z.string(), // JSON
  status: z.string(),
  related_projects: z.string().nullable(), // JSON
  related_contacts: z.string().nullable(), // JSON
  related_entities: z.string().nullable(), // JSON
  notes: z.string().nullable(),
  tags: z.string().nullable(), // JSON
  created_at: z.string(),
  updated_at: z.string(),
  completed_at: z.string().nullable(),
});

type UserTaskRow = z.infer<typeof userTaskRowSchema>;

// ============================================================================
// Delegated Task Status
// ============================================================================

const delegatedTaskStatusSchema = z.enum(['pending', 'active', 'waiting', 'blocked', 'completed', 'cancelled']);

type DelegatedTaskStatus = z.infer<typeof delegatedTaskStatusSchema>;

// ============================================================================
// Task Step
// ============================================================================

const taskStepStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'skipped', 'failed']);

const taskStepSchema = z.object({
  id: z.string(),
  description: z.string(),
  status: taskStepStatusSchema,
  result: z.unknown().optional(),
  error: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});

type TaskStep = z.infer<typeof taskStepSchema>;
type TaskStepStatus = z.infer<typeof taskStepStatusSchema>;

// ============================================================================
// Task Event (Audit Trail)
// ============================================================================

const taskEventTypeSchema = z.enum([
  'created',
  'started',
  'step_started',
  'step_completed',
  'step_failed',
  'step_skipped',
  'waiting',
  'resumed',
  'completed',
  'failed',
  'cancelled',
]);

const taskEventSchema = z.object({
  timestamp: z.string(),
  type: taskEventTypeSchema,
  details: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

type TaskEvent = z.infer<typeof taskEventSchema>;
type TaskEventType = z.infer<typeof taskEventTypeSchema>;

// ============================================================================
// Waiting Condition
// ============================================================================

const waitingForTypeSchema = z.enum(['time', 'event', 'user_response', 'external']);

const timeoutActionSchema = z.enum(['remind', 'escalate', 'cancel', 'proceed']);

const waitingForSchema = z.object({
  type: waitingForTypeSchema,
  description: z.string(),
  condition: z.string(),
  deadline: z.string().datetime().optional(),
  checkSchedule: z.string().optional(), // Cron expression
  onTimeout: timeoutActionSchema,
});

type WaitingFor = z.infer<typeof waitingForSchema>;
type WaitingForType = z.infer<typeof waitingForTypeSchema>;
type TimeoutAction = z.infer<typeof timeoutActionSchema>;

// ============================================================================
// Delegated Task
// ============================================================================

const delegatedTaskSchema = z.object({
  id: z.string(),
  description: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),

  // Link to user task
  userTaskId: z.string().optional(),

  // Status
  status: delegatedTaskStatusSchema,
  statusReason: z.string().optional(),

  // Multi-step workflow
  steps: z.array(taskStepSchema),
  currentStepIndex: z.number().int().min(0),

  // Waiting for something
  waitingFor: waitingForSchema.optional(),

  // Context
  conversationId: z.string().optional(),
  relatedContacts: z.array(z.string()).default([]),
  relatedProjects: z.array(z.string()).default([]),
  relatedEntities: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),

  // Audit trail
  history: z.array(taskEventSchema),
});

type DelegatedTask = z.infer<typeof delegatedTaskSchema>;

// ============================================================================
// Create Delegated Task Input
// ============================================================================

const createStepInputSchema = z.object({
  description: z.string().min(1),
});

const createDelegatedTaskInputSchema = z.object({
  description: z.string().min(1),
  steps: z.array(createStepInputSchema).min(1),
  userTaskId: z.string().optional(),
  conversationId: z.string().optional(),
  relatedContacts: z.array(z.string()).optional().default([]),
  relatedProjects: z.array(z.string()).optional().default([]),
  relatedEntities: z.array(z.string()).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
});

type CreateDelegatedTaskInput = z.input<typeof createDelegatedTaskInputSchema>;

// ============================================================================
// Update Delegated Task Input
// ============================================================================

const updateDelegatedTaskInputSchema = z.object({
  description: z.string().min(1).optional(),
  status: delegatedTaskStatusSchema.optional(),
  statusReason: z.string().nullable().optional(),
  waitingFor: waitingForSchema.nullable().optional(),
  relatedContacts: z.array(z.string()).optional(),
  relatedProjects: z.array(z.string()).optional(),
  relatedEntities: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

type UpdateDelegatedTaskInput = z.infer<typeof updateDelegatedTaskInputSchema>;

// ============================================================================
// Delegated Task Database Row
// ============================================================================

const delegatedTaskRowSchema = z.object({
  id: z.string(),
  description: z.string(),
  user_task_id: z.string().nullable(),
  status: z.string(),
  status_reason: z.string().nullable(),
  steps: z.string(), // JSON
  current_step_index: z.number(),
  waiting_for: z.string().nullable(), // JSON
  conversation_id: z.string().nullable(),
  related_contacts: z.string().nullable(), // JSON
  related_projects: z.string().nullable(), // JSON
  related_entities: z.string().nullable(), // JSON
  tags: z.string().nullable(), // JSON
  history: z.string(), // JSON
  created_at: z.string(),
  updated_at: z.string(),
});

type DelegatedTaskRow = z.infer<typeof delegatedTaskRowSchema>;

// ============================================================================
// Pending Task Context (for agent context)
// ============================================================================

const pendingTaskContextSchema = z.object({
  id: z.string(),
  description: z.string(),
  type: z.enum(['user', 'delegated']),
  status: z.string(),
  currentStep: z.string().optional(),
  waitingFor: z.string().optional(),
});

type PendingTaskContext = z.infer<typeof pendingTaskContextSchema>;

// ============================================================================
// Exports
// ============================================================================

export type {
  TaskTrigger,
  TaskTriggerType,
  UserTaskStatus,
  UserTask,
  CreateUserTaskInput,
  UpdateUserTaskInput,
  UserTaskRow,
  DelegatedTaskStatus,
  TaskStep,
  TaskStepStatus,
  TaskEvent,
  TaskEventType,
  WaitingFor,
  WaitingForType,
  TimeoutAction,
  DelegatedTask,
  CreateDelegatedTaskInput,
  UpdateDelegatedTaskInput,
  DelegatedTaskRow,
  PendingTaskContext,
};

export {
  // Trigger schemas
  deadlineTriggerSchema,
  recurringTimeTriggerSchema,
  recurringCompletionTriggerSchema,
  opportunisticTriggerSchema,
  deferredTriggerSchema,
  conditionalTriggerSchema,
  taskTriggerSchema,
  // User task schemas
  userTaskStatusSchema,
  userTaskSchema,
  createUserTaskInputSchema,
  updateUserTaskInputSchema,
  userTaskRowSchema,
  // Delegated task schemas
  delegatedTaskStatusSchema,
  taskStepStatusSchema,
  taskStepSchema,
  taskEventTypeSchema,
  taskEventSchema,
  waitingForTypeSchema,
  timeoutActionSchema,
  waitingForSchema,
  delegatedTaskSchema,
  createStepInputSchema,
  createDelegatedTaskInputSchema,
  updateDelegatedTaskInputSchema,
  delegatedTaskRowSchema,
  // Context schema
  pendingTaskContextSchema,
};
