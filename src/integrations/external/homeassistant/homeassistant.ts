import {
  createConnection,
  createLongLivedTokenAuth,
  subscribeEntities,
  type Connection,
  type HassConfig,
  type HassEntities,
  type UnsubscribeFunc,
} from 'home-assistant-js-websocket';

import { getConfig, isHomeAssistantConfigured } from '../../../core/config/config.ts';
import type { ExternalServiceDefinition, ServiceClient } from '../external.schemas.ts';

import type { HaCalendarEvent, HaPersonState } from './homeassistant.schemas.ts';
import { haCalendarEventSchema, normalizeHaEvent } from './homeassistant.schemas.ts';

/**
 * Home Assistant client interface.
 * Extends ServiceClient with the WebSocket connection.
 */
type HomeAssistantClient = ServiceClient & {
  /** The Home Assistant WebSocket connection */
  connection: Connection;
  /** Get Home Assistant configuration */
  getConfig: () => Promise<HassConfig>;
  /** Get calendar events for a specific entity */
  getCalendarEvents: (entityId: string, start: Date, end: Date) => Promise<HaCalendarEvent[]>;
  /** Get cached person location (updated via WebSocket subscription) */
  getPersonLocation: () => HaPersonState | null;
};

/**
 * Home Assistant service definition.
 */
const homeassistantDefinition: ExternalServiceDefinition = {
  id: 'homeassistant',
  name: 'Home Assistant',
  description: 'Smart home control and automation via Home Assistant',

  isConfigured: isHomeAssistantConfigured,

  createClient: async (): Promise<HomeAssistantClient> => {
    const config = getConfig();
    const auth = createLongLivedTokenAuth(config.homeassistant.url, config.homeassistant.token);

    const connection = await createConnection({ auth });

    // Cache for person entity state (updated via WebSocket subscription)
    let personState: HaPersonState | null = null;
    let unsubscribe: UnsubscribeFunc | null = null;

    // Subscribe to entities if person tracking is configured
    // Wait for initial state before returning from createClient
    if (config.homeassistant.personEntity) {
      await new Promise<void>((resolve) => {
        let resolved = false;
        unsubscribe = subscribeEntities(connection, (entities: HassEntities) => {
          const entity = entities[config.homeassistant.personEntity];
          if (entity) {
            personState = {
              entity_id: entity.entity_id,
              state: entity.state,
              attributes: entity.attributes as HaPersonState['attributes'],
              last_updated: entity.last_updated,
              last_changed: entity.last_changed,
            };
          }
          // Resolve on first callback (initial state received)
          if (!resolved) {
            resolved = true;
            resolve();
          }
        });
      });
    }

    return {
      connection,

      getConfig: async () => {
        const result = await connection.sendMessagePromise<HassConfig>({ type: 'get_config' });
        return result;
      },

      getCalendarEvents: async (entityId: string, start: Date, end: Date) => {
        // Use call_service with return_response to get calendar events via WebSocket
        const result = await connection.sendMessagePromise<{
          response: Record<string, { events: HaCalendarEvent[] }>;
        }>({
          type: 'call_service',
          domain: 'calendar',
          service: 'get_events',
          target: { entity_id: entityId },
          service_data: {
            start_date_time: start.toISOString(),
            end_date_time: end.toISOString(),
          },
          return_response: true,
        });

        const calendarResponse = result.response?.[entityId];
        if (!calendarResponse?.events) {
          return [];
        }

        // Validate and normalize each event
        return calendarResponse.events.map((raw) => {
          const parsed = haCalendarEventSchema.parse(raw);
          return normalizeHaEvent(parsed);
        });
      },

      getPersonLocation: () => personState,

      disconnect: async () => {
        if (unsubscribe) unsubscribe();
        connection.close();
      },
    };
  },
};

export type { HomeAssistantClient };
export { homeassistantDefinition };
