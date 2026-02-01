import { z } from 'zod';

// ============================================================================
// Operator Step
// ============================================================================

const operatorStepSchema = z.object({
  order: z.number().int().min(1),
  description: z.string(),
  toolsUsed: z.array(z.string()).optional(),
  conditions: z.string().optional(), // When to skip or modify this step
  example: z.string().optional(), // Concrete example of this step
});

type OperatorStep = z.infer<typeof operatorStepSchema>;

// ============================================================================
// User Correction
// ============================================================================

const userCorrectionSchema = z.object({
  timestamp: z.string(),
  originalBehavior: z.string(),
  correctedBehavior: z.string(),
  context: z.string(),
});

type UserCorrection = z.infer<typeof userCorrectionSchema>;

// ============================================================================
// Operator Manual
// ============================================================================

const operatorManualSchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string(), // 'finance', 'communication', 'travel', 'meetings', etc.
  description: z.string().optional(),

  // The procedure itself
  steps: z.array(operatorStepSchema),
  bestPractices: z.array(z.string()).default([]),
  commonMistakes: z.array(z.string()).default([]),

  // User corrections and refinements
  userCorrections: z.array(userCorrectionSchema).default([]),

  // Usage tracking
  lastUsedAt: z.string().optional(),
  useCount: z.number().int().min(0),
  successRate: z.number().min(0).max(1), // 0-1, based on user feedback

  createdAt: z.string(),
  updatedAt: z.string(),
});

type OperatorManual = z.infer<typeof operatorManualSchema>;

// ============================================================================
// Create Manual Input
// ============================================================================

const createManualInputSchema = z.object({
  name: z.string().min(1),
  domain: z.string().min(1),
  description: z.string().optional(),
  steps: z.array(operatorStepSchema).min(1),
  bestPractices: z.array(z.string()).optional().default([]),
  commonMistakes: z.array(z.string()).optional().default([]),
});

type CreateManualInput = z.input<typeof createManualInputSchema>;

// ============================================================================
// Update Manual Input
// ============================================================================

const updateManualInputSchema = z.object({
  name: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
  description: z.string().optional(),
  steps: z.array(operatorStepSchema).min(1).optional(),
  bestPractices: z.array(z.string()).optional(),
  commonMistakes: z.array(z.string()).optional(),
});

type UpdateManualInput = z.infer<typeof updateManualInputSchema>;

// ============================================================================
// Add Correction Input
// ============================================================================

const addCorrectionInputSchema = z.object({
  originalBehavior: z.string(),
  correctedBehavior: z.string(),
  context: z.string(),
});

type AddCorrectionInput = z.input<typeof addCorrectionInputSchema>;

// ============================================================================
// Database Row
// ============================================================================

const manualRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string(),
  description: z.string().nullable(),
  steps: z.string(), // JSON
  best_practices: z.string().nullable(), // JSON
  common_mistakes: z.string().nullable(), // JSON
  user_corrections: z.string().nullable(), // JSON
  last_used_at: z.string().nullable(),
  use_count: z.number(),
  success_rate: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

type ManualRow = z.infer<typeof manualRowSchema>;

// ============================================================================
// Exports
// ============================================================================

export type {
  OperatorStep,
  UserCorrection,
  OperatorManual,
  CreateManualInput,
  UpdateManualInput,
  AddCorrectionInput,
  ManualRow,
};

export {
  operatorStepSchema,
  userCorrectionSchema,
  operatorManualSchema,
  createManualInputSchema,
  updateManualInputSchema,
  addCorrectionInputSchema,
  manualRowSchema,
};
