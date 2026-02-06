import { z } from 'zod';

import { projectSchema, goalSchema } from '../user-model/user-model.schemas.ts';
import { locationSchema } from '../location/location.schemas.ts';
import { calendarEventSchema } from '../calendar/calendar.schemas.ts';
import { pendingTaskContextSchema } from '../tasks/tasks.schemas.ts';
import { dayPlanContextSchema } from '../day-planner/day-planner.schemas.ts';

// ============================================================================
// Time of Day
// ============================================================================

const timeOfDaySchema = z.enum(['morning', 'afternoon', 'evening', 'night']);

type TimeOfDay = z.infer<typeof timeOfDaySchema>;

// ============================================================================
// Location Context
// ============================================================================

const locationContextSchema = z.object({
  current: locationSchema.nullable(),
  confidence: z.enum(['exact', 'approximate', 'inferred']),
  atHome: z.boolean(),
  atWork: z.boolean(),
  traveling: z.boolean(),
  // Home Assistant GPS coordinates (when available)
  coordinates: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      accuracy: z.number(),
    })
    .optional(),
  // When location actually changed (important for staleness detection)
  lastLocationChange: z.string().optional(),
  // Source device tracker (e.g., "device_tracker.pixel_9")
  locationSource: z.string().optional(),
});

type LocationContext = z.infer<typeof locationContextSchema>;

// ============================================================================
// Calendar Context
// ============================================================================

const calendarAgentContextSchema = z.object({
  currentEvent: calendarEventSchema.nullable(),
  nextEvent: calendarEventSchema.nullable(),
  minutesToNext: z.number().nullable(),
  travelTimeToNext: z.number().nullable(),
  shouldLeaveBy: z.string().nullable(),
  todayAgenda: z.string(),
});

type CalendarAgentContext = z.infer<typeof calendarAgentContextSchema>;

// ============================================================================
// User Context
// ============================================================================

const userContextSchema = z.object({
  name: z.string(),
  activeProjects: z.array(projectSchema),
  currentGoals: z.array(goalSchema),
});

type UserContext = z.infer<typeof userContextSchema>;

// ============================================================================
// Agent Context (Full)
// ============================================================================

const agentContextSchema = z.object({
  // Time (when)
  now: z.string().datetime(),
  localTime: z.string(),
  timezone: z.string(),
  timeOfDay: timeOfDaySchema,
  isWorkingHours: z.boolean(),

  // Location (where)
  location: locationContextSchema,

  // User state (who)
  user: userContextSchema,

  // Calendar awareness
  calendar: calendarAgentContextSchema,

  // Recent context
  pendingTasks: z.array(pendingTaskContextSchema),

  // Active conversation (if any)
  conversation: z
    .object({
      id: z.string(),
      summary: z.string(),
      messageCount: z.number(),
    })
    .optional(),

  // Day plan awareness
  dayPlan: dayPlanContextSchema.nullable(),
});

type AgentContext = z.infer<typeof agentContextSchema>;

// ============================================================================
// Context Delta (Change Detection)
// ============================================================================

const calendarEventSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  start: z.string(),
});

type CalendarEventSummary = z.infer<typeof calendarEventSummarySchema>;

const taskSummarySchema = z.object({
  id: z.string(),
  description: z.string(),
  type: z.enum(['user', 'delegated']),
});

type TaskSummary = z.infer<typeof taskSummarySchema>;

const contextDeltaSchema = z.object({
  // Time since last context snapshot (minutes)
  timeSinceLastSnapshot: z.number(),

  // Calendar changes
  calendar: z.object({
    newEvents: z.array(calendarEventSummarySchema),
    cancelledEvents: z.array(calendarEventSummarySchema),
    upcomingEventChanged: z.boolean(),
  }),

  // Task changes
  tasks: z.object({
    newTasks: z.array(taskSummarySchema),
    completedTasks: z.array(taskSummarySchema),
    taskCountDelta: z.number(),
  }),

  // Location change
  location: z.object({
    changed: z.boolean(),
    previousLocation: z.string().nullable(),
    currentLocation: z.string().nullable(),
  }),

  // Day plan changes
  dayPlan: z.object({
    isNewDay: z.boolean(),
    newPriorities: z.array(z.string()),
    completedPriorities: z.array(z.string()),
    priorityProgressDelta: z.number(),
  }),

  // Summary flags for quick checks
  hasSignificantChanges: z.boolean(),
  changeSummary: z.array(z.string()),
});

type ContextDelta = z.infer<typeof contextDeltaSchema>;

const contextWithDeltaSchema = z.object({
  context: agentContextSchema,
  delta: contextDeltaSchema.nullable(),
  snapshotId: z.string(),
});

type ContextWithDelta = z.infer<typeof contextWithDeltaSchema>;

// ============================================================================
// Context Cache Entry (Internal)
// ============================================================================

type ContextCacheEntry = {
  snapshot: AgentContext;
  capturedAt: Date;
  // Extracted IDs for efficient comparison
  calendarEventIds: Set<string>;
  taskIds: Set<string>;
  locationState: string;
  dayPlanDate: string | null;
  completedPriorityIds: Set<string>;
};

export type {
  TimeOfDay,
  LocationContext,
  CalendarAgentContext,
  UserContext,
  AgentContext,
  CalendarEventSummary,
  TaskSummary,
  ContextDelta,
  ContextWithDelta,
  ContextCacheEntry,
};

export {
  timeOfDaySchema,
  locationContextSchema,
  calendarAgentContextSchema,
  userContextSchema,
  agentContextSchema,
  calendarEventSummarySchema,
  taskSummarySchema,
  contextDeltaSchema,
  contextWithDeltaSchema,
};
