import { z } from 'zod';

import type { ToolDefinition, ToolContext, ToolRegistry } from '../tools.ts';
import { CalendarService } from '../../calendar/calendar.ts';
import { calendarEventSchema, calendarContextSchema, attendeeSchema } from '../../calendar/calendar.schemas.ts';

// ============================================================================
// Get Agenda
// ============================================================================

const getAgendaInputSchema = z.object({
  date: z.string().optional().describe('Date to get agenda for (ISO format). Defaults to today.'),
});

const getAgendaOutputSchema = z.object({
  agenda: z.string(),
  eventCount: z.number(),
});

type GetAgendaInput = z.infer<typeof getAgendaInputSchema>;
type GetAgendaOutput = z.infer<typeof getAgendaOutputSchema>;

const getAgendaTool: ToolDefinition<GetAgendaInput, GetAgendaOutput> = {
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
  hours: z.number().positive().optional().describe('Hours to look ahead. Defaults to 24.'),
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
  start: z.string().describe('Start of range (ISO datetime)'),
  end: z.string().describe('End of range (ISO datetime)'),
});

const getEventsInRangeOutputSchema = z.object({
  events: z.array(calendarEventSchema),
  count: z.number(),
});

type GetEventsInRangeInput = z.infer<typeof getEventsInRangeInputSchema>;
type GetEventsInRangeOutput = z.infer<typeof getEventsInRangeOutputSchema>;

const getEventsInRangeTool: ToolDefinition<GetEventsInRangeInput, GetEventsInRangeOutput> = {
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
      input: { start: '2024-01-15T00:00:00Z', end: '2024-01-16T00:00:00Z' },
      description: 'Get events for a specific day',
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
  start: z.string().describe('Start time (ISO datetime)'),
  end: z.string().describe('End time (ISO datetime)'),
  timezone: z.string().describe('Timezone (e.g., America/New_York)'),
  description: z.string().optional().describe('Event description'),
  location: z.string().optional().describe('Event location'),
  allDay: z.boolean().optional().describe('Is this an all-day event?'),
  attendees: z.array(attendeeSchema).optional().describe('Event attendees'),
  requiresPrep: z.boolean().optional().describe('Does this event require preparation?'),
  prepNotes: z.string().optional().describe('Preparation notes'),
  travelTime: z.number().optional().describe('Travel time in minutes'),
  tags: z.array(z.string()).optional().describe('Tags for categorization'),
});

const createEventOutputSchema = calendarEventSchema;

type CreateEventInput = z.infer<typeof createEventInputSchema>;
type CreateEventOutput = z.infer<typeof createEventOutputSchema>;

const createEventTool: ToolDefinition<CreateEventInput, CreateEventOutput> = {
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
        start: '2024-01-15T10:00:00Z',
        end: '2024-01-15T11:00:00Z',
        timezone: 'America/New_York',
      },
      description: 'Create a simple meeting',
    },
  ],
  execute: async (input: CreateEventInput, context: ToolContext): Promise<CreateEventOutput> => {
    const calendar = context.services.get(CalendarService);
    return calendar.createEvent(input);
  },
};

// ============================================================================
// Update Event
// ============================================================================

const updateEventInputSchema = z.object({
  id: z.string().describe('Event ID to update'),
  title: z.string().optional().describe('New event title'),
  start: z.string().optional().describe('New start time'),
  end: z.string().optional().describe('New end time'),
  description: z.string().optional().describe('New description'),
  location: z.string().optional().describe('New location'),
  allDay: z.boolean().optional().describe('Update all-day status'),
  requiresPrep: z.boolean().optional().describe('Update prep requirement'),
  prepNotes: z.string().optional().describe('Update prep notes'),
  travelTime: z.number().optional().describe('Update travel time'),
  tags: z.array(z.string()).optional().describe('Update tags'),
});

const updateEventOutputSchema = calendarEventSchema;

type UpdateEventInput = z.infer<typeof updateEventInputSchema>;
type UpdateEventOutput = z.infer<typeof updateEventOutputSchema>;

const updateEventTool: ToolDefinition<UpdateEventInput, UpdateEventOutput> = {
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
    const { id, ...updates } = input;
    return calendar.updateEvent(id, updates);
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
  time: z.string().optional().describe('Time to check (ISO datetime). Defaults to now.'),
});

const checkBusyOutputSchema = z.object({
  isBusy: z.boolean(),
  currentEvent: calendarEventSchema.nullable(),
});

type CheckBusyInput = z.infer<typeof checkBusyInputSchema>;
type CheckBusyOutput = z.infer<typeof checkBusyOutputSchema>;

const checkBusyTool: ToolDefinition<CheckBusyInput, CheckBusyOutput> = {
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
