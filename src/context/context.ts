import type { Services } from '../services/services.ts';
import type { PendingTaskContext } from '../tasks/tasks.schemas.ts';
import type { DayPlanContext } from '../day-planner/day-planner.schemas.ts';
import { UserModelService } from '../user-model/user-model.ts';
import { LocationService } from '../location/location.ts';
import { CalendarService, startOfDay, endOfDay } from '../calendar/calendar.ts';
import { MemoryService } from '../memory/memory.ts';
import { TaskService } from '../tasks/tasks.ts';
import { DayPlanService } from '../day-planner/day-planner.ts';
import { ExternalServiceRegistry } from '../external/external.ts';
import { DatabaseService } from '../database/database.ts';
import { getConfig } from '../config/config.ts';
import type { HomeAssistantClient, HaCalendarEvent, HaPersonState } from '../external/homeassistant/index.ts';
import { recordCoordinate } from '../location/location.store.ts';

import type { AgentContext, LocationContext, CalendarAgentContext, UserContext } from './context.schemas.ts';

/**
 * Context Builder Service - assembles a unified view for the agent.
 *
 * Combines data from User Model, Contacts, Location, and Calendar
 * to provide the agent with complete situational awareness.
 */
class ContextBuilderService {
  #services: Services;
  #lastRecordedLocationChange: string | null = null;

  constructor(services: Services) {
    this.#services = services;
  }

  /**
   * Builds the full agent context.
   * Call this at the start of each interaction to give the agent a complete picture.
   */
  buildContext = async (now: Date = new Date()): Promise<AgentContext> => {
    const userModel = this.#services.get(UserModelService);
    const identity = await userModel.getIdentity();
    const timezone = identity?.timezone ?? 'UTC';

    const [
      userContext,
      locationContext,
      calendarContext,
      recentTopics,
      pendingTasks,
      dayPlanContext,
      timeOfDay,
      localTime,
    ] = await Promise.all([
      this.#buildUserContext(),
      this.#buildLocationContext(),
      this.#buildCalendarContext(now),
      this.#getRecentTopics(),
      this.#getPendingTasks(),
      this.#getDayPlanContext(),
      userModel.getTimeOfDay(now),
      userModel.formatLocalTime(now),
    ]);

    return {
      // Time (when)
      now: now.toISOString(),
      localTime,
      timezone,
      timeOfDay,
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
   * Enriches schedule-based inference with real GPS data from Home Assistant when available.
   */
  #buildLocationContext = async (): Promise<LocationContext> => {
    const location = this.#services.get(LocationService);

    // Try to infer current location from schedule
    const current = await location.inferCurrentLocation();

    // Get HA location from cache (no API call - updated via WebSocket subscription)
    const haLocation = await this.#getHaPersonLocation();

    // Build base context from schedule inference
    const result: LocationContext = {
      current: current.location,
      confidence: current.confidence,
      atHome: current.location?.type === 'home',
      atWork: current.location?.type === 'work',
      traveling: current.location?.type === 'travel',
    };

    // Enrich with HA data if available
    if (haLocation) {
      // HA state takes precedence for home/work/traveling detection
      result.atHome = haLocation.state === 'home';
      result.atWork = haLocation.state === 'work';
      result.traveling = haLocation.state === 'not_home';

      // Add GPS coordinates if available
      if (haLocation.attributes.latitude !== undefined && haLocation.attributes.longitude !== undefined) {
        result.coordinates = {
          latitude: haLocation.attributes.latitude,
          longitude: haLocation.attributes.longitude,
          accuracy: haLocation.attributes.gps_accuracy ?? 0,
        };
        result.confidence = 'exact'; // GPS is better than schedule inference
      }

      // Add staleness info and source
      result.lastLocationChange = haLocation.last_changed;
      result.locationSource = haLocation.attributes.source;
    }

    return result;
  };

  /**
   * Fetches person location from Home Assistant (if configured).
   * Returns cached state from WebSocket subscription - no API call needed.
   * Also records coordinate history when location changes.
   */
  #getHaPersonLocation = async (): Promise<HaPersonState | null> => {
    try {
      const externalServices = this.#services.get(ExternalServiceRegistry);
      if (!externalServices.isConfigured('homeassistant')) {
        return null;
      }

      const config = getConfig();
      if (!config.homeassistant.personEntity) {
        return null;
      }

      const client = await externalServices.getClient<HomeAssistantClient>('homeassistant');
      const personState = client.getPersonLocation();

      // Record coordinate history if location changed
      if (personState && personState.last_changed !== this.#lastRecordedLocationChange) {
        await this.#recordCoordinateHistory(personState);
        this.#lastRecordedLocationChange = personState.last_changed;
      }

      return personState;
    } catch {
      // Graceful degradation - HA being down shouldn't break context
      return null;
    }
  };

  /**
   * Records a coordinate to history from HA person state.
   */
  #recordCoordinateHistory = async (personState: HaPersonState): Promise<void> => {
    // Only record if we have GPS coordinates
    if (personState.attributes.latitude === undefined || personState.attributes.longitude === undefined) {
      return;
    }

    try {
      const db = this.#services.get(DatabaseService);
      await recordCoordinate(db.knex, {
        latitude: personState.attributes.latitude,
        longitude: personState.attributes.longitude,
        accuracy: personState.attributes.gps_accuracy,
        provider: 'homeassistant',
        source: personState.attributes.source,
        zone: personState.state,
        recordedAt: personState.last_changed,
      });
    } catch {
      // Don't fail context building if recording fails
    }
  };

  /**
   * Builds calendar context with agenda.
   */
  #buildCalendarContext = async (now: Date): Promise<CalendarAgentContext> => {
    const calendar = this.#services.get(CalendarService);

    const [context, gladosAgenda] = await Promise.all([calendar.getCurrentContext(now), calendar.getDayAgenda(now)]);

    // Try to get HA calendar events (if configured)
    const haEvents = await this.#getHaCalendarEvents(now);

    // Merge agendas
    const todayAgenda = this.#mergeAgendas(gladosAgenda, haEvents);

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
      todayAgenda,
    };
  };

  /**
   * Fetches calendar events from Home Assistant (if configured).
   */
  #getHaCalendarEvents = async (now: Date): Promise<HaCalendarEvent[]> => {
    try {
      const externalServices = this.#services.get(ExternalServiceRegistry);
      if (!externalServices.isConfigured('homeassistant')) {
        return [];
      }

      const config = getConfig();
      if (config.homeassistant.calendarEntities.length === 0) {
        return [];
      }

      const client = await externalServices.getClient<HomeAssistantClient>('homeassistant');
      const dayStart = startOfDay(now);
      const dayEnd = endOfDay(now);

      // Fetch from all configured calendars in parallel
      const results = await Promise.all(
        config.homeassistant.calendarEntities.map(async (entityId) => {
          try {
            return await client.getCalendarEvents(entityId, dayStart, dayEnd);
          } catch {
            // Skip calendars that fail (might not exist)
            return [];
          }
        }),
      );

      return results.flat();
    } catch {
      // Log but don't fail - HA being down shouldn't break context
      return [];
    }
  };

  /**
   * Merges GLaDOS agenda with HA calendar events.
   */
  #mergeAgendas = (gladosAgenda: string, haEvents: HaCalendarEvent[]): string => {
    if (haEvents.length === 0) {
      return gladosAgenda;
    }

    // Format HA events
    const haLines = haEvents
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((event) => {
        const isAllDay = !event.start.includes('T');
        const time = isAllDay ? 'All day' : this.#formatHaEventTime(event.start);
        return `- ${time}: ${event.summary}`;
      });

    // Combine
    if (gladosAgenda === 'No events scheduled for today.') {
      return `From Home Assistant:\n${haLines.join('\n')}`;
    }
    return `${gladosAgenda}\n\nFrom Home Assistant:\n${haLines.join('\n')}`;
  };

  /**
   * Formats an HA event time for display.
   */
  #formatHaEventTime = (isoString: string): string => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
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
