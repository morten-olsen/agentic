import type { AIMessage } from '@langchain/core/messages';

import type { OrchestratorState } from '../orchestrator/orchestrator.state.ts';

import type { SkillDefinition, ActiveSkill, SkillContext } from './skills.schemas.ts';
import type { SkillRegistry } from './skills.ts';

/**
 * Result from skill activation node.
 */
type SkillActivationNodeResult = {
  /** Updated state fields */
  state: Partial<OrchestratorState>;
  /** Whether an interrupt should be created */
  requiresInterrupt: boolean;
  /** Info for the interrupt if required */
  interruptInfo?: {
    skillId: string;
    skillName: string;
    activationRisk: string;
    activationReason: string;
    activationParams?: unknown;
    toolsSummary: string;
  };
};

/**
 * Checks if the pending tool call is a skill activation tool.
 */
const isSkillActivationTool = (toolName: string): boolean => {
  return toolName.startsWith('activate_');
};

/**
 * Extracts the skill ID from an activation tool name.
 */
const getSkillIdFromToolName = (toolName: string): string => {
  return toolName.replace('activate_', '');
};

/**
 * Checks if the pending tool call is the deactivate_skill tool.
 */
const isDeactivateSkillTool = (toolName: string): boolean => {
  return toolName === 'deactivate_skill' || toolName === 'DeactivateSkill';
};

/**
 * Formats the skill activation approval prompt.
 */
const formatSkillActivationPrompt = (skill: SkillDefinition): string => {
  const lines = [
    `I'd like to activate the **${skill.name}** skill.`,
    '',
    skill.activationReason,
    '',
    '**Capabilities that will be unlocked:**',
    ...skill.tools.map((t) => `- ${t.name}: ${t.description.split('\n')[0]}`),
    '',
    'Do you want to allow this?',
  ];
  return lines.join('\n');
};

/**
 * Activates a skill and returns the updated state.
 */
const activateSkill = async (
  state: OrchestratorState,
  skill: SkillDefinition,
  params: unknown,
  skillRegistry: SkillRegistry,
  services: unknown,
): Promise<Partial<OrchestratorState>> => {
  // Run onActivate hook if present
  let additionalContext: string | undefined;
  if (skill.onActivate) {
    const context: SkillContext = {
      conversationId: state.conversationId,
      services: services as SkillContext['services'],
    };
    const result = await skill.onActivate(params, context);
    if (!result.success) {
      // Activation failed - return error in messages
      return {
        pendingToolCall: null,
        pendingSkillActivation: null,
      };
    }
    additionalContext = result.additionalContext;
  }

  // Create active skill entry
  const activeSkill: ActiveSkill = {
    id: skill.id,
    activatedAt: new Date().toISOString(),
    activationParams: params,
    additionalContext,
  };

  return {
    activeSkills: [...state.activeSkills, activeSkill],
    pendingToolCall: null,
    pendingSkillActivation: null,
  };
};

/**
 * Deactivates a skill and returns the updated state.
 */
const deactivateSkill = async (
  state: OrchestratorState,
  skillId: string,
  skillRegistry: SkillRegistry,
  services: unknown,
): Promise<Partial<OrchestratorState>> => {
  const skill = skillRegistry.get(skillId);

  // Run onDeactivate hook if present
  if (skill?.onDeactivate) {
    const context: SkillContext = {
      conversationId: state.conversationId,
      services: services as SkillContext['services'],
    };
    await skill.onDeactivate(context);
  }

  // Remove skill from active skills
  const activeSkills = state.activeSkills.filter((s) => s.id !== skillId);

  return {
    activeSkills,
    pendingToolCall: null,
  };
};

/**
 * Creates the skill activation node for the orchestrator graph.
 *
 * This node intercepts skill activation/deactivation tool calls and handles them:
 * - For low/medium risk skills: activates immediately
 * - For high/critical risk skills: creates an interrupt for approval
 * - For deactivation: deactivates immediately
 */
const createSkillActivationNode = (skillRegistry: SkillRegistry, services: unknown) => {
  return async (state: OrchestratorState): Promise<Partial<OrchestratorState>> => {
    // Check if there's a pending tool call
    const lastMessage = state.messages[state.messages.length - 1];
    if (!lastMessage || !('tool_calls' in lastMessage)) {
      return {};
    }

    const aiMessage = lastMessage as AIMessage;
    const toolCalls = aiMessage.tool_calls ?? [];

    // Find skill-related tool calls
    for (const toolCall of toolCalls) {
      const toolName = toolCall.name;

      // Handle skill activation
      if (isSkillActivationTool(toolName)) {
        const skillId = getSkillIdFromToolName(toolName);
        const skill = skillRegistry.get(skillId);

        if (!skill) {
          // Unknown skill - let the tool execution handle the error
          continue;
        }

        // Check if already active
        if (skillRegistry.isActive(skillId, state.activeSkills)) {
          // Return result indicating already active
          return {
            pendingToolCall: null,
          };
        }

        // Check if approval is required
        if (skillRegistry.requiresApproval(skill)) {
          // Need to create an interrupt
          return {
            interruptRequired: true,
            pendingSkillActivation: {
              skillId: skill.id,
              activationParams: toolCall.args,
            },
            // Store info for the orchestrator to create the interrupt
            currentInterrupt: null,
          };
        }

        // Low/medium risk - activate immediately
        return await activateSkill(state, skill, toolCall.args, skillRegistry, services);
      }

      // Handle skill deactivation
      if (isDeactivateSkillTool(toolName)) {
        const args = toolCall.args as { skillId?: string };
        const skillId = args.skillId;

        if (!skillId) {
          continue;
        }

        // Check if actually active
        if (!skillRegistry.isActive(skillId, state.activeSkills)) {
          continue;
        }

        // Deactivate immediately (no approval needed)
        return await deactivateSkill(state, skillId, skillRegistry, services);
      }
    }

    // No skill-related tool calls
    return {};
  };
};

/**
 * Handles resuming after skill activation approval.
 */
const handleSkillActivationApproval = async (
  state: OrchestratorState,
  skillRegistry: SkillRegistry,
  services: unknown,
): Promise<Partial<OrchestratorState>> => {
  const pending = state.pendingSkillActivation;
  if (!pending) {
    return {};
  }

  const skill = skillRegistry.get(pending.skillId);
  if (!skill) {
    return {
      pendingSkillActivation: null,
      interruptRequired: false,
    };
  }

  return await activateSkill(state, skill, pending.activationParams, skillRegistry, services);
};

export type { SkillActivationNodeResult };
export {
  createSkillActivationNode,
  handleSkillActivationApproval,
  isSkillActivationTool,
  isDeactivateSkillTool,
  getSkillIdFromToolName,
  formatSkillActivationPrompt,
  activateSkill,
  deactivateSkill,
};
