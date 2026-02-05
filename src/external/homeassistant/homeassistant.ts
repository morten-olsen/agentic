import {
  createConnection,
  createLongLivedTokenAuth,
  type Connection,
  type HassConfig,
} from 'home-assistant-js-websocket';

import { getConfig, isHomeAssistantConfigured } from '../../config/config.ts';
import type { ExternalServiceDefinition, ServiceClient } from '../external.schemas.ts';

/**
 * Home Assistant client interface.
 * Extends ServiceClient with the WebSocket connection.
 */
type HomeAssistantClient = ServiceClient & {
  /** The Home Assistant WebSocket connection */
  connection: Connection;
  /** Get Home Assistant configuration */
  getConfig: () => Promise<HassConfig>;
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

    return {
      connection,

      getConfig: async () => {
        const result = await connection.sendMessagePromise<HassConfig>({ type: 'get_config' });
        return result;
      },

      disconnect: async () => {
        connection.close();
      },
    };
  },
};

export type { HomeAssistantClient };
export { homeassistantDefinition };
