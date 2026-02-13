import type { SkillDefinition, ActiveSkill, ActivationRisk } from './skills.schemas.ts';
import { SkillNotFoundError, SkillAlreadyRegisteredError } from './skills.errors.ts';

/**
 * Configuration for the skills system.
 */
type SkillsConfig = {
  /** Risk threshold for requiring approval (default: 'high') */
  approvalThreshold: ActivationRisk;
  /** Whether to log activations (default: true) */
  logActivations: boolean;
  /** Maximum concurrent active skills (default: 10) */
  maxActiveSkills: number;
};

const DEFAULT_SKILLS_CONFIG: SkillsConfig = {
  approvalThreshold: 'high',
  logActivations: true,
  maxActiveSkills: 10,
};

/**
 * SkillRegistry - manages skill registration and lookup.
 */
class SkillRegistry {
  #skills = new Map<string, SkillDefinition>();
  #config: SkillsConfig;

  constructor(config: Partial<SkillsConfig> = {}) {
    this.#config = { ...DEFAULT_SKILLS_CONFIG, ...config };
  }

  /**
   * Gets the current configuration.
   */
  get config(): SkillsConfig {
    return { ...this.#config };
  }

  /**
   * Registers a skill.
   */
  register = (skill: SkillDefinition): void => {
    if (this.#skills.has(skill.id)) {
      throw new SkillAlreadyRegisteredError(skill.id);
    }
    this.#skills.set(skill.id, skill);
  };

  /**
   * Unregisters a skill.
   */
  unregister = (skillId: string): boolean => {
    return this.#skills.delete(skillId);
  };

  /**
   * Gets a skill by ID.
   */
  get = (skillId: string): SkillDefinition | null => {
    return this.#skills.get(skillId) ?? null;
  };

  /**
   * Gets a skill by ID, throwing if not found.
   */
  getOrThrow = (skillId: string): SkillDefinition => {
    const skill = this.get(skillId);
    if (!skill) {
      throw new SkillNotFoundError(skillId);
    }
    return skill;
  };

  /**
   * Gets all registered skills.
   */
  getAll = (): SkillDefinition[] => {
    return Array.from(this.#skills.values());
  };

  /**
   * Gets skills by tag.
   */
  getByTag = (tag: string): SkillDefinition[] => {
    return this.getAll().filter((skill) => skill.tags.includes(tag));
  };

  /**
   * Checks if a skill is registered.
   */
  has = (skillId: string): boolean => {
    return this.#skills.has(skillId);
  };

  /**
   * Gets the count of registered skills.
   */
  get size(): number {
    return this.#skills.size;
  }

  /**
   * Checks if a skill is active in the given active skills list.
   */
  isActive = (skillId: string, activeSkills: ActiveSkill[]): boolean => {
    return activeSkills.some((s) => s.id === skillId);
  };

  /**
   * Gets definitions for active skills.
   * Deduplicates by skill ID to prevent duplicate tool declarations.
   */
  getActiveSkillDefinitions = (activeSkills: ActiveSkill[]): SkillDefinition[] => {
    const seen = new Set<string>();
    const definitions: SkillDefinition[] = [];
    for (const active of activeSkills) {
      if (seen.has(active.id)) continue;
      seen.add(active.id);
      const skill = this.get(active.id);
      if (skill) {
        definitions.push(skill);
      }
    }
    return definitions;
  };

  /**
   * Checks if a skill requires approval based on its activation risk.
   */
  requiresApproval = (skill: SkillDefinition): boolean => {
    const riskLevels: ActivationRisk[] = ['none', 'low', 'medium', 'high', 'critical'];
    const skillRiskIndex = riskLevels.indexOf(skill.activationRisk);
    const thresholdIndex = riskLevels.indexOf(this.#config.approvalThreshold);
    return skillRiskIndex >= thresholdIndex;
  };

  /**
   * Clears all registered skills.
   */
  clear = (): void => {
    this.#skills.clear();
  };

  /**
   * Finds which skill a tool belongs to by tool ID.
   * Returns the skill definition if found, null otherwise.
   */
  findSkillByToolId = (toolId: string): SkillDefinition | null => {
    for (const skill of this.#skills.values()) {
      for (const tool of skill.tools) {
        if (tool.id === toolId) {
          return skill;
        }
      }
    }
    return null;
  };
}

export type { SkillsConfig };
export { SkillRegistry, DEFAULT_SKILLS_CONFIG };
