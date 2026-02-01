import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

import { Services } from '../services/services.ts';
import { DatabaseService, createDatabaseService } from '../database/database.ts';

import { TaskService, TaskNotFoundError, TaskAlreadyCompletedError, InvalidTaskStateError } from './tasks.ts';
import { flexibleTriggerInputSchema } from './tasks.schemas.ts';
import type { WaitingFor } from './tasks.ts';

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
// Flexible Trigger Input Schema Tests
// ============================================================================

describe('flexibleTriggerInputSchema', () => {
  const referenceDate = new Date('2026-02-01T12:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(referenceDate);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts natural language "in 5 minutes" and converts to deadline trigger', () => {
    const result = flexibleTriggerInputSchema.safeParse('in 5 minutes');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('deadline');
      if (result.data.type === 'deadline') {
        // Should be 5 minutes after reference date
        const dueDate = new Date(result.data.dueAt);
        expect(dueDate.getTime()).toBe(referenceDate.getTime() + 5 * 60 * 1000);
      }
    }
  });

  it('accepts natural language "tomorrow at 9am" and converts to deadline trigger', () => {
    const result = flexibleTriggerInputSchema.safeParse('tomorrow at 9am');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('deadline');
      if (result.data.type === 'deadline') {
        const dueDate = new Date(result.data.dueAt);
        expect(dueDate.getDate()).toBe(2); // Feb 2
        expect(dueDate.getHours()).toBe(9);
      }
    }
  });

  it('accepts ISO datetime string and converts to deadline trigger', () => {
    const result = flexibleTriggerInputSchema.safeParse('2026-02-15T10:00:00Z');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('deadline');
      if (result.data.type === 'deadline') {
        expect(result.data.dueAt).toBe('2026-02-15T10:00:00.000Z');
      }
    }
  });

  it('accepts structured date trigger object', () => {
    const result = flexibleTriggerInputSchema.safeParse({
      type: 'date',
      date: '2026-02-15',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('date');
      if (result.data.type === 'date') {
        expect(result.data.date).toBe('2026-02-15');
      }
    }
  });

  it('accepts structured deadline trigger object', () => {
    const result = flexibleTriggerInputSchema.safeParse({
      type: 'deadline',
      dueAt: '2026-02-15T10:00:00Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('deadline');
      if (result.data.type === 'deadline') {
        expect(result.data.dueAt).toBe('2026-02-15T10:00:00Z');
      }
    }
  });

  it('accepts structured recurring_time trigger object', () => {
    const result = flexibleTriggerInputSchema.safeParse({
      type: 'recurring_time',
      schedule: '0 9 * * 1',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('recurring_time');
      if (result.data.type === 'recurring_time') {
        expect(result.data.schedule).toBe('0 9 * * 1');
      }
    }
  });

  it('fails with helpful error for invalid string input', () => {
    const result = flexibleTriggerInputSchema.safeParse('not a date');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('Could not parse');
      expect(result.error.issues[0].message).toContain('in 5 minutes');
    }
  });
});

// ============================================================================
// User Task Tests
// ============================================================================

describe('TaskService - User Tasks', () => {
  let services: Services;
  let taskService: TaskService;

  beforeEach(async () => {
    services = await createTestServices();
    taskService = new TaskService(services);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('createUserTask', () => {
    it('creates a deadline task', async () => {
      const task = await taskService.createUserTask({
        description: 'Submit expense report',
        trigger: { type: 'deadline', dueAt: '2024-03-15T17:00:00Z' },
      });

      expect(task.id).toBeDefined();
      expect(task.description).toBe('Submit expense report');
      expect(task.trigger.type).toBe('deadline');
      expect(task.status).toBe('pending');
    });

    it('creates a simple date task', async () => {
      const task = await taskService.createUserTask({
        description: 'Watch the AMP video',
        trigger: { type: 'date', date: '2026-02-02' },
      });

      expect(task.id).toBeDefined();
      expect(task.description).toBe('Watch the AMP video');
      expect(task.trigger.type).toBe('date');
      if (task.trigger.type === 'date') {
        expect(task.trigger.date).toBe('2026-02-02');
      }
      expect(task.status).toBe('pending');
    });

    it('creates a recurring time task', async () => {
      const task = await taskService.createUserTask({
        description: 'Weekly team update',
        trigger: { type: 'recurring_time', schedule: '0 9 * * 1' },
      });

      expect(task.trigger.type).toBe('recurring_time');
      if (task.trigger.type === 'recurring_time') {
        expect(task.trigger.schedule).toBe('0 9 * * 1');
      }
    });

    it('creates a recurring completion task', async () => {
      const task = await taskService.createUserTask({
        description: 'Water plants',
        trigger: { type: 'recurring_completion', intervalDays: 3 },
      });

      expect(task.trigger.type).toBe('recurring_completion');
      if (task.trigger.type === 'recurring_completion') {
        expect(task.trigger.intervalDays).toBe(3);
      }
    });

    it('creates an opportunistic task', async () => {
      const task = await taskService.createUserTask({
        description: 'Read article',
        trigger: { type: 'opportunistic', priority: 5 },
      });

      expect(task.trigger.type).toBe('opportunistic');
      if (task.trigger.type === 'opportunistic') {
        expect(task.trigger.priority).toBe(5);
      }
    });

    it('creates a deferred task', async () => {
      const task = await taskService.createUserTask({
        description: 'Set up home office',
        trigger: { type: 'deferred', becomesRelevant: '2024-04-01T00:00:00Z', condition: 'After the move' },
      });

      expect(task.trigger.type).toBe('deferred');
      if (task.trigger.type === 'deferred') {
        expect(task.trigger.condition).toBe('After the move');
      }
    });

    it('creates a conditional task', async () => {
      const task = await taskService.createUserTask({
        description: 'Book venue',
        trigger: { type: 'conditional', condition: 'Budget approved', watchExpression: 'budget.status' },
      });

      expect(task.trigger.type).toBe('conditional');
    });

    it('creates a task with related entities', async () => {
      const task = await taskService.createUserTask({
        description: 'Review document',
        trigger: { type: 'deadline', dueAt: '2024-03-15T17:00:00Z' },
        relatedProjects: ['project-1'],
        relatedContacts: ['contact-1'],
        tags: ['urgent', 'review'],
      });

      expect(task.relatedProjects).toEqual(['project-1']);
      expect(task.relatedContacts).toEqual(['contact-1']);
      expect(task.tags).toEqual(['urgent', 'review']);
    });
  });

  describe('getUserTask', () => {
    it('returns null for non-existent task', async () => {
      const task = await taskService.getUserTask('non-existent');
      expect(task).toBeNull();
    });

    it('retrieves an existing task', async () => {
      const created = await taskService.createUserTask({
        description: 'Test task',
        trigger: { type: 'deadline', dueAt: '2024-03-15T17:00:00Z' },
      });

      const retrieved = await taskService.getUserTask(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.description).toBe('Test task');
    });
  });

  describe('requireUserTask', () => {
    it('throws TaskNotFoundError for non-existent task', async () => {
      await expect(taskService.requireUserTask('non-existent')).rejects.toThrow(TaskNotFoundError);
    });
  });

  describe('updateUserTask', () => {
    it('updates task fields', async () => {
      const task = await taskService.createUserTask({
        description: 'Original',
        trigger: { type: 'deadline', dueAt: '2024-03-15T17:00:00Z' },
      });

      const updated = await taskService.updateUserTask(task.id, {
        description: 'Updated',
        notes: 'Important note',
      });

      expect(updated.description).toBe('Updated');
      expect(updated.notes).toBe('Important note');
    });

    it('updates trigger', async () => {
      const task = await taskService.createUserTask({
        description: 'Task',
        trigger: { type: 'deadline', dueAt: '2024-03-15T17:00:00Z' },
      });

      const updated = await taskService.updateUserTask(task.id, {
        trigger: { type: 'opportunistic', priority: 3 },
      });

      expect(updated.trigger.type).toBe('opportunistic');
    });

    it('throws TaskNotFoundError for non-existent task', async () => {
      await expect(taskService.updateUserTask('non-existent', { description: 'Test' })).rejects.toThrow(
        TaskNotFoundError,
      );
    });
  });

  describe('deleteUserTask', () => {
    it('deletes an existing task', async () => {
      const task = await taskService.createUserTask({
        description: 'To delete',
        trigger: { type: 'deadline', dueAt: '2024-03-15T17:00:00Z' },
      });

      const deleted = await taskService.deleteUserTask(task.id);
      expect(deleted).toBe(true);

      const retrieved = await taskService.getUserTask(task.id);
      expect(retrieved).toBeNull();
    });

    it('returns false for non-existent task', async () => {
      const deleted = await taskService.deleteUserTask('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('listUserTasks', () => {
    it('lists all tasks', async () => {
      await taskService.createUserTask({
        description: 'Task 1',
        trigger: { type: 'deadline', dueAt: '2024-03-15T17:00:00Z' },
      });
      await taskService.createUserTask({
        description: 'Task 2',
        trigger: { type: 'opportunistic', priority: 5 },
      });

      const tasks = await taskService.listUserTasks();
      expect(tasks).toHaveLength(2);
    });

    it('filters by status', async () => {
      const task = await taskService.createUserTask({
        description: 'Task 1',
        trigger: { type: 'deadline', dueAt: '2024-03-15T17:00:00Z' },
      });
      await taskService.completeUserTask(task.id);

      await taskService.createUserTask({
        description: 'Task 2',
        trigger: { type: 'deadline', dueAt: '2024-03-15T17:00:00Z' },
      });

      const pending = await taskService.listUserTasks({ status: 'pending' });
      expect(pending).toHaveLength(1);
      expect(pending[0].description).toBe('Task 2');
    });

    it('filters by trigger type', async () => {
      await taskService.createUserTask({
        description: 'Deadline task',
        trigger: { type: 'deadline', dueAt: '2024-03-15T17:00:00Z' },
      });
      await taskService.createUserTask({
        description: 'Opportunistic task',
        trigger: { type: 'opportunistic', priority: 5 },
      });

      const deadlineTasks = await taskService.listUserTasks({ triggerType: 'deadline' });
      expect(deadlineTasks).toHaveLength(1);
      expect(deadlineTasks[0].description).toBe('Deadline task');
    });

    it('respects limit', async () => {
      for (let i = 0; i < 5; i++) {
        await taskService.createUserTask({
          description: `Task ${i}`,
          trigger: { type: 'deadline', dueAt: '2024-03-15T17:00:00Z' },
        });
      }

      const tasks = await taskService.listUserTasks({ limit: 3 });
      expect(tasks).toHaveLength(3);
    });
  });

  describe('getActiveUserTasks', () => {
    it('returns pending, active, and waiting tasks', async () => {
      await taskService.createUserTask({
        description: 'Pending',
        trigger: { type: 'deadline', dueAt: '2024-03-15T17:00:00Z' },
      });

      const toComplete = await taskService.createUserTask({
        description: 'Completed',
        trigger: { type: 'deadline', dueAt: '2024-03-15T17:00:00Z' },
      });
      await taskService.completeUserTask(toComplete.id);

      const active = await taskService.getActiveUserTasks();
      expect(active).toHaveLength(1);
      expect(active[0].description).toBe('Pending');
    });
  });

  describe('getDueUserTasks', () => {
    it('returns deadline tasks due before specified date', async () => {
      await taskService.createUserTask({
        description: 'Due soon',
        trigger: { type: 'deadline', dueAt: '2024-03-10T17:00:00Z' },
      });
      await taskService.createUserTask({
        description: 'Due later',
        trigger: { type: 'deadline', dueAt: '2024-03-20T17:00:00Z' },
      });
      await taskService.createUserTask({
        description: 'Opportunistic',
        trigger: { type: 'opportunistic', priority: 5 },
      });

      const dueTasks = await taskService.getDueUserTasks(new Date('2024-03-15T00:00:00Z'));
      expect(dueTasks).toHaveLength(1);
      expect(dueTasks[0].description).toBe('Due soon');
    });
  });

  describe('completeUserTask', () => {
    it('marks a task as completed', async () => {
      const task = await taskService.createUserTask({
        description: 'To complete',
        trigger: { type: 'deadline', dueAt: '2024-03-15T17:00:00Z' },
      });

      const completed = await taskService.completeUserTask(task.id);
      expect(completed.status).toBe('completed');
      expect(completed.completedAt).toBeDefined();
    });

    it('throws TaskAlreadyCompletedError for already completed task', async () => {
      const task = await taskService.createUserTask({
        description: 'Task',
        trigger: { type: 'deadline', dueAt: '2024-03-15T17:00:00Z' },
      });

      await taskService.completeUserTask(task.id);
      await expect(taskService.completeUserTask(task.id)).rejects.toThrow(TaskAlreadyCompletedError);
    });
  });

  describe('cancelUserTask', () => {
    it('cancels a pending task', async () => {
      const task = await taskService.createUserTask({
        description: 'To cancel',
        trigger: { type: 'deadline', dueAt: '2024-03-15T17:00:00Z' },
      });

      const cancelled = await taskService.cancelUserTask(task.id);
      expect(cancelled.status).toBe('cancelled');
    });

    it('throws InvalidTaskStateError for completed task', async () => {
      const task = await taskService.createUserTask({
        description: 'Task',
        trigger: { type: 'deadline', dueAt: '2024-03-15T17:00:00Z' },
      });

      await taskService.completeUserTask(task.id);
      await expect(taskService.cancelUserTask(task.id)).rejects.toThrow(InvalidTaskStateError);
    });
  });
});

// ============================================================================
// Delegated Task Tests
// ============================================================================

describe('TaskService - Delegated Tasks', () => {
  let services: Services;
  let taskService: TaskService;

  beforeEach(async () => {
    services = await createTestServices();
    taskService = new TaskService(services);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('createTask', () => {
    it('creates a task with steps', async () => {
      const task = await taskService.createTask({
        description: 'Book flight to London',
        steps: [
          { description: 'Search for flights' },
          { description: 'Present options' },
          { description: 'Book selected flight' },
        ],
      });

      expect(task.id).toBeDefined();
      expect(task.description).toBe('Book flight to London');
      expect(task.status).toBe('pending');
      expect(task.steps).toHaveLength(3);
      expect(task.steps[0].status).toBe('pending');
      expect(task.currentStepIndex).toBe(0);
      expect(task.history).toHaveLength(1);
      expect(task.history[0].type).toBe('created');
    });

    it('creates a task linked to a user task', async () => {
      const userTask = await taskService.createUserTask({
        description: 'Review Q4 report',
        trigger: { type: 'deadline', dueAt: '2024-03-15T17:00:00Z' },
      });

      const delegatedTask = await taskService.createTask({
        description: 'Generate Q4 report',
        steps: [{ description: 'Gather data' }, { description: 'Create report' }],
        userTaskId: userTask.id,
      });

      expect(delegatedTask.userTaskId).toBe(userTask.id);
    });

    it('creates a task with context', async () => {
      const task = await taskService.createTask({
        description: 'Task',
        steps: [{ description: 'Step 1' }],
        relatedProjects: ['project-1'],
        relatedContacts: ['contact-1'],
        tags: ['urgent'],
      });

      expect(task.relatedProjects).toEqual(['project-1']);
      expect(task.relatedContacts).toEqual(['contact-1']);
      expect(task.tags).toEqual(['urgent']);
    });
  });

  describe('getTask', () => {
    it('returns null for non-existent task', async () => {
      const task = await taskService.getTask('non-existent');
      expect(task).toBeNull();
    });

    it('retrieves an existing task', async () => {
      const created = await taskService.createTask({
        description: 'Test task',
        steps: [{ description: 'Step 1' }],
      });

      const retrieved = await taskService.getTask(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.description).toBe('Test task');
    });
  });

  describe('startTask', () => {
    it('starts a pending task', async () => {
      const task = await taskService.createTask({
        description: 'Task',
        steps: [{ description: 'Step 1' }, { description: 'Step 2' }],
      });

      const started = await taskService.startTask(task.id);
      expect(started.status).toBe('active');
      expect(started.steps[0].status).toBe('in_progress');
      expect(started.steps[0].startedAt).toBeDefined();
      expect(started.history).toHaveLength(3); // created, started, step_started
    });

    it('throws InvalidTaskStateError for non-pending task', async () => {
      const task = await taskService.createTask({
        description: 'Task',
        steps: [{ description: 'Step 1' }],
      });

      await taskService.startTask(task.id);
      await expect(taskService.startTask(task.id)).rejects.toThrow(InvalidTaskStateError);
    });
  });

  describe('advanceStep', () => {
    it('advances to next step', async () => {
      const task = await taskService.createTask({
        description: 'Task',
        steps: [{ description: 'Step 1' }, { description: 'Step 2' }],
      });

      await taskService.startTask(task.id);
      const advanced = await taskService.advanceStep(task.id, { result: 'done' });

      expect(advanced.steps[0].status).toBe('completed');
      expect(advanced.steps[0].result).toEqual({ result: 'done' });
      expect(advanced.steps[1].status).toBe('in_progress');
      expect(advanced.currentStepIndex).toBe(1);
    });

    it('completes task when last step is advanced', async () => {
      const task = await taskService.createTask({
        description: 'Task',
        steps: [{ description: 'Only step' }],
      });

      await taskService.startTask(task.id);
      const completed = await taskService.advanceStep(task.id);

      expect(completed.status).toBe('completed');
      expect(completed.steps[0].status).toBe('completed');
    });

    it('throws InvalidTaskStateError for non-active task', async () => {
      const task = await taskService.createTask({
        description: 'Task',
        steps: [{ description: 'Step 1' }],
      });

      await expect(taskService.advanceStep(task.id)).rejects.toThrow(InvalidTaskStateError);
    });
  });

  describe('failStep', () => {
    it('marks step as failed and blocks task', async () => {
      const task = await taskService.createTask({
        description: 'Task',
        steps: [{ description: 'Step 1' }, { description: 'Step 2' }],
      });

      await taskService.startTask(task.id);
      const failed = await taskService.failStep(task.id, 'Network error');

      expect(failed.status).toBe('blocked');
      expect(failed.statusReason).toBe('Network error');
      expect(failed.steps[0].status).toBe('failed');
      expect(failed.steps[0].error).toBe('Network error');
    });
  });

  describe('skipStep', () => {
    it('skips current step and moves to next', async () => {
      const task = await taskService.createTask({
        description: 'Task',
        steps: [{ description: 'Step 1' }, { description: 'Step 2' }],
      });

      await taskService.startTask(task.id);
      const skipped = await taskService.skipStep(task.id, 'Not needed');

      expect(skipped.steps[0].status).toBe('skipped');
      expect(skipped.steps[1].status).toBe('in_progress');
      expect(skipped.currentStepIndex).toBe(1);
    });

    it('completes task when last step is skipped', async () => {
      const task = await taskService.createTask({
        description: 'Task',
        steps: [{ description: 'Only step' }],
      });

      await taskService.startTask(task.id);
      const completed = await taskService.skipStep(task.id, 'Skip');

      expect(completed.status).toBe('completed');
    });
  });

  describe('setWaiting', () => {
    it('sets task to waiting state', async () => {
      const task = await taskService.createTask({
        description: 'Task',
        steps: [{ description: 'Step 1' }],
      });

      await taskService.startTask(task.id);

      const waitingFor: WaitingFor = {
        type: 'user_response',
        description: 'Waiting for user to select flight',
        condition: 'user.responded',
        onTimeout: 'remind',
      };

      const waiting = await taskService.setWaiting(task.id, waitingFor);

      expect(waiting.status).toBe('waiting');
      expect(waiting.waitingFor).toEqual(waitingFor);
    });

    it('throws InvalidTaskStateError for non-active task', async () => {
      const task = await taskService.createTask({
        description: 'Task',
        steps: [{ description: 'Step 1' }],
      });

      const waitingFor: WaitingFor = {
        type: 'time',
        description: 'Wait',
        condition: 'true',
        onTimeout: 'proceed',
      };

      await expect(taskService.setWaiting(task.id, waitingFor)).rejects.toThrow(InvalidTaskStateError);
    });
  });

  describe('resumeTask', () => {
    it('resumes a waiting task', async () => {
      const task = await taskService.createTask({
        description: 'Task',
        steps: [{ description: 'Step 1' }],
      });

      await taskService.startTask(task.id);
      await taskService.setWaiting(task.id, {
        type: 'time',
        description: 'Wait',
        condition: 'true',
        onTimeout: 'proceed',
      });

      const resumed = await taskService.resumeTask(task.id);

      expect(resumed.status).toBe('active');
      expect(resumed.waitingFor).toBeUndefined();
    });

    it('throws InvalidTaskStateError for non-waiting task', async () => {
      const task = await taskService.createTask({
        description: 'Task',
        steps: [{ description: 'Step 1' }],
      });

      await taskService.startTask(task.id);
      await expect(taskService.resumeTask(task.id)).rejects.toThrow(InvalidTaskStateError);
    });
  });

  describe('checkWaitingConditions', () => {
    it('returns tasks ready to resume based on time', async () => {
      const task = await taskService.createTask({
        description: 'Task',
        steps: [{ description: 'Step 1' }],
      });

      await taskService.startTask(task.id);
      await taskService.setWaiting(task.id, {
        type: 'time',
        description: 'Wait until tomorrow',
        condition: 'time',
        deadline: '2024-03-10T00:00:00Z',
        onTimeout: 'proceed',
      });

      const readyBefore = await taskService.checkWaitingConditions(new Date('2024-03-09T00:00:00Z'));
      expect(readyBefore).toHaveLength(0);

      const readyAfter = await taskService.checkWaitingConditions(new Date('2024-03-11T00:00:00Z'));
      expect(readyAfter).toHaveLength(1);
    });
  });

  describe('completeTask', () => {
    it('completes a task with summary', async () => {
      const task = await taskService.createTask({
        description: 'Task',
        steps: [{ description: 'Step 1' }],
      });

      await taskService.startTask(task.id);
      const completed = await taskService.completeTask(task.id, 'Task finished successfully');

      expect(completed.status).toBe('completed');
      expect(completed.statusReason).toBe('Task finished successfully');
    });

    it('throws TaskAlreadyCompletedError for completed task', async () => {
      const task = await taskService.createTask({
        description: 'Task',
        steps: [{ description: 'Step 1' }],
      });

      await taskService.startTask(task.id);
      await taskService.completeTask(task.id, 'Done');

      await expect(taskService.completeTask(task.id, 'Done again')).rejects.toThrow(TaskAlreadyCompletedError);
    });
  });

  describe('cancelTask', () => {
    it('cancels a task', async () => {
      const task = await taskService.createTask({
        description: 'Task',
        steps: [{ description: 'Step 1' }],
      });

      const cancelled = await taskService.cancelTask(task.id, 'No longer needed');

      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.statusReason).toBe('No longer needed');
    });

    it('throws InvalidTaskStateError for cancelled task', async () => {
      const task = await taskService.createTask({
        description: 'Task',
        steps: [{ description: 'Step 1' }],
      });

      await taskService.cancelTask(task.id, 'Cancelled');
      await expect(taskService.cancelTask(task.id, 'Cancel again')).rejects.toThrow(InvalidTaskStateError);
    });
  });

  describe('getActiveTasks', () => {
    it('returns only active tasks', async () => {
      const task1 = await taskService.createTask({
        description: 'Active task',
        steps: [{ description: 'Step' }],
      });
      await taskService.startTask(task1.id);

      await taskService.createTask({
        description: 'Pending task',
        steps: [{ description: 'Step' }],
      });

      const active = await taskService.getActiveTasks();
      expect(active).toHaveLength(1);
      expect(active[0].description).toBe('Active task');
    });
  });

  describe('getWaitingTasks', () => {
    it('returns only waiting tasks', async () => {
      const task = await taskService.createTask({
        description: 'Waiting task',
        steps: [{ description: 'Step' }],
      });
      await taskService.startTask(task.id);
      await taskService.setWaiting(task.id, {
        type: 'time',
        description: 'Wait',
        condition: 'true',
        onTimeout: 'proceed',
      });

      await taskService.createTask({
        description: 'Pending task',
        steps: [{ description: 'Step' }],
      });

      const waiting = await taskService.getWaitingTasks();
      expect(waiting).toHaveLength(1);
      expect(waiting[0].description).toBe('Waiting task');
    });
  });

  describe('getTasksForProject', () => {
    it('returns tasks for a specific project', async () => {
      await taskService.createTask({
        description: 'Project task',
        steps: [{ description: 'Step' }],
        relatedProjects: ['project-1'],
      });

      await taskService.createTask({
        description: 'Other task',
        steps: [{ description: 'Step' }],
        relatedProjects: ['project-2'],
      });

      const tasks = await taskService.getTasksForProject('project-1');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].description).toBe('Project task');
    });
  });

  describe('getOverdueTasks', () => {
    it('returns tasks past their deadline', async () => {
      const task = await taskService.createTask({
        description: 'Overdue task',
        steps: [{ description: 'Step' }],
      });
      await taskService.startTask(task.id);
      await taskService.setWaiting(task.id, {
        type: 'time',
        description: 'Wait',
        condition: 'true',
        deadline: '2024-03-10T00:00:00Z',
        onTimeout: 'remind',
      });

      const overdue = await taskService.getOverdueTasks(new Date('2024-03-15T00:00:00Z'));
      expect(overdue).toHaveLength(1);
    });
  });

  describe('getPendingTasksForContext', () => {
    it('returns pending tasks summary for context', async () => {
      // Create user task
      await taskService.createUserTask({
        description: 'User task',
        trigger: { type: 'deadline', dueAt: '2024-03-15T17:00:00Z' },
      });

      // Create and start delegated task
      const delegated = await taskService.createTask({
        description: 'Delegated task',
        steps: [{ description: 'Current step' }, { description: 'Next step' }],
      });
      await taskService.startTask(delegated.id);

      const pendingTasks = await taskService.getPendingTasksForContext();

      expect(pendingTasks.length).toBeGreaterThanOrEqual(2);

      const userTask = pendingTasks.find((t) => t.type === 'user');
      expect(userTask?.description).toBe('User task');

      const delegatedTask = pendingTasks.find((t) => t.type === 'delegated');
      expect(delegatedTask?.currentStep).toBe('Current step');
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 15; i++) {
        await taskService.createUserTask({
          description: `Task ${i}`,
          trigger: { type: 'deadline', dueAt: '2024-03-15T17:00:00Z' },
        });
      }

      const tasks = await taskService.getPendingTasksForContext(5);
      expect(tasks).toHaveLength(5);
    });
  });
});
