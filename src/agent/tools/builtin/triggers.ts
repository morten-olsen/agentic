import { z } from 'zod';

import type { ToolDefinition, ToolContext, ToolRegistry } from '../tools.ts';
import {
  TriggerService,
  triggerSchema,
  triggerStatusSchema,
  notifyInputSchema,
  notifyResultSchema,
  TriggerNotFoundError,
} from '../../../features/triggers/triggers.ts';
import { NotifyNotAllowedError } from '../../../features/triggers/triggers.errors.ts';

// ============================================================================
// Utilities
// ============================================================================

/** Converts null to undefined for service boundary compatibility */
const nullToUndefined = <T>(value: T | null | undefined): T | undefined => (value === null ? undefined : value);

// ============================================================================
// Create Trigger
// ============================================================================

const createTriggerInputSchema = z.object({
  name: z.string().min(1).describe('Human-readable name for the trigger'),
  goal: z.string().min(1).describe('What the agent should accomplish when invoked'),
  schedule: z
    .object({
      type: z.enum(['once', 'cron']),
      at: z.string().nullish().describe('ISO8601 datetime for one-time triggers'),
      expression: z.string().nullish().describe('Cron expression for recurring triggers'),
    })
    .describe('When to trigger. For one-time: type="once" with at. For recurring: type="cron" with expression.'),
  setupContext: z.string().nullish().describe('Why this trigger is being created (for agent context)'),
  maxInvocations: z.number().int().positive().nullish().describe('For recurring: stop after N invocations'),
  endsAt: z.string().nullish().describe('For recurring: stop after this datetime (ISO8601)'),
});

const createTriggerOutputSchema = z.object({
  triggerId: z.string(),
  nextInvocationAt: z.string().nullable(),
});

type CreateTriggerInput = z.infer<typeof createTriggerInputSchema>;
type CreateTriggerOutput = z.infer<typeof createTriggerOutputSchema>;

const createTriggerTool: ToolDefinition<CreateTriggerInput, CreateTriggerOutput> = {
  id: 'triggers.create_trigger',
  name: 'CreateTrigger',
  description: `Create a scheduled trigger that will invoke the agent at a specified time.

For one-time triggers, provide schedule.type='once' with an ISO8601 datetime.
For recurring triggers, provide schedule.type='cron' with a cron expression.

Cron format: minute hour day-of-month month day-of-week
Examples:
  - "0 9 * * *" = Every day at 9:00 AM
  - "0 9 * * 1-5" = Weekdays at 9:00 AM
  - "*/15 * * * *" = Every 15 minutes
  - "0 8,12,18 * * *" = At 8 AM, 12 PM, and 6 PM

Times are in the user's timezone.`,
  category: 'triggers',
  inputSchema: createTriggerInputSchema,
  outputSchema: createTriggerOutputSchema,
  risk: {
    level: 'low',
    reason: 'Creates a scheduled trigger',
    potentialImpact: 'Agent will be invoked at scheduled times',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['triggers', 'scheduling', 'write'],
  examples: [
    {
      input: {
        name: 'check-email-reminder',
        goal: 'Remind the user to check their email',
        schedule: { type: 'once', at: '2024-03-15T10:00:00Z' },
      },
      description: 'Create a one-time reminder',
    },
    {
      input: {
        name: 'daily-standup-prep',
        goal: 'Review calendar and tasks to prepare standup notes',
        schedule: { type: 'cron', expression: '0 9 * * 1-5' },
        setupContext: 'User wants help preparing for daily standups',
      },
      description: 'Create a recurring weekday trigger',
    },
  ],
  execute: async (input: CreateTriggerInput, context: ToolContext): Promise<CreateTriggerOutput> => {
    const triggerService = context.services.get(TriggerService);

    // Convert the schedule input to proper discriminated union
    const schedule =
      input.schedule.type === 'once'
        ? { type: 'once' as const, at: input.schedule.at ?? '' }
        : { type: 'cron' as const, expression: input.schedule.expression ?? '' };

    const trigger = await triggerService.create(
      {
        name: input.name,
        goal: input.goal,
        schedule,
        setupContext: nullToUndefined(input.setupContext),
        maxInvocations: nullToUndefined(input.maxInvocations),
        endsAt: nullToUndefined(input.endsAt),
      },
      context.conversationId,
    );

    return {
      triggerId: trigger.id,
      nextInvocationAt: trigger.nextInvocationAt ?? null,
    };
  },
};

// ============================================================================
// Update Trigger
// ============================================================================

const updateTriggerInputSchema = z.object({
  triggerId: z.string().nullish().describe('Trigger ID. Optional when running from a trigger invocation.'),
  name: z.string().min(1).nullish().describe('New name'),
  goal: z.string().min(1).nullish().describe('New goal'),
  schedule: z
    .object({
      type: z.enum(['once', 'cron']),
      at: z.string().nullish(),
      expression: z.string().nullish(),
    })
    .nullish()
    .describe('New schedule'),
  setupContext: z.string().nullish().describe('New setup context'),
  maxInvocations: z.number().int().positive().nullable().nullish().describe('New max invocations (null to remove)'),
  endsAt: z.string().nullable().nullish().describe('New end date (null to remove)'),
  status: z.enum(['active', 'paused']).nullish().describe('Pause or resume the trigger'),
  continuation: z.string().nullish().describe('Note for next invocation (null to clear)'),
});

const updateTriggerOutputSchema = z.object({
  trigger: triggerSchema,
});

type UpdateTriggerInput = z.infer<typeof updateTriggerInputSchema>;
type UpdateTriggerOutput = z.infer<typeof updateTriggerOutputSchema>;

const updateTriggerTool: ToolDefinition<UpdateTriggerInput, UpdateTriggerOutput> = {
  id: 'triggers.update_trigger',
  name: 'UpdateTrigger',
  description: `Update a trigger's configuration or state.

When running from a trigger invocation, omit triggerId to update the trigger that
invoked this conversation. When called from a user conversation, triggerId is required.

Use "continuation" to leave a note for your next invocation. Write it like a message
to your future self - what did you find? What did you notify the user about? This
helps avoid redundant notifications and track changes over time. Use null to clear.

Use status='paused' to temporarily disable a trigger.
Use status='active' to resume a paused trigger.`,
  category: 'triggers',
  inputSchema: updateTriggerInputSchema,
  outputSchema: updateTriggerOutputSchema,
  risk: {
    level: 'low',
    reason: 'Updates trigger configuration',
    potentialImpact: 'Changes when/how the agent is invoked',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['triggers', 'scheduling', 'write'],
  examples: [
    {
      input: { triggerId: 'abc-123', status: 'paused' },
      description: 'Pause a trigger',
    },
    {
      input: { goal: 'Updated goal for the trigger' },
      description: 'Update own trigger goal (when running from trigger)',
    },
    {
      input: { continuation: 'Notified user about 15-minute delay on Northern line. Train status: delayed.' },
      description: 'Save continuation note for next invocation',
    },
    {
      input: { continuation: null },
      description: 'Clear continuation note',
    },
  ],
  execute: async (input: UpdateTriggerInput, context: ToolContext): Promise<UpdateTriggerOutput> => {
    const triggerService = context.services.get(TriggerService);

    // Determine the trigger ID
    const triggerId = input.triggerId ?? context.triggerId;
    if (!triggerId) {
      throw new TriggerNotFoundError('No trigger ID provided and not running from a trigger invocation');
    }

    // Build update input
    const updateInput: Record<string, unknown> = {};
    if (input.name !== undefined) updateInput.name = input.name;
    if (input.goal !== undefined) updateInput.goal = input.goal;
    if (input.setupContext !== undefined) updateInput.setupContext = input.setupContext;
    if (input.maxInvocations !== undefined) updateInput.maxInvocations = input.maxInvocations;
    if (input.endsAt !== undefined) updateInput.endsAt = input.endsAt;
    if (input.status !== undefined) updateInput.status = input.status;
    if (input.continuation !== undefined) updateInput.continuation = input.continuation;

    // Handle schedule conversion
    if (input.schedule) {
      updateInput.schedule =
        input.schedule.type === 'once'
          ? { type: 'once' as const, at: input.schedule.at ?? '' }
          : { type: 'cron' as const, expression: input.schedule.expression ?? '' };
    }

    const trigger = await triggerService.update(triggerId, updateInput);
    return { trigger };
  },
};

// ============================================================================
// Delete Trigger
// ============================================================================

const deleteTriggerInputSchema = z.object({
  triggerId: z.string().nullish().describe('Trigger ID. Optional when running from a trigger invocation.'),
});

const deleteTriggerOutputSchema = z.object({
  deleted: z.boolean(),
});

type DeleteTriggerInput = z.infer<typeof deleteTriggerInputSchema>;
type DeleteTriggerOutput = z.infer<typeof deleteTriggerOutputSchema>;

const deleteTriggerTool: ToolDefinition<DeleteTriggerInput, DeleteTriggerOutput> = {
  id: 'triggers.delete_trigger',
  name: 'DeleteTrigger',
  description: `Delete a trigger permanently.

When running from a trigger invocation, omit triggerId to delete the trigger that
invoked this conversation. When called from a user conversation, triggerId is required.`,
  category: 'triggers',
  inputSchema: deleteTriggerInputSchema,
  outputSchema: deleteTriggerOutputSchema,
  risk: {
    level: 'low',
    reason: 'Deletes a trigger (can be recreated)',
    potentialImpact: 'Trigger will no longer fire',
    reversible: true, // Can recreate the trigger
    categories: ['data_deletion'],
  },
  tags: ['triggers', 'scheduling', 'write', 'delete'],
  examples: [
    {
      input: { triggerId: 'abc-123' },
      description: 'Delete a specific trigger',
    },
    {
      input: {},
      description: 'Delete own trigger (when running from trigger)',
    },
  ],
  execute: async (input: DeleteTriggerInput, context: ToolContext): Promise<DeleteTriggerOutput> => {
    const triggerService = context.services.get(TriggerService);

    // Determine the trigger ID
    const triggerId = input.triggerId ?? context.triggerId;
    if (!triggerId) {
      throw new TriggerNotFoundError('No trigger ID provided and not running from a trigger invocation');
    }

    await triggerService.delete(triggerId);
    return { deleted: true };
  },
};

// ============================================================================
// List Triggers
// ============================================================================

const listTriggersInputSchema = z.object({
  status: triggerStatusSchema.nullish().describe('Filter by status'),
  limit: z.number().int().positive().nullish().default(50).describe('Maximum number of results'),
});

const listTriggersOutputSchema = z.object({
  triggers: z.array(triggerSchema),
  count: z.number(),
});

type ListTriggersInput = z.infer<typeof listTriggersInputSchema>;
type ListTriggersInputRaw = z.input<typeof listTriggersInputSchema>;
type ListTriggersOutput = z.infer<typeof listTriggersOutputSchema>;

const listTriggersTool: ToolDefinition<ListTriggersInput, ListTriggersOutput, ListTriggersInputRaw> = {
  id: 'triggers.list_triggers',
  name: 'ListTriggers',
  description: 'List all triggers or filter by status.',
  category: 'triggers',
  inputSchema: listTriggersInputSchema,
  outputSchema: listTriggersOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['triggers', 'scheduling', 'read', 'list'],
  examples: [
    { input: {}, description: 'List all triggers' },
    { input: { status: 'active' }, description: 'List active triggers' },
  ],
  execute: async (input: ListTriggersInput, context: ToolContext): Promise<ListTriggersOutput> => {
    const triggerService = context.services.get(TriggerService);
    const triggers = await triggerService.list({
      status: nullToUndefined(input.status),
      limit: input.limit ?? 50,
    });
    return { triggers, count: triggers.length };
  },
};

// ============================================================================
// Notify
// ============================================================================

const notifyToolInputSchema = notifyInputSchema.extend({
  title: z.string().max(100).describe('Short notification title (max 100 chars)'),
  body: z.string().max(1000).describe('Notification content (max 1000 chars)'),
  urgency: z.enum(['low', 'medium', 'high', 'critical']).nullish().default('medium').describe('Notification urgency'),
});

type NotifyInput = z.infer<typeof notifyToolInputSchema>;
type NotifyOutput = z.infer<typeof notifyResultSchema>;

const notifyTool: ToolDefinition<NotifyInput, NotifyOutput> = {
  id: 'triggers.notify',
  name: 'Notify',
  description: `Send a notification to the user via Telegram.

Use this when you have completed a background task and have information
the user should know about. Keep notifications concise and actionable.

This tool is only available when running from a trigger invocation (not in
user-initiated conversations, where you can respond directly).`,
  category: 'triggers',
  inputSchema: notifyToolInputSchema,
  outputSchema: notifyResultSchema,
  risk: {
    level: 'low',
    reason: 'Sends a notification to the user',
    potentialImpact: 'User receives a Telegram message',
    reversible: false,
    categories: ['external_communication'],
  },
  tags: ['triggers', 'notifications', 'telegram'],
  examples: [
    {
      input: {
        title: 'Meeting in 15 minutes',
        body: 'Your meeting with John starts at 2:00 PM. Remember to prepare the Q3 report.',
        urgency: 'high',
      },
      description: 'Send an urgent meeting reminder',
    },
    {
      input: {
        title: 'Daily Summary',
        body: 'You have 3 tasks due today and 2 meetings scheduled.',
        urgency: 'low',
      },
      description: 'Send a daily summary notification',
    },
  ],
  execute: async (input: NotifyInput, context: ToolContext): Promise<NotifyOutput> => {
    // Check if running from a trigger
    if (!context.triggerId) {
      throw new NotifyNotAllowedError();
    }

    const triggerService = context.services.get(TriggerService);
    return triggerService.sendNotification({
      title: input.title,
      body: input.body,
      urgency: input.urgency ?? 'medium',
    });
  },
};

// ============================================================================
// Registration
// ============================================================================

const registerTriggerTools = (registry: ToolRegistry): void => {
  registry.register(createTriggerTool);
  registry.register(updateTriggerTool);
  registry.register(deleteTriggerTool);
  registry.register(listTriggersTool);
  registry.register(notifyTool);
};

// ============================================================================
// Exports
// ============================================================================

export { createTriggerTool, updateTriggerTool, deleteTriggerTool, listTriggersTool, notifyTool, registerTriggerTools };
