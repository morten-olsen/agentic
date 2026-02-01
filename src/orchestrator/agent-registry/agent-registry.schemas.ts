import { z } from 'zod';

// ============================================================================
// Model Tier
// ============================================================================

const modelTierSchema = z.enum(['fast', 'balanced', 'capable', 'premium']);

type ModelTier = z.infer<typeof modelTierSchema>;

// ============================================================================
// Risk Level (matches tools system)
// ============================================================================

const riskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);

type RiskLevel = z.infer<typeof riskLevelSchema>;

// ============================================================================
// Agent Specification
// ============================================================================

const agentSpecificationSchema = z.object({
  id: z.string(),
  name: z.string(),
  purpose: z.string(),

  // Configuration
  systemPrompt: z.string(),
  tools: z.array(z.string()), // Tool IDs available to this agent
  modelTier: modelTierSchema,

  // Constraints
  maxTurns: z.number().int().positive(),
  canAskUser: z.boolean(),
  riskCeiling: riskLevelSchema, // Max risk level it can execute

  // Evolution
  createdAt: z.string(),
  updatedAt: z.string(),
  lastUsedAt: z.string().optional(),
  useCount: z.number().int().min(0),
  feedbackScore: z.number().min(0).max(1), // Running average of outcomes

  // Lineage
  createdBy: z.enum(['builtin', 'agent_builder']),
  parentAgentId: z.string().optional(), // If evolved from another
});

type AgentSpecification = z.infer<typeof agentSpecificationSchema>;

// ============================================================================
// Create Agent Input
// ============================================================================

const createAgentInputSchema = z.object({
  name: z.string().min(1),
  purpose: z.string().min(1),
  systemPrompt: z.string().min(1),
  tools: z.array(z.string()).optional().default([]),
  modelTier: modelTierSchema.optional().default('balanced'),
  maxTurns: z.number().int().positive().optional().default(10),
  canAskUser: z.boolean().optional().default(false),
  riskCeiling: riskLevelSchema.optional().default('medium'),
  createdBy: z.enum(['builtin', 'agent_builder']).optional().default('builtin'),
  parentAgentId: z.string().optional(),
});

type CreateAgentInput = z.input<typeof createAgentInputSchema>;

// ============================================================================
// Update Agent Input
// ============================================================================

const updateAgentInputSchema = z.object({
  name: z.string().min(1).optional(),
  purpose: z.string().min(1).optional(),
  systemPrompt: z.string().min(1).optional(),
  tools: z.array(z.string()).optional(),
  modelTier: modelTierSchema.optional(),
  maxTurns: z.number().int().positive().optional(),
  canAskUser: z.boolean().optional(),
  riskCeiling: riskLevelSchema.optional(),
});

type UpdateAgentInput = z.infer<typeof updateAgentInputSchema>;

// ============================================================================
// Agent Feedback
// ============================================================================

const feedbackOutcomeSchema = z.enum(['success', 'partial', 'failure']);

type FeedbackOutcome = z.infer<typeof feedbackOutcomeSchema>;

const agentFeedbackSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  taskId: z.string().optional(),
  outcome: feedbackOutcomeSchema,
  userRating: z.number().int().min(1).max(5).optional(), // 1-5 if user provided
  notes: z.string().optional(),
  createdAt: z.string(),
});

type AgentFeedback = z.infer<typeof agentFeedbackSchema>;

// ============================================================================
// Record Feedback Input
// ============================================================================

const recordFeedbackInputSchema = z.object({
  agentId: z.string(),
  taskId: z.string().optional(),
  outcome: feedbackOutcomeSchema,
  userRating: z.number().int().min(1).max(5).optional(),
  notes: z.string().optional(),
});

type RecordFeedbackInput = z.input<typeof recordFeedbackInputSchema>;

// ============================================================================
// Database Rows
// ============================================================================

const agentRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  purpose: z.string(),
  system_prompt: z.string(),
  tools: z.string(), // JSON
  model_tier: z.string(),
  max_turns: z.number(),
  can_ask_user: z.number(), // SQLite boolean
  risk_ceiling: z.string(),
  created_by: z.string(),
  parent_agent_id: z.string().nullable(),
  use_count: z.number(),
  feedback_score: z.number(),
  last_used_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

type AgentRow = z.infer<typeof agentRowSchema>;

const feedbackRowSchema = z.object({
  id: z.string(),
  agent_id: z.string(),
  task_id: z.string().nullable(),
  outcome: z.string(),
  user_rating: z.number().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
});

type FeedbackRow = z.infer<typeof feedbackRowSchema>;

// ============================================================================
// Exports
// ============================================================================

export type {
  ModelTier,
  RiskLevel,
  AgentSpecification,
  CreateAgentInput,
  UpdateAgentInput,
  FeedbackOutcome,
  AgentFeedback,
  RecordFeedbackInput,
  AgentRow,
  FeedbackRow,
};

export {
  modelTierSchema,
  riskLevelSchema,
  agentSpecificationSchema,
  createAgentInputSchema,
  updateAgentInputSchema,
  feedbackOutcomeSchema,
  agentFeedbackSchema,
  recordFeedbackInputSchema,
  agentRowSchema,
  feedbackRowSchema,
};
