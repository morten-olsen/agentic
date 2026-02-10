import { z } from 'zod';

import { riskProfileSchema, riskCategorySchema } from '../../agent/tools/tools.schemas.ts';
import {
  interruptSchema,
  interruptResponseSchema,
  toolCallInfoSchema,
  skillActivationInfoSchema,
} from '../../agent/orchestrator/interrupts/interrupts.schemas.ts';

// ============================================================================
// Health Check Response
// ============================================================================

const healthCheckResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  timestamp: z.string().datetime(),
  version: z.string().optional(),
});

type HealthCheckResponse = z.infer<typeof healthCheckResponseSchema>;

// ============================================================================
// Webhook Response
// ============================================================================

const webhookResponseSchema = z.object({
  received: z.boolean(),
  id: z.string().optional(),
});

type WebhookResponse = z.infer<typeof webhookResponseSchema>;

// ============================================================================
// Error Response
// ============================================================================

const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  statusCode: z.number(),
  details: z.array(z.string()).optional(),
});

type ErrorResponse = z.infer<typeof errorResponseSchema>;

// ============================================================================
// Conversation Schemas
// ============================================================================

const createConversationRequestSchema = z.object({
  title: z.string().optional().describe('Optional title for the conversation'),
});

type CreateConversationRequest = z.infer<typeof createConversationRequestSchema>;

const conversationResponseSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  summary: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  messageCount: z.number().optional(),
});

type ConversationResponse = z.infer<typeof conversationResponseSchema>;

const conversationListResponseSchema = z.object({
  conversations: z.array(conversationResponseSchema),
  total: z.number().optional(),
});

type ConversationListResponse = z.infer<typeof conversationListResponseSchema>;

// ============================================================================
// Message Schemas
// ============================================================================

const messageResponseSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'tool', 'system']),
  content: z.string(),
  toolCallId: z.string().nullable().optional(),
  toolCalls: z.string().nullable().optional(),
  inputTokens: z.number().nullable().optional(),
  outputTokens: z.number().nullable().optional(),
  createdAt: z.string().datetime(),
});

type MessageResponse = z.infer<typeof messageResponseSchema>;

const messagesListResponseSchema = z.object({
  messages: z.array(messageResponseSchema),
});

type MessagesListResponse = z.infer<typeof messagesListResponseSchema>;

// ============================================================================
// Chat Schemas
// ============================================================================

const chatRequestSchema = z.object({
  message: z.string().min(1).describe('The message to send to the agent'),
});

type ChatRequest = z.infer<typeof chatRequestSchema>;

const chatResponseSchema = z.object({
  conversationId: z.string(),
  response: z.string(),
  interrupt: interruptSchema.optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
});

type ChatResponse = z.infer<typeof chatResponseSchema>;

// SSE event schemas - re-export for documentation
const sseTokenEventSchema = z.object({
  type: z.literal('token'),
  content: z.string(),
});

const sseInterruptEventSchema = z.object({
  type: z.literal('interrupt'),
  interrupt: interruptSchema,
});

const sseInterruptResolvedEventSchema = z.object({
  type: z.literal('interrupt_resolved'),
  approved: z.boolean(),
  interruptId: z.string(),
});

const sseDoneEventSchema = z.object({
  type: z.literal('done'),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
});

const sseErrorEventSchema = z.object({
  type: z.literal('error'),
  error: z.string(),
});

// ============================================================================
// Tool Schemas
// ============================================================================

const toolExampleSchema = z.object({
  input: z.record(z.string(), z.unknown()),
  description: z.string(),
});

type ToolExample = z.infer<typeof toolExampleSchema>;

const toolInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  tags: z.array(z.string()),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()),
  risk: riskProfileSchema,
  examples: z.array(toolExampleSchema),
  requiredServices: z.array(z.string()).optional(),
});

type ToolInfo = z.infer<typeof toolInfoSchema>;

const toolListResponseSchema = z.object({
  tools: z.array(toolInfoSchema),
  total: z.number(),
});

type ToolListResponse = z.infer<typeof toolListResponseSchema>;

const toolExecuteRequestSchema = z.object({
  input: z.record(z.string(), z.unknown()).describe('Tool input parameters'),
  conversationId: z.string().optional().describe('Optional conversation context'),
});

type ToolExecuteRequest = z.infer<typeof toolExecuteRequestSchema>;

const toolExecuteResponseSchema = z.object({
  toolId: z.string(),
  output: z.unknown(),
  durationMs: z.number(),
});

type ToolExecuteResponse = z.infer<typeof toolExecuteResponseSchema>;

// ============================================================================
// Interrupt Schemas
// ============================================================================

// Re-export the interrupt response schema for API use
const interruptResponseRequestSchema = interruptResponseSchema;

type InterruptResponseRequest = z.infer<typeof interruptResponseRequestSchema>;

const interruptGetResponseSchema = interruptSchema;

type InterruptGetResponse = z.infer<typeof interruptGetResponseSchema>;

// ============================================================================
// Path Parameters
// ============================================================================

const conversationIdParamSchema = z.object({
  id: z.string().describe('Conversation ID'),
});

type ConversationIdParam = z.infer<typeof conversationIdParamSchema>;

const conversationIdPathParamSchema = z.object({
  conversationId: z.string().describe('Conversation ID'),
});

type ConversationIdPathParam = z.infer<typeof conversationIdPathParamSchema>;

const toolIdParamSchema = z.object({
  toolId: z.string().describe('Tool ID'),
});

type ToolIdParam = z.infer<typeof toolIdParamSchema>;

const interruptIdParamSchema = z.object({
  interruptId: z.string().describe('Interrupt ID'),
});

type InterruptIdParam = z.infer<typeof interruptIdParamSchema>;

// ============================================================================
// Query Parameters
// ============================================================================

const toolListQuerySchema = z.object({
  category: z.string().optional().describe('Filter by category'),
  tag: z.string().optional().describe('Filter by tag'),
});

type ToolListQuery = z.infer<typeof toolListQuerySchema>;

// ============================================================================
// Exports
// ============================================================================

export type {
  HealthCheckResponse,
  WebhookResponse,
  ErrorResponse,
  CreateConversationRequest,
  ConversationResponse,
  ConversationListResponse,
  MessageResponse,
  MessagesListResponse,
  ChatRequest,
  ChatResponse,
  ToolExample,
  ToolInfo,
  ToolListResponse,
  ToolExecuteRequest,
  ToolExecuteResponse,
  InterruptResponseRequest,
  InterruptGetResponse,
  ConversationIdParam,
  ConversationIdPathParam,
  ToolIdParam,
  InterruptIdParam,
  ToolListQuery,
};

export {
  healthCheckResponseSchema,
  webhookResponseSchema,
  errorResponseSchema,
  createConversationRequestSchema,
  conversationResponseSchema,
  conversationListResponseSchema,
  messageResponseSchema,
  messagesListResponseSchema,
  chatRequestSchema,
  chatResponseSchema,
  sseTokenEventSchema,
  sseInterruptEventSchema,
  sseInterruptResolvedEventSchema,
  sseDoneEventSchema,
  sseErrorEventSchema,
  toolExampleSchema,
  toolInfoSchema,
  toolListResponseSchema,
  toolExecuteRequestSchema,
  toolExecuteResponseSchema,
  interruptResponseRequestSchema,
  interruptGetResponseSchema,
  conversationIdParamSchema,
  conversationIdPathParamSchema,
  toolIdParamSchema,
  interruptIdParamSchema,
  toolListQuerySchema,
};

// Re-export useful schemas from other modules for convenience
export {
  interruptSchema,
  interruptResponseSchema,
  toolCallInfoSchema,
  skillActivationInfoSchema,
  riskProfileSchema,
  riskCategorySchema,
};
