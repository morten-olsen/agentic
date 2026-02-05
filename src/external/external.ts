import type { Services } from '../services/services.ts';
import { destroySymbol } from '../services/services.ts';

import type { ExternalServiceDefinition, ExternalServiceStatus, ServiceClient } from './external.schemas.ts';
import { ServiceNotFoundError, ServiceNotConfiguredError, ServiceConnectionError } from './external.errors.ts';

/**
 * ExternalServiceRegistry - manages external service definitions and clients.
 *
 * Services are registered with their definitions, and clients are lazily
 * instantiated and cached when first requested.
 */
class ExternalServiceRegistry {
  #definitions = new Map<string, ExternalServiceDefinition>();
  #clients = new Map<string, ServiceClient>();

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-useless-constructor, @typescript-eslint/no-unused-vars -- Standard service constructor signature
  constructor(_services: Services) {}

  /**
   * Registers an external service definition.
   */
  register = (definition: ExternalServiceDefinition): void => {
    this.#definitions.set(definition.id, definition);
  };

  /**
   * Unregisters an external service.
   */
  unregister = (serviceId: string): boolean => {
    return this.#definitions.delete(serviceId);
  };

  /**
   * Gets a service definition by ID.
   */
  getDefinition = (serviceId: string): ExternalServiceDefinition | undefined => {
    return this.#definitions.get(serviceId);
  };

  /**
   * Gets all registered service definitions.
   */
  listAll = (): ExternalServiceDefinition[] => {
    return Array.from(this.#definitions.values());
  };

  /**
   * Checks if a service is configured.
   */
  isConfigured = (serviceId: string): boolean => {
    const definition = this.#definitions.get(serviceId);
    if (!definition) {
      return false;
    }
    return definition.isConfigured();
  };

  /**
   * Checks if all specified services are configured.
   */
  areServicesMet = (serviceIds: string[]): boolean => {
    return serviceIds.every((id) => this.isConfigured(id));
  };

  /**
   * Gets the status of a service.
   */
  getStatus = (serviceId: string): ExternalServiceStatus => {
    const definition = this.#definitions.get(serviceId);
    if (!definition) {
      return {
        serviceId,
        serviceName: 'Unknown',
        configured: false,
        connectionStatus: 'unknown',
        errorMessage: `Service not found: ${serviceId}`,
      };
    }

    const configured = definition.isConfigured();
    const client = this.#clients.get(serviceId);

    return {
      serviceId,
      serviceName: definition.name,
      configured,
      connectionStatus: client ? 'connected' : 'unknown',
    };
  };

  /**
   * Gets all service statuses.
   */
  listStatuses = (): ExternalServiceStatus[] => {
    return this.listAll().map((def) => this.getStatus(def.id));
  };

  /**
   * Gets or creates a client for a service.
   * Clients are cached after creation.
   */
  getClient = async <T extends ServiceClient>(serviceId: string): Promise<T> => {
    // Check cache first
    const cached = this.#clients.get(serviceId);
    if (cached) {
      return cached as T;
    }

    const definition = this.#definitions.get(serviceId);
    if (!definition) {
      throw new ServiceNotFoundError(serviceId);
    }

    if (!definition.isConfigured()) {
      throw new ServiceNotConfiguredError(serviceId);
    }

    // Create and cache client
    try {
      const client = await definition.createClient();
      this.#clients.set(serviceId, client);
      return client as T;
    } catch (error) {
      throw new ServiceConnectionError(serviceId, error instanceof Error ? error : undefined);
    }
  };

  /**
   * Checks if a client is currently connected.
   */
  hasClient = (serviceId: string): boolean => {
    return this.#clients.has(serviceId);
  };

  /**
   * Disconnects a specific client.
   */
  disconnectClient = async (serviceId: string): Promise<void> => {
    const client = this.#clients.get(serviceId);
    if (client) {
      await client.disconnect();
      this.#clients.delete(serviceId);
    }
  };

  /**
   * Disconnects all clients.
   * Called during service container shutdown.
   */
  [destroySymbol] = async (): Promise<void> => {
    const disconnectPromises = Array.from(this.#clients.values()).map(async (client) => {
      try {
        await client.disconnect();
      } catch {
        // Ignore disconnect errors during shutdown
      }
    });
    await Promise.all(disconnectPromises);
    this.#clients.clear();
  };
}

// Re-export types and errors
export type { ExternalServiceDefinition, ExternalServiceStatus, ServiceClient } from './external.schemas.ts';
export { externalServiceStatusSchema } from './external.schemas.ts';
export {
  ExternalServiceError,
  ServiceNotFoundError,
  ServiceNotConfiguredError,
  ServiceConnectionError,
} from './external.errors.ts';

export { ExternalServiceRegistry };
