import { z } from 'zod';

// ============================================================================
// Identity
// ============================================================================

const workingHoursSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  days: z.array(z.number().min(0).max(6)), // 0 = Sunday, 1 = Monday, etc.
});

type WorkingHours = z.infer<typeof workingHoursSchema>;

const preferencesSchema = z.object({
  communicationStyle: z.enum(['casual', 'professional', 'formal']).default('professional'),
  verbosity: z.enum(['terse', 'balanced', 'detailed']).default('balanced'),
  proactivityLevel: z.enum(['minimal', 'moderate', 'high']).default('moderate'),
});

type Preferences = z.infer<typeof preferencesSchema>;

const identitySchema = z.object({
  name: z.string().min(1),
  timezone: z.string().default('UTC'),
  locale: z.string().default('en-US'),
  workingHours: workingHoursSchema.default({
    start: '09:00',
    end: '17:00',
    days: [1, 2, 3, 4, 5], // Monday-Friday
  }),
  preferences: preferencesSchema.optional().default({
    communicationStyle: 'professional',
    verbosity: 'balanced',
    proactivityLevel: 'moderate',
  }),
});

type Identity = z.infer<typeof identitySchema>;

const identityInputSchema = identitySchema.partial().required({ name: true });

type IdentityInput = z.input<typeof identityInputSchema>;

// ============================================================================
// Project
// ============================================================================

const projectStatusSchema = z.enum(['active', 'paused', 'completed']);
type ProjectStatus = z.infer<typeof projectStatusSchema>;

const projectPrioritySchema = z.enum(['low', 'medium', 'high']);
type ProjectPriority = z.infer<typeof projectPrioritySchema>;

const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  status: projectStatusSchema.default('active'),
  priority: projectPrioritySchema.default('medium'),
  relatedContacts: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

type Project = z.infer<typeof projectSchema>;

/**
 * Create project input schema.
 * Uses .optional().default() pattern to make fields optional in input while providing defaults.
 */
const createProjectInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  status: projectStatusSchema.optional().default('active'),
  priority: projectPrioritySchema.optional().default('medium'),
  relatedContacts: z.array(z.string()).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
});

type CreateProjectInput = z.input<typeof createProjectInputSchema>;

const updateProjectInputSchema = createProjectInputSchema.partial();

type UpdateProjectInput = z.input<typeof updateProjectInputSchema>;

// ============================================================================
// Goal
// ============================================================================

const goalTimeframeSchema = z.enum(['short', 'medium', 'long']);
type GoalTimeframe = z.infer<typeof goalTimeframeSchema>;

const goalSchema = z.object({
  id: z.string().uuid(),
  description: z.string().min(1),
  timeframe: goalTimeframeSchema,
  progress: z.string().optional(),
  relatedProjects: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

type Goal = z.infer<typeof goalSchema>;

/**
 * Create goal input schema.
 * Uses .optional().default() pattern to make fields optional in input while providing defaults.
 */
const createGoalInputSchema = z.object({
  description: z.string().min(1),
  timeframe: goalTimeframeSchema,
  progress: z.string().optional(),
  relatedProjects: z.array(z.string()).optional().default([]),
});

type CreateGoalInput = z.input<typeof createGoalInputSchema>;

const updateGoalInputSchema = createGoalInputSchema.partial();

type UpdateGoalInput = z.input<typeof updateGoalInputSchema>;

// ============================================================================
// Routine
// ============================================================================

const routineSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  schedule: z.string().min(1), // Cron expression
  description: z.string().optional(),
  enabled: z.boolean().default(true),
  defaultLocation: z.string().optional(), // Location ID
  lastRunAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

type Routine = z.infer<typeof routineSchema>;

/**
 * Create routine input schema.
 * Uses .optional().default() pattern to make fields optional in input while providing defaults.
 */
const createRoutineInputSchema = z.object({
  name: z.string().min(1),
  schedule: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean().optional().default(true),
  defaultLocation: z.string().optional(),
});

type CreateRoutineInput = z.input<typeof createRoutineInputSchema>;

const updateRoutineInputSchema = createRoutineInputSchema.partial();

type UpdateRoutineInput = z.input<typeof updateRoutineInputSchema>;

export type {
  WorkingHours,
  Preferences,
  Identity,
  IdentityInput,
  Project,
  ProjectStatus,
  ProjectPriority,
  CreateProjectInput,
  UpdateProjectInput,
  Goal,
  GoalTimeframe,
  CreateGoalInput,
  UpdateGoalInput,
  Routine,
  CreateRoutineInput,
  UpdateRoutineInput,
};

export {
  workingHoursSchema,
  preferencesSchema,
  identitySchema,
  identityInputSchema,
  projectStatusSchema,
  projectPrioritySchema,
  projectSchema,
  createProjectInputSchema,
  updateProjectInputSchema,
  goalTimeframeSchema,
  goalSchema,
  createGoalInputSchema,
  updateGoalInputSchema,
  routineSchema,
  createRoutineInputSchema,
  updateRoutineInputSchema,
};
