import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { z } from 'zod';

import { Services } from '../../core/services/services.ts';
import { DatabaseService, createDatabaseService } from '../../core/database/database.ts';

import { SkillRegistry } from './skills.ts';
import type { SkillDefinition, ActiveSkill } from './skills.schemas.ts';
import {
  activationRiskSchema,
  skillActivationResultSchema,
  activeSkillSchema,
  pendingSkillActivationSchema,
} from './skills.schemas.ts';
import { SkillNotFoundError, SkillAlreadyRegisteredError } from './skills.errors.ts';
import { createActivationTool, getSkillManagementTools, createActivationTools } from './skills.tools.ts';
import { generateActiveSkillsContext, getActiveSkillToolIds, getActiveSkillsSummary } from './skills.context.ts';
import {
  createSkillActivation,
  getSkillActivation,
  getSkillActivationsForConversation,
  deactivateSkillBySkillId,
} from './skills.store.ts';
import {
  isSkillActivationTool,
  isDeactivateSkillTool,
  getSkillIdFromToolName,
  formatSkillActivationPrompt,
} from './skills.node.ts';

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

const createTestSkill = (overrides: Partial<SkillDefinition> = {}): SkillDefinition => ({
  id: 'test-skill',
  name: 'Test Skill',
  description: 'A test skill for unit testing',
  activationRisk: 'low',
  activationReason: 'Low risk test skill',
  tools: [
    {
      id: 'test-skill_test-tool',
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
      tags: ['test'],
      examples: [],
      execute: async () => ({ output: 'test' }),
    },
  ],
  domainKnowledge: '# Test Knowledge\n\nThis is test domain knowledge.',
  tags: ['test'],
  relatedSkills: [],
  ...overrides,
});

const createHighRiskSkill = (): SkillDefinition =>
  createTestSkill({
    id: 'high-risk-skill',
    name: 'High Risk Skill',
    description: 'A high risk skill',
    activationRisk: 'high',
    activationReason: 'This skill has powerful capabilities that could cause significant changes',
  });

// ============================================================================
// Schema Tests
// ============================================================================

describe('Skill Schemas', () => {
  describe('activationRiskSchema', () => {
    it('accepts valid risk levels', () => {
      expect(activationRiskSchema.parse('none')).toBe('none');
      expect(activationRiskSchema.parse('low')).toBe('low');
      expect(activationRiskSchema.parse('medium')).toBe('medium');
      expect(activationRiskSchema.parse('high')).toBe('high');
      expect(activationRiskSchema.parse('critical')).toBe('critical');
    });

    it('rejects invalid risk level', () => {
      expect(() => activationRiskSchema.parse('invalid')).toThrow();
    });
  });

  describe('skillActivationResultSchema', () => {
    it('parses success result', () => {
      const result = skillActivationResultSchema.parse({
        success: true,
        additionalContext: 'Extra context',
      });

      expect(result.success).toBe(true);
      expect(result.additionalContext).toBe('Extra context');
    });

    it('parses failure result', () => {
      const result = skillActivationResultSchema.parse({
        success: false,
        error: 'Activation failed',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Activation failed');
    });
  });

  describe('activeSkillSchema', () => {
    it('parses active skill', () => {
      const activeSkill = activeSkillSchema.parse({
        id: 'test-skill',
        activatedAt: '2024-01-01T00:00:00Z',
        activationParams: { key: 'value' },
      });

      expect(activeSkill.id).toBe('test-skill');
      expect(activeSkill.activatedAt).toBe('2024-01-01T00:00:00Z');
      expect(activeSkill.activationParams).toEqual({ key: 'value' });
    });
  });

  describe('pendingSkillActivationSchema', () => {
    it('parses pending activation', () => {
      const pending = pendingSkillActivationSchema.parse({
        skillId: 'test-skill',
        activationParams: { param: 'value' },
        toolCallId: 'call_123',
      });

      expect(pending.skillId).toBe('test-skill');
      expect(pending.activationParams).toEqual({ param: 'value' });
      expect(pending.toolCallId).toBe('call_123');
    });
  });
});

// ============================================================================
// SkillRegistry Tests
// ============================================================================

describe('SkillRegistry', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  describe('register', () => {
    it('registers a skill', () => {
      const skill = createTestSkill();
      registry.register(skill);

      expect(registry.has(skill.id)).toBe(true);
      expect(registry.size).toBe(1);
    });

    it('throws on duplicate registration', () => {
      const skill = createTestSkill();
      registry.register(skill);

      expect(() => registry.register(skill)).toThrow(SkillAlreadyRegisteredError);
    });
  });

  describe('unregister', () => {
    it('unregisters a skill', () => {
      const skill = createTestSkill();
      registry.register(skill);

      expect(registry.unregister(skill.id)).toBe(true);
      expect(registry.has(skill.id)).toBe(false);
    });

    it('returns false for non-existent skill', () => {
      expect(registry.unregister('non-existent')).toBe(false);
    });
  });

  describe('get', () => {
    it('returns skill by ID', () => {
      const skill = createTestSkill();
      registry.register(skill);

      const retrieved = registry.get(skill.id);
      expect(retrieved).toEqual(skill);
    });

    it('returns null for non-existent skill', () => {
      expect(registry.get('non-existent')).toBeNull();
    });
  });

  describe('getOrThrow', () => {
    it('returns skill by ID', () => {
      const skill = createTestSkill();
      registry.register(skill);

      expect(registry.getOrThrow(skill.id)).toEqual(skill);
    });

    it('throws for non-existent skill', () => {
      expect(() => registry.getOrThrow('non-existent')).toThrow(SkillNotFoundError);
    });
  });

  describe('getAll', () => {
    it('returns all registered skills', () => {
      const skill1 = createTestSkill({ id: 'skill-1', name: 'Skill 1' });
      const skill2 = createTestSkill({ id: 'skill-2', name: 'Skill 2' });

      registry.register(skill1);
      registry.register(skill2);

      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((s) => s.id).sort()).toEqual(['skill-1', 'skill-2']);
    });
  });

  describe('getByTag', () => {
    it('returns skills with matching tag', () => {
      const skill1 = createTestSkill({ id: 'skill-1', tags: ['test', 'common'] });
      const skill2 = createTestSkill({ id: 'skill-2', tags: ['unique'] });
      const skill3 = createTestSkill({ id: 'skill-3', tags: ['test'] });

      registry.register(skill1);
      registry.register(skill2);
      registry.register(skill3);

      const testSkills = registry.getByTag('test');
      expect(testSkills).toHaveLength(2);
      expect(testSkills.map((s) => s.id).sort()).toEqual(['skill-1', 'skill-3']);
    });
  });

  describe('isActive', () => {
    it('returns true for active skill', () => {
      const skill = createTestSkill();
      registry.register(skill);

      const activeSkills: ActiveSkill[] = [{ id: skill.id, activatedAt: new Date().toISOString() }];

      expect(registry.isActive(skill.id, activeSkills)).toBe(true);
    });

    it('returns false for inactive skill', () => {
      const skill = createTestSkill();
      registry.register(skill);

      expect(registry.isActive(skill.id, [])).toBe(false);
    });
  });

  describe('getActiveSkillDefinitions', () => {
    it('returns definitions for active skills', () => {
      const skill1 = createTestSkill({ id: 'skill-1' });
      const skill2 = createTestSkill({ id: 'skill-2' });

      registry.register(skill1);
      registry.register(skill2);

      const activeSkills: ActiveSkill[] = [{ id: 'skill-1', activatedAt: new Date().toISOString() }];

      const definitions = registry.getActiveSkillDefinitions(activeSkills);
      expect(definitions).toHaveLength(1);
      expect(definitions[0].id).toBe('skill-1');
    });

    it('deduplicates when activeSkills has duplicate entries', () => {
      const skill1 = createTestSkill({ id: 'skill-1' });
      registry.register(skill1);

      const activeSkills: ActiveSkill[] = [
        { id: 'skill-1', activatedAt: new Date().toISOString() },
        { id: 'skill-1', activatedAt: new Date().toISOString() },
      ];

      const definitions = registry.getActiveSkillDefinitions(activeSkills);
      expect(definitions).toHaveLength(1);
      expect(definitions[0].id).toBe('skill-1');
    });
  });

  describe('requiresApproval', () => {
    it('returns false for low risk skill with default config', () => {
      const registry = new SkillRegistry();
      const skill = createTestSkill({ activationRisk: 'low' });

      expect(registry.requiresApproval(skill)).toBe(false);
    });

    it('returns true for high risk skill with default config', () => {
      const registry = new SkillRegistry();
      const skill = createHighRiskSkill();

      expect(registry.requiresApproval(skill)).toBe(true);
    });

    it('respects custom approval threshold', () => {
      const registry = new SkillRegistry({ approvalThreshold: 'low' });
      const skill = createTestSkill({ activationRisk: 'low' });

      expect(registry.requiresApproval(skill)).toBe(true);
    });
  });

  describe('clear', () => {
    it('removes all skills', () => {
      registry.register(createTestSkill({ id: 'skill-1' }));
      registry.register(createTestSkill({ id: 'skill-2' }));

      registry.clear();

      expect(registry.size).toBe(0);
    });
  });
});

// ============================================================================
// Skills Tools Tests
// ============================================================================

describe('Skills Tools', () => {
  describe('createActivationTool', () => {
    it('creates activation tool for skill', () => {
      const skill = createTestSkill();
      const tool = createActivationTool(skill);

      expect(tool.id).toBe('activate_test-skill');
      expect(tool.name).toBe('Activate Test Skill');
      expect(tool.description).toContain(skill.description);
      expect(tool.category).toBe('skills');
    });
  });

  describe('getSkillManagementTools', () => {
    it('returns deactivate and list tools', () => {
      const tools = getSkillManagementTools();

      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.id).sort()).toEqual(['skills.deactivate_skill', 'skills.list_skills']);
    });
  });

  describe('createActivationTools', () => {
    it('creates activation tools for all skills', () => {
      const registry = new SkillRegistry();
      registry.register(createTestSkill({ id: 'skill-1' }));
      registry.register(createTestSkill({ id: 'skill-2' }));

      const tools = createActivationTools(registry);

      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.id).sort()).toEqual(['activate_skill-1', 'activate_skill-2']);
    });
  });
});

// ============================================================================
// Skills Context Tests
// ============================================================================

describe('Skills Context', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
    registry.register(createTestSkill());
  });

  describe('generateActiveSkillsContext', () => {
    it('returns empty string when no skills active', () => {
      const context = generateActiveSkillsContext([], registry);
      expect(context).toBe('');
    });

    it('generates context for active skills', () => {
      const activeSkills: ActiveSkill[] = [{ id: 'test-skill', activatedAt: '2024-01-01T00:00:00Z' }];

      const context = generateActiveSkillsContext(activeSkills, registry);

      expect(context).toContain('# Active Skills');
      expect(context).toContain('Test Skill');
      expect(context).toContain('Test Knowledge');
    });

    it('includes additional context when present', () => {
      const activeSkills: ActiveSkill[] = [
        {
          id: 'test-skill',
          activatedAt: '2024-01-01T00:00:00Z',
          additionalContext: 'Extra context from activation',
        },
      ];

      const context = generateActiveSkillsContext(activeSkills, registry);

      expect(context).toContain('Extra context from activation');
    });
  });

  describe('getActiveSkillToolIds', () => {
    it('returns tool IDs from active skills', () => {
      const activeSkills: ActiveSkill[] = [{ id: 'test-skill', activatedAt: '2024-01-01T00:00:00Z' }];

      const toolIds = getActiveSkillToolIds(activeSkills, registry);

      expect(toolIds.has('test-skill_test-tool')).toBe(true);
    });

    it('returns empty set when no skills active', () => {
      const toolIds = getActiveSkillToolIds([], registry);
      expect(toolIds.size).toBe(0);
    });
  });

  describe('getActiveSkillsSummary', () => {
    it('returns summary for active skills', () => {
      const activeSkills: ActiveSkill[] = [{ id: 'test-skill', activatedAt: '2024-01-01T00:00:00Z' }];

      const summary = getActiveSkillsSummary(activeSkills, registry);

      expect(summary).toContain('Active skills:');
      expect(summary).toContain('Test Skill');
    });

    it('returns message when no skills active', () => {
      const summary = getActiveSkillsSummary([], registry);
      expect(summary).toBe('No skills currently active.');
    });
  });
});

// ============================================================================
// Skills Node Tests
// ============================================================================

describe('Skills Node', () => {
  describe('isSkillActivationTool', () => {
    it('returns true for activation tools', () => {
      expect(isSkillActivationTool('activate_test-skill')).toBe(true);
      expect(isSkillActivationTool('activate_data-analysis')).toBe(true);
    });

    it('returns false for other tools', () => {
      expect(isSkillActivationTool('deactivate_skill')).toBe(false);
      expect(isSkillActivationTool('list_skills')).toBe(false);
      expect(isSkillActivationTool('echo')).toBe(false);
    });
  });

  describe('isDeactivateSkillTool', () => {
    it('returns true for deactivate tool', () => {
      expect(isDeactivateSkillTool('deactivate_skill')).toBe(true);
      expect(isDeactivateSkillTool('DeactivateSkill')).toBe(true);
    });

    it('returns false for other tools', () => {
      expect(isDeactivateSkillTool('activate_skill')).toBe(false);
      expect(isDeactivateSkillTool('list_skills')).toBe(false);
    });
  });

  describe('getSkillIdFromToolName', () => {
    it('extracts skill ID from activation tool name', () => {
      expect(getSkillIdFromToolName('activate_test-skill')).toBe('test-skill');
      expect(getSkillIdFromToolName('activate_data-analysis')).toBe('data-analysis');
    });
  });

  describe('formatSkillActivationPrompt', () => {
    it('formats prompt for skill activation', () => {
      const skill = createTestSkill();
      const prompt = formatSkillActivationPrompt(skill);

      expect(prompt).toContain('Test Skill');
      expect(prompt).toContain('Low risk test skill');
      // Uses tool.id, not tool.name, as that's the actual tool identifier
      expect(prompt).toContain('test-skill_test-tool');
    });
  });
});

// ============================================================================
// Skills Store Tests
// ============================================================================

describe('Skills Store', () => {
  let services: Services;
  let db: ReturnType<typeof createDatabaseService>['knex'];
  let conversationId: string;

  beforeEach(async () => {
    services = await createTestServices();
    db = services.get(DatabaseService).knex;

    // Create a test conversation
    const now = new Date().toISOString();
    conversationId = 'test-conv-' + Date.now();
    await db('conversations').insert({
      id: conversationId,
      title: 'Test Conversation',
      started_at: now,
      last_activity_at: now,
      created_at: now,
      updated_at: now,
    });
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('createSkillActivation', () => {
    it('creates a skill activation record', async () => {
      const activation = await createSkillActivation(db, {
        conversationId,
        skillId: 'test-skill',
        activationRisk: 'low',
        requiredApproval: false,
      });

      expect(activation.skill_id).toBe('test-skill');
      expect(activation.conversation_id).toBe(conversationId);
      expect(activation.activation_risk).toBe('low');
      expect(activation.required_approval).toBe(0);
      expect(activation.deactivated_at).toBeNull();
    });
  });

  describe('getSkillActivation', () => {
    it('retrieves a skill activation by ID', async () => {
      const created = await createSkillActivation(db, {
        conversationId,
        skillId: 'test-skill',
        activationRisk: 'low',
        requiredApproval: false,
      });

      const retrieved = await getSkillActivation(db, created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.skill_id).toBe('test-skill');
    });

    it('returns null for non-existent activation', async () => {
      const retrieved = await getSkillActivation(db, 'non-existent');
      expect(retrieved).toBeNull();
    });
  });

  describe('getSkillActivationsForConversation', () => {
    it('returns activations for conversation', async () => {
      await createSkillActivation(db, {
        conversationId,
        skillId: 'skill-1',
        activationRisk: 'low',
        requiredApproval: false,
      });

      await createSkillActivation(db, {
        conversationId,
        skillId: 'skill-2',
        activationRisk: 'high',
        requiredApproval: true,
        approvedAt: new Date().toISOString(),
      });

      const activations = await getSkillActivationsForConversation(db, conversationId);

      expect(activations).toHaveLength(2);
    });
  });

  describe('deactivateSkillBySkillId', () => {
    it('deactivates a skill', async () => {
      await createSkillActivation(db, {
        conversationId,
        skillId: 'test-skill',
        activationRisk: 'low',
        requiredApproval: false,
      });

      const deactivated = await deactivateSkillBySkillId(db, conversationId, 'test-skill');

      expect(deactivated).not.toBeNull();
      expect(deactivated?.deactivated_at).not.toBeNull();
    });

    it('returns null when skill not active', async () => {
      const deactivated = await deactivateSkillBySkillId(db, conversationId, 'non-existent');
      expect(deactivated).toBeNull();
    });
  });
});
