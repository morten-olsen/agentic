import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { Services } from '../services/services.ts';
import { createDatabaseService, DatabaseService } from '../database/database.ts';
import { UserModelService } from '../user-model/user-model.ts';
import { LocationService } from '../location/location.ts';
import { CalendarService } from '../calendar/calendar.ts';

import { ContextBuilderService } from './context.ts';

describe('ContextBuilderService', () => {
  let services: Services;
  let contextBuilder: ContextBuilderService;
  let userModel: UserModelService;
  let location: LocationService;
  let calendar: CalendarService;

  beforeEach(async () => {
    services = new Services();
    const db = createDatabaseService(services, { path: ':memory:' });
    services.set(DatabaseService, db);
    await db.migrate();

    userModel = services.get(UserModelService);
    location = services.get(LocationService);
    calendar = services.get(CalendarService);
    contextBuilder = services.get(ContextBuilderService);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('buildContext', () => {
    it('returns default context when nothing is configured', async () => {
      const context = await contextBuilder.buildContext(new Date('2024-01-15T10:00:00.000Z'));

      expect(context.now).toBeDefined();
      expect(context.timezone).toBe('UTC');
      expect(context.user.name).toBe('User');
      expect(context.user.activeProjects).toHaveLength(0);
      expect(context.user.currentGoals).toHaveLength(0);
      expect(context.location.current).toBeNull();
      expect(context.calendar.currentEvent).toBeNull();
      expect(context.recentContacts).toHaveLength(0);
      expect(context.recentTopics).toHaveLength(0);
      expect(context.pendingTasks).toHaveLength(0);
    });

    it('includes user identity', async () => {
      await userModel.createIdentity({
        name: 'Alice Smith',
        timezone: 'America/New_York',
      });

      const context = await contextBuilder.buildContext();

      expect(context.user.name).toBe('Alice Smith');
      expect(context.timezone).toBe('America/New_York');
    });

    it('includes active projects', async () => {
      await userModel.createIdentity({ name: 'Alice' });
      await userModel.createProject({ name: 'Project A', status: 'active' });
      await userModel.createProject({ name: 'Project B', status: 'active' });
      await userModel.createProject({ name: 'Project C', status: 'paused' });

      const context = await contextBuilder.buildContext();

      expect(context.user.activeProjects).toHaveLength(2);
      const names = context.user.activeProjects.map((p) => p.name);
      expect(names).toContain('Project A');
      expect(names).toContain('Project B');
    });

    it('includes goals', async () => {
      await userModel.createGoal({ description: 'Learn TypeScript', timeframe: 'short' });
      await userModel.createGoal({ description: 'Get promoted', timeframe: 'long' });

      const context = await contextBuilder.buildContext();

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
      const context = await contextBuilder.buildContext(workTime);

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
      const context = await contextBuilder.buildContext(now);

      expect(context.calendar.currentEvent?.title).toBe('Current Meeting');
      expect(context.calendar.nextEvent?.title).toBe('Next Meeting');
      expect(context.calendar.minutesToNext).toBe(60);
      expect(context.calendar.todayAgenda).toContain('Current Meeting');
    });

    it('calculates time of day', async () => {
      const morning = await contextBuilder.buildContext(new Date('2024-01-15T08:00:00.000Z'));
      expect(morning.timeOfDay).toBe('morning');

      const afternoon = await contextBuilder.buildContext(new Date('2024-01-15T14:00:00.000Z'));
      expect(afternoon.timeOfDay).toBe('afternoon');

      const evening = await contextBuilder.buildContext(new Date('2024-01-15T19:00:00.000Z'));
      expect(evening.timeOfDay).toBe('evening');

      const night = await contextBuilder.buildContext(new Date('2024-01-15T23:00:00.000Z'));
      expect(night.timeOfDay).toBe('night');
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
      const working = await contextBuilder.buildContext(new Date('2024-01-15T10:00:00.000Z'));
      expect(working.isWorkingHours).toBe(true);

      // Monday at 20:00
      const notWorking = await contextBuilder.buildContext(new Date('2024-01-15T20:00:00.000Z'));
      expect(notWorking.isWorkingHours).toBe(false);
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
      const context = await contextBuilder.buildContext(now);

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
      const context = await contextBuilder.buildContext(now);

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

      // Stubs should be empty arrays
      expect(context.recentContacts).toHaveLength(0);
      expect(context.recentTopics).toHaveLength(0);
      expect(context.pendingTasks).toHaveLength(0);
    });
  });
});
