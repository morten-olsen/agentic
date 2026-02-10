import { z } from 'zod';
import type { FastifyInstance, FastifyPluginCallback } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { OrchestratorService } from '../../../agent/orchestrator/orchestrator.ts';
import { ApiNotFoundError } from '../api.errors.ts';
import {
  createConversationRequestSchema,
  conversationResponseSchema,
  conversationListResponseSchema,
  messagesListResponseSchema,
  conversationIdParamSchema,
  errorResponseSchema,
  type ConversationResponse,
} from '../api.schemas.ts';

// ============================================================================
// Types
// ============================================================================

type ConversationRouteOptions = {
  orchestrator: OrchestratorService;
};

// ============================================================================
// Additional Schemas
// ============================================================================

const listQuerySchema = z.object({
  limit: z.coerce.number().optional().default(20).describe('Maximum results to return'),
  offset: z.coerce.number().optional().default(0).describe('Number of results to skip'),
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Converts a conversation from the store to the API response format.
 */
const toConversationResponse = (conv: {
  id: string;
  title?: string | null;
  summary?: string | null;
  startedAt: string;
  lastActivityAt: string;
  messageCount: number;
}): ConversationResponse => ({
  id: conv.id,
  title: conv.title ?? null,
  summary: conv.summary ?? null,
  createdAt: conv.startedAt,
  updatedAt: conv.lastActivityAt,
  messageCount: conv.messageCount,
});

// ============================================================================
// Route Registration
// ============================================================================

const registerConversationRoutes: FastifyPluginCallback<ConversationRouteOptions> = (
  fastify: FastifyInstance,
  opts,
  done,
): void => {
  const { orchestrator } = opts;
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // POST /conversations - Create a new conversation
  app.post(
    '/conversations',
    {
      schema: {
        operationId: 'createConversation',
        summary: 'Create a new conversation',
        description: 'Creates a new conversation session for agent interaction',
        tags: ['conversations'],
        body: createConversationRequestSchema,
        response: {
          201: conversationResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { title } = request.body ?? {};

      const conversationId = await orchestrator.startConversation({ title });
      const conversation = await orchestrator.getConversation(conversationId);

      if (!conversation) {
        throw new ApiNotFoundError('Conversation', conversationId);
      }

      reply.status(201).send(toConversationResponse(conversation));
    },
  );

  // GET /conversations - List conversations
  app.get(
    '/conversations',
    {
      schema: {
        operationId: 'listConversations',
        summary: 'List conversations',
        description: 'Returns a paginated list of conversations',
        tags: ['conversations'],
        querystring: listQuerySchema,
        response: {
          200: conversationListResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { limit, offset } = request.query;

      const conversations = await orchestrator.listConversations({ limit, offset });

      reply.send({
        conversations: conversations.map(toConversationResponse),
        total: conversations.length,
      });
    },
  );

  // GET /conversations/:id - Get a conversation
  app.get(
    '/conversations/:id',
    {
      schema: {
        operationId: 'getConversation',
        summary: 'Get conversation',
        description: 'Returns a specific conversation by ID',
        tags: ['conversations'],
        params: conversationIdParamSchema,
        response: {
          200: conversationResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      const conversation = await orchestrator.getConversation(id);
      if (!conversation) {
        throw new ApiNotFoundError('Conversation', id);
      }

      reply.send(toConversationResponse(conversation));
    },
  );

  // DELETE /conversations/:id - Delete a conversation
  app.delete(
    '/conversations/:id',
    {
      schema: {
        operationId: 'deleteConversation',
        summary: 'Delete conversation',
        description: 'Permanently deletes a conversation and all its messages',
        tags: ['conversations'],
        params: conversationIdParamSchema,
        response: {
          204: z.null().describe('Successfully deleted'),
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      const deleted = await orchestrator.deleteConversation(id);
      if (!deleted) {
        throw new ApiNotFoundError('Conversation', id);
      }

      reply.status(204).send(null);
    },
  );

  // GET /conversations/:id/messages - Get message history
  app.get(
    '/conversations/:id/messages',
    {
      schema: {
        operationId: 'getConversationMessages',
        summary: 'Get conversation messages',
        description: 'Returns the full message history for a conversation',
        tags: ['conversations'],
        params: conversationIdParamSchema,
        response: {
          200: messagesListResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      // Verify conversation exists
      const conversation = await orchestrator.getConversation(id);
      if (!conversation) {
        throw new ApiNotFoundError('Conversation', id);
      }

      const messages = await orchestrator.getHistory(id);

      reply.send({
        messages: messages.map((msg) => ({
          id: msg.id,
          role: msg.role as 'user' | 'assistant' | 'tool' | 'system',
          content: msg.content,
          toolCallId: msg.toolCallId ?? null,
          toolCalls: msg.toolCalls ?? null,
          inputTokens: msg.inputTokens ?? null,
          outputTokens: msg.outputTokens ?? null,
          createdAt: msg.createdAt,
        })),
      });
    },
  );

  done();
};

export { registerConversationRoutes };
export type { ConversationRouteOptions };
