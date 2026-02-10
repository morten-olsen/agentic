import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import type { RegisteredTool } from '../../agent/tools/tools.types.ts';
import type { RiskProfile, DynamicRiskProfile } from '../../agent/tools/tools.schemas.ts';

import {
  zodSchemaToJsonSchema,
  getEffectiveRiskProfile,
  isToolExposedViaApi,
  toolToApiInfo,
  filterByCategory,
  filterByTag,
  filterExposedTools,
} from './tool-adapter.ts';

// ============================================================================
// Test Helpers
// ============================================================================

const createMockTool = (overrides?: Partial<RegisteredTool>): RegisteredTool => ({
  id: 'test.tool',
  name: 'TestTool',
  description: 'A test tool',
  category: 'test',
  inputSchema: z.object({ input: z.string() }),
  outputSchema: z.object({ output: z.string() }),
  risk: {
    level: 'low',
    reason: 'Test tool',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  execute: async () => ({ output: 'result' }),
  tags: ['test', 'mock'],
  examples: [{ input: { input: 'test' }, description: 'Test example' }],
  registeredAt: new Date(),
  ...overrides,
});

const createDynamicRiskTool = (defaultLevel: RiskProfile['level']): RegisteredTool => {
  const dynamicRisk: DynamicRiskProfile = {
    evaluator: async () => ({
      level: 'low',
      reason: 'Evaluated',
      potentialImpact: 'None',
      reversible: true,
      categories: [],
    }),
    defaultProfile: {
      level: defaultLevel,
      reason: 'Default',
      potentialImpact: 'Default impact',
      reversible: true,
      categories: [],
    },
  };

  return createMockTool({
    id: 'test.dynamic',
    risk: dynamicRisk,
  });
};

// ============================================================================
// zodSchemaToJsonSchema Tests
// ============================================================================

describe('zodSchemaToJsonSchema', () => {
  it('converts simple object schema', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const jsonSchema = zodSchemaToJsonSchema(schema, 'TestSchema');

    expect(jsonSchema.type).toBe('object');
    expect(jsonSchema.properties).toBeDefined();
  });

  it('converts schema with optional fields', () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
    });

    const jsonSchema = zodSchemaToJsonSchema(schema, 'OptionalSchema');

    expect(jsonSchema.type).toBe('object');
    expect((jsonSchema.required as string[]).includes('required')).toBe(true);
  });

  it('handles arrays', () => {
    const schema = z.object({
      items: z.array(z.string()),
    });

    const jsonSchema = zodSchemaToJsonSchema(schema, 'ArraySchema');

    expect(jsonSchema.type).toBe('object');
  });

  it('returns fallback for invalid schema', () => {
    const jsonSchema = zodSchemaToJsonSchema(null, 'InvalidSchema');

    expect(jsonSchema.type).toBe('object');
    expect(jsonSchema.description).toContain('InvalidSchema');
  });
});

// ============================================================================
// getEffectiveRiskProfile Tests
// ============================================================================

describe('getEffectiveRiskProfile', () => {
  it('returns static risk profile directly', () => {
    const tool = createMockTool({
      risk: {
        level: 'medium',
        reason: 'Static risk',
        potentialImpact: 'Some impact',
        reversible: false,
        categories: ['data_modification'],
      },
    });

    const risk = getEffectiveRiskProfile(tool);

    expect(risk.level).toBe('medium');
    expect(risk.reason).toBe('Static risk');
  });

  it('returns defaultProfile for dynamic risk', () => {
    const tool = createDynamicRiskTool('high');

    const risk = getEffectiveRiskProfile(tool);

    expect(risk.level).toBe('high');
    expect(risk.reason).toBe('Default');
  });
});

// ============================================================================
// isToolExposedViaApi Tests
// ============================================================================

describe('isToolExposedViaApi', () => {
  it('returns true for low risk tools', () => {
    const tool = createMockTool({
      risk: { level: 'low', reason: '', potentialImpact: '', reversible: true, categories: [] },
    });

    expect(isToolExposedViaApi(tool)).toBe(true);
  });

  it('returns true for medium risk tools', () => {
    const tool = createMockTool({
      risk: { level: 'medium', reason: '', potentialImpact: '', reversible: true, categories: [] },
    });

    expect(isToolExposedViaApi(tool)).toBe(true);
  });

  it('returns false for high risk tools', () => {
    const tool = createMockTool({
      risk: { level: 'high', reason: '', potentialImpact: '', reversible: true, categories: [] },
    });

    expect(isToolExposedViaApi(tool)).toBe(false);
  });

  it('returns false for critical risk tools', () => {
    const tool = createMockTool({
      risk: { level: 'critical', reason: '', potentialImpact: '', reversible: true, categories: [] },
    });

    expect(isToolExposedViaApi(tool)).toBe(false);
  });

  it('uses defaultProfile level for dynamic risk', () => {
    const lowTool = createDynamicRiskTool('low');
    const highTool = createDynamicRiskTool('high');

    expect(isToolExposedViaApi(lowTool)).toBe(true);
    expect(isToolExposedViaApi(highTool)).toBe(false);
  });
});

// ============================================================================
// toolToApiInfo Tests
// ============================================================================

describe('toolToApiInfo', () => {
  it('converts tool to API info format', () => {
    const tool = createMockTool();

    const info = toolToApiInfo(tool);

    expect(info.id).toBe('test.tool');
    expect(info.name).toBe('TestTool');
    expect(info.description).toBe('A test tool');
    expect(info.category).toBe('test');
    expect(info.tags).toEqual(['test', 'mock']);
    expect(info.inputSchema).toBeDefined();
    expect(info.outputSchema).toBeDefined();
    expect(info.risk.level).toBe('low');
    expect(info.examples).toHaveLength(1);
  });

  it('converts examples correctly', () => {
    const tool = createMockTool({
      examples: [
        { input: { input: 'test1' }, description: 'Example 1' },
        { input: { input: 'test2' }, description: 'Example 2' },
      ],
    });

    const info = toolToApiInfo(tool);

    expect(info.examples).toHaveLength(2);
    expect(info.examples[0].description).toBe('Example 1');
    expect(info.examples[1].description).toBe('Example 2');
  });

  it('includes requiredServices when present', () => {
    const tool = createMockTool({
      requiredServices: ['homeassistant', 'oura'],
    });

    const info = toolToApiInfo(tool);

    expect(info.requiredServices).toEqual(['homeassistant', 'oura']);
  });
});

// ============================================================================
// Filter Function Tests
// ============================================================================

describe('filterByCategory', () => {
  it('filters tools by category', () => {
    const tools = [
      createMockTool({ id: 'a', category: 'calendar' }),
      createMockTool({ id: 'b', category: 'email' }),
      createMockTool({ id: 'c', category: 'calendar' }),
    ];

    const filtered = filterByCategory(tools, 'calendar');

    expect(filtered).toHaveLength(2);
    expect(filtered.every((t) => t.category === 'calendar')).toBe(true);
  });

  it('returns empty array when no matches', () => {
    const tools = [createMockTool({ category: 'calendar' })];

    const filtered = filterByCategory(tools, 'email');

    expect(filtered).toHaveLength(0);
  });
});

describe('filterByTag', () => {
  it('filters tools by tag', () => {
    const tools = [
      createMockTool({ id: 'a', tags: ['read', 'calendar'] }),
      createMockTool({ id: 'b', tags: ['write', 'email'] }),
      createMockTool({ id: 'c', tags: ['read', 'email'] }),
    ];

    const filtered = filterByTag(tools, 'read');

    expect(filtered).toHaveLength(2);
    expect(filtered.every((t) => t.tags.includes('read'))).toBe(true);
  });

  it('returns empty array when no matches', () => {
    const tools = [createMockTool({ tags: ['calendar'] })];

    const filtered = filterByTag(tools, 'email');

    expect(filtered).toHaveLength(0);
  });
});

describe('filterExposedTools', () => {
  it('filters out high and critical risk tools', () => {
    const tools = [
      createMockTool({
        id: 'low',
        risk: { level: 'low', reason: '', potentialImpact: '', reversible: true, categories: [] },
      }),
      createMockTool({
        id: 'medium',
        risk: { level: 'medium', reason: '', potentialImpact: '', reversible: true, categories: [] },
      }),
      createMockTool({
        id: 'high',
        risk: { level: 'high', reason: '', potentialImpact: '', reversible: true, categories: [] },
      }),
      createMockTool({
        id: 'critical',
        risk: { level: 'critical', reason: '', potentialImpact: '', reversible: true, categories: [] },
      }),
    ];

    const filtered = filterExposedTools(tools);

    expect(filtered).toHaveLength(2);
    expect(filtered.map((t) => t.id)).toEqual(['low', 'medium']);
  });
});
