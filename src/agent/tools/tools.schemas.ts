import { z } from 'zod';

import type { Services } from '../../core/services/services.ts';

/**
 * Risk levels for tools.
 * - low: No side effects, safe to run without confirmation
 * - medium: Reversible side effects, may prompt for confirmation
 * - high: Difficult to reverse, requires confirmation
 * - critical: Irreversible or security-sensitive, requires explicit approval
 */
const riskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);

type RiskLevel = z.infer<typeof riskLevelSchema>;

/**
 * Categories of risk for classification.
 */
const riskCategorySchema = z.enum([
  'data_access', // Reading sensitive data
  'data_modification', // Modifying data
  'data_deletion', // Deleting data
  'external_communication', // Sending emails, API calls
  'financial', // Money-related operations
  'system_access', // File system, processes
  'authentication', // Credentials, tokens
]);

type RiskCategory = z.infer<typeof riskCategorySchema>;

/**
 * Risk profile for a tool.
 */
const riskProfileSchema = z.object({
  level: riskLevelSchema,
  reason: z.string(),
  potentialImpact: z.string(),
  reversible: z.boolean(),
  categories: z.array(riskCategorySchema),
});

type RiskProfile = z.infer<typeof riskProfileSchema>;

/**
 * Dynamic risk evaluator function.
 * Called at runtime to determine the risk level based on the actual input.
 *
 * @template TInput - The tool's input type
 * @param input - The tool input being evaluated
 * @param services - The services container for accessing dependencies
 * @returns A promise resolving to the computed risk profile
 */
type DynamicRiskEvaluator<TInput = unknown> = (input: TInput, services: Services) => Promise<RiskProfile>;

/**
 * Dynamic risk profile with an evaluator function and fallback.
 * The evaluator is called at runtime to compute the risk based on input.
 * If evaluation fails, the defaultProfile is used as a fallback.
 */
type DynamicRiskProfile<TInput = unknown> = {
  evaluator: DynamicRiskEvaluator<TInput>;
  defaultProfile: RiskProfile;
};

/**
 * Tool risk - either a static RiskProfile or a dynamic evaluator.
 */
type ToolRisk<TInput = unknown> = RiskProfile | DynamicRiskProfile<TInput>;

/**
 * Type guard to check if a tool risk is dynamic.
 */
const isDynamicRiskProfile = <TInput>(risk: ToolRisk<TInput>): risk is DynamicRiskProfile<TInput> => {
  return risk !== null && typeof risk === 'object' && 'evaluator' in risk && typeof risk.evaluator === 'function';
};

/**
 * Tool execution context schema (for validation).
 * Note: services is not included in the schema but is added to the type.
 */
const toolContextSchema = z.object({
  userId: z.string(),
  conversationId: z.string(),
  abortSignal: z.instanceof(AbortSignal).optional(),
});

/**
 * Tool execution context type.
 * Extends the schema type with services container for tool access.
 */
type ToolContext = z.infer<typeof toolContextSchema> & {
  services: Services;
  // Trigger context (present when running from a trigger invocation)
  triggerId?: string;
  triggerName?: string;
  // Message context (for artifact association)
  messageId?: string;
};

/**
 * Tool execution result.
 */
const toolResultSchema = z.object({
  success: z.boolean(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  durationMs: z.number().optional(),
});

type ToolResult = z.infer<typeof toolResultSchema>;

/**
 * Tool definition input schema for registration.
 */
const toolDefinitionInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  risk: riskProfileSchema,
  tags: z.array(z.string()).default([]),
  examples: z
    .array(
      z.object({
        input: z.unknown(),
        description: z.string(),
      }),
    )
    .default([]),
});

type ToolDefinitionInput = z.infer<typeof toolDefinitionInputSchema>;

export type {
  RiskLevel,
  RiskCategory,
  RiskProfile,
  DynamicRiskEvaluator,
  DynamicRiskProfile,
  ToolRisk,
  ToolContext,
  ToolResult,
  ToolDefinitionInput,
};

export {
  riskLevelSchema,
  riskCategorySchema,
  riskProfileSchema,
  toolContextSchema,
  toolResultSchema,
  toolDefinitionInputSchema,
  isDynamicRiskProfile,
};
