import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { Services } from '../../core/services/services.ts';
import { createDatabaseService, DatabaseService } from '../../core/database/database.ts';
import { ExternalServiceRegistry } from '../../integrations/external/external.ts';

import { CalendarService } from './calendar.ts';
import { CalendarSyncService, generateFingerprint, isAllDayEvent } from './calendar-sync.ts';
import * as syncStore from './calendar-sync.store.ts';

// Mock the config module
vi.mock('../config/config.ts', () => ({
  getConfig: () => ({
    homeassistant: {
      url: 'http://homeassistant.local:8123',
      token: 'test-token',
      calendarEntities: ['calendar.family', 'calendar.work'],
      personEntity: '',
    },
    calendarSync: {
      intervalMinutes: 15,
      windowDays: 30,
    },
  }),
  isHomeAssistantConfigured: () => true,
}));

describe('generateFingerprint', () => {
  it('generates consistent fingerprints for same input', () => {
    const fp1 = generateFingerprint('calendar.family', '2026-02-05T10:00:00+01:00', 'Team Meeting');
    const fp2 = generateFingerprint('calendar.family', '2026-02-05T10:00:00+01:00', 'Team Meeting');

    expect(fp1).toBe(fp2);
  });

  it('generates different fingerprints for different calendars', () => {
    const fp1 = generateFingerprint('calendar.family', '2026-02-05T10:00:00+01:00', 'Team Meeting');
    const fp2 = generateFingerprint('calendar.work', '2026-02-05T10:00:00+01:00', 'Team Meeting');

    expect(fp1).not.toBe(fp2);
  });

  it('generates different fingerprints for different times', () => {
    const fp1 = generateFingerprint('calendar.family', '2026-02-05T10:00:00+01:00', 'Team Meeting');
    const fp2 = generateFingerprint('calendar.family', '2026-02-05T11:00:00+01:00', 'Team Meeting');

    expect(fp1).not.toBe(fp2);
  });

  it('generates different fingerprints for different summaries', () => {
    const fp1 = generateFingerprint('calendar.family', '2026-02-05T10:00:00+01:00', 'Team Meeting');
    const fp2 = generateFingerprint('calendar.family', '2026-02-05T10:00:00+01:00', 'Standup');

    expect(fp1).not.toBe(fp2);
  });

  it('returns prefixed hex string', () => {
    const fp = generateFingerprint('calendar.family', '2026-02-05T10:00:00+01:00', 'Team Meeting');

    expect(fp).toMatch(/^ha_[a-f0-9]{16}$/);
  });
});

describe('isAllDayEvent', () => {
  it('returns true for date-only start', () => {
    const event = { start: '2026-02-05', end: '2026-02-06', summary: 'Holiday' };

    expect(isAllDayEvent(event)).toBe(true);
  });

  it('returns false for datetime start', () => {
    const event = { start: '2026-02-05T10:00:00+01:00', end: '2026-02-05T11:00:00+01:00', summary: 'Meeting' };

    expect(isAllDayEvent(event)).toBe(false);
  });

  it('handles datetime with Z timezone', () => {
    const event = { start: '2026-02-05T10:00:00Z', end: '2026-02-05T11:00:00Z', summary: 'Meeting' };

    expect(isAllDayEvent(event)).toBe(false);
  });
});

describe('CalendarSyncService', () => {
  let services: Services;
  let syncService: CalendarSyncService;
  let calendar: CalendarService;

  beforeEach(async () => {
    services = new Services();
    const db = createDatabaseService(services, { path: ':memory:' });
    services.set(DatabaseService, db);
    await db.migrate();

    // Set up mock ExternalServiceRegistry
    const registry = new ExternalServiceRegistry(services);
    services.set(ExternalServiceRegistry, registry);

    calendar = services.get(CalendarService);
    syncService = new CalendarSyncService(services);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('Sync State', () => {
    it('returns null for non-existent sync state', async () => {
      const state = await syncService.getSyncState('calendar.nonexistent');

      expect(state).toBeNull();
    });

    it('returns all sync states', async () => {
      const db = services.get(DatabaseService);

      // Create some sync states directly
      await syncStore.updateSyncState(db.knex, 'calendar.family', {
        lastSyncAt: '2026-02-05T10:00:00.000Z',
        lastSyncStatus: 'success',
        eventsInWindow: 5,
      });
      await syncStore.updateSyncState(db.knex, 'calendar.work', {
        lastSyncAt: '2026-02-05T10:00:00.000Z',
        lastSyncStatus: 'error',
        errorMessage: 'Connection failed',
        eventsInWindow: 0,
      });

      const states = await syncService.getAllSyncStates();

      expect(states).toHaveLength(2);
      expect(states.find((s) => s.sourceId === 'calendar.family')?.lastSyncStatus).toBe('success');
      expect(states.find((s) => s.sourceId === 'calendar.work')?.errorMessage).toBe('Connection failed');
    });
  });

  describe('Event Source and Calendar', () => {
    it('creates events with homeassistant source and calendarSourceId', async () => {
      const event = await calendar.createEvent({
        externalId: 'ha_abc123',
        source: 'homeassistant',
        calendarSourceId: 'calendar.family',
        title: 'Family Dinner',
        start: '2026-02-05T18:00:00.000Z',
        end: '2026-02-05T20:00:00.000Z',
        timezone: 'UTC',
      });

      expect(event.source).toBe('homeassistant');
      expect(event.calendarSourceId).toBe('calendar.family');
    });

    it('retrieves events by source and calendar', async () => {
      await calendar.createEvent({
        externalId: 'ha_event1',
        source: 'homeassistant',
        calendarSourceId: 'calendar.family',
        title: 'Family Event 1',
        start: '2026-02-05T10:00:00.000Z',
        end: '2026-02-05T11:00:00.000Z',
        timezone: 'UTC',
      });
      await calendar.createEvent({
        externalId: 'ha_event2',
        source: 'homeassistant',
        calendarSourceId: 'calendar.family',
        title: 'Family Event 2',
        start: '2026-02-05T14:00:00.000Z',
        end: '2026-02-05T15:00:00.000Z',
        timezone: 'UTC',
      });
      await calendar.createEvent({
        externalId: 'ha_event3',
        source: 'homeassistant',
        calendarSourceId: 'calendar.work',
        title: 'Work Event',
        start: '2026-02-05T09:00:00.000Z',
        end: '2026-02-05T10:00:00.000Z',
        timezone: 'UTC',
      });

      const familyEvents = await calendar.getEventsBySourceAndCalendar('homeassistant', 'calendar.family');
      const workEvents = await calendar.getEventsBySourceAndCalendar('homeassistant', 'calendar.work');

      expect(familyEvents).toHaveLength(2);
      expect(workEvents).toHaveLength(1);
      expect(familyEvents[0]?.title).toBe('Family Event 1'); // Ordered by start time
    });

    it('deletes events by source and calendar, excluding specified IDs', async () => {
      const event1 = await calendar.createEvent({
        externalId: 'ha_keep',
        source: 'homeassistant',
        calendarSourceId: 'calendar.family',
        title: 'Keep This',
        start: '2026-02-05T10:00:00.000Z',
        end: '2026-02-05T11:00:00.000Z',
        timezone: 'UTC',
      });
      await calendar.createEvent({
        externalId: 'ha_delete',
        source: 'homeassistant',
        calendarSourceId: 'calendar.family',
        title: 'Delete This',
        start: '2026-02-05T14:00:00.000Z',
        end: '2026-02-05T15:00:00.000Z',
        timezone: 'UTC',
      });

      const deleteCount = await calendar.deleteEventsBySourceAndCalendar('homeassistant', 'calendar.family', [
        event1.id,
      ]);

      expect(deleteCount).toBe(1);

      const remaining = await calendar.getEventsBySourceAndCalendar('homeassistant', 'calendar.family');
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.title).toBe('Keep This');
    });

    it('deletes all events when no exclusions provided', async () => {
      await calendar.createEvent({
        externalId: 'ha_event1',
        source: 'homeassistant',
        calendarSourceId: 'calendar.family',
        title: 'Event 1',
        start: '2026-02-05T10:00:00.000Z',
        end: '2026-02-05T11:00:00.000Z',
        timezone: 'UTC',
      });
      await calendar.createEvent({
        externalId: 'ha_event2',
        source: 'homeassistant',
        calendarSourceId: 'calendar.family',
        title: 'Event 2',
        start: '2026-02-05T14:00:00.000Z',
        end: '2026-02-05T15:00:00.000Z',
        timezone: 'UTC',
      });

      const deleteCount = await calendar.deleteEventsBySourceAndCalendar('homeassistant', 'calendar.family');

      expect(deleteCount).toBe(2);

      const remaining = await calendar.getEventsBySourceAndCalendar('homeassistant', 'calendar.family');
      expect(remaining).toHaveLength(0);
    });
  });
});

describe('Calendar Sync Store', () => {
  let services: Services;
  let db: DatabaseService;

  beforeEach(async () => {
    services = new Services();
    db = createDatabaseService(services, { path: ':memory:' });
    services.set(DatabaseService, db);
    await db.migrate();
  });

  afterEach(async () => {
    await services.destroy();
  });

  it('creates and retrieves sync state', async () => {
    await syncStore.updateSyncState(db.knex, 'calendar.family', {
      lastSyncAt: '2026-02-05T10:00:00.000Z',
      lastSyncStatus: 'success',
      eventsInWindow: 10,
    });

    const state = await syncStore.getSyncState(db.knex, 'calendar.family');

    expect(state).not.toBeNull();
    expect(state?.sourceId).toBe('calendar.family');
    expect(state?.lastSyncStatus).toBe('success');
    expect(state?.eventsInWindow).toBe(10);
  });

  it('updates existing sync state', async () => {
    await syncStore.updateSyncState(db.knex, 'calendar.family', {
      lastSyncAt: '2026-02-05T10:00:00.000Z',
      lastSyncStatus: 'success',
      eventsInWindow: 10,
    });

    await syncStore.updateSyncState(db.knex, 'calendar.family', {
      lastSyncAt: '2026-02-05T11:00:00.000Z',
      lastSyncStatus: 'error',
      errorMessage: 'Connection timeout',
      eventsInWindow: 0,
    });

    const state = await syncStore.getSyncState(db.knex, 'calendar.family');

    expect(state?.lastSyncAt).toBe('2026-02-05T11:00:00.000Z');
    expect(state?.lastSyncStatus).toBe('error');
    expect(state?.errorMessage).toBe('Connection timeout');
  });

  it('deletes sync state', async () => {
    await syncStore.updateSyncState(db.knex, 'calendar.family', {
      lastSyncAt: '2026-02-05T10:00:00.000Z',
      lastSyncStatus: 'success',
      eventsInWindow: 10,
    });

    await syncStore.deleteSyncState(db.knex, 'calendar.family');

    const state = await syncStore.getSyncState(db.knex, 'calendar.family');
    expect(state).toBeNull();
  });

  it('gets all sync states', async () => {
    await syncStore.updateSyncState(db.knex, 'calendar.family', {
      lastSyncAt: '2026-02-05T10:00:00.000Z',
      lastSyncStatus: 'success',
      eventsInWindow: 5,
    });
    await syncStore.updateSyncState(db.knex, 'calendar.work', {
      lastSyncAt: '2026-02-05T10:00:00.000Z',
      lastSyncStatus: 'success',
      eventsInWindow: 3,
    });

    const states = await syncStore.getAllSyncStates(db.knex);

    expect(states).toHaveLength(2);
    expect(states.map((s) => s.sourceId).sort()).toEqual(['calendar.family', 'calendar.work']);
  });
});
