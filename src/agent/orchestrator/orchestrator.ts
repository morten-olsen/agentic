import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';

import type { Services } from '../../core/services/services.ts';
import { DatabaseService } from '../../core/database/database.ts';
import { PersonalityService } from '../../agent/personality/personality.ts';
import { ContextBuilderService } from '../../agent/context/context.ts';
import { LogService } from '../../core/logging/index.ts';
import { ToolRegistry } from '../../agent/tools/tools.ts';
import { registerBuiltinTools } from '../../agent/tools/builtin/builtin.ts';
import { KnexStore } from '../../core/store/store.ts';
import { MemoryService } from '../../agent/memory/memory.ts';
import type { TriggerContext } from '../../features/triggers/triggers.schemas.ts';
import { SkillRegistry } from '../../agent/skills/skills.ts';
import { registerBuiltinSkills, createActivationTools } from '../../agent/skills/index.ts';
import type { ActiveSkill } from '../../agent/skills/skills.schemas.ts';
import { formatSkillActivationPrompt } from '../../agent/skills/skills.node.ts';
import { generateAvailableSkillsContext } from '../../agent/skills/skills.context.ts';
import { ExternalServiceRegistry } from '../../integrations/external/external.ts';
import { generateDeltaInstructions } from '../../agent/personality/personality.prompts.ts';
import { registerExternalServices, registerExternalServiceTools } from '../../integrations/external/external.tools.ts';

import { collectTools } from './orchestrator.tool-collector.ts';
import type { ResumeStrategy } from './orchestrator.resume.ts';
import { getResumeStrategy } from './orchestrator.resume.ts';
import type {
  OrchestratorConfigInput,
  OrchestratorConfig,
  Conversation,
  Message,
  ChatChunk,
} from './orchestrator.schemas.ts';
import { orchestratorConfigSchema } from './orchestrator.schemas.ts';
import { DatabaseCheckpointer } from './orchestrator.checkpointer.ts';
import { GraphExecutor } from './orchestrator.executor.ts';
import type { OrchestratorState } from './orchestrator.state.ts';
import { ConversationStore } from './orchestrator.store.ts';
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
  #conversationStore: ConversationStore;
  #graphExecutor: GraphExecutor | null = null;
  #memoryService: MemoryService | null = null;
  #skillRegistry: SkillRegistry | null = null;
  #externalServiceRegistry: ExternalServiceRegistry | null = null;
  #logService: LogService | null = null;

  constructor(services: Services) {
    this.#services = services;
    this.#interruptService = new InterruptService(services);
    this.#conversationStore = new ConversationStore(services.get(DatabaseService).knex);
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
    this.#conversationStore.setCheckpointer(this.#checkpointer);

    // Initialize tool registry with builtin tools
    this.#toolRegistry = new ToolRegistry(this.#services);
    registerBuiltinTools(this.#toolRegistry);

    // Initialize external service registry and register external tools
    this.#externalServiceRegistry = new ExternalServiceRegistry(this.#services);
    registerExternalServices(this.#externalServiceRegistry);
    registerExternalServiceTools(this.#toolRegistry);

    // Register with Services container so ContextBuilderService can access it
    this.#services.set(ExternalServiceRegistry, this.#externalServiceRegistry);

    // Initialize skill registry and register builtin skills
    this.#skillRegistry = new SkillRegistry();
    registerBuiltinSkills(this.#skillRegistry);

    // Register skill activation tools with the tool registry
    const activationTools = createActivationTools(this.#skillRegistry);
    for (const tool of activationTools) {
      this.#toolRegistry.register(tool);
    }

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

    // Initialize graph executor
    this.#graphExecutor = new GraphExecutor({
      llm: this.#llm,
      checkpointer: this.#checkpointer,
      memoryService: this.#memoryService,
      skillRegistry: this.#skillRegistry,
      services: this.#services,
    });

    // Initialize log service
    this.#logService = this.#services.get(LogService);
    this.#logService.configure();
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
   * Converts stored message history to LangChain BaseMessage array.
   */
  #convertHistoryToMessages = (history: Message[]): BaseMessage[] => {
    const messages: BaseMessage[] = [];

    for (const msg of history) {
      if (msg.role === 'user') {
        messages.push(new HumanMessage(msg.content));
      } else if (msg.role === 'assistant') {
        const aiMsg = new AIMessage(msg.content);
        if (msg.toolCalls) {
          (aiMsg as AIMessage).tool_calls = JSON.parse(msg.toolCalls);
        }
        messages.push(aiMsg);
      } else if (msg.role === 'tool') {
        messages.push(
          new ToolMessage({
            content: msg.content,
            tool_call_id: msg.toolCallId ?? '',
          }),
        );
      }
    }

    return messages;
  };

  /**
   * Handles execution result interrupts.
   * Returns an interrupt if one is needed, or null to continue processing.
   */
  #handleExecutionInterrupts = async (
    conversationId: string,
    result: OrchestratorState,
  ): Promise<{ interrupt?: Interrupt; error?: string } | null> => {
    // Check for turn limit interrupt
    if (result.turnLimitReached) {
      const interrupt = await this.#interruptService.create({
        conversationId,
        type: 'turn_limit',
        prompt: `The conversation has reached ${result.turnCount} turns. Would you like to continue?`,
        checkpointId: conversationId,
      });
      return { interrupt };
    }

    // Check for tool approval interrupt
    if (result.interruptRequired && result.pendingToolCall) {
      // Check if this is an error (e.g., unknown tool) rather than an approval request
      if (result.pendingToolCall.isError) {
        return { error: result.pendingToolCall.riskReason };
      }

      const interrupt = await this.#interruptService.create({
        conversationId,
        type: 'tool_approval',
        prompt: formatApprovalPrompt(result.pendingToolCall),
        toolCall: formatToolCallInfo(result.pendingToolCall),
        checkpointId: conversationId,
      });
      return { interrupt };
    }

    // Check for skill activation interrupt
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
            toolsSummary: skill.tools.map((t) => `${t.id}: ${t.description.split('\n')[0]}`).join('\n'),
          },
          checkpointId: conversationId,
        });
        return { interrupt };
      }
    }

    // No interrupt needed
    return null;
  };

  /**
   * Extracts response content and tool calls from execution result messages.
   */
  #extractResponse = (
    messages: BaseMessage[],
    priorMessageCount: number,
  ): { content: string; toolCalls?: string; tokenUsage?: { input_tokens?: number; output_tokens?: number } } => {
    const lastMessage = messages[messages.length - 1];
    let content = '';

    if (lastMessage && 'content' in lastMessage) {
      content = typeof lastMessage.content === 'string' ? lastMessage.content : JSON.stringify(lastMessage.content);
    }

    // Collect tool_calls from all new AI messages
    const newMessages = messages.slice(priorMessageCount);
    const allToolCalls: { id?: string; name: string; args: Record<string, unknown> }[] = [];
    for (const msg of newMessages) {
      if ('tool_calls' in msg) {
        const aiMsg = msg as AIMessage;
        if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
          allToolCalls.push(...aiMsg.tool_calls);
        }
      }
    }

    const tokenUsage =
      lastMessage && 'usage_metadata' in lastMessage ? (lastMessage as AIMessage).usage_metadata : undefined;

    return {
      content,
      toolCalls: allToolCalls.length > 0 ? JSON.stringify(allToolCalls) : undefined,
      tokenUsage: tokenUsage
        ? { input_tokens: tokenUsage.input_tokens, output_tokens: tokenUsage.output_tokens }
        : undefined,
    };
  };

  /**
   * Loads active skills from checkpoint state.
   */
  #getActiveSkillsFromCheckpoint = async (conversationId: string): Promise<ActiveSkill[]> => {
    try {
      const checkpointTuple = await (this.#checkpointer as DatabaseCheckpointer).getTuple({
        configurable: { thread_id: conversationId },
      });
      if (checkpointTuple?.checkpoint?.channel_values) {
        const channelValues = checkpointTuple.checkpoint.channel_values as Record<string, unknown>;
        return (channelValues.activeSkills as ActiveSkill[]) ?? [];
      }
    } catch {
      // No checkpoint state yet, no active skills
    }
    return [];
  };

  /**
   * Builds the system prompt with context, delta instructions, and skills info.
   */
  #buildSystemPrompt = async (conversationId: string, activeSkills: ActiveSkill[]): Promise<string> => {
    const personality = this.#services.get(PersonalityService);
    const contextBuilder = this.#services.get(ContextBuilderService);
    const { context, delta } = await contextBuilder.buildContext({ conversationId });
    let systemPrompt = await personality.buildSystemPrompt(context);

    // Add delta section if there are significant changes since last snapshot
    if (delta?.hasSignificantChanges) {
      const deltaSection = generateDeltaInstructions(delta);
      if (deltaSection) {
        systemPrompt = `${systemPrompt}\n\n${deltaSection}`;
      }
    }

    // Add available skills context to system prompt
    const skillsContext = generateAvailableSkillsContext(activeSkills, this.#skillRegistry as SkillRegistry);
    if (skillsContext) {
      systemPrompt = `${systemPrompt}\n\n${skillsContext}`;
    }

    return systemPrompt;
  };

  /**
   * Collects tools for graph execution.
   */
  #collectExecutionTools = (conversationId: string, activeSkills: ActiveSkill[]) => {
    const toolContext = {
      userId: 'default', // TODO: get from user model
      conversationId,
      services: this.#services,
    };

    return collectTools({
      baseRegistry: this.#toolRegistry as ToolRegistry,
      skillRegistry: this.#skillRegistry as SkillRegistry,
      externalServiceRegistry: this.#externalServiceRegistry as ExternalServiceRegistry,
      activeSkills,
      toolContext,
    });
  };

  /**
   * Starts a new conversation.
   */
  startConversation = async (options?: { title?: string }): Promise<string> => {
    const conversation = await this.#conversationStore.create(options);
    return conversation.id;
  };

  /**
   * Gets a conversation by ID.
   */
  getConversation = async (conversationId: string): Promise<Conversation | null> => {
    return this.#conversationStore.get(conversationId);
  };

  /**
   * Lists recent conversations.
   */
  listConversations = async (options?: { limit?: number; offset?: number }): Promise<Conversation[]> => {
    return this.#conversationStore.list(options);
  };

  /**
   * Deletes a conversation and all its data.
   * The ConversationStore handles checkpoint cascade deletion.
   */
  deleteConversation = async (conversationId: string): Promise<boolean> => {
    return this.#conversationStore.delete(conversationId);
  };

  /**
   * Gets the message history for a conversation.
   */
  getHistory = async (conversationId: string): Promise<Message[]> => {
    return this.#conversationStore.getMessages(conversationId);
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
    const conversation = await this.#conversationStore.get(conversationId);
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
    await this.#conversationStore.addMessage(conversationId, {
      role: 'user',
      content: message,
    });

    try {
      // Load checkpoint state to get active skills
      const activeSkills = await this.#getActiveSkillsFromCheckpoint(conversationId);

      // Build system prompt and collect tools
      const systemPrompt = await this.#buildSystemPrompt(conversationId, activeSkills);
      const { tools, toolLookup } = this.#collectExecutionTools(conversationId, activeSkills);

      // Load existing messages from history for this conversation
      const history = await this.#conversationStore.getMessages(conversationId);
      const historyMessages: BaseMessage[] = this.#convertHistoryToMessages(history);

      // Execute the graph
      const executionResult = await (this.#graphExecutor as GraphExecutor).execute(
        {
          conversationId,
          systemPrompt,
          tools,
          toolLookup,
        },
        {
          messages: historyMessages,
          activeSkills,
        },
      );
      const result = executionResult.state;

      // Handle any interrupts from execution
      const interruptResult = await this.#handleExecutionInterrupts(conversationId, result);
      if (interruptResult) {
        if (interruptResult.error) {
          yield { type: 'error', error: interruptResult.error };
        } else if (interruptResult.interrupt) {
          yield { type: 'interrupt', interrupt: interruptResult.interrupt };
        }
        return;
      }

      // Extract and store response
      const response = this.#extractResponse(result.messages, historyMessages.length);

      if (response.content) {
        yield { type: 'token', content: response.content };
      }

      await this.#conversationStore.addMessage(conversationId, {
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
        inputTokens: response.tokenUsage?.input_tokens,
        outputTokens: response.tokenUsage?.output_tokens,
      });

      yield {
        type: 'done',
        inputTokens: response.tokenUsage?.input_tokens,
        outputTokens: response.tokenUsage?.output_tokens,
      };
    } catch (error) {
      // Log full error details for debugging
      this.#logService?.error('orchestrator', 'Chat invocation failed', error, {
        conversationId,
      });

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
        yield* this.#handleDenial(resolvedInterrupt);
      }
      return;
    }

    if (response.approved) {
      // Resume execution with the approved tool
      yield* this.#resumeAfterApproval(resolvedInterrupt);
    } else {
      // Tool was denied - inform the agent
      yield* this.#handleDenial(resolvedInterrupt);
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
   * Unified method for resuming graph execution after an approval interrupt.
   *
   * Handles tool_approval, turn_limit, and skill_activation interrupts using
   * a strategy pattern to customize the state updates for each type.
   *
   * Common steps:
   * 1. Load checkpoint state to get active skills
   * 2. Apply strategy.modifyActiveSkills if present (e.g., for skill activation)
   * 3. Build system prompt with context, delta, and skills info
   * 4. Collect tools via ToolCollector
   * 5. Create and compile graph
   * 6. Get current checkpoint state and apply strategy.prepareStateUpdate
   * 7. Invoke graph with state updates
   * 8. Handle nested interrupts
   * 9. Extract and store response
   */
  #resumeWithStrategy = async function* (
    this: OrchestratorService,
    interrupt: Interrupt,
    strategy: ResumeStrategy,
  ): AsyncGenerator<ChatChunk> {
    this.#ensureConfigured();

    const conversationId = interrupt.conversationId;

    try {
      // 1. Load checkpoint state to get active skills
      let activeSkills = await this.#getActiveSkillsFromCheckpoint(conversationId);

      // 2. Apply modifyActiveSkills if the strategy has it (e.g., for skill activation)
      if (strategy.modifyActiveSkills) {
        activeSkills = strategy.modifyActiveSkills(activeSkills, interrupt);
      }

      // 3. Build system prompt and collect tools
      const systemPrompt = await this.#buildSystemPrompt(conversationId, activeSkills);
      const { tools, toolLookup } = this.#collectExecutionTools(conversationId, activeSkills);

      // 4. Get current checkpoint state and prepare state updates
      const currentState = await (this.#graphExecutor as GraphExecutor).getState(conversationId);
      const priorMessageCount = (currentState as OrchestratorState)?.messages?.length ?? 0;
      const stateUpdates = strategy.prepareStateUpdate(interrupt, currentState as OrchestratorState);

      // 6. Resume execution with state updates
      const executionResult = await (this.#graphExecutor as GraphExecutor).resume(
        {
          conversationId,
          systemPrompt,
          tools,
          toolLookup,
        },
        {
          stateUpdates,
          activeSkills: strategy.modifyActiveSkills ? activeSkills : undefined,
        },
      );
      const result = executionResult.state;

      // 8. Handle any nested interrupts
      const interruptResult = await this.#handleExecutionInterrupts(conversationId, result);
      if (interruptResult) {
        if (interruptResult.error) {
          yield { type: 'error', error: interruptResult.error };
        } else if (interruptResult.interrupt) {
          yield { type: 'interrupt', interrupt: interruptResult.interrupt };
        }
        return;
      }

      // 9. Extract and store response
      const response = this.#extractResponse(result.messages, priorMessageCount);

      if (response.content) {
        yield { type: 'token', content: response.content };
      }

      await this.#conversationStore.addMessage(conversationId, {
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
        inputTokens: response.tokenUsage?.input_tokens,
        outputTokens: response.tokenUsage?.output_tokens,
      });

      yield {
        type: 'done',
        inputTokens: response.tokenUsage?.input_tokens,
        outputTokens: response.tokenUsage?.output_tokens,
      };
    } catch (error) {
      this.#logService?.error('orchestrator', `Resume with strategy failed (${interrupt.type})`, error, {
        conversationId,
      });

      const errorMessage = error instanceof Error ? error.message : String(error);
      yield { type: 'error', error: errorMessage };
    }
  };

  /**
   * Resumes graph execution after tool approval.
   * Delegates to the unified #resumeWithStrategy method.
   */
  #resumeAfterApproval = async function* (this: OrchestratorService, interrupt: Interrupt): AsyncGenerator<ChatChunk> {
    const strategy = getResumeStrategy('tool_approval');
    if (!strategy) {
      yield { type: 'error', error: 'No strategy found for tool_approval' };
      return;
    }
    yield* this.#resumeWithStrategy(interrupt, strategy);
  };

  /**
   * Resumes graph execution after turn limit approval.
   * Delegates to the unified #resumeWithStrategy method.
   */
  #resumeAfterTurnLimit = async function* (this: OrchestratorService, interrupt: Interrupt): AsyncGenerator<ChatChunk> {
    const strategy = getResumeStrategy('turn_limit');
    if (!strategy) {
      yield { type: 'error', error: 'No strategy found for turn_limit' };
      return;
    }
    yield* this.#resumeWithStrategy(interrupt, strategy);
  };

  /**
   * Handles a denied action (tool or skill) by informing the agent.
   */
  #handleDenial = async function* (this: OrchestratorService, interrupt: Interrupt): AsyncGenerator<ChatChunk> {
    this.#ensureConfigured();

    const conversationId = interrupt.conversationId;
    const freeformResponse = interrupt.response?.freeformResponse;
    const itemType = interrupt.type === 'skill_activation' ? 'skill' : 'tool';
    const itemName =
      interrupt.type === 'skill_activation'
        ? (interrupt.skillActivation?.skillName ?? 'the skill')
        : (interrupt.toolCall?.toolName ?? 'the tool');

    const actionVerb = interrupt.type === 'skill_activation' ? 'activation of' : 'execution of';
    const denialMessage = freeformResponse
      ? `The user denied the ${actionVerb} ${itemName} ${itemType} and said: "${freeformResponse}"`
      : `The user denied the ${actionVerb} ${itemName} ${itemType}. Please try a different approach.`;

    await this.#conversationStore.addMessage(conversationId, { role: 'user', content: denialMessage });
    yield* this.chat(conversationId, '');
  };

  /**
   * Resumes execution after skill activation approval.
   */
  #resumeAfterSkillActivation = async function* (
    this: OrchestratorService,
    interrupt: Interrupt,
  ): AsyncGenerator<ChatChunk> {
    if (!interrupt.skillActivation) {
      yield { type: 'error', error: 'Skill activation info missing from interrupt' };
      return;
    }
    const strategy = getResumeStrategy('skill_activation');
    if (!strategy) {
      yield { type: 'error', error: 'No strategy found for skill_activation' };
      return;
    }
    yield* this.#resumeWithStrategy(interrupt, strategy);
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
      yield* this.#handleDenial(resolvedInterrupt);
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
      // Note: No delta tracking for background invocations - each trigger is a fresh context
      const personality = this.#services.get(PersonalityService);
      const contextBuilder = this.#services.get(ContextBuilderService);
      const { context } = await contextBuilder.buildContext();
      const systemPrompt = await personality.buildSystemPrompt(context, 'default', triggerContext);

      // Collect tools for this trigger invocation (no active skills for background tasks)
      const toolContext = {
        userId: 'default',
        conversationId,
        services: this.#services,
        triggerId: triggerContext.triggerId,
        triggerName: triggerContext.triggerName,
      };

      const { tools, toolLookup } = collectTools({
        baseRegistry: this.#toolRegistry as ToolRegistry,
        skillRegistry: this.#skillRegistry as SkillRegistry,
        externalServiceRegistry: this.#externalServiceRegistry as ExternalServiceRegistry,
        activeSkills: [], // Background tasks don't have active skills
        toolContext,
      });

      // Store the goal as a user message
      await this.#conversationStore.addMessage(conversationId, {
        role: 'user',
        content: goal,
      });

      // Execute the graph with the goal
      const executionResult = await (this.#graphExecutor as GraphExecutor).execute(
        {
          conversationId,
          systemPrompt,
          tools,
          toolLookup,
        },
        {
          messages: [new HumanMessage(goal)],
        },
      );
      const result = executionResult.state;

      // Extract and store the response (skip the initial HumanMessage)
      const response = this.#extractResponse(result.messages, 1);
      if (response.content) {
        await this.#conversationStore.addMessage(conversationId, {
          role: 'assistant',
          content: response.content,
          toolCalls: response.toolCalls,
          inputTokens: response.tokenUsage?.input_tokens,
          outputTokens: response.tokenUsage?.output_tokens,
        });
      }

      console.log(`Background invocation completed for trigger: ${triggerContext.triggerName}`);
      return conversationId;
    } catch (error) {
      // Log full error details for debugging
      this.#logService?.error('orchestrator', 'Background invocation failed', error, {
        conversationId,
        triggerId: triggerContext.triggerId,
        metadata: { triggerName: triggerContext.triggerName },
      });

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

    try {
      return await (this.#graphExecutor as GraphExecutor).getState(conversationId);
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
