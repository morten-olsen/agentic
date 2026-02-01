import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { z } from 'zod';

import { Services } from '../../services/services.ts';
import { createDatabaseService, DatabaseService } from '../../database/database.ts';
import { ToolRegistry } from '../../tools/tools.ts';
import type { ToolDefinition, ToolContext } from '../../tools/tools.ts';
import { evaluateRiskGate } from '../orchestrator.risk-gate.ts';

import {
  InterruptService,
  InterruptNotFoundError,
  InterruptNotPendingError,
  InterruptSignal,
  isInterruptSignal,
} from './interrupts.ts';
import type { CreateInterruptInput, InterruptResponse } from './interrupts.ts';

describe('InterruptService', () => {
  let services: Services;
  let interruptService: InterruptService;
  let conversationId: string;

  beforeEach(async () => {
    services = new Services();
    const db = createDatabaseService(services, { path: ':memory:' });
    services.set(DatabaseService, db);
    await db.migrate();

    // Create a test conversation
    const now = new Date().toISOString();
    conversationId = 'test-conversation-' + Date.now();
    await db.knex('conversations').insert({
      id: conversationId,
      title: 'Test Conversation',
      started_at: now,
      last_activity_at: now,
      message_count: 0,
      created_at: now,
      updated_at: now,
    });

    interruptService = new InterruptService(services);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('create', () => {
    it('creates a tool approval interrupt', async () => {
      const input: CreateInterruptInput = {
        conversationId,
        type: 'tool_approval',
        prompt: 'I need to execute a dangerous operation',
        toolCall: {
          toolId: 'tool-123',
          toolName: 'DangerousTool',
          input: { target: 'production' },
          riskLevel: 'high',
          riskReason: 'Modifies production data',
        },
      };

      const interrupt = await interruptService.create(input);

      expect(interrupt.id).toBeDefined();
      expect(interrupt.conversationId).toBe(conversationId);
      expect(interrupt.type).toBe('tool_approval');
      expect(interrupt.prompt).toBe('I need to execute a dangerous operation');
      expect(interrupt.status).toBe('pending');
      expect(interrupt.toolCall).toBeDefined();
      expect(interrupt.toolCall?.toolName).toBe('DangerousTool');
      expect(interrupt.toolCall?.riskLevel).toBe('high');
      expect(interrupt.createdAt).toBeDefined();
    });

    it('creates a question interrupt with options', async () => {
      const input: CreateInterruptInput = {
        conversationId,
        type: 'question',
        prompt: 'Which database should we use?',
        options: [
          { id: 'postgres', label: 'PostgreSQL', isRecommended: true },
          { id: 'mysql', label: 'MySQL' },
        ],
        allowFreeform: false,
      };

      const interrupt = await interruptService.create(input);

      expect(interrupt.type).toBe('question');
      expect(interrupt.options).toHaveLength(2);
      expect(interrupt.options?.[0]?.isRecommended).toBe(true);
      expect(interrupt.allowFreeform).toBe(false);
    });

    it('defaults allowFreeform to true', async () => {
      const input: CreateInterruptInput = {
        conversationId,
        type: 'confirmation',
        prompt: 'Are you sure?',
      };

      const interrupt = await interruptService.create(input);

      expect(interrupt.allowFreeform).toBe(true);
    });
  });

  describe('get', () => {
    it('returns null for unknown interrupt', async () => {
      const result = await interruptService.get('unknown-id');
      expect(result).toBeNull();
    });

    it('returns interrupt by ID', async () => {
      const created = await interruptService.create({
        conversationId,
        type: 'question',
        prompt: 'Test question',
      });

      const retrieved = await interruptService.get(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.prompt).toBe('Test question');
    });
  });

  describe('getPending', () => {
    it('returns null when no pending interrupt', async () => {
      const result = await interruptService.getPending(conversationId);
      expect(result).toBeNull();
    });

    it('returns pending interrupt for conversation', async () => {
      const created = await interruptService.create({
        conversationId,
        type: 'tool_approval',
        prompt: 'Approve this?',
      });

      const pending = await interruptService.getPending(conversationId);

      expect(pending).not.toBeNull();
      expect(pending?.id).toBe(created.id);
      expect(pending?.status).toBe('pending');
    });

    it('returns most recent pending interrupt', async () => {
      await interruptService.create({
        conversationId,
        type: 'question',
        prompt: 'First question',
      });

      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      const second = await interruptService.create({
        conversationId,
        type: 'question',
        prompt: 'Second question',
      });

      const pending = await interruptService.getPending(conversationId);

      expect(pending?.id).toBe(second.id);
      expect(pending?.prompt).toBe('Second question');
    });
  });

  describe('respond', () => {
    it('throws for unknown interrupt', async () => {
      await expect(interruptService.respond('unknown-id', { approved: true })).rejects.toThrow(InterruptNotFoundError);
    });

    it('throws for non-pending interrupt', async () => {
      const created = await interruptService.create({
        conversationId,
        type: 'tool_approval',
        prompt: 'Approve?',
      });

      // Respond once
      await interruptService.respond(created.id, { approved: true });

      // Try to respond again
      await expect(interruptService.respond(created.id, { approved: false })).rejects.toThrow(InterruptNotPendingError);
    });

    it('records approval response', async () => {
      const created = await interruptService.create({
        conversationId,
        type: 'tool_approval',
        prompt: 'Approve?',
      });

      const resolved = await interruptService.respond(created.id, { approved: true });

      expect(resolved.status).toBe('approved');
      expect(resolved.response?.approved).toBe(true);
      expect(resolved.respondedAt).toBeDefined();
    });

    it('records denial response', async () => {
      const created = await interruptService.create({
        conversationId,
        type: 'tool_approval',
        prompt: 'Approve?',
      });

      const resolved = await interruptService.respond(created.id, { approved: false });

      expect(resolved.status).toBe('denied');
      expect(resolved.response?.approved).toBe(false);
    });

    it('records option selection', async () => {
      const created = await interruptService.create({
        conversationId,
        type: 'question',
        prompt: 'Choose one',
        options: [
          { id: 'a', label: 'Option A' },
          { id: 'b', label: 'Option B' },
        ],
      });

      const response: InterruptResponse = { selectedOptionId: 'b' };
      const resolved = await interruptService.respond(created.id, response);

      expect(resolved.status).toBe('approved');
      expect(resolved.response?.selectedOptionId).toBe('b');
    });

    it('records freeform response', async () => {
      const created = await interruptService.create({
        conversationId,
        type: 'question',
        prompt: 'What is your name?',
      });

      const response: InterruptResponse = { freeformResponse: 'GLaDOS' };
      const resolved = await interruptService.respond(created.id, response);

      expect(resolved.response?.freeformResponse).toBe('GLaDOS');
    });
  });

  describe('expire', () => {
    it('throws for unknown interrupt', async () => {
      await expect(interruptService.expire('unknown-id')).rejects.toThrow(InterruptNotFoundError);
    });

    it('marks interrupt as expired', async () => {
      const created = await interruptService.create({
        conversationId,
        type: 'tool_approval',
        prompt: 'Approve?',
      });

      await interruptService.expire(created.id);

      const expired = await interruptService.get(created.id);
      expect(expired?.status).toBe('expired');
    });
  });

  describe('getExpired', () => {
    it('returns empty array when no expired interrupts', async () => {
      const expired = await interruptService.getExpired();
      expect(expired).toEqual([]);
    });

    it('returns interrupts past expiration', async () => {
      // Create an interrupt with expiration in the past
      const pastDate = new Date(Date.now() - 1000).toISOString();
      await interruptService.create({
        conversationId,
        type: 'tool_approval',
        prompt: 'Approve?',
        expiresAt: pastDate,
      });

      const expired = await interruptService.getExpired();
      expect(expired).toHaveLength(1);
    });

    it('does not return non-expired interrupts', async () => {
      const futureDate = new Date(Date.now() + 60000).toISOString();
      await interruptService.create({
        conversationId,
        type: 'tool_approval',
        prompt: 'Approve?',
        expiresAt: futureDate,
      });

      const expired = await interruptService.getExpired();
      expect(expired).toHaveLength(0);
    });
  });

  describe('list', () => {
    it('lists interrupts for conversation', async () => {
      await interruptService.create({
        conversationId,
        type: 'question',
        prompt: 'First',
      });
      await interruptService.create({
        conversationId,
        type: 'question',
        prompt: 'Second',
      });

      const list = await interruptService.list(conversationId);
      expect(list).toHaveLength(2);
    });

    it('filters by status', async () => {
      const created = await interruptService.create({
        conversationId,
        type: 'question',
        prompt: 'First',
      });
      await interruptService.create({
        conversationId,
        type: 'question',
        prompt: 'Second',
      });

      await interruptService.respond(created.id, { freeformResponse: 'done' });

      const pending = await interruptService.list(conversationId, { status: 'pending' });
      expect(pending).toHaveLength(1);
      expect(pending[0]?.prompt).toBe('Second');
    });

    it('limits results', async () => {
      await interruptService.create({ conversationId, type: 'question', prompt: 'First' });
      await interruptService.create({ conversationId, type: 'question', prompt: 'Second' });
      await interruptService.create({ conversationId, type: 'question', prompt: 'Third' });

      const list = await interruptService.list(conversationId, { limit: 2 });
      expect(list).toHaveLength(2);
    });
  });

  describe('delete', () => {
    it('returns false for unknown interrupt', async () => {
      const result = await interruptService.delete('unknown-id');
      expect(result).toBe(false);
    });

    it('deletes interrupt', async () => {
      const created = await interruptService.create({
        conversationId,
        type: 'question',
        prompt: 'Test',
      });

      const deleted = await interruptService.delete(created.id);
      expect(deleted).toBe(true);

      const retrieved = await interruptService.get(created.id);
      expect(retrieved).toBeNull();
    });
  });
});

describe('InterruptSignal', () => {
  it('creates signal with required fields', () => {
    const signal = new InterruptSignal({
      type: 'question',
      prompt: 'What is your name?',
    });

    expect(signal.name).toBe('InterruptSignal');
    expect(signal.type).toBe('question');
    expect(signal.prompt).toBe('What is your name?');
    expect(signal.allowFreeform).toBe(true);
    expect(signal.message).toContain('What is your name?');
  });

  it('creates signal with options', () => {
    const signal = new InterruptSignal({
      type: 'question',
      prompt: 'Choose one',
      options: [
        { id: 'a', label: 'Option A' },
        { id: 'b', label: 'Option B', isRecommended: true },
      ],
      allowFreeform: false,
    });

    expect(signal.options).toHaveLength(2);
    expect(signal.options?.[1]?.isRecommended).toBe(true);
    expect(signal.allowFreeform).toBe(false);
  });

  it('is identified by isInterruptSignal', () => {
    const signal = new InterruptSignal({
      type: 'confirmation',
      prompt: 'Proceed?',
    });

    expect(isInterruptSignal(signal)).toBe(true);
    expect(isInterruptSignal(new Error('regular error'))).toBe(false);
    expect(isInterruptSignal('not an error')).toBe(false);
  });
});

describe('evaluateRiskGate', () => {
  let services: Services;
  let registry: ToolRegistry;

  const createToolWithRisk = (
    id: string,
    name: string,
    riskLevel: 'low' | 'medium' | 'high' | 'critical',
  ): ToolDefinition<{ value: string }, { result: string }> => ({
    id,
    name,
    description: `Tool with ${riskLevel} risk`,
    category: 'test',
    inputSchema: z.object({ value: z.string() }),
    outputSchema: z.object({ result: z.string() }),
    risk: {
      level: riskLevel,
      reason: `This is a ${riskLevel} risk operation`,
      potentialImpact: 'Test impact',
      reversible: riskLevel === 'low',
      categories: [],
    },
    tags: [],
    examples: [],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    execute: async (input: { value: string }, _context: ToolContext) => ({ result: input.value }),
  });

  beforeEach(() => {
    services = new Services();
    registry = new ToolRegistry(services);
  });

  it('allows low-risk tools to pass through', () => {
    // Note: In LangChain, tool call name = tool id (not display name)
    registry.register(createToolWithRisk('low-1', 'LowRiskTool', 'low'));

    const result = evaluateRiskGate([{ id: 'call-1', name: 'low-1', args: { value: 'test' } }], registry);

    expect(result.approvedToolCalls).toHaveLength(1);
    expect(result.pendingToolCall).toBeNull();
    expect(result.interruptRequired).toBe(false);
  });

  it('requires approval for medium-risk tools', () => {
    registry.register(createToolWithRisk('med-1', 'MediumRiskTool', 'medium'));

    const result = evaluateRiskGate([{ id: 'call-1', name: 'med-1', args: { value: 'test' } }], registry);

    expect(result.approvedToolCalls).toHaveLength(0);
    expect(result.pendingToolCall).not.toBeNull();
    expect(result.pendingToolCall?.riskLevel).toBe('medium');
    expect(result.interruptRequired).toBe(true);
  });

  it('requires approval for high-risk tools', () => {
    registry.register(createToolWithRisk('high-1', 'HighRiskTool', 'high'));

    const result = evaluateRiskGate([{ id: 'call-1', name: 'high-1', args: { value: 'test' } }], registry);

    expect(result.pendingToolCall?.riskLevel).toBe('high');
    expect(result.interruptRequired).toBe(true);
  });

  it('requires approval for critical-risk tools', () => {
    registry.register(createToolWithRisk('crit-1', 'CriticalTool', 'critical'));

    const result = evaluateRiskGate([{ id: 'call-1', name: 'crit-1', args: { value: 'test' } }], registry);

    expect(result.pendingToolCall?.riskLevel).toBe('critical');
    expect(result.interruptRequired).toBe(true);
  });

  it('handles mixed risk levels', () => {
    registry.register(createToolWithRisk('low-1', 'LowRiskTool', 'low'));
    registry.register(createToolWithRisk('high-1', 'HighRiskTool', 'high'));

    const result = evaluateRiskGate(
      [
        { id: 'call-1', name: 'low-1', args: { value: 'test' } },
        { id: 'call-2', name: 'high-1', args: { value: 'test' } },
      ],
      registry,
    );

    expect(result.approvedToolCalls).toHaveLength(1);
    expect(result.approvedToolCalls[0]?.name).toBe('low-1');
    expect(result.pendingToolCall?.name).toBe('high-1');
    expect(result.interruptRequired).toBe(true);
  });

  it('treats unknown tools as high risk', () => {
    const result = evaluateRiskGate([{ id: 'call-1', name: 'UnknownTool', args: { value: 'test' } }], registry);

    expect(result.pendingToolCall?.name).toBe('UnknownTool');
    expect(result.pendingToolCall?.riskLevel).toBe('high');
    expect(result.interruptRequired).toBe(true);
  });

  it('only flags the first high-risk tool', () => {
    registry.register(createToolWithRisk('high-1', 'HighRisk1', 'high'));
    registry.register(createToolWithRisk('high-2', 'HighRisk2', 'high'));

    const result = evaluateRiskGate(
      [
        { id: 'call-1', name: 'high-1', args: { value: 'test' } },
        { id: 'call-2', name: 'high-2', args: { value: 'test' } },
      ],
      registry,
    );

    // Only the first should be pending
    expect(result.pendingToolCall?.name).toBe('high-1');
    // The second is not in approved (since it requires approval too)
    expect(result.approvedToolCalls).toHaveLength(0);
  });

  it('respects custom approval levels', () => {
    registry.register(createToolWithRisk('med-1', 'MediumRiskTool', 'medium'));

    // Only require approval for high and critical
    const result = evaluateRiskGate([{ id: 'call-1', name: 'med-1', args: { value: 'test' } }], registry, [
      'high',
      'critical',
    ]);

    // Medium should pass through with this config
    expect(result.approvedToolCalls).toHaveLength(1);
    expect(result.interruptRequired).toBe(false);
  });
});
