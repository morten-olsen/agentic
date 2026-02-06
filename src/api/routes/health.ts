import type { FastifyInstance, FastifyPluginCallback } from 'fastify';

import type { HealthCheckResponse } from '../api.schemas.ts';

// ============================================================================
// Health Routes
// ============================================================================

/**
 * Health check routes for API server status.
 */
const registerHealthRoutes: FastifyPluginCallback = (fastify: FastifyInstance, _opts, done): void => {
  // GET /api/v1/health - Basic health check
  fastify.get('/health', async (): Promise<HealthCheckResponse> => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  });

  done();
};

export { registerHealthRoutes };
