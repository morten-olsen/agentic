import type { AIMessage } from '@langchain/core/messages';

import type { Services } from '../../core/services/services.ts';
import type {
  ToolRegistry,
  RiskLevel,
  RiskProfile,
  ToolRisk,
  ToolDefinition,
  RegisteredTool,
} from '../../agent/tools/tools.ts';
import { isDynamicRiskProfile } from '../../agent/tools/tools.ts';
import type { SkillRegistry } from '../../agent/skills/skills.ts';

import type { OrchestratorState } from './orchestrator.state.ts';
import type { ToolCallInfo } from './interrupts/interrupts.ts';
import type { ToolLookup } from './orchestrator.tool-collector.ts';

/**
 * Pending tool call with risk information.
 */
type PendingToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  riskLevel: RiskLevel;
  riskReason: string;
  /** If true, this is an error (e.g., unknown tool) not an approval request */
  isError?: boolean;
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
 * Resolves a tool's risk profile, handling both static and dynamic risk.
 *
 * For static risk profiles, returns the profile directly.
 * For dynamic risk profiles, calls the evaluator with the input and services.
 * If evaluation fails, falls back to the defaultProfile.
 *
 * @param risk - The tool's risk (static or dynamic)
 * @param input - The tool input being evaluated
 * @param services - The services container (required for dynamic evaluation)
 * @returns The resolved risk profile
 */
const resolveRiskProfile = async <TInput>(
  risk: ToolRisk<TInput>,
  input: TInput,
  services?: Services,
): Promise<RiskProfile> => {
  if (isDynamicRiskProfile(risk)) {
    if (!services) {
      // No services available, use default profile
      return risk.defaultProfile;
    }
    try {
      return await risk.evaluator(input, services);
    } catch (error) {
      // Log error and fall back to default
      console.error('Dynamic risk evaluation failed:', error);
      return risk.defaultProfile;
    }
  }
  return risk;
};

/**
 * Evaluates tool calls against the risk gate.
 *
 * Returns which tool calls can proceed and which require approval.
 * Only the first high-risk tool call is returned as pending - subsequent
 * ones will be evaluated after the first is approved/denied.
 *
 * @param toolCalls - The tool calls to evaluate
 * @param toolLookup - Tool lookup (can be ToolRegistry or ToolLookup from collectTools)
 * @param services - Optional services container for dynamic risk evaluation
 * @param approvalLevels - Risk levels that require approval
 * @param skillRegistry - Optional skill registry to provide better error messages
 *                        for tools belonging to inactive skills
 */
const evaluateRiskGate = async (
  toolCalls: { id?: string; name: string; args: Record<string, unknown> }[],
  toolLookup: ToolRegistry | ToolLookup,
  services?: Services,
  approvalLevels: RiskLevel[] = DEFAULT_APPROVAL_LEVELS,
  skillRegistry?: SkillRegistry,
): Promise<RiskGateResult> => {
  const approved: RiskGateResult['approvedToolCalls'] = [];
  let pending: PendingToolCall | null = null;

  for (const toolCall of toolCalls) {
    // Handle LangChain tool calls which may have optional id
    const id = toolCall.id ?? `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Look up tool by id (LangChain tool name = GLaDOS tool id)
    const tool = toolLookup.get(toolCall.name) as ToolDefinition | RegisteredTool | undefined;

    if (!tool) {
      // Unknown tool - this is an error, not an approval request
      // Set as pending with isError flag so it returns an error to the LLM
      if (!pending) {
        // Check if this tool belongs to an inactive skill
        let errorMessage: string;
        if (skillRegistry) {
          // First try direct lookup
          let skill = skillRegistry.findSkillByToolId(toolCall.name);

          // If not found and name contains a colon or dot, try converting to underscore format
          // LLMs sometimes hallucinate "skillId:toolName" or "skillId.toolName" instead of "skillId_toolName"
          let correctedName: string | null = null;
          if (!skill && (toolCall.name.includes(':') || toolCall.name.includes('.'))) {
            correctedName = toolCall.name.replace(/[:.]/, '_');
            skill = skillRegistry.findSkillByToolId(correctedName);
          }

          if (skill) {
            const actualToolName = correctedName ?? toolCall.name;
            const wrongFormatHint = correctedName
              ? ` Note: You used "${toolCall.name}" but the correct format is "${correctedName}" (underscore separator).`
              : '';
            errorMessage =
              `Tool "${actualToolName}" belongs to the "${skill.name}" skill which is not currently active. ` +
              `You must first activate the skill by calling "activate_${skill.id}", wait for the activation ` +
              `to complete, then call the tool in a subsequent response.${wrongFormatHint}`;
          } else {
            // Check if it looks like a skill tool format but we can't identify the skill
            const wrongFormatHint =
              toolCall.name.includes(':') || toolCall.name.includes('.')
                ? ` Note: Tool names use underscores as separators (e.g., "skillId_toolName").`
                : '';
            errorMessage =
              `Unknown tool "${toolCall.name}". This tool does not exist.${wrongFormatHint} ` +
              `Use skills.list_skills to see available tools, or activate a skill first if needed.`;
          }
        } else {
          const wrongFormatHint =
            toolCall.name.includes(':') || toolCall.name.includes('.')
              ? ` Note: Tool names use underscores as separators (e.g., "skillId_toolName").`
              : '';
          errorMessage =
            `Unknown tool "${toolCall.name}". This tool does not exist.${wrongFormatHint} ` +
            `Use skills.list_skills to see available tools, or activate a skill first if needed.`;
        }

        pending = {
          id,
          name: toolCall.name,
          args: toolCall.args,
          riskLevel: 'high',
          riskReason: errorMessage,
          isError: true,
        };
      }
      continue;
    }

    // Resolve risk profile (handles both static and dynamic risk)
    const riskProfile = await resolveRiskProfile(tool.risk, toolCall.args, services);
    const riskLevel = riskProfile.level;

    if (approvalLevels.includes(riskLevel)) {
      // This tool requires approval
      if (!pending) {
        pending = {
          id,
          name: toolCall.name,
          args: toolCall.args,
          riskLevel,
          riskReason: riskProfile.reason,
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
 *
 * @param toolLookup - Tool lookup (can be ToolRegistry or ToolLookup from collectTools)
 * @param services - Services container for dynamic risk evaluation
 * @param approvalLevels - Risk levels that require approval
 * @param skillRegistry - Optional skill registry for error messages
 */
const createRiskGateNode = (
  toolLookup: ToolRegistry | ToolLookup,
  services?: Services,
  approvalLevels: RiskLevel[] = DEFAULT_APPROVAL_LEVELS,
  skillRegistry?: SkillRegistry,
) => {
  return async (state: OrchestratorState): Promise<Partial<OrchestratorState>> => {
    const lastMessage = state.messages[state.messages.length - 1];

    // No tool calls - pass through
    if (!lastMessage || !('tool_calls' in lastMessage)) {
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

    // Evaluate only the non-approved tool calls (now async for dynamic risk)
    const result = await evaluateRiskGate(toolsToEvaluate, toolLookup, services, approvalLevels, skillRegistry);

    // Merge with any existing approved calls
    const mergedApproved = [...existingApproved];
    for (const approved of result.approvedToolCalls) {
      if (!approvedNames.has(approved.name)) {
        mergedApproved.push(approved);
      }
    }

    // Return state updates
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
