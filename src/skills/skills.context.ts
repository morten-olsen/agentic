import type { SkillDefinition, ActiveSkill } from './skills.schemas.ts';
import type { SkillRegistry } from './skills.ts';

/**
 * Generates context section for a single active skill.
 */
const generateSkillContext = (skill: SkillDefinition, activeSkill: ActiveSkill): string => {
  const parts: string[] = [];

  // Header with skill name
  parts.push(`## Active Skill: ${skill.name}`);
  parts.push('');

  // Domain knowledge
  parts.push(skill.domainKnowledge.trim());

  // Additional context from activation if present
  if (activeSkill.additionalContext) {
    parts.push('');
    parts.push('### Additional Context');
    parts.push('');
    parts.push(activeSkill.additionalContext);
  }

  // Available tools from this skill
  if (skill.tools.length > 0) {
    parts.push('');
    parts.push('### Available Tools');
    parts.push('');
    for (const tool of skill.tools) {
      // Use tool.id as that's the actual tool name in LangChain
      parts.push(`- **${tool.id}**: ${tool.description.split('\n')[0]}`);
    }
  }

  return parts.join('\n');
};

/**
 * Generates the complete active skills context section for the system prompt.
 * Returns empty string if no skills are active.
 */
const generateActiveSkillsContext = (activeSkills: ActiveSkill[], skillRegistry: SkillRegistry): string => {
  if (activeSkills.length === 0) {
    return '';
  }

  const sections: string[] = [];

  // Header
  sections.push('# Active Skills');
  sections.push('');
  sections.push(`You have ${activeSkills.length} active skill(s) providing additional capabilities:`);
  sections.push('');

  // Generate context for each active skill
  for (const activeSkill of activeSkills) {
    const skill = skillRegistry.get(activeSkill.id);
    if (skill) {
      sections.push(generateSkillContext(skill, activeSkill));
      sections.push('');
      sections.push('---');
      sections.push('');
    }
  }

  // Remove trailing separator
  if (sections[sections.length - 1] === '' && sections[sections.length - 2] === '---') {
    sections.pop();
    sections.pop();
  }

  return sections.join('\n');
};

/**
 * Generates a list of skill tool IDs for the given active skills.
 * Used to determine which tools should be available.
 */
const getActiveSkillToolIds = (activeSkills: ActiveSkill[], skillRegistry: SkillRegistry): Set<string> => {
  const toolIds = new Set<string>();

  for (const activeSkill of activeSkills) {
    const skill = skillRegistry.get(activeSkill.id);
    if (skill) {
      for (const tool of skill.tools) {
        toolIds.add(tool.id);
      }
    }
  }

  return toolIds;
};

/**
 * Gets a summary of active skills for display.
 */
const getActiveSkillsSummary = (activeSkills: ActiveSkill[], skillRegistry: SkillRegistry): string => {
  if (activeSkills.length === 0) {
    return 'No skills currently active.';
  }

  const lines = ['Active skills:'];
  for (const activeSkill of activeSkills) {
    const skill = skillRegistry.get(activeSkill.id);
    if (skill) {
      lines.push(`- ${skill.name} (activated at ${activeSkill.activatedAt})`);
    }
  }

  return lines.join('\n');
};

/**
 * Generates context about available skills that can be activated.
 * Includes both active and inactive skills.
 */
const generateAvailableSkillsContext = (activeSkills: ActiveSkill[], skillRegistry: SkillRegistry): string => {
  const allSkills = skillRegistry.getAll();
  if (allSkills.length === 0) {
    return '';
  }

  const activeSkillIds = new Set(activeSkills.map((s) => s.id));
  const sections: string[] = [];

  sections.push('# Available Skills');
  sections.push('');
  sections.push('The following skills can be activated to provide additional capabilities:');
  sections.push('');

  for (const skill of allSkills) {
    const isActive = activeSkillIds.has(skill.id);
    const status = isActive ? ' **(ACTIVE)**' : '';
    const activationTool = `activate_${skill.id}`;

    sections.push(`## ${skill.name}${status}`);
    sections.push(`- **Description**: ${skill.description}`);
    if (!isActive) {
      sections.push(`- **To activate**: Call the \`${activationTool}\` tool`);
    }
    sections.push(`- **Provides tools**: ${skill.tools.map((t) => t.id).join(', ')}`);
    sections.push('');
  }

  sections.push('---');
  sections.push('');

  if (activeSkills.length > 0) {
    sections.push('**Note**: Active skills are marked above. Their tools are now available for use.');
  } else {
    sections.push(
      "**Note**: No skills are currently active. To use a skill's tools, you must first activate the skill.",
    );
  }

  sections.push('');
  sections.push('**IMPORTANT**: When activating a skill, you must WAIT for the activation to complete before');
  sections.push("calling any of that skill's tools. Do NOT call both the activation tool and a skill tool in the");
  sections.push('same response. First activate the skill, then in your next response use its tools.');

  return sections.join('\n');
};

export {
  generateSkillContext,
  generateActiveSkillsContext,
  getActiveSkillToolIds,
  getActiveSkillsSummary,
  generateAvailableSkillsContext,
};
