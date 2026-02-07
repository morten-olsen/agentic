import { z } from 'zod';

import type { ToolDefinition, ToolContext, ToolRegistry } from '../tools.ts';
import { DayPlanService, dayPlanSchema, energyLevelSchema } from '../../../features/day-planner/day-planner.ts';

// ============================================================================
// Utilities
// ============================================================================

/** Converts null to undefined for service boundary compatibility */
const nullToUndefined = <T>(value: T | null | undefined): T | undefined => (value === null ? undefined : value);

// ============================================================================
// Day Plan Create Tool
// ============================================================================

const dayPlanCreateInputSchema = z.object({
  intentions: z.array(z.string()).nullish().describe('High-level intentions for the day'),
  priorities: z
    .array(
      z.object({
        description: z.string().describe('Priority description'),
        category: z.string().nullish().describe('Category like work, personal, health'),
      }),
    )
    .nullish()
    .describe('Ordered list of priorities (most important first)'),
  focusBlocks: z
    .array(
      z.object({
        label: z.string().describe('Label for the focus block'),
        startTime: z.string().nullish().describe('Start time (HH:MM format)'),
        duration: z.number().describe('Duration in minutes'),
      }),
    )
    .nullish()
    .describe('Dedicated focus time blocks'),
  energyLevel: energyLevelSchema.nullish().describe("User's expected energy level"),
  notes: z.string().nullish().describe('Additional notes'),
});

const dayPlanCreateOutputSchema = dayPlanSchema;

type DayPlanCreateInput = z.infer<typeof dayPlanCreateInputSchema>;
type DayPlanCreateOutput = z.infer<typeof dayPlanCreateOutputSchema>;

const dayPlanCreateTool: ToolDefinition<DayPlanCreateInput, DayPlanCreateOutput> = {
  id: 'day_planner.create',
  name: 'DayPlanCreate',
  description: `Create or update the day plan for today. Use this during a planning session to capture
the user's intentions and priorities for the day. If a plan already exists for today,
it will be updated with the new information.`,
  category: 'day_planner',
  inputSchema: dayPlanCreateInputSchema,
  outputSchema: dayPlanCreateOutputSchema,
  risk: {
    level: 'low',
    reason: 'Creates or updates day plan data',
    potentialImpact: 'Modifies daily planning data',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['day_planner', 'planning', 'write'],
  examples: [
    {
      input: {
        intentions: ['Make progress on API redesign', 'Follow up on launch timeline'],
        priorities: [
          { description: 'Complete API auth section', category: 'work' },
          { description: 'Prep for Sarah 1:1', category: 'work' },
          { description: 'Exercise', category: 'health' },
        ],
        focusBlocks: [{ label: 'API deep work', startTime: '08:00', duration: 120 }],
        energyLevel: 'medium',
      },
      description: 'Create a day plan with priorities and focus time',
    },
  ],
  execute: async (input: DayPlanCreateInput, context: ToolContext): Promise<DayPlanCreateOutput> => {
    const dayPlanService = context.services.get(DayPlanService);
    return dayPlanService.upsertPlan({
      intentions: nullToUndefined(input.intentions),
      priorities: nullToUndefined(input.priorities)?.map((p) => ({
        description: p.description,
        category: nullToUndefined(p.category),
      })),
      focusBlocks: nullToUndefined(input.focusBlocks)?.map((f) => ({
        label: f.label,
        duration: f.duration,
        startTime: nullToUndefined(f.startTime),
      })),
      energyLevel: nullToUndefined(input.energyLevel),
      notes: nullToUndefined(input.notes),
    });
  },
};

// ============================================================================
// Day Plan Add Priority Tool
// ============================================================================

const dayPlanAddPriorityInputSchema = z.object({
  description: z.string().describe('Priority description'),
  category: z.string().nullish().describe('Category like work, personal, health'),
  position: z.number().int().min(0).nullish().describe('Position in list (0 = top, omit for end)'),
});

const dayPlanAddPriorityOutputSchema = z.object({
  success: z.boolean(),
  priority: z.object({
    id: z.string(),
    description: z.string(),
    category: z.string().optional(),
    completed: z.boolean(),
    sortOrder: z.number(),
  }),
  plan: dayPlanSchema,
});

type DayPlanAddPriorityInput = z.infer<typeof dayPlanAddPriorityInputSchema>;
type DayPlanAddPriorityOutput = z.infer<typeof dayPlanAddPriorityOutputSchema>;

const dayPlanAddPriorityTool: ToolDefinition<DayPlanAddPriorityInput, DayPlanAddPriorityOutput> = {
  id: 'day_planner.add_priority',
  name: 'DayPlanAddPriority',
  description: "Add a new priority to today's plan.",
  category: 'day_planner',
  inputSchema: dayPlanAddPriorityInputSchema,
  outputSchema: dayPlanAddPriorityOutputSchema,
  risk: {
    level: 'low',
    reason: 'Adds a priority to day plan',
    potentialImpact: 'Modifies daily planning data',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['day_planner', 'planning', 'write'],
  examples: [
    {
      input: { description: "Review Mike's PR", category: 'work' },
      description: 'Add a work priority',
    },
    {
      input: { description: 'Urgent bug fix', position: 0 },
      description: 'Add priority at the top',
    },
  ],
  execute: async (input: DayPlanAddPriorityInput, context: ToolContext): Promise<DayPlanAddPriorityOutput> => {
    const dayPlanService = context.services.get(DayPlanService);

    // Get or create today's plan
    let plan = await dayPlanService.getTodayPlan();
    if (!plan) {
      plan = await dayPlanService.createPlan({});
    }

    const priority = await dayPlanService.addPriority(plan.id, {
      description: input.description,
      category: nullToUndefined(input.category),
      position: nullToUndefined(input.position),
    });

    // Get updated plan - must exist since we just created/updated it
    const updatedPlan = await dayPlanService.getPlan(plan.id);
    if (!updatedPlan) {
      throw new Error(`Day plan ${plan.id} not found after adding priority`);
    }

    return {
      success: true,
      priority: {
        id: priority.id,
        description: priority.description,
        category: priority.category,
        completed: priority.completed,
        sortOrder: priority.sortOrder,
      },
      plan: updatedPlan,
    };
  },
};

// ============================================================================
// Day Plan Update Priority Tool
// ============================================================================

const dayPlanUpdatePriorityInputSchema = z.object({
  priorityId: z.string().describe('ID of the priority to update'),
  completed: z.boolean().nullish().describe('Mark as completed'),
  description: z.string().nullish().describe('Update the description'),
});

const dayPlanUpdatePriorityOutputSchema = z.object({
  success: z.boolean(),
  priority: z.object({
    id: z.string(),
    description: z.string(),
    category: z.string().optional(),
    completed: z.boolean(),
    completedAt: z.string().optional(),
  }),
});

type DayPlanUpdatePriorityInput = z.infer<typeof dayPlanUpdatePriorityInputSchema>;
type DayPlanUpdatePriorityOutput = z.infer<typeof dayPlanUpdatePriorityOutputSchema>;

const dayPlanUpdatePriorityTool: ToolDefinition<DayPlanUpdatePriorityInput, DayPlanUpdatePriorityOutput> = {
  id: 'day_planner.update_priority',
  name: 'DayPlanUpdatePriority',
  description: "Update a priority in today's plan - mark as complete or update details.",
  category: 'day_planner',
  inputSchema: dayPlanUpdatePriorityInputSchema,
  outputSchema: dayPlanUpdatePriorityOutputSchema,
  risk: {
    level: 'low',
    reason: 'Updates a priority status',
    potentialImpact: 'Modifies daily planning data',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['day_planner', 'planning', 'write'],
  examples: [
    {
      input: { priorityId: 'abc-123', completed: true },
      description: 'Mark a priority as completed',
    },
    {
      input: { priorityId: 'abc-123', description: 'Updated description' },
      description: 'Update priority description',
    },
  ],
  execute: async (input: DayPlanUpdatePriorityInput, context: ToolContext): Promise<DayPlanUpdatePriorityOutput> => {
    const dayPlanService = context.services.get(DayPlanService);

    const priority = await dayPlanService.updatePriority(input.priorityId, {
      completed: nullToUndefined(input.completed),
      description: nullToUndefined(input.description),
    });

    return {
      success: true,
      priority: {
        id: priority.id,
        description: priority.description,
        category: priority.category,
        completed: priority.completed,
        completedAt: priority.completedAt,
      },
    };
  },
};

// ============================================================================
// Day Plan Get Tool
// ============================================================================

const dayPlanGetInputSchema = z.object({
  date: z.string().nullish().describe('ISO date (YYYY-MM-DD), defaults to today'),
});

const dayPlanGetOutputSchema = z.object({
  found: z.boolean(),
  plan: dayPlanSchema.nullable(),
});

type DayPlanGetInput = z.infer<typeof dayPlanGetInputSchema>;
type DayPlanGetOutput = z.infer<typeof dayPlanGetOutputSchema>;

const dayPlanGetTool: ToolDefinition<DayPlanGetInput, DayPlanGetOutput> = {
  id: 'day_planner.get',
  name: 'DayPlanGet',
  description: 'Get the full day plan for today or a specific date.',
  category: 'day_planner',
  inputSchema: dayPlanGetInputSchema,
  outputSchema: dayPlanGetOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['day_planner', 'planning', 'read'],
  examples: [
    { input: {}, description: "Get today's plan" },
    { input: { date: '2024-03-15' }, description: 'Get plan for specific date' },
  ],
  execute: async (input: DayPlanGetInput, context: ToolContext): Promise<DayPlanGetOutput> => {
    const dayPlanService = context.services.get(DayPlanService);

    const plan = input.date ? await dayPlanService.getPlanByDate(input.date) : await dayPlanService.getTodayPlan();

    return {
      found: plan !== null,
      plan,
    };
  },
};

// ============================================================================
// Registration
// ============================================================================

const registerDayPlannerTools = (registry: ToolRegistry): void => {
  registry.register(dayPlanCreateTool);
  registry.register(dayPlanAddPriorityTool);
  registry.register(dayPlanUpdatePriorityTool);
  registry.register(dayPlanGetTool);
};

// ============================================================================
// Exports
// ============================================================================

export {
  dayPlanCreateTool,
  dayPlanAddPriorityTool,
  dayPlanUpdatePriorityTool,
  dayPlanGetTool,
  registerDayPlannerTools,
};
