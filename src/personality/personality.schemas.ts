import { z } from 'zod';

/**
 * Communication style settings.
 */
const styleSchema = z.object({
  formality: z.enum(['casual', 'professional', 'formal']).default('professional'),
  verbosity: z.enum(['terse', 'balanced', 'detailed']).default('balanced'),
  humor: z.enum(['none', 'subtle', 'witty']).default('subtle'),
  emoji: z.enum(['never', 'minimal', 'moderate']).default('never'),
});

type Style = z.infer<typeof styleSchema>;

/**
 * Behavioral traits.
 */
const traitsSchema = z.object({
  proactivity: z.enum(['reactive', 'suggestive', 'proactive']).default('suggestive'),
  confidence: z.enum(['humble', 'balanced', 'confident']).default('balanced'),
  directness: z.enum(['diplomatic', 'balanced', 'direct']).default('balanced'),
});

type Traits = z.infer<typeof traitsSchema>;

/**
 * Example interaction for personality calibration.
 */
const personalityExampleSchema = z.object({
  userInput: z.string(),
  idealResponse: z.string(),
  explanation: z.string().optional(),
});

type PersonalityExample = z.infer<typeof personalityExampleSchema>;

/**
 * Full personality configuration.
 */
const personalityConfigSchema = z.object({
  id: z.string().default('default'),
  name: z.string().default('GLaDOS'),
  role: z.string().default('personal assistant'),
  style: styleSchema.optional().default({
    formality: 'professional',
    verbosity: 'balanced',
    humor: 'subtle',
    emoji: 'never',
  }),
  traits: traitsSchema.optional().default({
    proactivity: 'suggestive',
    confidence: 'balanced',
    directness: 'balanced',
  }),
  coreInstructions: z.string().optional(),
  topicGuidelines: z.record(z.string(), z.string()).optional().default({}),
  examples: z.array(personalityExampleSchema).optional().default([]),
});

type PersonalityConfig = z.infer<typeof personalityConfigSchema>;

/**
 * Input for creating a personality config.
 */
const createPersonalityInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  role: z.string().optional(),
  style: styleSchema.partial().optional(),
  traits: traitsSchema.partial().optional(),
  coreInstructions: z.string().optional(),
  topicGuidelines: z.record(z.string(), z.string()).optional(),
  examples: z.array(personalityExampleSchema).optional(),
});

type CreatePersonalityInput = z.infer<typeof createPersonalityInputSchema>;

/**
 * Input for updating a personality config.
 */
const updatePersonalityInputSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.string().optional(),
  style: styleSchema.partial().optional(),
  traits: traitsSchema.partial().optional(),
  coreInstructions: z.string().nullable().optional(),
  topicGuidelines: z.record(z.string(), z.string()).optional(),
  examples: z.array(personalityExampleSchema).optional(),
});

type UpdatePersonalityInput = z.infer<typeof updatePersonalityInputSchema>;

/**
 * Database row representation.
 */
const personalityRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  style: z.string(), // JSON string
  traits: z.string(), // JSON string
  core_instructions: z.string().nullable(),
  topic_guidelines: z.string().nullable(), // JSON string
  examples: z.string().nullable(), // JSON string
  created_at: z.string(),
  updated_at: z.string(),
});

type PersonalityRow = z.infer<typeof personalityRowSchema>;

export type {
  Style,
  Traits,
  PersonalityExample,
  PersonalityConfig,
  CreatePersonalityInput,
  UpdatePersonalityInput,
  PersonalityRow,
};

export {
  styleSchema,
  traitsSchema,
  personalityExampleSchema,
  personalityConfigSchema,
  createPersonalityInputSchema,
  updatePersonalityInputSchema,
  personalityRowSchema,
};
