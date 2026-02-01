import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

import { Services } from '../services/services.ts';
import { DatabaseService, createDatabaseService } from '../database/database.ts';
import { UserModelService } from '../user-model/user-model.ts';
import { CalendarService } from '../calendar/calendar.ts';
import { TaskService } from '../tasks/tasks.ts';

import {
  ProactiveScheduler,
  CheckNotFoundError,
  CheckAlreadyExistsError,
  InvalidCronExpressionError,
  SchedulerAlreadyRunningError,
  parseCron,
  matchesCron,
  shouldRunCheck,
} from './proactive.ts';
import type { ProactiveCheck, ProactiveResult } from './proactive.ts';

// ============================================================================
// Test Setup
// ============================================================================

const createTestServices = async (): Promise<Services> => {
  const services = new Services();
  const db = createDatabaseService(services, { path: ':memory:' });
  services.set(DatabaseService, db);
  await db.migrate();

  // Initialize required services for builtin checks
  services.get(UserModelService);
  services.get(CalendarService);
  services.get(TaskService);

  return services;
};

// ============================================================================
// Cron Parsing Tests
// ============================================================================

describe('Cron Parsing', () => {
  describe('parseCron', () => {
    it('parses standard cron expression', () => {
      const fields = parseCron('0 9 * * *');

      expect(fields.minute).toEqual([0]);
      expect(fields.hour).toEqual([9]);
      expect(fields.dayOfMonth).toHaveLength(31);
      expect(fields.month).toHaveLength(12);
      expect(fields.dayOfWeek).toHaveLength(7);
    });

    it('parses ranges', () => {
      const fields = parseCron('0 9 * * 1-5');

      expect(fields.dayOfWeek).toEqual([1, 2, 3, 4, 5]);
    });

    it('parses step values', () => {
      const fields = parseCron('*/15 * * * *');

      expect(fields.minute).toEqual([0, 15, 30, 45]);
    });

    it('parses comma-separated values', () => {
      const fields = parseCron('0 8,12,18 * * *');

      expect(fields.hour).toEqual([8, 12, 18]);
    });

    it('throws InvalidCronExpressionError for invalid expressions', () => {
      expect(() => parseCron('invalid')).toThrow(InvalidCronExpressionError);
      expect(() => parseCron('0 9 * *')).toThrow(InvalidCronExpressionError);
      expect(() => parseCron('0 9 * * * *')).toThrow(InvalidCronExpressionError);
    });
  });

  describe('matchesCron', () => {
    it('matches exact time', () => {
      const date = new Date('2024-03-15T09:00:00');
      expect(matchesCron('0 9 * * *', date)).toBe(true);
    });

    it('does not match wrong time', () => {
      const date = new Date('2024-03-15T10:00:00');
      expect(matchesCron('0 9 * * *', date)).toBe(false);
    });

    it('matches weekday restriction', () => {
      // March 15, 2024 is a Friday (day 5)
      const friday = new Date('2024-03-15T09:00:00');
      expect(matchesCron('0 9 * * 5', friday)).toBe(true);
      expect(matchesCron('0 9 * * 1', friday)).toBe(false);
    });

    it('handles invalid expressions gracefully', () => {
      const date = new Date();
      expect(matchesCron('invalid', date)).toBe(false);
    });
  });

  describe('shouldRunCheck', () => {
    it('returns false for disabled check', () => {
      const check: ProactiveCheck = {
        id: 'test',
        name: 'test',
        description: 'Test',
        schedule: '0 9 * * *',
        checkType: 'custom',
        enabled: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const date = new Date('2024-03-15T09:00:00');
      expect(shouldRunCheck(check, date)).toBe(false);
    });

    it('returns true for first run when time matches', () => {
      const check: ProactiveCheck = {
        id: 'test',
        name: 'test',
        description: 'Test',
        schedule: '0 9 * * *',
        checkType: 'custom',
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const date = new Date('2024-03-15T09:00:00');
      expect(shouldRunCheck(check, date)).toBe(true);
    });

    it('returns false if already run in current minute', () => {
      const now = new Date('2024-03-15T09:00:30');
      const check: ProactiveCheck = {
        id: 'test',
        name: 'test',
        description: 'Test',
        schedule: '0 9 * * *',
        checkType: 'custom',
        enabled: true,
        lastRunAt: new Date('2024-03-15T09:00:10').toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      expect(shouldRunCheck(check, now)).toBe(false);
    });

    it('returns true if last run was in previous minute', () => {
      const now = new Date('2024-03-15T09:00:30');
      const check: ProactiveCheck = {
        id: 'test',
        name: 'test',
        description: 'Test',
        schedule: '* 9 * * *', // Every minute at 9am
        checkType: 'custom',
        enabled: true,
        lastRunAt: new Date('2024-03-15T08:59:30').toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      expect(shouldRunCheck(check, now)).toBe(true);
    });
  });
});

// ============================================================================
// ProactiveScheduler Tests
// ============================================================================

describe('ProactiveScheduler', () => {
  let services: Services;
  let scheduler: ProactiveScheduler;

  beforeEach(async () => {
    services = await createTestServices();
    scheduler = new ProactiveScheduler(services);
  });

  afterEach(async () => {
    if (scheduler.isRunning) {
      scheduler.stop();
    }
    await services.destroy();
  });

  describe('Check Operations', () => {
    it('creates a check', async () => {
      const check = await scheduler.createCheck({
        name: 'test-check',
        description: 'A test check',
        schedule: '0 9 * * *',
      });

      expect(check.id).toBeDefined();
      expect(check.name).toBe('test-check');
      expect(check.description).toBe('A test check');
      expect(check.schedule).toBe('0 9 * * *');
      expect(check.enabled).toBe(true);
      expect(check.checkType).toBe('custom');
    });

    it('throws CheckAlreadyExistsError for duplicate name', async () => {
      await scheduler.createCheck({
        name: 'test-check',
        description: 'First check',
        schedule: '0 9 * * *',
      });

      await expect(
        scheduler.createCheck({
          name: 'test-check',
          description: 'Duplicate',
          schedule: '0 10 * * *',
        }),
      ).rejects.toThrow(CheckAlreadyExistsError);
    });

    it('throws InvalidCronExpressionError for invalid schedule', async () => {
      await expect(
        scheduler.createCheck({
          name: 'bad-check',
          description: 'Bad schedule',
          schedule: 'invalid',
        }),
      ).rejects.toThrow(InvalidCronExpressionError);
    });

    it('gets a check by ID', async () => {
      const created = await scheduler.createCheck({
        name: 'test-check',
        description: 'Test',
        schedule: '0 9 * * *',
      });

      const retrieved = await scheduler.getCheck(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('test-check');
    });

    it('returns null for non-existent check', async () => {
      const check = await scheduler.getCheck('non-existent');
      expect(check).toBeNull();
    });

    it('gets a check by name', async () => {
      await scheduler.createCheck({
        name: 'test-check',
        description: 'Test',
        schedule: '0 9 * * *',
      });

      const check = await scheduler.getCheckByName('test-check');
      expect(check).not.toBeNull();
      expect(check?.name).toBe('test-check');
    });

    it('throws CheckNotFoundError for requireCheck with non-existent ID', async () => {
      await expect(scheduler.requireCheck('non-existent')).rejects.toThrow(CheckNotFoundError);
    });

    it('updates a check', async () => {
      const check = await scheduler.createCheck({
        name: 'test-check',
        description: 'Original',
        schedule: '0 9 * * *',
      });

      const updated = await scheduler.updateCheck(check.id, {
        description: 'Updated',
        schedule: '0 10 * * *',
      });

      expect(updated.description).toBe('Updated');
      expect(updated.schedule).toBe('0 10 * * *');
    });

    it('throws InvalidCronExpressionError when updating with invalid schedule', async () => {
      const check = await scheduler.createCheck({
        name: 'test-check',
        description: 'Test',
        schedule: '0 9 * * *',
      });

      await expect(scheduler.updateCheck(check.id, { schedule: 'invalid' })).rejects.toThrow(
        InvalidCronExpressionError,
      );
    });

    it('deletes a check', async () => {
      const check = await scheduler.createCheck({
        name: 'test-check',
        description: 'Test',
        schedule: '0 9 * * *',
      });

      const deleted = await scheduler.deleteCheck(check.id);
      expect(deleted).toBe(true);

      const retrieved = await scheduler.getCheck(check.id);
      expect(retrieved).toBeNull();
    });

    it('lists checks', async () => {
      await scheduler.createCheck({ name: 'check-1', description: 'C1', schedule: '0 9 * * *' });
      await scheduler.createCheck({ name: 'check-2', description: 'C2', schedule: '0 10 * * *', enabled: false });

      const all = await scheduler.listChecks();
      expect(all.length).toBeGreaterThanOrEqual(2);

      const enabled = await scheduler.listChecks({ enabled: true });
      expect(enabled.some((c) => c.name === 'check-1')).toBe(true);
      expect(enabled.every((c) => c.enabled)).toBe(true);
    });

    it('enables and disables a check', async () => {
      const check = await scheduler.createCheck({
        name: 'test-check',
        description: 'Test',
        schedule: '0 9 * * *',
      });

      const disabled = await scheduler.disableCheck(check.id);
      expect(disabled.enabled).toBe(false);

      const enabled = await scheduler.enableCheck(check.id);
      expect(enabled.enabled).toBe(true);
    });
  });

  describe('Executor Registration', () => {
    it('registers and executes custom executor', async () => {
      const executorMock = vi.fn().mockResolvedValue({
        finding: 'Test finding',
        urgency: 'low',
        suggestedAction: { type: 'notify', content: 'Test content' },
        shouldNotify: false,
      } satisfies ProactiveResult);

      const check = await scheduler.createCheck({
        name: 'custom-check',
        description: 'Custom',
        schedule: '0 9 * * *',
      });

      scheduler.registerExecutor('custom-check', executorMock);

      const run = await scheduler.runCheck(check.id);

      expect(executorMock).toHaveBeenCalledWith({
        checkId: check.id,
        config: {},
      });
      expect(run.status).toBe('completed');
      expect(run.result?.finding).toBe('Test finding');
    });

    it('unregisters executor', async () => {
      const executor = vi.fn();
      scheduler.registerExecutor('test', executor);
      scheduler.unregisterExecutor('test');

      const check = await scheduler.createCheck({
        name: 'test',
        description: 'Test',
        schedule: '0 9 * * *',
      });

      // Should skip because no executor
      const run = await scheduler.runCheck(check.id);
      expect(run.status).toBe('skipped');
      expect(executor).not.toHaveBeenCalled();
    });
  });

  describe('Run Operations', () => {
    it('creates and retrieves a run', async () => {
      const check = await scheduler.createCheck({
        name: 'test-check',
        description: 'Test',
        schedule: '0 9 * * *',
      });

      scheduler.registerExecutor('test-check', async () => ({
        finding: 'Test',
        urgency: 'low',
        suggestedAction: { type: 'notify', content: 'Test' },
        shouldNotify: false,
      }));

      const run = await scheduler.runCheck(check.id);

      expect(run.id).toBeDefined();
      expect(run.checkId).toBe(check.id);
      expect(run.status).toBe('completed');

      const retrieved = await scheduler.getRun(run.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(run.id);
    });

    it('lists runs for a check', async () => {
      const check = await scheduler.createCheck({
        name: 'test-check',
        description: 'Test',
        schedule: '0 9 * * *',
      });

      scheduler.registerExecutor('test-check', async () => null);

      await scheduler.runCheck(check.id);
      await scheduler.runCheck(check.id);

      const runs = await scheduler.listRuns({ checkId: check.id });
      expect(runs).toHaveLength(2);
    });

    it('gets latest run', async () => {
      const check = await scheduler.createCheck({
        name: 'test-check',
        description: 'Test',
        schedule: '0 9 * * *',
      });

      scheduler.registerExecutor('test-check', async () => null);

      await scheduler.runCheck(check.id);
      const run2 = await scheduler.runCheck(check.id);

      const latest = await scheduler.getLatestRun(check.id);
      expect(latest?.id).toBe(run2.id);
    });

    it('records run failure', async () => {
      const check = await scheduler.createCheck({
        name: 'failing-check',
        description: 'Fails',
        schedule: '0 9 * * *',
      });

      scheduler.registerExecutor('failing-check', async () => {
        throw new Error('Test failure');
      });

      await expect(scheduler.runCheck(check.id)).rejects.toThrow('Test failure');

      const runs = await scheduler.listRuns({ checkId: check.id });
      expect(runs[0].status).toBe('failed');
      expect(runs[0].error).toBe('Test failure');
    });
  });

  describe('Scheduler Lifecycle', () => {
    it('starts and stops the scheduler', async () => {
      expect(scheduler.isRunning).toBe(false);

      await scheduler.start();
      expect(scheduler.isRunning).toBe(true);

      scheduler.stop();
      expect(scheduler.isRunning).toBe(false);
    });

    it('throws SchedulerAlreadyRunningError when starting twice', async () => {
      await scheduler.start();
      await expect(scheduler.start()).rejects.toThrow(SchedulerAlreadyRunningError);
    });

    it('registers builtin checks on start', async () => {
      await scheduler.start();

      const checks = await scheduler.listChecks({ checkType: 'builtin' });
      expect(checks.length).toBeGreaterThan(0);

      const checkNames = checks.map((c) => c.name);
      expect(checkNames).toContain('calendar-lookahead');
      expect(checkNames).toContain('daily-briefing');
    });
  });

  describe('Builtin Checks', () => {
    it('has calendar-lookahead check', async () => {
      await scheduler.start();

      const check = await scheduler.getCheckByName('calendar-lookahead');
      expect(check).not.toBeNull();
      expect(check?.schedule).toBe('0 * * * *');
    });

    it('has stale-followups check', async () => {
      await scheduler.start();

      const check = await scheduler.getCheckByName('stale-followups');
      expect(check).not.toBeNull();
      expect(check?.schedule).toBe('0 9 * * *');
    });

    it('has daily-briefing check', async () => {
      await scheduler.start();

      const check = await scheduler.getCheckByName('daily-briefing');
      expect(check).not.toBeNull();
      expect(check?.schedule).toBe('0 8 * * 1-5');
    });

    it('has deferred-tasks check', async () => {
      await scheduler.start();

      const check = await scheduler.getCheckByName('deferred-tasks');
      expect(check).not.toBeNull();
      expect(check?.schedule).toBe('0 9 * * *');
    });
  });
});
