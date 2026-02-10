import type { ChatOpenAI } from '@langchain/openai';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import type { BaseMessage } from '@langchain/core/messages';
import type { CompiledStateGraph } from '@langchain/langgraph';

import type { ToolRegistry, RiskLevel } from '../../agent/tools/tools.ts';
import type { MemoryService } from '../../agent/memory/memory.ts';
import type { SkillRegistry } from '../../agent/skills/skills.ts';
import type { ActiveSkill } from '../../agent/skills/skills.schemas.ts';
import type { Services } from '../../core/services/services.ts';

import type { ToolLookup } from './orchestrator.tool-collector.ts';
import type { OrchestratorState } from './orchestrator.state.ts';
import type { DatabaseCheckpointer } from './orchestrator.checkpointer.ts';
import { createOrchestratorGraph } from './orchestrator.graph.ts';

/**
 * Configuration for creating a GraphExecutor.
 */
type GraphExecutorConfig = {
  llm: ChatOpenAI;
  checkpointer: DatabaseCheckpointer;
  memoryService?: MemoryService;
  skillRegistry?: SkillRegistry;
  services?: Services;
  approvalLevels?: RiskLevel[];
};

/**
 * Context for a single graph execution.
 * Contains everything needed to build and run the graph for one invocation.
 */
type ExecutionContext = {
  conversationId: string;
  systemPrompt: string;
  tools: DynamicStructuredTool[];
  toolLookup: ToolLookup;
  toolRegistry?: ToolRegistry;
};

/**
 * Initial state for a new execution.
 */
type ExecuteInput = {
  messages: BaseMessage[];
  turnCount?: number;
  maxTurns?: number;
  activeSkills?: ActiveSkill[];
};

/**
 * State updates for resuming after an interrupt.
 */
type ResumeInput = {
  stateUpdates: Partial<OrchestratorState>;
  activeSkills?: ActiveSkill[];
};

/**
 * Result of a graph execution.
 */
type ExecutionResult = {
  /** The final state after execution */
  state: OrchestratorState;
  /** Whether the graph halted for an interrupt */
  interrupted: boolean;
  /** The type of interrupt if halted */
  interruptType?: 'turn_limit' | 'tool_approval' | 'skill_activation';
};

/**
 * Executes the orchestrator graph.
 *
 * This class encapsulates graph creation, compilation, and execution.
 * It provides a clean interface for running the graph with different
 * execution contexts (new chat, resume after interrupt, background).
 */
class GraphExecutor {
  #config: GraphExecutorConfig;

  constructor(config: GraphExecutorConfig) {
    this.#config = config;
  }

  /**
   * Builds and compiles the graph for a given execution context.
   */
  #buildGraph = (context: ExecutionContext): CompiledStateGraph<OrchestratorState, Partial<OrchestratorState>> => {
    const graph = createOrchestratorGraph(
      this.#config.llm,
      context.systemPrompt,
      context.tools,
      context.toolLookup,
      this.#config.approvalLevels,
      this.#config.memoryService,
      this.#config.skillRegistry,
      this.#config.services,
    );

    return graph.compile({
      checkpointer: this.#config.checkpointer,
    }) as CompiledStateGraph<OrchestratorState, Partial<OrchestratorState>>;
  };

  /**
   * Analyzes the result state to determine if/why execution was interrupted.
   */
  #analyzeResult = (state: OrchestratorState): ExecutionResult => {
    // Check for turn limit interrupt
    if (state.turnLimitReached) {
      return {
        state,
        interrupted: true,
        interruptType: 'turn_limit',
      };
    }

    // Check for tool approval interrupt
    if (state.interruptRequired && state.pendingToolCall) {
      return {
        state,
        interrupted: true,
        interruptType: 'tool_approval',
      };
    }

    // Check for skill activation interrupt
    if (state.interruptRequired && state.pendingSkillActivation) {
      return {
        state,
        interrupted: true,
        interruptType: 'skill_activation',
      };
    }

    // Normal completion
    return {
      state,
      interrupted: false,
    };
  };

  /**
   * Executes the graph for a new conversation or continued chat.
   *
   * When a checkpoint exists, we use the checkpoint state and only add the new user message.
   * This prevents duplicate messages from being sent to the LLM.
   *
   * @param context - The execution context with tools and system prompt
   * @param input - The initial state including messages
   * @returns The execution result
   */
  execute = async (context: ExecutionContext, input: ExecuteInput): Promise<ExecutionResult> => {
    const compiledGraph = this.#buildGraph(context);

    // Check if a checkpoint exists for this conversation
    const existingState = await compiledGraph.getState({
      configurable: { thread_id: context.conversationId },
    });
    const hasCheckpoint = existingState.values && Object.keys(existingState.values).length > 0;

    let invokeState: Record<string, unknown>;

    if (hasCheckpoint) {
      // Checkpoint exists - use checkpoint messages and only add the new user message
      // The checkpoint already contains the full conversation history including any
      // injected messages (like notifications), so we don't need the database history.
      const checkpointMessages = (existingState.values as OrchestratorState)?.messages ?? [];
      const inputMessages = input.messages;

      // The new user message is the last HumanMessage in the input
      // (it was just stored in the database before execute was called)
      const lastInputMessage = inputMessages[inputMessages.length - 1];
      const isNewUserMessage = lastInputMessage && lastInputMessage._getType() === 'human';

      invokeState = {
        conversationId: context.conversationId,
        // If there's a new user message, append it; otherwise just use checkpoint
        messages: isNewUserMessage ? [...checkpointMessages, lastInputMessage] : checkpointMessages,
        turnCount: input.turnCount ?? (existingState.values as OrchestratorState)?.turnCount ?? 0,
        maxTurns: input.maxTurns ?? 20,
        turnLimitReached: false,
        activeSkills: input.activeSkills ?? (existingState.values as OrchestratorState)?.activeSkills ?? [],
      };
    } else {
      // No checkpoint - use all input messages as initial state
      invokeState = {
        conversationId: context.conversationId,
        messages: input.messages,
        turnCount: input.turnCount ?? 0,
        maxTurns: input.maxTurns ?? 20,
        turnLimitReached: false,
        activeSkills: input.activeSkills ?? [],
      };
    }

    const result = await compiledGraph.invoke(invokeState, {
      configurable: { thread_id: context.conversationId },
      recursionLimit: 150, // Allow up to ~30 turns (5 nodes per turn)
    });

    return this.#analyzeResult(result as OrchestratorState);
  };

  /**
   * Resumes graph execution after an interrupt.
   *
   * @param context - The execution context with tools and system prompt
   * @param input - The state updates to apply when resuming
   * @returns The execution result
   */
  resume = async (context: ExecutionContext, input: ResumeInput): Promise<ExecutionResult> => {
    const compiledGraph = this.#buildGraph(context);

    // Get current checkpoint state
    const currentState = await compiledGraph.getState({
      configurable: { thread_id: context.conversationId },
    });
    const checkpointMessages = currentState.values?.messages ?? [];

    // Build invoke state with checkpoint messages and state updates
    const invokeState: Record<string, unknown> = {
      conversationId: context.conversationId,
      messages: checkpointMessages,
      ...input.stateUpdates,
    };

    // Include activeSkills if provided
    if (input.activeSkills) {
      invokeState.activeSkills = input.activeSkills;
    }

    const result = await compiledGraph.invoke(invokeState, {
      configurable: { thread_id: context.conversationId },
      recursionLimit: 150,
    });

    return this.#analyzeResult(result as OrchestratorState);
  };

  /**
   * Gets the current state for a conversation from the checkpoint.
   *
   * @param conversationId - The conversation to get state for
   * @returns The current state or null if no checkpoint exists
   */
  getState = async (conversationId: string): Promise<OrchestratorState | null> => {
    // Build a minimal graph just to access the checkpointer
    const graph = createOrchestratorGraph(this.#config.llm, '', []);
    const compiledGraph = graph.compile({
      checkpointer: this.#config.checkpointer,
    });

    const state = await compiledGraph.getState({
      configurable: { thread_id: conversationId },
    });

    return (state.values as OrchestratorState) ?? null;
  };
}

export type { GraphExecutorConfig, ExecutionContext, ExecuteInput, ResumeInput, ExecutionResult };
export { GraphExecutor };
