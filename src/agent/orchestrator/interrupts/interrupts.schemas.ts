import { z } from 'zod';

import { riskLevelSchema } from '../../../agent/tools/tools.schemas.ts';
import { activationRiskSchema } from '../../../agent/skills/skills.schemas.ts';

/**
 * Types of interrupts.
 */
const interruptTypeSchema = z.enum([
  'tool_approval',
  'question',
  'confirmation',
  'error_recovery',
  'turn_limit',
  'skill_activation',
]);

type InterruptType = z.infer<typeof interruptTypeSchema>;

/**
 * An option that can be presented to the user in an interrupt.
 */
const interruptOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  isRecommended: z.boolean().optional(),
});

type InterruptOption = z.infer<typeof interruptOptionSchema>;

/**
 * Information about a tool call that requires approval.
 */
const toolCallInfoSchema = z.object({
  toolId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
  riskLevel: riskLevelSchema,
  riskReason: z.string(),
});

type ToolCallInfo = z.infer<typeof toolCallInfoSchema>;

/**
 * Information about a skill activation that requires approval.
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
 * Interrupt status.
 */
const interruptStatusSchema = z.enum(['pending', 'approved', 'denied', 'expired']);

type InterruptStatus = z.infer<typeof interruptStatusSchema>;

/**
 * Response to an interrupt.
 */
const interruptResponseSchema = z.object({
  approved: z.boolean().optional(),
  selectedOptionId: z.string().optional(),
  freeformResponse: z.string().optional(),
});

type InterruptResponse = z.infer<typeof interruptResponseSchema>;

/**
 * Full interrupt object.
 */
const interruptSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  type: interruptTypeSchema,
  prompt: z.string(),
  context: z.string().optional(),
  options: z.array(interruptOptionSchema).optional(),
  allowFreeform: z.boolean(),
  toolCall: toolCallInfoSchema.optional(),
  skillActivation: skillActivationInfoSchema.optional(),
  status: interruptStatusSchema,
  checkpointId: z.string().optional(),
  createdAt: z.string(),
  expiresAt: z.string().optional(),
  respondedAt: z.string().optional(),
  response: interruptResponseSchema.optional(),
});

type Interrupt = z.infer<typeof interruptSchema>;

/**
 * Input for creating an interrupt.
 */
const createInterruptInputSchema = z.object({
  conversationId: z.string(),
  type: interruptTypeSchema,
  prompt: z.string(),
  context: z.string().optional(),
  options: z.array(interruptOptionSchema).optional(),
  allowFreeform: z.boolean().optional().default(true),
  toolCall: toolCallInfoSchema.optional(),
  skillActivation: skillActivationInfoSchema.optional(),
  checkpointId: z.string().optional(),
  expiresAt: z.string().optional(),
});

type CreateInterruptInput = z.input<typeof createInterruptInputSchema>;

/**
 * Database row for interrupts.
 */
const interruptRowSchema = z.object({
  id: z.string(),
  conversation_id: z.string(),
  type: z.string(),
  prompt: z.string(),
  context: z.string().nullable(),
  options: z.string().nullable(), // JSON
  allow_freeform: z.number(), // SQLite stores boolean as 0/1
  tool_call: z.string().nullable(), // JSON
  skill_activation: z.string().nullable(), // JSON
  status: z.string(),
  checkpoint_id: z.string().nullable(),
  created_at: z.string(),
  expires_at: z.string().nullable(),
  responded_at: z.string().nullable(),
  response: z.string().nullable(), // JSON
});

type InterruptRow = z.infer<typeof interruptRowSchema>;

export type {
  InterruptType,
  InterruptOption,
  ToolCallInfo,
  SkillActivationInfo,
  InterruptStatus,
  InterruptResponse,
  Interrupt,
  CreateInterruptInput,
  InterruptRow,
};

export {
  interruptTypeSchema,
  interruptOptionSchema,
  toolCallInfoSchema,
  skillActivationInfoSchema,
  interruptStatusSchema,
  interruptResponseSchema,
  interruptSchema,
  createInterruptInputSchema,
  interruptRowSchema,
};
