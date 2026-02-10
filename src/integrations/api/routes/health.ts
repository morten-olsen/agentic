import type { FastifyInstance, FastifyPluginCallback } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { healthCheckResponseSchema } from '../api.schemas.ts';

// ============================================================================
// Health Routes
// ============================================================================

/**
 * Health check routes for API server status.
 */
const registerHealthRoutes: FastifyPluginCallback = (fastify: FastifyInstance, _opts, done): void => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // GET /api/v1/health - Basic health check
  app.get(
    '/health',
    {
      schema: {
        operationId: 'getHealth',
        summary: 'Health check',
        description: 'Returns the current health status of the API server',
        tags: ['health'],
        response: {
          200: healthCheckResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      reply.send({
        status: 'ok',
        timestamp: new Date().toISOString(),
      });
    },
  );

  done();
};

export { registerHealthRoutes };
