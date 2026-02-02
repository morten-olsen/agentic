import type { Trigger } from './triggers.schemas.ts';
import { InvalidScheduleError } from './triggers.errors.ts';

// ============================================================================
// Cron Parsing
// ============================================================================

/**
 * Parsed cron fields.
 */
type CronFields = {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
};

/**
 * Parses a range field from a cron expression.
 */
const parseRange = (field: string, min: number, max: number): number[] => {
  if (field === '*') {
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }

  const values: number[] = [];

  // Handle comma-separated values
  const parts = field.split(',');
  for (const part of parts) {
    // Handle ranges like "1-5"
    if (part.includes('-') && !part.startsWith('*/')) {
      const [start, end] = part.split('-').map(Number);
      if (start !== undefined && end !== undefined && !isNaN(start) && !isNaN(end)) {
        for (let i = start; i <= end; i++) {
          if (i >= min && i <= max && !values.includes(i)) {
            values.push(i);
          }
        }
      }
    } else if (part.startsWith('*/')) {
      // Handle step values like "*/15"
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

  return values.sort((a, b) => a - b);
};

/**
 * Parses a cron expression into its component fields.
 */
const parseCronExpression = (expression: string): CronFields => {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new InvalidScheduleError(expression, 'Cron expression must have 5 fields');
  }

  const minutePart = parts[0];
  const hourPart = parts[1];
  const dayOfMonthPart = parts[2];
  const monthPart = parts[3];
  const dayOfWeekPart = parts[4];

  if (!minutePart || !hourPart || !dayOfMonthPart || !monthPart || !dayOfWeekPart) {
    throw new InvalidScheduleError(expression, 'Invalid cron expression');
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
    throw new InvalidScheduleError(expression, 'Failed to parse cron fields');
  }
};

/**
 * Validates a cron expression.
 * Returns true if valid, throws InvalidScheduleError if not.
 */
const validateCronExpression = (expression: string): boolean => {
  parseCronExpression(expression);
  return true;
};

/**
 * Gets the next occurrence of a cron expression after a given date.
 */
const getNextCronTime = (expression: string, after: Date = new Date()): Date | null => {
  const fields = parseCronExpression(expression);

  // Start from the next minute
  const next = new Date(after.getTime());
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);

  // Search for up to a year
  const maxIterations = 366 * 24 * 60; // 1 year in minutes
  let iterations = 0;

  while (iterations < maxIterations) {
    const minute = next.getMinutes();
    const hour = next.getHours();
    const dayOfMonth = next.getDate();
    const month = next.getMonth() + 1;
    const dayOfWeek = next.getDay();

    const matchesMinute = fields.minute.includes(minute);
    const matchesHour = fields.hour.includes(hour);
    const matchesDayOfMonth = fields.dayOfMonth.includes(dayOfMonth);
    const matchesMonth = fields.month.includes(month);
    const matchesDayOfWeek = fields.dayOfWeek.includes(dayOfWeek);

    if (matchesMinute && matchesHour && matchesDayOfMonth && matchesMonth && matchesDayOfWeek) {
      return next;
    }

    // Advance by one minute
    next.setMinutes(next.getMinutes() + 1);
    iterations++;
  }

  // No match found within a year
  return null;
};

// ============================================================================
// Schedule Calculation
// ============================================================================

/**
 * Calculates the next invocation time for a trigger.
 * Returns null if the trigger should not be invoked again.
 */
const calculateNextInvocation = (trigger: Trigger, afterTime: Date = new Date()): Date | null => {
  // Check if max invocations reached
  if (trigger.maxInvocations !== undefined && trigger.invocationCount >= trigger.maxInvocations) {
    return null;
  }

  // Check if end date passed
  if (trigger.endsAt) {
    const endsAt = new Date(trigger.endsAt);
    if (afterTime >= endsAt) {
      return null;
    }
  }

  if (trigger.schedule.type === 'once') {
    const at = new Date(trigger.schedule.at);
    // For one-time triggers in the future, return the time
    if (at > afterTime) {
      return at;
    }
    // For one-time triggers in the past that never fired, return the time
    // so catch-up logic can decide whether to fire
    if (trigger.invocationCount === 0) {
      return at;
    }
    // Already fired or too old
    return null;
  }

  // Cron schedule
  const nextTime = getNextCronTime(trigger.schedule.expression, afterTime);

  // Check if next time is after end date
  if (nextTime && trigger.endsAt) {
    const endsAt = new Date(trigger.endsAt);
    if (nextTime >= endsAt) {
      return null;
    }
  }

  return nextTime;
};

// ============================================================================
// Trigger Scheduler
// ============================================================================

type OnFireCallback = (triggerId: string) => Promise<void>;

/**
 * In-memory scheduler for triggers.
 * Uses setTimeout for precise timing.
 */
class TriggerScheduler {
  #timers = new Map<string, ReturnType<typeof setTimeout>>();
  #onFire: OnFireCallback;

  constructor(onFire: OnFireCallback) {
    this.#onFire = onFire;
  }

  /**
   * Schedules a trigger to fire at its next invocation time.
   * Cancels any existing timer for this trigger.
   */
  schedule = (trigger: Trigger): boolean => {
    console.log('[TriggerScheduler.schedule] Trigger:', trigger.name, 'status:', trigger.status);

    // Cancel existing timer if any
    this.cancel(trigger.id);

    // Only schedule active triggers
    if (trigger.status !== 'active') {
      console.log('[TriggerScheduler.schedule] Not active, skipping');
      return false;
    }

    // Calculate when to fire
    const nextTime = calculateNextInvocation(trigger);
    if (!nextTime) {
      console.log('[TriggerScheduler.schedule] No next time, skipping');
      return false;
    }

    const delay = nextTime.getTime() - Date.now();
    console.log('[TriggerScheduler.schedule] Next time:', nextTime.toISOString(), 'delay:', delay, 'ms');

    // If delay is negative or zero, fire immediately
    if (delay <= 0) {
      console.log('[TriggerScheduler.schedule] Firing immediately');
      // Fire asynchronously to avoid blocking
      setImmediate(() => {
        void this.#onFire(trigger.id);
      });
      return true;
    }

    console.log('[TriggerScheduler.schedule] Setting timer for', delay, 'ms');
    // Schedule the timer
    const timer = setTimeout(() => {
      this.#timers.delete(trigger.id);
      void this.#onFire(trigger.id);
    }, delay);

    this.#timers.set(trigger.id, timer);
    return true;
  };

  /**
   * Schedules a trigger to fire at a specific time.
   */
  scheduleAt = (triggerId: string, at: Date): boolean => {
    // Cancel existing timer if any
    this.cancel(triggerId);

    const delay = at.getTime() - Date.now();

    // If delay is negative or zero, fire immediately
    if (delay <= 0) {
      setImmediate(() => {
        void this.#onFire(triggerId);
      });
      return true;
    }

    // Schedule the timer
    const timer = setTimeout(() => {
      this.#timers.delete(triggerId);
      void this.#onFire(triggerId);
    }, delay);

    this.#timers.set(triggerId, timer);
    return true;
  };

  /**
   * Cancels the timer for a trigger.
   */
  cancel = (triggerId: string): boolean => {
    const timer = this.#timers.get(triggerId);
    if (timer) {
      clearTimeout(timer);
      this.#timers.delete(triggerId);
      return true;
    }
    return false;
  };

  /**
   * Cancels all timers.
   */
  cancelAll = (): void => {
    for (const timer of this.#timers.values()) {
      clearTimeout(timer);
    }
    this.#timers.clear();
  };

  /**
   * Gets the number of scheduled timers.
   */
  get scheduledCount(): number {
    return this.#timers.size;
  }

  /**
   * Checks if a trigger has a scheduled timer.
   */
  isScheduled = (triggerId: string): boolean => {
    return this.#timers.has(triggerId);
  };
}

// ============================================================================
// Exports
// ============================================================================

export type { CronFields, OnFireCallback };

export {
  // Cron utilities
  parseCronExpression,
  validateCronExpression,
  getNextCronTime,
  // Schedule calculation
  calculateNextInvocation,
  // Scheduler
  TriggerScheduler,
};
