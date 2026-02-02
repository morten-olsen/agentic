import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

import { Services } from '../services/services.ts';
import { DatabaseService, createDatabaseService } from '../database/database.ts';

import {
  TriggerService,
  TriggerScheduler,
  calculateNextInvocation,
  parseCronExpression,
  validateCronExpression,
  getNextCronTime,
  TriggerNotFoundError,
  TriggerAlreadyExistsError,
  InvalidScheduleError,
  PREINSTALLED_TRIGGERS,
} from './triggers.ts';
import type { Trigger } from './triggers.ts';
import {
  createTrigger,
  getTrigger,
  getTriggerByName,
  updateTrigger,
  deleteTrigger,
  listTriggers,
  getActiveTriggers,
  countTriggers,
  addTriggerConversation,
  getTriggerConversations,
} from './triggers.store.ts';
import { triggerScheduleSchema, triggerStatusSchema, createTriggerInputSchema } from './triggers.schemas.ts';

// ============================================================================
// Test Setup
// ============================================================================

const createTestServices = async (): Promise<Services> => {
  const services = new Services();
  const db = createDatabaseService(services, { path: ':memory:' });
  services.set(DatabaseService, db);
  await db.migrate();
  return services;
};

// ============================================================================
// Schema Tests
// ============================================================================

describe('Trigger Schemas', () => {
  describe('triggerScheduleSchema', () => {
    it('parses once schedule', () => {
      const schedule = triggerScheduleSchema.parse({
        type: 'once',
        at: '2024-03-15T10:00:00Z',
      });

      expect(schedule.type).toBe('once');
      if (schedule.type === 'once') {
        expect(schedule.at).toBe('2024-03-15T10:00:00Z');
      }
    });

    it('parses cron schedule', () => {
      const schedule = triggerScheduleSchema.parse({
        type: 'cron',
        expression: '0 9 * * *',
      });

      expect(schedule.type).toBe('cron');
      if (schedule.type === 'cron') {
        expect(schedule.expression).toBe('0 9 * * *');
      }
    });

    it('rejects invalid schedule type', () => {
      expect(() =>
        triggerScheduleSchema.parse({
          type: 'invalid',
          at: '2024-03-15T10:00:00Z',
        }),
      ).toThrow();
    });
  });

  describe('triggerStatusSchema', () => {
    it('accepts valid statuses', () => {
      expect(triggerStatusSchema.parse('active')).toBe('active');
      expect(triggerStatusSchema.parse('paused')).toBe('paused');
      expect(triggerStatusSchema.parse('completed')).toBe('completed');
      expect(triggerStatusSchema.parse('failed')).toBe('failed');
    });

    it('rejects invalid status', () => {
      expect(() => triggerStatusSchema.parse('invalid')).toThrow();
    });
  });

  describe('createTriggerInputSchema', () => {
    it('validates valid input', () => {
      const input = createTriggerInputSchema.parse({
        name: 'test-trigger',
        goal: 'Test goal',
        schedule: { type: 'once', at: '2024-03-15T10:00:00Z' },
      });

      expect(input.name).toBe('test-trigger');
      expect(input.goal).toBe('Test goal');
    });

    it('rejects empty name', () => {
      expect(() =>
        createTriggerInputSchema.parse({
          name: '',
          goal: 'Test goal',
          schedule: { type: 'once', at: '2024-03-15T10:00:00Z' },
        }),
      ).toThrow();
    });
  });
});

// ============================================================================
// Cron Parsing Tests
// ============================================================================

describe('Cron Parsing', () => {
  describe('parseCronExpression', () => {
    it('parses standard cron expression', () => {
      const fields = parseCronExpression('0 9 * * *');

      expect(fields.minute).toEqual([0]);
      expect(fields.hour).toEqual([9]);
      expect(fields.dayOfMonth).toHaveLength(31);
      expect(fields.month).toHaveLength(12);
      expect(fields.dayOfWeek).toHaveLength(7);
    });

    it('parses ranges', () => {
      const fields = parseCronExpression('0 9 * * 1-5');
      expect(fields.dayOfWeek).toEqual([1, 2, 3, 4, 5]);
    });

    it('parses step values', () => {
      const fields = parseCronExpression('*/15 * * * *');
      expect(fields.minute).toEqual([0, 15, 30, 45]);
    });

    it('parses comma-separated values', () => {
      const fields = parseCronExpression('0 8,12,18 * * *');
      expect(fields.hour).toEqual([8, 12, 18]);
    });

    it('throws InvalidScheduleError for invalid expressions', () => {
      expect(() => parseCronExpression('invalid')).toThrow(InvalidScheduleError);
      expect(() => parseCronExpression('0 9 * *')).toThrow(InvalidScheduleError);
      expect(() => parseCronExpression('0 9 * * * *')).toThrow(InvalidScheduleError);
    });
  });

  describe('validateCronExpression', () => {
    it('returns true for valid expressions', () => {
      expect(validateCronExpression('0 9 * * *')).toBe(true);
      expect(validateCronExpression('*/15 * * * *')).toBe(true);
      expect(validateCronExpression('0 9 * * 1-5')).toBe(true);
    });

    it('throws for invalid expressions', () => {
      expect(() => validateCronExpression('invalid')).toThrow(InvalidScheduleError);
    });
  });

  describe('getNextCronTime', () => {
    it('gets next time for daily schedule', () => {
      const after = new Date('2024-03-15T08:00:00');
      const next = getNextCronTime('0 9 * * *', after);

      expect(next).not.toBeNull();
      expect(next?.getHours()).toBe(9);
      expect(next?.getMinutes()).toBe(0);
    });

    it('gets next time for weekday schedule', () => {
      // March 15, 2024 is a Friday
      const after = new Date('2024-03-15T10:00:00');
      const next = getNextCronTime('0 9 * * 1-5', after);

      expect(next).not.toBeNull();
      // Should be Monday March 18
      expect(next?.getDate()).toBe(18);
      expect(next?.getDay()).toBe(1); // Monday
    });

    it('gets next time for step schedule', () => {
      const after = new Date('2024-03-15T09:07:00');
      const next = getNextCronTime('*/15 * * * *', after);

      expect(next).not.toBeNull();
      expect(next?.getMinutes()).toBe(15);
    });
  });
});

// ============================================================================
// Schedule Calculation Tests
// ============================================================================

describe('calculateNextInvocation', () => {
  it('calculates next for one-time trigger in future', () => {
    const trigger: Trigger = {
      id: 'test',
      name: 'test',
      goal: 'Test',
      schedule: { type: 'once', at: '2099-03-15T10:00:00Z' },
      status: 'active',
      invocationCount: 0,
      consecutiveFailures: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const next = calculateNextInvocation(trigger);
    expect(next).not.toBeNull();
    expect(next?.toISOString()).toBe('2099-03-15T10:00:00.000Z');
  });

  it('returns null for one-time trigger in past', () => {
    const trigger: Trigger = {
      id: 'test',
      name: 'test',
      goal: 'Test',
      schedule: { type: 'once', at: '2020-03-15T10:00:00Z' },
      status: 'active',
      invocationCount: 0,
      consecutiveFailures: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const next = calculateNextInvocation(trigger);
    expect(next).toBeNull();
  });

  it('returns null when max invocations reached', () => {
    const trigger: Trigger = {
      id: 'test',
      name: 'test',
      goal: 'Test',
      schedule: { type: 'cron', expression: '0 9 * * *' },
      status: 'active',
      invocationCount: 5,
      maxInvocations: 5,
      consecutiveFailures: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const next = calculateNextInvocation(trigger);
    expect(next).toBeNull();
  });

  it('returns null when end date passed', () => {
    const trigger: Trigger = {
      id: 'test',
      name: 'test',
      goal: 'Test',
      schedule: { type: 'cron', expression: '0 9 * * *' },
      status: 'active',
      invocationCount: 0,
      endsAt: '2020-03-15T10:00:00Z',
      consecutiveFailures: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const next = calculateNextInvocation(trigger);
    expect(next).toBeNull();
  });

  it('calculates next for cron trigger', () => {
    const trigger: Trigger = {
      id: 'test',
      name: 'test',
      goal: 'Test',
      schedule: { type: 'cron', expression: '0 9 * * *' },
      status: 'active',
      invocationCount: 0,
      consecutiveFailures: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const next = calculateNextInvocation(trigger);
    expect(next).not.toBeNull();
    expect(next?.getHours()).toBe(9);
    expect(next?.getMinutes()).toBe(0);
  });
});

// ============================================================================
// TriggerScheduler Tests
// ============================================================================

describe('TriggerScheduler', () => {
  it('schedules and fires a trigger', async () => {
    const onFire = vi.fn();
    const scheduler = new TriggerScheduler(onFire);

    // Schedule trigger for 10ms from now
    const at = new Date(Date.now() + 10);
    scheduler.scheduleAt('test-trigger', at);

    expect(scheduler.isScheduled('test-trigger')).toBe(true);
    expect(scheduler.scheduledCount).toBe(1);

    // Wait for it to fire
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(onFire).toHaveBeenCalledWith('test-trigger');
    expect(scheduler.isScheduled('test-trigger')).toBe(false);
  });

  it('cancels a scheduled trigger', () => {
    const onFire = vi.fn();
    const scheduler = new TriggerScheduler(onFire);

    const at = new Date(Date.now() + 1000);
    scheduler.scheduleAt('test-trigger', at);

    expect(scheduler.cancel('test-trigger')).toBe(true);
    expect(scheduler.isScheduled('test-trigger')).toBe(false);
  });

  it('cancels all triggers', () => {
    const onFire = vi.fn();
    const scheduler = new TriggerScheduler(onFire);

    const at = new Date(Date.now() + 1000);
    scheduler.scheduleAt('trigger-1', at);
    scheduler.scheduleAt('trigger-2', at);

    expect(scheduler.scheduledCount).toBe(2);

    scheduler.cancelAll();

    expect(scheduler.scheduledCount).toBe(0);
  });

  it('fires immediately for past time', async () => {
    const onFire = vi.fn();
    const scheduler = new TriggerScheduler(onFire);

    const at = new Date(Date.now() - 1000);
    scheduler.scheduleAt('test-trigger', at);

    // Wait for setImmediate to execute
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(onFire).toHaveBeenCalledWith('test-trigger');
  });
});

// ============================================================================
// Trigger Store Tests
// ============================================================================

describe('Trigger Store', () => {
  let services: Services;

  beforeEach(async () => {
    services = await createTestServices();
  });

  afterEach(async () => {
    await services.destroy();
  });

  const db = () => services.get(DatabaseService).knex;

  describe('CRUD Operations', () => {
    it('creates a trigger', async () => {
      const trigger = await createTrigger(db(), {
        name: 'test-trigger',
        goal: 'Test goal',
        schedule: { type: 'once', at: '2024-03-15T10:00:00Z' },
      });

      expect(trigger.id).toBeDefined();
      expect(trigger.name).toBe('test-trigger');
      expect(trigger.goal).toBe('Test goal');
      expect(trigger.schedule.type).toBe('once');
      expect(trigger.status).toBe('active');
      expect(trigger.invocationCount).toBe(0);
    });

    it('gets a trigger by ID', async () => {
      const created = await createTrigger(db(), {
        name: 'test-trigger',
        goal: 'Test goal',
        schedule: { type: 'cron', expression: '0 9 * * *' },
      });

      const retrieved = await getTrigger(db(), created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('test-trigger');
      expect(retrieved?.schedule.type).toBe('cron');
    });

    it('gets a trigger by name', async () => {
      await createTrigger(db(), {
        name: 'unique-trigger',
        goal: 'Test goal',
        schedule: { type: 'once', at: '2024-03-15T10:00:00Z' },
      });

      const trigger = await getTriggerByName(db(), 'unique-trigger');

      expect(trigger).not.toBeNull();
      expect(trigger?.name).toBe('unique-trigger');
    });

    it('updates a trigger', async () => {
      const created = await createTrigger(db(), {
        name: 'test-trigger',
        goal: 'Original goal',
        schedule: { type: 'once', at: '2024-03-15T10:00:00Z' },
      });

      const updated = await updateTrigger(db(), created.id, {
        goal: 'Updated goal',
        status: 'paused',
      });

      expect(updated?.goal).toBe('Updated goal');
      expect(updated?.status).toBe('paused');
    });

    it('deletes a trigger', async () => {
      const created = await createTrigger(db(), {
        name: 'test-trigger',
        goal: 'Test goal',
        schedule: { type: 'once', at: '2024-03-15T10:00:00Z' },
      });

      const deleted = await deleteTrigger(db(), created.id);
      expect(deleted).toBe(true);

      const retrieved = await getTrigger(db(), created.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('Queries', () => {
    it('lists all triggers', async () => {
      await createTrigger(db(), {
        name: 'trigger-1',
        goal: 'Goal 1',
        schedule: { type: 'once', at: '2024-03-15T10:00:00Z' },
      });
      await createTrigger(db(), {
        name: 'trigger-2',
        goal: 'Goal 2',
        schedule: { type: 'cron', expression: '0 9 * * *' },
      });

      const triggers = await listTriggers(db());
      expect(triggers).toHaveLength(2);
    });

    it('lists triggers by status', async () => {
      const t1 = await createTrigger(db(), {
        name: 'trigger-1',
        goal: 'Goal 1',
        schedule: { type: 'once', at: '2024-03-15T10:00:00Z' },
      });
      await createTrigger(db(), {
        name: 'trigger-2',
        goal: 'Goal 2',
        schedule: { type: 'cron', expression: '0 9 * * *' },
      });

      await updateTrigger(db(), t1.id, { status: 'paused' });

      const active = await listTriggers(db(), { status: 'active' });
      expect(active).toHaveLength(1);
      expect(active[0].name).toBe('trigger-2');
    });

    it('gets active triggers', async () => {
      await createTrigger(db(), {
        name: 'trigger-1',
        goal: 'Goal 1',
        schedule: { type: 'once', at: '2099-03-15T10:00:00Z' },
      });

      const active = await getActiveTriggers(db());
      expect(active.length).toBeGreaterThanOrEqual(1);
      expect(active.every((t) => t.status === 'active')).toBe(true);
    });

    it('counts triggers', async () => {
      const initial = await countTriggers(db());

      await createTrigger(db(), {
        name: 'trigger-1',
        goal: 'Goal 1',
        schedule: { type: 'once', at: '2024-03-15T10:00:00Z' },
      });

      const after = await countTriggers(db());
      expect(after).toBe(initial + 1);
    });
  });

  describe('Trigger-Conversation Junction', () => {
    it('adds and retrieves trigger conversations', async () => {
      const trigger = await createTrigger(db(), {
        name: 'test-trigger',
        goal: 'Test goal',
        schedule: { type: 'cron', expression: '0 9 * * *' },
      });

      // Create a test conversation with all required fields
      const now = new Date().toISOString();
      await db()('conversations').insert({
        id: 'conv-1',
        started_at: now,
        last_activity_at: now,
        message_count: 0,
        created_at: now,
        updated_at: now,
      });

      await addTriggerConversation(db(), trigger.id, 'conv-1');

      const conversations = await getTriggerConversations(db(), trigger.id);
      expect(conversations).toHaveLength(1);
      expect(conversations[0].conversationId).toBe('conv-1');
    });
  });
});

// ============================================================================
// TriggerService Tests
// ============================================================================

describe('TriggerService', () => {
  let services: Services;
  let triggerService: TriggerService;

  beforeEach(async () => {
    services = await createTestServices();
    triggerService = new TriggerService(services);
  });

  afterEach(async () => {
    if (triggerService.isRunning) {
      await triggerService.stop();
    }
    await services.destroy();
  });

  describe('Configuration', () => {
    it('starts unconfigured', () => {
      expect(triggerService.isConfigured).toBe(false);
    });

    it('becomes configured after configure()', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockOrchestrator = { invokeBackground: vi.fn() } as any;
      triggerService.configure({ orchestrator: mockOrchestrator });
      expect(triggerService.isConfigured).toBe(true);
    });
  });

  describe('CRUD Operations', () => {
    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockOrchestrator = { invokeBackground: vi.fn() } as any;
      triggerService.configure({ orchestrator: mockOrchestrator });
    });

    it('creates a trigger', async () => {
      const trigger = await triggerService.create({
        name: 'test-trigger',
        goal: 'Test goal',
        schedule: { type: 'once', at: '2099-03-15T10:00:00Z' },
      });

      expect(trigger.id).toBeDefined();
      expect(trigger.name).toBe('test-trigger');
      expect(trigger.nextInvocationAt).toBeDefined();
    });

    it('throws TriggerAlreadyExistsError for duplicate name', async () => {
      await triggerService.create({
        name: 'test-trigger',
        goal: 'Test goal',
        schedule: { type: 'once', at: '2099-03-15T10:00:00Z' },
      });

      await expect(
        triggerService.create({
          name: 'test-trigger',
          goal: 'Another goal',
          schedule: { type: 'once', at: '2099-03-16T10:00:00Z' },
        }),
      ).rejects.toThrow(TriggerAlreadyExistsError);
    });

    it('throws InvalidScheduleError for invalid cron', async () => {
      await expect(
        triggerService.create({
          name: 'bad-trigger',
          goal: 'Test goal',
          schedule: { type: 'cron', expression: 'invalid' },
        }),
      ).rejects.toThrow(InvalidScheduleError);
    });

    it('gets a trigger by ID', async () => {
      const created = await triggerService.create({
        name: 'test-trigger',
        goal: 'Test goal',
        schedule: { type: 'cron', expression: '0 9 * * *' },
      });

      const retrieved = await triggerService.get(created.id);
      expect(retrieved?.name).toBe('test-trigger');
    });

    it('throws TriggerNotFoundError for require with non-existent ID', async () => {
      await expect(triggerService.require('non-existent')).rejects.toThrow(TriggerNotFoundError);
    });

    it('updates a trigger', async () => {
      const created = await triggerService.create({
        name: 'test-trigger',
        goal: 'Original goal',
        schedule: { type: 'once', at: '2099-03-15T10:00:00Z' },
      });

      const updated = await triggerService.update(created.id, {
        goal: 'Updated goal',
      });

      expect(updated.goal).toBe('Updated goal');
    });

    it('deletes a trigger', async () => {
      const created = await triggerService.create({
        name: 'test-trigger',
        goal: 'Test goal',
        schedule: { type: 'once', at: '2099-03-15T10:00:00Z' },
      });

      await triggerService.delete(created.id);

      const retrieved = await triggerService.get(created.id);
      expect(retrieved).toBeNull();
    });

    it('lists triggers', async () => {
      await triggerService.create({
        name: 'trigger-1',
        goal: 'Goal 1',
        schedule: { type: 'once', at: '2099-03-15T10:00:00Z' },
      });
      await triggerService.create({
        name: 'trigger-2',
        goal: 'Goal 2',
        schedule: { type: 'cron', expression: '0 9 * * *' },
      });

      const triggers = await triggerService.list();
      expect(triggers.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Preinstalled Triggers', () => {
    it('has expected preinstalled trigger definitions', () => {
      expect(PREINSTALLED_TRIGGERS.length).toBeGreaterThan(0);

      const names = PREINSTALLED_TRIGGERS.map((t) => t.name);
      expect(names).toContain('daily-briefing');
      expect(names).toContain('calendar-lookahead');
      expect(names).toContain('stale-followups');
    });

    it('creates preinstalled triggers on start', async () => {
      const mockOrchestrator = {
        invokeBackground: vi.fn().mockResolvedValue('conv-123'),
        startConversation: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      triggerService.configure({ orchestrator: mockOrchestrator });

      await triggerService.start();

      const briefing = await triggerService.getByName('daily-briefing');
      expect(briefing).not.toBeNull();
      expect(briefing?.schedule.type).toBe('cron');
    });
  });
});
