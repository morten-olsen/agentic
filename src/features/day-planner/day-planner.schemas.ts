import { z } from 'zod';

// ============================================================================
// Day Plan Status
// ============================================================================

const dayPlanStatusSchema = z.enum(['draft', 'active', 'completed', 'abandoned']);

type DayPlanStatus = z.infer<typeof dayPlanStatusSchema>;

// ============================================================================
// Energy Level
// ============================================================================

const energyLevelSchema = z.enum(['low', 'medium', 'high']);

type EnergyLevel = z.infer<typeof energyLevelSchema>;

// ============================================================================
// Priority
// ============================================================================

const prioritySchema = z.object({
  id: z.string(),
  description: z.string(),
  category: z.string().optional(),
  linkedProjectId: z.string().optional(),
  linkedTaskId: z.string().optional(),
  completed: z.boolean(),
  completedAt: z.string().optional(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
});

type Priority = z.infer<typeof prioritySchema>;

// ============================================================================
// Focus Block
// ============================================================================

const focusBlockSchema = z.object({
  id: z.string(),
  label: z.string(),
  startTime: z.string().optional(),
  duration: z.number().int().positive(),
  completed: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
});

type FocusBlock = z.infer<typeof focusBlockSchema>;

// ============================================================================
// Intention
// ============================================================================

const intentionSchema = z.object({
  id: z.string(),
  intention: z.string(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
});

type Intention = z.infer<typeof intentionSchema>;

// ============================================================================
// Day Plan
// ============================================================================

const dayPlanSchema = z.object({
  id: z.string(),
  date: z.string(), // YYYY-MM-DD
  status: dayPlanStatusSchema,
  energyLevel: energyLevelSchema.optional(),
  notes: z.string().optional(),
  intentions: z.array(intentionSchema),
  priorities: z.array(prioritySchema),
  focusBlocks: z.array(focusBlockSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
});

type DayPlan = z.infer<typeof dayPlanSchema>;

// ============================================================================
// Create Day Plan Input
// ============================================================================

const createPriorityInputSchema = z.object({
  description: z.string().min(1),
  category: z.string().optional(),
  linkedProjectId: z.string().optional(),
  linkedTaskId: z.string().optional(),
});

type CreatePriorityInput = z.infer<typeof createPriorityInputSchema>;

const createFocusBlockInputSchema = z.object({
  label: z.string().min(1),
  startTime: z.string().optional(),
  duration: z.number().int().positive(),
});

type CreateFocusBlockInput = z.infer<typeof createFocusBlockInputSchema>;

const createDayPlanInputSchema = z.object({
  date: z.string().optional(), // YYYY-MM-DD, defaults to today
  intentions: z.array(z.string()).optional().default([]),
  priorities: z.array(createPriorityInputSchema).optional().default([]),
  focusBlocks: z.array(createFocusBlockInputSchema).optional().default([]),
  energyLevel: energyLevelSchema.optional(),
  notes: z.string().optional(),
});

type CreateDayPlanInput = z.input<typeof createDayPlanInputSchema>;

// ============================================================================
// Update Day Plan Input
// ============================================================================

const updateDayPlanInputSchema = z.object({
  energyLevel: energyLevelSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
  status: dayPlanStatusSchema.optional(),
});

type UpdateDayPlanInput = z.infer<typeof updateDayPlanInputSchema>;

// ============================================================================
// Update Priority Input
// ============================================================================

const updatePriorityInputSchema = z.object({
  description: z.string().min(1).optional(),
  category: z.string().nullable().optional(),
  linkedProjectId: z.string().nullable().optional(),
  linkedTaskId: z.string().nullable().optional(),
  completed: z.boolean().optional(),
});

type UpdatePriorityInput = z.infer<typeof updatePriorityInputSchema>;

// ============================================================================
// Update Focus Block Input
// ============================================================================

const updateFocusBlockInputSchema = z.object({
  label: z.string().min(1).optional(),
  startTime: z.string().nullable().optional(),
  duration: z.number().int().positive().optional(),
  completed: z.boolean().optional(),
});

type UpdateFocusBlockInput = z.infer<typeof updateFocusBlockInputSchema>;

// ============================================================================
// Add Priority Input (for service)
// ============================================================================

const addPriorityInputSchema = z.object({
  description: z.string().min(1),
  category: z.string().optional(),
  linkedProjectId: z.string().optional(),
  linkedTaskId: z.string().optional(),
  position: z.number().int().min(0).optional(), // Insert at position (0 = top)
});

type AddPriorityInput = z.input<typeof addPriorityInputSchema>;

// ============================================================================
// Add Focus Block Input (for service)
// ============================================================================

const addFocusBlockInputSchema = z.object({
  label: z.string().min(1),
  startTime: z.string().optional(),
  duration: z.number().int().positive(),
});

type AddFocusBlockInput = z.input<typeof addFocusBlockInputSchema>;

// ============================================================================
// Database Row Types
// ============================================================================

const dayPlanRowSchema = z.object({
  id: z.string(),
  date: z.string(),
  status: z.string(),
  energy_level: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  completed_at: z.string().nullable(),
});

type DayPlanRow = z.infer<typeof dayPlanRowSchema>;

const intentionRowSchema = z.object({
  id: z.string(),
  day_plan_id: z.string(),
  intention: z.string(),
  sort_order: z.number(),
  created_at: z.string(),
});

type IntentionRow = z.infer<typeof intentionRowSchema>;

const priorityRowSchema = z.object({
  id: z.string(),
  day_plan_id: z.string(),
  description: z.string(),
  category: z.string().nullable(),
  linked_project_id: z.string().nullable(),
  linked_task_id: z.string().nullable(),
  completed: z.number(), // SQLite boolean
  completed_at: z.string().nullable(),
  sort_order: z.number(),
  created_at: z.string(),
});

type PriorityRow = z.infer<typeof priorityRowSchema>;

const focusBlockRowSchema = z.object({
  id: z.string(),
  day_plan_id: z.string(),
  label: z.string(),
  start_time: z.string().nullable(),
  duration: z.number(),
  completed: z.number(), // SQLite boolean
  sort_order: z.number(),
  created_at: z.string(),
});

type FocusBlockRow = z.infer<typeof focusBlockRowSchema>;

// ============================================================================
// Day Plan Context (for Agent)
// ============================================================================

const priorityContextSchema = z.object({
  id: z.string(),
  description: z.string(),
  category: z.string().optional(),
  completed: z.boolean(),
});

const focusBlockContextSchema = z.object({
  label: z.string(),
  startTime: z.string().optional(),
  duration: z.number(),
  completed: z.boolean(),
});

const dayPlanContextSchema = z.object({
  date: z.string(),
  status: dayPlanStatusSchema,
  intentions: z.array(z.string()),
  priorities: z.array(priorityContextSchema),
  focusBlocks: z.array(focusBlockContextSchema),
  energyLevel: energyLevelSchema.optional(),
  notes: z.string().optional(),
  progressSummary: z.string(),
});

type DayPlanContext = z.infer<typeof dayPlanContextSchema>;

// ============================================================================
// Exports
// ============================================================================

export type {
  DayPlanStatus,
  EnergyLevel,
  Priority,
  FocusBlock,
  Intention,
  DayPlan,
  CreatePriorityInput,
  CreateFocusBlockInput,
  CreateDayPlanInput,
  UpdateDayPlanInput,
  UpdatePriorityInput,
  UpdateFocusBlockInput,
  AddPriorityInput,
  AddFocusBlockInput,
  DayPlanRow,
  IntentionRow,
  PriorityRow,
  FocusBlockRow,
  DayPlanContext,
};

export {
  dayPlanStatusSchema,
  energyLevelSchema,
  prioritySchema,
  focusBlockSchema,
  intentionSchema,
  dayPlanSchema,
  createPriorityInputSchema,
  createFocusBlockInputSchema,
  createDayPlanInputSchema,
  updateDayPlanInputSchema,
  updatePriorityInputSchema,
  updateFocusBlockInputSchema,
  addPriorityInputSchema,
  addFocusBlockInputSchema,
  dayPlanRowSchema,
  intentionRowSchema,
  priorityRowSchema,
  focusBlockRowSchema,
  priorityContextSchema,
  focusBlockContextSchema,
  dayPlanContextSchema,
};
