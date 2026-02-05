import { z } from 'zod';

import { getConfig } from '../../config/config.ts';
import type { ToolDefinition } from '../../tools/tools.types.ts';
import { ExternalServiceRegistry } from '../external.ts';

import type { HomeAssistantClient } from './homeassistant.ts';
import type { HaCalendarEvent } from './homeassistant.schemas.ts';

/**
 * Input schema for ha_call_service tool.
 */
const haCallServiceInputSchema = z.object({
  domain: z.string().describe('Service domain (e.g., "light", "switch", "climate", "cover")'),
  service: z.string().describe('Service name (e.g., "turn_on", "turn_off", "toggle", "set_temperature")'),
  target: z
    .object({
      entity_id: z
        .union([z.string(), z.array(z.string())])
        .describe('Entity ID(s) to target (e.g., "light.living_room")'),
    })
    .optional()
    .describe('Target entities for the service call'),
  data: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Service data (e.g., { brightness_pct: 80, color_name: "blue" })'),
});

type HaCallServiceInput = z.infer<typeof haCallServiceInputSchema>;

/**
 * Output schema for ha_call_service tool.
 */
const haCallServiceOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

type HaCallServiceOutput = z.infer<typeof haCallServiceOutputSchema>;

/**
 * ha_call_service tool - Call a Home Assistant service to control devices.
 */
const haCallServiceTool: ToolDefinition<HaCallServiceInput, HaCallServiceOutput> = {
  id: 'ha_call_service',
  name: 'Call Home Assistant Service',
  description: `Call a Home Assistant service to control smart home devices.

Common domains and services:
- light: turn_on, turn_off, toggle (data: brightness_pct, color_name, rgb_color)
- switch: turn_on, turn_off, toggle
- climate: set_temperature, set_hvac_mode (data: temperature, hvac_mode)
- cover: open_cover, close_cover, stop_cover, set_cover_position
- media_player: turn_on, turn_off, volume_set, media_play, media_pause
- scene: turn_on
- script: turn_on
- automation: trigger, turn_on, turn_off

Examples:
- Turn on a light: domain="light", service="turn_on", target={ entity_id: "light.living_room" }
- Dim a light: domain="light", service="turn_on", target={ entity_id: "light.bedroom" }, data={ brightness_pct: 50 }
- Set thermostat: domain="climate", service="set_temperature", target={ entity_id: "climate.main" }, data={ temperature: 72 }`,

  category: 'external',

  requiredServices: ['homeassistant'],

  inputSchema: haCallServiceInputSchema,
  outputSchema: haCallServiceOutputSchema,

  risk: {
    level: 'medium',
    reason: 'Modifies smart home device state',
    potentialImpact: 'Changes to lights, switches, climate, and other devices',
    reversible: true,
    categories: [],
  },

  tags: ['homeassistant', 'smart-home', 'iot'],

  examples: [
    {
      description: 'Turn on living room lights at 80% brightness',
      input: {
        domain: 'light',
        service: 'turn_on',
        target: { entity_id: 'light.living_room' },
        data: { brightness_pct: 80 },
      },
    },
    {
      description: 'Set thermostat to 72 degrees',
      input: {
        domain: 'climate',
        service: 'set_temperature',
        target: { entity_id: 'climate.main_floor' },
        data: { temperature: 72 },
      },
    },
    {
      description: 'Toggle a switch',
      input: {
        domain: 'switch',
        service: 'toggle',
        target: { entity_id: 'switch.office_fan' },
      },
    },
  ],

  execute: async (input, context): Promise<HaCallServiceOutput> => {
    const registry = context.services.get(ExternalServiceRegistry);
    const client = await registry.getClient<HomeAssistantClient>('homeassistant');

    await client.connection.sendMessagePromise({
      type: 'call_service',
      domain: input.domain,
      service: input.service,
      target: input.target,
      service_data: input.data,
    });

    // Build a human-readable message
    const targetStr = input.target?.entity_id
      ? ` on ${Array.isArray(input.target.entity_id) ? input.target.entity_id.join(', ') : input.target.entity_id}`
      : '';

    return {
      success: true,
      message: `Called ${input.domain}.${input.service}${targetStr}`,
    };
  },
};

/**
 * Input schema for ha_get_calendar tool.
 */
const haGetCalendarInputSchema = z.object({
  entityId: z
    .string()
    .optional()
    .describe(
      'Calendar entity ID to fetch (e.g., "calendar.family"). If omitted, fetches from all configured calendars.',
    ),
  start: z.string().optional().describe('Start datetime (ISO format). Defaults to start of today.'),
  end: z.string().optional().describe('End datetime (ISO format). Defaults to end of today.'),
});

type HaGetCalendarInput = z.infer<typeof haGetCalendarInputSchema>;

/**
 * Output schema for ha_get_calendar tool.
 */
const haGetCalendarOutputSchema = z.object({
  events: z.array(
    z.object({
      calendar: z.string(),
      start: z.string(),
      end: z.string(),
      summary: z.string(),
      description: z.string().optional(),
      location: z.string().optional(),
      allDay: z.boolean(),
    }),
  ),
  message: z.string(),
});

type HaGetCalendarOutput = z.infer<typeof haGetCalendarOutputSchema>;

/**
 * Helper to get start of day.
 */
const startOfDay = (date: Date): Date => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
};

/**
 * Helper to get end of day.
 */
const endOfDay = (date: Date): Date => {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
};

/**
 * ha_get_calendar tool - Fetch calendar events from Home Assistant calendars.
 */
const haGetCalendarTool: ToolDefinition<HaGetCalendarInput, HaGetCalendarOutput> = {
  id: 'ha_get_calendar',
  name: 'Get Home Assistant Calendar',
  description: `Fetch calendar events from Home Assistant.

Use this tool to get events from HA-connected calendars (Google Calendar, local calendars, etc.).

Examples:
- Get today's events: no parameters needed
- Get specific calendar: entityId="calendar.family"
- Get events for a date range: start="2026-02-05T00:00:00Z", end="2026-02-07T23:59:59Z"`,

  category: 'external',

  requiredServices: ['homeassistant'],

  inputSchema: haGetCalendarInputSchema,
  outputSchema: haGetCalendarOutputSchema,

  risk: {
    level: 'low',
    reason: 'Read-only access to calendar data',
    potentialImpact: 'None - only reads calendar events',
    reversible: true,
    categories: [],
  },

  tags: ['homeassistant', 'calendar', 'scheduling'],

  examples: [
    {
      description: "Get today's events from all configured calendars",
      input: {},
    },
    {
      description: 'Get events from a specific calendar',
      input: {
        entityId: 'calendar.family',
      },
    },
    {
      description: 'Get events for a specific date range',
      input: {
        start: '2026-02-05T00:00:00Z',
        end: '2026-02-07T23:59:59Z',
      },
    },
  ],

  execute: async (input, context): Promise<HaGetCalendarOutput> => {
    const registry = context.services.get(ExternalServiceRegistry);
    const client = await registry.getClient<HomeAssistantClient>('homeassistant');
    const config = getConfig();

    // Determine date range
    const now = new Date();
    const start = input.start ? new Date(input.start) : startOfDay(now);
    const end = input.end ? new Date(input.end) : endOfDay(now);

    // Determine which calendars to fetch
    const calendars = input.entityId ? [input.entityId] : config.homeassistant.calendarEntities;

    if (calendars.length === 0) {
      return {
        events: [],
        message: 'No calendar entities configured. Set GLADOS_HOMEASSISTANT_CALENDARS or specify entityId.',
      };
    }

    // Fetch from all calendars in parallel
    const results = await Promise.all(
      calendars.map(async (entityId) => {
        try {
          const events = await client.getCalendarEvents(entityId, start, end);
          return events.map((event: HaCalendarEvent) => ({
            calendar: entityId,
            ...event,
            allDay: !event.start.includes('T'),
          }));
        } catch {
          // Skip calendars that fail (might not exist)
          return [];
        }
      }),
    );

    const allEvents = results
      .flat()
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((event) => ({
        calendar: event.calendar,
        start: event.start,
        end: event.end,
        summary: event.summary,
        description: event.description ?? undefined,
        location: event.location ?? undefined,
        allDay: event.allDay,
      }));

    return {
      events: allEvents,
      message: `Found ${allEvents.length} event(s) from ${calendars.length} calendar(s)`,
    };
  },
};

export type { HaCallServiceInput, HaCallServiceOutput, HaGetCalendarInput, HaGetCalendarOutput };
export {
  haCallServiceTool,
  haCallServiceInputSchema,
  haCallServiceOutputSchema,
  haGetCalendarTool,
  haGetCalendarInputSchema,
  haGetCalendarOutputSchema,
};
