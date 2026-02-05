import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';

import type { Services } from '../services/services.ts';
import { DatabaseService } from '../database/database.ts';
import { PersonalityService } from '../personality/personality.ts';
import { ContextBuilderService } from '../context/context.ts';
import { ToolRegistry } from '../tools/tools.ts';
import { toLangChainToolsFiltered } from '../tools/adapters/adapters.langchain.ts';
import { registerBuiltinTools } from '../tools/builtin/builtin.ts';
import { KnexStore } from '../store/store.ts';
import { MemoryService } from '../memory/memory.ts';
import type { TriggerContext } from '../triggers/triggers.schemas.ts';
import { SkillRegistry } from '../skills/skills.ts';
import { formatSkillActivationPrompt, handleSkillActivationApproval } from '../skills/skills.node.ts';
import { ExternalServiceRegistry } from '../external/external.ts';
import {
  registerExternalServices,
  registerExternalServiceTools,
  createServiceFilter,
} from '../external/external.tools.ts';

import type {
  OrchestratorConfigInput,
  OrchestratorConfig,
  Conversation,
  Message,
  ChatChunk,
} from './orchestrator.schemas.ts';
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
  #skillRegistry: SkillRegistry | null = null;
  #externalServiceRegistry: ExternalServiceRegistry | null = null;

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
  configure = async (config: OrchestratorConfigInput): Promise<void> => {
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

    // Initialize external service registry and register external tools
    this.#externalServiceRegistry = new ExternalServiceRegistry(this.#services);
    registerExternalServices(this.#externalServiceRegistry);
    registerExternalServiceTools(this.#toolRegistry);

    // Register with Services container so ContextBuilderService can access it
    this.#services.set(ExternalServiceRegistry, this.#externalServiceRegistry);

    // Initialize skill registry
    this.#skillRegistry = new SkillRegistry();

    // Initialize store (required by MemoryService)
    // KnexStore is lazily instantiated when MemoryService accesses it
    this.#services.get(KnexStore);

    // Initialize memory service and configure embeddings
    this.#memoryService = this.#services.get(MemoryService);

    // Use provided embedding config or default to local embeddings
    const embeddingConfig = this.#config.embeddings ?? {
      provider: 'local' as const,
      model: 'Xenova/all-MiniLM-L6-v2',
      dimensions: 384,
    };
    await this.#memoryService.configure(embeddingConfig);
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
   * Gets the skill registry.
   */
  get skillRegistry(): SkillRegistry {
    if (!this.#skillRegistry) {
      throw new OrchestratorNotConfiguredError();
    }
    return this.#skillRegistry;
  }

  /**
   * Gets the external service registry.
   */
  get externalServiceRegistry(): ExternalServiceRegistry {
    if (!this.#externalServiceRegistry) {
      throw new OrchestratorNotConfiguredError();
    }
    return this.#externalServiceRegistry;
  }

  /**
   * Ensures the orchestrator is configured.
   */
  #ensureConfigured = (): void => {
    if (
      !this.#config ||
      !this.#llm ||
      !this.#checkpointer ||
      !this.#toolRegistry ||
      !this.#skillRegistry ||
      !this.#externalServiceRegistry
    ) {
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
      const tools = toLangChainToolsFiltered(
        this.#toolRegistry as ToolRegistry,
        toolContext,
        createServiceFilter(this.#externalServiceRegistry as ExternalServiceRegistry),
      );

      // Create and compile graph with tool registry for risk gate, memory service, and skill registry
      const graph = createOrchestratorGraph(
        this.#llm as ChatOpenAI,
        systemPrompt,
        tools,
        this.#toolRegistry as ToolRegistry,
        undefined, // approvalLevels - use defaults
        this.#memoryService ?? undefined,
        this.#skillRegistry ?? undefined,
        this.#services,
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
      // Use a high recursionLimit since we have our own turn counter
      // Each turn involves multiple node visits (memory → turn_counter → router → risk_gate → tools)
      const result = await compiledGraph.invoke(
        {
          conversationId,
          messages: historyMessages,
          turnCount: 0,
          maxTurns: 20,
          turnLimitReached: false,
        },
        {
          configurable: { thread_id: conversationId },
          recursionLimit: 150, // Allow up to ~30 turns (5 nodes per turn)
        },
      );

      // Check if graph halted for a turn limit interrupt
      if (result.turnLimitReached) {
        const interrupt = await this.#interruptService.create({
          conversationId,
          type: 'turn_limit',
          prompt: `The conversation has reached ${result.turnCount} turns. Would you like to continue?`,
          checkpointId: conversationId,
        });

        yield { type: 'interrupt', interrupt };
        return;
      }

      // Check if graph halted for a tool approval interrupt
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

      // Check if graph halted for a skill activation interrupt
      if (result.interruptRequired && result.pendingSkillActivation) {
        const skill = this.#skillRegistry?.get(result.pendingSkillActivation.skillId);
        if (skill) {
          const interrupt = await this.#interruptService.create({
            conversationId,
            type: 'skill_activation',
            prompt: formatSkillActivationPrompt(skill),
            skillActivation: {
              skillId: skill.id,
              skillName: skill.name,
              activationRisk: skill.activationRisk,
              activationReason: skill.activationReason,
              activationParams: result.pendingSkillActivation.activationParams,
              toolsSummary: skill.tools.map((t) => `${t.name}: ${t.description.split('\n')[0]}`).join('\n'),
            },
            checkpointId: conversationId,
          });

          yield { type: 'interrupt', interrupt };
          return;
        }
      }

      // Extract the response from the last message
      const lastMessage = result.messages[result.messages.length - 1];
      let responseContent = '';

      if (lastMessage && 'content' in lastMessage) {
        responseContent =
          typeof lastMessage.content === 'string' ? lastMessage.content : JSON.stringify(lastMessage.content);
      }

      // Collect tool_calls from all new AI messages (not just the last one)
      // The last message might be a text response after tool execution
      const newMessages = result.messages.slice(historyMessages.length);
      const allToolCalls: { id?: string; name: string; args: Record<string, unknown> }[] = [];
      for (const msg of newMessages) {
        if ('tool_calls' in msg) {
          const aiMsg = msg as AIMessage;
          if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
            allToolCalls.push(...aiMsg.tool_calls);
          }
        }
      }
      const toolCalls = allToolCalls.length > 0 ? JSON.stringify(allToolCalls) : undefined;

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

    // Handle turn limit interrupts
    if (interrupt.type === 'turn_limit') {
      if (response.approved) {
        yield* this.#resumeAfterTurnLimit(resolvedInterrupt);
      } else {
        // User doesn't want to continue - just end the conversation turn
        yield { type: 'done' };
      }
      return;
    }

    // Handle skill activation interrupts
    if (interrupt.type === 'skill_activation') {
      if (response.approved) {
        yield* this.#resumeAfterSkillActivation(resolvedInterrupt);
      } else {
        // Skill activation was denied - inform the agent
        yield* this.#handleDeniedSkillActivation(resolvedInterrupt);
      }
      return;
    }

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

    // Tool approval and skill activation responses
    if (interrupt.type === 'tool_approval' || interrupt.type === 'skill_activation') {
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
      const tools = toLangChainToolsFiltered(
        this.#toolRegistry as ToolRegistry,
        toolContext,
        createServiceFilter(this.#externalServiceRegistry as ExternalServiceRegistry),
      );

      // Create and compile graph
      const graph = createOrchestratorGraph(
        this.#llm as ChatOpenAI,
        systemPrompt,
        tools,
        this.#toolRegistry as ToolRegistry,
        undefined, // approvalLevels - use defaults
        this.#memoryService ?? undefined,
        this.#skillRegistry ?? undefined,
        this.#services,
      );
      const compiledGraph = graph.compile({
        checkpointer: this.#checkpointer as DatabaseCheckpointer,
      });

      // Create approved tool call from interrupt
      const approvedToolCall = interrupt.toolCall
        ? {
            id: interrupt.toolCall.toolId,
            name: interrupt.toolCall.toolName,
            args: interrupt.toolCall.input as Record<string, unknown>,
          }
        : null;

      // Get the current checkpoint state to preserve messages
      const currentState = await compiledGraph.getState({
        configurable: { thread_id: conversationId },
      });

      // Get existing messages from checkpoint (preserves tool calls and results)
      const checkpointMessages = currentState.values?.messages ?? [];

      // Get existing approved tool calls from checkpoint and merge with newly approved
      const existingApproved = currentState.values?.approvedToolCalls ?? [];
      const mergedApproved = approvedToolCall ? [...existingApproved, approvedToolCall] : existingApproved;

      // Invoke with merged approved tool calls, preserving checkpoint messages
      const result = await compiledGraph.invoke(
        {
          conversationId,
          messages: checkpointMessages,
          approvedToolCalls: mergedApproved,
          interruptRequired: false,
          pendingToolCall: null,
        },
        {
          configurable: { thread_id: conversationId },
          recursionLimit: 150,
        },
      );

      // Check for turn limit interrupt
      if (result.turnLimitReached) {
        const newInterrupt = await this.#interruptService.create({
          conversationId,
          type: 'turn_limit',
          prompt: `The conversation has reached ${result.turnCount} turns. Would you like to continue?`,
          checkpointId: conversationId,
        });

        yield { type: 'interrupt', interrupt: newInterrupt };
        return;
      }

      // Check for tool approval interrupt
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

      if (lastMessage && 'content' in lastMessage) {
        responseContent =
          typeof lastMessage.content === 'string' ? lastMessage.content : JSON.stringify(lastMessage.content);
      }

      // Collect tool_calls from all new AI messages (not just the last one)
      const newMessages = result.messages.slice(checkpointMessages.length);
      const allToolCalls: { id?: string; name: string; args: Record<string, unknown> }[] = [];
      for (const msg of newMessages) {
        if ('tool_calls' in msg) {
          const aiMsg = msg as AIMessage;
          if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
            allToolCalls.push(...aiMsg.tool_calls);
          }
        }
      }
      const toolCalls = allToolCalls.length > 0 ? JSON.stringify(allToolCalls) : undefined;

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
   * Resumes graph execution after turn limit approval.
   * Resets the turn counter and continues execution.
   */
  #resumeAfterTurnLimit = async function* (this: OrchestratorService, interrupt: Interrupt): AsyncGenerator<ChatChunk> {
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
      const tools = toLangChainToolsFiltered(
        this.#toolRegistry as ToolRegistry,
        toolContext,
        createServiceFilter(this.#externalServiceRegistry as ExternalServiceRegistry),
      );

      // Create and compile graph
      const graph = createOrchestratorGraph(
        this.#llm as ChatOpenAI,
        systemPrompt,
        tools,
        this.#toolRegistry as ToolRegistry,
        undefined,
        this.#memoryService ?? undefined,
        this.#skillRegistry ?? undefined,
        this.#services,
      );
      const compiledGraph = graph.compile({
        checkpointer: this.#checkpointer as DatabaseCheckpointer,
      });

      // Get the current checkpoint state
      const currentState = await compiledGraph.getState({
        configurable: { thread_id: conversationId },
      });

      // Get existing messages from checkpoint
      const checkpointMessages = currentState.values?.messages ?? [];

      // Reset the turn count and continue
      const result = await compiledGraph.invoke(
        {
          conversationId,
          messages: checkpointMessages,
          turnCount: 0, // Reset turn count
          turnLimitReached: false,
          interruptRequired: false,
        },
        {
          configurable: { thread_id: conversationId },
          recursionLimit: 150,
        },
      );

      // Check for another turn limit
      if (result.turnLimitReached) {
        const newInterrupt = await this.#interruptService.create({
          conversationId,
          type: 'turn_limit',
          prompt: `The conversation has reached ${result.turnCount} more turns. Would you like to continue?`,
          checkpointId: conversationId,
        });

        yield { type: 'interrupt', interrupt: newInterrupt };
        return;
      }

      // Check for tool approval interrupt
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

      if (lastMessage && 'content' in lastMessage) {
        responseContent =
          typeof lastMessage.content === 'string' ? lastMessage.content : JSON.stringify(lastMessage.content);
      }

      // Collect tool_calls from all new AI messages (not just the last one)
      const newMessages = result.messages.slice(checkpointMessages.length);
      const allToolCalls: { id?: string; name: string; args: Record<string, unknown> }[] = [];
      for (const msg of newMessages) {
        if ('tool_calls' in msg) {
          const aiMsg = msg as AIMessage;
          if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
            allToolCalls.push(...aiMsg.tool_calls);
          }
        }
      }
      const toolCalls = allToolCalls.length > 0 ? JSON.stringify(allToolCalls) : undefined;

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
   * Resumes execution after skill activation approval.
   */
  #resumeAfterSkillActivation = async function* (
    this: OrchestratorService,
    interrupt: Interrupt,
  ): AsyncGenerator<ChatChunk> {
    this.#ensureConfigured();

    const conversationId = interrupt.conversationId;
    const skillInfo = interrupt.skillActivation;

    if (!skillInfo) {
      yield { type: 'error', error: 'Skill activation info missing from interrupt' };
      return;
    }

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
      const tools = toLangChainToolsFiltered(
        this.#toolRegistry as ToolRegistry,
        toolContext,
        createServiceFilter(this.#externalServiceRegistry as ExternalServiceRegistry),
      );

      // Create and compile graph
      const graph = createOrchestratorGraph(
        this.#llm as ChatOpenAI,
        systemPrompt,
        tools,
        this.#toolRegistry as ToolRegistry,
        undefined,
        this.#memoryService ?? undefined,
        this.#skillRegistry ?? undefined,
        this.#services,
      );
      const compiledGraph = graph.compile({
        checkpointer: this.#checkpointer as DatabaseCheckpointer,
      });

      // Get the current checkpoint state
      const currentState = await compiledGraph.getState({
        configurable: { thread_id: conversationId },
      });

      // Get existing messages and state from checkpoint
      const checkpointMessages = currentState.values?.messages ?? [];
      const existingActiveSkills = currentState.values?.activeSkills ?? [];

      // Use handleSkillActivationApproval to properly activate the skill
      const skillActivationUpdate = await handleSkillActivationApproval(
        {
          ...currentState.values,
          pendingSkillActivation: {
            skillId: skillInfo.skillId,
            activationParams: skillInfo.activationParams,
          },
        },
        this.#skillRegistry as SkillRegistry,
        this.#services,
      );

      // Resume with the activated skill
      const result = await compiledGraph.invoke(
        {
          conversationId,
          messages: checkpointMessages,
          activeSkills: skillActivationUpdate.activeSkills ?? existingActiveSkills,
          pendingSkillActivation: null,
          interruptRequired: false,
        },
        {
          configurable: { thread_id: conversationId },
          recursionLimit: 150,
        },
      );

      // Check for additional interrupts
      if (result.turnLimitReached) {
        const newInterrupt = await this.#interruptService.create({
          conversationId,
          type: 'turn_limit',
          prompt: `The conversation has reached ${result.turnCount} turns. Would you like to continue?`,
          checkpointId: conversationId,
        });

        yield { type: 'interrupt', interrupt: newInterrupt };
        return;
      }

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

      if (result.interruptRequired && result.pendingSkillActivation) {
        const skill = this.#skillRegistry?.get(result.pendingSkillActivation.skillId);
        if (skill) {
          const newInterrupt = await this.#interruptService.create({
            conversationId,
            type: 'skill_activation',
            prompt: formatSkillActivationPrompt(skill),
            skillActivation: {
              skillId: skill.id,
              skillName: skill.name,
              activationRisk: skill.activationRisk,
              activationReason: skill.activationReason,
              activationParams: result.pendingSkillActivation.activationParams,
              toolsSummary: skill.tools.map((t) => `${t.name}: ${t.description.split('\n')[0]}`).join('\n'),
            },
            checkpointId: conversationId,
          });

          yield { type: 'interrupt', interrupt: newInterrupt };
          return;
        }
      }

      // Extract response
      const lastMessage = result.messages[result.messages.length - 1];
      let responseContent = '';

      if (lastMessage && 'content' in lastMessage) {
        responseContent =
          typeof lastMessage.content === 'string' ? lastMessage.content : JSON.stringify(lastMessage.content);
      }

      // Collect tool_calls from new messages
      const newMessages = result.messages.slice(checkpointMessages.length);
      const allToolCalls: { id?: string; name: string; args: Record<string, unknown> }[] = [];
      for (const msg of newMessages) {
        if ('tool_calls' in msg) {
          const aiMsg = msg as AIMessage;
          if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
            allToolCalls.push(...aiMsg.tool_calls);
          }
        }
      }
      const toolCalls = allToolCalls.length > 0 ? JSON.stringify(allToolCalls) : undefined;

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
   * Handles a denied skill activation by informing the agent.
   */
  #handleDeniedSkillActivation = async function* (
    this: OrchestratorService,
    interrupt: Interrupt,
  ): AsyncGenerator<ChatChunk> {
    this.#ensureConfigured();

    const conversationId = interrupt.conversationId;
    const skillName = interrupt.skillActivation?.skillName ?? 'the skill';
    const freeformResponse = interrupt.response?.freeformResponse;

    // Create a message explaining the denial
    const denialMessage = freeformResponse
      ? `The user denied the activation of ${skillName} skill and said: "${freeformResponse}"`
      : `The user denied the activation of ${skillName} skill. Please try a different approach.`;

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
   * Invokes the orchestrator in background mode for trigger-initiated conversations.
   * Creates a new conversation, runs the agent with the given goal, and returns the conversation ID.
   * The agent runs non-interactively and can use the notify tool to communicate with the user.
   */
  invokeBackground = async (goal: string, triggerContext: TriggerContext): Promise<string> => {
    this.#ensureConfigured();

    // Create a new conversation for this trigger invocation
    const conversationId = await this.startConversation({
      title: `Trigger: ${triggerContext.triggerName}`,
    });

    try {
      // Build system prompt with trigger context
      const personality = this.#services.get(PersonalityService);
      const contextBuilder = this.#services.get(ContextBuilderService);
      const context = await contextBuilder.buildContext();
      const systemPrompt = await personality.buildSystemPrompt(context, 'default', triggerContext);

      // Get tools as LangChain tools with trigger context
      const toolContext = {
        userId: 'default',
        conversationId,
        services: this.#services,
        triggerId: triggerContext.triggerId,
        triggerName: triggerContext.triggerName,
      };
      const tools = toLangChainToolsFiltered(
        this.#toolRegistry as ToolRegistry,
        toolContext,
        createServiceFilter(this.#externalServiceRegistry as ExternalServiceRegistry),
      );

      // Create and compile graph
      const graph = createOrchestratorGraph(
        this.#llm as ChatOpenAI,
        systemPrompt,
        tools,
        this.#toolRegistry as ToolRegistry,
        undefined,
        this.#memoryService ?? undefined,
        this.#skillRegistry ?? undefined,
        this.#services,
      );
      const compiledGraph = graph.compile({
        checkpointer: this.#checkpointer as DatabaseCheckpointer,
      });

      // Store the goal as a user message
      await addMessage(this.#db(), conversationId, {
        role: 'user',
        content: goal,
      });

      // Run the graph with the goal
      const result = await compiledGraph.invoke(
        {
          conversationId,
          messages: [new HumanMessage(goal)],
          turnCount: 0,
          maxTurns: 20,
          turnLimitReached: false,
        },
        {
          configurable: { thread_id: conversationId },
          recursionLimit: 150,
        },
      );

      // Extract and store the response
      const lastMessage = result.messages[result.messages.length - 1];
      if (lastMessage && 'content' in lastMessage) {
        const responseContent =
          typeof lastMessage.content === 'string' ? lastMessage.content : JSON.stringify(lastMessage.content);

        // Collect tool_calls from all new AI messages (skip the initial HumanMessage)
        const newMessages = result.messages.slice(1);
        const allToolCalls: { id?: string; name: string; args: Record<string, unknown> }[] = [];
        for (const msg of newMessages) {
          if ('tool_calls' in msg) {
            const aiMsg = msg as AIMessage;
            if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
              allToolCalls.push(...aiMsg.tool_calls);
            }
          }
        }
        const toolCalls = allToolCalls.length > 0 ? JSON.stringify(allToolCalls) : undefined;

        const tokenUsage =
          lastMessage && 'usage_metadata' in lastMessage ? (lastMessage as AIMessage).usage_metadata : undefined;

        await addMessage(this.#db(), conversationId, {
          role: 'assistant',
          content: responseContent,
          toolCalls,
          inputTokens: tokenUsage?.input_tokens,
          outputTokens: tokenUsage?.output_tokens,
        });
      }

      console.log(`Background invocation completed for trigger: ${triggerContext.triggerName}`);
      return conversationId;
    } catch (error) {
      console.error(`Background invocation failed for trigger ${triggerContext.triggerName}:`, error);
      throw error;
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
