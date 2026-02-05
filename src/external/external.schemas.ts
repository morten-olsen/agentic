import { z } from 'zod';

/**
 * Service client interface.
 * Each service defines its own client with service-specific methods.
 */
type ServiceClient = {
  /** Disconnect and clean up the client */
  disconnect: () => Promise<void>;
};

/**
 * External service definition.
 * Defines how to check configuration and create clients for an external service.
 */
type ExternalServiceDefinition = {
  /** Unique identifier for the service (e.g., 'homeassistant') */
  id: string;
  /** Human-readable name (e.g., 'Home Assistant') */
  name: string;
  /** Description of what the service provides */
  description: string;

  /** Check if the service is configured (env vars set) */
  isConfigured: () => boolean;

  /** Create a client instance for the service */
  createClient: () => Promise<ServiceClient>;
};

/**
 * Service status for querying service state.
 */
const externalServiceStatusSchema = z.object({
  serviceId: z.string(),
  serviceName: z.string(),
  configured: z.boolean(),
  connectionStatus: z.enum(['unknown', 'connected', 'error']),
  errorMessage: z.string().optional(),
});

type ExternalServiceStatus = z.infer<typeof externalServiceStatusSchema>;

export type { ServiceClient, ExternalServiceDefinition, ExternalServiceStatus };

export { externalServiceStatusSchema };
