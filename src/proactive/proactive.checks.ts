import type { Services } from '../services/services.ts';
import { CalendarService } from '../calendar/calendar.ts';
import { TaskService } from '../tasks/tasks.ts';

import type { CheckContext, CheckExecutor, ProactiveResult, CreateCheckInput } from './proactive.schemas.ts';

// ============================================================================
// Built-in Check Definitions
// ============================================================================

type BuiltinCheckDefinition = {
  input: CreateCheckInput;
  executor: (services: Services) => CheckExecutor;
};

// ============================================================================
// Calendar Lookahead Check
// ============================================================================

/**
 * Checks for upcoming calendar events that may need preparation.
 * Runs hourly, looks for events in the next 30-60 minutes.
 */
const calendarLookaheadCheck: BuiltinCheckDefinition = {
  input: {
    name: 'calendar-lookahead',
    description: 'Checks for upcoming calendar events that may need preparation',
    schedule: '0 * * * *', // Every hour at minute 0
    checkType: 'builtin',
  },
  executor:
    (services: Services): CheckExecutor =>
    async (): Promise<ProactiveResult | null> => {
      const calendar = services.get(CalendarService);

      const now = new Date();
      const thirtyMinutes = new Date(now.getTime() + 30 * 60 * 1000);
      const sixtyMinutes = new Date(now.getTime() + 60 * 60 * 1000);

      // Get events in the 30-60 minute window
      const events = await calendar.getEventsInRange(thirtyMinutes, sixtyMinutes);

      // Filter to events that might need prep (meetings, calls)
      const prepEvents = events.filter((event) => {
        const title = event.title.toLowerCase();
        return (
          title.includes('meeting') ||
          title.includes('call') ||
          title.includes('interview') ||
          title.includes('presentation') ||
          title.includes('1:1') ||
          title.includes('standup') ||
          title.includes('sync')
        );
      });

      if (prepEvents.length === 0) {
        return null; // No finding
      }

      const nextEvent = prepEvents[0];
      if (!nextEvent) {
        return null;
      }

      const minutesUntil = Math.round((new Date(nextEvent.start).getTime() - now.getTime()) / (60 * 1000));

      return {
        finding: `You have "${nextEvent.title}" starting in ${minutesUntil} minutes`,
        urgency: 'medium',
        suggestedAction: {
          type: 'notify',
          content: `Upcoming: ${nextEvent.title} in ${minutesUntil} minutes`,
        },
        shouldNotify: true,
      };
    },
};

// ============================================================================
// Stale Follow-ups Check
// ============================================================================

/**
 * Checks for delegated tasks that have been waiting for too long.
 * Runs daily at 9am.
 */
const staleFollowupsCheck: BuiltinCheckDefinition = {
  input: {
    name: 'stale-followups',
    description: 'Checks for delegated tasks waiting for more than 3 days',
    schedule: '0 9 * * *', // Daily at 9am
    checkType: 'builtin',
  },
  executor:
    (services: Services): CheckExecutor =>
    async (context: CheckContext): Promise<ProactiveResult | null> => {
      const tasks = services.get(TaskService);

      const staleDays = (context.config.staleDays as number) ?? 3;
      const staleThreshold = new Date();
      staleThreshold.setDate(staleThreshold.getDate() - staleDays);

      // Get waiting tasks
      const waitingTasks = await tasks.getWaitingTasks();

      // Filter to tasks waiting longer than threshold
      const staleTasks = waitingTasks.filter((task) => {
        if (!task.waitingFor) return false;
        // Check when the task started waiting
        const waitingEvent = task.history.find((e) => e.type === 'waiting');
        if (!waitingEvent) return false;
        return new Date(waitingEvent.timestamp) < staleThreshold;
      });

      if (staleTasks.length === 0) {
        return null;
      }

      const descriptions = staleTasks.slice(0, 3).map((t) => t.description);
      const moreCount = staleTasks.length > 3 ? ` (+${staleTasks.length - 3} more)` : '';

      return {
        finding: `${staleTasks.length} task(s) have been waiting for more than ${staleDays} days`,
        urgency: 'medium',
        suggestedAction: {
          type: 'question',
          content: `Should I follow up on these stale tasks?\n\n${descriptions.join('\n')}${moreCount}`,
          options: ['Yes, follow up', 'Remind me later', 'Dismiss'],
        },
        shouldNotify: true,
      };
    },
};

// ============================================================================
// Daily Briefing Check
// ============================================================================

/**
 * Generates a daily briefing with today's calendar and active tasks.
 * Runs on weekdays at 8am.
 */
const dailyBriefingCheck: BuiltinCheckDefinition = {
  input: {
    name: 'daily-briefing',
    description: 'Generates a morning briefing with calendar and tasks',
    schedule: '0 8 * * 1-5', // Weekdays at 8am
    checkType: 'builtin',
  },
  executor:
    (services: Services): CheckExecutor =>
    async (): Promise<ProactiveResult | null> => {
      const calendar = services.get(CalendarService);
      const tasks = services.get(TaskService);

      const now = new Date();
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);

      // Get today's events
      const events = await calendar.getEventsInRange(now, endOfDay);

      // Get active user tasks
      const userTasks = await tasks.getActiveUserTasks();
      const activeTasks = userTasks.slice(0, 5);

      // Get active delegated tasks
      const delegatedTasks = await tasks.getActiveTasks();
      const activeDelegated = delegatedTasks.slice(0, 3);

      // Build briefing
      const parts: string[] = [];

      if (events.length > 0) {
        parts.push(`📅 ${events.length} event(s) today`);
        const eventList = events
          .slice(0, 3)
          .map((e) => {
            const time = new Date(e.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return `  • ${time} ${e.title}`;
          })
          .join('\n');
        parts.push(eventList);
      } else {
        parts.push('📅 No events scheduled today');
      }

      if (activeTasks.length > 0) {
        parts.push(`\n✅ ${activeTasks.length} active task(s)`);
        const taskList = activeTasks.map((t) => `  • ${t.description}`).join('\n');
        parts.push(taskList);
      }

      if (activeDelegated.length > 0) {
        parts.push(`\n🤖 ${activeDelegated.length} task(s) in progress`);
      }

      const briefing = parts.join('\n');

      return {
        finding: 'Daily briefing ready',
        urgency: 'low',
        suggestedAction: {
          type: 'notify',
          content: `Good morning! Here's your daily briefing:\n\n${briefing}`,
        },
        shouldNotify: true,
      };
    },
};

// ============================================================================
// Deferred Tasks Check
// ============================================================================

/**
 * Checks for deferred tasks that are now relevant.
 * Runs daily at 9am.
 */
const deferredTasksCheck: BuiltinCheckDefinition = {
  input: {
    name: 'deferred-tasks',
    description: 'Checks for deferred tasks that are now relevant',
    schedule: '0 9 * * *', // Daily at 9am
    checkType: 'builtin',
  },
  executor:
    (services: Services): CheckExecutor =>
    async (): Promise<ProactiveResult | null> => {
      const tasks = services.get(TaskService);

      const now = new Date();

      // Get all user tasks with deferred trigger
      const allTasks = await tasks.listUserTasks({ triggerType: 'deferred' });

      // Filter to tasks that are now relevant
      const relevantTasks = allTasks.filter((task) => {
        if (task.status === 'completed' || task.status === 'cancelled') return false;
        if (task.trigger.type !== 'deferred') return false;
        const becomesRelevant = new Date(task.trigger.becomesRelevant);
        return becomesRelevant <= now;
      });

      if (relevantTasks.length === 0) {
        return null;
      }

      const descriptions = relevantTasks.slice(0, 3).map((t) => t.description);
      const moreCount = relevantTasks.length > 3 ? ` (+${relevantTasks.length - 3} more)` : '';

      return {
        finding: `${relevantTasks.length} deferred task(s) are now relevant`,
        urgency: 'medium',
        suggestedAction: {
          type: 'notify',
          content: `The following deferred tasks are now relevant:\n\n${descriptions.join('\n')}${moreCount}`,
        },
        shouldNotify: true,
      };
    },
};

// ============================================================================
// Check Registry
// ============================================================================

const BUILTIN_CHECKS: Record<string, BuiltinCheckDefinition> = {
  'calendar-lookahead': calendarLookaheadCheck,
  'stale-followups': staleFollowupsCheck,
  'daily-briefing': dailyBriefingCheck,
  'deferred-tasks': deferredTasksCheck,
};

/**
 * Gets the built-in check definitions.
 */
const getBuiltinCheckDefinitions = (): Record<string, BuiltinCheckDefinition> => {
  return { ...BUILTIN_CHECKS };
};

/**
 * Gets a built-in check executor by name.
 */
const getBuiltinExecutor = (name: string, services: Services): CheckExecutor | null => {
  const definition = BUILTIN_CHECKS[name];
  if (!definition) {
    return null;
  }
  return definition.executor(services);
};

/**
 * Gets all built-in check inputs for registration.
 */
const getBuiltinCheckInputs = (): CreateCheckInput[] => {
  return Object.values(BUILTIN_CHECKS).map((def) => def.input);
};

// ============================================================================
// Exports
// ============================================================================

export type { BuiltinCheckDefinition };

export { getBuiltinCheckDefinitions, getBuiltinExecutor, getBuiltinCheckInputs, BUILTIN_CHECKS };
