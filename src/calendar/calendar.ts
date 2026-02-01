import type { Services } from '../services/services.ts';
import { DatabaseService } from '../database/database.ts';

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
    return store.createEvent(db.knex, input);
  };

  /**
   * Updates an event.
   */
  updateEvent = async (id: string, updates: UpdateCalendarEventInput): Promise<CalendarEvent> => {
    const db = this.#services.get(DatabaseService);
    return store.updateEvent(db.knex, id, updates);
  };

  /**
   * Deletes an event.
   */
  deleteEvent = async (id: string): Promise<void> => {
    const db = this.#services.get(DatabaseService);
    return store.deleteEvent(db.knex, id);
  };

  /**
   * Finds an event by external ID (for sync).
   */
  getEventByExternalId = async (externalId: string, source: EventSource): Promise<CalendarEvent | null> => {
    const db = this.#services.get(DatabaseService);
    return store.getEventByExternalId(db.knex, externalId, source);
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
