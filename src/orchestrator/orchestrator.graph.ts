import { StateGraph, START, END } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import type { ChatOpenAI } from '@langchain/openai';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { AIMessage } from '@langchain/core/messages';

import type { ToolRegistry, RiskLevel } from '../tools/tools.ts';
import type { MemoryService } from '../memory/memory.ts';

import { OrchestratorAnnotation } from './orchestrator.state.ts';
import type { OrchestratorState } from './orchestrator.state.ts';
import { createMemoryRetrieverNode } from './orchestrator.nodes.ts';
import { createRiskGateNode, DEFAULT_APPROVAL_LEVELS } from './orchestrator.risk-gate.ts';

/**
 * Configuration for the orchestrator graph.
 */
type GraphConfig = {
  llm: ChatOpenAI;
  systemPrompt: string;
  tools: DynamicStructuredTool[];
  toolRegistry: ToolRegistry;
  approvalLevels?: RiskLevel[];
};

/**
 * Creates the router node that calls the LLM.
 */
const createRouterNode = (llm: ChatOpenAI, systemPrompt: string, tools: DynamicStructuredTool[]) => {
  const llmWithTools = llm.bindTools(tools);

  return async (state: OrchestratorState): Promise<Partial<OrchestratorState>> => {
    // Build messages array with system prompt
    const systemMessage = {
      role: 'system' as const,
      content: systemPrompt,
    };

    // Convert state messages to the format expected by the LLM
    const messages = [systemMessage, ...state.messages];

    // Call the LLM
    const response = await llmWithTools.invoke(messages);

    return {
      messages: [response],
    };
  };
};

/**
 * Determines whether to continue to risk gate or end after router.
 */
const routeAfterRouter = (state: OrchestratorState): 'risk_gate' | 'end' => {
  const lastMessage = state.messages[state.messages.length - 1];

  // Check if the last message has tool calls
  if (lastMessage && 'tool_calls' in lastMessage) {
    const aiMessage = lastMessage as AIMessage;
    if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
      return 'risk_gate';
    }
  }

  return 'end';
};

/**
 * Determines the next step after risk gate evaluation.
 */
const routeAfterRiskGate = (state: OrchestratorState): 'tools' | 'interrupt' | 'router' => {
  // If an interrupt is required, halt and wait for approval
  if (state.interruptRequired) {
    return 'interrupt';
  }

  // If we have approved tool calls, execute them
  if (state.approvedToolCalls && state.approvedToolCalls.length > 0) {
    return 'tools';
  }

  // No tool calls to process (shouldn't normally happen)
  return 'router';
};

/**
 * Interrupt node - signals that the graph should halt for user approval.
 * The actual interrupt creation happens in the orchestrator service.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const interruptNode = async (_state: OrchestratorState): Promise<Partial<OrchestratorState>> => {
  // This node marks that we've reached the interrupt point
  // The orchestrator service will detect this state and create the actual interrupt
  return {
    currentInterrupt: null, // Will be populated by orchestrator service
  };
};

/**
 * Creates a filtered tool node that only executes approved tools.
 * This wraps the standard ToolNode to respect the risk gate's decisions.
 */
const createFilteredToolNode = (tools: DynamicStructuredTool[]) => {
  const toolNode = new ToolNode(tools);

  return async (state: OrchestratorState): Promise<Partial<OrchestratorState>> => {
    // Get the last message with tool calls
    const lastMessage = state.messages[state.messages.length - 1];
    if (!lastMessage || !('tool_calls' in lastMessage)) {
      return {};
    }

    const aiMessage = lastMessage as AIMessage;
    const originalToolCalls = aiMessage.tool_calls ?? [];

    // Filter to only approved tool calls - match by NAME since the LLM generates new IDs each time
    const approvedNames = new Set(state.approvedToolCalls?.map((tc) => tc.name) ?? []);
    const filteredToolCalls = originalToolCalls.filter((tc) => approvedNames.has(tc.name) || approvedNames.size === 0);

    if (filteredToolCalls.length === 0) {
      return {};
    }

    // Create a new AIMessage with only approved tool calls.
    // IMPORTANT: We must construct a proper AIMessage instance, not a plain object,
    // because LangChain's ToolNode validates messages using isBaseMessage() which
    // checks for the _getType() method that only exists on class instances.
    const filteredMessage = new AIMessage({
      content: aiMessage.content,
      tool_calls: filteredToolCalls,
      additional_kwargs: aiMessage.additional_kwargs,
      response_metadata: aiMessage.response_metadata,
    });

    // ToolNode expects { messages: BaseMessage[] } format
    const messagesForToolNode = [...state.messages.slice(0, -1), filteredMessage];
    const result = await toolNode.invoke({ messages: messagesForToolNode });

    // Clear the approved list after execution
    return {
      ...result,
      approvedToolCalls: [],
      pendingToolCall: null,
      interruptRequired: false,
    };
  };
};

/**
 * Creates the LangGraph state machine for the orchestrator.
 *
 * Graph flow:
 * START → memory_retriever → router → risk_gate → [interrupt | tools]
 *                             ↑                          |
 *                             |__________________________↓
 */
const createOrchestratorGraph = (
  llm: ChatOpenAI,
  systemPrompt: string,
  tools: DynamicStructuredTool[],
  toolRegistry?: ToolRegistry,
  approvalLevels?: RiskLevel[],
  memoryService?: MemoryService,
) => {
  // Create the filtered tool node
  const toolNode = createFilteredToolNode(tools);

  // Create the router node
  const routerNode = createRouterNode(llm, systemPrompt, tools);

  // Create the risk gate node (if tool registry provided)
  const riskGateNode = toolRegistry
    ? createRiskGateNode(toolRegistry, approvalLevels ?? DEFAULT_APPROVAL_LEVELS)
    : async () => ({ approvedToolCalls: [], interruptRequired: false });

  // Create the memory retriever node (with optional MemoryService)
  const memoryNode = createMemoryRetrieverNode(memoryService);

  // Build the graph
  const graph = new StateGraph(OrchestratorAnnotation)
    .addNode('memory_retriever', memoryNode)
    .addNode('router', routerNode)
    .addNode('risk_gate', riskGateNode)
    .addNode('tools', toolNode)
    .addNode('interrupt', interruptNode)
    .addEdge(START, 'memory_retriever')
    .addEdge('memory_retriever', 'router')
    .addConditionalEdges('router', routeAfterRouter, {
      risk_gate: 'risk_gate',
      end: END,
    })
    .addConditionalEdges('risk_gate', routeAfterRiskGate, {
      tools: 'tools',
      interrupt: 'interrupt',
      router: 'router',
    })
    .addEdge('tools', 'router')
    .addEdge('interrupt', END); // Interrupt halts graph execution

  return graph;
};

export type { GraphConfig };
export {
  createOrchestratorGraph,
  createRouterNode,
  routeAfterRouter,
  routeAfterRiskGate,
  createFilteredToolNode,
  interruptNode,
};
