import type { Services } from '../services/services.ts';
import { DatabaseService } from '../database/database.ts';

import type {
  UserTask,
  CreateUserTaskInput,
  UpdateUserTaskInput,
  UserTaskStatus,
  DelegatedTask,
  CreateDelegatedTaskInput,
  UpdateDelegatedTaskInput,
  DelegatedTaskStatus,
  WaitingFor,
  PendingTaskContext,
} from './tasks.schemas.ts';
import {
  createUserTask,
  getUserTask,
  updateUserTask,
  deleteUserTask,
  listUserTasks,
  getActiveUserTasks,
  getDueUserTasks,
  getUserTasksForProject,
  completeUserTask,
  cancelUserTask,
} from './user-tasks.store.ts';
import {
  createDelegatedTask,
  getDelegatedTask,
  updateDelegatedTask,
  deleteDelegatedTask,
  listDelegatedTasks,
  getActiveDelegatedTasks,
  getWaitingDelegatedTasks,
  getDelegatedTasksForProject,
  getDelegatedTasksForUserTask,
  startTask,
  advanceStep,
  failStep,
  skipStep,
  setWaiting,
  resumeTask,
  checkWaitingConditions,
  completeTask as completeDelegatedTask,
  cancelTask as cancelDelegatedTask,
} from './delegated-tasks.store.ts';
import {
  TaskNotFoundError,
  InvalidStepError,
  TaskAlreadyCompletedError,
  InvalidTaskStateError,
} from './tasks.errors.ts';

// ============================================================================
// Task Service
// ============================================================================

/**
 * Task Service - manages User Tasks and Delegated Tasks.
 *
 * User Tasks: Items on the user's to-do list with flexible scheduling
 * Delegated Tasks: Multi-step workflows the agent performs autonomously
 */
class TaskService {
  #services: Services;

  constructor(services: Services) {
    this.#services = services;
  }

  /**
   * Gets the Knex instance from the database service.
   */
  #db = () => {
    return this.#services.get(DatabaseService).knex;
  };

  // ==========================================================================
  // User Task Operations
  // ==========================================================================

  /**
   * Creates a new user task.
   */
  createUserTask = async (input: CreateUserTaskInput): Promise<UserTask> => {
    return createUserTask(this.#db(), input);
  };

  /**
   * Gets a user task by ID.
   */
  getUserTask = async (id: string): Promise<UserTask | null> => {
    return getUserTask(this.#db(), id);
  };

  /**
   * Gets a user task by ID, throws if not found.
   */
  requireUserTask = async (id: string): Promise<UserTask> => {
    const task = await this.getUserTask(id);
    if (!task) {
      throw new TaskNotFoundError(id, 'user');
    }
    return task;
  };

  /**
   * Updates a user task.
   */
  updateUserTask = async (id: string, updates: UpdateUserTaskInput): Promise<UserTask> => {
    const task = await updateUserTask(this.#db(), id, updates);
    if (!task) {
      throw new TaskNotFoundError(id, 'user');
    }
    return task;
  };

  /**
   * Deletes a user task.
   */
  deleteUserTask = async (id: string): Promise<boolean> => {
    return deleteUserTask(this.#db(), id);
  };

  /**
   * Lists user tasks with optional filtering.
   */
  listUserTasks = async (options?: {
    status?: UserTaskStatus;
    triggerType?: string;
    limit?: number;
  }): Promise<UserTask[]> => {
    return listUserTasks(this.#db(), options);
  };

  /**
   * Gets all active user tasks (pending, active, waiting).
   */
  getActiveUserTasks = async (): Promise<UserTask[]> => {
    return getActiveUserTasks(this.#db());
  };

  /**
   * Gets deadline tasks due before the specified date.
   */
  getDueUserTasks = async (beforeDate: Date): Promise<UserTask[]> => {
    return getDueUserTasks(this.#db(), beforeDate);
  };

  /**
   * Gets user tasks related to a project.
   */
  getUserTasksForProject = async (projectId: string): Promise<UserTask[]> => {
    return getUserTasksForProject(this.#db(), projectId);
  };

  /**
   * Marks a user task as completed.
   */
  completeUserTask = async (id: string): Promise<UserTask> => {
    const task = await this.getUserTask(id);
    if (!task) {
      throw new TaskNotFoundError(id, 'user');
    }
    if (task.status === 'completed') {
      throw new TaskAlreadyCompletedError(id);
    }

    const updated = await completeUserTask(this.#db(), id);
    if (!updated) {
      throw new TaskNotFoundError(id, 'user');
    }
    return updated;
  };

  /**
   * Cancels a user task.
   */
  cancelUserTask = async (id: string): Promise<UserTask> => {
    const task = await this.getUserTask(id);
    if (!task) {
      throw new TaskNotFoundError(id, 'user');
    }
    if (task.status === 'completed' || task.status === 'cancelled') {
      throw new InvalidTaskStateError(id, task.status, 'cancel');
    }

    const updated = await cancelUserTask(this.#db(), id);
    if (!updated) {
      throw new TaskNotFoundError(id, 'user');
    }
    return updated;
  };

  // ==========================================================================
  // Delegated Task Operations
  // ==========================================================================

  /**
   * Creates a new delegated task.
   */
  createTask = async (input: CreateDelegatedTaskInput): Promise<DelegatedTask> => {
    return createDelegatedTask(this.#db(), input);
  };

  /**
   * Gets a delegated task by ID.
   */
  getTask = async (id: string): Promise<DelegatedTask | null> => {
    return getDelegatedTask(this.#db(), id);
  };

  /**
   * Gets a delegated task by ID, throws if not found.
   */
  requireTask = async (id: string): Promise<DelegatedTask> => {
    const task = await this.getTask(id);
    if (!task) {
      throw new TaskNotFoundError(id, 'delegated');
    }
    return task;
  };

  /**
   * Updates a delegated task.
   */
  updateTask = async (id: string, updates: UpdateDelegatedTaskInput): Promise<DelegatedTask> => {
    const task = await updateDelegatedTask(this.#db(), id, updates);
    if (!task) {
      throw new TaskNotFoundError(id, 'delegated');
    }
    return task;
  };

  /**
   * Deletes a delegated task.
   */
  deleteTask = async (id: string): Promise<boolean> => {
    return deleteDelegatedTask(this.#db(), id);
  };

  /**
   * Lists delegated tasks with optional filtering.
   */
  listTasks = async (options?: {
    status?: DelegatedTaskStatus;
    userTaskId?: string;
    limit?: number;
  }): Promise<DelegatedTask[]> => {
    return listDelegatedTasks(this.#db(), options);
  };

  /**
   * Gets all active delegated tasks.
   */
  getActiveTasks = async (): Promise<DelegatedTask[]> => {
    return getActiveDelegatedTasks(this.#db());
  };

  /**
   * Gets all waiting delegated tasks.
   */
  getWaitingTasks = async (): Promise<DelegatedTask[]> => {
    return getWaitingDelegatedTasks(this.#db());
  };

  /**
   * Gets delegated tasks related to a project.
   */
  getTasksForProject = async (projectId: string): Promise<DelegatedTask[]> => {
    return getDelegatedTasksForProject(this.#db(), projectId);
  };

  /**
   * Gets delegated tasks linked to a user task.
   */
  getTasksForUserTask = async (userTaskId: string): Promise<DelegatedTask[]> => {
    return getDelegatedTasksForUserTask(this.#db(), userTaskId);
  };

  // ==========================================================================
  // Delegated Task Progress
  // ==========================================================================

  /**
   * Starts a pending task (moves to active, starts first step).
   */
  startTask = async (id: string): Promise<DelegatedTask> => {
    const task = await this.requireTask(id);
    if (task.status !== 'pending') {
      throw new InvalidTaskStateError(id, task.status, 'start');
    }

    const updated = await startTask(this.#db(), id);
    if (!updated) {
      throw new TaskNotFoundError(id, 'delegated');
    }
    return updated;
  };

  /**
   * Advances to the next step, marking current step as completed.
   */
  advanceStep = async (id: string, result?: unknown): Promise<DelegatedTask> => {
    const task = await this.requireTask(id);
    if (task.status !== 'active') {
      throw new InvalidTaskStateError(id, task.status, 'advance step');
    }
    if (task.currentStepIndex >= task.steps.length) {
      throw new InvalidStepError(id, task.currentStepIndex, 'no more steps');
    }

    const updated = await advanceStep(this.#db(), id, result);
    if (!updated) {
      throw new TaskNotFoundError(id, 'delegated');
    }
    return updated;
  };

  /**
   * Marks the current step as failed and blocks the task.
   */
  failStep = async (id: string, error: string): Promise<DelegatedTask> => {
    const task = await this.requireTask(id);
    if (task.status !== 'active') {
      throw new InvalidTaskStateError(id, task.status, 'fail step');
    }

    const updated = await failStep(this.#db(), id, error);
    if (!updated) {
      throw new TaskNotFoundError(id, 'delegated');
    }
    return updated;
  };

  /**
   * Skips the current step and moves to the next.
   */
  skipStep = async (id: string, reason: string): Promise<DelegatedTask> => {
    const task = await this.requireTask(id);
    if (task.status !== 'active') {
      throw new InvalidTaskStateError(id, task.status, 'skip step');
    }
    if (task.currentStepIndex >= task.steps.length) {
      throw new InvalidStepError(id, task.currentStepIndex, 'no more steps to skip');
    }

    const updated = await skipStep(this.#db(), id, reason);
    if (!updated) {
      throw new TaskNotFoundError(id, 'delegated');
    }
    return updated;
  };

  // ==========================================================================
  // Delegated Task Waiting
  // ==========================================================================

  /**
   * Sets the task to waiting for a condition.
   */
  setWaiting = async (id: string, waitingFor: WaitingFor): Promise<DelegatedTask> => {
    const task = await this.requireTask(id);
    if (task.status !== 'active') {
      throw new InvalidTaskStateError(id, task.status, 'set waiting');
    }

    const updated = await setWaiting(this.#db(), id, waitingFor);
    if (!updated) {
      throw new TaskNotFoundError(id, 'delegated');
    }
    return updated;
  };

  /**
   * Resumes a waiting task.
   */
  resumeTask = async (id: string): Promise<DelegatedTask> => {
    const task = await this.requireTask(id);
    if (task.status !== 'waiting') {
      throw new InvalidTaskStateError(id, task.status, 'resume');
    }

    const updated = await resumeTask(this.#db(), id);
    if (!updated) {
      throw new TaskNotFoundError(id, 'delegated');
    }
    return updated;
  };

  /**
   * Checks waiting conditions and returns tasks ready to resume.
   */
  checkWaitingConditions = async (currentTime: Date = new Date()): Promise<DelegatedTask[]> => {
    return checkWaitingConditions(this.#db(), currentTime);
  };

  // ==========================================================================
  // Delegated Task Completion
  // ==========================================================================

  /**
   * Manually completes a task with a summary.
   */
  completeTask = async (id: string, summary: string): Promise<DelegatedTask> => {
    const task = await this.requireTask(id);
    if (task.status === 'completed') {
      throw new TaskAlreadyCompletedError(id);
    }
    if (task.status === 'cancelled') {
      throw new InvalidTaskStateError(id, task.status, 'complete');
    }

    const updated = await completeDelegatedTask(this.#db(), id, summary);
    if (!updated) {
      throw new TaskNotFoundError(id, 'delegated');
    }
    return updated;
  };

  /**
   * Cancels a task.
   */
  cancelTask = async (id: string, reason: string): Promise<DelegatedTask> => {
    const task = await this.requireTask(id);
    if (task.status === 'completed' || task.status === 'cancelled') {
      throw new InvalidTaskStateError(id, task.status, 'cancel');
    }

    const updated = await cancelDelegatedTask(this.#db(), id, reason);
    if (!updated) {
      throw new TaskNotFoundError(id, 'delegated');
    }
    return updated;
  };

  // ==========================================================================
  // Context Builder Support
  // ==========================================================================

  /**
   * Gets pending tasks for the agent context.
   */
  getPendingTasksForContext = async (limit = 10): Promise<PendingTaskContext[]> => {
    const [activeUserTasks, activeDelegatedTasks] = await Promise.all([
      this.getActiveUserTasks(),
      this.getActiveTasks(),
    ]);

    const waitingDelegatedTasks = await this.getWaitingTasks();

    const pendingTasks: PendingTaskContext[] = [];

    // Add user tasks
    for (const task of activeUserTasks.slice(0, limit)) {
      pendingTasks.push({
        id: task.id,
        description: task.description,
        type: 'user',
        status: task.status,
      });
    }

    // Add active delegated tasks
    for (const task of activeDelegatedTasks) {
      if (pendingTasks.length >= limit) break;

      const currentStep = task.steps[task.currentStepIndex];
      pendingTasks.push({
        id: task.id,
        description: task.description,
        type: 'delegated',
        status: task.status,
        currentStep: currentStep?.description,
      });
    }

    // Add waiting delegated tasks
    for (const task of waitingDelegatedTasks) {
      if (pendingTasks.length >= limit) break;

      pendingTasks.push({
        id: task.id,
        description: task.description,
        type: 'delegated',
        status: task.status,
        waitingFor: task.waitingFor?.description,
      });
    }

    return pendingTasks;
  };

  /**
   * Gets overdue delegated tasks (waiting tasks past their deadline).
   */
  getOverdueTasks = async (currentTime: Date = new Date()): Promise<DelegatedTask[]> => {
    const waitingTasks = await this.getWaitingTasks();
    return waitingTasks.filter((task) => {
      if (!task.waitingFor?.deadline) return false;
      const deadline = new Date(task.waitingFor.deadline);
      return currentTime > deadline;
    });
  };
}

// ============================================================================
// Re-exports
// ============================================================================

export type {
  TaskTrigger,
  TaskTriggerType,
  UserTaskStatus,
  UserTask,
  CreateUserTaskInput,
  UpdateUserTaskInput,
  DelegatedTaskStatus,
  TaskStep,
  TaskStepStatus,
  TaskEvent,
  TaskEventType,
  WaitingFor,
  WaitingForType,
  TimeoutAction,
  DelegatedTask,
  CreateDelegatedTaskInput,
  UpdateDelegatedTaskInput,
  PendingTaskContext,
} from './tasks.schemas.ts';

export {
  // Trigger schemas
  deadlineTriggerSchema,
  recurringTimeTriggerSchema,
  recurringCompletionTriggerSchema,
  opportunisticTriggerSchema,
  deferredTriggerSchema,
  conditionalTriggerSchema,
  taskTriggerSchema,
  flexibleTriggerInputSchema,
  // User task schemas
  userTaskStatusSchema,
  userTaskSchema,
  createUserTaskInputSchema,
  updateUserTaskInputSchema,
  // Delegated task schemas
  delegatedTaskStatusSchema,
  taskStepStatusSchema,
  taskStepSchema,
  taskEventTypeSchema,
  taskEventSchema,
  waitingForTypeSchema,
  timeoutActionSchema,
  waitingForSchema,
  delegatedTaskSchema,
  createStepInputSchema,
  createDelegatedTaskInputSchema,
  updateDelegatedTaskInputSchema,
  // Context schema
  pendingTaskContextSchema,
} from './tasks.schemas.ts';

export {
  TaskNotFoundError,
  InvalidStepError,
  TaskAlreadyCompletedError,
  InvalidTaskStateError,
} from './tasks.errors.ts';

export { TaskService };
