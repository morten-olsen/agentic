import type { ActiveSkill } from '../../agent/skills/skills.schemas.ts';

import type { OrchestratorState } from './orchestrator.state.ts';
import type { Interrupt } from './interrupts/interrupts.ts';

/**
 * Strategy for resuming graph execution after an interrupt.
 *
 * Each strategy defines:
 * - prepareStateUpdate: State changes to apply when resuming
 * - modifyActiveSkills: Optional transformation of active skills
 */
type ResumeStrategy = {
  /** Prepares state updates for resuming the graph */
  prepareStateUpdate: (interrupt: Interrupt, currentState: OrchestratorState) => Partial<OrchestratorState>;
  /** Optional: Modifies active skills before resuming (e.g., for skill activation) */
  modifyActiveSkills?: (activeSkills: ActiveSkill[], interrupt: Interrupt) => ActiveSkill[];
};

/**
 * Strategy for resuming after tool approval.
 *
 * Adds the approved tool call to the approved list and clears the pending state.
 */
const approvalStrategy: ResumeStrategy = {
  prepareStateUpdate: (interrupt, currentState) => {
    if (!interrupt.toolCall) {
      return {
        interruptRequired: false,
        pendingToolCall: null,
      };
    }

    const approvedToolCall = {
      id: interrupt.toolCall.toolId,
      name: interrupt.toolCall.toolName,
      args: interrupt.toolCall.input as Record<string, unknown>,
    };

    // Merge with existing approved calls
    const existingApproved = currentState.approvedToolCalls ?? [];

    return {
      approvedToolCalls: [...existingApproved, approvedToolCall],
      interruptRequired: false,
      pendingToolCall: null,
    };
  },
};

/**
 * Strategy for resuming after turn limit continuation.
 *
 * Resets the turn counter to allow more turns.
 */
const turnLimitStrategy: ResumeStrategy = {
  prepareStateUpdate: () => ({
    turnCount: 0,
    turnLimitReached: false,
    interruptRequired: false,
  }),
};

/**
 * Strategy for resuming after skill activation approval.
 *
 * Activates the skill and adds it to active skills.
 */
const skillActivationStrategy: ResumeStrategy = {
  prepareStateUpdate: () => ({
    interruptRequired: false,
    pendingSkillActivation: null,
  }),

  modifyActiveSkills: (activeSkills, interrupt) => {
    if (!interrupt.skillActivation) {
      return activeSkills;
    }

    // Prevent duplicate activation
    const skillId = interrupt.skillActivation.skillId;
    if (activeSkills.some((s) => s.id === skillId)) {
      return activeSkills;
    }

    const newActiveSkill: ActiveSkill = {
      id: interrupt.skillActivation.skillId,
      activatedAt: new Date().toISOString(),
      activationParams: interrupt.skillActivation.activationParams,
    };

    return [...activeSkills, newActiveSkill];
  },
};

/**
 * Gets the appropriate resume strategy for an interrupt type.
 */
const getResumeStrategy = (interruptType: Interrupt['type']): ResumeStrategy | null => {
  switch (interruptType) {
    case 'tool_approval':
      return approvalStrategy;
    case 'turn_limit':
      return turnLimitStrategy;
    case 'skill_activation':
      return skillActivationStrategy;
    default:
      return null;
  }
};

export type { ResumeStrategy };
export { approvalStrategy, turnLimitStrategy, skillActivationStrategy, getResumeStrategy };
