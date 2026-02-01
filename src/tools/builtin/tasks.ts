import { z } from 'zod';

import type { ToolDefinition, ToolContext, ToolRegistry } from '../tools.ts';
import {
  TaskService,
  flexibleTriggerInputSchema,
  userTaskSchema,
  userTaskStatusSchema,
  delegatedTaskSchema,
  waitingForSchema,
  createStepInputSchema,
} from '../../tasks/tasks.ts';

// ============================================================================
// Create User Task
// ============================================================================

const createUserTaskInputSchema = z.object({
  description: z.string().min(1).describe('Task description'),
  trigger: flexibleTriggerInputSchema.describe(
    'When the task should trigger. Accepts natural language like "in 5 minutes", "tomorrow at 9am", or ISO format "2026-02-01T10:00:00Z". For advanced scheduling, use structured objects.',
  ),
  relatedProjects: z.array(z.string()).optional().describe('Related project IDs'),
  relatedContacts: z.array(z.string()).optional().describe('Related contact IDs'),
  notes: z.string().optional().describe('Additional notes'),
  tags: z.array(z.string()).optional().describe('Tags for categorization'),
});

const createUserTaskOutputSchema = userTaskSchema;

type CreateUserTaskInput = z.infer<typeof createUserTaskInputSchema>;
type CreateUserTaskRawInput = z.input<typeof createUserTaskInputSchema>;
type CreateUserTaskOutput = z.infer<typeof createUserTaskOutputSchema>;

const createUserTaskTool: ToolDefinition<CreateUserTaskInput, CreateUserTaskOutput, CreateUserTaskRawInput> = {
  id: 'tasks.create_user_task',
  name: 'CreateUserTask',
  description:
    'Create a new task for the user with flexible scheduling. Supports deadlines, recurring schedules, opportunistic tasks, and conditional triggers.',
  category: 'tasks',
  inputSchema: createUserTaskInputSchema,
  outputSchema: createUserTaskOutputSchema,
  risk: {
    level: 'low',
    reason: 'Creates a new task entry',
    potentialImpact: 'Adds to task list',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['tasks', 'user', 'write'],
  examples: [
    {
      input: {
        description: 'Go to bed',
        trigger: 'in 5 minutes',
      },
      description: 'Create a reminder using natural language',
    },
    {
      input: {
        description: 'Watch the AMP video',
        trigger: 'tomorrow at 9am',
      },
      description: 'Create a task for tomorrow morning',
    },
    {
      input: {
        description: 'Submit expense report',
        trigger: '2024-03-15T17:00:00Z',
      },
      description: 'Create a task with ISO datetime',
    },
    {
      input: {
        description: 'Weekly team update',
        trigger: { type: 'recurring_time', schedule: '0 9 * * 1' },
      },
      description: 'Create a recurring task (structured format)',
    },
  ],
  execute: async (input: CreateUserTaskInput, context: ToolContext): Promise<CreateUserTaskOutput> => {
    const taskService = context.services.get(TaskService);
    return taskService.createUserTask(input);
  },
};

// ============================================================================
// List User Tasks
// ============================================================================

const listUserTasksInputSchema = z.object({
  status: userTaskStatusSchema.optional().describe('Filter by status'),
  triggerType: z.string().optional().describe('Filter by trigger type'),
  limit: z.number().positive().optional().describe('Maximum number of results'),
});

const listUserTasksOutputSchema = z.object({
  tasks: z.array(userTaskSchema),
  count: z.number(),
});

type ListUserTasksInput = z.infer<typeof listUserTasksInputSchema>;
type ListUserTasksOutput = z.infer<typeof listUserTasksOutputSchema>;

const listUserTasksTool: ToolDefinition<ListUserTasksInput, ListUserTasksOutput> = {
  id: 'tasks.list_user_tasks',
  name: 'ListUserTasks',
  description: 'List user tasks with optional filtering by status or trigger type.',
  category: 'tasks',
  inputSchema: listUserTasksInputSchema,
  outputSchema: listUserTasksOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['tasks', 'user', 'read', 'list'],
  examples: [
    { input: {}, description: 'List all user tasks' },
    { input: { status: 'pending' }, description: 'List pending tasks' },
  ],
  execute: async (input: ListUserTasksInput, context: ToolContext): Promise<ListUserTasksOutput> => {
    const taskService = context.services.get(TaskService);
    const tasks = await taskService.listUserTasks(input);
    return { tasks, count: tasks.length };
  },
};

// ============================================================================
// Complete User Task
// ============================================================================

const completeUserTaskInputSchema = z.object({
  id: z.string().describe('Task ID to complete'),
});

const completeUserTaskOutputSchema = userTaskSchema;

type CompleteUserTaskInput = z.infer<typeof completeUserTaskInputSchema>;
type CompleteUserTaskOutput = z.infer<typeof completeUserTaskOutputSchema>;

const completeUserTaskTool: ToolDefinition<CompleteUserTaskInput, CompleteUserTaskOutput> = {
  id: 'tasks.complete_user_task',
  name: 'CompleteUserTask',
  description: 'Mark a user task as completed.',
  category: 'tasks',
  inputSchema: completeUserTaskInputSchema,
  outputSchema: completeUserTaskOutputSchema,
  risk: {
    level: 'low',
    reason: 'Updates task status',
    potentialImpact: 'Task will be marked as done',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['tasks', 'user', 'write'],
  examples: [{ input: { id: 'task-123' }, description: 'Complete a task' }],
  execute: async (input: CompleteUserTaskInput, context: ToolContext): Promise<CompleteUserTaskOutput> => {
    const taskService = context.services.get(TaskService);
    return taskService.completeUserTask(input.id);
  },
};

// ============================================================================
// Create Delegated Task
// ============================================================================

const createDelegatedTaskInputSchema = z.object({
  description: z.string().min(1).describe('Task description'),
  steps: z.array(createStepInputSchema).min(1).describe('Steps to complete the task'),
  userTaskId: z.string().optional().describe('Link to a user task if applicable'),
  relatedProjects: z.array(z.string()).optional().describe('Related project IDs'),
  relatedContacts: z.array(z.string()).optional().describe('Related contact IDs'),
  tags: z.array(z.string()).optional().describe('Tags for categorization'),
});

const createDelegatedTaskOutputSchema = delegatedTaskSchema;

type CreateDelegatedTaskInput = z.infer<typeof createDelegatedTaskInputSchema>;
type CreateDelegatedTaskOutput = z.infer<typeof createDelegatedTaskOutputSchema>;

const createDelegatedTaskTool: ToolDefinition<CreateDelegatedTaskInput, CreateDelegatedTaskOutput> = {
  id: 'tasks.create_delegated_task',
  name: 'CreateDelegatedTask',
  description: 'Create a new multi-step task for the agent to work on autonomously.',
  category: 'tasks',
  inputSchema: createDelegatedTaskInputSchema,
  outputSchema: createDelegatedTaskOutputSchema,
  risk: {
    level: 'low',
    reason: 'Creates a new task entry',
    potentialImpact: 'Adds to task queue',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['tasks', 'delegated', 'write'],
  examples: [
    {
      input: {
        description: 'Book flight to London',
        steps: [
          { description: 'Search for flights' },
          { description: 'Present options to user' },
          { description: 'Book selected flight' },
        ],
      },
      description: 'Create a multi-step booking task',
    },
  ],
  execute: async (input: CreateDelegatedTaskInput, context: ToolContext): Promise<CreateDelegatedTaskOutput> => {
    const taskService = context.services.get(TaskService);
    return taskService.createTask(input);
  },
};

// ============================================================================
// Get Active Tasks
// ============================================================================

const getActiveTasksInputSchema = z.object({});

const getActiveTasksOutputSchema = z.object({
  tasks: z.array(delegatedTaskSchema),
  count: z.number(),
});

type GetActiveTasksInput = z.infer<typeof getActiveTasksInputSchema>;
type GetActiveTasksOutput = z.infer<typeof getActiveTasksOutputSchema>;

const getActiveTasksTool: ToolDefinition<GetActiveTasksInput, GetActiveTasksOutput> = {
  id: 'tasks.get_active_tasks',
  name: 'GetActiveTasks',
  description: 'Get all delegated tasks that are currently active (in progress).',
  category: 'tasks',
  inputSchema: getActiveTasksInputSchema,
  outputSchema: getActiveTasksOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['tasks', 'delegated', 'read'],
  examples: [{ input: {}, description: 'Get active tasks' }],
  execute: async (_input: GetActiveTasksInput, context: ToolContext): Promise<GetActiveTasksOutput> => {
    const taskService = context.services.get(TaskService);
    const tasks = await taskService.getActiveTasks();
    return { tasks, count: tasks.length };
  },
};

// ============================================================================
// Advance Task Step
// ============================================================================

const advanceTaskStepInputSchema = z.object({
  id: z.string().describe('Task ID'),
  result: z.unknown().optional().describe('Result from the completed step'),
});

const advanceTaskStepOutputSchema = delegatedTaskSchema;

type AdvanceTaskStepInput = z.infer<typeof advanceTaskStepInputSchema>;
type AdvanceTaskStepOutput = z.infer<typeof advanceTaskStepOutputSchema>;

const advanceTaskStepTool: ToolDefinition<AdvanceTaskStepInput, AdvanceTaskStepOutput> = {
  id: 'tasks.advance_task_step',
  name: 'AdvanceTaskStep',
  description: 'Mark the current step as completed and move to the next step.',
  category: 'tasks',
  inputSchema: advanceTaskStepInputSchema,
  outputSchema: advanceTaskStepOutputSchema,
  risk: {
    level: 'low',
    reason: 'Updates task progress',
    potentialImpact: 'Advances task workflow',
    reversible: false,
    categories: ['data_modification'],
  },
  tags: ['tasks', 'delegated', 'write'],
  examples: [
    { input: { id: 'task-123' }, description: 'Advance to next step' },
    { input: { id: 'task-123', result: { found: 5 } }, description: 'Advance with result' },
  ],
  execute: async (input: AdvanceTaskStepInput, context: ToolContext): Promise<AdvanceTaskStepOutput> => {
    const taskService = context.services.get(TaskService);
    return taskService.advanceStep(input.id, input.result);
  },
};

// ============================================================================
// Set Task Waiting
// ============================================================================

const setTaskWaitingInputSchema = z.object({
  id: z.string().describe('Task ID'),
  waitingFor: waitingForSchema.describe('What the task is waiting for'),
});

const setTaskWaitingOutputSchema = delegatedTaskSchema;

type SetTaskWaitingInput = z.infer<typeof setTaskWaitingInputSchema>;
type SetTaskWaitingOutput = z.infer<typeof setTaskWaitingOutputSchema>;

const setTaskWaitingTool: ToolDefinition<SetTaskWaitingInput, SetTaskWaitingOutput> = {
  id: 'tasks.set_task_waiting',
  name: 'SetTaskWaiting',
  description: 'Set a task to waiting state until a condition is met.',
  category: 'tasks',
  inputSchema: setTaskWaitingInputSchema,
  outputSchema: setTaskWaitingOutputSchema,
  risk: {
    level: 'low',
    reason: 'Updates task status',
    potentialImpact: 'Task will pause until condition is met',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['tasks', 'delegated', 'write'],
  examples: [
    {
      input: {
        id: 'task-123',
        waitingFor: {
          type: 'user_response',
          description: 'Waiting for user to select flight option',
          condition: 'user.selected_flight',
          onTimeout: 'remind',
        },
      },
      description: 'Set task to wait for user response',
    },
  ],
  execute: async (input: SetTaskWaitingInput, context: ToolContext): Promise<SetTaskWaitingOutput> => {
    const taskService = context.services.get(TaskService);
    return taskService.setWaiting(input.id, input.waitingFor);
  },
};

// ============================================================================
// Start Delegated Task
// ============================================================================

const startDelegatedTaskInputSchema = z.object({
  id: z.string().describe('Task ID to start'),
});

const startDelegatedTaskOutputSchema = delegatedTaskSchema;

type StartDelegatedTaskInput = z.infer<typeof startDelegatedTaskInputSchema>;
type StartDelegatedTaskOutput = z.infer<typeof startDelegatedTaskOutputSchema>;

const startDelegatedTaskTool: ToolDefinition<StartDelegatedTaskInput, StartDelegatedTaskOutput> = {
  id: 'tasks.start_delegated_task',
  name: 'StartDelegatedTask',
  description: 'Start working on a pending delegated task.',
  category: 'tasks',
  inputSchema: startDelegatedTaskInputSchema,
  outputSchema: startDelegatedTaskOutputSchema,
  risk: {
    level: 'low',
    reason: 'Updates task status',
    potentialImpact: 'Task becomes active',
    reversible: false,
    categories: ['data_modification'],
  },
  tags: ['tasks', 'delegated', 'write'],
  examples: [{ input: { id: 'task-123' }, description: 'Start a pending task' }],
  execute: async (input: StartDelegatedTaskInput, context: ToolContext): Promise<StartDelegatedTaskOutput> => {
    const taskService = context.services.get(TaskService);
    return taskService.startTask(input.id);
  },
};

// ============================================================================
// Get Delegated Task
// ============================================================================

const getDelegatedTaskInputSchema = z.object({
  id: z.string().describe('Task ID'),
});

const getDelegatedTaskOutputSchema = z.object({
  task: delegatedTaskSchema.nullable(),
  found: z.boolean(),
});

type GetDelegatedTaskInput = z.infer<typeof getDelegatedTaskInputSchema>;
type GetDelegatedTaskOutput = z.infer<typeof getDelegatedTaskOutputSchema>;

const getDelegatedTaskTool: ToolDefinition<GetDelegatedTaskInput, GetDelegatedTaskOutput> = {
  id: 'tasks.get_delegated_task',
  name: 'GetDelegatedTask',
  description: 'Get a delegated task by ID.',
  category: 'tasks',
  inputSchema: getDelegatedTaskInputSchema,
  outputSchema: getDelegatedTaskOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['tasks', 'delegated', 'read'],
  examples: [{ input: { id: 'task-123' }, description: 'Get a task by ID' }],
  execute: async (input: GetDelegatedTaskInput, context: ToolContext): Promise<GetDelegatedTaskOutput> => {
    const taskService = context.services.get(TaskService);
    const task = await taskService.getTask(input.id);
    return { task, found: task !== null };
  },
};

// ============================================================================
// Registration
// ============================================================================

const registerTaskTools = (registry: ToolRegistry): void => {
  // User task tools
  registry.register(createUserTaskTool);
  registry.register(listUserTasksTool);
  registry.register(completeUserTaskTool);

  // Delegated task tools
  registry.register(createDelegatedTaskTool);
  registry.register(getActiveTasksTool);
  registry.register(advanceTaskStepTool);
  registry.register(setTaskWaitingTool);
  registry.register(startDelegatedTaskTool);
  registry.register(getDelegatedTaskTool);
};

// ============================================================================
// Exports
// ============================================================================

export {
  createUserTaskTool,
  listUserTasksTool,
  completeUserTaskTool,
  createDelegatedTaskTool,
  getActiveTasksTool,
  advanceTaskStepTool,
  setTaskWaitingTool,
  startDelegatedTaskTool,
  getDelegatedTaskTool,
  registerTaskTools,
};
