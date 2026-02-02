import type { Knex } from 'knex';

import type { Services } from '../services/services.ts';
import { DatabaseService } from '../database/database.ts';
import type { OrchestratorService } from '../orchestrator/orchestrator.ts';
import type { TelegramClientService } from '../clients/telegram/telegram.ts';

import type {
  Trigger,
  TriggerStatus,
  CreateTriggerInput,
  UpdateTriggerInput,
  TriggerContext,
  NotifyInput,
  NotifyResult,
} from './triggers.schemas.ts';
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
  getTriggerByConversation,
} from './triggers.store.ts';
import { TriggerScheduler, calculateNextInvocation, validateCronExpression } from './triggers.scheduler.ts';
import {
  TriggerNotFoundError,
  InvalidScheduleError,
  TriggerLimitExceededError,
  TriggerAlreadyExistsError,
  TriggerExecutionError,
  TriggerServiceNotConfiguredError,
} from './triggers.errors.ts';

// ============================================================================
// Configuration
// ============================================================================

type TriggerServiceConfig = {
  enabled?: boolean;
  catchUpMissed?: boolean;
  maxCatchUpAgeMs?: number;
  maxConsecutiveFailures?: number;
  maxTriggersPerUser?: number;
};

const DEFAULT_CONFIG: Required<TriggerServiceConfig> = {
  enabled: true,
  catchUpMissed: true,
  maxCatchUpAgeMs: 3600000, // 1 hour
  maxConsecutiveFailures: 3,
  maxTriggersPerUser: 100,
};

// ============================================================================
// Pre-installed Triggers
// ============================================================================

type PreinstalledTrigger = CreateTriggerInput & { preinstalled: true };

const PREINSTALLED_TRIGGERS: PreinstalledTrigger[] = [
  {
    preinstalled: true,
    name: 'daily-briefing',
    goal: 'Provide the user with a daily briefing including calendar events for today, pending tasks, and any important reminders. Only notify if there is something meaningful to share.',
    schedule: { type: 'cron', expression: '0 8 * * 1-5' }, // Weekdays at 8 AM
    setupContext: 'Daily morning briefing to help the user start their day.',
  },
  {
    preinstalled: true,
    name: 'calendar-lookahead',
    goal: 'Check for upcoming calendar events in the next hour. Notify the user if there is an event starting soon that they should prepare for.',
    schedule: { type: 'cron', expression: '0 * * * *' }, // Every hour
    setupContext: 'Hourly calendar check to ensure user is aware of upcoming events.',
  },
  {
    preinstalled: true,
    name: 'stale-followups',
    goal: 'Review contacts and tasks for any follow-ups that are overdue or becoming stale. Notify the user if there are people they should reach out to.',
    schedule: { type: 'cron', expression: '0 9 * * *' }, // Daily at 9 AM
    setupContext: 'Daily check for relationship maintenance and stale follow-ups.',
  },
];

// ============================================================================
// TriggerService
// ============================================================================

/**
 * TriggerService - manages scheduled agent invocations.
 */
class TriggerService {
  #services: Services;
  #config: Required<TriggerServiceConfig> = DEFAULT_CONFIG;
  #scheduler: TriggerScheduler;
  #orchestrator: OrchestratorService | null = null;
  #telegramClient: TelegramClientService | null = null;
  #running = false;

  constructor(services: Services) {
    this.#services = services;
    this.#scheduler = new TriggerScheduler(this.#fire);
  }

  /**
   * Gets the Knex instance from the database service.
   */
  #db = (): Knex => {
    return this.#services.get(DatabaseService).knex;
  };

  /**
   * Configures the trigger service with required dependencies.
   */
  configure = (deps: {
    orchestrator: OrchestratorService;
    telegramClient?: TelegramClientService;
    config?: TriggerServiceConfig;
  }): void => {
    this.#orchestrator = deps.orchestrator;
    this.#telegramClient = deps.telegramClient ?? null;
    this.#config = { ...DEFAULT_CONFIG, ...deps.config };
  };

  /**
   * Checks if the service is configured.
   */
  get isConfigured(): boolean {
    return this.#orchestrator !== null;
  }

  /**
   * Checks if the service is running.
   */
  get isRunning(): boolean {
    return this.#running;
  }

  /**
   * Gets the number of scheduled triggers.
   */
  get scheduledCount(): number {
    return this.#scheduler.scheduledCount;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Starts the trigger service.
   * Loads all active triggers and schedules them.
   */
  start = async (): Promise<void> => {
    if (!this.#orchestrator) {
      throw new TriggerServiceNotConfiguredError();
    }

    if (this.#running) {
      return;
    }

    this.#running = true;

    // Ensure pre-installed triggers exist
    await this.#ensurePreinstalledTriggers();

    // Load and schedule all active triggers
    const activeTriggers = await getActiveTriggers(this.#db());

    for (const trigger of activeTriggers) {
      await this.#scheduleNext(trigger);
    }

    console.log(`TriggerService started with ${this.#scheduler.scheduledCount} scheduled triggers`);
  };

  /**
   * Stops the trigger service.
   * Cancels all scheduled timers.
   */
  stop = async (): Promise<void> => {
    this.#running = false;
    this.#scheduler.cancelAll();
    console.log('TriggerService stopped');
  };

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  /**
   * Creates a new trigger.
   */
  create = async (input: CreateTriggerInput, conversationId?: string): Promise<Trigger> => {
    // Validate schedule
    if (input.schedule.type === 'cron') {
      validateCronExpression(input.schedule.expression);
    } else {
      const at = new Date(input.schedule.at);
      if (isNaN(at.getTime())) {
        throw new InvalidScheduleError(input.schedule.at, 'Invalid datetime');
      }
    }

    // Check for duplicate name
    const existing = await getTriggerByName(this.#db(), input.name);
    if (existing) {
      throw new TriggerAlreadyExistsError(input.name);
    }

    // Check trigger limit
    const count = await countTriggers(this.#db());
    if (count >= this.#config.maxTriggersPerUser) {
      throw new TriggerLimitExceededError(this.#config.maxTriggersPerUser, count);
    }

    // Create the trigger
    const trigger = await createTrigger(this.#db(), input, conversationId);

    // Calculate and set next invocation time
    const nextInvocation = calculateNextInvocation(trigger);
    if (nextInvocation) {
      const updatedTrigger = await updateTrigger(this.#db(), trigger.id, {
        nextInvocationAt: nextInvocation.toISOString(),
      });

      // Schedule if running
      if (this.#running && updatedTrigger) {
        this.#scheduler.schedule(updatedTrigger);
      }

      return updatedTrigger ?? trigger;
    }

    return trigger;
  };

  /**
   * Gets a trigger by ID.
   */
  get = async (id: string): Promise<Trigger | null> => {
    return getTrigger(this.#db(), id);
  };

  /**
   * Gets a trigger by ID, throws if not found.
   */
  require = async (id: string): Promise<Trigger> => {
    const trigger = await this.get(id);
    if (!trigger) {
      throw new TriggerNotFoundError(id);
    }
    return trigger;
  };

  /**
   * Gets a trigger by name.
   */
  getByName = async (name: string): Promise<Trigger | null> => {
    return getTriggerByName(this.#db(), name);
  };

  /**
   * Updates a trigger.
   */
  update = async (id: string, input: UpdateTriggerInput): Promise<Trigger> => {
    // Validate schedule if being updated
    if (input.schedule) {
      if (input.schedule.type === 'cron') {
        validateCronExpression(input.schedule.expression);
      } else {
        const at = new Date(input.schedule.at);
        if (isNaN(at.getTime())) {
          throw new InvalidScheduleError(input.schedule.at, 'Invalid datetime');
        }
      }
    }

    const trigger = await updateTrigger(this.#db(), id, input);
    if (!trigger) {
      throw new TriggerNotFoundError(id);
    }

    // Reschedule if needed
    if (this.#running && (input.schedule || input.status)) {
      this.#scheduler.cancel(id);
      if (trigger.status === 'active') {
        await this.#scheduleNext(trigger);
      }
    }

    return trigger;
  };

  /**
   * Deletes a trigger.
   */
  delete = async (id: string): Promise<void> => {
    // Cancel any scheduled timer
    this.#scheduler.cancel(id);

    const deleted = await deleteTrigger(this.#db(), id);
    if (!deleted) {
      throw new TriggerNotFoundError(id);
    }
  };

  /**
   * Lists triggers with optional filtering.
   */
  list = async (options?: { status?: TriggerStatus; limit?: number }): Promise<Trigger[]> => {
    return listTriggers(this.#db(), options);
  };

  // ==========================================================================
  // Conversation Queries
  // ==========================================================================

  /**
   * Gets the trigger that created a conversation (if any).
   */
  getByConversation = async (conversationId: string): Promise<Trigger | null> => {
    return getTriggerByConversation(this.#db(), conversationId);
  };

  /**
   * Gets conversations created by a trigger.
   */
  getConversations = async (triggerId: string, options?: { limit?: number }): Promise<string[]> => {
    const junctions = await getTriggerConversations(this.#db(), triggerId, options);
    return junctions.map((j) => j.conversationId);
  };

  // ==========================================================================
  // Notifications
  // ==========================================================================

  /**
   * Sends a notification to the user via Telegram.
   * Returns the notification result.
   */
  sendNotification = async (input: NotifyInput): Promise<NotifyResult> => {
    const notificationId = crypto.randomUUID();

    if (!this.#telegramClient) {
      console.warn('Notification not delivered: Telegram client not configured');
      return { notificationId, delivered: false };
    }

    try {
      // Format the message
      const urgencyEmoji =
        input.urgency === 'critical' ? '🚨' : input.urgency === 'high' ? '⚠️' : input.urgency === 'low' ? 'ℹ️' : '📢';

      const message = `${urgencyEmoji} *${input.title}*\n\n${input.body}`;

      // Send via Telegram
      const ownerId = this.#telegramClient.ownerId;
      if (ownerId) {
        await this.#telegramClient.sendMessage(ownerId, message);
        return { notificationId, delivered: true };
      }

      console.warn('Notification not delivered: Owner ID not configured');
      return { notificationId, delivered: false };
    } catch (error) {
      console.error('Failed to send notification:', error);
      return { notificationId, delivered: false };
    }
  };

  // ==========================================================================
  // Internal Methods
  // ==========================================================================

  /**
   * Ensures pre-installed triggers exist.
   */
  #ensurePreinstalledTriggers = async (): Promise<void> => {
    for (const preset of PREINSTALLED_TRIGGERS) {
      const existing = await getTriggerByName(this.#db(), preset.name);
      if (!existing) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { preinstalled: _preinstalled, ...input } = preset;
        await this.create(input);
        console.log(`Created pre-installed trigger: ${preset.name}`);
      }
    }
  };

  /**
   * Schedules the next invocation for a trigger.
   */
  #scheduleNext = async (trigger: Trigger): Promise<void> => {
    const now = new Date();
    const nextTime = calculateNextInvocation(trigger, now);

    if (!nextTime) {
      // Trigger is complete (one-time triggered, max reached, or past end date)
      if (trigger.status === 'active') {
        await updateTrigger(this.#db(), trigger.id, {
          status: 'completed',
          nextInvocationAt: null,
        });
      }
      return;
    }

    // Update the next invocation time in DB
    await updateTrigger(this.#db(), trigger.id, {
      nextInvocationAt: nextTime.toISOString(),
    });

    // Check if we should catch up
    if (this.#config.catchUpMissed) {
      const missedMs = now.getTime() - nextTime.getTime();
      if (missedMs > 0 && missedMs <= this.#config.maxCatchUpAgeMs) {
        // Fire immediately for catch-up
        console.log(`Catching up missed trigger: ${trigger.name}`);
        void this.#fire(trigger.id);
        return;
      }
    }

    // Schedule the timer
    this.#scheduler.scheduleAt(trigger.id, nextTime);
  };

  /**
   * Fires a trigger - invokes the agent with the trigger's goal.
   */
  #fire = async (triggerId: string): Promise<void> => {
    if (!this.#orchestrator) {
      console.error('Cannot fire trigger: orchestrator not configured');
      return;
    }

    const trigger = await getTrigger(this.#db(), triggerId);
    if (!trigger) {
      console.error(`Trigger not found: ${triggerId}`);
      return;
    }

    if (trigger.status !== 'active') {
      return;
    }

    console.log(`Firing trigger: ${trigger.name}`);

    try {
      // Update invocation state
      const timestamp = new Date().toISOString();
      await updateTrigger(this.#db(), triggerId, {
        lastInvokedAt: timestamp,
        invocationCount: trigger.invocationCount + 1,
        lastError: null,
      });

      // Build trigger context for the agent
      const triggerContext: TriggerContext = {
        triggerId: trigger.id,
        triggerName: trigger.name,
        goal: trigger.goal,
        setupContext: trigger.setupContext,
        invocationCount: trigger.invocationCount + 1,
        schedule: trigger.schedule,
      };

      // Invoke the orchestrator in background mode
      const conversationId = await this.#orchestrator.invokeBackground(trigger.goal, triggerContext);

      // Record the conversation
      await addTriggerConversation(this.#db(), triggerId, conversationId);

      // Reset consecutive failures on success
      await updateTrigger(this.#db(), triggerId, {
        consecutiveFailures: 0,
      });

      // Schedule next invocation
      const updatedTrigger = await getTrigger(this.#db(), triggerId);
      if (updatedTrigger && updatedTrigger.status === 'active') {
        await this.#scheduleNext(updatedTrigger);
      }
    } catch (error) {
      console.error(`Failed to fire trigger ${trigger.name}:`, error);

      // Track consecutive failures
      const failures = trigger.consecutiveFailures + 1;
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (failures >= this.#config.maxConsecutiveFailures) {
        // Mark as failed
        await updateTrigger(this.#db(), triggerId, {
          status: 'failed',
          consecutiveFailures: failures,
          lastError: errorMessage,
          nextInvocationAt: null,
        });

        // Notify user of failure
        await this.sendNotification({
          title: `Trigger Failed: ${trigger.name}`,
          body: `The trigger "${trigger.name}" has failed ${failures} consecutive times and has been paused.\n\nLast error: ${errorMessage}`,
          urgency: 'high',
        });
      } else {
        // Update failure count but keep trying
        await updateTrigger(this.#db(), triggerId, {
          consecutiveFailures: failures,
          lastError: errorMessage,
        });

        // Schedule next attempt
        const updatedTrigger = await getTrigger(this.#db(), triggerId);
        if (updatedTrigger && updatedTrigger.status === 'active') {
          await this.#scheduleNext(updatedTrigger);
        }
      }

      throw new TriggerExecutionError(triggerId, error instanceof Error ? error : undefined);
    }
  };
}

// ============================================================================
// Re-exports
// ============================================================================

export type {
  Trigger,
  TriggerSchedule,
  TriggerStatus,
  CreateTriggerInput,
  UpdateTriggerInput,
  TriggerContext,
  NotifyInput,
  NotifyResult,
  ModelTier,
} from './triggers.schemas.ts';

export {
  triggerSchema,
  triggerScheduleSchema,
  triggerStatusSchema,
  createTriggerInputSchema,
  updateTriggerInputSchema,
  triggerContextSchema,
  notifyInputSchema,
  notifyResultSchema,
  modelTierSchema,
} from './triggers.schemas.ts';

export {
  TriggerNotFoundError,
  InvalidScheduleError,
  TriggerLimitExceededError,
  TriggerAlreadyExistsError,
  TriggerExecutionError,
  NotifyNotAllowedError,
  TriggerServiceNotConfiguredError,
} from './triggers.errors.ts';

export {
  TriggerScheduler,
  calculateNextInvocation,
  validateCronExpression,
  parseCronExpression,
  getNextCronTime,
} from './triggers.scheduler.ts';

export type { TriggerServiceConfig };
export { TriggerService, PREINSTALLED_TRIGGERS };
