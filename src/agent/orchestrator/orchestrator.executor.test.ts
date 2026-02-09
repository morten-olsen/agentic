import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import type { ChatOpenAI } from '@langchain/openai';

import { Services } from '../../core/services/services.ts';
import { DatabaseService, createDatabaseService } from '../../core/database/database.ts';

import { DatabaseCheckpointer } from './orchestrator.checkpointer.ts';
import { GraphExecutor } from './orchestrator.executor.ts';
import type { ExecutionContext, ExecuteInput } from './orchestrator.executor.ts';
import type { ToolLookup } from './orchestrator.tool-collector.ts';

describe('GraphExecutor', () => {
  let services: Services;
  let checkpointer: DatabaseCheckpointer;
  let mockLlm: ChatOpenAI;

  beforeEach(async () => {
    services = new Services();
    const db = createDatabaseService(services, { path: ':memory:' });
    services.set(DatabaseService, db);
    await db.migrate();

    checkpointer = new DatabaseCheckpointer(db.knex);

    // Create a mock LLM that returns a simple response
    mockLlm = {
      bindTools: vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue(new AIMessage({ content: 'Hello!' })),
      }),
    } as unknown as ChatOpenAI;
  });

  afterEach(async () => {
    await services.destroy();
  });

  const createMockContext = (conversationId: string): ExecutionContext => ({
    conversationId,
    systemPrompt: 'You are a helpful assistant.',
    tools: [],
    toolLookup: {
      get: () => undefined,
    } as ToolLookup,
  });

  describe('execute', () => {
    it('executes graph with initial messages', async () => {
      const executor = new GraphExecutor({
        llm: mockLlm,
        checkpointer,
      });

      const context = createMockContext('test-conversation');
      const input: ExecuteInput = {
        messages: [new HumanMessage('Hello')],
      };

      const result = await executor.execute(context, input);

      expect(result.state).toBeDefined();
      expect(result.interrupted).toBe(false);
      expect(result.interruptType).toBeUndefined();
    });

    it('uses provided turn count and max turns', async () => {
      const executor = new GraphExecutor({
        llm: mockLlm,
        checkpointer,
      });

      const context = createMockContext('test-conversation-2');
      const input: ExecuteInput = {
        messages: [new HumanMessage('Hello')],
        turnCount: 5,
        maxTurns: 10,
      };

      const result = await executor.execute(context, input);

      // Turn count should have been incremented from 5
      expect(result.state.turnCount).toBeGreaterThan(5);
    });

    it('detects turn limit interrupt', async () => {
      // Create LLM that keeps calling tools to hit turn limit
      const toolCallingLlm = {
        bindTools: vi.fn().mockReturnValue({
          invoke: vi.fn().mockResolvedValue(
            new AIMessage({
              content: '',
              tool_calls: [{ id: 'call_1', name: 'test_tool', args: {} }],
            }),
          ),
        }),
      } as unknown as ChatOpenAI;

      const executor = new GraphExecutor({
        llm: toolCallingLlm,
        checkpointer,
      });

      const context = createMockContext('turn-limit-test');
      const input: ExecuteInput = {
        messages: [new HumanMessage('Do something')],
        turnCount: 19, // Start near limit
        maxTurns: 20,
      };

      const result = await executor.execute(context, input);

      expect(result.interrupted).toBe(true);
      expect(result.interruptType).toBe('turn_limit');
      expect(result.state.turnLimitReached).toBe(true);
    });

    it('detects tool approval interrupt for medium risk tool', async () => {
      // Create LLM that calls a tool
      const toolCallingLlm = {
        bindTools: vi.fn().mockReturnValue({
          invoke: vi.fn().mockResolvedValue(
            new AIMessage({
              content: '',
              tool_calls: [{ id: 'call_1', name: 'risky_tool', args: {} }],
            }),
          ),
        }),
      } as unknown as ChatOpenAI;

      // Tool lookup that returns a medium-risk tool (minimal mock for risk gate)
      const toolLookup = {
        get: (id: string) => {
          if (id === 'risky_tool') {
            return {
              id: 'risky_tool',
              risk: { level: 'medium' as const, reason: 'Could be dangerous' },
            };
          }
          return undefined;
        },
      } as unknown as ToolLookup;

      const executor = new GraphExecutor({
        llm: toolCallingLlm,
        checkpointer,
      });

      const context: ExecutionContext = {
        conversationId: 'tool-approval-test',
        systemPrompt: 'You are helpful.',
        tools: [],
        toolLookup,
      };

      const input: ExecuteInput = {
        messages: [new HumanMessage('Do something risky')],
      };

      const result = await executor.execute(context, input);

      expect(result.interrupted).toBe(true);
      expect(result.interruptType).toBe('tool_approval');
      expect(result.state.pendingToolCall).toBeDefined();
      expect(result.state.pendingToolCall?.name).toBe('risky_tool');
    });
  });

  describe('resume', () => {
    it('resumes execution with state updates', async () => {
      const executor = new GraphExecutor({
        llm: mockLlm,
        checkpointer,
      });

      // First, execute to create checkpoint
      const context = createMockContext('resume-test');
      await executor.execute(context, {
        messages: [new HumanMessage('Hello')],
      });

      // Then resume with state updates
      const result = await executor.resume(context, {
        stateUpdates: {
          turnCount: 0,
          turnLimitReached: false,
          interruptRequired: false,
        },
      });

      expect(result.state).toBeDefined();
      expect(result.interrupted).toBe(false);
    });

    it('includes activeSkills in resume state', async () => {
      const executor = new GraphExecutor({
        llm: mockLlm,
        checkpointer,
      });

      const context = createMockContext('skills-test');
      await executor.execute(context, {
        messages: [new HumanMessage('Hello')],
      });

      const result = await executor.resume(context, {
        stateUpdates: {
          interruptRequired: false,
        },
        activeSkills: [{ id: 'debug', activatedAt: new Date().toISOString() }],
      });

      expect(result.state).toBeDefined();
      expect(result.state.activeSkills).toContainEqual(expect.objectContaining({ id: 'debug' }));
    });
  });

  describe('getState', () => {
    it('returns null for conversation without checkpoint', async () => {
      const executor = new GraphExecutor({
        llm: mockLlm,
        checkpointer,
      });

      const state = await executor.getState('non-existent');

      // LangGraph returns empty object for non-existent threads
      expect(state === null || Object.keys(state).length === 0).toBe(true);
    });

    it('returns state for conversation with checkpoint', async () => {
      const executor = new GraphExecutor({
        llm: mockLlm,
        checkpointer,
      });

      // Execute to create checkpoint
      const context = createMockContext('state-test');
      await executor.execute(context, {
        messages: [new HumanMessage('Hello')],
      });

      const state = await executor.getState('state-test');

      expect(state).toBeDefined();
      expect(state?.conversationId).toBe('state-test');
    });
  });

  describe('analyzeResult', () => {
    it('identifies normal completion', async () => {
      const executor = new GraphExecutor({
        llm: mockLlm,
        checkpointer,
      });

      const context = createMockContext('normal-completion');
      const result = await executor.execute(context, {
        messages: [new HumanMessage('Hello')],
      });

      expect(result.interrupted).toBe(false);
      expect(result.interruptType).toBeUndefined();
    });
  });
});
