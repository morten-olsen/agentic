import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { Services } from '../services/services.ts';
import { createDatabaseService, DatabaseService } from '../database/database.ts';
import { UserModelService } from '../user-model/user-model.ts';
import { LocationService } from '../location/location.ts';
import { CalendarService } from '../calendar/calendar.ts';
import { TaskService } from '../tasks/tasks.ts';
import { ExternalServiceRegistry } from '../external/external.ts';
import type { HomeAssistantClient, HaCalendarEvent, HaPersonState } from '../external/homeassistant/index.ts';

import { ContextBuilderService } from './context.ts';

describe('ContextBuilderService', () => {
  let services: Services;
  let contextBuilder: ContextBuilderService;
  let userModel: UserModelService;
  let location: LocationService;
  let calendar: CalendarService;
  let externalServices: ExternalServiceRegistry;

  beforeEach(async () => {
    services = new Services();
    const db = createDatabaseService(services, { path: ':memory:' });
    services.set(DatabaseService, db);
    await db.migrate();

    userModel = services.get(UserModelService);
    location = services.get(LocationService);
    calendar = services.get(CalendarService);
    externalServices = services.get(ExternalServiceRegistry);
    contextBuilder = services.get(ContextBuilderService);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await services.destroy();
  });

  describe('buildContext', () => {
    it('returns default context when nothing is configured', async () => {
      const { context } = await contextBuilder.buildContext({ now: new Date('2024-01-15T10:00:00.000Z') });

      expect(context.now).toBeDefined();
      expect(context.timezone).toBe('UTC');
      expect(context.user.name).toBe('User');
      expect(context.user.activeProjects).toHaveLength(0);
      expect(context.user.currentGoals).toHaveLength(0);
      expect(context.location.current).toBeNull();
      expect(context.calendar.currentEvent).toBeNull();
      expect(context.pendingTasks).toHaveLength(0);
    });

    it('includes user identity', async () => {
      await userModel.createIdentity({
        name: 'Alice Smith',
        timezone: 'America/New_York',
      });

      const { context } = await contextBuilder.buildContext();

      expect(context.user.name).toBe('Alice Smith');
      expect(context.timezone).toBe('America/New_York');
    });

    it('includes active projects', async () => {
      await userModel.createIdentity({ name: 'Alice' });
      await userModel.createProject({ name: 'Project A', status: 'active' });
      await userModel.createProject({ name: 'Project B', status: 'active' });
      await userModel.createProject({ name: 'Project C', status: 'paused' });

      const { context } = await contextBuilder.buildContext();

      expect(context.user.activeProjects).toHaveLength(2);
      const names = context.user.activeProjects.map((p) => p.name);
      expect(names).toContain('Project A');
      expect(names).toContain('Project B');
    });

    it('includes goals', async () => {
      await userModel.createGoal({ description: 'Learn TypeScript', timeframe: 'short' });
      await userModel.createGoal({ description: 'Get promoted', timeframe: 'long' });

      const { context } = await contextBuilder.buildContext();

      expect(context.user.currentGoals).toHaveLength(2);
    });

    it('includes location context', async () => {
      await userModel.createIdentity({
        name: 'Alice',
        workingHours: {
          start: '09:00',
          end: '17:00',
          days: [1, 2, 3, 4, 5],
        },
      });
      await location.createLocation({ name: 'Home', type: 'home', isDefault: true });
      await location.createLocation({ name: 'Office', type: 'work', isDefault: true });

      // During working hours on a weekday
      const workTime = new Date('2024-01-15T10:00:00.000Z'); // Monday
      const { context } = await contextBuilder.buildContext({ now: workTime });

      expect(context.location.current).not.toBeNull();
      expect(context.location.confidence).toBe('inferred');
    });

    it('includes calendar context', async () => {
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

      const now = new Date('2024-01-15T10:30:00.000Z');
      const { context } = await contextBuilder.buildContext({ now });

      expect(context.calendar.currentEvent?.title).toBe('Current Meeting');
      expect(context.calendar.nextEvent?.title).toBe('Next Meeting');
      expect(context.calendar.minutesToNext).toBe(60);
      expect(context.calendar.todayAgenda).toContain('Current Meeting');
    });

    it('calculates time of day', async () => {
      const morning = await contextBuilder.buildContext({ now: new Date('2024-01-15T08:00:00.000Z') });
      expect(morning.context.timeOfDay).toBe('morning');

      const afternoon = await contextBuilder.buildContext({ now: new Date('2024-01-15T14:00:00.000Z') });
      expect(afternoon.context.timeOfDay).toBe('afternoon');

      const evening = await contextBuilder.buildContext({ now: new Date('2024-01-15T19:00:00.000Z') });
      expect(evening.context.timeOfDay).toBe('evening');

      const night = await contextBuilder.buildContext({ now: new Date('2024-01-15T23:00:00.000Z') });
      expect(night.context.timeOfDay).toBe('night');
    });

    it('calculates working hours', async () => {
      await userModel.createIdentity({
        name: 'Alice',
        workingHours: {
          start: '09:00',
          end: '17:00',
          days: [1, 2, 3, 4, 5], // Monday-Friday
        },
      });

      // Monday at 10:00
      const working = await contextBuilder.buildContext({ now: new Date('2024-01-15T10:00:00.000Z') });
      expect(working.context.isWorkingHours).toBe(true);

      // Monday at 20:00
      const notWorking = await contextBuilder.buildContext({ now: new Date('2024-01-15T20:00:00.000Z') });
      expect(notWorking.context.isWorkingHours).toBe(false);
    });

    it('calculates shouldLeaveBy for next event with travel time', async () => {
      await calendar.createEvent({
        title: 'Meeting with travel',
        start: '2024-01-15T14:00:00.000Z',
        end: '2024-01-15T15:00:00.000Z',
        timezone: 'UTC',
        travelTime: 30, // 30 minutes travel time
      });

      const now = new Date('2024-01-15T12:00:00.000Z');
      const { context } = await contextBuilder.buildContext({ now });

      expect(context.calendar.nextEvent?.title).toBe('Meeting with travel');
      expect(context.calendar.travelTimeToNext).toBe(30);
      expect(context.calendar.shouldLeaveBy).toBe('2024-01-15T13:30:00.000Z');
    });
  });

  describe('getCalendarContext', () => {
    it('returns just calendar context', async () => {
      await calendar.createEvent({
        title: 'Test Event',
        start: '2024-01-15T10:00:00.000Z',
        end: '2024-01-15T11:00:00.000Z',
        timezone: 'UTC',
      });

      const now = new Date('2024-01-15T10:30:00.000Z');
      const calendarContext = await contextBuilder.getCalendarContext(now);

      expect(calendarContext.currentEvent?.title).toBe('Test Event');
      expect(calendarContext.todayAgenda).toContain('Test Event');
    });
  });

  describe('Integration - Full Context Assembly', () => {
    it('assembles complete context from all services', async () => {
      // Set up user
      await userModel.createIdentity({
        name: 'Alice Developer',
        timezone: 'America/New_York',
        workingHours: {
          start: '09:00',
          end: '17:00',
          days: [1, 2, 3, 4, 5],
        },
        preferences: {
          communicationStyle: 'casual',
          verbosity: 'balanced',
          proactivityLevel: 'high',
        },
      });

      // Set up projects
      await userModel.createProject({
        name: 'GLaDOS Development',
        description: 'Building the AI assistant',
        priority: 'high',
        status: 'active',
      });

      // Set up goals
      await userModel.createGoal({
        description: 'Complete Phase 1 implementation',
        timeframe: 'short',
      });

      // Set up locations
      await location.createLocation({
        name: 'Home Office',
        type: 'home',
        isDefault: true,
      });
      await location.createLocation({
        name: 'Downtown Office',
        type: 'work',
        isDefault: true,
      });

      // Set up calendar (times in UTC)
      // Standup at 09:30 AM EST = 14:30 UTC (just before the test time of 10 AM EST / 15:00 UTC)
      await calendar.createEvent({
        title: 'Standup',
        start: '2024-01-15T14:30:00.000Z',
        end: '2024-01-15T14:45:00.000Z',
        timezone: 'America/New_York',
      });
      // 1:1 at 2 PM EST = 19:00 UTC
      await calendar.createEvent({
        title: '1:1 with Manager',
        start: '2024-01-15T19:00:00.000Z',
        end: '2024-01-15T19:30:00.000Z',
        timezone: 'America/New_York',
        requiresPrep: true,
        prepNotes: 'Discuss project timeline',
      });

      // Build context at 10am EST (15:00 UTC) on Monday January 15, 2024
      // (America/New_York is UTC-5 in January)
      const now = new Date('2024-01-15T15:00:00.000Z');
      const { context } = await contextBuilder.buildContext({ now });

      // Verify all pieces are assembled
      expect(context.user.name).toBe('Alice Developer');
      expect(context.timezone).toBe('America/New_York');
      expect(context.timeOfDay).toBe('morning');
      expect(context.isWorkingHours).toBe(true);

      expect(context.user.activeProjects).toHaveLength(1);
      expect(context.user.activeProjects[0]?.name).toBe('GLaDOS Development');

      expect(context.user.currentGoals).toHaveLength(1);

      expect(context.location.confidence).toBe('inferred');

      expect(context.calendar.nextEvent?.title).toBe('1:1 with Manager');
      expect(context.calendar.todayAgenda).toContain('Standup');
      expect(context.calendar.todayAgenda).toContain('1:1 with Manager');

      // Pending tasks should be empty (none created in test)
      expect(context.pendingTasks).toHaveLength(0);
    });
  });

  describe('Home Assistant Calendar Sync', () => {
    // Calendar events from Home Assistant are synced to the database by CalendarSyncService.
    // The context builder reads from the unified calendar table.

    it('includes synced HA calendar events in agenda', async () => {
      // Create events that would have been synced from HA
      await calendar.createEvent({
        title: 'HA Meeting',
        source: 'homeassistant',
        calendarSourceId: 'calendar.test',
        start: '2024-01-15T14:00:00.000Z',
        end: '2024-01-15T15:00:00.000Z',
        timezone: 'UTC',
      });
      await calendar.createEvent({
        title: 'HA All Day Event',
        source: 'homeassistant',
        calendarSourceId: 'calendar.test',
        start: '2024-01-15T00:00:00.000Z',
        end: '2024-01-16T00:00:00.000Z',
        allDay: true,
        timezone: 'UTC',
      });

      const now = new Date('2024-01-15T10:00:00.000Z');
      const { context } = await contextBuilder.buildContext({ now });

      expect(context.calendar.todayAgenda).toContain('HA Meeting');
      expect(context.calendar.todayAgenda).toContain('HA All Day Event');
    });

    it('returns empty agenda when no events exist', async () => {
      const now = new Date('2024-01-15T10:00:00.000Z');
      const { context } = await contextBuilder.buildContext({ now });

      expect(context.calendar.todayAgenda).toBe('No events scheduled for today.');
    });

    it('shows both local and synced HA events in agenda', async () => {
      // Create a local event
      await calendar.createEvent({
        title: 'Local Meeting',
        source: 'local',
        start: '2024-01-15T10:00:00.000Z',
        end: '2024-01-15T11:00:00.000Z',
        timezone: 'UTC',
      });

      // Create a synced HA event
      await calendar.createEvent({
        title: 'HA Team Sync',
        source: 'homeassistant',
        calendarSourceId: 'calendar.work',
        start: '2024-01-15T14:00:00.000Z',
        end: '2024-01-15T15:00:00.000Z',
        timezone: 'UTC',
      });

      const now = new Date('2024-01-15T09:00:00.000Z');
      const { context } = await contextBuilder.buildContext({ now });

      // Should have both local and HA events
      expect(context.calendar.todayAgenda).toContain('Local Meeting');
      expect(context.calendar.todayAgenda).toContain('HA Team Sync');
    });
  });

  describe('Home Assistant Location Tracking', () => {
    const createMockHaClientWithLocation = (
      personLocation: HaPersonState | null,
      calendarEvents: HaCalendarEvent[] = [],
    ): HomeAssistantClient => ({
      connection: {} as HomeAssistantClient['connection'],
      getConfig: vi.fn(),
      getCalendarEvents: vi.fn().mockResolvedValue(calendarEvents),
      getPersonLocation: vi.fn().mockReturnValue(personLocation),
      disconnect: vi.fn(),
    });

    it('includes HA person location with GPS coordinates', async () => {
      const mockPersonState: HaPersonState = {
        entity_id: 'person.alice',
        state: 'home',
        attributes: {
          latitude: 55.842970845,
          longitude: 12.425845855,
          gps_accuracy: 31,
          source: 'device_tracker.pixel_9',
          friendly_name: 'Alice',
        },
        last_updated: '2024-01-15T10:30:00Z',
        last_changed: '2024-01-15T08:15:00Z',
      };

      externalServices.register({
        id: 'homeassistant',
        name: 'Home Assistant',
        description: 'Test HA service',
        isConfigured: () => true,
        createClient: async () => createMockHaClientWithLocation(mockPersonState),
      });

      // Mock config with person entity
      vi.mock('../config/config.ts', async (importOriginal) => {
        const original = await importOriginal<typeof import('../config/config.ts')>();
        return {
          ...original,
          getConfig: () => ({
            ...original.getConfig(),
            homeassistant: {
              url: 'http://localhost:8123',
              token: 'test-token',
              calendarEntities: [],
              personEntity: 'person.alice',
            },
          }),
        };
      });

      const { ContextBuilderService: FreshContextBuilder } = await import('./context.ts');
      const freshBuilder = new FreshContextBuilder(services);

      const now = new Date('2024-01-15T10:00:00.000Z');
      const { context } = await freshBuilder.buildContext({ now });

      // Should have HA location data
      expect(context.location.atHome).toBe(true);
      expect(context.location.confidence).toBe('exact');
      expect(context.location.coordinates).toEqual({
        latitude: 55.842970845,
        longitude: 12.425845855,
        accuracy: 31,
      });
      expect(context.location.lastLocationChange).toBe('2024-01-15T08:15:00Z');
      expect(context.location.locationSource).toBe('device_tracker.pixel_9');
    });

    it('detects not_home state as traveling', async () => {
      const mockPersonState: HaPersonState = {
        entity_id: 'person.alice',
        state: 'not_home',
        attributes: {
          latitude: 55.5,
          longitude: 12.3,
          gps_accuracy: 50,
          source: 'device_tracker.phone',
          friendly_name: 'Alice',
        },
        last_updated: '2024-01-15T10:30:00Z',
        last_changed: '2024-01-15T09:00:00Z',
      };

      externalServices.register({
        id: 'homeassistant',
        name: 'Home Assistant',
        description: 'Test HA service',
        isConfigured: () => true,
        createClient: async () => createMockHaClientWithLocation(mockPersonState),
      });

      vi.mock('../config/config.ts', async (importOriginal) => {
        const original = await importOriginal<typeof import('../config/config.ts')>();
        return {
          ...original,
          getConfig: () => ({
            ...original.getConfig(),
            homeassistant: {
              url: 'http://localhost:8123',
              token: 'test-token',
              calendarEntities: [],
              personEntity: 'person.alice',
            },
          }),
        };
      });

      const { ContextBuilderService: FreshContextBuilder } = await import('./context.ts');
      const freshBuilder = new FreshContextBuilder(services);

      const { context } = await freshBuilder.buildContext({ now: new Date('2024-01-15T10:00:00.000Z') });

      expect(context.location.atHome).toBe(false);
      expect(context.location.traveling).toBe(true);
    });

    it('detects work zone state', async () => {
      const mockPersonState: HaPersonState = {
        entity_id: 'person.alice',
        state: 'work',
        attributes: {
          latitude: 55.6,
          longitude: 12.4,
          gps_accuracy: 20,
          source: 'device_tracker.phone',
          friendly_name: 'Alice',
        },
        last_updated: '2024-01-15T10:30:00Z',
        last_changed: '2024-01-15T08:00:00Z',
      };

      externalServices.register({
        id: 'homeassistant',
        name: 'Home Assistant',
        description: 'Test HA service',
        isConfigured: () => true,
        createClient: async () => createMockHaClientWithLocation(mockPersonState),
      });

      vi.mock('../config/config.ts', async (importOriginal) => {
        const original = await importOriginal<typeof import('../config/config.ts')>();
        return {
          ...original,
          getConfig: () => ({
            ...original.getConfig(),
            homeassistant: {
              url: 'http://localhost:8123',
              token: 'test-token',
              calendarEntities: [],
              personEntity: 'person.alice',
            },
          }),
        };
      });

      const { ContextBuilderService: FreshContextBuilder } = await import('./context.ts');
      const freshBuilder = new FreshContextBuilder(services);

      const { context } = await freshBuilder.buildContext({ now: new Date('2024-01-15T10:00:00.000Z') });

      expect(context.location.atHome).toBe(false);
      expect(context.location.atWork).toBe(true);
      expect(context.location.traveling).toBe(false);
    });

    it('gracefully handles no person entity configured', async () => {
      externalServices.register({
        id: 'homeassistant',
        name: 'Home Assistant',
        description: 'Test HA service',
        isConfigured: () => true,
        createClient: async () => createMockHaClientWithLocation(null),
      });

      vi.mock('../config/config.ts', async (importOriginal) => {
        const original = await importOriginal<typeof import('../config/config.ts')>();
        return {
          ...original,
          getConfig: () => ({
            ...original.getConfig(),
            homeassistant: {
              url: 'http://localhost:8123',
              token: 'test-token',
              calendarEntities: [],
              personEntity: '', // Not configured
            },
          }),
        };
      });

      const { ContextBuilderService: FreshContextBuilder } = await import('./context.ts');
      const freshBuilder = new FreshContextBuilder(services);

      const { context } = await freshBuilder.buildContext({ now: new Date('2024-01-15T10:00:00.000Z') });

      // Should fall back to inferred location (no GPS data)
      expect(context.location.coordinates).toBeUndefined();
      expect(context.location.lastLocationChange).toBeUndefined();
      expect(context.location.locationSource).toBeUndefined();
    });

    it('gracefully handles HA client errors for person location', async () => {
      externalServices.register({
        id: 'homeassistant',
        name: 'Home Assistant',
        description: 'Test HA service',
        isConfigured: () => true,
        createClient: async () => {
          throw new Error('HA connection failed');
        },
      });

      vi.mock('../config/config.ts', async (importOriginal) => {
        const original = await importOriginal<typeof import('../config/config.ts')>();
        return {
          ...original,
          getConfig: () => ({
            ...original.getConfig(),
            homeassistant: {
              url: 'http://localhost:8123',
              token: 'test-token',
              calendarEntities: [],
              personEntity: 'person.alice',
            },
          }),
        };
      });

      const { ContextBuilderService: FreshContextBuilder } = await import('./context.ts');
      const freshBuilder = new FreshContextBuilder(services);

      // Should not throw, falls back to inferred location
      const { context } = await freshBuilder.buildContext({ now: new Date('2024-01-15T10:00:00.000Z') });

      expect(context.location.coordinates).toBeUndefined();
      expect(context.location.confidence).toBe('inferred');
    });

    it('handles person state without GPS coordinates', async () => {
      const mockPersonState: HaPersonState = {
        entity_id: 'person.alice',
        state: 'home',
        attributes: {
          // No GPS coordinates
          friendly_name: 'Alice',
        },
        last_updated: '2024-01-15T10:30:00Z',
        last_changed: '2024-01-15T08:15:00Z',
      };

      externalServices.register({
        id: 'homeassistant',
        name: 'Home Assistant',
        description: 'Test HA service',
        isConfigured: () => true,
        createClient: async () => createMockHaClientWithLocation(mockPersonState),
      });

      vi.mock('../config/config.ts', async (importOriginal) => {
        const original = await importOriginal<typeof import('../config/config.ts')>();
        return {
          ...original,
          getConfig: () => ({
            ...original.getConfig(),
            homeassistant: {
              url: 'http://localhost:8123',
              token: 'test-token',
              calendarEntities: [],
              personEntity: 'person.alice',
            },
          }),
        };
      });

      const { ContextBuilderService: FreshContextBuilder } = await import('./context.ts');
      const freshBuilder = new FreshContextBuilder(services);

      const { context } = await freshBuilder.buildContext({ now: new Date('2024-01-15T10:00:00.000Z') });

      // Should still detect home state but without coordinates
      expect(context.location.atHome).toBe(true);
      expect(context.location.coordinates).toBeUndefined();
      // Confidence stays inferred since no GPS
      expect(context.location.confidence).toBe('inferred');
      // But staleness info is still available
      expect(context.location.lastLocationChange).toBe('2024-01-15T08:15:00Z');
    });
  });

  describe('Context Change Detection', () => {
    it('returns null delta on first build for a conversation', async () => {
      const now = new Date('2024-01-15T10:00:00.000Z');
      const result = await contextBuilder.buildContext({
        conversationId: 'conv-1',
        now,
      });

      expect(result.context).toBeDefined();
      expect(result.delta).toBeNull();
      expect(result.snapshotId).toContain('conv-1');
    });

    it('returns delta with no changes on second build with same data', async () => {
      // Set up some stable context so we have something to compare
      // Clear cache first to ensure isolation
      contextBuilder.clearCache();

      await userModel.createIdentity({
        name: 'Alice',
        timezone: 'UTC',
      });

      const now1 = new Date('2024-01-15T10:00:00.000Z');
      const now2 = new Date('2024-01-15T10:05:00.000Z');

      // First build
      await contextBuilder.buildContext({
        conversationId: 'conv-no-change',
        now: now1,
      });

      // Second build with same data - should detect no changes
      const result = await contextBuilder.buildContext({
        conversationId: 'conv-no-change',
        now: now2,
      });

      expect(result.delta).not.toBeNull();
      expect(result.delta?.hasSignificantChanges).toBe(false);
      expect(result.delta?.timeSinceLastSnapshot).toBe(5); // 5 minutes
      expect(result.delta?.changeSummary).toHaveLength(0);
    });

    it('detects new calendar events', async () => {
      const now1 = new Date('2024-01-15T10:00:00.000Z');
      const now2 = new Date('2024-01-15T10:30:00.000Z');

      // First build with no events
      await contextBuilder.buildContext({
        conversationId: 'conv-cal',
        now: now1,
      });

      // Add an event
      await calendar.createEvent({
        title: 'New Meeting',
        start: '2024-01-15T11:00:00.000Z',
        end: '2024-01-15T12:00:00.000Z',
        timezone: 'UTC',
      });

      // Second build should detect new event
      const result = await contextBuilder.buildContext({
        conversationId: 'conv-cal',
        now: now2,
      });

      expect(result.delta?.hasSignificantChanges).toBe(true);
      expect(result.delta?.calendar.newEvents).toHaveLength(1);
      expect(result.delta?.calendar.newEvents[0]?.title).toBe('New Meeting');
      expect(result.delta?.changeSummary).toContain('1 new calendar event(s)');
    });

    it('detects cancelled calendar events', async () => {
      // Create an event first
      const event = await calendar.createEvent({
        title: 'Will Be Cancelled',
        start: '2024-01-15T14:00:00.000Z',
        end: '2024-01-15T15:00:00.000Z',
        timezone: 'UTC',
      });

      const now1 = new Date('2024-01-15T10:00:00.000Z');
      const now2 = new Date('2024-01-15T10:30:00.000Z');

      // First build with the event
      await contextBuilder.buildContext({
        conversationId: 'conv-cal-cancel',
        now: now1,
      });

      // Delete the event
      await calendar.deleteEvent(event.id);

      // Second build should detect cancelled event
      const result = await contextBuilder.buildContext({
        conversationId: 'conv-cal-cancel',
        now: now2,
      });

      expect(result.delta?.hasSignificantChanges).toBe(true);
      expect(result.delta?.calendar.cancelledEvents).toHaveLength(1);
      expect(result.delta?.calendar.cancelledEvents[0]?.title).toBe('Will Be Cancelled');
      expect(result.delta?.changeSummary).toContain('1 cancelled event(s)');
    });

    it('detects new tasks', async () => {
      const taskService = services.get(TaskService);
      const now1 = new Date('2024-01-15T10:00:00.000Z');
      const now2 = new Date('2024-01-15T10:30:00.000Z');

      // First build with no tasks
      await contextBuilder.buildContext({
        conversationId: 'conv-task',
        now: now1,
      });

      // Add a task
      await taskService.createUserTask({
        description: 'New task to do',
        trigger: { type: 'opportunistic', priority: 5 },
      });

      // Second build should detect new task
      const result = await contextBuilder.buildContext({
        conversationId: 'conv-task',
        now: now2,
      });

      expect(result.delta?.hasSignificantChanges).toBe(true);
      expect(result.delta?.tasks.newTasks).toHaveLength(1);
      expect(result.delta?.tasks.newTasks[0]?.description).toBe('New task to do');
      expect(result.delta?.tasks.taskCountDelta).toBe(1);
      expect(result.delta?.changeSummary).toContain('1 new task(s)');
    });

    it('detects completed tasks', async () => {
      const taskService = services.get(TaskService);

      // Create a task first
      const task = await taskService.createUserTask({
        description: 'Task to complete',
        trigger: { type: 'opportunistic', priority: 5 },
      });

      const now1 = new Date('2024-01-15T10:00:00.000Z');
      const now2 = new Date('2024-01-15T10:30:00.000Z');

      // First build with the task
      await contextBuilder.buildContext({
        conversationId: 'conv-task-complete',
        now: now1,
      });

      // Complete the task
      await taskService.updateUserTask(task.id, { status: 'completed' });

      // Second build should detect completed task
      const result = await contextBuilder.buildContext({
        conversationId: 'conv-task-complete',
        now: now2,
      });

      expect(result.delta?.hasSignificantChanges).toBe(true);
      expect(result.delta?.tasks.completedTasks).toHaveLength(1);
      expect(result.delta?.tasks.completedTasks[0]?.description).toBe('Task to complete');
      expect(result.delta?.tasks.taskCountDelta).toBe(-1);
      expect(result.delta?.changeSummary).toContain('1 completed task(s)');
    });

    it('tracks location state changes in delta', async () => {
      // Clear cache to ensure test isolation
      contextBuilder.clearCache();

      // First build - no location set up, location state is 'unknown'
      const now1 = new Date('2024-01-15T10:00:00.000Z');
      const result1 = await contextBuilder.buildContext({
        conversationId: 'conv-loc-simple',
        now: now1,
      });
      expect(result1.delta).toBeNull(); // First build has no delta

      // Location delta structure should be tracked
      // Note: Full location change detection requires HA integration or explicit location updates
      // This test verifies the delta structure is populated correctly
      const now2 = new Date('2024-01-15T10:30:00.000Z');
      const result2 = await contextBuilder.buildContext({
        conversationId: 'conv-loc-simple',
        now: now2,
      });

      expect(result2.delta).not.toBeNull();
      expect(result2.delta?.location).toBeDefined();
      expect(result2.delta?.location.previousLocation).toBe('unknown');
      expect(result2.delta?.location.currentLocation).toBe('unknown');
      // No change since both are unknown
      expect(result2.delta?.location.changed).toBe(false);
    });

    it('delta structure includes day plan fields', async () => {
      // Clear cache to ensure test isolation
      contextBuilder.clearCache();

      // First build - no day plan
      const now1 = new Date('2024-01-15T10:00:00.000Z');
      await contextBuilder.buildContext({
        conversationId: 'conv-dayplan-simple',
        now: now1,
      });

      // Second build - still no day plan, but delta structure should be populated
      const now2 = new Date('2024-01-15T10:30:00.000Z');
      const result = await contextBuilder.buildContext({
        conversationId: 'conv-dayplan-simple',
        now: now2,
      });

      expect(result.delta).not.toBeNull();
      expect(result.delta?.dayPlan).toBeDefined();
      expect(result.delta?.dayPlan.isNewDay).toBe(false);
      expect(result.delta?.dayPlan.newPriorities).toEqual([]);
      expect(result.delta?.dayPlan.completedPriorities).toEqual([]);
      expect(result.delta?.dayPlan.priorityProgressDelta).toBe(0);
    });

    it('expires cache entries after TTL', async () => {
      const now1 = new Date('2024-01-15T10:00:00.000Z');

      // First build
      await contextBuilder.buildContext({
        conversationId: 'conv-ttl',
        now: now1,
      });

      // Second build after 25 hours (default TTL is 24 hours)
      const now2 = new Date(now1.getTime() + 25 * 60 * 60 * 1000);
      const result = await contextBuilder.buildContext({
        conversationId: 'conv-ttl',
        now: now2,
      });

      // Should be treated as first build (no delta) due to TTL expiration
      expect(result.delta).toBeNull();
    });

    it('evicts oldest entries when cache is full (LRU)', async () => {
      const now = new Date('2024-01-15T10:00:00.000Z');

      // Fill cache beyond max (default 100)
      for (let i = 0; i < 105; i++) {
        await contextBuilder.buildContext({
          conversationId: `conv-lru-${i}`,
          now,
        });
      }

      // Cache should have been evicted to stay at max
      expect(contextBuilder.getCacheSize()).toBeLessThanOrEqual(100);

      // First entries should have been evicted
      // Build again for conv-lru-0 - should get null delta since it was evicted
      const result = await contextBuilder.buildContext({
        conversationId: 'conv-lru-0',
        now: new Date(now.getTime() + 1000),
      });
      expect(result.delta).toBeNull();
    });

    it('maintains cross-conversation isolation', async () => {
      const now1 = new Date('2024-01-15T10:00:00.000Z');
      const now2 = new Date('2024-01-15T10:30:00.000Z');

      // Build for conversation A
      await contextBuilder.buildContext({
        conversationId: 'conv-A',
        now: now1,
      });

      // Build for conversation B (first time)
      const resultB = await contextBuilder.buildContext({
        conversationId: 'conv-B',
        now: now2,
      });

      // Conversation B should have null delta (first build for this conversation)
      expect(resultB.delta).toBeNull();

      // Build again for conversation A
      const resultA = await contextBuilder.buildContext({
        conversationId: 'conv-A',
        now: now2,
      });

      // Conversation A should have delta (second build)
      expect(resultA.delta).not.toBeNull();
      expect(resultA.delta?.timeSinceLastSnapshot).toBe(30);
    });

    it('clears cache correctly', async () => {
      const now = new Date('2024-01-15T10:00:00.000Z');

      // Build to populate cache
      await contextBuilder.buildContext({
        conversationId: 'conv-clear',
        now,
      });

      expect(contextBuilder.getCacheSize()).toBeGreaterThan(0);

      // Clear cache
      contextBuilder.clearCache();

      expect(contextBuilder.getCacheSize()).toBe(0);

      // Next build should have null delta
      const result = await contextBuilder.buildContext({
        conversationId: 'conv-clear',
        now: new Date(now.getTime() + 1000),
      });
      expect(result.delta).toBeNull();
    });
  });
});
