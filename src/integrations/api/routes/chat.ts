import { z } from 'zod';
import type { FastifyInstance, FastifyPluginCallback, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { OrchestratorService, ChatChunk } from '../../../agent/orchestrator/orchestrator.ts';
import { ApiNotFoundError } from '../api.errors.ts';
import {
  chatRequestSchema,
  chatResponseSchema,
  conversationIdPathParamSchema,
  errorResponseSchema,
  type ChatResponse,
} from '../api.schemas.ts';

// ============================================================================
// Types
// ============================================================================

type ChatRouteOptions = {
  orchestrator: OrchestratorService;
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Streams chat chunks as Server-Sent Events.
 */
const streamChatResponse = async (reply: FastifyReply, chatGenerator: AsyncGenerator<ChatChunk>): Promise<void> => {
  // Set SSE headers
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  });

  try {
    for await (const chunk of chatGenerator) {
      const eventName = chunk.type;
      const data = JSON.stringify(chunk);
      reply.raw.write(`event: ${eventName}\ndata: ${data}\n\n`);
    }
  } catch (error) {
    const errorChunk = {
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
    reply.raw.write(`event: error\ndata: ${JSON.stringify(errorChunk)}\n\n`);
  } finally {
    reply.raw.end();
  }
};

/**
 * Aggregates chat chunks into a non-streaming response.
 */
const aggregateChatResponse = async (
  conversationId: string,
  chatGenerator: AsyncGenerator<ChatChunk>,
): Promise<ChatResponse> => {
  let response = '';
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let interrupt: ChatResponse['interrupt'] | undefined;

  for await (const chunk of chatGenerator) {
    switch (chunk.type) {
      case 'token':
        response += chunk.content;
        break;
      case 'done':
        inputTokens = chunk.inputTokens;
        outputTokens = chunk.outputTokens;
        break;
      case 'interrupt':
        interrupt = chunk.interrupt;
        break;
      case 'error':
        throw new Error(chunk.error);
    }
  }

  return {
    conversationId,
    response,
    interrupt,
    inputTokens,
    outputTokens,
  };
};

// ============================================================================
// Route Registration
// ============================================================================

const registerChatRoutes: FastifyPluginCallback<ChatRouteOptions> = (fastify: FastifyInstance, opts, done): void => {
  const { orchestrator } = opts;
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // POST /chat/:conversationId - Non-streaming chat
  app.post(
    '/chat/:conversationId',
    {
      schema: {
        operationId: 'chat',
        summary: 'Send a message (non-streaming)',
        description:
          'Sends a message to the agent and waits for the complete response. ' +
          'Use the streaming endpoint for real-time token delivery.',
        tags: ['chat'],
        params: conversationIdPathParamSchema,
        body: chatRequestSchema,
        response: {
          200: chatResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { conversationId } = request.params;
      const { message } = request.body;

      // Verify conversation exists
      const conversation = await orchestrator.getConversation(conversationId);
      if (!conversation) {
        throw new ApiNotFoundError('Conversation', conversationId);
      }

      const chatGenerator = orchestrator.chat(conversationId, message);
      const response = await aggregateChatResponse(conversationId, chatGenerator);
      reply.send(response);
    },
  );

  // POST /chat/:conversationId/stream - Streaming chat (SSE)
  app.post(
    '/chat/:conversationId/stream',
    {
      schema: {
        operationId: 'chatStream',
        summary: 'Send a message (streaming)',
        description:
          'Sends a message to the agent and streams the response as Server-Sent Events. ' +
          'Events include: token (text chunks), tool_start, tool_end, interrupt, done, error.',
        tags: ['chat'],
        params: conversationIdPathParamSchema,
        body: chatRequestSchema,
        response: {
          200: z.string().describe('Server-Sent Events stream'),
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { conversationId } = request.params;
      const { message } = request.body;

      // Verify conversation exists
      const conversation = await orchestrator.getConversation(conversationId);
      if (!conversation) {
        throw new ApiNotFoundError('Conversation', conversationId);
      }

      const chatGenerator = orchestrator.chat(conversationId, message);
      await streamChatResponse(reply, chatGenerator);
    },
  );

  done();
};

export { registerChatRoutes };
export type { ChatRouteOptions };
