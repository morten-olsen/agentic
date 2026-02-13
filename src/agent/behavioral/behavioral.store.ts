import type { Knex } from 'knex';

import { cosineSimilarity } from '../../core/store/store.ts';

import type {
  BehavioralTemplate,
  Strategy,
  LastOutcomeEntry,
  OutcomeRecord,
  PendingOutcome,
  TemplateSearchResult,
  OutcomeSignal,
  TemplateStatus,
} from './behavioral.schemas.ts';

// ============================================================================
// Row Types
// ============================================================================

type TemplateRow = {
  id: string;
  situation_description: string;
  situation_category: string;
  trigger_patterns: string;
  strategy: string;
  total_interactions: number;
  positive_outcomes: number;
  negative_outcomes: number;
  neutral_outcomes: number;
  last_outcomes: string;
  confidence_score: number;
  embedding: Buffer | null;
  activation_score: number;
  status: string;
  created_at: string;
  updated_at: string;
  last_matched_at: string | null;
};

type OutcomeRow = {
  id: string;
  template_id: string;
  action: string;
  signal: string;
  detail: string;
  strategy_change: string | null;
  context: string;
  created_at: string;
};

type PendingOutcomeRow = {
  id: string;
  template_id: string;
  action: string;
  summary: string;
  source_conversation_id: string;
  trigger_id: string | null;
  status: string;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
  resolved_outcome_id: string | null;
};

// ============================================================================
// Helpers
// ============================================================================

const now = (): string => new Date().toISOString();

const embeddingToBuffer = (embedding: number[]): Buffer => {
  const float32 = new Float32Array(embedding);
  return Buffer.from(float32.buffer);
};

const bufferToEmbedding = (buffer: Buffer): number[] => {
  const float32 = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
  return Array.from(float32);
};

const templateFromRow = (row: TemplateRow): BehavioralTemplate => ({
  id: row.id,
  situation: {
    description: row.situation_description,
    category: row.situation_category,
    triggerPatterns: JSON.parse(row.trigger_patterns) as string[],
  },
  strategy: JSON.parse(row.strategy) as Strategy,
  evidence: {
    totalInteractions: row.total_interactions,
    positiveOutcomes: row.positive_outcomes,
    negativeOutcomes: row.negative_outcomes,
    neutralOutcomes: row.neutral_outcomes,
    lastOutcomes: JSON.parse(row.last_outcomes) as LastOutcomeEntry[],
    confidenceScore: row.confidence_score,
  },
  embedding: row.embedding ? bufferToEmbedding(row.embedding) : undefined,
  activationScore: row.activation_score,
  status: row.status as BehavioralTemplate['status'],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastMatchedAt: row.last_matched_at ?? undefined,
});

const pendingFromRow = (row: PendingOutcomeRow): PendingOutcome => ({
  id: row.id,
  templateId: row.template_id,
  action: row.action,
  summary: row.summary,
  sourceConversationId: row.source_conversation_id,
  triggerId: row.trigger_id ?? undefined,
  status: row.status as PendingOutcome['status'],
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  resolvedAt: row.resolved_at ?? undefined,
  resolvedOutcomeId: row.resolved_outcome_id ?? undefined,
});

// ============================================================================
// Template Operations
// ============================================================================

const createTemplate = async (knex: Knex, template: BehavioralTemplate): Promise<BehavioralTemplate> => {
  const row: TemplateRow = {
    id: template.id,
    situation_description: template.situation.description,
    situation_category: template.situation.category,
    trigger_patterns: JSON.stringify(template.situation.triggerPatterns),
    strategy: JSON.stringify(template.strategy),
    total_interactions: template.evidence.totalInteractions,
    positive_outcomes: template.evidence.positiveOutcomes,
    negative_outcomes: template.evidence.negativeOutcomes,
    neutral_outcomes: template.evidence.neutralOutcomes,
    last_outcomes: JSON.stringify(template.evidence.lastOutcomes),
    confidence_score: template.evidence.confidenceScore,
    embedding: template.embedding ? embeddingToBuffer(template.embedding) : null,
    activation_score: template.activationScore,
    status: template.status,
    created_at: template.createdAt,
    updated_at: template.updatedAt,
    last_matched_at: template.lastMatchedAt ?? null,
  };

  await knex('behavioral_templates').insert(row);
  return template;
};

const getTemplate = async (knex: Knex, id: string): Promise<BehavioralTemplate | null> => {
  const row = await knex<TemplateRow>('behavioral_templates').where('id', id).first();
  return row ? templateFromRow(row) : null;
};

const getTemplateCount = async (knex: Knex): Promise<number> => {
  const result = await knex('behavioral_templates').where('status', 'active').count('* as count').first();
  return (result?.count as number) ?? 0;
};

type SearchByEmbeddingOptions = {
  limit?: number;
  minSimilarity?: number;
  status?: TemplateStatus;
};

const searchTemplatesByEmbedding = async (
  knex: Knex,
  embedding: number[],
  options: SearchByEmbeddingOptions = {},
): Promise<TemplateSearchResult[]> => {
  const { limit = 10, minSimilarity = 0, status = 'active' } = options;

  const rows = await knex<TemplateRow>('behavioral_templates').where('status', status).whereNotNull('embedding');

  const scored: TemplateSearchResult[] = [];
  for (const row of rows) {
    if (!row.embedding) continue;
    const rowEmbedding = bufferToEmbedding(row.embedding);
    const similarity = cosineSimilarity(embedding, rowEmbedding);
    if (similarity >= minSimilarity) {
      scored.push({ ...templateFromRow(row), similarity });
    }
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
};

const updateStrategy = async (knex: Knex, id: string, strategy: Strategy): Promise<void> => {
  await knex('behavioral_templates')
    .where('id', id)
    .update({
      strategy: JSON.stringify(strategy),
      updated_at: now(),
    });
};

const incrementOutcome = async (knex: Knex, id: string, signal: OutcomeSignal): Promise<void> => {
  const column =
    signal === 'positive'
      ? 'positive_outcomes'
      : signal === 'negative' || signal === 'correction'
        ? 'negative_outcomes'
        : 'neutral_outcomes';

  await knex('behavioral_templates')
    .where('id', id)
    .update({
      total_interactions: knex.raw('total_interactions + 1'),
      [column]: knex.raw(`${column} + 1`),
      updated_at: now(),
    });
};

const appendToLastOutcomes = async (
  knex: Knex,
  id: string,
  outcome: LastOutcomeEntry,
  maxSize: number,
): Promise<void> => {
  const row = await knex<TemplateRow>('behavioral_templates').where('id', id).select('last_outcomes').first();
  if (!row) return;

  const outcomes = JSON.parse(row.last_outcomes) as LastOutcomeEntry[];
  outcomes.push(outcome);
  while (outcomes.length > maxSize) {
    outcomes.shift();
  }

  await knex('behavioral_templates')
    .where('id', id)
    .update({
      last_outcomes: JSON.stringify(outcomes),
      updated_at: now(),
    });
};

const updateConfidence = async (knex: Knex, id: string, score: number): Promise<void> => {
  await knex('behavioral_templates')
    .where('id', id)
    .update({
      confidence_score: Math.max(0, Math.min(1, score)),
      updated_at: now(),
    });
};

const updateActivation = async (knex: Knex, id: string, score: number): Promise<void> => {
  await knex('behavioral_templates')
    .where('id', id)
    .update({
      activation_score: Math.max(0, Math.min(1, score)),
      updated_at: now(),
    });
};

const updateLastMatchedAt = async (knex: Knex, id: string): Promise<void> => {
  await knex('behavioral_templates').where('id', id).update({
    last_matched_at: now(),
    updated_at: now(),
  });
};

const applyActivationDecay = async (knex: Knex, rate: number): Promise<number> => {
  const result = await knex('behavioral_templates')
    .where('status', 'active')
    .where('activation_score', '>', 0)
    .update({
      activation_score: knex.raw('MAX(0, activation_score - ?)', [rate]),
      updated_at: now(),
    });
  return result;
};

const updateStatus = async (knex: Knex, id: string, status: TemplateStatus): Promise<void> => {
  await knex('behavioral_templates').where('id', id).update({
    status,
    updated_at: now(),
  });
};

type FindPoorTemplatesOptions = {
  minInteractions?: number;
  maxPositiveRate?: number;
};

const findPoorTemplates = async (knex: Knex, options: FindPoorTemplatesOptions = {}): Promise<BehavioralTemplate[]> => {
  const { minInteractions = 10, maxPositiveRate = 0.1 } = options;

  const rows = await knex<TemplateRow>('behavioral_templates')
    .where('status', 'active')
    .where('total_interactions', '>=', minInteractions);

  return rows.map(templateFromRow).filter((t) => {
    const positiveRate =
      t.evidence.totalInteractions > 0 ? t.evidence.positiveOutcomes / t.evidence.totalInteractions : 0;
    return positiveRate <= maxPositiveRate;
  });
};

// ============================================================================
// Outcome Operations
// ============================================================================

const saveOutcome = async (knex: Knex, outcome: OutcomeRecord): Promise<OutcomeRecord> => {
  const row: OutcomeRow = {
    id: outcome.id,
    template_id: outcome.templateId,
    action: outcome.action,
    signal: outcome.signal,
    detail: outcome.detail,
    strategy_change: outcome.strategyChange ?? null,
    context: JSON.stringify(outcome.context),
    created_at: outcome.createdAt,
  };

  await knex('behavioral_outcomes').insert(row);
  return outcome;
};

// ============================================================================
// Pending Outcome Operations
// ============================================================================

const savePendingOutcome = async (knex: Knex, pending: PendingOutcome): Promise<PendingOutcome> => {
  const row: PendingOutcomeRow = {
    id: pending.id,
    template_id: pending.templateId,
    action: pending.action,
    summary: pending.summary,
    source_conversation_id: pending.sourceConversationId,
    trigger_id: pending.triggerId ?? null,
    status: pending.status,
    created_at: pending.createdAt,
    expires_at: pending.expiresAt,
    resolved_at: pending.resolvedAt ?? null,
    resolved_outcome_id: pending.resolvedOutcomeId ?? null,
  };

  await knex('behavioral_pending_outcomes').insert(row);
  return pending;
};

const getPendingOutcome = async (knex: Knex, id: string): Promise<PendingOutcome | null> => {
  const row = await knex<PendingOutcomeRow>('behavioral_pending_outcomes').where('id', id).first();
  return row ? pendingFromRow(row) : null;
};

const getPendingOutcomes = async (knex: Knex): Promise<PendingOutcome[]> => {
  const rows = await knex<PendingOutcomeRow>('behavioral_pending_outcomes')
    .where('status', 'pending')
    .orderBy('created_at', 'desc');
  return rows.map(pendingFromRow);
};

const resolvePendingOutcome = async (knex: Knex, id: string, outcomeId: string): Promise<void> => {
  await knex('behavioral_pending_outcomes').where('id', id).update({
    status: 'resolved',
    resolved_at: now(),
    resolved_outcome_id: outcomeId,
  });
};

const expirePendingOutcomes = async (knex: Knex): Promise<PendingOutcome[]> => {
  const currentTime = now();

  // Find pending outcomes that have expired
  const expiredRows = await knex<PendingOutcomeRow>('behavioral_pending_outcomes')
    .where('status', 'pending')
    .where('expires_at', '<=', currentTime);

  if (expiredRows.length === 0) return [];

  const expiredIds = expiredRows.map((r) => r.id);

  // Mark them as expired
  await knex('behavioral_pending_outcomes').whereIn('id', expiredIds).update({ status: 'expired' });

  return expiredRows.map(pendingFromRow);
};

// ============================================================================
// Exports
// ============================================================================

export {
  // Template operations
  createTemplate,
  getTemplate,
  getTemplateCount,
  searchTemplatesByEmbedding,
  updateStrategy,
  incrementOutcome,
  appendToLastOutcomes,
  updateConfidence,
  updateActivation,
  updateLastMatchedAt,
  applyActivationDecay,
  updateStatus,
  findPoorTemplates,
  // Outcome operations
  saveOutcome,
  // Pending outcome operations
  savePendingOutcome,
  getPendingOutcome,
  getPendingOutcomes,
  resolvePendingOutcome,
  expirePendingOutcomes,
  // Helpers (for testing)
  embeddingToBuffer,
  bufferToEmbedding,
  templateFromRow,
};
