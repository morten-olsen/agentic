import type { Services } from '../services/services.ts';
import { DatabaseService } from '../database/database.ts';
import { EventService } from '../events/events.ts';

import type {
  CalendarEvent,
  CreateCalendarEventInput,
  UpdateCalendarEventInput,
  CalendarContext,
  EventSource,
} from './calendar.schemas.ts';
import * as store from './calendar.store.ts';
import { startOfDay, endOfDay, addHours, minutesBetween, isEventAt, sortEventsByStart } from './calendar.utils.ts';

/**
 * Calendar Service - manages calendar events and time awareness.
 *
 * Time awareness is fundamental to being a useful assistant. Calendar is
 * core infrastructure, not an optional tool set.
 */
class CalendarService {
  #services: Services;

  constructor(services: Services) {
    this.#services = services;
  }

  // ==========================================================================
  // Event CRUD
  // ==========================================================================

  /**
   * Gets an event by ID.
   */
  getEvent = async (id: string): Promise<CalendarEvent | null> => {
    const db = this.#services.get(DatabaseService);
    return store.getEvent(db.knex, id);
  };

  /**
   * Gets events within a time range.
   */
  getEventsInRange = async (start: Date, end: Date): Promise<CalendarEvent[]> => {
    const db = this.#services.get(DatabaseService);
    return store.getEventsInRange(db.knex, start, end);
  };

  /**
   * Gets events in the next N hours.
   */
  getUpcoming = async (hours = 24, from: Date = new Date()): Promise<CalendarEvent[]> => {
    const db = this.#services.get(DatabaseService);
    return store.getUpcoming(db.knex, hours, from);
  };

  /**
   * Gets all events for today.
   */
  getToday = async (now: Date = new Date()): Promise<CalendarEvent[]> => {
    const db = this.#services.get(DatabaseService);
    return store.getToday(db.knex, now);
  };

  /**
   * Creates a new event.
   */
  createEvent = async (input: CreateCalendarEventInput): Promise<CalendarEvent> => {
    const db = this.#services.get(DatabaseService);
    const event = await store.createEvent(db.knex, input);

    // Emit event to event log
    await this.#services.get(EventService).emit({
      type: 'calendar.event.created',
      source: 'calendar-service',
      externalId: `${event.id}-created`,
      summary: `Calendar event '${event.title}' created`,
      data: {
        eventId: event.id,
        title: event.title,
        start: event.start,
        end: event.end,
        allDay: event.allDay,
        location: event.location,
        source: event.source,
      },
      entityId: event.id,
      entityType: 'calendar-event',
    });

    return event;
  };

  /**
   * Updates an event.
   */
  updateEvent = async (id: string, updates: UpdateCalendarEventInput): Promise<CalendarEvent> => {
    const db = this.#services.get(DatabaseService);
    const event = await store.updateEvent(db.knex, id, updates);

    // Emit event to event log
    await this.#services.get(EventService).emit({
      type: 'calendar.event.updated',
      source: 'calendar-service',
      externalId: `${event.id}-updated-${event.updatedAt}`,
      summary: `Calendar event '${event.title}' updated`,
      data: {
        eventId: event.id,
        title: event.title,
        start: event.start,
        end: event.end,
        allDay: event.allDay,
        location: event.location,
        source: event.source,
        updatedFields: Object.keys(updates),
      },
      entityId: event.id,
      entityType: 'calendar-event',
    });

    return event;
  };

  /**
   * Deletes an event.
   */
  deleteEvent = async (id: string): Promise<void> => {
    const db = this.#services.get(DatabaseService);

    // Get event before deleting for the event log
    const event = await store.getEvent(db.knex, id);

    await store.deleteEvent(db.knex, id);

    // Emit event to event log (only if event existed)
    if (event) {
      await this.#services.get(EventService).emit({
        type: 'calendar.event.deleted',
        source: 'calendar-service',
        externalId: `${id}-deleted-${new Date().toISOString()}`,
        summary: `Calendar event '${event.title}' deleted`,
        data: {
          eventId: id,
          title: event.title,
          start: event.start,
          end: event.end,
          source: event.source,
        },
        entityId: id,
        entityType: 'calendar-event',
      });
    }
  };

  /**
   * Finds an event by external ID (for sync).
   */
  getEventByExternalId = async (externalId: string, source: EventSource): Promise<CalendarEvent | null> => {
    const db = this.#services.get(DatabaseService);
    return store.getEventByExternalId(db.knex, externalId, source);
  };

  /**
   * Gets all events for a specific source and calendar.
   */
  getEventsBySourceAndCalendar = async (source: EventSource, calendarSourceId: string): Promise<CalendarEvent[]> => {
    const db = this.#services.get(DatabaseService);
    return store.getEventsBySourceAndCalendar(db.knex, source, calendarSourceId);
  };

  /**
   * Deletes events for a source/calendar, optionally excluding specific IDs.
   * Returns the number of deleted events.
   */
  deleteEventsBySourceAndCalendar = async (
    source: EventSource,
    calendarSourceId: string,
    excludeIds: string[] = [],
  ): Promise<number> => {
    const db = this.#services.get(DatabaseService);

    // Get events before deleting for the event log
    const eventsToDelete = await store.getEventsBySourceAndCalendar(db.knex, source, calendarSourceId);
    const filteredEvents = eventsToDelete.filter((e) => !excludeIds.includes(e.id));

    const count = await store.deleteEventsBySourceAndCalendar(db.knex, source, calendarSourceId, excludeIds);

    // Emit events for each deleted event
    const eventService = this.#services.get(EventService);
    const timestamp = new Date().toISOString();
    for (const event of filteredEvents) {
      await eventService.emit({
        type: 'calendar.event.deleted',
        source: 'calendar-service',
        externalId: `${event.id}-deleted-${timestamp}`,
        summary: `Calendar event '${event.title}' deleted (sync cleanup)`,
        data: {
          eventId: event.id,
          title: event.title,
          start: event.start,
          end: event.end,
          source: event.source,
          calendarSourceId,
          reason: 'sync-cleanup',
        },
        entityId: event.id,
        entityType: 'calendar-event',
      });
    }

    return count;
  };

  // ==========================================================================
  // Calendar Context
  // ==========================================================================

  /**
   * Gets the current calendar context for the agent.
   * Includes current event, next event, and time until next.
   */
  getCurrentContext = async (now: Date = new Date()): Promise<CalendarContext> => {
    const db = this.#services.get(DatabaseService);

    // Get events for today and a bit into tomorrow (for context)
    const dayStart = startOfDay(now);
    const dayEnd = addHours(endOfDay(now), 6); // Include early morning tomorrow
    const events = await store.getEventsInRange(db.knex, dayStart, dayEnd);
    const sorted = sortEventsByStart(events);

    // Find current event
    let currentEvent: CalendarEvent | null = null;
    for (const event of sorted) {
      if (isEventAt(event, now)) {
        currentEvent = event;
        break;
      }
    }

    // Find next event (first event that starts after now)
    let nextEvent: CalendarEvent | null = null;
    for (const event of sorted) {
      const eventStart = new Date(event.start);
      if (eventStart > now) {
        nextEvent = event;
        break;
      }
    }

    // Calculate minutes to next
    let minutesToNext: number | null = null;
    if (nextEvent) {
      minutesToNext = minutesBetween(now, new Date(nextEvent.start));
    }

    // Get remaining events for today
    const todayEnd = endOfDay(now);
    const todayRemaining = sorted.filter((event) => {
      const eventStart = new Date(event.start);
      return eventStart > now && eventStart <= todayEnd;
    });

    return {
      currentEvent,
      nextEvent,
      minutesToNext,
      todayRemaining,
    };
  };

  /**
   * Gets the current event (if any).
   */
  getCurrentEvent = async (now: Date = new Date()): Promise<CalendarEvent | null> => {
    const context = await this.getCurrentContext(now);
    return context.currentEvent;
  };

  /**
   * Gets the next event.
   */
  getNextEvent = async (now: Date = new Date()): Promise<CalendarEvent | null> => {
    const context = await this.getCurrentContext(now);
    return context.nextEvent;
  };

  /**
   * Checks if the user is currently busy (in an event).
   */
  isBusy = async (time: Date = new Date()): Promise<boolean> => {
    const current = await this.getCurrentEvent(time);
    return current !== null;
  };

  // ==========================================================================
  // Agenda & Summary
  // ==========================================================================

  /**
   * Generates a human-readable agenda for a given day.
   */
  getDayAgenda = async (date: Date = new Date()): Promise<string> => {
    const events = await this.getToday(date);

    if (events.length === 0) {
      return 'No events scheduled for today.';
    }

    const lines: string[] = [];
    for (const event of events) {
      const start = new Date(event.start);
      const time = event.allDay
        ? 'All day'
        : start.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          });
      lines.push(`- ${time}: ${event.title}`);

      if (event.location) {
        lines.push(`  Location: ${event.location}`);
      }
    }

    return lines.join('\n');
  };
}

// Re-export types
export type {
  CalendarEvent,
  CreateCalendarEventInput,
  UpdateCalendarEventInput,
  CalendarContext,
  EventSource,
  AttendeeStatus,
  Attendee,
  Recurrence,
  TimeBlockType,
  TimeBlock,
} from './calendar.schemas.ts';

export { CalendarService };

export {
  startOfDay,
  endOfDay,
  addHours,
  minutesBetween,
  isEventAt,
  isFutureEvent,
  eventOverlapsRange,
  sortEventsByStart,
  formatEventTime,
  getEventDuration,
} from './calendar.utils.ts';
