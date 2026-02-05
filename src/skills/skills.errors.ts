/**
 * Error thrown when a skill is not found.
 */
class SkillNotFoundError extends Error {
  readonly skillId: string;

  constructor(skillId: string) {
    super(`Skill not found: ${skillId}`);
    this.name = 'SkillNotFoundError';
    this.skillId = skillId;
  }
}

/**
 * Error thrown when a skill is already registered.
 */
class SkillAlreadyRegisteredError extends Error {
  readonly skillId: string;

  constructor(skillId: string) {
    super(`Skill already registered: ${skillId}`);
    this.name = 'SkillAlreadyRegisteredError';
    this.skillId = skillId;
  }
}

/**
 * Error thrown when trying to activate a skill that is already active.
 */
class SkillAlreadyActiveError extends Error {
  readonly skillId: string;

  constructor(skillId: string) {
    super(`Skill is already active: ${skillId}`);
    this.name = 'SkillAlreadyActiveError';
    this.skillId = skillId;
  }
}

/**
 * Error thrown when trying to deactivate a skill that is not active.
 */
class SkillNotActiveError extends Error {
  readonly skillId: string;

  constructor(skillId: string) {
    super(`Skill is not active: ${skillId}`);
    this.name = 'SkillNotActiveError';
    this.skillId = skillId;
  }
}

/**
 * Error thrown when skill activation fails.
 */
class SkillActivationFailedError extends Error {
  readonly skillId: string;
  readonly reason: string;

  constructor(skillId: string, reason: string) {
    super(`Failed to activate skill ${skillId}: ${reason}`);
    this.name = 'SkillActivationFailedError';
    this.skillId = skillId;
    this.reason = reason;
  }
}

/**
 * Error thrown when skill activation record is not found.
 */
class SkillActivationNotFoundError extends Error {
  readonly activationId: string;

  constructor(activationId: string) {
    super(`Skill activation not found: ${activationId}`);
    this.name = 'SkillActivationNotFoundError';
    this.activationId = activationId;
  }
}

export {
  SkillNotFoundError,
  SkillAlreadyRegisteredError,
  SkillAlreadyActiveError,
  SkillNotActiveError,
  SkillActivationFailedError,
  SkillActivationNotFoundError,
};
