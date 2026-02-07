import { z } from 'zod';

import type { ToolDefinition } from '../../../agent/tools/tools.types.ts';
import { ExternalServiceRegistry } from '../external.ts';

import type { HomeAssistantClient } from './homeassistant.ts';

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

export type { HaCallServiceInput, HaCallServiceOutput };
export { haCallServiceTool, haCallServiceInputSchema, haCallServiceOutputSchema };
