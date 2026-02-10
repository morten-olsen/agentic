import { z } from 'zod';
import type { FastifyInstance, FastifyPluginCallback } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { OrchestratorService } from '../../../agent/orchestrator/orchestrator.ts';
import { ApiNotFoundError } from '../api.errors.ts';
import {
  interruptResponseRequestSchema,
  interruptGetResponseSchema,
  conversationIdPathParamSchema,
  interruptIdParamSchema,
  chatResponseSchema,
  errorResponseSchema,
  type InterruptGetResponse,
} from '../api.schemas.ts';

// ============================================================================
// Types
// ============================================================================

type InterruptRouteOptions = {
  orchestrator: OrchestratorService;
};

// ============================================================================
// Route Registration
// ============================================================================

const registerInterruptRoutes: FastifyPluginCallback<InterruptRouteOptions> = (
  fastify: FastifyInstance,
  opts,
  done,
): void => {
  const { orchestrator } = opts;
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const interruptService = orchestrator.interruptService;

  // GET /interrupts/:conversationId - Get pending interrupt for a conversation
  app.get(
    '/interrupts/:conversationId',
    {
      schema: {
        operationId: 'getPendingInterrupt',
        summary: 'Get pending interrupt',
        description:
          'Returns any pending interrupt for a conversation. ' + 'Returns 204 No Content if no interrupt is pending.',
        tags: ['interrupts'],
        params: conversationIdPathParamSchema,
        response: {
          200: interruptGetResponseSchema,
          204: z.null().describe('No pending interrupt'),
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { conversationId } = request.params;

      // Verify conversation exists
      const conversation = await orchestrator.getConversation(conversationId);
      if (!conversation) {
        throw new ApiNotFoundError('Conversation', conversationId);
      }

      const interrupt = await interruptService.getPending(conversationId);

      if (!interrupt) {
        reply.status(204).send(null);
        return;
      }

      reply.send(interrupt);
    },
  );

  // POST /interrupts/:interruptId - Respond to an interrupt
  app.post(
    '/interrupts/:interruptId',
    {
      schema: {
        operationId: 'respondToInterrupt',
        summary: 'Respond to an interrupt',
        description:
          'Provides a response to a pending interrupt, allowing the agent to continue. ' +
          'The response type depends on the interrupt type (approve/deny for tool_approval, ' +
          'message for clarification, continue/stop for turn_limit).',
        tags: ['interrupts'],
        params: interruptIdParamSchema,
        body: interruptResponseRequestSchema,
        response: {
          200: chatResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { interruptId } = request.params;
      const response = request.body;

      // Get the interrupt to find its conversation
      const interrupt = await interruptService.get(interruptId);
      if (!interrupt) {
        throw new ApiNotFoundError('Interrupt', interruptId);
      }

      if (interrupt.status !== 'pending') {
        throw new ApiNotFoundError('Pending interrupt', interruptId);
      }

      // Respond to the interrupt and collect the response
      const chatGenerator = orchestrator.respondToInterrupt(interruptId, response);

      let responseContent = '';
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      let nestedInterrupt: InterruptGetResponse | undefined;

      for await (const chunk of chatGenerator) {
        switch (chunk.type) {
          case 'token':
            responseContent += chunk.content;
            break;
          case 'done':
            inputTokens = chunk.inputTokens;
            outputTokens = chunk.outputTokens;
            break;
          case 'interrupt':
            nestedInterrupt = chunk.interrupt;
            break;
          case 'error':
            throw new Error(chunk.error);
        }
      }

      reply.send({
        conversationId: interrupt.conversationId,
        response: responseContent,
        interrupt: nestedInterrupt,
        inputTokens,
        outputTokens,
      });
    },
  );

  done();
};

export { registerInterruptRoutes };
export type { InterruptRouteOptions };
