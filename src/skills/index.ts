import { debuggingSkill } from './debugging/index.ts';
import type { SkillRegistry } from './skills.ts';

/**
 * Registers all builtin skills with the given registry.
 */
const registerBuiltinSkills = (registry: SkillRegistry): void => {
  registry.register(debuggingSkill);
};

// ============================================================================
// Exports
// ============================================================================

// Main service
export { SkillRegistry, DEFAULT_SKILLS_CONFIG } from './skills.ts';
export type { SkillsConfig } from './skills.ts';

// Builtin skills registration
export { registerBuiltinSkills };
export { debuggingSkill } from './debugging/index.ts';

// Schemas and types
export {
  activationRiskSchema,
  skillActivationResultSchema,
  skillDefinitionSchema,
  activeSkillSchema,
  pendingSkillActivationSchema,
  skillActivationInfoSchema,
  skillActivationRowSchema,
  createSkillActivationInputSchema,
} from './skills.schemas.ts';
export type {
  ActivationRisk,
  SkillContext,
  SkillActivationResult,
  SkillDefinition,
  ActiveSkill,
  PendingSkillActivation,
  SkillActivationInfo,
  SkillActivationRow,
  CreateSkillActivationInput,
} from './skills.schemas.ts';

// Errors
export {
  SkillNotFoundError,
  SkillAlreadyRegisteredError,
  SkillAlreadyActiveError,
  SkillNotActiveError,
  SkillActivationFailedError,
  SkillActivationNotFoundError,
} from './skills.errors.ts';

// Store
export {
  createSkillActivation,
  getSkillActivation,
  getSkillActivationsForConversation,
  getActiveSkillActivations,
  deactivateSkillActivation,
  deactivateSkillBySkillId,
  listSkillActivations,
} from './skills.store.ts';

// Tools
export {
  createActivationTool,
  deactivateSkillTool,
  listSkillsTool,
  getSkillManagementTools,
  createActivationTools,
} from './skills.tools.ts';
export type {
  ActivationOutput,
  DeactivateSkillInput,
  DeactivateSkillOutput,
  ListSkillsInput,
  ListSkillsOutput,
} from './skills.tools.ts';

// Context
export {
  generateSkillContext,
  generateActiveSkillsContext,
  getActiveSkillToolIds,
  getActiveSkillsSummary,
} from './skills.context.ts';

// Node
export {
  createSkillActivationNode,
  handleSkillActivationApproval,
  isSkillActivationTool,
  isDeactivateSkillTool,
  getSkillIdFromToolName,
  formatSkillActivationPrompt,
  activateSkill,
  deactivateSkill,
} from './skills.node.ts';
export type { SkillActivationNodeResult } from './skills.node.ts';
