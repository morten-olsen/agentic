import { z } from 'zod';
import type { FastifyInstance, FastifyPluginCallback } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { OrchestratorService } from '../../../agent/orchestrator/orchestrator.ts';
import type { Services } from '../../../core/services/services.ts';
import type { ToolContext } from '../../../agent/tools/tools.schemas.ts';
import type { RegisteredTool } from '../../../agent/tools/tools.types.ts';
import {
  toolInfoSchema,
  toolListResponseSchema,
  toolListQuerySchema,
  toolIdParamSchema,
  errorResponseSchema,
} from '../api.schemas.ts';
import {
  toolToApiInfo,
  isToolExposedViaApi,
  filterByCategory,
  filterByTag,
  filterExposedTools,
} from '../tool-adapter.ts';

// ============================================================================
// Types
// ============================================================================

type ToolRouteOptions = {
  orchestrator: OrchestratorService;
  services: Services;
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Converts a tool ID to a URL-safe path segment.
 * Replaces dots with slashes for nested paths (e.g., "builtin.echo" -> "builtin/echo").
 */
const toolIdToPath = (toolId: string): string => {
  return toolId.replace(/\./g, '/');
};

/**
 * Converts a tool ID to a valid OpenAPI operationId.
 * Converts to camelCase (e.g., "builtin.echo" -> "executeBuiltinEcho").
 */
const toolIdToOperationId = (toolId: string): string => {
  const parts = toolId.split('.');
  const camelCase = parts
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
  return `execute${camelCase.charAt(0).toUpperCase() + camelCase.slice(1)}`;
};

/**
 * API error for tool not found.
 */
class ApiNotFoundError extends Error {
  statusCode = 404;
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

/**
 * API error for forbidden access.
 */
class ApiForbiddenError extends Error {
  statusCode = 403;
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

// ============================================================================
// Route Registration
// ============================================================================

const registerToolRoutes: FastifyPluginCallback<ToolRouteOptions> = (fastify: FastifyInstance, opts, done): void => {
  const { orchestrator, services } = opts;
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const toolRegistry = orchestrator.toolRegistry;

  // GET /tools - List all exposed tools
  app.get(
    '/tools',
    {
      schema: {
        operationId: 'listTools',
        summary: 'List available tools',
        description:
          'Returns a list of tools available for execution via the API. ' +
          'Only low and medium risk tools are exposed.',
        tags: ['tools'],
        querystring: toolListQuerySchema,
        response: {
          200: toolListResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { category, tag } = request.query;

      let tools = toolRegistry.getAll();

      // Filter to only exposed tools
      tools = filterExposedTools(tools);

      // Apply optional filters
      if (category) {
        tools = filterByCategory(tools, category);
      }
      if (tag) {
        tools = filterByTag(tools, tag);
      }

      reply.send({
        tools: tools.map(toolToApiInfo),
        total: tools.length,
      });
    },
  );

  // GET /tools/:toolId - Get tool details
  app.get(
    '/tools/:toolId',
    {
      schema: {
        operationId: 'getTool',
        summary: 'Get tool details',
        description: 'Returns detailed information about a specific tool, including its input/output schemas.',
        tags: ['tools'],
        params: toolIdParamSchema,
        response: {
          200: toolInfoSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { toolId } = request.params;

      const tool = toolRegistry.get(toolId);
      if (!tool) {
        throw new ApiNotFoundError('Tool', toolId);
      }

      if (!isToolExposedViaApi(tool)) {
        throw new ApiForbiddenError(`Tool ${toolId} is not available via API due to risk level`);
      }

      reply.send(toolToApiInfo(tool));
    },
  );

  // Register individual POST endpoints for each tool
  const exposedTools = filterExposedTools(toolRegistry.getAll());

  for (const tool of exposedTools) {
    registerToolExecuteEndpoint(app, tool, services);
  }

  done();
};

/**
 * Registers a POST endpoint for executing a specific tool.
 */
const registerToolExecuteEndpoint = (
  app: FastifyInstance & { withTypeProvider: () => ReturnType<FastifyInstance['withTypeProvider']> },
  tool: RegisteredTool,
  services: Services,
): void => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  const path = `/tools/${toolIdToPath(tool.id)}`;

  // Create response schema that wraps tool output
  const executeResponseSchema = z.object({
    toolId: z.literal(tool.id),
    output: tool.outputSchema,
    durationMs: z.number().describe('Execution time in milliseconds'),
  });

  // POST /tools/{category}/{name} - Execute tool
  typedApp.post(
    path,
    {
      schema: {
        operationId: toolIdToOperationId(tool.id),
        summary: `Execute ${tool.name}`,
        description: tool.description,
        tags: ['tools'],
        body: tool.inputSchema,
        response: {
          200: executeResponseSchema,
          400: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const input = request.body;

      // Create tool context
      const context: ToolContext = {
        userId: 'api',
        conversationId: `api-${Date.now()}`,
        services,
      };

      // Execute the tool
      const startTime = Date.now();
      const output = await tool.execute(input, context);
      const durationMs = Date.now() - startTime;

      reply.send({
        toolId: tool.id,
        output,
        durationMs,
      });
    },
  );
};

export { registerToolRoutes };
export type { ToolRouteOptions };
