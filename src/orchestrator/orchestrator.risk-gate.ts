import type { AIMessage } from '@langchain/core/messages';

import type { ToolRegistry, RiskLevel } from '../tools/tools.ts';

import type { OrchestratorState } from './orchestrator.state.ts';
import type { ToolCallInfo } from './interrupts/interrupts.ts';

/**
 * Pending tool call with risk information.
 */
type PendingToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  riskLevel: RiskLevel;
  riskReason: string;
};

/**
 * Result of the risk gate evaluation.
 */
type RiskGateResult = {
  /**
   * Tool calls that passed the risk gate (low risk).
   */
  approvedToolCalls: { id: string; name: string; args: Record<string, unknown> }[];

  /**
   * Tool call that requires approval (first high-risk call).
   */
  pendingToolCall: PendingToolCall | null;

  /**
   * Whether an interrupt is required for approval.
   */
  interruptRequired: boolean;
};

/**
 * Default risk levels that require approval.
 * Can be overridden via configuration.
 */
const DEFAULT_APPROVAL_LEVELS: RiskLevel[] = ['medium', 'high', 'critical'];

/**
 * Evaluates tool calls against the risk gate.
 *
 * Returns which tool calls can proceed and which require approval.
 * Only the first high-risk tool call is returned as pending - subsequent
 * ones will be evaluated after the first is approved/denied.
 */
const evaluateRiskGate = (
  toolCalls: { id?: string; name: string; args: Record<string, unknown> }[],
  toolRegistry: ToolRegistry,
  approvalLevels: RiskLevel[] = DEFAULT_APPROVAL_LEVELS,
): RiskGateResult => {
  const approved: RiskGateResult['approvedToolCalls'] = [];
  let pending: PendingToolCall | null = null;

  for (const toolCall of toolCalls) {
    // Handle LangChain tool calls which may have optional id
    const id = toolCall.id ?? `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Look up tool by id (LangChain tool name = GLaDOS tool id)
    const tool = toolRegistry.get(toolCall.name);

    if (!tool) {
      // Unknown tool - treat as high risk
      if (!pending) {
        pending = {
          id,
          name: toolCall.name,
          args: toolCall.args,
          riskLevel: 'high',
          riskReason: 'Unknown tool - requires approval',
        };
      }
      continue;
    }

    const riskLevel = tool.risk.level;

    if (approvalLevels.includes(riskLevel)) {
      // This tool requires approval
      if (!pending) {
        pending = {
          id,
          name: toolCall.name,
          args: toolCall.args,
          riskLevel,
          riskReason: tool.risk.reason,
        };
      }
      // Don't add to approved - will be re-evaluated after first pending is resolved
    } else {
      // Low risk, can proceed
      approved.push({
        id,
        name: toolCall.name,
        args: toolCall.args,
      });
    }
  }

  return {
    approvedToolCalls: approved,
    pendingToolCall: pending,
    interruptRequired: pending !== null,
  };
};

/**
 * Creates the risk gate node for the orchestrator graph.
 *
 * This node intercepts tool calls from the router and evaluates them
 * against the risk policy. Low-risk tools pass through immediately,
 * while higher-risk tools trigger an interrupt for user approval.
 */
const createRiskGateNode = (toolRegistry: ToolRegistry, approvalLevels: RiskLevel[] = DEFAULT_APPROVAL_LEVELS) => {
  return async (state: OrchestratorState): Promise<Partial<OrchestratorState>> => {
    const lastMessage = state.messages[state.messages.length - 1];

    console.log('[riskGateNode] lastMessage type:', lastMessage?._getType?.() ?? 'unknown');

    // No tool calls - pass through
    if (!lastMessage || !('tool_calls' in lastMessage)) {
      console.log('[riskGateNode] No tool calls, passing through');
      return {};
    }

    const aiMessage = lastMessage as AIMessage;
    const toolCalls = aiMessage.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      return {};
    }

    // Check if we already have approved tool calls (from a resume after approval)
    // If so, check if the current tool calls match the approved ones
    const existingApproved = state.approvedToolCalls ?? [];
    const approvedNames = new Set(existingApproved.map((tc) => tc.name));

    // If all requested tool calls are already approved, skip re-evaluation
    const allApproved = toolCalls.every((tc) => approvedNames.has(tc.name));
    if (allApproved && existingApproved.length > 0) {
      // Keep the existing approved calls and proceed to tools
      return {
        approvedToolCalls: existingApproved,
        pendingToolCall: null,
        interruptRequired: false,
      };
    }

    // Filter out already-approved tools before evaluating
    // This prevents re-prompting for tools the user already approved
    const toolsToEvaluate = toolCalls.filter((tc) => !approvedNames.has(tc.name));

    // Evaluate only the non-approved tool calls
    const result = evaluateRiskGate(toolsToEvaluate, toolRegistry, approvalLevels);

    // Merge with any existing approved calls
    const mergedApproved = [...existingApproved];
    for (const approved of result.approvedToolCalls) {
      if (!approvedNames.has(approved.name)) {
        mergedApproved.push(approved);
      }
    }

    // Return state updates
    console.log('[riskGateNode] Result: approved=%d, pending=%s, interrupt=%s',
      mergedApproved.length,
      result.pendingToolCall?.name ?? 'none',
      result.interruptRequired);

    return {
      approvedToolCalls: mergedApproved,
      pendingToolCall: result.pendingToolCall,
      interruptRequired: result.interruptRequired,
    };
  };
};

/**
 * Formats a tool call into a ToolCallInfo for the interrupt.
 */
const formatToolCallInfo = (pending: PendingToolCall): ToolCallInfo => {
  return {
    toolId: pending.id,
    toolName: pending.name,
    input: pending.args,
    riskLevel: pending.riskLevel,
    riskReason: pending.riskReason,
  };
};

/**
 * Generates an approval prompt for a pending tool call.
 */
const formatApprovalPrompt = (pending: PendingToolCall): string => {
  return `I'd like to execute the "${pending.name}" tool. ${pending.riskReason}`;
};

export type { PendingToolCall, RiskGateResult };
export { evaluateRiskGate, createRiskGateNode, formatToolCallInfo, formatApprovalPrompt, DEFAULT_APPROVAL_LEVELS };
