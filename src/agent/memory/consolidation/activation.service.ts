import type { Knex } from 'knex';

import type { Logger } from '../../../core/logging/logging.ts';

import type { MemoryActivation, BoostReason, BoostHistoryEntry, ActivationConfig } from './consolidation.schemas.ts';
import { activationConfigSchema } from './consolidation.schemas.ts';
import { ActivationStore } from './activation.store.ts';

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_ACTIVATION_CONFIG: ActivationConfig = activationConfigSchema.parse({});

// ============================================================================
// Activation Service
// ============================================================================

class ActivationService {
  #store: ActivationStore;
  #config: ActivationConfig;
  #logger: Logger;

  constructor(db: Knex, logger: Logger, config?: Partial<ActivationConfig>) {
    this.#store = new ActivationStore(db);
    this.#config = { ...DEFAULT_ACTIVATION_CONFIG, ...config };
    this.#logger = logger;
  }

  /**
   * Get the current activation config.
   */
  get config(): ActivationConfig {
    return this.#config;
  }

  /**
   * Get activation record for a memory.
   */
  getActivation = async (memoryId: string): Promise<MemoryActivation | null> => {
    return this.#store.get(memoryId);
  };

  /**
   * Ensure activation record exists for a memory.
   */
  ensureActivation = async (memoryId: string, initialScore?: number): Promise<MemoryActivation> => {
    return this.#store.ensure(memoryId, initialScore, this.#config.dailyDecayRate);
  };

  /**
   * Boost a memory's activation score.
   */
  boost = async (memoryId: string, reason: BoostReason): Promise<MemoryActivation> => {
    const activation = await this.#store.ensure(memoryId, 0.5, this.#config.dailyDecayRate);
    const boostAmount = this.#config.boosts[reason];
    const newScore = Math.min(1.0, activation.activationScore + boostAmount);

    const now = new Date().toISOString();
    const historyEntry: BoostHistoryEntry = {
      timestamp: now,
      reason,
      boostAmount,
    };

    // Keep only last 10 boost history entries
    const newHistory = [...activation.boostHistory, historyEntry].slice(-10);

    const updated = await this.#store.update(memoryId, {
      activationScore: newScore,
      boostHistory: newHistory,
    });

    this.#logger.debug('Boosted memory activation', {
      memoryId,
      reason,
      boostAmount,
      oldScore: activation.activationScore,
      newScore,
    });

    return updated ?? activation;
  };

  /**
   * Boost multiple memories at once.
   */
  boostMany = async (memoryIds: string[], reason: BoostReason): Promise<void> => {
    for (const memoryId of memoryIds) {
      await this.boost(memoryId, reason);
    }
  };

  /**
   * Apply decay to a single memory's activation score.
   */
  applyDecay = (currentScore: number, daysSinceLastDecay: number): number => {
    if (daysSinceLastDecay <= 0) {
      return currentScore;
    }
    const decayFactor = Math.pow(1 - this.#config.dailyDecayRate, daysSinceLastDecay);
    return currentScore * decayFactor;
  };

  /**
   * Run decay on all memory activations.
   * Should be called daily by background job.
   */
  runDecay = async (): Promise<{ processed: number; updated: number }> => {
    const now = new Date();
    const activations = await this.#store.getAllForDecay();

    const updates: { memoryId: string; activationScore: number; lastDecayAt: string }[] = [];

    for (const activation of activations) {
      const lastDecay = new Date(activation.lastDecayAt);
      const daysSince = (now.getTime() - lastDecay.getTime()) / (1000 * 60 * 60 * 24);

      if (daysSince >= 1) {
        const newScore = this.applyDecay(activation.activationScore, daysSince);
        updates.push({
          memoryId: activation.memoryId,
          activationScore: newScore,
          lastDecayAt: now.toISOString(),
        });
      }
    }

    if (updates.length > 0) {
      await this.#store.batchUpdateScores(updates);
    }

    this.#logger.info('Completed activation decay', {
      processed: activations.length,
      updated: updates.length,
    });

    return { processed: activations.length, updated: updates.length };
  };

  /**
   * Get memories with activation above threshold.
   */
  getActiveMemories = async (threshold?: number, limit?: number): Promise<MemoryActivation[]> => {
    const minScore = threshold ?? this.#config.indexThreshold;
    return this.#store.getAboveThreshold(minScore, limit);
  };

  /**
   * Check if a memory is in the "hot" tier.
   */
  isHot = (activation: MemoryActivation): boolean => {
    return activation.activationScore >= this.#config.hotThreshold;
  };

  /**
   * Check if a memory is in the "warm" tier.
   */
  isWarm = (activation: MemoryActivation): boolean => {
    return (
      activation.activationScore >= this.#config.warmThreshold && activation.activationScore < this.#config.hotThreshold
    );
  };

  /**
   * Check if a memory is in the "cold" tier.
   */
  isCold = (activation: MemoryActivation): boolean => {
    return activation.activationScore < this.#config.warmThreshold;
  };

  /**
   * Get the tier for a memory based on its activation score.
   */
  getTier = (activation: MemoryActivation): 'hot' | 'warm' | 'cold' => {
    if (this.isHot(activation)) return 'hot';
    if (this.isWarm(activation)) return 'warm';
    return 'cold';
  };

  /**
   * Delete activation record for a memory.
   */
  deleteActivation = async (memoryId: string): Promise<boolean> => {
    return this.#store.delete(memoryId);
  };

  /**
   * Get activation records for multiple memories.
   */
  getActivations = async (memoryIds: string[]): Promise<Map<string, MemoryActivation>> => {
    return this.#store.getMany(memoryIds);
  };
}

export { ActivationService, DEFAULT_ACTIVATION_CONFIG };
