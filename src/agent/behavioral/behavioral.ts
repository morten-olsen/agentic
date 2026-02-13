import type { Services } from '../../core/services/services.ts';
import { DatabaseService } from '../../core/database/database.ts';
import { createDefaultEmbeddingService } from '../../agent/embeddings/embeddings.ts';

import type {
  BehavioralTemplate,
  CreateTemplateInput,
  RecordOutcomeInput,
  CreatePendingOutcomeInput,
  PendingOutcome,
  OutcomeRecord,
  OutcomeContext,
  BehavioralMemoryConfig,
  TemplateSearchResult,
  Strategy,
} from './behavioral.schemas.ts';
import { behavioralMemoryConfigSchema } from './behavioral.schemas.ts';
import * as store from './behavioral.store.ts';

// ============================================================================
// Embedding Provider (DI-injectable)
// ============================================================================

/**
 * Embedding provider for behavioral memory. Lives in the DI container
 * so tests can replace it with a mock via services.set().
 */
class BehavioralEmbeddingProvider {
  #inner: { embedQuery: (text: string) => Promise<number[]>; dimensions: number };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(services: Services) {
    this.#inner = createDefaultEmbeddingService();
  }

  embedQuery = (text: string): Promise<number[]> => this.#inner.embedQuery(text);

  get dimensions(): number {
    return this.#inner.dimensions;
  }
}

// ============================================================================
// Helpers
// ============================================================================

const generateId = (): string => crypto.randomUUID();
const now = (): string => new Date().toISOString();

const formatTimeAgo = (isoTimestamp: string): string => {
  const then = new Date(isoTimestamp);
  const diffMs = Date.now() - then.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
};

const calculateConfidence = (template: BehavioralTemplate): number => {
  const { totalInteractions, positiveOutcomes, negativeOutcomes } = template.evidence;
  if (totalInteractions === 0) return 0.3;

  const positiveRate = positiveOutcomes / totalInteractions;
  const negativeRate = negativeOutcomes / totalInteractions;

  // Base confidence from positive rate, penalized by negative rate
  let confidence = positiveRate - negativeRate * 0.5;

  // Boost for more interactions (more data = more confidence)
  const interactionBoost = Math.min(0.2, totalInteractions * 0.02);
  confidence += interactionBoost;

  return Math.max(0, Math.min(1, confidence));
};

// ============================================================================
// Service
// ============================================================================

class BehavioralMemoryService {
  #services: Services;
  #config: BehavioralMemoryConfig;

  constructor(services: Services) {
    this.#services = services;
    this.#config = behavioralMemoryConfigSchema.parse({});
  }

  // --------------------------------------------------------------------------
  // Dependencies
  // --------------------------------------------------------------------------

  #getEmbeddings = (): BehavioralEmbeddingProvider => {
    return this.#services.get(BehavioralEmbeddingProvider);
  };

  #getKnex = (): import('knex').Knex => {
    return this.#services.get(DatabaseService).knex;
  };

  // --------------------------------------------------------------------------
  // Template CRUD
  // --------------------------------------------------------------------------

  createTemplate = async (input: CreateTemplateInput): Promise<BehavioralTemplate> => {
    const embeddings = this.#getEmbeddings();
    const knex = this.#getKnex();
    const id = generateId();
    const timestamp = now();

    // Generate embedding from situation description + trigger patterns
    const embeddingText = [input.situation.description, ...input.situation.triggerPatterns].join(' ');
    const embedding = await embeddings.embedQuery(embeddingText);

    const hasInitialOutcome = !!input.initialOutcome;
    const signal = input.initialOutcome?.signal;

    const template: BehavioralTemplate = {
      id,
      situation: input.situation,
      strategy: input.strategy,
      evidence: {
        totalInteractions: hasInitialOutcome ? 1 : 0,
        positiveOutcomes: signal === 'positive' ? 1 : 0,
        negativeOutcomes: signal === 'negative' || signal === 'correction' ? 1 : 0,
        neutralOutcomes: signal === 'neutral' ? 1 : 0,
        lastOutcomes:
          hasInitialOutcome && input.initialOutcome
            ? [
                {
                  timestamp,
                  signal: input.initialOutcome.signal,
                  detail: input.initialOutcome.detail,
                },
              ]
            : [],
        confidenceScore: 0.3,
      },
      embedding,
      activationScore: 0.5,
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await store.createTemplate(knex, template);
    return template;
  };

  getTemplate = async (id: string): Promise<BehavioralTemplate | null> => {
    return store.getTemplate(this.#getKnex(), id);
  };

  getTemplateCount = async (): Promise<number> => {
    return store.getTemplateCount(this.#getKnex());
  };

  searchTemplates = async (embedding: number[], options?: { limit?: number }): Promise<TemplateSearchResult[]> => {
    return store.searchTemplatesByEmbedding(this.#getKnex(), embedding, {
      limit: options?.limit ?? this.#config.maxTemplatesInIndex,
    });
  };

  searchTemplatesByQuery = async (query: string, options?: { limit?: number }): Promise<TemplateSearchResult[]> => {
    const embeddings = this.#getEmbeddings();
    const embedding = await embeddings.embedQuery(query);
    return this.searchTemplates(embedding, options);
  };

  // --------------------------------------------------------------------------
  // Outcome Recording
  // --------------------------------------------------------------------------

  recordOutcome = async (input: RecordOutcomeInput): Promise<OutcomeRecord> => {
    const knex = this.#getKnex();
    let templateId = input.templateId;

    // If resolving a pending outcome, get the template ID from it
    if (input.pendingOutcomeId) {
      const pending = await store.getPendingOutcome(knex, input.pendingOutcomeId);
      if (!pending) {
        throw new Error(`Pending outcome not found: ${input.pendingOutcomeId}`);
      }
      templateId = pending.templateId;
    }

    if (!templateId) {
      throw new Error('Either templateId or pendingOutcomeId must be provided');
    }

    const currentTime = now();
    const date = new Date();

    const outcome: OutcomeRecord = {
      id: generateId(),
      templateId,
      action: input.action,
      signal: input.signal,
      detail: input.detail,
      strategyChange: input.strategyChange,
      context: {
        timeOfDay: `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`,
        dayOfWeek:
          ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()] ?? 'Unknown',
      } satisfies OutcomeContext,
      createdAt: currentTime,
    };

    // Save outcome
    await store.saveOutcome(knex, outcome);

    // Update template evidence
    await store.incrementOutcome(knex, templateId, input.signal);
    await store.appendToLastOutcomes(
      knex,
      templateId,
      {
        timestamp: currentTime,
        signal: input.signal,
        detail: input.detail,
        strategyChange: input.strategyChange,
      },
      this.#config.lastOutcomesWindowSize,
    );

    // Boost activation on use
    const template = await store.getTemplate(knex, templateId);
    if (template) {
      const newActivation = Math.min(1, template.activationScore + 0.1);
      await store.updateActivation(knex, templateId, newActivation);
      await store.updateLastMatchedAt(knex, templateId);

      // Recalculate confidence
      const updatedTemplate = await store.getTemplate(knex, templateId);
      if (updatedTemplate) {
        const newConfidence = calculateConfidence(updatedTemplate);
        await store.updateConfidence(knex, templateId, newConfidence);
      }
    }

    // Apply strategy change if provided
    if (input.strategyChange && template) {
      // The strategyChange is a description of what changed — apply it by
      // merging into the existing strategy's approach
      const updatedStrategy: Strategy = {
        ...template.strategy,
        approach: input.strategyChange,
      };
      await store.updateStrategy(knex, templateId, updatedStrategy);
    }

    // Resolve pending outcome if applicable
    if (input.pendingOutcomeId) {
      await store.resolvePendingOutcome(knex, input.pendingOutcomeId, outcome.id);
    }

    return outcome;
  };

  // --------------------------------------------------------------------------
  // Pending Outcomes
  // --------------------------------------------------------------------------

  createPendingOutcome = async (input: CreatePendingOutcomeInput): Promise<PendingOutcome> => {
    const knex = this.#getKnex();
    const timestamp = now();
    const expiresAt = new Date(Date.now() + this.#config.pendingOutcomeExpirationHours * 60 * 60 * 1000).toISOString();

    const pending: PendingOutcome = {
      id: generateId(),
      templateId: input.templateId,
      action: input.action,
      summary: input.summary,
      sourceConversationId: input.sourceConversationId,
      triggerId: input.triggerId,
      status: 'pending',
      createdAt: timestamp,
      expiresAt,
    };

    await store.savePendingOutcome(knex, pending);
    return pending;
  };

  getPendingOutcomes = async (): Promise<PendingOutcome[]> => {
    return store.getPendingOutcomes(this.#getKnex());
  };

  // --------------------------------------------------------------------------
  // Context Index
  // --------------------------------------------------------------------------

  buildContextIndex = async (conversationContext: string): Promise<string> => {
    const knex = this.#getKnex();

    const [pendingOutcomes, totalTemplates] = await Promise.all([
      store.getPendingOutcomes(knex),
      store.getTemplateCount(knex),
    ]);

    const parts: string[] = ['## Behavioral Templates\n'];

    // Pending outcomes first — these need attention
    if (pendingOutcomes.length > 0) {
      const shown = pendingOutcomes.slice(0, this.#config.maxPendingInIndex);
      parts.push('### Awaiting Feedback');
      parts.push("When the user's response relates to one of these, record the outcome.\n");
      for (const po of shown) {
        const ago = formatTimeAgo(po.createdAt);
        parts.push(`- **${po.summary}** [pending:${po.id}] (template: ${po.templateId}, ${ago})`);
      }
      parts.push('');
    }

    if (totalTemplates === 0 && pendingOutcomes.length === 0) {
      return '## Behavioral Templates\n\nNo behavioral templates yet.\n';
    }

    if (totalTemplates > 0) {
      try {
        const embeddings = this.#getEmbeddings();
        const contextEmbedding = await embeddings.embedQuery(conversationContext);
        const relevant = await store.searchTemplatesByEmbedding(knex, contextEmbedding, {
          limit: this.#config.maxTemplatesInIndex,
        });

        if (relevant.length > 0) {
          parts.push(`Relevant templates (${relevant.length} of ${totalTemplates} total):`);
          for (const t of relevant) {
            const confidence = t.evidence.confidenceScore.toFixed(1);
            parts.push(`- ${t.situation.description} [${t.id}] (confidence: ${confidence})`);
          }
          parts.push('');
          parts.push(
            "Use behavioral.getTemplate to fetch full strategy. Use behavioral.searchTemplates if needed template isn't listed.",
          );
        }
      } catch {
        // Graceful degradation if embedding fails
        parts.push(`${totalTemplates} template(s) available. Use behavioral.searchTemplates to find relevant ones.`);
      }
    }

    return parts.join('\n');
  };

  // --------------------------------------------------------------------------
  // Maintenance
  // --------------------------------------------------------------------------

  applyActivationDecay = async (): Promise<number> => {
    return store.applyActivationDecay(this.#getKnex(), this.#config.activationDecayRate);
  };

  expireAndRecordPendingOutcomes = async (): Promise<PendingOutcome[]> => {
    const knex = this.#getKnex();
    const expired = await store.expirePendingOutcomes(knex);

    // Record expired pending outcomes as neutral
    for (const pending of expired) {
      const outcome: OutcomeRecord = {
        id: generateId(),
        templateId: pending.templateId,
        action: pending.action,
        signal: 'neutral',
        detail: 'No user feedback within expiration window',
        context: {
          timeOfDay: 'maintenance',
          dayOfWeek: 'maintenance',
        },
        createdAt: now(),
      };
      await store.saveOutcome(knex, outcome);
      await store.incrementOutcome(knex, pending.templateId, 'neutral');
    }

    return expired;
  };

  retirePoorTemplates = async (): Promise<BehavioralTemplate[]> => {
    const knex = this.#getKnex();
    const poor = await store.findPoorTemplates(knex, {
      minInteractions: this.#config.retirementMinInteractions,
      maxPositiveRate: this.#config.retirementThreshold,
    });

    for (const template of poor) {
      await store.updateStatus(knex, template.id, 'retired');
    }

    return poor;
  };
}

// ============================================================================
// Exports
// ============================================================================

// Re-export types and schemas
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
} from './behavioral.schemas.ts';

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
} from './behavioral.schemas.ts';

export { BehavioralMemoryService, BehavioralEmbeddingProvider, calculateConfidence, formatTimeAgo };
