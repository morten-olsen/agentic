import { z } from 'zod';

// ============================================================================
// Template Status
// ============================================================================

const templateStatusSchema = z.enum(['active', 'dormant', 'retired']);

type TemplateStatus = z.infer<typeof templateStatusSchema>;

// ============================================================================
// Outcome Signal
// ============================================================================

const outcomeSignalSchema = z.enum(['positive', 'negative', 'neutral', 'correction']);

type OutcomeSignal = z.infer<typeof outcomeSignalSchema>;

// ============================================================================
// Strategy
// ============================================================================

const strategySchema = z.object({
  approach: z.string(),
  guidelines: z.array(z.string()),
  tone: z.string().optional(),
  timing: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});

type Strategy = z.infer<typeof strategySchema>;

// ============================================================================
// Situation
// ============================================================================

const situationSchema = z.object({
  description: z.string(),
  category: z.string(),
  triggerPatterns: z.array(z.string()),
});

type Situation = z.infer<typeof situationSchema>;

// ============================================================================
// Last Outcome Entry (rolling window element)
// ============================================================================

const lastOutcomeEntrySchema = z.object({
  timestamp: z.string(),
  signal: outcomeSignalSchema,
  detail: z.string(),
  strategyChange: z.string().optional(),
});

type LastOutcomeEntry = z.infer<typeof lastOutcomeEntrySchema>;

// ============================================================================
// Evidence
// ============================================================================

const evidenceSchema = z.object({
  totalInteractions: z.number(),
  positiveOutcomes: z.number(),
  negativeOutcomes: z.number(),
  neutralOutcomes: z.number(),
  lastOutcomes: z.array(lastOutcomeEntrySchema).default([]),
  confidenceScore: z.number().min(0).max(1),
});

type Evidence = z.infer<typeof evidenceSchema>;

// ============================================================================
// Behavioral Template
// ============================================================================

const behavioralTemplateSchema = z.object({
  id: z.string(),
  situation: situationSchema,
  strategy: strategySchema,
  evidence: evidenceSchema,
  embedding: z.array(z.number()).optional(),
  activationScore: z.number().min(0).max(1),
  status: templateStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  lastMatchedAt: z.string().optional(),
});

type BehavioralTemplate = z.infer<typeof behavioralTemplateSchema>;

// ============================================================================
// Outcome Record
// ============================================================================

const outcomeContextSchema = z.object({
  conversationId: z.string().optional(),
  triggerId: z.string().optional(),
  timeOfDay: z.string(),
  dayOfWeek: z.string(),
});

type OutcomeContext = z.infer<typeof outcomeContextSchema>;

const outcomeRecordSchema = z.object({
  id: z.string(),
  templateId: z.string(),
  action: z.string(),
  signal: outcomeSignalSchema,
  detail: z.string(),
  strategyChange: z.string().optional(),
  context: outcomeContextSchema,
  createdAt: z.string(),
});

type OutcomeRecord = z.infer<typeof outcomeRecordSchema>;

// ============================================================================
// Pending Outcome
// ============================================================================

const pendingOutcomeStatusSchema = z.enum(['pending', 'resolved', 'expired']);

type PendingOutcomeStatus = z.infer<typeof pendingOutcomeStatusSchema>;

const pendingOutcomeSchema = z.object({
  id: z.string(),
  templateId: z.string(),
  action: z.string(),
  summary: z.string(),
  sourceConversationId: z.string(),
  triggerId: z.string().optional(),
  status: pendingOutcomeStatusSchema,
  createdAt: z.string(),
  expiresAt: z.string(),
  resolvedAt: z.string().optional(),
  resolvedOutcomeId: z.string().optional(),
});

type PendingOutcome = z.infer<typeof pendingOutcomeSchema>;

// ============================================================================
// Input Schemas (for create/update operations)
// ============================================================================

const createTemplateInputSchema = z.object({
  situation: situationSchema,
  strategy: strategySchema,
  initialOutcome: z
    .object({
      signal: outcomeSignalSchema,
      detail: z.string(),
    })
    .optional(),
});

type CreateTemplateInput = z.input<typeof createTemplateInputSchema>;

const recordOutcomeInputSchema = z.object({
  templateId: z.string().optional(),
  pendingOutcomeId: z.string().optional(),
  action: z.string(),
  signal: outcomeSignalSchema,
  detail: z.string(),
  strategyChange: z.string().optional(),
});

type RecordOutcomeInput = z.infer<typeof recordOutcomeInputSchema>;

const createPendingOutcomeInputSchema = z.object({
  templateId: z.string(),
  action: z.string(),
  summary: z.string(),
  sourceConversationId: z.string(),
  triggerId: z.string().optional(),
});

type CreatePendingOutcomeInput = z.infer<typeof createPendingOutcomeInputSchema>;

// ============================================================================
// Configuration
// ============================================================================

const behavioralMemoryConfigSchema = z.object({
  maxTemplatesInIndex: z.number().optional().default(10),
  maxPendingInIndex: z.number().optional().default(10),
  lastOutcomesWindowSize: z.number().optional().default(20),
  activationDecayRate: z.number().optional().default(0.01),
  retirementThreshold: z.number().optional().default(0.1),
  retirementMinInteractions: z.number().optional().default(10),
  pendingOutcomeExpirationHours: z.number().optional().default(24),
});

type BehavioralMemoryConfig = z.infer<typeof behavioralMemoryConfigSchema>;

// ============================================================================
// Search Result
// ============================================================================

type TemplateSearchResult = BehavioralTemplate & {
  similarity: number;
};

// ============================================================================
// Exports
// ============================================================================

export type {
  TemplateStatus,
  OutcomeSignal,
  Strategy,
  Situation,
  LastOutcomeEntry,
  Evidence,
  BehavioralTemplate,
  OutcomeContext,
  OutcomeRecord,
  PendingOutcomeStatus,
  PendingOutcome,
  CreateTemplateInput,
  RecordOutcomeInput,
  CreatePendingOutcomeInput,
  BehavioralMemoryConfig,
  TemplateSearchResult,
};

export {
  templateStatusSchema,
  outcomeSignalSchema,
  strategySchema,
  situationSchema,
  lastOutcomeEntrySchema,
  evidenceSchema,
  behavioralTemplateSchema,
  outcomeContextSchema,
  outcomeRecordSchema,
  pendingOutcomeStatusSchema,
  pendingOutcomeSchema,
  createTemplateInputSchema,
  recordOutcomeInputSchema,
  createPendingOutcomeInputSchema,
  behavioralMemoryConfigSchema,
};
