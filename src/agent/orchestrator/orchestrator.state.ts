import { Annotation, MessagesAnnotation } from '@langchain/langgraph';

import type { ActiveSkill, PendingSkillActivation } from '../../agent/skills/skills.schemas.ts';

import type { ToolCall } from './orchestrator.schemas.ts';
import type { PendingToolCall } from './orchestrator.risk-gate.ts';
import type { Interrupt } from './interrupts/interrupts.ts';

/**
 * LangGraph state annotation for the orchestrator.
 *
 * Extends MessagesAnnotation with additional state for:
 * - Conversation tracking
 * - Tool sets (Phase 7)
 * - Task reference (Phase 5)
 * - Interrupts (Phase 3)
 * - Memory context (Phase 4)
 */
const OrchestratorAnnotation = Annotation.Root({
  // Inherit message handling from MessagesAnnotation
  ...MessagesAnnotation.spec,

  // Conversation tracking
  conversationId: Annotation<string>(),

  // Active tool sets - tools currently available to the agent
  // Stub for Phase 7: Tool Sets
  activeToolSets: Annotation<string[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),

  // Current task ID if executing a long-running task
  // Stub for Phase 5: Task Queue
  currentTaskId: Annotation<string | null>({
    reducer: (_, update) => update,
    default: () => null,
  }),

  // Phase 3: Human in the Loop - Pending tool call awaiting approval
  pendingToolCall: Annotation<PendingToolCall | null>({
    reducer: (_, update) => update,
    default: () => null,
  }),

  // Phase 3: Human in the Loop - Tool calls approved for execution
  approvedToolCalls: Annotation<ToolCall[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),

  // Phase 3: Human in the Loop - Flag indicating an interrupt is needed
  interruptRequired: Annotation<boolean>({
    reducer: (_, update) => update,
    default: () => false,
  }),

  // Phase 3: Human in the Loop - Current active interrupt
  currentInterrupt: Annotation<Interrupt | null>({
    reducer: (_, update) => update,
    default: () => null,
  }),

  // Memory context retrieved for this turn
  // Stub for Phase 4: Memory
  memoryContext: Annotation<string[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),

  // Turn tracking - counts graph iterations to prevent runaway loops
  turnCount: Annotation<number>({
    reducer: (_, update) => update,
    default: () => 0,
  }),

  // Maximum turns before asking user to continue (0 = no limit)
  maxTurns: Annotation<number>({
    reducer: (_, update) => update,
    default: () => 20,
  }),

  // Whether a turn limit interrupt is pending
  turnLimitReached: Annotation<boolean>({
    reducer: (_, update) => update,
    default: () => false,
  }),

  // Phase 8: Skills - Currently active skills
  activeSkills: Annotation<ActiveSkill[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),

  // Phase 8: Skills - Pending skill activation awaiting approval
  pendingSkillActivation: Annotation<PendingSkillActivation | null>({
    reducer: (_, update) => update,
    default: () => null,
  }),
});

type OrchestratorState = typeof OrchestratorAnnotation.State;

export type { OrchestratorState };
export { OrchestratorAnnotation };
