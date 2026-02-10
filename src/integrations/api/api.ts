import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifySwagger from '@fastify/swagger';
import scalarFastify from '@scalar/fastify-api-reference';
import { serializerCompiler, validatorCompiler, jsonSchemaTransform } from 'fastify-type-provider-zod';

import type { Services } from '../../core/services/services.ts';
import type { Config } from '../../core/config/config.ts';
import { isOuraConfigured } from '../../core/config/config.ts';
import { HealthService } from '../../integrations/health/health.ts';
import { ExternalServiceRegistry } from '../../integrations/external/external.ts';
import { OuraWebhookManager } from '../../integrations/external/oura/oura.webhooks.ts';
import type { OuraClient } from '../../integrations/external/oura/oura.ts';
import { OrchestratorService } from '../../agent/orchestrator/orchestrator.ts';

import { registerHealthRoutes } from './routes/health.ts';
import { registerOuraWebhookRoutes } from './routes/webhooks/oura.ts';
import { registerConversationRoutes } from './routes/conversations.ts';
import { registerChatRoutes } from './routes/chat.ts';
import { registerInterruptRoutes } from './routes/interrupts.ts';
import { registerToolRoutes } from './routes/tools.ts';

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
  error: Error & { statusCode?: number; validation?: unknown; details?: string[] },
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
    details: error.details,
  });
};

// ============================================================================
// CORS Configuration
// ============================================================================

/**
 * Parses CORS origins from config string.
 * Supports '*' for all origins, or comma-separated list.
 */
const parseCorsOrigins = (originsConfig: string): string | string[] | boolean => {
  if (originsConfig === '*') {
    return true; // Allow all origins
  }
  const origins = originsConfig
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return origins.length > 0 ? origins : false;
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

  // Set up Zod type provider for validation and serialization
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  // Register error handler
  fastify.setErrorHandler(errorHandler);

  // Register CORS
  await fastify.register(fastifyCors, {
    origin: parseCorsOrigins(config.api.corsOrigins),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });

  // Register Swagger for OpenAPI spec generation
  await fastify.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'GLaDOS API',
        description: 'AI Personal Assistant API - Agent invocation and tool execution',
        version: '1.0.0',
      },
      servers: [
        {
          url: config.api.publicUrl || `http://localhost:${config.api.port}`,
          description: config.api.publicUrl ? 'Production' : 'Development',
        },
      ],
      tags: [
        { name: 'health', description: 'Health check endpoints' },
        { name: 'conversations', description: 'Conversation management' },
        { name: 'chat', description: 'Agent interaction' },
        { name: 'tools', description: 'Tool discovery and execution' },
        { name: 'interrupts', description: 'Interrupt handling for human-in-the-loop' },
        { name: 'webhooks', description: 'External service webhooks' },
      ],
    },
    transform: jsonSchemaTransform,
  });

  // Register Scalar API documentation UI (if enabled)
  // Scalar reads from @fastify/swagger automatically
  if (config.api.docsEnabled) {
    await fastify.register(scalarFastify, {
      routePrefix: '/docs',
      configuration: {
        theme: 'purple',
        pageTitle: 'GLaDOS API Documentation',
      },
    });
  }

  // OpenAPI spec endpoint
  fastify.get('/api/v1/openapi.json', async () => {
    return fastify.swagger();
  });

  // Register health check routes (always available)
  await fastify.register(registerHealthRoutes, { prefix: '/api/v1' });

  // Get OrchestratorService for route handlers
  const orchestrator = services.get(OrchestratorService);

  // Register conversation routes
  await fastify.register(registerConversationRoutes, {
    prefix: '/api/v1',
    orchestrator,
  });

  // Register chat routes
  await fastify.register(registerChatRoutes, {
    prefix: '/api/v1',
    orchestrator,
  });

  // Register interrupt routes
  await fastify.register(registerInterruptRoutes, {
    prefix: '/api/v1',
    orchestrator,
  });

  // Register tool routes (if enabled)
  if (config.api.toolsEnabled) {
    await fastify.register(registerToolRoutes, {
      prefix: '/api/v1',
      orchestrator,
      services,
    });
    console.log('  Tool execution routes registered');
  }

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
