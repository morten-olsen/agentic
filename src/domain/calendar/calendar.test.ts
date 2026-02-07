import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { Services } from '../../core/services/services.ts';
import { createDatabaseService, DatabaseService } from '../../core/database/database.ts';

import { CalendarService } from './calendar.ts';
import {
  startOfDay,
  endOfDay,
  addHours,
  minutesBetween,
  isEventAt,
  isFutureEvent,
  sortEventsByStart,
  formatEventTime,
  getEventDuration,
} from './calendar.utils.ts';

describe('CalendarService', () => {
  let services: Services;
  let calendar: CalendarService;

  beforeEach(async () => {
    services = new Services();
    const db = createDatabaseService(services, { path: ':memory:' });
    services.set(DatabaseService, db);
    await db.migrate();
    calendar = services.get(CalendarService);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('Event CRUD', () => {
    it('creates an event', async () => {
      const event = await calendar.createEvent({
        title: 'Team Meeting',
        start: '2024-01-15T10:00:00.000Z',
        end: '2024-01-15T11:00:00.000Z',
        timezone: 'America/New_York',
      });

      expect(event.id).toBeDefined();
      expect(event.title).toBe('Team Meeting');
      expect(event.source).toBe('local');
    });

    it('creates an event with all fields', async () => {
      const event = await calendar.createEvent({
        title: 'Client Call',
        description: 'Q1 review with Acme Corp',
        location: 'Zoom',
        start: '2024-01-15T14:00:00.000Z',
        end: '2024-01-15T15:00:00.000Z',
        timezone: 'America/New_York',
        attendees: [
          { email: 'alice@example.com', name: 'Alice', status: 'accepted' },
          { email: 'bob@acme.com', name: 'Bob', status: 'pending' },
        ],
        requiresPrep: true,
        prepNotes: 'Review Q4 metrics',
        travelTime: 0,
        tags: ['client', 'important'],
      });

      expect(event.description).toBe('Q1 review with Acme Corp');
      expect(event.location).toBe('Zoom');
      expect(event.attendees).toHaveLength(2);
      expect(event.requiresPrep).toBe(true);
      expect(event.prepNotes).toBe('Review Q4 metrics');
      expect(event.tags).toContain('client');
    });

    it('creates an all-day event', async () => {
      const event = await calendar.createEvent({
        title: 'Company Holiday',
        start: '2024-01-15T00:00:00.000Z',
        end: '2024-01-16T00:00:00.000Z',
        allDay: true,
        timezone: 'America/New_York',
      });

      expect(event.allDay).toBe(true);
    });

    it('gets an event by ID', async () => {
      const created = await calendar.createEvent({
        title: 'Test',
        start: '2024-01-15T10:00:00.000Z',
        end: '2024-01-15T11:00:00.000Z',
        timezone: 'UTC',
      });

      const retrieved = await calendar.getEvent(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.title).toBe('Test');
    });

    it('returns null for non-existent event', async () => {
      const result = await calendar.getEvent('non-existent-id');
      expect(result).toBeNull();
    });

    it('updates an event', async () => {
      const event = await calendar.createEvent({
        title: 'Original',
        start: '2024-01-15T10:00:00.000Z',
        end: '2024-01-15T11:00:00.000Z',
        timezone: 'UTC',
      });

      const updated = await calendar.updateEvent(event.id, {
        title: 'Updated',
        location: 'Room 101',
      });

      expect(updated.title).toBe('Updated');
      expect(updated.location).toBe('Room 101');
    });

    it('deletes an event', async () => {
      const event = await calendar.createEvent({
        title: 'To Delete',
        start: '2024-01-15T10:00:00.000Z',
        end: '2024-01-15T11:00:00.000Z',
        timezone: 'UTC',
      });

      await calendar.deleteEvent(event.id);

      const result = await calendar.getEvent(event.id);
      expect(result).toBeNull();
    });
  });

  describe('Event Queries', () => {
    beforeEach(async () => {
      // Create events for testing
      await calendar.createEvent({
        title: 'Morning Meeting',
        start: '2024-01-15T09:00:00.000Z',
        end: '2024-01-15T10:00:00.000Z',
        timezone: 'UTC',
      });
      await calendar.createEvent({
        title: 'Lunch',
        start: '2024-01-15T12:00:00.000Z',
        end: '2024-01-15T13:00:00.000Z',
        timezone: 'UTC',
      });
      await calendar.createEvent({
        title: 'Afternoon Work',
        start: '2024-01-15T14:00:00.000Z',
        end: '2024-01-15T17:00:00.000Z',
        timezone: 'UTC',
      });
      await calendar.createEvent({
        title: 'Tomorrow Event',
        start: '2024-01-16T10:00:00.000Z',
        end: '2024-01-16T11:00:00.000Z',
        timezone: 'UTC',
      });
    });

    it('gets events in range', async () => {
      const events = await calendar.getEventsInRange(
        new Date('2024-01-15T00:00:00.000Z'),
        new Date('2024-01-15T23:59:59.000Z'),
      );

      expect(events).toHaveLength(3);
    });

    it('gets events for today', async () => {
      const events = await calendar.getToday(new Date('2024-01-15T08:00:00.000Z'));

      expect(events).toHaveLength(3);
      expect(events[0]?.title).toBe('Morning Meeting'); // Ordered by start time
    });

    it('gets upcoming events', async () => {
      const events = await calendar.getUpcoming(4, new Date('2024-01-15T10:30:00.000Z'));

      expect(events).toHaveLength(2); // Lunch and Afternoon Work
    });

    it('finds event by external ID', async () => {
      await calendar.createEvent({
        title: 'Synced Event',
        externalId: 'google-123',
        source: 'google',
        start: '2024-01-15T10:00:00.000Z',
        end: '2024-01-15T11:00:00.000Z',
        timezone: 'UTC',
      });

      const found = await calendar.getEventByExternalId('google-123', 'google');

      expect(found).not.toBeNull();
      expect(found?.title).toBe('Synced Event');
    });
  });

  describe('Calendar Context', () => {
    beforeEach(async () => {
      await calendar.createEvent({
        title: 'Current Meeting',
        start: '2024-01-15T10:00:00.000Z',
        end: '2024-01-15T11:00:00.000Z',
        timezone: 'UTC',
      });
      await calendar.createEvent({
        title: 'Next Meeting',
        start: '2024-01-15T11:30:00.000Z',
        end: '2024-01-15T12:30:00.000Z',
        timezone: 'UTC',
      });
      await calendar.createEvent({
        title: 'Later Today',
        start: '2024-01-15T15:00:00.000Z',
        end: '2024-01-15T16:00:00.000Z',
        timezone: 'UTC',
      });
    });

    it('gets current context during meeting', async () => {
      const now = new Date('2024-01-15T10:30:00.000Z');
      const context = await calendar.getCurrentContext(now);

      expect(context.currentEvent?.title).toBe('Current Meeting');
      expect(context.nextEvent?.title).toBe('Next Meeting');
      expect(context.minutesToNext).toBe(60);
      expect(context.todayRemaining).toHaveLength(2);
    });

    it('gets current context between meetings', async () => {
      const now = new Date('2024-01-15T11:15:00.000Z');
      const context = await calendar.getCurrentContext(now);

      expect(context.currentEvent).toBeNull();
      expect(context.nextEvent?.title).toBe('Next Meeting');
      expect(context.minutesToNext).toBe(15);
    });

    it('gets current context with no upcoming events', async () => {
      const now = new Date('2024-01-15T20:00:00.000Z');
      const context = await calendar.getCurrentContext(now);

      expect(context.currentEvent).toBeNull();
      expect(context.nextEvent).toBeNull();
      expect(context.minutesToNext).toBeNull();
      expect(context.todayRemaining).toHaveLength(0);
    });

    it('gets current event', async () => {
      const now = new Date('2024-01-15T10:30:00.000Z');
      const current = await calendar.getCurrentEvent(now);

      expect(current?.title).toBe('Current Meeting');
    });

    it('gets next event', async () => {
      const now = new Date('2024-01-15T10:30:00.000Z');
      const next = await calendar.getNextEvent(now);

      expect(next?.title).toBe('Next Meeting');
    });

    it('checks if busy', async () => {
      expect(await calendar.isBusy(new Date('2024-01-15T10:30:00.000Z'))).toBe(true);
      expect(await calendar.isBusy(new Date('2024-01-15T11:15:00.000Z'))).toBe(false);
    });
  });

  describe('Agenda', () => {
    beforeEach(async () => {
      await calendar.createEvent({
        title: 'Standup',
        start: '2024-01-15T09:00:00.000Z',
        end: '2024-01-15T09:15:00.000Z',
        timezone: 'UTC',
      });
      await calendar.createEvent({
        title: '1:1 with Manager',
        start: '2024-01-15T14:00:00.000Z',
        end: '2024-01-15T14:30:00.000Z',
        location: 'Room 201',
        timezone: 'UTC',
      });
    });

    it('generates day agenda', async () => {
      const agenda = await calendar.getDayAgenda(new Date('2024-01-15T08:00:00.000Z'));

      expect(agenda).toContain('Standup');
      expect(agenda).toContain('1:1 with Manager');
      expect(agenda).toContain('Room 201');
    });

    it('returns message for empty day', async () => {
      const agenda = await calendar.getDayAgenda(new Date('2024-01-20T08:00:00.000Z'));

      expect(agenda).toBe('No events scheduled for today.');
    });
  });
});

describe('Calendar Utils', () => {
  describe('startOfDay', () => {
    it('returns start of day', () => {
      const date = new Date('2024-01-15T14:30:00.000Z');
      const start = startOfDay(date);

      expect(start.getHours()).toBe(0);
      expect(start.getMinutes()).toBe(0);
      expect(start.getSeconds()).toBe(0);
    });
  });

  describe('endOfDay', () => {
    it('returns end of day', () => {
      const date = new Date('2024-01-15T14:30:00.000Z');
      const end = endOfDay(date);

      expect(end.getHours()).toBe(23);
      expect(end.getMinutes()).toBe(59);
      expect(end.getSeconds()).toBe(59);
    });
  });

  describe('addHours', () => {
    it('adds hours to date', () => {
      const date = new Date('2024-01-15T10:00:00.000Z');
      const result = addHours(date, 2);

      expect(result.toISOString()).toBe('2024-01-15T12:00:00.000Z');
    });
  });

  describe('minutesBetween', () => {
    it('calculates minutes between dates', () => {
      const start = new Date('2024-01-15T10:00:00.000Z');
      const end = new Date('2024-01-15T11:30:00.000Z');

      expect(minutesBetween(start, end)).toBe(90);
    });
  });

  describe('isEventAt', () => {
    const event = {
      id: '1',
      title: 'Test',
      start: '2024-01-15T10:00:00.000Z',
      end: '2024-01-15T11:00:00.000Z',
      allDay: false,
      timezone: 'UTC',
      source: 'local' as const,
      attendees: [],
      requiresPrep: false,
      tags: [],
      createdAt: '',
      updatedAt: '',
    };

    it('returns true during event', () => {
      expect(isEventAt(event, new Date('2024-01-15T10:30:00.000Z'))).toBe(true);
    });

    it('returns true at start', () => {
      expect(isEventAt(event, new Date('2024-01-15T10:00:00.000Z'))).toBe(true);
    });

    it('returns false at end', () => {
      expect(isEventAt(event, new Date('2024-01-15T11:00:00.000Z'))).toBe(false);
    });

    it('returns false before event', () => {
      expect(isEventAt(event, new Date('2024-01-15T09:00:00.000Z'))).toBe(false);
    });
  });

  describe('isFutureEvent', () => {
    const event = {
      id: '1',
      title: 'Test',
      start: '2024-01-15T10:00:00.000Z',
      end: '2024-01-15T11:00:00.000Z',
      allDay: false,
      timezone: 'UTC',
      source: 'local' as const,
      attendees: [],
      requiresPrep: false,
      tags: [],
      createdAt: '',
      updatedAt: '',
    };

    it('returns true for future event', () => {
      expect(isFutureEvent(event, new Date('2024-01-15T09:00:00.000Z'))).toBe(true);
    });

    it('returns false for current event', () => {
      expect(isFutureEvent(event, new Date('2024-01-15T10:30:00.000Z'))).toBe(false);
    });

    it('returns false for past event', () => {
      expect(isFutureEvent(event, new Date('2024-01-15T12:00:00.000Z'))).toBe(false);
    });
  });

  describe('sortEventsByStart', () => {
    it('sorts events by start time', () => {
      const events = [
        {
          id: '2',
          title: 'Second',
          start: '2024-01-15T11:00:00.000Z',
          end: '',
          allDay: false,
          timezone: 'UTC',
          source: 'local' as const,
          attendees: [],
          requiresPrep: false,
          tags: [],
          createdAt: '',
          updatedAt: '',
        },
        {
          id: '1',
          title: 'First',
          start: '2024-01-15T09:00:00.000Z',
          end: '',
          allDay: false,
          timezone: 'UTC',
          source: 'local' as const,
          attendees: [],
          requiresPrep: false,
          tags: [],
          createdAt: '',
          updatedAt: '',
        },
        {
          id: '3',
          title: 'Third',
          start: '2024-01-15T14:00:00.000Z',
          end: '',
          allDay: false,
          timezone: 'UTC',
          source: 'local' as const,
          attendees: [],
          requiresPrep: false,
          tags: [],
          createdAt: '',
          updatedAt: '',
        },
      ];

      const sorted = sortEventsByStart(events);

      expect(sorted[0]?.title).toBe('First');
      expect(sorted[1]?.title).toBe('Second');
      expect(sorted[2]?.title).toBe('Third');
    });
  });

  describe('formatEventTime', () => {
    it('formats event time range', () => {
      const event = {
        id: '1',
        title: 'Test',
        start: '2024-01-15T10:00:00.000Z',
        end: '2024-01-15T11:30:00.000Z',
        allDay: false,
        timezone: 'UTC',
        source: 'local' as const,
        attendees: [],
        requiresPrep: false,
        tags: [],
        createdAt: '',
        updatedAt: '',
      };

      const formatted = formatEventTime(event);

      // Format depends on locale, just check it contains something
      expect(formatted).toContain('-');
    });

    it('returns All day for all-day events', () => {
      const event = {
        id: '1',
        title: 'Test',
        start: '2024-01-15T00:00:00.000Z',
        end: '2024-01-16T00:00:00.000Z',
        allDay: true,
        timezone: 'UTC',
        source: 'local' as const,
        attendees: [],
        requiresPrep: false,
        tags: [],
        createdAt: '',
        updatedAt: '',
      };

      expect(formatEventTime(event)).toBe('All day');
    });
  });

  describe('getEventDuration', () => {
    it('calculates event duration in minutes', () => {
      const event = {
        id: '1',
        title: 'Test',
        start: '2024-01-15T10:00:00.000Z',
        end: '2024-01-15T11:30:00.000Z',
        allDay: false,
        timezone: 'UTC',
        source: 'local' as const,
        attendees: [],
        requiresPrep: false,
        tags: [],
        createdAt: '',
        updatedAt: '',
      };

      expect(getEventDuration(event)).toBe(90);
    });
  });
});
