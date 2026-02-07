import type { ToolRegistry } from '../tools.ts';
import { getSkillManagementTools } from '../../../agent/skills/skills.tools.ts';

/**
 * Registers skill management tools with the registry.
 *
 * Note: Activation tools (activate_<skillId>) are dynamically generated
 * and registered separately based on registered skills.
 */
const registerSkillTools = (registry: ToolRegistry): void => {
  const tools = getSkillManagementTools();
  for (const tool of tools) {
    registry.register(tool);
  }
};

export { registerSkillTools };
