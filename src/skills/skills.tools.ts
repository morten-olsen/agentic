import { z } from 'zod';

import type { ToolDefinition, ToolContext } from '../tools/tools.ts';

import type { SkillDefinition, ActiveSkill } from './skills.schemas.ts';
import { activationRiskSchema } from './skills.schemas.ts';
import { SkillRegistry } from './skills.ts';
import { SkillNotActiveError } from './skills.errors.ts';

// ============================================================================
// Activation Tool Factory
// ============================================================================

/**
 * Input for activation tools (empty by default, can be extended by skill).
 */
const defaultActivationInputSchema = z.object({});

/**
 * Output for activation tools.
 */
const activationOutputSchema = z.object({
  activated: z.boolean(),
  message: z.string(),
  skillId: z.string(),
});

type ActivationOutput = z.infer<typeof activationOutputSchema>;

/**
 * Creates an activation tool for a skill.
 * The actual activation is handled by the skill activation node in the graph,
 * but this tool definition is needed for the LLM to know about the skill.
 */
const createActivationTool = (skill: SkillDefinition): ToolDefinition => {
  // Use tool.id as that's the actual tool name in LangChain
  const toolsList = skill.tools.map((t) => `- ${t.id}: ${t.description}`).join('\n');

  return {
    id: `activate_${skill.id}`,
    name: `Activate ${skill.name}`,
    description: `Activate the ${skill.name} skill. ${skill.description}

After activation, you'll have access to:
${toolsList}`,
    category: 'skills',
    inputSchema: skill.activationSchema ?? defaultActivationInputSchema,
    outputSchema: activationOutputSchema,
    risk: {
      level: 'low', // Activation tool itself is low risk; actual risk is handled by skill activation node
      reason: 'Activation may require approval based on skill risk',
      potentialImpact: 'Unlocks additional capabilities',
      reversible: true,
      categories: [],
    },
    tags: ['skill', 'activation', ...skill.tags],
    examples: [],
    execute: async (): Promise<ActivationOutput> => {
      // This is a placeholder - the skill activation node handles actual activation
      // This execute function should never be called directly
      throw new Error('Skill activation is handled by the skill activation node');
    },
  };
};

// ============================================================================
// Deactivate Skill Tool
// ============================================================================

const deactivateSkillInputSchema = z.object({
  skillId: z.string().min(1).describe('ID of the skill to deactivate'),
});

const deactivateSkillOutputSchema = z.object({
  deactivated: z.boolean(),
  message: z.string(),
  skillId: z.string(),
});

type DeactivateSkillInput = z.infer<typeof deactivateSkillInputSchema>;
type DeactivateSkillOutput = z.infer<typeof deactivateSkillOutputSchema>;

/**
 * Extended tool context that includes active skills and skill registry.
 */
type SkillToolContext = ToolContext & {
  activeSkills?: ActiveSkill[];
  skillRegistry?: SkillRegistry;
};

/**
 * Tool to deactivate an active skill.
 */
const deactivateSkillTool: ToolDefinition<DeactivateSkillInput, DeactivateSkillOutput> = {
  id: 'skills.deactivate_skill',
  name: 'DeactivateSkill',
  description: `Deactivate a currently active skill when you no longer need its capabilities.
This removes the skill's tools from your available tools.`,
  category: 'skills',
  inputSchema: deactivateSkillInputSchema,
  outputSchema: deactivateSkillOutputSchema,
  risk: {
    level: 'low',
    reason: 'Only removes capabilities',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['skill', 'deactivation', 'management'],
  examples: [
    {
      input: { skillId: 'data-analysis' },
      description: 'Deactivate the data analysis skill',
    },
  ],
  execute: async (input: DeactivateSkillInput, context: ToolContext): Promise<DeactivateSkillOutput> => {
    // This is a placeholder - deactivation is handled by the orchestrator
    // The orchestrator intercepts this tool call and modifies state accordingly
    const skillContext = context as SkillToolContext;
    const activeSkills = skillContext.activeSkills ?? [];

    const isActive = activeSkills.some((s) => s.id === input.skillId);
    if (!isActive) {
      throw new SkillNotActiveError(input.skillId);
    }

    // The orchestrator will handle the actual deactivation by updating state
    return {
      deactivated: true,
      message: `Skill ${input.skillId} has been deactivated`,
      skillId: input.skillId,
    };
  },
};

// ============================================================================
// List Skills Tool
// ============================================================================

const listSkillsInputSchema = z.object({
  includeInactive: z.boolean().nullish().default(true).describe('Include inactive (available) skills'),
});

const skillSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  activationRisk: activationRiskSchema,
  activatedAt: z.string().optional(),
  isActive: z.boolean(),
});

const listSkillsOutputSchema = z.object({
  activeSkills: z.array(skillSummarySchema),
  availableSkills: z.array(skillSummarySchema),
});

type ListSkillsInput = z.infer<typeof listSkillsInputSchema>;
type ListSkillsInputRaw = z.input<typeof listSkillsInputSchema>;
type ListSkillsOutput = z.infer<typeof listSkillsOutputSchema>;

/**
 * Tool to list available and active skills.
 */
const listSkillsTool: ToolDefinition<ListSkillsInput, ListSkillsOutput, ListSkillsInputRaw> = {
  id: 'skills.list_skills',
  name: 'ListSkills',
  description: 'List all available skills and their activation status.',
  category: 'skills',
  inputSchema: listSkillsInputSchema,
  outputSchema: listSkillsOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['skill', 'list', 'read'],
  examples: [
    { input: {}, description: 'List all skills' },
    { input: { includeInactive: false }, description: 'List only active skills' },
  ],
  execute: async (input: ListSkillsInput, context: ToolContext): Promise<ListSkillsOutput> => {
    const skillContext = context as SkillToolContext;
    const registry = skillContext.skillRegistry;
    const activeSkills = skillContext.activeSkills ?? [];

    if (!registry) {
      return { activeSkills: [], availableSkills: [] };
    }

    const allSkills = registry.getAll();
    const activeIds = new Set(activeSkills.map((s) => s.id));

    const active = activeSkills
      .map((as) => {
        const skill = registry.get(as.id);
        if (!skill) return null;
        return {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          activationRisk: skill.activationRisk,
          activatedAt: as.activatedAt,
          isActive: true,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    const available = input.includeInactive
      ? allSkills
          .filter((skill) => !activeIds.has(skill.id))
          .map((skill) => ({
            id: skill.id,
            name: skill.name,
            description: skill.description,
            activationRisk: skill.activationRisk,
            isActive: false,
          }))
      : [];

    return { activeSkills: active, availableSkills: available };
  },
};

// ============================================================================
// Registration
// ============================================================================

/**
 * Gets all skill management tools (not activation tools - those are per-skill).
 */
const getSkillManagementTools = (): ToolDefinition[] => {
  return [deactivateSkillTool, listSkillsTool] as ToolDefinition[];
};

/**
 * Creates activation tools for all registered skills.
 */
const createActivationTools = (registry: SkillRegistry): ToolDefinition[] => {
  return registry.getAll().map((skill) => createActivationTool(skill)) as ToolDefinition[];
};

// ============================================================================
// Exports
// ============================================================================

export type { ActivationOutput, DeactivateSkillInput, DeactivateSkillOutput, ListSkillsInput, ListSkillsOutput };

export {
  createActivationTool,
  deactivateSkillTool,
  listSkillsTool,
  getSkillManagementTools,
  createActivationTools,
  activationOutputSchema,
  deactivateSkillInputSchema,
  deactivateSkillOutputSchema,
  listSkillsInputSchema,
  listSkillsOutputSchema,
};
