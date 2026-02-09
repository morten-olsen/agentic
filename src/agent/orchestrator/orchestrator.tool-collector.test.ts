import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { z } from 'zod';

import { Services } from '../../core/services/services.ts';
import { DatabaseService, createDatabaseService } from '../../core/database/database.ts';
import { ToolRegistry } from '../../agent/tools/tools.ts';
import type { ToolDefinition } from '../../agent/tools/tools.types.ts';
import { SkillRegistry } from '../../agent/skills/skills.ts';
import type { SkillDefinition, ActiveSkill } from '../../agent/skills/skills.schemas.ts';
import { ExternalServiceRegistry } from '../../integrations/external/external.ts';

import { collectTools, getActiveSkillToolIds, createToolLookup } from './orchestrator.tool-collector.ts';

// ============================================================================
// Test Setup
// ============================================================================

const createTestServices = async (): Promise<Services> => {
  const services = new Services();
  const db = createDatabaseService(services, { path: ':memory:' });
  services.set(DatabaseService, db);
  await db.migrate();
  return services;
};

const createTestTool = (id: string, overrides: Partial<ToolDefinition> = {}): ToolDefinition => ({
  id,
  name: `Tool ${id}`,
  description: `Test tool ${id}`,
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
  tags: ['test'],
  examples: [],
  execute: async () => ({ output: 'test' }),
  ...overrides,
});

const createTestSkill = (id: string, toolIds: string[], overrides: Partial<SkillDefinition> = {}): SkillDefinition => ({
  id,
  name: `Skill ${id}`,
  description: `Test skill ${id}`,
  activationRisk: 'low',
  activationReason: 'Test skill',
  tools: toolIds.map((toolId) => createTestTool(toolId)),
  domainKnowledge: `# ${id} Knowledge`,
  tags: ['test'],
  relatedSkills: [],
  ...overrides,
});

describe('ToolCollector', () => {
  let services: Services;
  let toolRegistry: ToolRegistry;
  let skillRegistry: SkillRegistry;
  let externalServiceRegistry: ExternalServiceRegistry;

  beforeEach(async () => {
    services = await createTestServices();
    toolRegistry = new ToolRegistry(services);
    skillRegistry = new SkillRegistry();
    externalServiceRegistry = new ExternalServiceRegistry(services);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('getActiveSkillToolIds', () => {
    it('returns empty set when no active skills', () => {
      const result = getActiveSkillToolIds(skillRegistry, []);
      expect(result.size).toBe(0);
    });

    it('returns tool IDs from active skills', () => {
      const skill = createTestSkill('debug', ['debug_tool1', 'debug_tool2']);
      skillRegistry.register(skill);

      const activeSkills: ActiveSkill[] = [{ id: 'debug', activatedAt: new Date().toISOString() }];
      const result = getActiveSkillToolIds(skillRegistry, activeSkills);

      expect(result.size).toBe(2);
      expect(result.has('debug_tool1')).toBe(true);
      expect(result.has('debug_tool2')).toBe(true);
    });

    it('aggregates tool IDs from multiple active skills', () => {
      const skill1 = createTestSkill('skill1', ['skill1_tool1']);
      const skill2 = createTestSkill('skill2', ['skill2_tool1', 'skill2_tool2']);
      skillRegistry.register(skill1);
      skillRegistry.register(skill2);

      const activeSkills: ActiveSkill[] = [
        { id: 'skill1', activatedAt: new Date().toISOString() },
        { id: 'skill2', activatedAt: new Date().toISOString() },
      ];
      const result = getActiveSkillToolIds(skillRegistry, activeSkills);

      expect(result.size).toBe(3);
      expect(result.has('skill1_tool1')).toBe(true);
      expect(result.has('skill2_tool1')).toBe(true);
      expect(result.has('skill2_tool2')).toBe(true);
    });

    it('ignores active skills that are not registered', () => {
      const skill = createTestSkill('registered', ['registered_tool']);
      skillRegistry.register(skill);

      const activeSkills: ActiveSkill[] = [
        { id: 'registered', activatedAt: new Date().toISOString() },
        { id: 'not-registered', activatedAt: new Date().toISOString() },
      ];
      const result = getActiveSkillToolIds(skillRegistry, activeSkills);

      expect(result.size).toBe(1);
      expect(result.has('registered_tool')).toBe(true);
    });
  });

  describe('collectTools', () => {
    const toolContext = {
      userId: 'test-user',
      conversationId: 'test-conversation',
      services: null as unknown as Services,
    };

    beforeEach(() => {
      toolContext.services = services;
    });

    it('collects base tools when no active skills', () => {
      toolRegistry.register(createTestTool('base_tool1'));
      toolRegistry.register(createTestTool('base_tool2'));

      const result = collectTools({
        baseRegistry: toolRegistry,
        skillRegistry,
        externalServiceRegistry,
        activeSkills: [],
        toolContext,
      });

      expect(result.tools.length).toBe(2);
      expect(result.skillToolIds.size).toBe(0);
    });

    it('excludes skill tools from base tools to prevent duplicates', () => {
      // Register a tool that has the same ID as a skill tool
      const skill = createTestSkill('debug', ['shared_tool']);
      skillRegistry.register(skill);

      // Register the same tool ID in base registry
      toolRegistry.register(createTestTool('shared_tool'));
      toolRegistry.register(createTestTool('other_tool'));

      const activeSkills: ActiveSkill[] = [{ id: 'debug', activatedAt: new Date().toISOString() }];

      const result = collectTools({
        baseRegistry: toolRegistry,
        skillRegistry,
        externalServiceRegistry,
        activeSkills,
        toolContext,
      });

      // Should have 1 from base (other_tool) + 1 from skill (shared_tool) = 2 tools
      // NOT 2 from base + 1 from skill = 3 tools
      expect(result.tools.length).toBe(2);
      const toolNames = result.tools.map((t) => t.name);
      expect(toolNames).toContain('shared_tool');
      expect(toolNames).toContain('other_tool');
    });

    it('includes skill tools from active skills', () => {
      toolRegistry.register(createTestTool('base_tool'));
      const skill = createTestSkill('debug', ['debug_tool1', 'debug_tool2']);
      skillRegistry.register(skill);

      const activeSkills: ActiveSkill[] = [{ id: 'debug', activatedAt: new Date().toISOString() }];

      const result = collectTools({
        baseRegistry: toolRegistry,
        skillRegistry,
        externalServiceRegistry,
        activeSkills,
        toolContext,
      });

      // 1 base + 2 skill = 3 tools
      expect(result.tools.length).toBe(3);
      expect(result.skillToolIds.size).toBe(2);
    });

    it('builds tool lookup including both base and skill tools', () => {
      toolRegistry.register(createTestTool('base_tool'));
      const skill = createTestSkill('debug', ['debug_tool']);
      skillRegistry.register(skill);

      const activeSkills: ActiveSkill[] = [{ id: 'debug', activatedAt: new Date().toISOString() }];

      const result = collectTools({
        baseRegistry: toolRegistry,
        skillRegistry,
        externalServiceRegistry,
        activeSkills,
        toolContext,
      });

      // Lookup should include both
      expect(result.toolLookup.get('base_tool')).toBeDefined();
      expect(result.toolLookup.get('debug_tool')).toBeDefined();
      expect(result.toolLookup.get('nonexistent')).toBeUndefined();
    });

    it('filters tools by external service availability', () => {
      // Tool requiring unavailable service
      toolRegistry.register(
        createTestTool('service_tool', {
          requiredServices: ['unavailable-service'],
        }),
      );
      toolRegistry.register(createTestTool('no_service_tool'));

      const result = collectTools({
        baseRegistry: toolRegistry,
        skillRegistry,
        externalServiceRegistry,
        activeSkills: [],
        toolContext,
      });

      // Only the tool without service requirements should be included
      expect(result.tools.length).toBe(1);
      expect(result.tools[0].name).toBe('no_service_tool');
    });

    it('does not mutate the tool registry', () => {
      const skill = createTestSkill('debug', ['debug_tool']);
      skillRegistry.register(skill);
      toolRegistry.register(createTestTool('base_tool'));

      const initialSize = toolRegistry.size;

      const activeSkills: ActiveSkill[] = [{ id: 'debug', activatedAt: new Date().toISOString() }];

      collectTools({
        baseRegistry: toolRegistry,
        skillRegistry,
        externalServiceRegistry,
        activeSkills,
        toolContext,
      });

      // Registry should not have grown
      expect(toolRegistry.size).toBe(initialSize);
      // Skill tool should not be in registry
      expect(toolRegistry.has('debug_tool')).toBe(false);
    });
  });

  describe('createToolLookup', () => {
    it('creates lookup from map', () => {
      const map = new Map<string, ToolDefinition>();
      map.set('tool1', createTestTool('tool1'));
      map.set('tool2', createTestTool('tool2'));

      const lookup = createToolLookup(map);

      expect(lookup.get('tool1')).toBeDefined();
      expect(lookup.get('tool2')).toBeDefined();
      expect(lookup.get('nonexistent')).toBeUndefined();
    });
  });
});
