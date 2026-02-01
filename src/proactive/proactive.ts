import type { Knex } from 'knex';

import type { Services } from '../services/services.ts';
import { DatabaseService } from '../database/database.ts';
import { NotificationRouter } from '../notifications/notifications.ts';

import type {
  ProactiveCheck,
  CreateCheckInput,
  UpdateCheckInput,
  ProactiveRun,
  RunStatus,
  CheckExecutor,
} from './proactive.schemas.ts';
import {
  createCheck,
  getCheck,
  getCheckByName,
  updateCheck,
  deleteCheck,
  listChecks,
  getEnabledChecks,
  createRun,
  getRun,
  completeRun,
  failRun,
  listRuns,
  getLatestRun,
} from './proactive.store.ts';
import { getBuiltinExecutor, getBuiltinCheckInputs } from './proactive.checks.ts';
import {
  CheckNotFoundError,
  CheckAlreadyExistsError,
  CheckExecutionError,
  RunNotFoundError,
  InvalidCronExpressionError,
  SchedulerAlreadyRunningError,
} from './proactive.errors.ts';

// ============================================================================
// Cron Parsing (Simple Implementation)
// ============================================================================

/**
 * Simple cron parser for basic schedules.
 * Supports: minute hour day-of-month month day-of-week
 * Example: "0 9 * * 1-5" = 9am on weekdays
 */
type CronFields = {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
};

const parseRange = (field: string, min: number, max: number): number[] => {
  if (field === '*') {
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }

  const values: number[] = [];

  // Handle comma-separated values
  const parts = field.split(',');
  for (const part of parts) {
    // Handle ranges like "1-5"
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(Number);
      if (start !== undefined && end !== undefined && !isNaN(start) && !isNaN(end)) {
        for (let i = start; i <= end; i++) {
          if (i >= min && i <= max && !values.includes(i)) {
            values.push(i);
          }
        }
      }
    } else {
      // Handle step values like "*/15"
      if (part.startsWith('*/')) {
        const step = parseInt(part.slice(2), 10);
        if (!isNaN(step) && step > 0) {
          for (let i = min; i <= max; i += step) {
            if (!values.includes(i)) {
              values.push(i);
            }
          }
        }
      } else {
        // Single value
        const val = parseInt(part, 10);
        if (!isNaN(val) && val >= min && val <= max && !values.includes(val)) {
          values.push(val);
        }
      }
    }
  }

  return values.sort((a, b) => a - b);
};

const parseCron = (expression: string): CronFields => {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new InvalidCronExpressionError(expression);
  }

  const minutePart = parts[0];
  const hourPart = parts[1];
  const dayOfMonthPart = parts[2];
  const monthPart = parts[3];
  const dayOfWeekPart = parts[4];

  if (!minutePart || !hourPart || !dayOfMonthPart || !monthPart || !dayOfWeekPart) {
    throw new InvalidCronExpressionError(expression);
  }

  try {
    return {
      minute: parseRange(minutePart, 0, 59),
      hour: parseRange(hourPart, 0, 23),
      dayOfMonth: parseRange(dayOfMonthPart, 1, 31),
      month: parseRange(monthPart, 1, 12),
      dayOfWeek: parseRange(dayOfWeekPart, 0, 6), // 0 = Sunday
    };
  } catch {
    throw new InvalidCronExpressionError(expression);
  }
};

/**
 * Checks if a cron expression matches the given date.
 */
const matchesCron = (expression: string, date: Date): boolean => {
  try {
    const fields = parseCron(expression);
    const minute = date.getMinutes();
    const hour = date.getHours();
    const dayOfMonth = date.getDate();
    const month = date.getMonth() + 1;
    const dayOfWeek = date.getDay();

    return (
      fields.minute.includes(minute) &&
      fields.hour.includes(hour) &&
      fields.dayOfMonth.includes(dayOfMonth) &&
      fields.month.includes(month) &&
      fields.dayOfWeek.includes(dayOfWeek)
    );
  } catch {
    return false;
  }
};

/**
 * Checks if a check should run based on its schedule and last run time.
 */
const shouldRunCheck = (check: ProactiveCheck, now: Date): boolean => {
  if (!check.enabled) {
    return false;
  }

  // If never run, check if current time matches
  if (!check.lastRunAt) {
    return matchesCron(check.schedule, now);
  }

  // Check if we're in a new matching window since last run
  const lastRun = new Date(check.lastRunAt);

  // Only run if current time matches AND we haven't run in this minute
  if (!matchesCron(check.schedule, now)) {
    return false;
  }

  // Check if last run was in a different minute
  const lastRunMinute = Math.floor(lastRun.getTime() / 60000);
  const nowMinute = Math.floor(now.getTime() / 60000);

  return nowMinute > lastRunMinute;
};

// ============================================================================
// Proactive Scheduler Service
// ============================================================================

/**
 * ProactiveScheduler - manages scheduled checks and their execution.
 */
class ProactiveScheduler {
  #services: Services;
  #customExecutors = new Map<string, CheckExecutor>();
  #running = false;
  #intervalId: ReturnType<typeof setInterval> | null = null;
  #checkIntervalMs = 60000; // Default: check every minute
  #notificationRouter: NotificationRouter | null = null;

  constructor(services: Services) {
    this.#services = services;
  }

  /**
   * Gets the Knex instance from the database service.
   */
  #db = (): Knex => {
    return this.#services.get(DatabaseService).knex;
  };

  /**
   * Configures the scheduler.
   */
  configure = (config: { checkIntervalMs?: number; notificationRouter?: NotificationRouter }): void => {
    if (config.checkIntervalMs) {
      this.#checkIntervalMs = config.checkIntervalMs;
    }
    if (config.notificationRouter) {
      this.#notificationRouter = config.notificationRouter;
    }
  };

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Starts the scheduler loop.
   */
  start = async (): Promise<void> => {
    if (this.#running) {
      throw new SchedulerAlreadyRunningError();
    }

    // Ensure builtin checks exist
    await this.#ensureBuiltinChecks();

    this.#running = true;

    // Run immediately
    await this.#runLoop();

    // Set up interval
    this.#intervalId = setInterval(() => {
      this.#runLoop().catch((error) => {
        console.error('Proactive scheduler error:', error);
      });
    }, this.#checkIntervalMs);
  };

  /**
   * Stops the scheduler.
   */
  stop = (): void => {
    this.#running = false;
    if (this.#intervalId) {
      clearInterval(this.#intervalId);
      this.#intervalId = null;
    }
  };

  /**
   * Checks if the scheduler is running.
   */
  get isRunning(): boolean {
    return this.#running;
  }

  // ==========================================================================
  // Check Operations
  // ==========================================================================

  /**
   * Creates a new check.
   */
  createCheck = async (input: CreateCheckInput): Promise<ProactiveCheck> => {
    // Validate cron expression
    parseCron(input.schedule);

    // Check for duplicate name
    const existing = await getCheckByName(this.#db(), input.name);
    if (existing) {
      throw new CheckAlreadyExistsError(input.name);
    }

    return createCheck(this.#db(), input);
  };

  /**
   * Gets a check by ID.
   */
  getCheck = async (id: string): Promise<ProactiveCheck | null> => {
    return getCheck(this.#db(), id);
  };

  /**
   * Gets a check by name.
   */
  getCheckByName = async (name: string): Promise<ProactiveCheck | null> => {
    return getCheckByName(this.#db(), name);
  };

  /**
   * Gets a check by ID, throws if not found.
   */
  requireCheck = async (id: string): Promise<ProactiveCheck> => {
    const check = await this.getCheck(id);
    if (!check) {
      throw new CheckNotFoundError(id);
    }
    return check;
  };

  /**
   * Updates a check.
   */
  updateCheck = async (id: string, updates: UpdateCheckInput): Promise<ProactiveCheck> => {
    // Validate cron if being updated
    if (updates.schedule) {
      parseCron(updates.schedule);
    }

    const check = await updateCheck(this.#db(), id, updates);
    if (!check) {
      throw new CheckNotFoundError(id);
    }
    return check;
  };

  /**
   * Deletes a check.
   */
  deleteCheck = async (id: string): Promise<boolean> => {
    return deleteCheck(this.#db(), id);
  };

  /**
   * Lists checks with optional filtering.
   */
  listChecks = async (options?: { enabled?: boolean; checkType?: string }): Promise<ProactiveCheck[]> => {
    return listChecks(this.#db(), options);
  };

  /**
   * Enables a check.
   */
  enableCheck = async (id: string): Promise<ProactiveCheck> => {
    return this.updateCheck(id, { enabled: true });
  };

  /**
   * Disables a check.
   */
  disableCheck = async (id: string): Promise<ProactiveCheck> => {
    return this.updateCheck(id, { enabled: false });
  };

  // ==========================================================================
  // Executor Registration
  // ==========================================================================

  /**
   * Registers a custom check executor.
   */
  registerExecutor = (checkName: string, executor: CheckExecutor): void => {
    this.#customExecutors.set(checkName, executor);
  };

  /**
   * Unregisters a custom check executor.
   */
  unregisterExecutor = (checkName: string): void => {
    this.#customExecutors.delete(checkName);
  };

  // ==========================================================================
  // Run Operations
  // ==========================================================================

  /**
   * Gets a run by ID.
   */
  getRun = async (id: string): Promise<ProactiveRun | null> => {
    return getRun(this.#db(), id);
  };

  /**
   * Gets a run by ID, throws if not found.
   */
  requireRun = async (id: string): Promise<ProactiveRun> => {
    const run = await this.getRun(id);
    if (!run) {
      throw new RunNotFoundError(id);
    }
    return run;
  };

  /**
   * Lists runs with optional filtering.
   */
  listRuns = async (options?: { checkId?: string; status?: RunStatus; limit?: number }): Promise<ProactiveRun[]> => {
    return listRuns(this.#db(), options);
  };

  /**
   * Gets the latest run for a check.
   */
  getLatestRun = async (checkId: string): Promise<ProactiveRun | null> => {
    return getLatestRun(this.#db(), checkId);
  };

  /**
   * Manually triggers a check execution.
   */
  runCheck = async (checkId: string): Promise<ProactiveRun> => {
    const check = await this.requireCheck(checkId);
    return this.#executeCheck(check);
  };

  // ==========================================================================
  // Internal
  // ==========================================================================

  /**
   * Ensures builtin checks are registered in the database.
   */
  #ensureBuiltinChecks = async (): Promise<void> => {
    const inputs = getBuiltinCheckInputs();

    for (const input of inputs) {
      const existing = await getCheckByName(this.#db(), input.name);
      if (!existing) {
        await createCheck(this.#db(), input);
      }
    }
  };

  /**
   * Main scheduler loop.
   */
  #runLoop = async (): Promise<void> => {
    if (!this.#running) {
      return;
    }

    const now = new Date();
    const checks = await getEnabledChecks(this.#db());

    for (const check of checks) {
      if (shouldRunCheck(check, now)) {
        try {
          await this.#executeCheck(check);
        } catch (error) {
          console.error(`Error executing check ${check.name}:`, error);
        }
      }
    }
  };

  /**
   * Executes a single check.
   */
  #executeCheck = async (check: ProactiveCheck): Promise<ProactiveRun> => {
    // Create run record
    const run = await createRun(this.#db(), check.id);
    const timestamp = new Date().toISOString();

    try {
      // Get executor
      const executor = this.#getExecutor(check);
      if (!executor) {
        // No executor - skip
        const skippedRun = await completeRun(this.#db(), run.id, null);
        await updateCheck(this.#db(), check.id, { lastRunAt: timestamp });
        if (!skippedRun) {
          throw new CheckExecutionError(check.id, new Error('Failed to complete skipped run'));
        }
        return skippedRun;
      }

      // Execute the check
      const result = await executor({
        checkId: check.id,
        config: check.config ?? {},
      });

      // Handle result
      let notificationId: string | undefined;

      if (result && result.shouldNotify && this.#notificationRouter) {
        // Create notification
        const notification = await this.#notificationRouter.notify({
          type: result.suggestedAction.type === 'question' ? 'action_required' : 'info',
          title: result.finding,
          body: result.suggestedAction.content,
          urgency: result.urgency,
          sourceType: 'proactive_check',
          sourceId: check.id,
          proactiveRunId: run.id,
        });
        notificationId = notification.id;
      }

      // Complete the run
      const completedRun = await completeRun(this.#db(), run.id, result, notificationId);

      // Update check with last run info
      await updateCheck(this.#db(), check.id, {
        lastRunAt: timestamp,
        lastResult: result,
      });

      if (!completedRun) {
        throw new CheckExecutionError(check.id, new Error('Failed to complete run'));
      }
      return completedRun;
    } catch (error) {
      // Fail the run
      const errorMessage = error instanceof Error ? error.message : String(error);
      await failRun(this.#db(), run.id, errorMessage);

      // Still update last run time
      await updateCheck(this.#db(), check.id, { lastRunAt: timestamp });

      throw new CheckExecutionError(check.id, error instanceof Error ? error : undefined);
    }
  };

  /**
   * Gets the executor for a check.
   */
  #getExecutor = (check: ProactiveCheck): CheckExecutor | null => {
    // Check custom executors first
    const custom = this.#customExecutors.get(check.name);
    if (custom) {
      return custom;
    }

    // Check builtin executors
    if (check.checkType === 'builtin') {
      return getBuiltinExecutor(check.name, this.#services);
    }

    return null;
  };
}

// ============================================================================
// Re-exports
// ============================================================================

export type {
  CheckType,
  RunStatus,
  SuggestedAction,
  ProactiveResult,
  ProactiveCheck,
  CreateCheckInput,
  UpdateCheckInput,
  ProactiveRun,
  CheckContext,
  CheckExecutor,
} from './proactive.schemas.ts';

export {
  checkTypeSchema,
  runStatusSchema,
  suggestedActionTypeSchema,
  suggestedActionSchema,
  proactiveResultSchema,
  proactiveCheckSchema,
  createCheckInputSchema,
  updateCheckInputSchema,
  proactiveRunSchema,
} from './proactive.schemas.ts';

export {
  CheckNotFoundError,
  CheckAlreadyExistsError,
  CheckExecutionError,
  RunNotFoundError,
  InvalidCronExpressionError,
  SchedulerAlreadyRunningError,
} from './proactive.errors.ts';

export { getBuiltinCheckDefinitions, getBuiltinCheckInputs, BUILTIN_CHECKS } from './proactive.checks.ts';

export { parseCron, matchesCron, shouldRunCheck, ProactiveScheduler };
