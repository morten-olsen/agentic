import type { Services } from '../../core/services/services.ts';
import type { PendingTaskContext } from '../../features/tasks/tasks.schemas.ts';
import type { DayPlanContext } from '../../features/day-planner/day-planner.schemas.ts';
import type { MemoryIndex } from '../../agent/memory/consolidation/consolidation.ts';
import { UserModelService } from '../../domain/user-model/user-model.ts';
import { LocationService } from '../../domain/location/location.ts';
import { CalendarService } from '../../domain/calendar/calendar.ts';
import { TaskService } from '../../features/tasks/tasks.ts';
import { DayPlanService } from '../../features/day-planner/day-planner.ts';
import { EventService } from '../../features/events/events.ts';
import { ExternalServiceRegistry } from '../../integrations/external/external.ts';
import { DatabaseService } from '../../core/database/database.ts';
import { getConfig } from '../../core/config/config.ts';
import type { HomeAssistantClient, HaPersonState } from '../../integrations/external/homeassistant/index.ts';
import { recordCoordinate } from '../../domain/location/location.store.ts';
import { MemoryIndexService } from '../../agent/memory/consolidation/consolidation.ts';
import { BehavioralMemoryService } from '../../agent/behavioral/behavioral.ts';

import type {
  AgentContext,
  LocationContext,
  CalendarAgentContext,
  UserContext,
  RecentActivityContext,
  ContextDelta,
  ContextWithDelta,
  ContextCacheEntry,
} from './context.schemas.ts';

/**
 * Options for building context with optional delta tracking.
 */
type BuildContextOptions = {
  conversationId?: string;
  now?: Date;
};

/**
 * Context Builder Service - assembles a unified view for the agent.
 *
 * Combines data from User Model, Contacts, Location, and Calendar
 * to provide the agent with complete situational awareness.
 *
 * Supports context change detection by caching snapshots per conversation
 * and computing deltas between them.
 */
class ContextBuilderService {
  #services: Services;
  #lastRecordedLocationChange: string | null = null;
  #cache = new Map<string, ContextCacheEntry>();
  #cacheConfig: {
    maxEntries: number;
    ttlMinutes: number;
  };

  constructor(services: Services) {
    this.#services = services;
    const config = getConfig();
    this.#cacheConfig = {
      maxEntries: config.context?.deltaCacheMaxEntries ?? 100,
      ttlMinutes: config.context?.deltaCacheTtlMinutes ?? 1440,
    };
  }

  /**
   * Builds context with optional change detection.
   *
   * @param options.conversationId - Enable delta tracking for this conversation
   * @param options.now - Override current time (for testing)
   * @returns Context with optional delta (null if no previous snapshot or no conversationId)
   */
  buildContext = async (options: BuildContextOptions = {}): Promise<ContextWithDelta> => {
    const now = options.now ?? new Date();
    const conversationId = options.conversationId;

    // Get previous snapshot if tracking deltas
    const previous = conversationId ? this.#getCachedEntry(conversationId, now) : null;

    // Build current context (existing logic)
    const context = await this.#buildFullContext(now);

    // Compute delta if we have a previous snapshot
    const delta = previous ? this.#computeDelta(previous, context, now) : null;

    // Cache current snapshot
    if (conversationId) {
      this.#cacheSnapshot(conversationId, context, now);
    }

    return {
      context,
      delta,
      snapshotId: `${conversationId ?? 'anon'}-${now.getTime()}`,
    };
  };

  /**
   * Builds the full agent context (internal implementation).
   */
  #buildFullContext = async (now: Date): Promise<AgentContext> => {
    const userModel = this.#services.get(UserModelService);
    const identity = await userModel.getIdentity();
    const timezone = identity?.timezone ?? 'UTC';

    const [
      userContext,
      locationContext,
      calendarContext,
      pendingTasks,
      dayPlanContext,
      recentActivity,
      memoryContext,
      behavioralIndex,
      timeOfDay,
      localTime,
    ] = await Promise.all([
      this.#buildUserContext(),
      this.#buildLocationContext(),
      this.#buildCalendarContext(now),
      this.#getPendingTasks(),
      this.#getDayPlanContext(),
      this.#getRecentActivity(),
      this.#getMemoryContext(),
      this.#getBehavioralContext(now),
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

      // Recent context
      pendingTasks,

      // Recent activity from event log
      recentActivity,

      // Memory context
      memory: memoryContext,

      // No active conversation by default
      conversation: undefined,

      // Day plan awareness
      dayPlan: dayPlanContext,

      // Behavioral memory index
      behavioralIndex,
    };
  };

  /**
   * Gets a cached entry if it exists and is not expired.
   */
  #getCachedEntry = (conversationId: string, now: Date): ContextCacheEntry | null => {
    const entry = this.#cache.get(conversationId);
    if (!entry) return null;

    // Check TTL
    const ageMinutes = (now.getTime() - entry.capturedAt.getTime()) / 60000;
    if (ageMinutes > this.#cacheConfig.ttlMinutes) {
      this.#cache.delete(conversationId);
      return null;
    }

    return entry;
  };

  /**
   * Caches a context snapshot for future delta computation.
   */
  #cacheSnapshot = (conversationId: string, context: AgentContext, capturedAt: Date): void => {
    // LRU eviction if cache is full
    if (this.#cache.size >= this.#cacheConfig.maxEntries) {
      const oldestKey = this.#cache.keys().next().value;
      if (oldestKey) this.#cache.delete(oldestKey);
    }

    // Extract IDs for efficient comparison
    const entry: ContextCacheEntry = {
      snapshot: context,
      capturedAt,
      calendarEventIds: new Set(
        [context.calendar.currentEvent?.id, context.calendar.nextEvent?.id].filter(
          (id): id is string => id !== undefined && id !== null,
        ),
      ),
      taskIds: new Set(context.pendingTasks.map((t) => t.id)),
      locationState: this.#getLocationState(context.location),
      dayPlanDate: context.dayPlan?.date ?? null,
      completedPriorityIds: new Set(context.dayPlan?.priorities.filter((p) => p.completed).map((p) => p.id) ?? []),
    };

    this.#cache.set(conversationId, entry);
  };

  /**
   * Gets a simplified location state string for comparison.
   */
  #getLocationState = (location: LocationContext): string => {
    if (location.atHome) return 'home';
    if (location.atWork) return 'work';
    if (location.traveling) return 'away';
    return 'unknown';
  };

  /**
   * Computes the delta between a previous snapshot and current context.
   */
  #computeDelta = (previous: ContextCacheEntry, current: AgentContext, now: Date): ContextDelta => {
    const timeSinceLastSnapshot = Math.round((now.getTime() - previous.capturedAt.getTime()) / 60000);

    // Calendar delta
    const currentCalendarIds = new Set(
      [current.calendar.currentEvent?.id, current.calendar.nextEvent?.id].filter(
        (id): id is string => id !== undefined && id !== null,
      ),
    );

    const newEventIds = [...currentCalendarIds].filter((id) => !previous.calendarEventIds.has(id));
    const cancelledEventIds = [...previous.calendarEventIds].filter((id) => !currentCalendarIds.has(id));

    // Task delta
    const currentTaskIds = new Set(current.pendingTasks.map((t) => t.id));
    const newTaskIds = [...currentTaskIds].filter((id) => !previous.taskIds.has(id));
    const completedTaskIds = [...previous.taskIds].filter((id) => !currentTaskIds.has(id));

    // Location delta
    const currentLocationState = this.#getLocationState(current.location);
    const locationChanged = currentLocationState !== previous.locationState;

    // Day plan delta
    // isNewDay is true only when:
    // - Both have day plans and the dates differ (user moved to a new day plan)
    // NOT when both are null (no change) or one appears/disappears
    const currentDayPlanDate = current.dayPlan?.date ?? null;
    const isNewDay =
      currentDayPlanDate !== null && previous.dayPlanDate !== null && currentDayPlanDate !== previous.dayPlanDate;
    // hasDayPlanAppeared: a day plan was created since last snapshot
    const hasDayPlanAppeared = previous.dayPlanDate === null && currentDayPlanDate !== null;

    const currentCompletedIds = new Set(current.dayPlan?.priorities.filter((p) => p.completed).map((p) => p.id) ?? []);
    const newlyCompletedPriorities = [...currentCompletedIds].filter((id) => !previous.completedPriorityIds.has(id));

    // Build change summary
    const changeSummary: string[] = [];
    if (newEventIds.length > 0) {
      changeSummary.push(`${newEventIds.length} new calendar event(s)`);
    }
    if (cancelledEventIds.length > 0) {
      changeSummary.push(`${cancelledEventIds.length} cancelled event(s)`);
    }
    if (newTaskIds.length > 0) {
      changeSummary.push(`${newTaskIds.length} new task(s)`);
    }
    if (completedTaskIds.length > 0) {
      changeSummary.push(`${completedTaskIds.length} completed task(s)`);
    }
    if (locationChanged) {
      changeSummary.push(`Location changed: ${previous.locationState} → ${currentLocationState}`);
    }
    if (isNewDay) {
      changeSummary.push('New day plan');
    } else if (hasDayPlanAppeared) {
      changeSummary.push('Day plan created');
    } else if (newlyCompletedPriorities.length > 0) {
      changeSummary.push(`${newlyCompletedPriorities.length} priority completed`);
    }

    const hasSignificantChanges = changeSummary.length > 0;

    return {
      timeSinceLastSnapshot,

      calendar: {
        newEvents: newEventIds.map((id) => {
          const event = [current.calendar.currentEvent, current.calendar.nextEvent].find((e) => e?.id === id);
          return event ? { id: event.id, title: event.title, start: event.start } : { id, title: 'Unknown', start: '' };
        }),
        cancelledEvents: cancelledEventIds.map((id) => {
          // Try to get info from previous snapshot
          const prevEvent = [previous.snapshot.calendar.currentEvent, previous.snapshot.calendar.nextEvent].find(
            (e) => e?.id === id,
          );
          return prevEvent
            ? { id: prevEvent.id, title: prevEvent.title, start: prevEvent.start }
            : { id, title: 'Unknown', start: '' };
        }),
        upcomingEventChanged: current.calendar.nextEvent?.id !== previous.snapshot.calendar.nextEvent?.id,
      },

      tasks: {
        newTasks: current.pendingTasks
          .filter((t) => newTaskIds.includes(t.id))
          .map((t) => ({ id: t.id, description: t.description, type: t.type })),
        completedTasks: previous.snapshot.pendingTasks
          .filter((t) => completedTaskIds.includes(t.id))
          .map((t) => ({ id: t.id, description: t.description, type: t.type })),
        taskCountDelta: current.pendingTasks.length - previous.taskIds.size,
      },

      location: {
        changed: locationChanged,
        previousLocation: previous.locationState,
        currentLocation: currentLocationState,
      },

      dayPlan: {
        isNewDay: isNewDay || hasDayPlanAppeared,
        newPriorities:
          isNewDay || hasDayPlanAppeared ? (current.dayPlan?.priorities.map((p) => p.description) ?? []) : [],
        completedPriorities:
          current.dayPlan?.priorities
            .filter((p) => newlyCompletedPriorities.includes(p.id))
            .map((p) => p.description) ?? [],
        priorityProgressDelta: newlyCompletedPriorities.length,
      },

      hasSignificantChanges,
      changeSummary,
    };
  };

  /**
   * Clears the context cache. Useful for testing.
   */
  clearCache = (): void => {
    this.#cache.clear();
  };

  /**
   * Gets the current cache size. Useful for testing.
   */
  getCacheSize = (): number => {
    return this.#cache.size;
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
   * Calendar events from Home Assistant are synced to the database by CalendarSyncService.
   */
  #buildCalendarContext = async (now: Date): Promise<CalendarAgentContext> => {
    const calendar = this.#services.get(CalendarService);

    const [context, todayAgenda] = await Promise.all([calendar.getCurrentContext(now), calendar.getDayAgenda(now)]);

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

  /**
   * Gets the memory context (active entities, open loops, landscape).
   */
  #getMemoryContext = async (): Promise<MemoryIndex | undefined> => {
    try {
      const memoryIndexService = this.#services.get(MemoryIndexService);
      return await memoryIndexService.getMemoryIndex();
    } catch {
      // Memory index service may not be available yet, return undefined
      return undefined;
    }
  };

  /**
   * Gets the behavioral memory context (template index + pending outcomes).
   */
  #getBehavioralContext = async (now: Date): Promise<string | undefined> => {
    try {
      const behavioralService = this.#services.get(BehavioralMemoryService);
      const contextSummary = await this.#buildBehavioralContextSummary(now);
      return await behavioralService.buildContextIndex(contextSummary);
    } catch {
      // Behavioral memory service may not be available yet, return undefined
      return undefined;
    }
  };

  /**
   * Builds a compact keyword summary from user data for behavioral template ranking.
   * Queries services directly since this runs in parallel with other context builders.
   */
  #buildBehavioralContextSummary = async (now: Date): Promise<string> => {
    const parts: string[] = [];

    try {
      const userModel = this.#services.get(UserModelService);
      const [projects, goals] = await Promise.all([userModel.getActiveProjects(), userModel.getGoals()]);
      const timeOfDay = await userModel.getTimeOfDay(now);
      parts.push(timeOfDay);
      if (projects.length > 0) parts.push(projects.map((p) => p.name).join(', '));
      if (goals.length > 0) parts.push(goals.map((g) => g.description).join(', '));
    } catch {
      /* graceful degradation */
    }

    try {
      const dayPlanService = this.#services.get(DayPlanService);
      const plan = await dayPlanService.getTodayPlanContext();
      if (plan) {
        const pending = plan.priorities.filter((p) => !p.completed).map((p) => p.description);
        if (pending.length > 0) parts.push(pending.join(', '));
      }
    } catch {
      /* graceful degradation */
    }

    return parts.length > 0 ? parts.join('. ') : 'general context';
  };

  /**
   * Gets recent activity from the event log.
   * Returns events from the last few hours with a summary.
   */
  #getRecentActivity = async (): Promise<RecentActivityContext | undefined> => {
    try {
      const eventService = this.#services.get(EventService);
      const hoursBack = 6; // Look back 6 hours for recent activity
      const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

      const result = await eventService.query({
        since,
        limit: 10, // Limit to avoid bloating context
      });

      if (result.events.length === 0) {
        return undefined; // Don't include if no recent activity
      }

      // Group by domain
      const byDomain: Record<string, number> = {};
      for (const event of result.events) {
        const domain = event.type.split('.')[0];
        byDomain[domain] = (byDomain[domain] ?? 0) + 1;
      }

      // Build summary
      const parts: string[] = [];
      for (const [domain, count] of Object.entries(byDomain)) {
        parts.push(`${count} ${domain}`);
      }
      const summary = `${result.events.length} recent event${result.events.length === 1 ? '' : 's'}: ${parts.join(', ')}`;

      return {
        events: result.events,
        summary,
        byDomain,
        hoursBack,
      };
    } catch {
      // Event service may not be available, return undefined
      return undefined;
    }
  };
}

// Re-export types
export type {
  AgentContext,
  LocationContext,
  CalendarAgentContext,
  UserContext,
  RecentActivityContext,
  TimeOfDay,
  ContextDelta,
  ContextWithDelta,
  ContextCacheEntry,
} from './context.schemas.ts';

export type { BuildContextOptions };

export { ContextBuilderService };
