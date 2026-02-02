import { z } from 'zod';

import { projectSchema, goalSchema } from '../user-model/user-model.schemas.ts';
import { contactSchema } from '../contacts/contacts.schemas.ts';
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
  recentContacts: z.array(contactSchema),
  recentTopics: z.array(z.string()),
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

export type { TimeOfDay, LocationContext, CalendarAgentContext, UserContext, AgentContext };

export { timeOfDaySchema, locationContextSchema, calendarAgentContextSchema, userContextSchema, agentContextSchema };
