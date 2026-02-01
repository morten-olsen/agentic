import { z } from 'zod';

/**
 * LLM configuration for the orchestrator.
 */
const llmConfigSchema = z.object({
  baseUrl: z.string().url().optional().default('https://openrouter.ai/api/v1'),
  apiKey: z.string().min(1),
  model: z.string().optional().default('anthropic/claude-sonnet-4'),
  temperature: z.number().min(0).max(2).optional().default(0.1),
  maxTokens: z.number().positive().optional().default(4096),
});

type LLMConfig = z.input<typeof llmConfigSchema>;

/**
 * Full orchestrator configuration.
 */
const orchestratorConfigSchema = z.object({
  llm: llmConfigSchema,
});

/** Input type for configure() - allows optional fields */
type OrchestratorConfigInput = z.input<typeof orchestratorConfigSchema>;

/** Output type after parsing - all defaults applied */
type OrchestratorConfig = z.infer<typeof orchestratorConfigSchema>;

/**
 * Message role types.
 */
const messageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);

type MessageRole = z.infer<typeof messageRoleSchema>;

/**
 * Simplified message for external representation.
 */
const messageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: messageRoleSchema,
  content: z.string(),
  toolCallId: z.string().nullable().optional(),
  toolCalls: z.string().nullable().optional(), // JSON
  inputTokens: z.number().nullable().optional(),
  outputTokens: z.number().nullable().optional(),
  createdAt: z.string(),
});

type Message = z.infer<typeof messageSchema>;

/**
 * Conversation metadata.
 */
const conversationSchema = z.object({
  id: z.string(),
  title: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  startedAt: z.string(),
  lastActivityAt: z.string(),
  messageCount: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

type Conversation = z.infer<typeof conversationSchema>;

/**
 * Tool call representation.
 */
const toolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
});

type ToolCall = z.infer<typeof toolCallSchema>;

import { interruptSchema } from './interrupts/interrupts.schemas.ts';

/**
 * Chat response chunk for streaming.
 */
const chatChunkSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('token'),
    content: z.string(),
  }),
  z.object({
    type: z.literal('tool_start'),
    toolCallId: z.string(),
    name: z.string(),
    args: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal('tool_end'),
    toolCallId: z.string(),
    result: z.string(),
  }),
  z.object({
    type: z.literal('done'),
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
  }),
  z.object({
    type: z.literal('error'),
    error: z.string(),
  }),
  // Phase 3: Human in the Loop - Interrupt chunks
  z.object({
    type: z.literal('interrupt'),
    interrupt: interruptSchema,
  }),
  z.object({
    type: z.literal('interrupt_resolved'),
    approved: z.boolean(),
    interruptId: z.string(),
  }),
]);

type ChatChunk = z.infer<typeof chatChunkSchema>;

/**
 * Database row for conversations.
 */
const conversationRowSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  summary: z.string().nullable(),
  started_at: z.string(),
  last_activity_at: z.string(),
  message_count: z.number(),
  metadata: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

type ConversationRow = z.infer<typeof conversationRowSchema>;

/**
 * Database row for messages.
 */
const messageRowSchema = z.object({
  id: z.string(),
  conversation_id: z.string(),
  role: z.string(),
  content: z.string(),
  tool_call_id: z.string().nullable(),
  tool_calls: z.string().nullable(),
  input_tokens: z.number().nullable(),
  output_tokens: z.number().nullable(),
  metadata: z.string().nullable(),
  created_at: z.string(),
});

type MessageRow = z.infer<typeof messageRowSchema>;

export type {
  LLMConfig,
  OrchestratorConfigInput,
  OrchestratorConfig,
  MessageRole,
  Message,
  Conversation,
  ToolCall,
  ChatChunk,
  ConversationRow,
  MessageRow,
};

export {
  llmConfigSchema,
  orchestratorConfigSchema,
  messageRoleSchema,
  messageSchema,
  conversationSchema,
  toolCallSchema,
  chatChunkSchema,
  conversationRowSchema,
  messageRowSchema,
};
