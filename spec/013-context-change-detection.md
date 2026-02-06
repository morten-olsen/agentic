# Context Change Detection Specification

> Incremental context updates with change detection for "since we last spoke" awareness

**Version**: 1.0
**Status**: Complete
**Dependencies**: Context Builder (Phase 1)

## Overview

The current context builder rebuilds the full `AgentContext` from scratch on every message. While this works, it misses an opportunity to surface **what changed** between interactions - a key capability for a proactive personal assistant.

This specification introduces a caching and change detection layer that enables the agent to know not just "what is true now" but "what changed since we last spoke."

### Goals

1. **Change detection**: Surface deltas between context snapshots (new events, completed tasks, location changes)
2. **Efficiency**: Cache stable context dimensions, only refresh volatile ones
3. **Conversation continuity**: Enable "since we last spoke" awareness across conversations
4. **Foundation for proactivity**: Changes detected here feed into future anticipatory notifications

### Non-Goals (for v1)

- Real-time push notifications (this is pull-based, checked at conversation start)
- Cross-device context synchronization
- Historical context replay ("what was my context last Tuesday")
- Automatic summarization of changes (just detection, agent interprets)

### Key Design Decisions

1. **Per-conversation caching**: Context is cached per conversation, not globally
2. **Snapshot comparison**: Compare current snapshot to previous, compute delta
3. **Configurable staleness**: Different dimensions have different cache TTLs
4. **Opt-in for agent**: Delta is available but agent decides whether to mention changes

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Context Change Detection                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    ContextBuilderService                             │   │
│   │                                                                      │   │
│   │  buildContext(conversationId?)                                      │   │
│   │    │                                                                │   │
│   │    ├──▶ Check cache for previous snapshot                          │   │
│   │    │                                                                │   │
│   │    ├──▶ Build current context (existing logic)                     │   │
│   │    │                                                                │   │
│   │    ├──▶ If previous exists: compute delta                          │   │
│   │    │                                                                │   │
│   │    ├──▶ Cache current snapshot                                     │   │
│   │    │                                                                │   │
│   │    └──▶ Return AgentContext with optional delta                    │   │
│   │                                                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    Context Cache (in-memory)                         │   │
│   │                                                                      │   │
│   │  Map<conversationId, {                                              │   │
│   │    snapshot: AgentContext,                                          │   │
│   │    capturedAt: Date,                                                │   │
│   │  }>                                                                 │   │
│   │                                                                      │   │
│   │  - Entries expire after configurable TTL (default: 24 hours)        │   │
│   │  - LRU eviction when cache exceeds max size                         │   │
│   │                                                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Change Detection Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         Change Detection Flow                             │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  1. RETRIEVE: Get previous context snapshot from cache                   │
│     ┌───────────────────────────────────────────────────────────────┐    │
│     │  Cache lookup by conversationId                               │    │
│     │  If not found: no delta (first message in conversation)       │    │
│     └───────────────────────────────────────────────────────────────┘    │
│                                    │                                      │
│                                    ▼                                      │
│  2. BUILD: Construct current context (existing buildContext logic)       │
│     ┌───────────────────────────────────────────────────────────────┐    │
│     │  Time, Location, Calendar, Tasks, Day Plan                    │    │
│     └───────────────────────────────────────────────────────────────┘    │
│                                    │                                      │
│                                    ▼                                      │
│  3. COMPARE: Compute delta between previous and current                  │
│     ┌───────────────────────────────────────────────────────────────┐    │
│     │  For each dimension:                                          │    │
│     │  - Calendar: new events, cancelled events                     │    │
│     │  - Tasks: new tasks, completed tasks                          │    │
│     │  - Location: changed?                                         │    │
│     │  - Day Plan: new priorities, completed items                  │    │
│     └───────────────────────────────────────────────────────────────┘    │
│                                    │                                      │
│                                    ▼                                      │
│  4. CACHE: Store current snapshot for next comparison                    │
│     ┌───────────────────────────────────────────────────────────────┐    │
│     │  cache.set(conversationId, { snapshot, capturedAt: now })     │    │
│     └───────────────────────────────────────────────────────────────┘    │
│                                    │                                      │
│                                    ▼                                      │
│  5. RETURN: AgentContext + ContextDelta                                  │
│     ┌───────────────────────────────────────────────────────────────┐    │
│     │  { context: AgentContext, delta?: ContextDelta }              │    │
│     └───────────────────────────────────────────────────────────────┘    │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Data Model

### Context Delta

```typescript
// src/context/context.schemas.ts

const calendarEventSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  start: z.string(),
});

const taskSummarySchema = z.object({
  id: z.string(),
  description: z.string(),
  type: z.enum(['user', 'delegated']),
});

const contextDeltaSchema = z.object({
  // Time since last context snapshot
  timeSinceLastSnapshot: z.number(), // minutes

  // Calendar changes
  calendar: z.object({
    newEvents: z.array(calendarEventSummarySchema),
    cancelledEvents: z.array(calendarEventSummarySchema),
    upcomingEventChanged: z.boolean(), // next event is different
  }),

  // Task changes
  tasks: z.object({
    newTasks: z.array(taskSummarySchema),
    completedTasks: z.array(taskSummarySchema),
    taskCountDelta: z.number(), // positive = more tasks, negative = fewer
  }),

  // Location change
  location: z.object({
    changed: z.boolean(),
    previousLocation: z.string().nullable(), // e.g., "home", "work", "away"
    currentLocation: z.string().nullable(),
  }),

  // Day plan changes
  dayPlan: z.object({
    isNewDay: z.boolean(), // day plan date changed
    newPriorities: z.array(z.string()),
    completedPriorities: z.array(z.string()),
    priorityProgressDelta: z.number(), // e.g., +2 means 2 more completed
  }),

  // Summary flags for quick checks
  hasSignificantChanges: z.boolean(),
  changeSummary: z.array(z.string()), // Human-readable change descriptions
});

type ContextDelta = z.infer<typeof contextDeltaSchema>;
```

### Context with Delta

```typescript
// Return type for buildContext when delta tracking is enabled

const contextWithDeltaSchema = z.object({
  context: agentContextSchema,
  delta: contextDeltaSchema.nullable(), // null if no previous snapshot
  snapshotId: z.string(), // for debugging/tracking
});

type ContextWithDelta = z.infer<typeof contextWithDeltaSchema>;
```

### Cache Entry

```typescript
// Internal cache structure

type ContextCacheEntry = {
  snapshot: AgentContext;
  capturedAt: Date;
  // Extracted IDs for efficient comparison
  calendarEventIds: Set<string>;
  taskIds: Set<string>;
  locationState: string; // 'home' | 'work' | 'away' | 'unknown'
  dayPlanDate: string | null;
  completedPriorityIds: Set<string>;
};
```

---

## Implementation

### ContextBuilderService Changes

```typescript
// src/context/context.ts

class ContextBuilderService {
  #services: Services;
  #cache: Map<string, ContextCacheEntry>;
  #cacheConfig: {
    maxEntries: number;
    ttlMinutes: number;
  };

  constructor(services: Services) {
    this.#services = services;
    this.#cache = new Map();
    this.#cacheConfig = {
      maxEntries: 100,
      ttlMinutes: 24 * 60, // 24 hours
    };
  }

  /**
   * Builds context with optional change detection.
   *
   * @param options.conversationId - Enable delta tracking for this conversation
   * @param options.now - Override current time (for testing)
   */
  buildContext = async (options?: {
    conversationId?: string;
    now?: Date;
  }): Promise<ContextWithDelta> => {
    const now = options?.now ?? new Date();
    const conversationId = options?.conversationId;

    // Get previous snapshot if tracking deltas
    const previous = conversationId
      ? this.#getCachedEntry(conversationId)
      : null;

    // Build current context (existing logic)
    const context = await this.#buildFullContext(now);

    // Compute delta if we have a previous snapshot
    const delta = previous
      ? this.#computeDelta(previous, context, now)
      : null;

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
   * Legacy method for backwards compatibility.
   * Returns just the context without delta tracking.
   */
  buildContextLegacy = async (now: Date = new Date()): Promise<AgentContext> => {
    return this.#buildFullContext(now);
  };

  #getCachedEntry = (conversationId: string): ContextCacheEntry | null => {
    const entry = this.#cache.get(conversationId);
    if (!entry) return null;

    // Check TTL
    const ageMinutes = (Date.now() - entry.capturedAt.getTime()) / 60000;
    if (ageMinutes > this.#cacheConfig.ttlMinutes) {
      this.#cache.delete(conversationId);
      return null;
    }

    return entry;
  };

  #cacheSnapshot = (
    conversationId: string,
    context: AgentContext,
    capturedAt: Date
  ): void => {
    // LRU eviction if cache is full
    if (this.#cache.size >= this.#cacheConfig.maxEntries) {
      const oldestKey = this.#cache.keys().next().value;
      if (oldestKey) this.#cache.delete(oldestKey);
    }

    // Extract IDs for efficient comparison
    const entry: ContextCacheEntry = {
      snapshot: context,
      capturedAt,
      calendarEventIds: new Set([
        context.calendar.currentEvent?.id,
        context.calendar.nextEvent?.id,
      ].filter((id): id is string => id !== undefined && id !== null)),
      taskIds: new Set(context.pendingTasks.map(t => t.id)),
      locationState: this.#getLocationState(context.location),
      dayPlanDate: context.dayPlan?.date ?? null,
      completedPriorityIds: new Set(
        context.dayPlan?.priorities
          .filter(p => p.completed)
          .map(p => p.id) ?? []
      ),
    };

    this.#cache.set(conversationId, entry);
  };

  #getLocationState = (location: LocationContext): string => {
    if (location.atHome) return 'home';
    if (location.atWork) return 'work';
    if (location.traveling) return 'away';
    return 'unknown';
  };

  #computeDelta = (
    previous: ContextCacheEntry,
    current: AgentContext,
    now: Date
  ): ContextDelta => {
    const timeSinceLastSnapshot = Math.round(
      (now.getTime() - previous.capturedAt.getTime()) / 60000
    );

    // Calendar delta
    const currentCalendarIds = new Set([
      current.calendar.currentEvent?.id,
      current.calendar.nextEvent?.id,
    ].filter((id): id is string => id !== undefined && id !== null));

    const newEventIds = [...currentCalendarIds]
      .filter(id => !previous.calendarEventIds.has(id));
    const cancelledEventIds = [...previous.calendarEventIds]
      .filter(id => !currentCalendarIds.has(id));

    // Task delta
    const currentTaskIds = new Set(current.pendingTasks.map(t => t.id));
    const newTaskIds = [...currentTaskIds]
      .filter(id => !previous.taskIds.has(id));
    const completedTaskIds = [...previous.taskIds]
      .filter(id => !currentTaskIds.has(id));

    // Location delta
    const currentLocationState = this.#getLocationState(current.location);
    const locationChanged = currentLocationState !== previous.locationState;

    // Day plan delta
    const isNewDay = current.dayPlan?.date !== previous.dayPlanDate;
    const currentCompletedIds = new Set(
      current.dayPlan?.priorities
        .filter(p => p.completed)
        .map(p => p.id) ?? []
    );
    const newlyCompletedPriorities = [...currentCompletedIds]
      .filter(id => !previous.completedPriorityIds.has(id));

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
    } else if (newlyCompletedPriorities.length > 0) {
      changeSummary.push(`${newlyCompletedPriorities.length} priority completed`);
    }

    const hasSignificantChanges = changeSummary.length > 0;

    return {
      timeSinceLastSnapshot,

      calendar: {
        newEvents: newEventIds.map(id => {
          const event = [current.calendar.currentEvent, current.calendar.nextEvent]
            .find(e => e?.id === id);
          return event
            ? { id: event.id, title: event.title, start: event.start }
            : { id, title: 'Unknown', start: '' };
        }),
        cancelledEvents: [], // Would need previous context to populate
        upcomingEventChanged: current.calendar.nextEvent?.id !==
          [...previous.calendarEventIds][1], // Rough heuristic
      },

      tasks: {
        newTasks: current.pendingTasks
          .filter(t => newTaskIds.includes(t.id))
          .map(t => ({ id: t.id, description: t.description, type: t.type })),
        completedTasks: [], // Would need previous context to populate
        taskCountDelta: current.pendingTasks.length - previous.taskIds.size,
      },

      location: {
        changed: locationChanged,
        previousLocation: previous.locationState,
        currentLocation: currentLocationState,
      },

      dayPlan: {
        isNewDay,
        newPriorities: isNewDay
          ? (current.dayPlan?.priorities.map(p => p.description) ?? [])
          : [],
        completedPriorities: current.dayPlan?.priorities
          .filter(p => newlyCompletedPriorities.includes(p.id))
          .map(p => p.description) ?? [],
        priorityProgressDelta: newlyCompletedPriorities.length,
      },

      hasSignificantChanges,
      changeSummary,
    };
  };

  // ... rest of existing methods
}
```

### Orchestrator Integration

```typescript
// src/orchestrator/orchestrator.ts

// In chat() method, pass conversationId to enable delta tracking
const { context, delta } = await contextBuilder.buildContext({
  conversationId: conversation.id,
  now: new Date(),
});

// Include delta in system prompt if significant changes
if (delta?.hasSignificantChanges) {
  const deltaSection = generateDeltaInstructions(delta);
  systemPrompt = `${systemPrompt}\n\n${deltaSection}`;
}
```

### Personality Prompt Integration

```typescript
// src/personality/personality.prompts.ts

const generateDeltaInstructions = (delta: ContextDelta): string => {
  if (!delta.hasSignificantChanges) return '';

  const lines: string[] = [
    '## Since We Last Spoke',
    '',
    `Time elapsed: ${formatDuration(delta.timeSinceLastSnapshot)}`,
    '',
    'Changes:',
    ...delta.changeSummary.map(change => `- ${change}`),
  ];

  return lines.join('\n');
};

const formatDuration = (minutes: number): string => {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? 's' : ''}`;
};
```

---

## Configuration

```typescript
// Add to src/config/config.ts

context: {
  deltaCacheMaxEntries: {
    doc: 'Maximum number of context snapshots to cache',
    format: 'int',
    default: 100,
    env: 'GLADOS_CONTEXT_CACHE_MAX_ENTRIES',
  },
  deltaCacheTtlMinutes: {
    doc: 'How long to keep context snapshots (minutes)',
    format: 'int',
    default: 1440, // 24 hours
    env: 'GLADOS_CONTEXT_CACHE_TTL_MINUTES',
  },
},
```

---

## Agent Experience

### Before (No Change Detection)

```
User: "Good morning"
Agent: "Good morning! You have 3 meetings today..."
[No awareness of what changed overnight]
```

### After (With Change Detection)

```
User: "Good morning"
[Delta detected: 2 new calendar events, 1 task completed, location: home]
Agent: "Good morning! A couple of updates since yesterday:
- Two new meetings were added to your calendar (Team sync at 10am, 1:1 with Bob at 2pm)
- You completed the 'Review proposal' task
You have 5 meetings today total..."
```

### Agent Discretion

The agent receives the delta but decides whether to mention it based on:
- Significance of changes
- Conversation context (if user asks a specific question, don't lead with changes)
- Time elapsed (changes from 5 minutes ago less noteworthy than overnight)

---

## Testing Strategy

### Unit Tests

- Delta computation for each dimension (calendar, tasks, location, day plan)
- Cache TTL expiration
- LRU eviction when cache is full
- Edge cases: empty previous context, no changes, all dimensions changed

### Integration Tests

- Full flow: build context, cache, build again, verify delta
- Cross-conversation isolation (conversation A's cache doesn't affect B)
- Orchestrator integration: delta appears in system prompt

### Test Scenarios

```typescript
describe('ContextChangeDetection', () => {
  it('detects new calendar events', async () => {
    // First build: no events
    const first = await contextBuilder.buildContext({ conversationId: 'test-1' });
    expect(first.delta).toBeNull();

    // Add an event
    await calendarService.createEvent({ ... });

    // Second build: should detect new event
    const second = await contextBuilder.buildContext({ conversationId: 'test-1' });
    expect(second.delta?.calendar.newEvents).toHaveLength(1);
  });

  it('detects location changes', async () => {
    // First build: at home
    mockLocationService.setLocation('home');
    await contextBuilder.buildContext({ conversationId: 'test-2' });

    // Change location
    mockLocationService.setLocation('work');

    // Second build: should detect change
    const result = await contextBuilder.buildContext({ conversationId: 'test-2' });
    expect(result.delta?.location.changed).toBe(true);
    expect(result.delta?.location.previousLocation).toBe('home');
    expect(result.delta?.location.currentLocation).toBe('work');
  });

  it('expires cache entries after TTL', async () => {
    await contextBuilder.buildContext({ conversationId: 'test-3' });

    // Advance time beyond TTL
    jest.advanceTimersByTime(25 * 60 * 60 * 1000); // 25 hours

    // Should be treated as first build (no delta)
    const result = await contextBuilder.buildContext({ conversationId: 'test-3' });
    expect(result.delta).toBeNull();
  });
});
```

---

## Implementation Phases

### Phase 1: Core Infrastructure

- [x] Add `ContextDelta` and `ContextWithDelta` schemas
- [x] Implement in-memory cache with LRU eviction
- [x] Add cache TTL expiration logic
- [x] Add configuration options

### Phase 2: Delta Computation

- [x] Implement calendar change detection
- [x] Implement task change detection
- [x] Implement location change detection
- [x] Implement day plan change detection
- [x] Generate human-readable change summary

### Phase 3: Integration

- [x] Update `buildContext` signature to support `conversationId`
- [x] Integrate with orchestrator to pass `conversationId`
- [x] Add delta section to system prompt generation

### Phase 4: Testing

- [x] Unit tests for delta computation
- [x] Unit tests for cache behavior
- [x] Integration tests for full flow

---

## Future Considerations

1. **Persistent cache**: Store snapshots in database for cross-restart continuity

2. **Richer event comparison**: Track event modifications (time changed, title changed) not just add/remove

3. **Task detail tracking**: Include task status transitions (pending → in_progress → completed)

4. **Proactive notifications**: Use detected changes to trigger notifications ("Your 2pm meeting was cancelled")

5. **Change importance scoring**: Weight changes by significance (cancelled meeting > new task)

6. **Conversation-aware caching**: Different cache strategies for different conversation types (trigger vs user chat)

7. **Delta aggregation**: For long gaps, summarize many small changes into higher-level insights
