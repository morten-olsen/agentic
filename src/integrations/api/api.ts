import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { Services } from '../../core/services/services.ts';
import type { Config } from '../../core/config/config.ts';
import { isOuraConfigured } from '../../core/config/config.ts';
import { HealthService } from '../../integrations/health/health.ts';
import { ExternalServiceRegistry } from '../../integrations/external/external.ts';
import { OuraWebhookManager } from '../../integrations/external/oura/oura.webhooks.ts';
import type { OuraClient } from '../../integrations/external/oura/oura.ts';

import { registerHealthRoutes } from './routes/health.ts';
import { registerOuraWebhookRoutes } from './routes/webhooks/oura.ts';

// ============================================================================
// Types
// ============================================================================

type ApiServerDependencies = {
  services: Services;
  config: Config;
};

type ApiServerInfo = {
  host: string;
  port: number;
};

// ============================================================================
// Error Handler
// ============================================================================

const errorHandler = (
  error: Error & { statusCode?: number; validation?: unknown },
  _request: FastifyRequest,
  reply: FastifyReply,
): void => {
  const statusCode = error.statusCode ?? 500;

  // Log errors
  if (statusCode >= 500) {
    console.error('API Error:', error);
  }

  reply.status(statusCode).send({
    error: error.name || 'Error',
    message: error.message,
    statusCode,
  });
};

// ============================================================================
// API Server Factory
// ============================================================================

/**
 * Creates and configures the Fastify API server.
 */
const createApiServer = async (deps: ApiServerDependencies): Promise<FastifyInstance> => {
  const { services, config } = deps;

  const fastify = Fastify({
    logger: false, // We use our own logging
    trustProxy: config.api.trustProxy,
  });

  // Register error handler
  fastify.setErrorHandler(errorHandler);

  // Register health check routes (always available)
  await fastify.register(registerHealthRoutes, { prefix: '/api/v1' });

  // Register Oura webhook routes (only if configured)
  if (isOuraConfigured()) {
    const healthService = services.get(HealthService);
    await fastify.register(registerOuraWebhookRoutes, {
      prefix: '/api/v1/webhooks',
      healthService,
      webhookSecret: config.oura.webhookSecret,
    });
    console.log('  Oura webhook routes registered');
  }

  return fastify;
};

/**
 * Sets up Oura webhook subscriptions if configured.
 * Called after the API server is listening.
 */
const setupOuraWebhooks = async (deps: ApiServerDependencies): Promise<void> => {
  const { services, config } = deps;

  if (!isOuraConfigured()) {
    return;
  }

  try {
    const externalRegistry = services.get(ExternalServiceRegistry);
    const healthService = services.get(HealthService);

    // Get Oura client
    const client = await externalRegistry.getClient<OuraClient>('oura');

    // Create webhook manager
    const webhookManager = new OuraWebhookManager({
      client,
      healthService,
      apiPublicUrl: config.api.publicUrl,
    });

    // Ensure subscriptions are set up
    console.log('  Checking Oura webhook subscriptions...');
    const result = await webhookManager.ensureSubscriptions();

    if (result.created > 0) {
      console.log(`  Created ${result.created} new Oura webhook subscription(s)`);
    }
    if (result.skipped > 0) {
      console.log(`  ${result.skipped} Oura subscription(s) already active`);
    }
    if (result.failed > 0) {
      console.warn(`  ${result.failed} Oura subscription(s) failed to create`);
      for (const error of result.errors) {
        console.warn(`    - ${error}`);
      }
    }
  } catch (error) {
    console.error('  Failed to set up Oura webhooks:', error instanceof Error ? error.message : String(error));
  }
};

/**
 * Starts the API server listening on the configured host and port.
 */
const startApiServer = async (fastify: FastifyInstance, config: Config): Promise<ApiServerInfo> => {
  await fastify.listen({
    host: config.api.host,
    port: config.api.port,
  });

  return {
    host: config.api.host,
    port: config.api.port,
  };
};

// ============================================================================
// Exports
// ============================================================================

export type { ApiServerDependencies, ApiServerInfo };
export { createApiServer, startApiServer, setupOuraWebhooks };
