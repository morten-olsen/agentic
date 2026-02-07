import * as crypto from 'node:crypto';

import type { Services } from '../../core/services/services.ts';
import { DatabaseService } from '../../core/database/database.ts';
import { getConfig, isHomeAssistantConfigured } from '../../core/config/config.ts';
import { ExternalServiceRegistry } from '../../integrations/external/external.ts';
import type { HomeAssistantClient } from '../../integrations/external/homeassistant/homeassistant.ts';
import type { HaCalendarEvent } from '../../integrations/external/homeassistant/homeassistant.schemas.ts';

import { CalendarService } from './calendar.ts';
import type { CalendarEvent, CreateCalendarEventInput } from './calendar.schemas.ts';
import type { CalendarSyncState, SyncResult } from './calendar-sync.schemas.ts';
import * as syncStore from './calendar-sync.store.ts';

// ============================================================================
// Fingerprint Generation
// ============================================================================

/**
 * Generates a unique fingerprint for a Home Assistant calendar event.
 * Uses SHA256 hash of calendar entity ID, start time, and summary.
 * Returns a prefixed 16-character hex string.
 */
const generateFingerprint = (calendarEntityId: string, start: string, summary: string): string => {
  const input = `${calendarEntityId}|${start}|${summary}`;
  const hash = crypto.createHash('sha256').update(input).digest('hex');
  return `ha_${hash.substring(0, 16)}`;
};

// ============================================================================
// All-Day Event Detection
// ============================================================================

/**
 * Detects if a Home Assistant event is an all-day event.
 * All-day events have date-only start (no 'T' for time component).
 */
const isAllDayEvent = (event: HaCalendarEvent): boolean => {
  return !event.start.includes('T');
};

/**
 * Converts a date-only string to an ISO datetime string (midnight UTC).
 */
const dateToDatetime = (dateStr: string): string => {
  // For date-only strings like "2026-02-05", create a datetime at midnight UTC
  return `${dateStr}T00:00:00.000Z`;
};

// ============================================================================
// Calendar Sync Service
// ============================================================================

type CalendarSyncConfig = {
  syncIntervalMinutes: number;
  syncWindowDays: number;
};

/**
 * CalendarSyncService - synchronizes calendar events from Home Assistant
 * to the local database.
 */
class CalendarSyncService {
  #services: Services;
  #config: CalendarSyncConfig;
  #syncInterval: ReturnType<typeof setInterval> | null = null;
  #isSyncing = false;

  constructor(services: Services) {
    this.#services = services;
    const appConfig = getConfig();
    this.#config = {
      syncIntervalMinutes: appConfig.calendarSync.intervalMinutes,
      syncWindowDays: appConfig.calendarSync.windowDays,
    };
  }

  // ==========================================================================
  // Sync State Access
  // ==========================================================================

  /**
   * Gets the sync state for a calendar source.
   */
  getSyncState = async (sourceId: string): Promise<CalendarSyncState | null> => {
    const db = this.#services.get(DatabaseService);
    return syncStore.getSyncState(db.knex, sourceId);
  };

  /**
   * Gets all sync states.
   */
  getAllSyncStates = async (): Promise<CalendarSyncState[]> => {
    const db = this.#services.get(DatabaseService);
    return syncStore.getAllSyncStates(db.knex);
  };

  // ==========================================================================
  // Sync Logic
  // ==========================================================================

  /**
   * Synchronizes a single Home Assistant calendar to the local database.
   */
  syncHomeAssistantCalendar = async (entityId: string): Promise<SyncResult> => {
    const result: SyncResult = {
      sourceId: entityId,
      created: 0,
      updated: 0,
      deleted: 0,
      unchanged: 0,
      errors: [],
    };

    const db = this.#services.get(DatabaseService);
    const calendar = this.#services.get(CalendarService);

    try {
      // Get Home Assistant client
      const registry = this.#services.get(ExternalServiceRegistry);
      const client = await registry.getClient<HomeAssistantClient>('homeassistant');
      const appConfig = getConfig();

      // Calculate sync window - start from beginning of today to capture all-day events
      const now = new Date();
      const windowStart = new Date(now);
      windowStart.setHours(0, 0, 0, 0);
      const windowEnd = new Date(now.getTime() + this.#config.syncWindowDays * 24 * 60 * 60 * 1000);

      // Fetch events from Home Assistant
      const haEvents = await client.getCalendarEvents(entityId, windowStart, windowEnd);

      // Get existing events from the database for this source/calendar
      const existingEvents = await calendar.getEventsBySourceAndCalendar('homeassistant', entityId);

      // Build maps for efficient lookup
      const existingByFingerprint = new Map<string, CalendarEvent>();
      for (const event of existingEvents) {
        if (event.externalId) {
          existingByFingerprint.set(event.externalId, event);
        }
      }

      // Track which events we've seen from HA
      const seenEventIds = new Set<string>();
      const defaultTimezone = appConfig.homeassistant.url ? 'UTC' : 'UTC'; // Could be improved with HA config

      // Process each HA event
      for (const haEvent of haEvents) {
        const fingerprint = generateFingerprint(entityId, haEvent.start, haEvent.summary);
        const allDay = isAllDayEvent(haEvent);

        // Normalize times for all-day events
        let startTime = haEvent.start;
        let endTime = haEvent.end;
        if (allDay) {
          startTime = dateToDatetime(haEvent.start);
          endTime = dateToDatetime(haEvent.end);
        }

        const existing = existingByFingerprint.get(fingerprint);

        if (existing) {
          // Check if event needs update
          seenEventIds.add(existing.id);

          const needsUpdate =
            existing.title !== haEvent.summary ||
            existing.description !== (haEvent.description ?? undefined) ||
            existing.location !== (haEvent.location ?? undefined) ||
            existing.end !== endTime;

          if (needsUpdate) {
            await calendar.updateEvent(existing.id, {
              title: haEvent.summary,
              description: haEvent.description ?? undefined,
              location: haEvent.location ?? undefined,
              end: endTime,
            });
            result.updated++;
          } else {
            result.unchanged++;
          }
        } else {
          // Create new event
          const input: CreateCalendarEventInput = {
            externalId: fingerprint,
            source: 'homeassistant',
            calendarSourceId: entityId,
            title: haEvent.summary,
            description: haEvent.description ?? undefined,
            location: haEvent.location ?? undefined,
            start: startTime,
            end: endTime,
            allDay,
            timezone: defaultTimezone,
          };

          const created = await calendar.createEvent(input);
          seenEventIds.add(created.id);
          result.created++;
        }
      }

      // Delete events that are no longer in HA (within the sync window)
      const deleteCount = await calendar.deleteEventsBySourceAndCalendar(
        'homeassistant',
        entityId,
        Array.from(seenEventIds),
      );
      result.deleted = deleteCount;

      // Update sync state
      await syncStore.updateSyncState(db.knex, entityId, {
        lastSyncAt: new Date().toISOString(),
        lastSyncStatus: 'success',
        eventsInWindow: seenEventIds.size,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(errorMessage);

      // Update sync state with error
      await syncStore.updateSyncState(db.knex, entityId, {
        lastSyncAt: new Date().toISOString(),
        lastSyncStatus: 'error',
        errorMessage,
        eventsInWindow: 0,
      });
    }

    return result;
  };

  /**
   * Synchronizes all configured Home Assistant calendars.
   */
  syncAll = async (): Promise<SyncResult[]> => {
    if (!isHomeAssistantConfigured()) {
      return [];
    }

    const appConfig = getConfig();
    const calendars = appConfig.homeassistant.calendarEntities;

    if (calendars.length === 0) {
      return [];
    }

    const results: SyncResult[] = [];
    for (const entityId of calendars) {
      const result = await this.syncHomeAssistantCalendar(entityId);
      results.push(result);
    }

    return results;
  };

  // ==========================================================================
  // Background Sync
  // ==========================================================================

  /**
   * Starts background sync on the configured interval.
   */
  startBackgroundSync = async (): Promise<void> => {
    if (this.#syncInterval) {
      return; // Already running
    }

    if (!isHomeAssistantConfigured()) {
      console.log('Calendar sync: Home Assistant not configured, skipping');
      return;
    }

    const appConfig = getConfig();
    if (appConfig.homeassistant.calendarEntities.length === 0) {
      console.log('Calendar sync: No calendars configured, skipping');
      return;
    }

    console.log(
      `Calendar sync: Starting background sync (interval: ${this.#config.syncIntervalMinutes}min, window: ${this.#config.syncWindowDays}d)`,
    );

    // Do initial sync
    await this.#runSync();

    // Set up interval
    const intervalMs = this.#config.syncIntervalMinutes * 60 * 1000;
    this.#syncInterval = setInterval(() => {
      void this.#runSync();
    }, intervalMs);
  };

  /**
   * Stops background sync.
   */
  stopBackgroundSync = (): void => {
    if (this.#syncInterval) {
      clearInterval(this.#syncInterval);
      this.#syncInterval = null;
      console.log('Calendar sync: Stopped background sync');
    }
  };

  /**
   * Runs a sync cycle, preventing overlapping syncs.
   */
  #runSync = async (): Promise<void> => {
    if (this.#isSyncing) {
      console.log('Calendar sync: Sync already in progress, skipping');
      return;
    }

    this.#isSyncing = true;
    try {
      const results = await this.syncAll();
      const totalCreated = results.reduce((sum, r) => sum + r.created, 0);
      const totalUpdated = results.reduce((sum, r) => sum + r.updated, 0);
      const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0);
      const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

      if (totalCreated > 0 || totalUpdated > 0 || totalDeleted > 0 || totalErrors > 0) {
        console.log(
          `Calendar sync: ${results.length} calendars, ${totalCreated} created, ${totalUpdated} updated, ${totalDeleted} deleted, ${totalErrors} errors`,
        );
      }
    } catch (error) {
      console.error('Calendar sync: Error during sync:', error);
    } finally {
      this.#isSyncing = false;
    }
  };
}

// Re-export types
export type { CalendarSyncState, SyncResult } from './calendar-sync.schemas.ts';
export { calendarSyncStateSchema, syncResultSchema } from './calendar-sync.schemas.ts';

export { CalendarSyncService, generateFingerprint, isAllDayEvent };
