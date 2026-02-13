import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Knex } from 'knex';

import { Services } from '../../core/services/services.ts';
import { createDatabaseService, DatabaseService } from '../../core/database/database.ts';

import * as storeModule from './behavioral.store.ts';
import {
  BehavioralMemoryService,
  BehavioralEmbeddingProvider,
  calculateConfidence,
  formatTimeAgo,
} from './behavioral.ts';
import type { BehavioralTemplate, OutcomeRecord, PendingOutcome } from './behavioral.schemas.ts';

// ============================================================================
// Test Helpers
// ============================================================================

const createTestDb = async (): Promise<{
  knex: Knex;
  services: Services;
  cleanup: () => Promise<void>;
}> => {
  const services = new Services();
  const dbService = createDatabaseService(services, { path: ':memory:' });
  services.set(DatabaseService, dbService);
  await dbService.migrate();

  return {
    knex: dbService.knex,
    services,
    cleanup: async () => {
      await services.destroy();
    },
  };
};

/** Create a fake embedding of given dimension (default 4) */
const fakeEmbedding = (seed: number, dim = 4): number[] => {
  const values: number[] = [];
  for (let i = 0; i < dim; i++) {
    values.push(Math.sin(seed * (i + 1)));
  }
  // Normalize to unit vector for valid cosine similarity
  const mag = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  return values.map((v) => v / mag);
};

const makeTemplate = (overrides: Partial<BehavioralTemplate> = {}): BehavioralTemplate => ({
  id: overrides.id ?? crypto.randomUUID(),
  situation: overrides.situation ?? {
    description: 'Test situation',
    category: 'test',
    triggerPatterns: ['test pattern'],
  },
  strategy: overrides.strategy ?? {
    approach: 'Test approach',
    guidelines: ['guideline 1', 'guideline 2'],
  },
  evidence: overrides.evidence ?? {
    totalInteractions: 0,
    positiveOutcomes: 0,
    negativeOutcomes: 0,
    neutralOutcomes: 0,
    lastOutcomes: [],
    confidenceScore: 0.3,
  },
  embedding: overrides.embedding ?? fakeEmbedding(1),
  activationScore: overrides.activationScore ?? 0.5,
  status: overrides.status ?? 'active',
  createdAt: overrides.createdAt ?? new Date().toISOString(),
  updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  lastMatchedAt: overrides.lastMatchedAt,
});

// ============================================================================
// Store Tests
// ============================================================================

describe('Behavioral Store', () => {
  let knex: Knex;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = await createTestDb();
    knex = setup.knex;
    cleanup = setup.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('Template CRUD', () => {
    it('creates and retrieves a template', async () => {
      const template = makeTemplate();
      await storeModule.createTemplate(knex, template);

      const retrieved = await storeModule.getTemplate(knex, template.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(template.id);
      expect(retrieved?.situation.description).toBe('Test situation');
      expect(retrieved?.strategy.approach).toBe('Test approach');
      expect(retrieved?.evidence.confidenceScore).toBe(0.3);
    });

    it('returns null for non-existent template', async () => {
      const result = await storeModule.getTemplate(knex, 'non-existent');
      expect(result).toBeNull();
    });

    it('counts active templates', async () => {
      await storeModule.createTemplate(knex, makeTemplate({ status: 'active' }));
      await storeModule.createTemplate(knex, makeTemplate({ status: 'active' }));
      await storeModule.createTemplate(knex, makeTemplate({ status: 'retired' }));

      const count = await storeModule.getTemplateCount(knex);
      expect(count).toBe(2);
    });

    it('preserves JSON fields through round-trip', async () => {
      const template = makeTemplate({
        situation: {
          description: 'Complex situation',
          category: 'planning',
          triggerPatterns: ['pattern 1', 'pattern 2', 'pattern 3'],
        },
        strategy: {
          approach: 'Multi-step approach',
          guidelines: ['step 1', 'step 2'],
          tone: 'casual',
          timing: 'morning',
          parameters: { maxItems: 5, includeLinks: true },
        },
        evidence: {
          totalInteractions: 5,
          positiveOutcomes: 3,
          negativeOutcomes: 1,
          neutralOutcomes: 1,
          lastOutcomes: [
            { timestamp: '2024-01-01T00:00:00Z', signal: 'positive', detail: 'Good' },
            {
              timestamp: '2024-01-02T00:00:00Z',
              signal: 'negative',
              detail: 'Bad',
              strategyChange: 'Changed approach',
            },
          ],
          confidenceScore: 0.7,
        },
      });

      await storeModule.createTemplate(knex, template);
      const retrieved = await storeModule.getTemplate(knex, template.id);

      expect(retrieved?.situation.triggerPatterns).toEqual(['pattern 1', 'pattern 2', 'pattern 3']);
      expect(retrieved?.strategy.tone).toBe('casual');
      expect(retrieved?.strategy.parameters).toEqual({ maxItems: 5, includeLinks: true });
      expect(retrieved?.evidence.lastOutcomes).toHaveLength(2);
      expect(retrieved?.evidence.lastOutcomes[1]?.strategyChange).toBe('Changed approach');
    });

    it('preserves embedding through round-trip', async () => {
      const embedding = fakeEmbedding(42);
      const template = makeTemplate({ embedding });

      await storeModule.createTemplate(knex, template);
      const retrieved = await storeModule.getTemplate(knex, template.id);

      expect(retrieved?.embedding).toBeDefined();
      expect(retrieved?.embedding?.length).toBe(embedding.length);
      for (let i = 0; i < embedding.length; i++) {
        expect(retrieved?.embedding?.[i]).toBeCloseTo(embedding[i] ?? 0, 5);
      }
    });
  });

  describe('Embedding Search', () => {
    it('finds templates by embedding similarity', async () => {
      // Create templates with different embeddings
      await storeModule.createTemplate(knex, makeTemplate({ embedding: fakeEmbedding(1) }));
      await storeModule.createTemplate(knex, makeTemplate({ embedding: fakeEmbedding(100) }));

      // Search with embedding similar to seed=1
      const results = await storeModule.searchTemplatesByEmbedding(knex, fakeEmbedding(1.01), { limit: 10 });

      expect(results.length).toBeGreaterThan(0);
      // The first result should be the one most similar to our query
      expect(results[0]?.similarity).toBeGreaterThan(0.5);
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await storeModule.createTemplate(knex, makeTemplate({ embedding: fakeEmbedding(i) }));
      }

      const results = await storeModule.searchTemplatesByEmbedding(knex, fakeEmbedding(1), { limit: 3 });
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('only searches active templates', async () => {
      await storeModule.createTemplate(
        knex,
        makeTemplate({
          id: 'active-1',
          status: 'active',
          embedding: fakeEmbedding(1),
        }),
      );
      await storeModule.createTemplate(
        knex,
        makeTemplate({
          id: 'retired-1',
          status: 'retired',
          embedding: fakeEmbedding(1.01),
        }),
      );

      const results = await storeModule.searchTemplatesByEmbedding(knex, fakeEmbedding(1));
      const ids = results.map((r) => r.id);
      expect(ids).toContain('active-1');
      expect(ids).not.toContain('retired-1');
    });
  });

  describe('Evidence Updates', () => {
    it('increments outcome counters', async () => {
      const template = makeTemplate();
      await storeModule.createTemplate(knex, template);

      await storeModule.incrementOutcome(knex, template.id, 'positive');
      await storeModule.incrementOutcome(knex, template.id, 'positive');
      await storeModule.incrementOutcome(knex, template.id, 'negative');
      await storeModule.incrementOutcome(knex, template.id, 'neutral');
      await storeModule.incrementOutcome(knex, template.id, 'correction');

      const updated = await storeModule.getTemplate(knex, template.id);
      expect(updated?.evidence.totalInteractions).toBe(5);
      expect(updated?.evidence.positiveOutcomes).toBe(2);
      expect(updated?.evidence.negativeOutcomes).toBe(2); // correction maps to negative
      expect(updated?.evidence.neutralOutcomes).toBe(1);
    });

    it('appends to last outcomes with rolling window', async () => {
      const template = makeTemplate();
      await storeModule.createTemplate(knex, template);

      // Add 5 outcomes with maxSize=3
      for (let i = 0; i < 5; i++) {
        await storeModule.appendToLastOutcomes(
          knex,
          template.id,
          {
            timestamp: `2024-01-0${i + 1}T00:00:00Z`,
            signal: 'positive',
            detail: `Outcome ${i}`,
          },
          3,
        );
      }

      const updated = await storeModule.getTemplate(knex, template.id);
      expect(updated?.evidence.lastOutcomes).toHaveLength(3);
      // Should keep the last 3
      expect(updated?.evidence.lastOutcomes[0]?.detail).toBe('Outcome 2');
      expect(updated?.evidence.lastOutcomes[2]?.detail).toBe('Outcome 4');
    });

    it('updates confidence score', async () => {
      const template = makeTemplate();
      await storeModule.createTemplate(knex, template);

      await storeModule.updateConfidence(knex, template.id, 0.85);

      const updated = await storeModule.getTemplate(knex, template.id);
      expect(updated?.evidence.confidenceScore).toBeCloseTo(0.85);
    });

    it('clamps confidence to [0, 1]', async () => {
      const template = makeTemplate();
      await storeModule.createTemplate(knex, template);

      await storeModule.updateConfidence(knex, template.id, 1.5);
      let updated = await storeModule.getTemplate(knex, template.id);
      expect(updated?.evidence.confidenceScore).toBe(1);

      await storeModule.updateConfidence(knex, template.id, -0.5);
      updated = await storeModule.getTemplate(knex, template.id);
      expect(updated?.evidence.confidenceScore).toBe(0);
    });
  });

  describe('Strategy Updates', () => {
    it('updates strategy JSON', async () => {
      const template = makeTemplate();
      await storeModule.createTemplate(knex, template);

      await storeModule.updateStrategy(knex, template.id, {
        approach: 'New approach',
        guidelines: ['new guideline'],
        tone: 'formal',
      });

      const updated = await storeModule.getTemplate(knex, template.id);
      expect(updated?.strategy.approach).toBe('New approach');
      expect(updated?.strategy.guidelines).toEqual(['new guideline']);
      expect(updated?.strategy.tone).toBe('formal');
    });
  });

  describe('Activation', () => {
    it('updates activation score', async () => {
      const template = makeTemplate({ activationScore: 0.5 });
      await storeModule.createTemplate(knex, template);

      await storeModule.updateActivation(knex, template.id, 0.8);

      const updated = await storeModule.getTemplate(knex, template.id);
      expect(updated?.activationScore).toBeCloseTo(0.8);
    });

    it('applies decay to all active templates', async () => {
      await storeModule.createTemplate(knex, makeTemplate({ id: 't1', activationScore: 0.5 }));
      await storeModule.createTemplate(knex, makeTemplate({ id: 't2', activationScore: 0.3 }));
      await storeModule.createTemplate(knex, makeTemplate({ id: 't3', status: 'retired', activationScore: 0.5 }));

      const decayed = await storeModule.applyActivationDecay(knex, 0.1);
      expect(decayed).toBe(2); // Only active templates

      const t1 = await storeModule.getTemplate(knex, 't1');
      const t2 = await storeModule.getTemplate(knex, 't2');
      const t3 = await storeModule.getTemplate(knex, 't3');

      expect(t1?.activationScore).toBeCloseTo(0.4);
      expect(t2?.activationScore).toBeCloseTo(0.2);
      expect(t3?.activationScore).toBeCloseTo(0.5); // Unchanged (retired)
    });

    it('does not decay below zero', async () => {
      await storeModule.createTemplate(knex, makeTemplate({ id: 't1', activationScore: 0.05 }));

      await storeModule.applyActivationDecay(knex, 0.1);

      const t1 = await storeModule.getTemplate(knex, 't1');
      expect(t1?.activationScore).toBe(0);
    });
  });

  describe('Status & Retirement', () => {
    it('updates template status', async () => {
      const template = makeTemplate();
      await storeModule.createTemplate(knex, template);

      await storeModule.updateStatus(knex, template.id, 'retired');

      const updated = await storeModule.getTemplate(knex, template.id);
      expect(updated?.status).toBe('retired');
    });

    it('finds poorly performing templates', async () => {
      // Good template: 8/10 positive
      await storeModule.createTemplate(
        knex,
        makeTemplate({
          id: 'good',
          evidence: {
            totalInteractions: 10,
            positiveOutcomes: 8,
            negativeOutcomes: 1,
            neutralOutcomes: 1,
            lastOutcomes: [],
            confidenceScore: 0.8,
          },
        }),
      );

      // Poor template: 0/10 positive
      await storeModule.createTemplate(
        knex,
        makeTemplate({
          id: 'poor',
          evidence: {
            totalInteractions: 10,
            positiveOutcomes: 0,
            negativeOutcomes: 7,
            neutralOutcomes: 3,
            lastOutcomes: [],
            confidenceScore: 0.1,
          },
        }),
      );

      // Not enough interactions
      await storeModule.createTemplate(
        knex,
        makeTemplate({
          id: 'new',
          evidence: {
            totalInteractions: 3,
            positiveOutcomes: 0,
            negativeOutcomes: 3,
            neutralOutcomes: 0,
            lastOutcomes: [],
            confidenceScore: 0.1,
          },
        }),
      );

      const poor = await storeModule.findPoorTemplates(knex, {
        minInteractions: 10,
        maxPositiveRate: 0.1,
      });

      expect(poor).toHaveLength(1);
      expect(poor[0]?.id).toBe('poor');
    });
  });

  describe('Outcome Records', () => {
    it('saves and persists outcome records', async () => {
      const template = makeTemplate();
      await storeModule.createTemplate(knex, template);

      const outcome: OutcomeRecord = {
        id: crypto.randomUUID(),
        templateId: template.id,
        action: 'Sent notification',
        signal: 'positive',
        detail: 'User responded positively',
        context: {
          timeOfDay: '09:00',
          dayOfWeek: 'Monday',
        },
        createdAt: new Date().toISOString(),
      };

      await storeModule.saveOutcome(knex, outcome);

      // Verify it's persisted
      const row = await knex('behavioral_outcomes').where('id', outcome.id).first();
      expect(row).toBeDefined();
      expect(row.template_id).toBe(template.id);
      expect(row.signal).toBe('positive');
    });
  });

  describe('Pending Outcomes', () => {
    it('creates and retrieves pending outcomes', async () => {
      const template = makeTemplate();
      await storeModule.createTemplate(knex, template);

      const pending: PendingOutcome = {
        id: crypto.randomUUID(),
        templateId: template.id,
        action: 'Sent morning briefing',
        summary: 'Morning briefing sent',
        sourceConversationId: 'conv-123',
        triggerId: 'trigger-456',
        status: 'pending',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };

      await storeModule.savePendingOutcome(knex, pending);

      const retrieved = await storeModule.getPendingOutcome(knex, pending.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.summary).toBe('Morning briefing sent');
      expect(retrieved?.triggerId).toBe('trigger-456');
    });

    it('lists only pending outcomes', async () => {
      const template = makeTemplate();
      await storeModule.createTemplate(knex, template);

      const makePending = (id: string, status: string): PendingOutcome => ({
        id,
        templateId: template.id,
        action: 'Test action',
        summary: `Summary ${id}`,
        sourceConversationId: 'conv-1',
        status: status as PendingOutcome['status'],
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      await storeModule.savePendingOutcome(knex, makePending('p1', 'pending'));
      await storeModule.savePendingOutcome(knex, makePending('p2', 'resolved'));
      await storeModule.savePendingOutcome(knex, makePending('p3', 'pending'));

      const pending = await storeModule.getPendingOutcomes(knex);
      expect(pending).toHaveLength(2);
    });

    it('resolves a pending outcome', async () => {
      const template = makeTemplate();
      await storeModule.createTemplate(knex, template);

      const pending: PendingOutcome = {
        id: crypto.randomUUID(),
        templateId: template.id,
        action: 'Test',
        summary: 'Test',
        sourceConversationId: 'conv-1',
        status: 'pending',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };

      await storeModule.savePendingOutcome(knex, pending);

      // Create a real outcome record to satisfy the FK constraint
      const outcome: OutcomeRecord = {
        id: crypto.randomUUID(),
        templateId: template.id,
        action: 'Test',
        signal: 'positive',
        detail: 'User liked it',
        context: { timeOfDay: '09:00', dayOfWeek: 'Monday' },
        createdAt: new Date().toISOString(),
      };
      await storeModule.saveOutcome(knex, outcome);

      await storeModule.resolvePendingOutcome(knex, pending.id, outcome.id);

      const resolved = await storeModule.getPendingOutcome(knex, pending.id);
      expect(resolved?.status).toBe('resolved');
      expect(resolved?.resolvedOutcomeId).toBe(outcome.id);
      expect(resolved?.resolvedAt).toBeDefined();
    });

    it('expires overdue pending outcomes', async () => {
      const template = makeTemplate();
      await storeModule.createTemplate(knex, template);

      // Expired
      await storeModule.savePendingOutcome(knex, {
        id: 'expired-1',
        templateId: template.id,
        action: 'Test',
        summary: 'Expired one',
        sourceConversationId: 'conv-1',
        status: 'pending',
        createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        expiresAt: new Date(Date.now() - 1000).toISOString(), // Already expired
      });

      // Not expired
      await storeModule.savePendingOutcome(knex, {
        id: 'fresh-1',
        templateId: template.id,
        action: 'Test',
        summary: 'Fresh one',
        sourceConversationId: 'conv-1',
        status: 'pending',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      const expired = await storeModule.expirePendingOutcomes(knex);
      expect(expired).toHaveLength(1);
      expect(expired[0]?.id).toBe('expired-1');

      // Verify status updated
      const check = await storeModule.getPendingOutcome(knex, 'expired-1');
      expect(check?.status).toBe('expired');
    });
  });
});

// ============================================================================
// Service Tests
// ============================================================================

describe('BehavioralMemoryService', () => {
  let knex: Knex;
  let services: Services;
  let cleanup: () => Promise<void>;
  let service: BehavioralMemoryService;
  let mockEmbedQuery: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const setup = await createTestDb();
    knex = setup.knex;
    services = setup.services;
    cleanup = setup.cleanup;

    // Mock embedding provider via DI
    mockEmbedQuery = vi.fn(async () => fakeEmbedding(1));
    services.set(BehavioralEmbeddingProvider, {
      embedQuery: mockEmbedQuery,
      dimensions: 4,
    } as unknown as BehavioralEmbeddingProvider);

    service = new BehavioralMemoryService(services);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });

  describe('createTemplate', () => {
    it('creates a template with generated embedding', async () => {
      const template = await service.createTemplate({
        situation: {
          description: 'Morning briefing',
          category: 'planning',
          triggerPatterns: ['morning', 'briefing'],
        },
        strategy: {
          approach: 'Top 3 priorities',
          guidelines: ['Keep it short'],
        },
      });

      expect(template.id).toBeDefined();
      expect(template.situation.description).toBe('Morning briefing');
      expect(template.embedding).toBeDefined();
      expect(template.evidence.confidenceScore).toBe(0.3);
      expect(template.activationScore).toBe(0.5);
      expect(template.status).toBe('active');

      expect(mockEmbedQuery).toHaveBeenCalled();
    });

    it('creates a template with initial outcome', async () => {
      const template = await service.createTemplate({
        situation: {
          description: 'Health check-in',
          category: 'health',
          triggerPatterns: ['health', 'sleep'],
        },
        strategy: {
          approach: 'Notify about sleep trends',
          guidelines: ['Be gentle'],
        },
        initialOutcome: {
          signal: 'positive',
          detail: 'User appreciated the check-in',
        },
      });

      expect(template.evidence.totalInteractions).toBe(1);
      expect(template.evidence.positiveOutcomes).toBe(1);
      expect(template.evidence.lastOutcomes).toHaveLength(1);
    });

    it('creates a template with negative initial outcome', async () => {
      const template = await service.createTemplate({
        situation: {
          description: 'Proactive reminder',
          category: 'productivity',
          triggerPatterns: ['reminder'],
        },
        strategy: {
          approach: 'Remind gently',
          guidelines: ['Only for forgotten tasks'],
        },
        initialOutcome: {
          signal: 'negative',
          detail: 'User was annoyed',
        },
      });

      expect(template.evidence.negativeOutcomes).toBe(1);
      expect(template.evidence.positiveOutcomes).toBe(0);
    });
  });

  describe('getTemplate', () => {
    it('retrieves an existing template', async () => {
      const created = await service.createTemplate({
        situation: { description: 'Test', category: 'test', triggerPatterns: [] },
        strategy: { approach: 'Test', guidelines: [] },
      });

      const retrieved = await service.getTemplate(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
    });

    it('returns null for missing template', async () => {
      const result = await service.getTemplate('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('recordOutcome', () => {
    it('records an outcome and updates evidence', async () => {
      const template = await service.createTemplate({
        situation: { description: 'Test', category: 'test', triggerPatterns: [] },
        strategy: { approach: 'Test', guidelines: [] },
      });

      const outcome = await service.recordOutcome({
        templateId: template.id,
        action: 'Sent notification',
        signal: 'positive',
        detail: 'User said thanks',
      });

      expect(outcome.id).toBeDefined();
      expect(outcome.templateId).toBe(template.id);
      expect(outcome.signal).toBe('positive');

      // Verify evidence updated
      const updated = await service.getTemplate(template.id);
      expect(updated?.evidence.totalInteractions).toBe(1);
      expect(updated?.evidence.positiveOutcomes).toBe(1);
      expect(updated?.evidence.lastOutcomes).toHaveLength(1);
    });

    it('records outcome with strategy change', async () => {
      const template = await service.createTemplate({
        situation: { description: 'Test', category: 'test', triggerPatterns: [] },
        strategy: { approach: 'Original approach', guidelines: ['old guideline'] },
      });

      await service.recordOutcome({
        templateId: template.id,
        action: 'Sent long notification',
        signal: 'negative',
        detail: 'User said too long',
        strategyChange: 'Keep notifications under 3 sentences',
      });

      const updated = await service.getTemplate(template.id);
      expect(updated?.strategy.approach).toBe('Keep notifications under 3 sentences');
      expect(updated?.evidence.lastOutcomes[0]?.strategyChange).toBe('Keep notifications under 3 sentences');
    });

    it('boosts activation on outcome recording', async () => {
      const template = await service.createTemplate({
        situation: { description: 'Test', category: 'test', triggerPatterns: [] },
        strategy: { approach: 'Test', guidelines: [] },
      });

      expect(template.activationScore).toBe(0.5);

      await service.recordOutcome({
        templateId: template.id,
        action: 'Test',
        signal: 'neutral',
        detail: 'Nothing happened',
      });

      const updated = await service.getTemplate(template.id);
      expect(updated?.activationScore).toBeGreaterThan(0.5);
    });

    it('throws when neither templateId nor pendingOutcomeId provided', async () => {
      await expect(
        service.recordOutcome({
          action: 'Test',
          signal: 'positive',
          detail: 'Test',
        }),
      ).rejects.toThrow('Either templateId or pendingOutcomeId must be provided');
    });
  });

  describe('Pending Outcomes', () => {
    it('creates and retrieves pending outcomes', async () => {
      const template = await service.createTemplate({
        situation: { description: 'Test', category: 'test', triggerPatterns: [] },
        strategy: { approach: 'Test', guidelines: [] },
      });

      const pending = await service.createPendingOutcome({
        templateId: template.id,
        action: 'Sent morning briefing',
        summary: 'Morning briefing sent',
        sourceConversationId: 'conv-bg-1',
        triggerId: 'trigger-1',
      });

      expect(pending.id).toBeDefined();
      expect(pending.status).toBe('pending');
      expect(pending.expiresAt).toBeDefined();

      const all = await service.getPendingOutcomes();
      expect(all).toHaveLength(1);
      expect(all[0]?.id).toBe(pending.id);
    });

    it('resolves a pending outcome via recordOutcome', async () => {
      const template = await service.createTemplate({
        situation: { description: 'Test', category: 'test', triggerPatterns: [] },
        strategy: { approach: 'Test', guidelines: [] },
      });

      const pending = await service.createPendingOutcome({
        templateId: template.id,
        action: 'Sent briefing',
        summary: 'Briefing sent',
        sourceConversationId: 'conv-bg-1',
      });

      const outcome = await service.recordOutcome({
        pendingOutcomeId: pending.id,
        action: 'Sent briefing',
        signal: 'positive',
        detail: 'User said thanks',
      });

      expect(outcome.templateId).toBe(template.id);

      // Pending should be resolved
      const allPending = await service.getPendingOutcomes();
      expect(allPending).toHaveLength(0);
    });
  });

  describe('Context Index', () => {
    it('returns empty message when no templates', async () => {
      const index = await service.buildContextIndex('test context');
      expect(index).toContain('No behavioral templates yet');
    });

    it('includes template entries when templates exist', async () => {
      await service.createTemplate({
        situation: { description: 'Morning briefing delivery', category: 'planning', triggerPatterns: ['morning'] },
        strategy: { approach: 'Top 3', guidelines: [] },
      });

      const index = await service.buildContextIndex('morning planning');
      expect(index).toContain('Behavioral Templates');
      expect(index).toContain('Morning briefing delivery');
      expect(index).toContain('behavioral.getTemplate');
    });

    it('includes pending outcomes in the index', async () => {
      const template = await service.createTemplate({
        situation: { description: 'Test', category: 'test', triggerPatterns: [] },
        strategy: { approach: 'Test', guidelines: [] },
      });

      await service.createPendingOutcome({
        templateId: template.id,
        action: 'Sent alert',
        summary: 'Sleep alert sent',
        sourceConversationId: 'conv-1',
      });

      const index = await service.buildContextIndex('general');
      expect(index).toContain('Awaiting Feedback');
      expect(index).toContain('Sleep alert sent');
    });
  });

  describe('Maintenance', () => {
    it('applies activation decay', async () => {
      await service.createTemplate({
        situation: { description: 'Test', category: 'test', triggerPatterns: [] },
        strategy: { approach: 'Test', guidelines: [] },
      });

      const count = await service.applyActivationDecay();
      expect(count).toBe(1);
    });

    it('expires stale pending outcomes and records as neutral', async () => {
      const template = await service.createTemplate({
        situation: { description: 'Test', category: 'test', triggerPatterns: [] },
        strategy: { approach: 'Test', guidelines: [] },
      });

      // Create an already-expired pending outcome
      await storeModule.savePendingOutcome(knex, {
        id: 'expired-po',
        templateId: template.id,
        action: 'Old action',
        summary: 'Old summary',
        sourceConversationId: 'conv-old',
        status: 'pending',
        createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });

      const expired = await service.expireAndRecordPendingOutcomes();
      expect(expired).toHaveLength(1);

      // Verify neutral outcome was recorded
      const updated = await service.getTemplate(template.id);
      expect(updated?.evidence.neutralOutcomes).toBe(1);
    });

    it('retires poor templates', async () => {
      // Create a poor-performing template directly in the store
      await storeModule.createTemplate(
        knex,
        makeTemplate({
          id: 'poor-template',
          evidence: {
            totalInteractions: 15,
            positiveOutcomes: 0,
            negativeOutcomes: 10,
            neutralOutcomes: 5,
            lastOutcomes: [],
            confidenceScore: 0.05,
          },
        }),
      );

      const retired = await service.retirePoorTemplates();
      expect(retired).toHaveLength(1);
      expect(retired[0]?.id).toBe('poor-template');

      const updated = await storeModule.getTemplate(knex, 'poor-template');
      expect(updated?.status).toBe('retired');
    });
  });
});

// ============================================================================
// Helper Function Tests
// ============================================================================

describe('calculateConfidence', () => {
  it('returns 0.3 for zero interactions', () => {
    const template = makeTemplate({
      evidence: {
        totalInteractions: 0,
        positiveOutcomes: 0,
        negativeOutcomes: 0,
        neutralOutcomes: 0,
        lastOutcomes: [],
        confidenceScore: 0.3,
      },
    });
    expect(calculateConfidence(template)).toBe(0.3);
  });

  it('returns high confidence for mostly positive outcomes', () => {
    const template = makeTemplate({
      evidence: {
        totalInteractions: 10,
        positiveOutcomes: 9,
        negativeOutcomes: 0,
        neutralOutcomes: 1,
        lastOutcomes: [],
        confidenceScore: 0.3,
      },
    });
    const confidence = calculateConfidence(template);
    expect(confidence).toBeGreaterThan(0.8);
  });

  it('returns low confidence for mostly negative outcomes', () => {
    const template = makeTemplate({
      evidence: {
        totalInteractions: 10,
        positiveOutcomes: 0,
        negativeOutcomes: 8,
        neutralOutcomes: 2,
        lastOutcomes: [],
        confidenceScore: 0.3,
      },
    });
    const confidence = calculateConfidence(template);
    expect(confidence).toBeLessThan(0.2);
  });

  it('clamps to [0, 1]', () => {
    // Very negative
    const template = makeTemplate({
      evidence: {
        totalInteractions: 100,
        positiveOutcomes: 0,
        negativeOutcomes: 100,
        neutralOutcomes: 0,
        lastOutcomes: [],
        confidenceScore: 0,
      },
    });
    const confidence = calculateConfidence(template);
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });
});

describe('formatTimeAgo', () => {
  it('formats recent timestamps', () => {
    const now = new Date().toISOString();
    expect(formatTimeAgo(now)).toBe('just now');
  });

  it('formats minutes ago', () => {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    expect(formatTimeAgo(thirtyMinAgo)).toBe('30m ago');
  });

  it('formats hours ago', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(formatTimeAgo(twoHoursAgo)).toBe('2h ago');
  });

  it('formats days ago', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatTimeAgo(threeDaysAgo)).toBe('3d ago');
  });
});
