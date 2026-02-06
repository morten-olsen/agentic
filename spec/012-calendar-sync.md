# Calendar Synchronization Specification

> Unified calendar experience through periodic synchronization from external sources

**Version**: 1.0
**Status**: Completed
**Dependencies**: Calendar (Phase 1), External Services (009)

## Overview

Currently, GLaDOS has two calendar systems: a local database calendar and direct Home Assistant calendar queries. This federated approach causes issues:

1. **Reliability**: Home Assistant can be slow or unavailable, causing agent failures
2. **Confusion**: The agent sees two different calendars and may not know which to use
3. **No change tracking**: Home Assistant events lack IDs, making updates difficult to detect

This specification introduces a **synchronization model** where external calendars (starting with Home Assistant) are periodically synced to the local database, giving both the agent and user a simple "just having a calendar" experience.

### Goals

1. **Single source of truth**: All calendar queries go through the local database
2. **Periodic sync**: Background sync from external sources (configurable interval)
3. **Change detection**: Track external events using derived identifiers since HA lacks event IDs
4. **Resilient**: Sync failures don't affect calendar availability (stale data is better than no data)
5. **Source transparency**: Events retain their source for display when relevant
6. **Multiple calendars**: Support syncing multiple HA calendar entities

### Non-Goals (for v1)

- Bidirectional sync (writing back to Home Assistant)
- Real-time push notifications from HA (polling only)
- Conflict resolution for simultaneous edits (external source wins)
- Syncing to Google Calendar, Outlook, etc. (future consideration)
- Recurring event expansion (sync events as they appear in HA's range)

### Key Design Decisions

1. **Derived event fingerprint**: Since HA events lack IDs, generate a deterministic fingerprint from `calendar_entity + start + summary` to identify events across syncs
2. **External source wins**: When an event is updated in HA, the local copy is overwritten (no merge)
3. **Soft delete detection**: Events that disappear from HA within the sync window are marked deleted locally
4. **Local events untouched**: Events with `source: 'local'` are never modified by sync
5. **Configurable sync window**: Default 30 days forward, configurable per calendar

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Calendar Synchronization System                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    Calendar Sources Configuration                    │   │
│   │                                                                      │   │
│   │  GLADOS_HOMEASSISTANT_CALENDARS=calendar.family,calendar.work       │   │
│   │  GLADOS_CALENDAR_SYNC_INTERVAL_MINUTES=15                           │   │
│   │  GLADOS_CALENDAR_SYNC_WINDOW_DAYS=30                                │   │
│   │                                                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    │ Periodic (every N minutes)              │
│                                    ▼                                         │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                     CalendarSyncService                              │   │
│   │                                                                      │   │
│   │  syncAll()                                                          │   │
│   │    │                                                                │   │
│   │    ├──▶ For each configured calendar source:                        │   │
│   │    │      │                                                         │   │
│   │    │      ├──▶ Fetch events from HA (next 30 days)                 │   │
│   │    │      │                                                         │   │
│   │    │      ├──▶ Generate fingerprints for each event                │   │
│   │    │      │                                                         │   │
│   │    │      ├──▶ Compare with existing synced events                 │   │
│   │    │      │                                                         │   │
│   │    │      ├──▶ Create new events                                   │   │
│   │    │      │                                                         │   │
│   │    │      ├──▶ Update changed events                               │   │
│   │    │      │                                                         │   │
│   │    │      └──▶ Mark removed events as deleted                      │   │
│   │    │                                                                │   │
│   │    └──▶ Update sync state                                          │   │
│   │                                                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    │                                         │
│                                    ▼                                         │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    Local Calendar Database                           │   │
│   │                                                                      │   │
│   │  calendar_events table (existing)                                   │   │
│   │  ├── source: 'local' | 'homeassistant'                              │   │
│   │  ├── external_id: fingerprint for synced events                     │   │
│   │  └── calendar_source_id: 'calendar.family' etc.                     │   │
│   │                                                                      │   │
│   │  calendar_sync_state table (new)                                    │   │
│   │  ├── source_id: 'homeassistant:calendar.family'                     │   │
│   │  ├── last_sync_at: timestamp                                        │   │
│   │  ├── last_sync_status: 'success' | 'error'                          │   │
│   │  └── error_message: nullable                                        │   │
│   │                                                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Sync Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         Sync Cycle Flow                                   │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  1. FETCH: Get events from Home Assistant for configured calendars       │
│     ┌───────────────────────────────────────────────────────────────┐    │
│     │  HA Calendar: calendar.morten_olsen_zeronorth_com             │    │
│     │  Events: [{start: "2026-02-05T09:00", summary: "Daily"}...]   │    │
│     └───────────────────────────────────────────────────────────────┘    │
│                                    │                                      │
│                                    ▼                                      │
│  2. FINGERPRINT: Generate stable ID for each event                       │
│     ┌───────────────────────────────────────────────────────────────┐    │
│     │  fingerprint = hash(calendar_entity + start + summary)         │    │
│     │                                                                │    │
│     │  "calendar.morten_olsen_zeronorth_com|2026-02-05T09:00|Daily" │    │
│     │  → "ha_abc123def456"                                          │    │
│     └───────────────────────────────────────────────────────────────┘    │
│                                    │                                      │
│                                    ▼                                      │
│  3. COMPARE: Match against existing events by fingerprint                │
│     ┌───────────────────────────────────────────────────────────────┐    │
│     │  Existing in DB with source='homeassistant':                  │    │
│     │  - ha_abc123def456 → FOUND, check for changes                 │    │
│     │  - ha_xyz789 → NOT IN HA RESPONSE, mark for deletion          │    │
│     │                                                                │    │
│     │  New in HA:                                                   │    │
│     │  - ha_new456 → NOT IN DB, create                              │    │
│     └───────────────────────────────────────────────────────────────┘    │
│                                    │                                      │
│                                    ▼                                      │
│  4. APPLY: Create, update, or soft-delete events                         │
│     ┌───────────────────────────────────────────────────────────────┐    │
│     │  CREATE: Insert new events with source='homeassistant'        │    │
│     │  UPDATE: Overwrite changed events (HA wins)                   │    │
│     │  DELETE: Remove events no longer in HA sync window            │    │
│     └───────────────────────────────────────────────────────────────┘    │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘
```

### Event Fingerprinting

Since Home Assistant calendar events don't have stable IDs, we derive a fingerprint:

```
fingerprint = sha256(calendar_entity_id + "|" + start_datetime + "|" + summary).substring(0, 16)
```

**Why this works:**
- `calendar_entity_id`: Distinguishes events from different HA calendars
- `start_datetime`: Most events have unique start times
- `summary`: Disambiguates multiple events at the same time

**Edge case: Duplicate fingerprints**
If two events have the same start time and summary (rare), append an index:
- `ha_abc123` (first occurrence)
- `ha_abc123_1` (second occurrence)

**When fingerprint changes:**
If an event's start time or summary changes in HA, it's treated as a delete + create (old fingerprint disappears, new one appears). This is acceptable for v1.

---

## Configuration

### Environment Variables

```bash
# Existing Home Assistant config
GLADOS_HOMEASSISTANT_URL=http://homeassistant.local:8123
GLADOS_HOMEASSISTANT_TOKEN=eyJhbG...

# Calendar sync config (new)
GLADOS_HOMEASSISTANT_CALENDARS=calendar.family,calendar.work,calendar.personal
GLADOS_CALENDAR_SYNC_INTERVAL_MINUTES=15
GLADOS_CALENDAR_SYNC_WINDOW_DAYS=30
```

### Convict Schema Addition

```typescript
// Add to src/config/config.ts

homeassistant: {
  // ... existing url and token ...

  calendars: {
    doc: 'Comma-separated list of Home Assistant calendar entity IDs to sync',
    format: String,
    default: '',
    env: 'GLADOS_HOMEASSISTANT_CALENDARS',
  },
  calendarSyncIntervalMinutes: {
    doc: 'How often to sync calendars (in minutes)',
    format: 'int',
    default: 15,
    env: 'GLADOS_CALENDAR_SYNC_INTERVAL_MINUTES',
  },
  calendarSyncWindowDays: {
    doc: 'How many days forward to sync',
    format: 'int',
    default: 30,
    env: 'GLADOS_CALENDAR_SYNC_WINDOW_DAYS',
  },
},
```

---

## Data Model

### Extended EventSource

```typescript
// Update src/calendar/calendar.schemas.ts

const eventSourceSchema = z.enum([
  'local',
  'google',
  'outlook',
  'ical',
  'homeassistant',  // NEW
]);

type EventSource = z.infer<typeof eventSourceSchema>;
```

### Extended CalendarEvent

```typescript
// Add to CalendarEvent schema

const calendarEventSchema = z.object({
  // ... existing fields ...

  // New field for identifying the specific external calendar
  calendarSourceId: z.string().nullable().optional(),
  // e.g., 'calendar.family' for HA, 'john@gmail.com' for Google
});
```

### Sync State

```typescript
// src/calendar/calendar-sync.schemas.ts

const calendarSyncStateSchema = z.object({
  sourceId: z.string(),              // e.g., 'homeassistant:calendar.family'
  lastSyncAt: z.string().datetime(), // ISO timestamp
  lastSyncStatus: z.enum(['success', 'error', 'in_progress']),
  errorMessage: z.string().nullable(),
  eventsInWindow: z.number(),        // Count of events currently in sync window
});

type CalendarSyncState = z.infer<typeof calendarSyncStateSchema>;
```

### Sync Result

```typescript
const syncResultSchema = z.object({
  sourceId: z.string(),
  created: z.number(),
  updated: z.number(),
  deleted: z.number(),
  unchanged: z.number(),
  errors: z.array(z.string()),
});

type SyncResult = z.infer<typeof syncResultSchema>;
```

---

## Database Schema

### Migration: Add calendar_source_id column

```typescript
// src/database/migrations/XXX_calendar_sync.ts

export const up = async (knex: Knex): Promise<void> => {
  // Add calendar_source_id to calendar_events
  await knex.schema.alterTable('calendar_events', (table) => {
    table.text('calendar_source_id').nullable();
    table.index(['source', 'calendar_source_id'], 'idx_calendar_source');
  });

  // Create sync state table
  await knex.schema.createTable('calendar_sync_state', (table) => {
    table.text('source_id').primary();
    table.text('last_sync_at').notNullable();
    table.text('last_sync_status').notNullable().defaultTo('success');
    table.text('error_message').nullable();
    table.integer('events_in_window').notNullable().defaultTo(0);
  });
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTable('calendar_sync_state');
  await knex.schema.alterTable('calendar_events', (table) => {
    table.dropIndex(['source', 'calendar_source_id'], 'idx_calendar_source');
    table.dropColumn('calendar_source_id');
  });
};
```

---

## CalendarSyncService

### Interface

```typescript
// src/calendar/calendar-sync.ts

type CalendarSyncService = {
  // Manual sync triggers
  syncAll(): Promise<SyncResult[]>;
  syncSource(sourceId: string): Promise<SyncResult>;

  // Sync state queries
  getSyncState(sourceId: string): Promise<CalendarSyncState | null>;
  getAllSyncStates(): Promise<CalendarSyncState[]>;

  // Background sync management
  startBackgroundSync(): void;
  stopBackgroundSync(): void;
  isBackgroundSyncRunning(): boolean;
};
```

### Implementation

```typescript
const createCalendarSyncService = (deps: {
  calendar: CalendarService;
  homeassistant: HomeAssistantClient;
  db: Knex;
  config: Config;
  logger: Logger;
}): CalendarSyncService => {
  let syncInterval: NodeJS.Timeout | null = null;

  const generateFingerprint = (
    calendarEntityId: string,
    start: string,
    summary: string,
  ): string => {
    const input = `${calendarEntityId}|${start}|${summary}`;
    const hash = crypto.createHash('sha256').update(input).digest('hex');
    return `ha_${hash.substring(0, 16)}`;
  };

  const syncHomeAssistantCalendar = async (
    entityId: string,
  ): Promise<SyncResult> => {
    const sourceId = `homeassistant:${entityId}`;
    const result: SyncResult = {
      sourceId,
      created: 0,
      updated: 0,
      deleted: 0,
      unchanged: 0,
      errors: [],
    };

    try {
      // Update sync state to in_progress
      await updateSyncState(sourceId, 'in_progress', null);

      // Calculate sync window
      const now = new Date();
      const windowEnd = new Date(now);
      windowEnd.setDate(windowEnd.getDate() + deps.config.homeassistant.calendarSyncWindowDays);

      // Fetch events from Home Assistant
      const haEvents = await deps.homeassistant.getCalendarEvents(
        entityId,
        now,
        windowEnd,
      );

      // Get existing synced events for this source
      const existingEvents = await deps.calendar.getEventsBySource(
        'homeassistant',
        entityId,
      );
      const existingByFingerprint = new Map(
        existingEvents.map(e => [e.externalId, e])
      );

      // Track which fingerprints we see in this sync
      const seenFingerprints = new Set<string>();

      // Process each HA event
      for (const haEvent of haEvents) {
        const fingerprint = generateFingerprint(
          entityId,
          haEvent.start,
          haEvent.summary,
        );

        // Handle duplicate fingerprints
        let finalFingerprint = fingerprint;
        let suffix = 0;
        while (seenFingerprints.has(finalFingerprint)) {
          suffix++;
          finalFingerprint = `${fingerprint}_${suffix}`;
        }
        seenFingerprints.add(finalFingerprint);

        const existing = existingByFingerprint.get(finalFingerprint);

        if (existing) {
          // Check if event changed
          if (hasEventChanged(existing, haEvent)) {
            await deps.calendar.updateEvent(existing.id, {
              title: haEvent.summary,
              description: haEvent.description ?? null,
              location: haEvent.location ?? null,
              start: haEvent.start,
              end: haEvent.end,
              allDay: isAllDayEvent(haEvent),
            });
            result.updated++;
          } else {
            result.unchanged++;
          }
        } else {
          // Create new event
          await deps.calendar.createEvent({
            externalId: finalFingerprint,
            source: 'homeassistant',
            calendarSourceId: entityId,
            title: haEvent.summary,
            description: haEvent.description ?? null,
            location: haEvent.location ?? null,
            start: haEvent.start,
            end: haEvent.end,
            allDay: isAllDayEvent(haEvent),
            timezone: deps.config.timezone,
          });
          result.created++;
        }
      }

      // Delete events that are no longer in HA
      for (const [fingerprint, event] of existingByFingerprint) {
        if (!seenFingerprints.has(fingerprint)) {
          // Only delete if the event was within our sync window
          const eventStart = new Date(event.start);
          if (eventStart >= now && eventStart <= windowEnd) {
            await deps.calendar.deleteEvent(event.id);
            result.deleted++;
          }
        }
      }

      // Update sync state
      await updateSyncState(sourceId, 'success', null, seenFingerprints.size);

      deps.logger.info('Calendar sync completed', {
        sourceId,
        created: result.created,
        updated: result.updated,
        deleted: result.deleted,
      });

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(message);
      await updateSyncState(sourceId, 'error', message);
      deps.logger.error('Calendar sync failed', { sourceId, error: message });
    }

    return result;
  };

  const syncAll = async (): Promise<SyncResult[]> => {
    const calendars = deps.config.homeassistant.calendars
      .split(',')
      .map(c => c.trim())
      .filter(c => c.length > 0);

    const results: SyncResult[] = [];
    for (const entityId of calendars) {
      const result = await syncHomeAssistantCalendar(entityId);
      results.push(result);
    }
    return results;
  };

  const startBackgroundSync = (): void => {
    if (syncInterval) return;

    const intervalMs = deps.config.homeassistant.calendarSyncIntervalMinutes * 60 * 1000;

    // Run initial sync
    syncAll().catch(err => {
      deps.logger.error('Initial calendar sync failed', { error: err });
    });

    // Schedule recurring syncs
    syncInterval = setInterval(() => {
      syncAll().catch(err => {
        deps.logger.error('Scheduled calendar sync failed', { error: err });
      });
    }, intervalMs);

    deps.logger.info('Background calendar sync started', {
      intervalMinutes: deps.config.homeassistant.calendarSyncIntervalMinutes,
    });
  };

  const stopBackgroundSync = (): void => {
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
      deps.logger.info('Background calendar sync stopped');
    }
  };

  return {
    syncAll,
    syncSource: syncHomeAssistantCalendar,
    getSyncState,
    getAllSyncStates,
    startBackgroundSync,
    stopBackgroundSync,
    isBackgroundSyncRunning: () => syncInterval !== null,
  };
};
```

### Helper Functions

```typescript
const isAllDayEvent = (event: HaCalendarEvent): boolean => {
  // HA all-day events use date format "2026-02-05" without time
  // Timed events use "2026-02-05T09:00:00+01:00"
  return !event.start.includes('T');
};

const hasEventChanged = (
  existing: CalendarEvent,
  haEvent: HaCalendarEvent,
): boolean => {
  return (
    existing.title !== haEvent.summary ||
    existing.description !== (haEvent.description ?? null) ||
    existing.location !== (haEvent.location ?? null) ||
    existing.start !== haEvent.start ||
    existing.end !== haEvent.end
  );
};
```

---

## Tool Changes

### Delete ha_get_calendar Tool

The `ha_get_calendar` tool should be deleted. All calendar queries use the standard calendar tools which now include synced HA events.

### Update Calendar Tools

The existing calendar tools require no changes - they already work with the local database. The sync service populates the database, and tools query it.

### Optional: Add Sync Status Tool

```typescript
const calendarSyncStatusTool: ToolDefinition = {
  id: 'calendar_sync_status',
  name: 'Get Calendar Sync Status',
  description: 'Check the status of calendar synchronization from external sources',

  category: 'calendar',

  inputSchema: z.object({}),

  outputSchema: z.object({
    sources: z.array(calendarSyncStateSchema),
  }),

  risk: { level: 'none', reason: 'Read-only status check' },

  execute: async (_input, context) => {
    const syncService = context.services.get(CalendarSyncService);
    const states = await syncService.getAllSyncStates();
    return { sources: states };
  },
};
```

---

## Integration Points

### Startup

```typescript
// In application bootstrap

if (externalServices.isConfigured('homeassistant')) {
  const calendarSyncService = createCalendarSyncService({
    calendar: services.get(CalendarService),
    homeassistant: await externalServices.getClient('homeassistant'),
    db: services.get(Database),
    config: getConfig(),
    logger: services.get(Logger),
  });

  // Start background sync
  calendarSyncService.startBackgroundSync();

  // Register for graceful shutdown
  process.on('SIGTERM', () => {
    calendarSyncService.stopBackgroundSync();
  });
}
```

### Telegram Bot Integration

The sync service should integrate with the Telegram bot lifecycle, starting sync when the bot starts and stopping on shutdown.

### CLI Integration

The CLI can optionally start sync or run in "offline" mode with existing synced data.

---

## Agent Experience

### Before (Federated)

```
Agent: "Let me check your calendar..."
[Uses get_upcoming_events - gets local events only]
[Uses ha_get_calendar - may fail if HA is down]
Agent: "I found 2 events in your local calendar and... hmm, I couldn't reach Home Assistant."
```

### After (Synchronized)

```
Agent: "Let me check your calendar..."
[Uses get_upcoming_events - gets ALL events including synced HA events]
Agent: "You have 5 events today: CY breakfast at 9am, Daily at 10am..."
```

### Source Transparency

When relevant, the agent can see the source:

```typescript
// Event includes source information
{
  id: 'uuid-123',
  source: 'homeassistant',
  calendarSourceId: 'calendar.morten_olsen_zeronorth_com',
  title: 'Daily (Marvin)',
  // ...
}
```

The agent can mention this when appropriate: "Your work calendar shows a Daily meeting at 10am."

---

## Error Handling

### Sync Failure Scenarios

| Scenario | Behavior |
|----------|----------|
| HA unavailable | Sync fails, existing data preserved, retry next interval |
| Single calendar fails | Other calendars still sync, error logged |
| Fingerprint collision | Append index suffix to fingerprint |
| Event in past | Skip (only sync future events) |
| Malformed event data | Skip event, log error, continue sync |

### Graceful Degradation

- If sync hasn't run in >24 hours, log a warning but continue serving stale data
- If a calendar repeatedly fails, consider exponential backoff
- Never delete all synced events on a single failed sync (protect against HA returning empty)

---

## Testing Strategy

### Unit Tests

- Fingerprint generation consistency
- Change detection logic
- All-day event detection
- Sync result counting

### Integration Tests

- Full sync cycle with mock HA responses
- Create/update/delete scenarios
- Error handling for HA failures
- Background sync interval behavior

### Mock HA Calendar Response

```typescript
const mockHaCalendarResponse = [
  {
    start: '2026-02-05T09:00:00+01:00',
    end: '2026-02-05T09:15:00+01:00',
    summary: 'Daily (Marvin)',
    description: 'Join with Google Meet: ...',
    location: 'ZN-HQ-4th-GreenHouse',
  },
  {
    start: '2026-02-05',
    end: '2026-02-06',
    summary: 'All-day event',
    description: null,
    location: null,
  },
];
```

---

## File Structure

```
src/calendar/
├── calendar.ts                # Existing CalendarService
├── calendar.schemas.ts        # Updated with new source, calendarSourceId
├── calendar.store.ts          # Updated with getEventsBySource
├── calendar.utils.ts          # Existing utilities
├── calendar-sync.ts           # NEW: CalendarSyncService
├── calendar-sync.schemas.ts   # NEW: Sync-specific schemas
├── calendar-sync.store.ts     # NEW: Sync state persistence
└── calendar-sync.test.ts      # NEW: Sync tests
```

---

## Implementation Phases

### Phase 1: Database and Schema Updates

- [x] Add `homeassistant` to EventSource enum
- [x] Add `calendarSourceId` field to CalendarEvent schema
- [x] Create database migration for new column and sync_state table
- [x] Add `getEventsBySource()` method to CalendarStore

### Phase 2: Sync Service Core

- [x] Implement fingerprint generation
- [x] Implement `CalendarSyncService`
- [x] Add sync state persistence
- [x] Add configuration options to Convict

### Phase 3: Background Sync

- [x] Implement background sync interval
- [x] Integrate with Telegram bot lifecycle
- [x] Add graceful shutdown handling

### Phase 4: Tool Updates

- [x] Delete `ha_get_calendar` tool
- [ ] Add `calendar_sync_status` tool (optional)
- [ ] Update tool documentation

### Phase 5: Testing

- [x] Unit tests for fingerprinting and change detection
- [x] Integration tests for full sync cycle
- [x] Error scenario tests

### Phase 6: Documentation

- [ ] Update CLAUDE.md with sync information
- [ ] Add configuration documentation
- [ ] Update external services documentation

---

## Future Considerations

1. **Bidirectional sync**: Allow creating events in GLaDOS that sync back to Google Calendar/Outlook

2. **Real-time updates**: Use HA WebSocket subscriptions for instant sync instead of polling

3. **Multiple sync sources**: Add Google Calendar, Outlook Calendar adapters using the same sync infrastructure

4. **Conflict resolution**: If an event is modified both locally and externally, provide merge strategies

5. **Calendar discovery**: Auto-discover available HA calendars instead of manual configuration

6. **Sync preferences per calendar**: Different sync windows or intervals for different calendars

7. **Attendee mapping**: Map HA event attendees to GLaDOS contacts

8. **Historical sync**: Option to sync past events for record-keeping
