import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';

import type { Services } from '../services/services.ts';
import { DatabaseService } from '../database/database.ts';
import { PersonalityService } from '../personality/personality.ts';
import { ContextBuilderService } from '../context/context.ts';
import { ToolRegistry } from '../tools/tools.ts';
import { toLangChainTools } from '../tools/adapters/adapters.langchain.ts';
import { registerBuiltinTools } from '../tools/builtin/builtin.ts';
import { MemoryService } from '../memory/memory.ts';

import type { OrchestratorConfig, Conversation, Message, ChatChunk } from './orchestrator.schemas.ts';
import { orchestratorConfigSchema } from './orchestrator.schemas.ts';
import { DatabaseCheckpointer } from './orchestrator.checkpointer.ts';
import { createOrchestratorGraph } from './orchestrator.graph.ts';
import {
  createConversation,
  getConversation,
  listConversations,
  deleteConversation,
  addMessage,
  getMessages,
} from './orchestrator.store.ts';
import { ConversationNotFoundError, OrchestratorNotConfiguredError } from './orchestrator.errors.ts';
import { InterruptService } from './interrupts/interrupts.ts';
import type { Interrupt, InterruptResponse } from './interrupts/interrupts.ts';
import { formatToolCallInfo, formatApprovalPrompt } from './orchestrator.risk-gate.ts';

/**
 * Orchestrator Service - coordinates the agent's interactions.
 */
class OrchestratorService {
  #services: Services;
  #config: OrchestratorConfig | null = null;
  #llm: ChatOpenAI | null = null;
  #checkpointer: DatabaseCheckpointer | null = null;
  #toolRegistry: ToolRegistry | null = null;
  #interruptService: InterruptService;
  #memoryService: MemoryService | null = null;

  constructor(services: Services) {
    this.#services = services;
    this.#interruptService = new InterruptService(services);
  }

  /**
   * Gets the knex instance from the database service.
   */
  #db = () => {
    return this.#services.get(DatabaseService).knex;
  };

  /**
   * Gets the interrupt service.
   */
  get interruptService(): InterruptService {
    return this.#interruptService;
  }

  /**
   * Configures the orchestrator with LLM settings.
   */
  configure = (config: Partial<OrchestratorConfig> & { llm: { apiKey: string } }): void => {
    this.#config = orchestratorConfigSchema.parse(config);

    this.#llm = new ChatOpenAI({
      model: this.#config.llm.model,
      temperature: this.#config.llm.temperature,
      maxTokens: this.#config.llm.maxTokens,
      configuration: { baseURL: this.#config.llm.baseUrl },
      apiKey: this.#config.llm.apiKey,
    });

    this.#checkpointer = new DatabaseCheckpointer(this.#db());

    // Initialize tool registry with builtin tools
    this.#toolRegistry = new ToolRegistry(this.#services);
    registerBuiltinTools(this.#toolRegistry);

    // Initialize memory service and configure with LLM credentials
    this.#memoryService = this.#services.get(MemoryService);
    this.#memoryService.configure({
      baseUrl: this.#config.llm.baseUrl,
      apiKey: this.#config.llm.apiKey,
    });
  };

  /**
   * Checks if the orchestrator is configured.
   */
  get isConfigured(): boolean {
    return this.#config !== null && this.#llm !== null;
  }

  /**
   * Gets the tool registry.
   */
  get toolRegistry(): ToolRegistry {
    if (!this.#toolRegistry) {
      throw new OrchestratorNotConfiguredError();
    }
    return this.#toolRegistry;
  }

  /**
   * Ensures the orchestrator is configured.
   */
  #ensureConfigured = (): void => {
    if (!this.#config || !this.#llm || !this.#checkpointer || !this.#toolRegistry) {
      throw new OrchestratorNotConfiguredError();
    }
  };

  /**
   * Starts a new conversation.
   */
  startConversation = async (options?: { title?: string }): Promise<string> => {
    const conversation = await createConversation(this.#db(), options);
    return conversation.id;
  };

  /**
   * Gets a conversation by ID.
   */
  getConversation = async (conversationId: string): Promise<Conversation | null> => {
    return getConversation(this.#db(), conversationId);
  };

  /**
   * Lists recent conversations.
   */
  listConversations = async (options?: { limit?: number; offset?: number }): Promise<Conversation[]> => {
    return listConversations(this.#db(), options);
  };

  /**
   * Deletes a conversation and all its data.
   */
  deleteConversation = async (conversationId: string): Promise<boolean> => {
    // Delete checkpoints
    if (this.#checkpointer) {
      await this.#checkpointer.deleteThread(conversationId);
    }
    // Delete conversation (cascades to messages)
    return deleteConversation(this.#db(), conversationId);
  };

  /**
   * Gets the message history for a conversation.
   */
  getHistory = async (conversationId: string): Promise<Message[]> => {
    return getMessages(this.#db(), conversationId);
  };

  /**
   * Sends a message and gets a response.
   * Returns an async generator that yields response chunks.
   */
  chat = async function* (
    this: OrchestratorService,
    conversationId: string,
    message: string,
  ): AsyncGenerator<ChatChunk> {
    this.#ensureConfigured();

    // Verify conversation exists
    const conversation = await getConversation(this.#db(), conversationId);
    if (!conversation) {
      throw new ConversationNotFoundError(conversationId);
    }

    // Check for pending interrupt first
    const pendingInterrupt = await this.#interruptService.getPending(conversationId);
    if (pendingInterrupt) {
      // This is a response to the pending interrupt
      yield* this.#handleInterruptResponse(pendingInterrupt, message);
      return;
    }

    // Store user message
    await addMessage(this.#db(), conversationId, {
      role: 'user',
      content: message,
    });

    try {
      // Build system prompt with context
      const personality = this.#services.get(PersonalityService);
      const contextBuilder = this.#services.get(ContextBuilderService);
      const context = await contextBuilder.buildContext();
      const systemPrompt = await personality.buildSystemPrompt(context);

      // Get tools as LangChain tools
      const toolContext = {
        userId: 'default', // TODO: get from user model
        conversationId,
        services: this.#services,
      };
      // These are guaranteed non-null by #ensureConfigured() above
      const tools = toLangChainTools(this.#toolRegistry as ToolRegistry, toolContext);

      // Create and compile graph with tool registry for risk gate and memory service
      const graph = createOrchestratorGraph(
        this.#llm as ChatOpenAI,
        systemPrompt,
        tools,
        this.#toolRegistry as ToolRegistry,
        undefined, // approvalLevels - use defaults
        this.#memoryService ?? undefined,
      );
      const compiledGraph = graph.compile({
        checkpointer: this.#checkpointer as DatabaseCheckpointer,
      });

      // Load existing messages from history for this conversation
      const history = await getMessages(this.#db(), conversationId);
      const historyMessages: BaseMessage[] = [];

      for (const msg of history) {
        if (msg.role === 'user') {
          historyMessages.push(new HumanMessage(msg.content));
        } else if (msg.role === 'assistant') {
          const aiMsg = new AIMessage(msg.content);
          if (msg.toolCalls) {
            (aiMsg as AIMessage).tool_calls = JSON.parse(msg.toolCalls);
          }
          historyMessages.push(aiMsg);
        } else if (msg.role === 'tool') {
          historyMessages.push(
            new ToolMessage({
              content: msg.content,
              tool_call_id: msg.toolCallId ?? '',
            }),
          );
        }
      }

      // Invoke the graph
      const result = await compiledGraph.invoke(
        {
          conversationId,
          messages: historyMessages,
        },
        {
          configurable: { thread_id: conversationId },
        },
      );

      // Check if graph halted for an interrupt
      if (result.interruptRequired && result.pendingToolCall) {
        // Create the interrupt in the database
        const interrupt = await this.#interruptService.create({
          conversationId,
          type: 'tool_approval',
          prompt: formatApprovalPrompt(result.pendingToolCall),
          toolCall: formatToolCallInfo(result.pendingToolCall),
          checkpointId: conversationId, // Use conversation ID as checkpoint reference
        });

        yield { type: 'interrupt', interrupt };
        return;
      }

      // Extract the response from the last message
      const lastMessage = result.messages[result.messages.length - 1];
      let responseContent = '';
      let toolCalls: string | undefined;

      if (lastMessage && 'content' in lastMessage) {
        responseContent =
          typeof lastMessage.content === 'string' ? lastMessage.content : JSON.stringify(lastMessage.content);
      }

      if (lastMessage && 'tool_calls' in lastMessage) {
        const aiMessage = lastMessage as AIMessage;
        if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
          toolCalls = JSON.stringify(aiMessage.tool_calls);
        }
      }

      // Yield tokens (for now, yield the whole response at once)
      if (responseContent) {
        yield { type: 'token', content: responseContent };
      }

      // Store assistant message
      const tokenUsage =
        lastMessage && 'usage_metadata' in lastMessage ? (lastMessage as AIMessage).usage_metadata : undefined;

      await addMessage(this.#db(), conversationId, {
        role: 'assistant',
        content: responseContent,
        toolCalls,
        inputTokens: tokenUsage?.input_tokens,
        outputTokens: tokenUsage?.output_tokens,
      });

      yield {
        type: 'done',
        inputTokens: tokenUsage?.input_tokens,
        outputTokens: tokenUsage?.output_tokens,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      yield { type: 'error', error: errorMessage };
    }
  };

  /**
   * Handles a user response to a pending interrupt.
   */
  #handleInterruptResponse = async function* (
    this: OrchestratorService,
    interrupt: Interrupt,
    message: string,
  ): AsyncGenerator<ChatChunk> {
    // Parse the response
    const response = this.#parseInterruptResponse(interrupt, message);

    // Record the response
    const resolvedInterrupt = await this.#interruptService.respond(interrupt.id, response);

    // Yield interrupt resolved event
    yield {
      type: 'interrupt_resolved',
      approved: response.approved ?? false,
      interruptId: interrupt.id,
    };

    if (response.approved) {
      // Resume execution with the approved tool
      yield* this.#resumeAfterApproval(resolvedInterrupt);
    } else {
      // Tool was denied - inform the agent
      yield* this.#handleDeniedTool(resolvedInterrupt);
    }
  };

  /**
   * Parses user input as an interrupt response.
   */
  #parseInterruptResponse = (interrupt: Interrupt, message: string): InterruptResponse => {
    const trimmed = message.trim().toLowerCase();

    // Tool approval responses
    if (interrupt.type === 'tool_approval') {
      if (trimmed === 'y' || trimmed === 'yes' || trimmed === 'approve') {
        return { approved: true };
      }
      if (trimmed === 'n' || trimmed === 'no' || trimmed === 'deny' || trimmed === 'reject') {
        return { approved: false };
      }
      // Treat any other response as a modification/freeform response
      return { approved: false, freeformResponse: message };
    }

    // Question responses
    if (interrupt.options && interrupt.options.length > 0) {
      // Check for numbered selection
      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && num >= 1 && num <= interrupt.options.length) {
        return { selectedOptionId: interrupt.options[num - 1].id };
      }

      // Check for option label match
      const matchingOption = interrupt.options.find(
        (opt) => opt.label.toLowerCase() === trimmed || opt.id.toLowerCase() === trimmed,
      );
      if (matchingOption) {
        return { selectedOptionId: matchingOption.id };
      }
    }

    // Default to freeform response
    return { freeformResponse: message };
  };

  /**
   * Resumes graph execution after tool approval.
   */
  #resumeAfterApproval = async function* (this: OrchestratorService, interrupt: Interrupt): AsyncGenerator<ChatChunk> {
    this.#ensureConfigured();

    const conversationId = interrupt.conversationId;

    try {
      // Build system prompt with context
      const personality = this.#services.get(PersonalityService);
      const contextBuilder = this.#services.get(ContextBuilderService);
      const context = await contextBuilder.buildContext();
      const systemPrompt = await personality.buildSystemPrompt(context);

      // Get tools as LangChain tools
      const toolContext = {
        userId: 'default',
        conversationId,
        services: this.#services,
      };
      const tools = toLangChainTools(this.#toolRegistry as ToolRegistry, toolContext);

      // Create and compile graph
      const graph = createOrchestratorGraph(
        this.#llm as ChatOpenAI,
        systemPrompt,
        tools,
        this.#toolRegistry as ToolRegistry,
        undefined, // approvalLevels - use defaults
        this.#memoryService ?? undefined,
      );
      const compiledGraph = graph.compile({
        checkpointer: this.#checkpointer as DatabaseCheckpointer,
      });

      // Load existing state and update to mark tool as approved
      const history = await getMessages(this.#db(), conversationId);
      const historyMessages: BaseMessage[] = [];

      for (const msg of history) {
        if (msg.role === 'user') {
          historyMessages.push(new HumanMessage(msg.content));
        } else if (msg.role === 'assistant') {
          const aiMsg = new AIMessage(msg.content);
          if (msg.toolCalls) {
            (aiMsg as AIMessage).tool_calls = JSON.parse(msg.toolCalls);
          }
          historyMessages.push(aiMsg);
        } else if (msg.role === 'tool') {
          historyMessages.push(
            new ToolMessage({
              content: msg.content,
              tool_call_id: msg.toolCallId ?? '',
            }),
          );
        }
      }

      // Create approved tool call from interrupt
      const approvedToolCall = interrupt.toolCall
        ? {
            id: interrupt.toolCall.toolId,
            name: interrupt.toolCall.toolName,
            args: interrupt.toolCall.input as Record<string, unknown>,
          }
        : null;

      // Invoke with approved tool call
      const result = await compiledGraph.invoke(
        {
          conversationId,
          messages: historyMessages,
          approvedToolCalls: approvedToolCall ? [approvedToolCall] : [],
          interruptRequired: false,
          pendingToolCall: null,
        },
        {
          configurable: { thread_id: conversationId },
        },
      );

      // Check for another interrupt
      if (result.interruptRequired && result.pendingToolCall) {
        const newInterrupt = await this.#interruptService.create({
          conversationId,
          type: 'tool_approval',
          prompt: formatApprovalPrompt(result.pendingToolCall),
          toolCall: formatToolCallInfo(result.pendingToolCall),
          checkpointId: conversationId,
        });

        yield { type: 'interrupt', interrupt: newInterrupt };
        return;
      }

      // Extract response
      const lastMessage = result.messages[result.messages.length - 1];
      let responseContent = '';
      let toolCalls: string | undefined;

      if (lastMessage && 'content' in lastMessage) {
        responseContent =
          typeof lastMessage.content === 'string' ? lastMessage.content : JSON.stringify(lastMessage.content);
      }

      if (lastMessage && 'tool_calls' in lastMessage) {
        const aiMessage = lastMessage as AIMessage;
        if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
          toolCalls = JSON.stringify(aiMessage.tool_calls);
        }
      }

      if (responseContent) {
        yield { type: 'token', content: responseContent };
      }

      // Store assistant message
      const tokenUsage =
        lastMessage && 'usage_metadata' in lastMessage ? (lastMessage as AIMessage).usage_metadata : undefined;

      await addMessage(this.#db(), conversationId, {
        role: 'assistant',
        content: responseContent,
        toolCalls,
        inputTokens: tokenUsage?.input_tokens,
        outputTokens: tokenUsage?.output_tokens,
      });

      yield {
        type: 'done',
        inputTokens: tokenUsage?.input_tokens,
        outputTokens: tokenUsage?.output_tokens,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      yield { type: 'error', error: errorMessage };
    }
  };

  /**
   * Handles a denied tool by informing the agent.
   */
  #handleDeniedTool = async function* (this: OrchestratorService, interrupt: Interrupt): AsyncGenerator<ChatChunk> {
    this.#ensureConfigured();

    const conversationId = interrupt.conversationId;
    const toolName = interrupt.toolCall?.toolName ?? 'the tool';
    const freeformResponse = interrupt.response?.freeformResponse;

    // Create a message explaining the denial
    const denialMessage = freeformResponse
      ? `The user denied the execution of ${toolName} and said: "${freeformResponse}"`
      : `The user denied the execution of ${toolName}. Please try a different approach.`;

    // Store the denial as a user message
    await addMessage(this.#db(), conversationId, {
      role: 'user',
      content: denialMessage,
    });

    // Continue chat with the denial context
    yield* this.chat(conversationId, '');
  };

  /**
   * Responds to a pending interrupt directly.
   * This is an alternative to the chat method for programmatic responses.
   */
  respondToInterrupt = async function* (
    this: OrchestratorService,
    interruptId: string,
    response: InterruptResponse,
  ): AsyncGenerator<ChatChunk> {
    const interrupt = await this.#interruptService.get(interruptId);
    if (!interrupt) {
      yield { type: 'error', error: `Interrupt not found: ${interruptId}` };
      return;
    }

    if (interrupt.status !== 'pending') {
      yield { type: 'error', error: `Interrupt is not pending: ${interrupt.status}` };
      return;
    }

    // Record the response
    const resolvedInterrupt = await this.#interruptService.respond(interruptId, response);

    yield {
      type: 'interrupt_resolved',
      approved: response.approved ?? false,
      interruptId,
    };

    if (response.approved) {
      yield* this.#resumeAfterApproval(resolvedInterrupt);
    } else {
      yield* this.#handleDeniedTool(resolvedInterrupt);
    }
  };

  /**
   * Sends a message and waits for the complete response.
   * Simpler API for non-streaming use cases.
   */
  chatSync = async (conversationId: string, message: string): Promise<string> => {
    let response = '';

    for await (const chunk of this.chat(conversationId, message)) {
      if (chunk.type === 'token') {
        response += chunk.content;
      } else if (chunk.type === 'error') {
        throw new Error(chunk.error);
      }
    }

    return response;
  };

  /**
   * Gets the current LangGraph state for debugging.
   */
  getState = async (conversationId: string): Promise<unknown> => {
    this.#ensureConfigured();

    // Create a minimal graph just to get state
    // These are guaranteed non-null by #ensureConfigured() above
    const graph = createOrchestratorGraph(this.#llm as ChatOpenAI, '', []);
    const compiledGraph = graph.compile({
      checkpointer: this.#checkpointer as DatabaseCheckpointer,
    });

    try {
      const state = await compiledGraph.getState({
        configurable: { thread_id: conversationId },
      });
      return state.values;
    } catch {
      return null;
    }
  };
}

// Re-export types and schemas
export type {
  LLMConfig,
  OrchestratorConfig,
  MessageRole,
  Message,
  Conversation,
  ToolCall,
  ChatChunk,
} from './orchestrator.schemas.ts';

export {
  orchestratorConfigSchema,
  llmConfigSchema,
  messageSchema,
  conversationSchema,
} from './orchestrator.schemas.ts';

export { OrchestratorAnnotation } from './orchestrator.state.ts';
export type { OrchestratorState } from './orchestrator.state.ts';

export { DatabaseCheckpointer } from './orchestrator.checkpointer.ts';

export {
  ConversationNotFoundError,
  OrchestratorNotConfiguredError,
  LLMInvocationError,
} from './orchestrator.errors.ts';

// Phase 3: Human in the Loop exports
export { InterruptService, InterruptNotFoundError, InterruptNotPendingError } from './interrupts/interrupts.ts';

export type {
  Interrupt,
  InterruptType,
  InterruptOption,
  InterruptResponse,
  InterruptStatus,
  ToolCallInfo,
  CreateInterruptInput,
} from './interrupts/interrupts.ts';

export {
  interruptSchema,
  interruptTypeSchema,
  interruptOptionSchema,
  interruptResponseSchema,
  interruptStatusSchema,
  toolCallInfoSchema,
  createInterruptInputSchema,
} from './interrupts/interrupts.ts';

export type { PendingToolCall, RiskGateResult } from './orchestrator.risk-gate.ts';
export { evaluateRiskGate, formatApprovalPrompt, formatToolCallInfo } from './orchestrator.risk-gate.ts';

export { OrchestratorService };
