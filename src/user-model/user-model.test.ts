import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { Services } from '../services/services.ts';
import { createDatabaseService, DatabaseService } from '../database/database.ts';

import { UserModelService } from './user-model.ts';
import { getTimeOfDay, isWorkingHours } from './user-model.utils.ts';

describe('UserModelService', () => {
  let services: Services;
  let userModel: UserModelService;

  beforeEach(async () => {
    services = new Services();
    const db = createDatabaseService(services, { path: ':memory:' });
    services.set(DatabaseService, db);
    await db.migrate();
    userModel = services.get(UserModelService);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('Identity', () => {
    it('returns null when identity is not configured', async () => {
      const identity = await userModel.getIdentity();
      expect(identity).toBeNull();
    });

    it('creates an identity', async () => {
      const identity = await userModel.createIdentity({ name: 'Alice' });

      expect(identity.name).toBe('Alice');
      expect(identity.timezone).toBe('UTC');
      expect(identity.locale).toBe('en-US');
      expect(identity.workingHours).toEqual({
        start: '09:00',
        end: '17:00',
        days: [1, 2, 3, 4, 5],
      });
    });

    it('creates an identity with custom values', async () => {
      const identity = await userModel.createIdentity({
        name: 'Bob',
        timezone: 'America/New_York',
        locale: 'en-GB',
        workingHours: {
          start: '08:00',
          end: '16:00',
          days: [1, 2, 3, 4],
        },
        preferences: {
          communicationStyle: 'casual',
          verbosity: 'terse',
          proactivityLevel: 'high',
        },
      });

      expect(identity.name).toBe('Bob');
      expect(identity.timezone).toBe('America/New_York');
      expect(identity.workingHours.days).toEqual([1, 2, 3, 4]);
      expect(identity.preferences.communicationStyle).toBe('casual');
    });

    it('updates an identity', async () => {
      await userModel.createIdentity({ name: 'Alice' });

      const updated = await userModel.updateIdentity({
        name: 'Alice Smith',
        timezone: 'Europe/London',
      });

      expect(updated.name).toBe('Alice Smith');
      expect(updated.timezone).toBe('Europe/London');
      expect(updated.locale).toBe('en-US'); // unchanged
    });

    it('checks working hours correctly', async () => {
      await userModel.createIdentity({
        name: 'Alice',
        workingHours: {
          start: '09:00',
          end: '17:00',
          days: [1, 2, 3, 4, 5], // Monday-Friday
        },
      });

      // Monday at 10:00
      const mondayMorning = new Date('2024-01-15T10:00:00');
      expect(await userModel.isWorkingHours(mondayMorning)).toBe(true);

      // Monday at 20:00
      const mondayEvening = new Date('2024-01-15T20:00:00');
      expect(await userModel.isWorkingHours(mondayEvening)).toBe(false);

      // Saturday at 10:00
      const saturday = new Date('2024-01-20T10:00:00');
      expect(await userModel.isWorkingHours(saturday)).toBe(false);
    });
  });

  describe('Projects', () => {
    beforeEach(async () => {
      await userModel.createIdentity({ name: 'Alice' });
    });

    it('creates a project', async () => {
      const project = await userModel.createProject({
        name: 'GLaDOS Development',
        description: 'Build the AI assistant',
        priority: 'high',
      });

      expect(project.id).toBeDefined();
      expect(project.name).toBe('GLaDOS Development');
      expect(project.status).toBe('active');
      expect(project.priority).toBe('high');
    });

    it('gets all projects', async () => {
      await userModel.createProject({ name: 'Project 1' });
      await userModel.createProject({ name: 'Project 2' });

      const projects = await userModel.getProjects();
      expect(projects).toHaveLength(2);
    });

    it('filters projects by status', async () => {
      await userModel.createProject({ name: 'Active', status: 'active' });
      await userModel.createProject({ name: 'Paused', status: 'paused' });

      const active = await userModel.getProjects({ status: 'active' });
      expect(active).toHaveLength(1);
      expect(active[0]?.name).toBe('Active');
    });

    it('updates a project', async () => {
      const project = await userModel.createProject({ name: 'Test' });

      const updated = await userModel.updateProject(project.id, {
        name: 'Updated',
        status: 'completed',
      });

      expect(updated.name).toBe('Updated');
      expect(updated.status).toBe('completed');
    });

    it('deletes a project', async () => {
      const project = await userModel.createProject({ name: 'To Delete' });
      await userModel.deleteProject(project.id);

      const result = await userModel.getProject(project.id);
      expect(result).toBeNull();
    });
  });

  describe('Goals', () => {
    it('creates a goal', async () => {
      const goal = await userModel.createGoal({
        description: 'Learn TypeScript',
        timeframe: 'short',
      });

      expect(goal.id).toBeDefined();
      expect(goal.description).toBe('Learn TypeScript');
      expect(goal.timeframe).toBe('short');
    });

    it('gets all goals', async () => {
      await userModel.createGoal({ description: 'Goal 1', timeframe: 'short' });
      await userModel.createGoal({ description: 'Goal 2', timeframe: 'medium' });

      const goals = await userModel.getGoals();
      expect(goals).toHaveLength(2);
    });

    it('filters goals by timeframe', async () => {
      await userModel.createGoal({ description: 'Short', timeframe: 'short' });
      await userModel.createGoal({ description: 'Long', timeframe: 'long' });

      const shortGoals = await userModel.getGoals({ timeframe: 'short' });
      expect(shortGoals).toHaveLength(1);
      expect(shortGoals[0]?.description).toBe('Short');
    });

    it('updates a goal', async () => {
      const goal = await userModel.createGoal({
        description: 'Original',
        timeframe: 'short',
      });

      const updated = await userModel.updateGoal(goal.id, {
        progress: '50% complete',
      });

      expect(updated.progress).toBe('50% complete');
    });

    it('deletes a goal', async () => {
      const goal = await userModel.createGoal({
        description: 'To Delete',
        timeframe: 'short',
      });
      await userModel.deleteGoal(goal.id);

      const result = await userModel.getGoal(goal.id);
      expect(result).toBeNull();
    });
  });

  describe('Routines', () => {
    it('creates a routine', async () => {
      const routine = await userModel.createRoutine({
        name: 'Morning standup',
        schedule: '0 9 * * 1-5',
        description: 'Daily team sync',
      });

      expect(routine.id).toBeDefined();
      expect(routine.name).toBe('Morning standup');
      expect(routine.schedule).toBe('0 9 * * 1-5');
      expect(routine.enabled).toBe(true);
    });

    it('gets all routines', async () => {
      await userModel.createRoutine({ name: 'Routine 1', schedule: '0 9 * * *' });
      await userModel.createRoutine({ name: 'Routine 2', schedule: '0 17 * * *' });

      const routines = await userModel.getRoutines();
      expect(routines).toHaveLength(2);
    });

    it('filters routines by enabled status', async () => {
      await userModel.createRoutine({ name: 'Enabled', schedule: '0 9 * * *', enabled: true });
      await userModel.createRoutine({ name: 'Disabled', schedule: '0 9 * * *', enabled: false });

      const enabled = await userModel.getRoutines({ enabled: true });
      expect(enabled).toHaveLength(1);
      expect(enabled[0]?.name).toBe('Enabled');
    });

    it('updates a routine', async () => {
      const routine = await userModel.createRoutine({
        name: 'Original',
        schedule: '0 9 * * *',
      });

      const updated = await userModel.updateRoutine(routine.id, {
        enabled: false,
      });

      expect(updated.enabled).toBe(false);
    });

    it('records routine run', async () => {
      const routine = await userModel.createRoutine({
        name: 'Test',
        schedule: '0 9 * * *',
      });

      expect(routine.lastRunAt).toBeUndefined();

      await userModel.recordRoutineRun(routine.id);

      const updated = await userModel.getRoutine(routine.id);
      expect(updated?.lastRunAt).toBeDefined();
    });

    it('deletes a routine', async () => {
      const routine = await userModel.createRoutine({
        name: 'To Delete',
        schedule: '0 9 * * *',
      });
      await userModel.deleteRoutine(routine.id);

      const result = await userModel.getRoutine(routine.id);
      expect(result).toBeNull();
    });
  });
});

describe('User Model Utils', () => {
  describe('getTimeOfDay', () => {
    it('returns morning for 5-11', () => {
      expect(getTimeOfDay(new Date('2024-01-15T05:00:00'))).toBe('morning');
      expect(getTimeOfDay(new Date('2024-01-15T11:59:00'))).toBe('morning');
    });

    it('returns afternoon for 12-16', () => {
      expect(getTimeOfDay(new Date('2024-01-15T12:00:00'))).toBe('afternoon');
      expect(getTimeOfDay(new Date('2024-01-15T16:59:00'))).toBe('afternoon');
    });

    it('returns evening for 17-20', () => {
      expect(getTimeOfDay(new Date('2024-01-15T17:00:00'))).toBe('evening');
      expect(getTimeOfDay(new Date('2024-01-15T20:59:00'))).toBe('evening');
    });

    it('returns night for 21-4', () => {
      expect(getTimeOfDay(new Date('2024-01-15T21:00:00'))).toBe('night');
      expect(getTimeOfDay(new Date('2024-01-15T04:59:00'))).toBe('night');
    });
  });

  describe('isWorkingHours', () => {
    const workingHours = {
      start: '09:00',
      end: '17:00',
      days: [1, 2, 3, 4, 5], // Mon-Fri
    };

    it('returns true during working hours on working days', () => {
      // Monday at 10:00
      expect(isWorkingHours(workingHours, new Date('2024-01-15T10:00:00'))).toBe(true);
    });

    it('returns false outside working hours', () => {
      // Monday at 8:00
      expect(isWorkingHours(workingHours, new Date('2024-01-15T08:00:00'))).toBe(false);
      // Monday at 18:00
      expect(isWorkingHours(workingHours, new Date('2024-01-15T18:00:00'))).toBe(false);
    });

    it('returns false on non-working days', () => {
      // Saturday at 10:00
      expect(isWorkingHours(workingHours, new Date('2024-01-20T10:00:00'))).toBe(false);
      // Sunday at 10:00
      expect(isWorkingHours(workingHours, new Date('2024-01-21T10:00:00'))).toBe(false);
    });

    it('returns false exactly at end time', () => {
      // Monday at 17:00
      expect(isWorkingHours(workingHours, new Date('2024-01-15T17:00:00'))).toBe(false);
    });

    it('returns true exactly at start time', () => {
      // Monday at 09:00
      expect(isWorkingHours(workingHours, new Date('2024-01-15T09:00:00'))).toBe(true);
    });
  });
});
