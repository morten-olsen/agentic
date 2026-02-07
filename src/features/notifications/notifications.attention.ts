import type { Knex } from 'knex';

import type { AttentionBudget, Urgency, NotificationTier, NotificationDecision } from './notifications.schemas.ts';
import { getAttentionBudget, updateAttentionBudget, resetInterruptions } from './notifications.store.ts';

// ============================================================================
// Configuration Types
// ============================================================================

type AttentionConfig = {
  quietHoursStart: string; // HH:mm format
  quietHoursEnd: string; // HH:mm format
  maxInterruptionsPerHour: number;
  batchingThresholdMinutes: number; // Minimum time between non-critical notifications
};

const DEFAULT_CONFIG: AttentionConfig = {
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  maxInterruptionsPerHour: 5,
  batchingThresholdMinutes: 15,
};

// ============================================================================
// Time Helpers
// ============================================================================

/**
 * Parses a time string (HH:mm) into hours and minutes.
 */
const parseTime = (time: string): { hours: number; minutes: number } => {
  const [hours, minutes] = time.split(':').map(Number);
  return { hours: hours ?? 0, minutes: minutes ?? 0 };
};

/**
 * Gets the current time as hours and minutes.
 */
const getCurrentTime = (now: Date = new Date()): { hours: number; minutes: number } => {
  return { hours: now.getHours(), minutes: now.getMinutes() };
};

/**
 * Converts hours and minutes to minutes since midnight.
 */
const toMinutes = ({ hours, minutes }: { hours: number; minutes: number }): number => {
  return hours * 60 + minutes;
};

/**
 * Checks if the current time is within quiet hours.
 */
const isQuietHours = (config: AttentionConfig, now: Date = new Date()): boolean => {
  const current = toMinutes(getCurrentTime(now));
  const start = toMinutes(parseTime(config.quietHoursStart));
  const end = toMinutes(parseTime(config.quietHoursEnd));

  // Handle overnight quiet hours (e.g., 22:00 to 07:00)
  if (start > end) {
    // Quiet hours span midnight
    return current >= start || current < end;
  } else {
    // Quiet hours within same day
    return current >= start && current < end;
  }
};

/**
 * Calculates the next time quiet hours end.
 */
const getQuietHoursEnd = (config: AttentionConfig, now: Date = new Date()): Date => {
  const end = parseTime(config.quietHoursEnd);
  const result = new Date(now);
  result.setHours(end.hours, end.minutes, 0, 0);

  // If the end time has already passed today, it's tomorrow
  if (result <= now) {
    result.setDate(result.getDate() + 1);
  }

  return result;
};

// ============================================================================
// Interruption Tracking
// ============================================================================

/**
 * Checks if the interruption counter should be reset (hourly).
 */
const shouldResetCounter = (budget: AttentionBudget): boolean => {
  const lastReset = new Date(budget.lastResetAt);
  const now = new Date();
  const hoursSinceReset = (now.getTime() - lastReset.getTime()) / (1000 * 60 * 60);
  return hoursSinceReset >= 1;
};

/**
 * Gets the current attention budget, resetting if needed.
 */
const getEffectiveBudget = async (db: Knex, config: AttentionConfig): Promise<AttentionBudget> => {
  let budget = await getAttentionBudget(db);

  // Reset counter if an hour has passed
  if (shouldResetCounter(budget)) {
    budget = await resetInterruptions(db);
  }

  // Update quiet hours status
  const quietActive = isQuietHours(config);
  if (budget.quietHoursActive !== quietActive) {
    budget = await updateAttentionBudget(db, { quietHoursActive: quietActive });
  }

  return budget;
};

/**
 * Checks if we've exceeded the interruption limit.
 */
const isOverBudget = (budget: AttentionBudget, config: AttentionConfig): boolean => {
  return budget.recentInterruptions >= config.maxInterruptionsPerHour;
};

/**
 * Checks if we're within the batching threshold (too soon since last interruption).
 */
const isWithinBatchingThreshold = (budget: AttentionBudget, config: AttentionConfig): boolean => {
  if (!budget.lastInterruptionAt) return false;

  const lastInterruption = new Date(budget.lastInterruptionAt);
  const now = new Date();
  const minutesSinceLast = (now.getTime() - lastInterruption.getTime()) / (1000 * 60);

  return minutesSinceLast < config.batchingThresholdMinutes;
};

// ============================================================================
// Tier Calculation
// ============================================================================

/**
 * Maps urgency to a notification tier based on current context.
 */
const calculateTier = (urgency: Urgency, budget: AttentionBudget): NotificationTier => {
  // Critical always maps to critical tier
  if (urgency === 'critical') {
    return 'critical';
  }

  // Check DND mode
  if (budget.manualDndUntil) {
    const dndUntil = new Date(budget.manualDndUntil);
    if (new Date() < dndUntil) {
      // DND active - only critical gets through
      return 'background';
    }
  }

  // Check focus block
  if (budget.focusBlockActive) {
    // During focus, demote everything except high urgency
    if (urgency === 'high') {
      return 'medium';
    }
    return 'background';
  }

  // Check quiet hours
  if (budget.quietHoursActive) {
    // During quiet hours, high becomes medium, others become low/background
    if (urgency === 'high') {
      return 'medium';
    } else if (urgency === 'medium') {
      return 'low';
    }
    return 'background';
  }

  // Normal mapping
  switch (urgency) {
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    case 'low':
      return 'low';
    default:
      return 'low';
  }
};

// ============================================================================
// Routing Decision
// ============================================================================

/**
 * Makes a routing decision for a notification.
 */
const makeRoutingDecision = async (
  db: Knex,
  urgency: Urgency,
  config: AttentionConfig = DEFAULT_CONFIG,
): Promise<NotificationDecision> => {
  const budget = await getEffectiveBudget(db, config);
  const tier = calculateTier(urgency, budget);

  // Critical always notifies immediately
  if (tier === 'critical') {
    return {
      shouldNotify: true,
      tier: 'critical',
      reason: 'Critical notifications always interrupt',
    };
  }

  // Background tier never actively notifies
  if (tier === 'background') {
    const reason = budget.manualDndUntil
      ? 'Do Not Disturb is active'
      : budget.focusBlockActive
        ? 'Focus block is active'
        : budget.quietHoursActive
          ? 'Quiet hours are active'
          : 'Notification batched as background';

    return {
      shouldNotify: false,
      tier: 'background',
      reason,
      delayUntil:
        budget.manualDndUntil ?? (budget.quietHoursActive ? getQuietHoursEnd(config).toISOString() : undefined),
    };
  }

  // Check interruption budget
  if (isOverBudget(budget, config)) {
    return {
      shouldNotify: false,
      tier,
      reason: `Interruption limit reached (${budget.recentInterruptions}/${config.maxInterruptionsPerHour} per hour)`,
    };
  }

  // For medium/low tiers, check batching threshold
  if ((tier === 'medium' || tier === 'low') && isWithinBatchingThreshold(budget, config)) {
    const lastInterruption = budget.lastInterruptionAt ? new Date(budget.lastInterruptionAt) : new Date();
    const delayUntil = new Date(lastInterruption.getTime() + config.batchingThresholdMinutes * 60 * 1000);

    return {
      shouldNotify: false,
      tier,
      reason: `Too soon since last notification (batching threshold: ${config.batchingThresholdMinutes} minutes)`,
      delayUntil: delayUntil.toISOString(),
    };
  }

  // High tier notifications go through without batching
  return {
    shouldNotify: true,
    tier,
    reason: tier === 'high' ? 'High priority notification' : 'Notification approved within budget',
  };
};

/**
 * Sets Do Not Disturb mode.
 */
const setDoNotDisturb = async (db: Knex, until: Date | null): Promise<AttentionBudget> => {
  // Pass explicit undefined when clearing DND, or the ISO string when setting
  return updateAttentionBudget(db, {
    manualDndUntil: until === null ? undefined : until.toISOString(),
  });
};

/**
 * Sets focus block mode.
 */
const setFocusBlock = async (db: Knex, active: boolean): Promise<AttentionBudget> => {
  return updateAttentionBudget(db, {
    focusBlockActive: active,
  });
};

/**
 * Updates user responsiveness based on interaction patterns.
 */
const updateResponsiveness = async (
  db: Knex,
  responsiveness: AttentionBudget['userResponsiveness'],
): Promise<AttentionBudget> => {
  return updateAttentionBudget(db, { userResponsiveness: responsiveness });
};

// ============================================================================
// Exports
// ============================================================================

export type { AttentionConfig };

export {
  DEFAULT_CONFIG,
  isQuietHours,
  getQuietHoursEnd,
  shouldResetCounter,
  getEffectiveBudget,
  isOverBudget,
  isWithinBatchingThreshold,
  calculateTier,
  makeRoutingDecision,
  setDoNotDisturb,
  setFocusBlock,
  updateResponsiveness,
};
