import { describe, it, expect } from 'vitest';

import type { ActiveSkill } from '../../agent/skills/skills.schemas.ts';

import type { OrchestratorState } from './orchestrator.state.ts';
import type { Interrupt } from './interrupts/interrupts.ts';
import {
  approvalStrategy,
  turnLimitStrategy,
  skillActivationStrategy,
  getResumeStrategy,
} from './orchestrator.resume.ts';

// ============================================================================
// Test Setup
// ============================================================================

const createMockState = (overrides: Partial<OrchestratorState> = {}): OrchestratorState =>
  ({
    messages: [],
    conversationId: 'test-conversation',
    activeToolSets: [],
    currentTaskId: null,
    pendingToolCall: null,
    approvedToolCalls: [],
    interruptRequired: false,
    currentInterrupt: null,
    memoryContext: [],
    turnCount: 0,
    maxTurns: 20,
    turnLimitReached: false,
    activeSkills: [],
    pendingSkillActivation: null,
    ...overrides,
  }) as OrchestratorState;

const createMockInterrupt = (overrides: Partial<Interrupt> = {}): Interrupt => ({
  id: 'interrupt-123',
  conversationId: 'test-conversation',
  type: 'tool_approval',
  status: 'approved',
  prompt: 'Approve this tool?',
  allowFreeform: true,
  checkpointId: 'checkpoint-123',
  createdAt: new Date().toISOString(),
  ...overrides,
});

describe('ResumeStrategies', () => {
  describe('approvalStrategy', () => {
    it('adds approved tool call to state', () => {
      const state = createMockState();
      const interrupt = createMockInterrupt({
        type: 'tool_approval',
        toolCall: {
          toolId: 'call_123',
          toolName: 'test_tool',
          input: { param: 'value' },
          riskLevel: 'medium',
          riskReason: 'Test reason',
        },
      });

      const result = approvalStrategy.prepareStateUpdate(interrupt, state);

      expect(result.approvedToolCalls).toHaveLength(1);
      expect(result.approvedToolCalls?.[0]).toEqual({
        id: 'call_123',
        name: 'test_tool',
        args: { param: 'value' },
      });
      expect(result.interruptRequired).toBe(false);
      expect(result.pendingToolCall).toBeNull();
    });

    it('merges with existing approved tool calls', () => {
      const state = createMockState({
        approvedToolCalls: [{ id: 'existing', name: 'existing_tool', args: {} }],
      });
      const interrupt = createMockInterrupt({
        type: 'tool_approval',
        toolCall: {
          toolId: 'call_123',
          toolName: 'new_tool',
          input: {},
          riskLevel: 'medium',
          riskReason: 'Test',
        },
      });

      const result = approvalStrategy.prepareStateUpdate(interrupt, state);

      expect(result.approvedToolCalls).toHaveLength(2);
      expect(result.approvedToolCalls?.[0].name).toBe('existing_tool');
      expect(result.approvedToolCalls?.[1].name).toBe('new_tool');
    });

    it('handles interrupt without toolCall gracefully', () => {
      const state = createMockState();
      const interrupt = createMockInterrupt({
        type: 'tool_approval',
        toolCall: undefined,
      });

      const result = approvalStrategy.prepareStateUpdate(interrupt, state);

      expect(result.interruptRequired).toBe(false);
      expect(result.pendingToolCall).toBeNull();
      expect(result.approvedToolCalls).toBeUndefined();
    });
  });

  describe('turnLimitStrategy', () => {
    it('resets turn count and clears limit flag', () => {
      const state = createMockState({
        turnCount: 20,
        turnLimitReached: true,
        interruptRequired: true,
      });
      const interrupt = createMockInterrupt({ type: 'turn_limit' });

      const result = turnLimitStrategy.prepareStateUpdate(interrupt, state);

      expect(result.turnCount).toBe(0);
      expect(result.turnLimitReached).toBe(false);
      expect(result.interruptRequired).toBe(false);
    });
  });

  describe('skillActivationStrategy', () => {
    it('clears pending skill activation', () => {
      const state = createMockState({
        pendingSkillActivation: {
          skillId: 'debug',
          activationParams: { verbose: true },
          toolCallId: 'call_123',
        },
        interruptRequired: true,
      });
      const interrupt = createMockInterrupt({
        type: 'skill_activation',
        skillActivation: {
          skillId: 'debug',
          skillName: 'Debug Skill',
          activationRisk: 'high',
          activationReason: 'Provides debugging tools',
          activationParams: { verbose: true },
          toolsSummary: 'debug_tool: Debug helper',
        },
      });

      const result = skillActivationStrategy.prepareStateUpdate(interrupt, state);

      expect(result.interruptRequired).toBe(false);
      expect(result.pendingSkillActivation).toBeNull();
    });

    it('adds new skill to active skills', () => {
      const existingSkills: ActiveSkill[] = [{ id: 'existing', activatedAt: '2024-01-01T00:00:00Z' }];
      const interrupt = createMockInterrupt({
        type: 'skill_activation',
        skillActivation: {
          skillId: 'debug',
          skillName: 'Debug Skill',
          activationRisk: 'high',
          activationReason: 'Provides debugging tools',
          activationParams: { verbose: true },
          toolsSummary: 'debug_tool: Debug helper',
        },
      });

      const result = skillActivationStrategy.modifyActiveSkills?.(existingSkills, interrupt) ?? existingSkills;

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('existing');
      expect(result[1].id).toBe('debug');
      expect(result[1].activationParams).toEqual({ verbose: true });
    });

    it('preserves existing active skills when no skillActivation info', () => {
      const existingSkills: ActiveSkill[] = [{ id: 'existing', activatedAt: '2024-01-01T00:00:00Z' }];
      const interrupt = createMockInterrupt({
        type: 'skill_activation',
        skillActivation: undefined,
      });

      const result = skillActivationStrategy.modifyActiveSkills?.(existingSkills, interrupt) ?? existingSkills;

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('existing');
    });
  });

  describe('getResumeStrategy', () => {
    it('returns approvalStrategy for tool_approval', () => {
      expect(getResumeStrategy('tool_approval')).toBe(approvalStrategy);
    });

    it('returns turnLimitStrategy for turn_limit', () => {
      expect(getResumeStrategy('turn_limit')).toBe(turnLimitStrategy);
    });

    it('returns skillActivationStrategy for skill_activation', () => {
      expect(getResumeStrategy('skill_activation')).toBe(skillActivationStrategy);
    });

    it('returns null for question type', () => {
      expect(getResumeStrategy('question')).toBeNull();
    });
  });
});
