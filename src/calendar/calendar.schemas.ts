import { z } from 'zod';

// ============================================================================
// Event Source
// ============================================================================

const eventSourceSchema = z.enum(['local', 'google', 'outlook', 'ical', 'homeassistant']);

type EventSource = z.infer<typeof eventSourceSchema>;

// ============================================================================
// Attendee
// ============================================================================

const attendeeStatusSchema = z.enum(['accepted', 'declined', 'tentative', 'pending']);

type AttendeeStatus = z.infer<typeof attendeeStatusSchema>;

const attendeeSchema = z.object({
  contactId: z.string().optional(),
  email: z.string().email(),
  name: z.string().optional(),
  status: attendeeStatusSchema.default('pending'),
});

type Attendee = z.infer<typeof attendeeSchema>;

// ============================================================================
// Recurrence
// ============================================================================

const recurrenceSchema = z.object({
  rule: z.string(), // RRULE format
  exceptions: z.array(z.string()).default([]),
});

type Recurrence = z.infer<typeof recurrenceSchema>;

// ============================================================================
// Calendar Event
// ============================================================================

const calendarEventSchema = z.object({
  id: z.string().uuid(),
  externalId: z.string().optional(),
  source: eventSourceSchema.default('local'),
  calendarSourceId: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  start: z.string().datetime(),
  end: z.string().datetime(),
  allDay: z.boolean().default(false),
  timezone: z.string(),
  attendees: z.array(attendeeSchema).default([]),
  recurrence: recurrenceSchema.optional(),
  requiresPrep: z.boolean().default(false),
  prepNotes: z.string().optional(),
  travelTime: z.number().optional(), // Minutes to get there
  tags: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

type CalendarEvent = z.infer<typeof calendarEventSchema>;

/**
 * Create calendar event input schema.
 * Uses .optional().default() pattern to make fields optional in input while providing defaults.
 */
const createCalendarEventInputSchema = z.object({
  externalId: z.string().optional(),
  source: eventSourceSchema.optional().default('local'),
  calendarSourceId: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  start: z.string().datetime(),
  end: z.string().datetime(),
  allDay: z.boolean().optional().default(false),
  timezone: z.string(),
  attendees: z.array(attendeeSchema).optional().default([]),
  recurrence: recurrenceSchema.optional(),
  requiresPrep: z.boolean().optional().default(false),
  prepNotes: z.string().optional(),
  travelTime: z.number().optional(),
  tags: z.array(z.string()).optional().default([]),
});

type CreateCalendarEventInput = z.input<typeof createCalendarEventInputSchema>;

const updateCalendarEventInputSchema = createCalendarEventInputSchema.partial();

type UpdateCalendarEventInput = z.input<typeof updateCalendarEventInputSchema>;

// ============================================================================
// Time Block
// ============================================================================

const timeBlockTypeSchema = z.enum(['busy', 'free', 'tentative', 'focus', 'travel']);

type TimeBlockType = z.infer<typeof timeBlockTypeSchema>;

const timeBlockSchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
  type: timeBlockTypeSchema,
});

type TimeBlock = z.infer<typeof timeBlockSchema>;

// ============================================================================
// Calendar Context
// ============================================================================

const calendarContextSchema = z.object({
  currentEvent: calendarEventSchema.nullable(),
  nextEvent: calendarEventSchema.nullable(),
  minutesToNext: z.number().nullable(),
  todayRemaining: z.array(calendarEventSchema),
});

type CalendarContext = z.infer<typeof calendarContextSchema>;

export type {
  EventSource,
  AttendeeStatus,
  Attendee,
  Recurrence,
  CalendarEvent,
  CreateCalendarEventInput,
  UpdateCalendarEventInput,
  TimeBlockType,
  TimeBlock,
  CalendarContext,
};

export {
  eventSourceSchema,
  attendeeStatusSchema,
  attendeeSchema,
  recurrenceSchema,
  calendarEventSchema,
  createCalendarEventInputSchema,
  updateCalendarEventInputSchema,
  timeBlockTypeSchema,
  timeBlockSchema,
  calendarContextSchema,
};
