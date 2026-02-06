import type { Knex } from 'knex';

import type {
  CalendarEvent,
  CreateCalendarEventInput,
  UpdateCalendarEventInput,
  EventSource,
  Attendee,
} from './calendar.schemas.ts';

// ============================================================================
// Row Type
// ============================================================================

type CalendarEventRow = {
  id: string;
  external_id: string | null;
  source: string;
  calendar_source_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string;
  all_day: number;
  timezone: string;
  attendees: string | null; // JSON
  recurrence_rule: string | null;
  recurrence_exceptions: string | null; // JSON
  requires_prep: number;
  prep_notes: string | null;
  travel_time_minutes: number | null;
  tags: string | null; // JSON
  created_at: string;
  updated_at: string;
};

// ============================================================================
// Converters
// ============================================================================

const now = (): string => new Date().toISOString();

const eventFromRow = (row: CalendarEventRow): CalendarEvent => ({
  id: row.id,
  externalId: row.external_id ?? undefined,
  source: row.source as EventSource,
  calendarSourceId: row.calendar_source_id ?? undefined,
  title: row.title,
  description: row.description ?? undefined,
  location: row.location ?? undefined,
  start: row.start_time,
  end: row.end_time,
  allDay: row.all_day === 1,
  timezone: row.timezone,
  attendees: row.attendees ? (JSON.parse(row.attendees) as Attendee[]) : [],
  recurrence: row.recurrence_rule
    ? {
        rule: row.recurrence_rule,
        exceptions: row.recurrence_exceptions ? (JSON.parse(row.recurrence_exceptions) as string[]) : [],
      }
    : undefined,
  requiresPrep: row.requires_prep === 1,
  prepNotes: row.prep_notes ?? undefined,
  travelTime: row.travel_time_minutes ?? undefined,
  tags: row.tags ? (JSON.parse(row.tags) as string[]) : [],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// ============================================================================
// Operations
// ============================================================================

const getEvent = async (knex: Knex, id: string): Promise<CalendarEvent | null> => {
  const row = await knex<CalendarEventRow>('calendar_events').where('id', id).first();
  return row ? eventFromRow(row) : null;
};

const getEventsInRange = async (knex: Knex, start: Date, end: Date): Promise<CalendarEvent[]> => {
  const startStr = start.toISOString();
  const endStr = end.toISOString();

  const rows = await knex<CalendarEventRow>('calendar_events')
    .where('start_time', '<', endStr)
    .where('end_time', '>', startStr)
    .orderBy('start_time');

  return rows.map(eventFromRow);
};

const getUpcoming = async (knex: Knex, hours: number, from: Date = new Date()): Promise<CalendarEvent[]> => {
  const end = new Date(from.getTime() + hours * 60 * 60 * 1000);
  return getEventsInRange(knex, from, end);
};

const getToday = async (knex: Knex, now: Date = new Date()): Promise<CalendarEvent[]> => {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  return getEventsInRange(knex, start, end);
};

const createEvent = async (knex: Knex, input: CreateCalendarEventInput): Promise<CalendarEvent> => {
  const timestamp = now();
  const id = crypto.randomUUID();

  const row: CalendarEventRow = {
    id,
    external_id: input.externalId ?? null,
    source: input.source ?? 'local',
    calendar_source_id: input.calendarSourceId ?? null,
    title: input.title,
    description: input.description ?? null,
    location: input.location ?? null,
    start_time: input.start,
    end_time: input.end,
    all_day: input.allDay ? 1 : 0,
    timezone: input.timezone,
    attendees: input.attendees?.length ? JSON.stringify(input.attendees) : null,
    recurrence_rule: input.recurrence?.rule ?? null,
    recurrence_exceptions: input.recurrence?.exceptions?.length ? JSON.stringify(input.recurrence.exceptions) : null,
    requires_prep: input.requiresPrep ? 1 : 0,
    prep_notes: input.prepNotes ?? null,
    travel_time_minutes: input.travelTime ?? null,
    tags: input.tags?.length ? JSON.stringify(input.tags) : null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  await knex('calendar_events').insert(row);

  const result = await getEvent(knex, id);
  if (!result) {
    throw new Error('Failed to create event');
  }
  return result;
};

const updateEvent = async (knex: Knex, id: string, updates: UpdateCalendarEventInput): Promise<CalendarEvent> => {
  const existing = await getEvent(knex, id);
  if (!existing) {
    throw new Error('Event not found');
  }

  const updateData: Partial<CalendarEventRow> = {
    updated_at: now(),
  };

  if (updates.externalId !== undefined) updateData.external_id = updates.externalId ?? null;
  if (updates.source !== undefined) updateData.source = updates.source;
  if (updates.calendarSourceId !== undefined) updateData.calendar_source_id = updates.calendarSourceId ?? null;
  if (updates.title !== undefined) updateData.title = updates.title;
  if (updates.description !== undefined) updateData.description = updates.description ?? null;
  if (updates.location !== undefined) updateData.location = updates.location ?? null;
  if (updates.start !== undefined) updateData.start_time = updates.start;
  if (updates.end !== undefined) updateData.end_time = updates.end;
  if (updates.allDay !== undefined) updateData.all_day = updates.allDay ? 1 : 0;
  if (updates.timezone !== undefined) updateData.timezone = updates.timezone;
  if (updates.attendees !== undefined) {
    updateData.attendees = updates.attendees.length ? JSON.stringify(updates.attendees) : null;
  }
  if (updates.recurrence !== undefined) {
    updateData.recurrence_rule = updates.recurrence?.rule ?? null;
    updateData.recurrence_exceptions = updates.recurrence?.exceptions?.length
      ? JSON.stringify(updates.recurrence.exceptions)
      : null;
  }
  if (updates.requiresPrep !== undefined) updateData.requires_prep = updates.requiresPrep ? 1 : 0;
  if (updates.prepNotes !== undefined) updateData.prep_notes = updates.prepNotes ?? null;
  if (updates.travelTime !== undefined) updateData.travel_time_minutes = updates.travelTime ?? null;
  if (updates.tags !== undefined) {
    updateData.tags = updates.tags.length ? JSON.stringify(updates.tags) : null;
  }

  await knex('calendar_events').where('id', id).update(updateData);

  const result = await getEvent(knex, id);
  if (!result) {
    throw new Error('Failed to update event');
  }
  return result;
};

const deleteEvent = async (knex: Knex, id: string): Promise<void> => {
  await knex('calendar_events').where('id', id).delete();
};

const getEventByExternalId = async (
  knex: Knex,
  externalId: string,
  source: EventSource,
): Promise<CalendarEvent | null> => {
  const row = await knex<CalendarEventRow>('calendar_events')
    .where('external_id', externalId)
    .where('source', source)
    .first();
  return row ? eventFromRow(row) : null;
};

const getEventsBySourceAndCalendar = async (
  knex: Knex,
  source: EventSource,
  calendarSourceId: string,
): Promise<CalendarEvent[]> => {
  const rows = await knex<CalendarEventRow>('calendar_events')
    .where('source', source)
    .where('calendar_source_id', calendarSourceId)
    .orderBy('start_time');
  return rows.map(eventFromRow);
};

const deleteEventsBySourceAndCalendar = async (
  knex: Knex,
  source: EventSource,
  calendarSourceId: string,
  excludeIds: string[] = [],
): Promise<number> => {
  let query = knex('calendar_events').where('source', source).where('calendar_source_id', calendarSourceId);

  if (excludeIds.length > 0) {
    query = query.whereNotIn('id', excludeIds);
  }

  return query.delete();
};

export {
  getEvent,
  getEventsInRange,
  getUpcoming,
  getToday,
  createEvent,
  updateEvent,
  deleteEvent,
  getEventByExternalId,
  getEventsBySourceAndCalendar,
  deleteEventsBySourceAndCalendar,
};
