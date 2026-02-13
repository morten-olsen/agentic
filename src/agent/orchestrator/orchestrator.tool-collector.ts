import type { DynamicStructuredTool } from '@langchain/core/tools';

import type { ToolRegistry, RegisteredTool, ToolContext, ToolDefinition } from '../../agent/tools/tools.ts';
import type { SkillRegistry } from '../../agent/skills/skills.ts';
import type { ActiveSkill } from '../../agent/skills/skills.schemas.ts';
import type { ExternalServiceRegistry } from '../../integrations/external/external.ts';
import { toLangChainTool, toLangChainToolsFiltered } from '../../agent/tools/adapters/adapters.langchain.ts';
import { createServiceFilter } from '../../integrations/external/external.tools.ts';

/**
 * Configuration for tool collection.
 */
type ToolCollectorConfig = {
  baseRegistry: ToolRegistry;
  skillRegistry: SkillRegistry;
  externalServiceRegistry: ExternalServiceRegistry;
  activeSkills: ActiveSkill[];
  toolContext: ToolContext;
};

/**
 * Result of tool collection.
 */
type CollectedTools = {
  /** LangChain tools ready for the graph */
  tools: DynamicStructuredTool[];
  /** Lookup map for risk gate (includes both registry and skill tools) */
  toolLookup: ToolLookup;
  /** IDs of tools from active skills */
  skillToolIds: Set<string>;
};

/**
 * Interface for looking up tool definitions.
 * Used by the risk gate to check risk levels.
 * Can be backed by either a ToolRegistry or a Map.
 */
type ToolLookup = {
  get: (toolId: string) => ToolDefinition | RegisteredTool | undefined;
};

/**
 * Creates a ToolLookup from a Map of tool definitions.
 */
const createToolLookup = (tools: Map<string, ToolDefinition | RegisteredTool>): ToolLookup => {
  return {
    get: (toolId: string) => tools.get(toolId),
  };
};

/**
 * Collects tools for a conversation session.
 *
 * This function creates a session-scoped collection of tools without mutating
 * the global ToolRegistry. Skill tools are collected directly from skill
 * definitions.
 *
 * Key behaviors:
 * - Filters base tools by service availability
 * - Excludes skill tool IDs from base tools to prevent duplicates
 * - Collects skill tools directly from active skill definitions
 * - Builds a lookup map that includes both registry and skill tools
 */
const collectTools = (config: ToolCollectorConfig): CollectedTools => {
  const { baseRegistry, skillRegistry, externalServiceRegistry, activeSkills, toolContext } = config;

  // Get skill tool IDs from active skills (for filtering base tools)
  const skillToolIds = getActiveSkillToolIds(skillRegistry, activeSkills);

  // Create service filter for external service availability
  const serviceFilter = createServiceFilter(externalServiceRegistry);

  // Filter base tools: must pass service filter AND not be a skill tool
  const baseTools = toLangChainToolsFiltered(
    baseRegistry,
    toolContext,
    (tool) => serviceFilter(tool) && !skillToolIds.has(tool.id),
  );

  // Collect skill tools directly from skill definitions (no registry mutation)
  const skillTools = getActiveSkillToolsDirectly(skillRegistry, activeSkills, toolContext);

  // Build lookup map for risk gate
  const toolLookup = buildToolLookup(baseRegistry, skillRegistry, activeSkills, skillToolIds);

  // Deduplicate tools by name to prevent "Duplicate function declaration" errors from the LLM API
  const allTools = [...baseTools, ...skillTools];
  const seenToolNames = new Set<string>();
  const deduplicatedTools = allTools.filter((tool) => {
    if (seenToolNames.has(tool.name)) return false;
    seenToolNames.add(tool.name);
    return true;
  });

  return {
    tools: deduplicatedTools,
    toolLookup,
    skillToolIds,
  };
};

/**
 * Gets tool IDs from active skills, including their activation tools.
 * Activation tools for active skills are excluded from base tools since
 * re-activating an already-active skill is unnecessary.
 */
const getActiveSkillToolIds = (skillRegistry: SkillRegistry, activeSkills: ActiveSkill[]): Set<string> => {
  const skillDefinitions = skillRegistry.getActiveSkillDefinitions(activeSkills);
  const toolIds = new Set<string>();

  for (const skill of skillDefinitions) {
    // Exclude the activation tool for this active skill
    toolIds.add(`activate_${skill.id}`);
    for (const tool of skill.tools) {
      toolIds.add(tool.id);
    }
  }

  return toolIds;
};

/**
 * Gets LangChain tools for active skills directly from skill definitions.
 * Does NOT mutate the tool registry.
 */
const getActiveSkillToolsDirectly = (
  skillRegistry: SkillRegistry,
  activeSkills: ActiveSkill[],
  toolContext: ToolContext,
): DynamicStructuredTool[] => {
  const skillDefinitions = skillRegistry.getActiveSkillDefinitions(activeSkills);
  const skillTools: DynamicStructuredTool[] = [];

  for (const skill of skillDefinitions) {
    for (const tool of skill.tools) {
      // Convert tool definition directly to LangChain tool
      // Create a minimal RegisteredTool-like object for the adapter
      const registeredLike = {
        ...tool,
        registeredAt: new Date(),
      };
      skillTools.push(toLangChainTool(registeredLike, toolContext));
    }
  }

  return skillTools;
};

/**
 * Builds a lookup map for risk gate evaluation.
 * Includes both registry tools (filtered) and skill tools.
 */
const buildToolLookup = (
  baseRegistry: ToolRegistry,
  skillRegistry: SkillRegistry,
  activeSkills: ActiveSkill[],
  skillToolIds: Set<string>,
): ToolLookup => {
  const lookupMap = new Map<string, ToolDefinition | RegisteredTool>();

  // Add base tools (excluding skill tools to avoid duplicates)
  for (const tool of baseRegistry.getAll()) {
    if (!skillToolIds.has(tool.id)) {
      lookupMap.set(tool.id, tool);
    }
  }

  // Add skill tools directly from definitions
  const skillDefinitions = skillRegistry.getActiveSkillDefinitions(activeSkills);
  for (const skill of skillDefinitions) {
    for (const tool of skill.tools) {
      lookupMap.set(tool.id, tool);
    }
  }

  return createToolLookup(lookupMap);
};

export type { ToolCollectorConfig, CollectedTools, ToolLookup };
export { collectTools, createToolLookup, getActiveSkillToolIds };
