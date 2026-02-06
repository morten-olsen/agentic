import { z } from 'zod';

import type { ToolDefinition } from '../tools/tools.types.ts';
import type { Services } from '../services/services.ts';

/**
 * Risk levels for skill activation.
 * - none: Activate immediately with no notification
 * - low: Activate immediately, log activation
 * - medium: Activate immediately, log activation (same as low for v1)
 * - high: Require user approval
 * - critical: Require user approval + confirmation
 */
const activationRiskSchema = z.enum(['none', 'low', 'medium', 'high', 'critical']);

type ActivationRisk = z.infer<typeof activationRiskSchema>;

/**
 * Context provided to skill lifecycle hooks.
 */
type SkillContext = {
  conversationId: string;
  services: Services;
};

/**
 * Result returned from skill onActivate hook.
 */
const skillActivationResultSchema = z.object({
  success: z.boolean(),
  additionalContext: z.string().optional(),
  error: z.string().optional(),
});

type SkillActivationResult = z.infer<typeof skillActivationResultSchema>;

/**
 * Skill definition - describes a domain-specific capability.
 */
type SkillDefinition = {
  /** Unique identifier for the skill */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what the skill provides */
  description: string;

  // Activation
  /** Risk level for activating the skill */
  activationRisk: ActivationRisk;
  /** Why this risk level (shown in approval prompt) */
  activationReason: string;
  /** Optional parameters for activation */
  activationSchema?: z.ZodSchema;

  // What the skill provides
  /** Tools available after activation */
  tools: ToolDefinition[];
  /** Markdown instructions injected on activation */
  domainKnowledge: string;

  // Optional lifecycle hooks
  /** Called when skill is activated */
  onActivate?: (params: unknown, context: SkillContext) => Promise<SkillActivationResult>;
  /** Called when skill is deactivated */
  onDeactivate?: (context: SkillContext) => Promise<void>;

  // Metadata
  /** Tags for categorization and discovery */
  tags: string[];
  /** Other skills often used together */
  relatedSkills: string[];
  /** External services required for this skill to be available */
  requiredServices?: string[];
};

/**
 * Schema for skill definition validation (partial, for runtime checks).
 */
const skillDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  activationRisk: activationRiskSchema,
  activationReason: z.string().min(1),
  domainKnowledge: z.string(),
  tags: z.array(z.string()),
  relatedSkills: z.array(z.string()),
});

/**
 * Active skill state - tracks an activated skill in a conversation.
 */
const activeSkillSchema = z.object({
  /** Skill ID */
  id: z.string(),
  /** When the skill was activated */
  activatedAt: z.string(),
  /** Parameters passed to activation */
  activationParams: z.unknown().optional(),
  /** Extra context returned by onActivate */
  additionalContext: z.string().optional(),
});

type ActiveSkill = z.infer<typeof activeSkillSchema>;

/**
 * Pending skill activation - tracks a skill awaiting approval.
 */
const pendingSkillActivationSchema = z.object({
  skillId: z.string(),
  activationParams: z.unknown().optional(),
  toolCallId: z.string(),
});

type PendingSkillActivation = z.infer<typeof pendingSkillActivationSchema>;

/**
 * Information about a skill activation for interrupts.
 */
const skillActivationInfoSchema = z.object({
  skillId: z.string(),
  skillName: z.string(),
  activationRisk: activationRiskSchema,
  activationReason: z.string(),
  activationParams: z.unknown().optional(),
  toolsSummary: z.string(),
});

type SkillActivationInfo = z.infer<typeof skillActivationInfoSchema>;

/**
 * Database row for skill activations (analytics/debugging).
 */
const skillActivationRowSchema = z.object({
  id: z.string(),
  conversation_id: z.string(),
  skill_id: z.string(),
  activated_at: z.string(),
  deactivated_at: z.string().nullable(),
  activation_params: z.string().nullable(), // JSON
  activation_risk: z.string(),
  required_approval: z.number(), // SQLite boolean
  approved_at: z.string().nullable(),
  created_at: z.string(),
});

type SkillActivationRow = z.infer<typeof skillActivationRowSchema>;

/**
 * Input for creating a skill activation record.
 */
const createSkillActivationInputSchema = z.object({
  conversationId: z.string(),
  skillId: z.string(),
  activationParams: z.unknown().optional(),
  activationRisk: activationRiskSchema,
  requiredApproval: z.boolean(),
  approvedAt: z.string().optional(),
});

type CreateSkillActivationInput = z.infer<typeof createSkillActivationInputSchema>;

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
};

export {
  activationRiskSchema,
  skillActivationResultSchema,
  skillDefinitionSchema,
  activeSkillSchema,
  pendingSkillActivationSchema,
  skillActivationInfoSchema,
  skillActivationRowSchema,
  createSkillActivationInputSchema,
};
