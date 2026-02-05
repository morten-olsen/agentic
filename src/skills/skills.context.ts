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
      parts.push(`- **${tool.name}**: ${tool.description.split('\n')[0]}`);
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

export { generateSkillContext, generateActiveSkillsContext, getActiveSkillToolIds, getActiveSkillsSummary };
