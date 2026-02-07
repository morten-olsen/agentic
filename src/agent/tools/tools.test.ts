import { describe, it, beforeEach, expect } from 'vitest';
import { z } from 'zod';

import { Services } from '../../core/services/services.ts';

import { ToolRegistry, ToolNotFoundError, ToolAlreadyRegisteredError, ToolInputValidationError } from './tools.ts';
import type { ToolDefinition, ToolContext, ToolExecutionEvent } from './tools.ts';
import { registerBuiltinTools, echoTool } from './builtin/builtin.ts';

const createTestTool = (id: string): ToolDefinition<{ value: string }, { result: string }> => ({
  id,
  name: `Test Tool ${id}`,
  description: `A test tool with id ${id}`,
  category: 'test',
  inputSchema: z.object({ value: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  risk: {
    level: 'low',
    reason: 'Test tool',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['test'],
  examples: [],
  execute: async (input) => ({ result: input.value.toUpperCase() }),
});

const createContext = (services: Services): ToolContext => ({
  userId: 'test-user',
  conversationId: 'test-conversation',
  services,
});

describe('ToolRegistry', () => {
  let services: Services;
  let registry: ToolRegistry;

  beforeEach(() => {
    services = new Services();
    registry = new ToolRegistry(services);
  });

  describe('register', () => {
    it('registers a tool', () => {
      const tool = createTestTool('test-1');
      registry.register(tool);

      expect(registry.has('test-1')).toBe(true);
      expect(registry.size).toBe(1);
    });

    it('throws when registering a duplicate tool', () => {
      const tool = createTestTool('test-1');
      registry.register(tool);

      expect(() => registry.register(tool)).toThrow(ToolAlreadyRegisteredError);
    });
  });

  describe('get', () => {
    it('returns undefined for unknown tool', () => {
      expect(registry.get('unknown')).toBeUndefined();
    });

    it('returns registered tool', () => {
      const tool = createTestTool('test-1');
      registry.register(tool);

      const retrieved = registry.get('test-1');
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe('test-1');
      expect(retrieved?.registeredAt).toBeInstanceOf(Date);
    });
  });

  describe('getOrThrow', () => {
    it('throws for unknown tool', () => {
      expect(() => registry.getOrThrow('unknown')).toThrow(ToolNotFoundError);
    });

    it('returns registered tool', () => {
      const tool = createTestTool('test-1');
      registry.register(tool);

      const retrieved = registry.getOrThrow('test-1');
      expect(retrieved.id).toBe('test-1');
    });
  });

  describe('getAll', () => {
    it('returns empty array when no tools registered', () => {
      expect(registry.getAll()).toEqual([]);
    });

    it('returns all registered tools', () => {
      registry.register(createTestTool('test-1'));
      registry.register(createTestTool('test-2'));

      const all = registry.getAll();
      expect(all).toHaveLength(2);
    });
  });

  describe('getByCategory', () => {
    it('filters by category', () => {
      const tool1 = createTestTool('test-1');
      const tool2: ToolDefinition<{ value: string }, { result: string }> = {
        ...createTestTool('test-2'),
        category: 'other',
      };

      registry.register(tool1);
      registry.register(tool2);

      const testTools = registry.getByCategory('test');
      expect(testTools).toHaveLength(1);
      expect(testTools[0]?.id).toBe('test-1');
    });
  });

  describe('getByTag', () => {
    it('filters by tag', () => {
      const tool1 = createTestTool('test-1');
      const tool2: ToolDefinition<{ value: string }, { result: string }> = {
        ...createTestTool('test-2'),
        tags: ['other'],
      };

      registry.register(tool1);
      registry.register(tool2);

      const testTools = registry.getByTag('test');
      expect(testTools).toHaveLength(1);
      expect(testTools[0]?.id).toBe('test-1');
    });
  });

  describe('unregister', () => {
    it('removes a registered tool', () => {
      registry.register(createTestTool('test-1'));
      expect(registry.has('test-1')).toBe(true);

      const removed = registry.unregister('test-1');
      expect(removed).toBe(true);
      expect(registry.has('test-1')).toBe(false);
    });

    it('returns false for unknown tool', () => {
      expect(registry.unregister('unknown')).toBe(false);
    });
  });

  describe('execute', () => {
    it('executes a tool and returns result', async () => {
      const tool = createTestTool('test-1');
      registry.register(tool);

      const result = await registry.execute('test-1', { value: 'hello' }, createContext(services));
      expect(result).toEqual({ result: 'HELLO' });
    });

    it('throws for unknown tool', async () => {
      await expect(registry.execute('unknown', {}, createContext(services))).rejects.toThrow(ToolNotFoundError);
    });

    it('validates input', async () => {
      const tool = createTestTool('test-1');
      registry.register(tool);

      await expect(registry.execute('test-1', { value: 123 }, createContext(services))).rejects.toThrow(
        ToolInputValidationError,
      );
    });

    it('emits execution events', async () => {
      const tool = createTestTool('test-1');
      registry.register(tool);

      const events: ToolExecutionEvent[] = [];
      registry.onExecution((event) => events.push(event));

      await registry.execute('test-1', { value: 'hello' }, createContext(services));

      // Should emit pending and success events
      expect(events).toHaveLength(2);
      expect(events[0]?.status).toBe('pending');
      expect(events[1]?.status).toBe('success');
      expect(events[1]?.output).toEqual({ result: 'HELLO' });
    });

    it('emits error event on failure', async () => {
      const tool = createTestTool('test-1');
      registry.register(tool);

      const events: ToolExecutionEvent[] = [];
      registry.onExecution((event) => events.push(event));

      await expect(registry.execute('test-1', { value: 123 }, createContext(services))).rejects.toThrow();

      // Should emit pending and error events
      expect(events).toHaveLength(2);
      expect(events[0]?.status).toBe('pending');
      expect(events[1]?.status).toBe('error');
    });
  });

  describe('onExecution', () => {
    it('returns unsubscribe function', async () => {
      const tool = createTestTool('test-1');
      registry.register(tool);

      const events: ToolExecutionEvent[] = [];
      const unsubscribe = registry.onExecution((event) => events.push(event));

      await registry.execute('test-1', { value: 'first' }, createContext(services));
      expect(events).toHaveLength(2);

      unsubscribe();
      await registry.execute('test-1', { value: 'second' }, createContext(services));
      expect(events).toHaveLength(2); // No new events
    });
  });

  describe('clear', () => {
    it('removes all tools', () => {
      registry.register(createTestTool('test-1'));
      registry.register(createTestTool('test-2'));
      expect(registry.size).toBe(2);

      registry.clear();
      expect(registry.size).toBe(0);
    });
  });
});

describe('registerBuiltinTools', () => {
  it('registers echo tool', () => {
    const services = new Services();
    const registry = new ToolRegistry(services);

    registerBuiltinTools(registry);

    expect(registry.has('builtin.echo')).toBe(true);
  });
});

describe('echoTool', () => {
  const services = new Services();

  it('echoes message', async () => {
    const result = await echoTool.execute({ message: 'Hello!' }, createContext(services));
    expect(result.echoed).toBe('Hello!');
    expect(result.timestamp).toBeDefined();
  });

  it('converts to uppercase when requested', async () => {
    const result = await echoTool.execute({ message: 'Hello!', uppercase: true }, createContext(services));
    expect(result.echoed).toBe('HELLO!');
  });
});
