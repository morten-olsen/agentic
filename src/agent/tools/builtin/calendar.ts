import { z } from 'zod';

import type { ToolDefinition, ToolContext, ToolRegistry } from '../tools.ts';
import { CalendarService } from '../../../domain/calendar/calendar.ts';
import {
  calendarEventSchema,
  calendarContextSchema,
  attendeeSchema,
} from '../../../domain/calendar/calendar.schemas.ts';
import {
  flexibleDatetimeSchema,
  optionalFlexibleDatetimeSchema,
  optionalFlexibleDateSchema,
} from '../../../core/utils/date-parser.ts';

// ============================================================================
// Utilities
// ============================================================================

/** Converts null to undefined for service boundary compatibility */
const nullToUndefined = <T>(value: T | null | undefined): T | undefined => (value === null ? undefined : value);

// ============================================================================
// Get Agenda
// ============================================================================

const getAgendaInputSchema = z.object({
  date: optionalFlexibleDateSchema.describe(
    'Date to get agenda for. Accepts "today", "tomorrow", "next Monday", or "2026-02-01". Defaults to today.',
  ),
});

const getAgendaOutputSchema = z.object({
  agenda: z.string(),
  eventCount: z.number(),
});

type GetAgendaInput = z.infer<typeof getAgendaInputSchema>;
type GetAgendaRawInput = z.input<typeof getAgendaInputSchema>;
type GetAgendaOutput = z.infer<typeof getAgendaOutputSchema>;

const getAgendaTool: ToolDefinition<GetAgendaInput, GetAgendaOutput, GetAgendaRawInput> = {
  id: 'calendar.get_agenda',
  name: 'GetAgenda',
  description: "Get a human-readable agenda for a day. Defaults to today's agenda.",
  category: 'calendar',
  inputSchema: getAgendaInputSchema,
  outputSchema: getAgendaOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['calendar', 'agenda', 'read'],
  examples: [
    { input: {}, description: "Get today's agenda" },
    { input: { date: 'tomorrow' }, description: "Get tomorrow's agenda" },
    { input: { date: '2024-01-15' }, description: 'Get agenda for a specific date' },
  ],
  execute: async (input: GetAgendaInput, context: ToolContext): Promise<GetAgendaOutput> => {
    const calendar = context.services.get(CalendarService);
    const date = input.date ? new Date(input.date) : new Date();
    const events = await calendar.getToday(date);
    const agenda = await calendar.getDayAgenda(date);
    return { agenda, eventCount: events.length };
  },
};

// ============================================================================
// Get Upcoming Events
// ============================================================================

const getUpcomingEventsInputSchema = z.object({
  hours: z.number().positive().nullish().describe('Hours to look ahead. Defaults to 24.'),
});

const getUpcomingEventsOutputSchema = z.object({
  events: z.array(calendarEventSchema),
  count: z.number(),
});

type GetUpcomingEventsInput = z.infer<typeof getUpcomingEventsInputSchema>;
type GetUpcomingEventsOutput = z.infer<typeof getUpcomingEventsOutputSchema>;

const getUpcomingEventsTool: ToolDefinition<GetUpcomingEventsInput, GetUpcomingEventsOutput> = {
  id: 'calendar.get_upcoming',
  name: 'GetUpcomingEvents',
  description: 'Get upcoming events within a specified number of hours.',
  category: 'calendar',
  inputSchema: getUpcomingEventsInputSchema,
  outputSchema: getUpcomingEventsOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['calendar', 'events', 'read'],
  examples: [
    { input: {}, description: 'Get events in the next 24 hours' },
    { input: { hours: 4 }, description: 'Get events in the next 4 hours' },
  ],
  execute: async (input: GetUpcomingEventsInput, context: ToolContext): Promise<GetUpcomingEventsOutput> => {
    const calendar = context.services.get(CalendarService);
    const events = await calendar.getUpcoming(input.hours ?? 24);
    return { events, count: events.length };
  },
};

// ============================================================================
// Get Calendar Context
// ============================================================================

const getCalendarContextInputSchema = z.object({});

const getCalendarContextOutputSchema = calendarContextSchema;

type GetCalendarContextInput = z.infer<typeof getCalendarContextInputSchema>;
type GetCalendarContextOutput = z.infer<typeof getCalendarContextOutputSchema>;

const getCalendarContextTool: ToolDefinition<GetCalendarContextInput, GetCalendarContextOutput> = {
  id: 'calendar.get_context',
  name: 'GetCalendarContext',
  description: 'Get current calendar context including current event, next event, and time until next.',
  category: 'calendar',
  inputSchema: getCalendarContextInputSchema,
  outputSchema: getCalendarContextOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['calendar', 'context', 'read'],
  examples: [{ input: {}, description: 'Get current calendar context' }],
  execute: async (_input: GetCalendarContextInput, context: ToolContext): Promise<GetCalendarContextOutput> => {
    const calendar = context.services.get(CalendarService);
    return calendar.getCurrentContext();
  },
};

// ============================================================================
// Get Events in Range
// ============================================================================

const getEventsInRangeInputSchema = z.object({
  start: flexibleDatetimeSchema.describe(
    'Start of range. Accepts "today", "tomorrow at 9am", or ISO format "2026-02-01T00:00:00Z".',
  ),
  end: flexibleDatetimeSchema.describe(
    'End of range. Accepts "tomorrow", "next week", or ISO format "2026-02-02T00:00:00Z".',
  ),
});

const getEventsInRangeOutputSchema = z.object({
  events: z.array(calendarEventSchema),
  count: z.number(),
});

type GetEventsInRangeInput = z.infer<typeof getEventsInRangeInputSchema>;
type GetEventsInRangeRawInput = z.input<typeof getEventsInRangeInputSchema>;
type GetEventsInRangeOutput = z.infer<typeof getEventsInRangeOutputSchema>;

const getEventsInRangeTool: ToolDefinition<GetEventsInRangeInput, GetEventsInRangeOutput, GetEventsInRangeRawInput> = {
  id: 'calendar.get_events_in_range',
  name: 'GetEventsInRange',
  description: 'Get all events within a time range.',
  category: 'calendar',
  inputSchema: getEventsInRangeInputSchema,
  outputSchema: getEventsInRangeOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['calendar', 'events', 'read'],
  examples: [
    {
      input: { start: 'today', end: 'tomorrow' },
      description: "Get today's events using natural language",
    },
    {
      input: { start: '2024-01-15T00:00:00Z', end: '2024-01-16T00:00:00Z' },
      description: 'Get events for a specific day using ISO format',
    },
  ],
  execute: async (input: GetEventsInRangeInput, context: ToolContext): Promise<GetEventsInRangeOutput> => {
    const calendar = context.services.get(CalendarService);
    const events = await calendar.getEventsInRange(new Date(input.start), new Date(input.end));
    return { events, count: events.length };
  },
};

// ============================================================================
// Create Event
// ============================================================================

const createEventInputSchema = z.object({
  title: z.string().min(1).describe('Event title'),
  start: flexibleDatetimeSchema.describe(
    'Start time. Accepts "tomorrow at 3pm", "next Monday 10am", or ISO format "2026-02-01T15:00:00Z".',
  ),
  end: flexibleDatetimeSchema.describe(
    'End time. Accepts "tomorrow at 4pm", "in 2 hours", or ISO format "2026-02-01T16:00:00Z".',
  ),
  timezone: z.string().describe('Timezone (e.g., America/New_York)'),
  description: z.string().nullish().describe('Event description'),
  location: z.string().nullish().describe('Event location'),
  allDay: z.boolean().nullish().describe('Is this an all-day event?'),
  attendees: z.array(attendeeSchema).nullish().describe('Event attendees'),
  requiresPrep: z.boolean().nullish().describe('Does this event require preparation?'),
  prepNotes: z.string().nullish().describe('Preparation notes'),
  travelTime: z.number().nullish().describe('Travel time in minutes'),
  tags: z.array(z.string()).nullish().describe('Tags for categorization'),
});

const createEventOutputSchema = calendarEventSchema;

type CreateEventInput = z.infer<typeof createEventInputSchema>;
type CreateEventRawInput = z.input<typeof createEventInputSchema>;
type CreateEventOutput = z.infer<typeof createEventOutputSchema>;

const createEventTool: ToolDefinition<CreateEventInput, CreateEventOutput, CreateEventRawInput> = {
  id: 'calendar.create_event',
  name: 'CreateEvent',
  description: 'Create a new calendar event.',
  category: 'calendar',
  inputSchema: createEventInputSchema,
  outputSchema: createEventOutputSchema,
  risk: {
    level: 'low',
    reason: 'Creates a new record, easily reversible',
    potentialImpact: 'Adds a new calendar event',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['calendar', 'events', 'write'],
  examples: [
    {
      input: {
        title: 'Team Meeting',
        start: 'tomorrow at 10am',
        end: 'tomorrow at 11am',
        timezone: 'America/New_York',
      },
      description: 'Create a meeting using natural language',
    },
    {
      input: {
        title: 'Project Review',
        start: '2024-01-15T10:00:00Z',
        end: '2024-01-15T11:00:00Z',
        timezone: 'America/New_York',
      },
      description: 'Create a meeting using ISO format',
    },
  ],
  execute: async (input: CreateEventInput, context: ToolContext): Promise<CreateEventOutput> => {
    const calendar = context.services.get(CalendarService);
    return calendar.createEvent({
      title: input.title,
      start: input.start,
      end: input.end,
      timezone: input.timezone,
      description: nullToUndefined(input.description),
      location: nullToUndefined(input.location),
      allDay: nullToUndefined(input.allDay),
      attendees: nullToUndefined(input.attendees),
      requiresPrep: nullToUndefined(input.requiresPrep),
      prepNotes: nullToUndefined(input.prepNotes),
      travelTime: nullToUndefined(input.travelTime),
      tags: nullToUndefined(input.tags),
    });
  },
};

// ============================================================================
// Update Event
// ============================================================================

const updateEventInputSchema = z.object({
  id: z.string().describe('Event ID to update'),
  title: z.string().nullish().describe('New event title'),
  start: optionalFlexibleDatetimeSchema.describe('New start time. Accepts "tomorrow at 3pm" or ISO format.'),
  end: optionalFlexibleDatetimeSchema.describe('New end time. Accepts "tomorrow at 4pm" or ISO format.'),
  description: z.string().nullish().describe('New description'),
  location: z.string().nullish().describe('New location'),
  allDay: z.boolean().nullish().describe('Update all-day status'),
  requiresPrep: z.boolean().nullish().describe('Update prep requirement'),
  prepNotes: z.string().nullish().describe('Update prep notes'),
  travelTime: z.number().nullish().describe('Update travel time'),
  tags: z.array(z.string()).nullish().describe('Update tags'),
});

const updateEventOutputSchema = calendarEventSchema;

type UpdateEventInput = z.infer<typeof updateEventInputSchema>;
type UpdateEventRawInput = z.input<typeof updateEventInputSchema>;
type UpdateEventOutput = z.infer<typeof updateEventOutputSchema>;

const updateEventTool: ToolDefinition<UpdateEventInput, UpdateEventOutput, UpdateEventRawInput> = {
  id: 'calendar.update_event',
  name: 'UpdateEvent',
  description: 'Update an existing calendar event.',
  category: 'calendar',
  inputSchema: updateEventInputSchema,
  outputSchema: updateEventOutputSchema,
  risk: {
    level: 'low',
    reason: 'Modifies existing record',
    potentialImpact: 'Modifies event data',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['calendar', 'events', 'write'],
  examples: [{ input: { id: '123', location: 'Conference Room B' }, description: 'Update event location' }],
  execute: async (input: UpdateEventInput, context: ToolContext): Promise<UpdateEventOutput> => {
    const calendar = context.services.get(CalendarService);
    return calendar.updateEvent(input.id, {
      title: nullToUndefined(input.title),
      start: nullToUndefined(input.start),
      end: nullToUndefined(input.end),
      description: nullToUndefined(input.description),
      location: nullToUndefined(input.location),
      allDay: nullToUndefined(input.allDay),
      requiresPrep: nullToUndefined(input.requiresPrep),
      prepNotes: nullToUndefined(input.prepNotes),
      travelTime: nullToUndefined(input.travelTime),
      tags: nullToUndefined(input.tags),
    });
  },
};

// ============================================================================
// Delete Event
// ============================================================================

const deleteEventInputSchema = z.object({
  id: z.string().describe('Event ID to delete'),
});

const deleteEventOutputSchema = z.object({
  success: z.boolean(),
  deletedId: z.string(),
});

type DeleteEventInput = z.infer<typeof deleteEventInputSchema>;
type DeleteEventOutput = z.infer<typeof deleteEventOutputSchema>;

const deleteEventTool: ToolDefinition<DeleteEventInput, DeleteEventOutput> = {
  id: 'calendar.delete_event',
  name: 'DeleteEvent',
  description: 'Delete a calendar event.',
  category: 'calendar',
  inputSchema: deleteEventInputSchema,
  outputSchema: deleteEventOutputSchema,
  risk: {
    level: 'medium',
    reason: 'Permanently deletes data',
    potentialImpact: 'Event will be removed from calendar',
    reversible: false,
    categories: ['data_modification'],
  },
  tags: ['calendar', 'events', 'write', 'destructive'],
  examples: [{ input: { id: '123' }, description: 'Delete an event' }],
  execute: async (input: DeleteEventInput, context: ToolContext): Promise<DeleteEventOutput> => {
    const calendar = context.services.get(CalendarService);
    await calendar.deleteEvent(input.id);
    return { success: true, deletedId: input.id };
  },
};

// ============================================================================
// Check Busy Status
// ============================================================================

const checkBusyInputSchema = z.object({
  time: optionalFlexibleDatetimeSchema.describe(
    'Time to check. Accepts "now", "in 2 hours", "tomorrow at 3pm", or ISO format. Defaults to now.',
  ),
});

const checkBusyOutputSchema = z.object({
  isBusy: z.boolean(),
  currentEvent: calendarEventSchema.nullable(),
});

type CheckBusyInput = z.infer<typeof checkBusyInputSchema>;
type CheckBusyRawInput = z.input<typeof checkBusyInputSchema>;
type CheckBusyOutput = z.infer<typeof checkBusyOutputSchema>;

const checkBusyTool: ToolDefinition<CheckBusyInput, CheckBusyOutput, CheckBusyRawInput> = {
  id: 'calendar.check_busy',
  name: 'CheckBusy',
  description: 'Check if the user is currently busy (in an event).',
  category: 'calendar',
  inputSchema: checkBusyInputSchema,
  outputSchema: checkBusyOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['calendar', 'status', 'read'],
  examples: [
    { input: {}, description: 'Check if user is busy now' },
    { input: { time: 'in 2 hours' }, description: 'Check if user will be busy in 2 hours' },
    { input: { time: '2024-01-15T14:00:00Z' }, description: 'Check if user is busy at a specific time' },
  ],
  execute: async (input: CheckBusyInput, context: ToolContext): Promise<CheckBusyOutput> => {
    const calendar = context.services.get(CalendarService);
    const time = input.time ? new Date(input.time) : new Date();
    const [isBusy, currentEvent] = await Promise.all([calendar.isBusy(time), calendar.getCurrentEvent(time)]);
    return { isBusy, currentEvent };
  },
};

// ============================================================================
// Registration
// ============================================================================

const registerCalendarTools = (registry: ToolRegistry): void => {
  registry.register(getAgendaTool);
  registry.register(getUpcomingEventsTool);
  registry.register(getCalendarContextTool);
  registry.register(getEventsInRangeTool);
  registry.register(createEventTool);
  registry.register(updateEventTool);
  registry.register(deleteEventTool);
  registry.register(checkBusyTool);
};

export {
  getAgendaTool,
  getUpcomingEventsTool,
  getCalendarContextTool,
  getEventsInRangeTool,
  createEventTool,
  updateEventTool,
  deleteEventTool,
  checkBusyTool,
  registerCalendarTools,
};
