import { z } from 'zod';

/**
 * Schema for Home Assistant calendar event.
 *
 * WebSocket API (call_service with return_response) returns:
 * - All-day: { start: "2026-02-04", end: "2026-02-05", summary: "Event" }
 * - Timed: { start: "2026-02-04T18:00:00+01:00", end: "2026-02-04T19:00:00+01:00", summary: "Event" }
 */
const haCalendarEventSchema = z.object({
  start: z.string().describe('Start date or datetime'),
  end: z.string().describe('End date or datetime'),
  summary: z.string().describe('Event title/summary'),
  description: z.string().nullable().optional().describe('Event description'),
  location: z.string().nullable().optional().describe('Event location'),
});

type HaCalendarEvent = z.infer<typeof haCalendarEventSchema>;

/**
 * Normalizes a raw HA calendar event (handles nullable fields).
 */
const normalizeHaEvent = (raw: HaCalendarEvent): HaCalendarEvent => {
  return {
    start: raw.start,
    end: raw.end,
    summary: raw.summary,
    description: raw.description ?? undefined,
    location: raw.location ?? undefined,
  };
};

// ============================================================================
// Person State Schema
// ============================================================================

/**
 * Schema for Home Assistant person entity state.
 *
 * Person entities track location via device trackers and provide:
 * - state: 'home', 'not_home', or zone name
 * - attributes: GPS coordinates, accuracy, and source tracker
 * - timestamps: last_updated (last refresh), last_changed (actual location change)
 */
const haPersonStateSchema = z.object({
  entity_id: z.string(),
  state: z.string(), // 'home', 'not_home', or zone name
  attributes: z.object({
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    gps_accuracy: z.number().optional(),
    source: z.string().optional(),
    friendly_name: z.string().optional(),
  }),
  last_updated: z.string(),
  last_changed: z.string(),
});

type HaPersonState = z.infer<typeof haPersonStateSchema>;

export type { HaCalendarEvent, HaPersonState };
export { haCalendarEventSchema, normalizeHaEvent, haPersonStateSchema };
