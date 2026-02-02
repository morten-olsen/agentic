import type { Services } from '../services/services.ts';
import type { PendingTaskContext } from '../tasks/tasks.schemas.ts';
import type { DayPlanContext } from '../day-planner/day-planner.schemas.ts';
import { UserModelService } from '../user-model/user-model.ts';
import { LocationService } from '../location/location.ts';
import { CalendarService } from '../calendar/calendar.ts';
import { MemoryService } from '../memory/memory.ts';
import { TaskService } from '../tasks/tasks.ts';
import { DayPlanService } from '../day-planner/day-planner.ts';

import type { AgentContext, LocationContext, CalendarAgentContext, UserContext } from './context.schemas.ts';

/**
 * Context Builder Service - assembles a unified view for the agent.
 *
 * Combines data from User Model, Contacts, Location, and Calendar
 * to provide the agent with complete situational awareness.
 */
class ContextBuilderService {
  #services: Services;

  constructor(services: Services) {
    this.#services = services;
  }

  /**
   * Builds the full agent context.
   * Call this at the start of each interaction to give the agent a complete picture.
   */
  buildContext = async (now: Date = new Date()): Promise<AgentContext> => {
    const [userContext, locationContext, calendarContext, recentTopics, pendingTasks, dayPlanContext] =
      await Promise.all([
        this.#buildUserContext(),
        this.#buildLocationContext(),
        this.#buildCalendarContext(now),
        this.#getRecentTopics(),
        this.#getPendingTasks(),
        this.#getDayPlanContext(),
      ]);

    const userModel = this.#services.get(UserModelService);
    const identity = await userModel.getIdentity();

    return {
      // Time (when)
      now: now.toISOString(),
      timezone: identity?.timezone ?? 'UTC',
      timeOfDay: userModel.getTimeOfDay(now),
      isWorkingHours: await userModel.isWorkingHours(now),

      // Location (where)
      location: locationContext,

      // User state (who)
      user: userContext,

      // Calendar awareness
      calendar: calendarContext,

      // Recent context from memory
      recentContacts: [],
      recentTopics,
      pendingTasks,

      // No active conversation by default
      conversation: undefined,

      // Day plan awareness
      dayPlan: dayPlanContext,
    };
  };

  /**
   * Builds just the calendar portion of context.
   * Useful for partial updates during a conversation.
   */
  getCalendarContext = async (now: Date = new Date()): Promise<CalendarAgentContext> => {
    return this.#buildCalendarContext(now);
  };

  /**
   * Builds user context (identity, projects, goals).
   */
  #buildUserContext = async (): Promise<UserContext> => {
    const userModel = this.#services.get(UserModelService);

    const [identity, projects, goals] = await Promise.all([
      userModel.getIdentity(),
      userModel.getActiveProjects(),
      userModel.getGoals(),
    ]);

    return {
      name: identity?.name ?? 'User',
      activeProjects: projects,
      currentGoals: goals,
    };
  };

  /**
   * Builds location context.
   */
  #buildLocationContext = async (): Promise<LocationContext> => {
    const location = this.#services.get(LocationService);

    // Try to infer current location
    const current = await location.inferCurrentLocation();

    return {
      current: current.location,
      confidence: current.confidence,
      atHome: current.location?.type === 'home',
      atWork: current.location?.type === 'work',
      traveling: current.location?.type === 'travel',
    };
  };

  /**
   * Builds calendar context with agenda.
   */
  #buildCalendarContext = async (now: Date): Promise<CalendarAgentContext> => {
    const calendar = this.#services.get(CalendarService);

    const [context, agenda] = await Promise.all([calendar.getCurrentContext(now), calendar.getDayAgenda(now)]);

    // Calculate when to leave for next event (if it has travel time)
    let shouldLeaveBy: string | null = null;
    let travelTimeToNext: number | null = null;

    if (context.nextEvent && context.nextEvent.travelTime) {
      travelTimeToNext = context.nextEvent.travelTime;
      const nextStart = new Date(context.nextEvent.start);
      const leaveTime = new Date(nextStart.getTime() - travelTimeToNext * 60 * 1000);
      shouldLeaveBy = leaveTime.toISOString();
    }

    return {
      currentEvent: context.currentEvent,
      nextEvent: context.nextEvent,
      minutesToNext: context.minutesToNext,
      travelTimeToNext,
      shouldLeaveBy,
      todayAgenda: agenda,
    };
  };

  /**
   * Gets recent topics from memory.
   */
  #getRecentTopics = async (): Promise<string[]> => {
    try {
      const memoryService = this.#services.get(MemoryService);
      return await memoryService.getRecentTopics(5);
    } catch {
      // Memory service may not be available yet, return empty array
      return [];
    }
  };

  /**
   * Gets pending tasks for the context.
   */
  #getPendingTasks = async (): Promise<PendingTaskContext[]> => {
    try {
      const taskService = this.#services.get(TaskService);
      return await taskService.getPendingTasksForContext(10);
    } catch {
      // Task service may not be available yet, return empty array
      return [];
    }
  };

  /**
   * Gets the day plan context for today.
   */
  #getDayPlanContext = async (): Promise<DayPlanContext | null> => {
    try {
      const dayPlanService = this.#services.get(DayPlanService);
      return await dayPlanService.getTodayPlanContext();
    } catch {
      // Day plan service may not be available yet, return null
      return null;
    }
  };
}

// Re-export types
export type { AgentContext, LocationContext, CalendarAgentContext, UserContext, TimeOfDay } from './context.schemas.ts';

export { ContextBuilderService };
