import type { Services } from '../../../core/services/services.ts';
import { DatabaseService } from '../../../core/database/database.ts';
import { LogService } from '../../../core/logging/logging.ts';
import type { Logger } from '../../../core/logging/logging.ts';

import { ActivationService, DEFAULT_ACTIVATION_CONFIG } from './activation.service.ts';
import { OpenLoopService } from './openloop.service.ts';
import { ConsolidationWorker, DEFAULT_WORKER_CONFIG } from './consolidation.worker.ts';
import { ConsolidatedMemoryStore } from './consolidated.store.ts';
import type {
  ConsolidationWorkerConfig,
  ConsolidationResult,
  KnowledgeExtractor,
  EmbeddingGenerator,
} from './consolidation.worker.ts';

// ============================================================================
// Configuration
// ============================================================================

type ConsolidationJobConfig = {
  /** Cron expression for consolidation job (default: 3 AM Sunday) */
  consolidationSchedule: string;
  /** Cron expression for decay job (default: 4 AM daily) */
  decaySchedule: string;
  /** Whether to run immediately on start */
  runOnStart: boolean;
  /** Worker configuration */
  workerConfig?: Partial<ConsolidationWorkerConfig>;
};

const DEFAULT_JOB_CONFIG: ConsolidationJobConfig = {
  consolidationSchedule: '0 3 * * 0', // 3 AM every Sunday
  decaySchedule: '0 4 * * *', // 4 AM daily
  runOnStart: false,
  workerConfig: DEFAULT_WORKER_CONFIG,
};

// ============================================================================
// Cron Utilities (simplified from triggers.scheduler.ts)
// ============================================================================

type CronFields = {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
};

const parseRange = (field: string, min: number, max: number): number[] => {
  if (field === '*') {
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }

  const values: number[] = [];
  const parts = field.split(',');

  for (const part of parts) {
    if (part.includes('-') && !part.startsWith('*/')) {
      const [start, end] = part.split('-').map(Number);
      if (start !== undefined && end !== undefined && !isNaN(start) && !isNaN(end)) {
        for (let i = start; i <= end; i++) {
          if (i >= min && i <= max && !values.includes(i)) {
            values.push(i);
          }
        }
      }
    } else if (part.startsWith('*/')) {
      const step = parseInt(part.slice(2), 10);
      if (!isNaN(step) && step > 0) {
        for (let i = min; i <= max; i += step) {
          if (!values.includes(i)) {
            values.push(i);
          }
        }
      }
    } else {
      const val = parseInt(part, 10);
      if (!isNaN(val) && val >= min && val <= max && !values.includes(val)) {
        values.push(val);
      }
    }
  }

  return values.sort((a, b) => a - b);
};

const parseCronExpression = (expression: string): CronFields => {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Cron expression must have 5 fields: ${expression}`);
  }

  const [minutePart, hourPart, dayOfMonthPart, monthPart, dayOfWeekPart] = parts;

  if (!minutePart || !hourPart || !dayOfMonthPart || !monthPart || !dayOfWeekPart) {
    throw new Error(`Invalid cron expression: ${expression}`);
  }

  return {
    minute: parseRange(minutePart, 0, 59),
    hour: parseRange(hourPart, 0, 23),
    dayOfMonth: parseRange(dayOfMonthPart, 1, 31),
    month: parseRange(monthPart, 1, 12),
    dayOfWeek: parseRange(dayOfWeekPart, 0, 6),
  };
};

const getNextCronTime = (expression: string, after: Date = new Date()): Date | null => {
  const fields = parseCronExpression(expression);

  const next = new Date(after.getTime());
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);

  const maxIterations = 366 * 24 * 60;
  let iterations = 0;

  while (iterations < maxIterations) {
    const minute = next.getMinutes();
    const hour = next.getHours();
    const dayOfMonth = next.getDate();
    const month = next.getMonth() + 1;
    const dayOfWeek = next.getDay();

    if (
      fields.minute.includes(minute) &&
      fields.hour.includes(hour) &&
      fields.dayOfMonth.includes(dayOfMonth) &&
      fields.month.includes(month) &&
      fields.dayOfWeek.includes(dayOfWeek)
    ) {
      return next;
    }

    next.setMinutes(next.getMinutes() + 1);
    iterations++;
  }

  return null;
};

// ============================================================================
// Job Report Types
// ============================================================================

type ConsolidationJobReport = {
  id: string;
  type: 'consolidation' | 'decay' | 'stale_cleanup';
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed';
  stats: {
    memoriesProcessed?: number;
    consolidatedCreated?: number;
    consolidatedUpdated?: number;
    decayProcessed?: number;
    decayUpdated?: number;
    staleLoopsMarked?: number;
    consolidatedMemoriesDecayed?: number;
    errors: string[];
  };
};

// ============================================================================
// Consolidation Job Service
// ============================================================================

/**
 * ConsolidationJobService - schedules and runs background consolidation jobs.
 *
 * Jobs include:
 * - Weekly consolidation (consolidates memories into higher-level knowledge)
 * - Daily activation decay (reduces activation scores over time)
 * - Stale open loop cleanup (marks old open loops as stale)
 *
 * See spec/019-memory-consolidation.md
 */
class ConsolidationJobService {
  #services: Services;
  #config: ConsolidationJobConfig;
  #logger: Logger;
  #consolidationTimer: ReturnType<typeof setTimeout> | null = null;
  #decayTimer: ReturnType<typeof setTimeout> | null = null;
  #running = false;
  #knowledgeExtractor?: KnowledgeExtractor;
  #embeddingGenerator?: EmbeddingGenerator;

  constructor(services: Services, config?: Partial<ConsolidationJobConfig>) {
    this.#services = services;
    this.#config = { ...DEFAULT_JOB_CONFIG, ...config };
    const logService = services.get(LogService);
    this.#logger = logService.child({ source: 'ConsolidationJobService' });
  }

  /**
   * Sets the knowledge extractor function for consolidation.
   * If not set, uses a default extractor.
   */
  setKnowledgeExtractor = (extractor: KnowledgeExtractor): void => {
    this.#knowledgeExtractor = extractor;
  };

  /**
   * Sets the embedding generator function for consolidation.
   * If not set, embeddings are not generated.
   */
  setEmbeddingGenerator = (generator: EmbeddingGenerator): void => {
    this.#embeddingGenerator = generator;
  };

  /**
   * Whether the job service is running.
   */
  get isRunning(): boolean {
    return this.#running;
  }

  /**
   * Start the job scheduler.
   */
  start = async (): Promise<void> => {
    if (this.#running) {
      return;
    }

    this.#running = true;
    this.#logger.info('Starting consolidation job service');

    // Schedule consolidation job
    this.#scheduleConsolidation();

    // Schedule decay job
    this.#scheduleDecay();

    // Run immediately if configured
    if (this.#config.runOnStart) {
      void this.runConsolidation();
      void this.runDecay();
    }

    this.#logger.info('Consolidation job service started');
  };

  /**
   * Stop the job scheduler.
   */
  stop = async (): Promise<void> => {
    if (!this.#running) {
      return;
    }

    this.#running = false;

    if (this.#consolidationTimer) {
      clearTimeout(this.#consolidationTimer);
      this.#consolidationTimer = null;
    }

    if (this.#decayTimer) {
      clearTimeout(this.#decayTimer);
      this.#decayTimer = null;
    }

    this.#logger.info('Consolidation job service stopped');
  };

  /**
   * Get the next scheduled times for jobs.
   */
  getNextScheduledTimes = (): { consolidation: Date | null; decay: Date | null } => {
    return {
      consolidation: getNextCronTime(this.#config.consolidationSchedule),
      decay: getNextCronTime(this.#config.decaySchedule),
    };
  };

  // ==========================================================================
  // Scheduling
  // ==========================================================================

  #scheduleConsolidation = (): void => {
    if (!this.#running) {
      return;
    }

    const nextTime = getNextCronTime(this.#config.consolidationSchedule);
    if (!nextTime) {
      this.#logger.warn('Could not calculate next consolidation time');
      return;
    }

    const delay = nextTime.getTime() - Date.now();

    this.#logger.info('Scheduled consolidation job', {
      nextTime: nextTime.toISOString(),
      delayMs: delay,
    });

    this.#consolidationTimer = setTimeout(() => {
      void this.#runConsolidationAndReschedule();
    }, delay);
  };

  #scheduleDecay = (): void => {
    if (!this.#running) {
      return;
    }

    const nextTime = getNextCronTime(this.#config.decaySchedule);
    if (!nextTime) {
      this.#logger.warn('Could not calculate next decay time');
      return;
    }

    const delay = nextTime.getTime() - Date.now();

    this.#logger.info('Scheduled decay job', {
      nextTime: nextTime.toISOString(),
      delayMs: delay,
    });

    this.#decayTimer = setTimeout(() => {
      void this.#runDecayAndReschedule();
    }, delay);
  };

  #runConsolidationAndReschedule = async (): Promise<void> => {
    try {
      await this.runConsolidation();
    } finally {
      this.#scheduleConsolidation();
    }
  };

  #runDecayAndReschedule = async (): Promise<void> => {
    try {
      await this.runDecay();
    } finally {
      this.#scheduleDecay();
    }
  };

  // ==========================================================================
  // Job Execution
  // ==========================================================================

  /**
   * Run the consolidation job.
   * This includes:
   * - Entity consolidation
   * - Topic consolidation
   * - Period consolidation
   */
  runConsolidation = async (): Promise<ConsolidationJobReport> => {
    const report: ConsolidationJobReport = {
      id: crypto.randomUUID(),
      type: 'consolidation',
      startedAt: new Date().toISOString(),
      status: 'running',
      stats: {
        errors: [],
      },
    };

    this.#logger.info('Starting consolidation job', { reportId: report.id });

    try {
      const worker = new ConsolidationWorker(this.#services, this.#config.workerConfig);

      // Set extractors if provided
      if (this.#knowledgeExtractor) {
        worker.setKnowledgeExtractor(this.#knowledgeExtractor);
      }
      if (this.#embeddingGenerator) {
        worker.setEmbeddingGenerator(this.#embeddingGenerator);
      }

      // Run consolidation
      const result: ConsolidationResult = await worker.run();

      report.stats.memoriesProcessed = result.run.memoriesProcessed;
      report.stats.consolidatedCreated = result.created.length;
      report.stats.consolidatedUpdated = result.updated.length;
      report.stats.errors = result.errors;

      report.status = result.run.status === 'failed' ? 'failed' : 'completed';
      report.completedAt = new Date().toISOString();

      this.#logger.info('Consolidation job completed', {
        reportId: report.id,
        status: report.status,
        created: report.stats.consolidatedCreated,
        updated: report.stats.consolidatedUpdated,
        errors: report.stats.errors.length,
      });
    } catch (error) {
      report.status = 'failed';
      report.completedAt = new Date().toISOString();
      report.stats.errors.push(error instanceof Error ? error.message : String(error));

      this.#logger.error('Consolidation job failed', {
        reportId: report.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return report;
  };

  /**
   * Run the decay job.
   * This includes:
   * - Applying decay to memory activation scores
   * - Applying decay to consolidated memory activation scores
   * - Marking stale open loops
   */
  runDecay = async (): Promise<ConsolidationJobReport> => {
    const report: ConsolidationJobReport = {
      id: crypto.randomUUID(),
      type: 'decay',
      startedAt: new Date().toISOString(),
      status: 'running',
      stats: {
        errors: [],
      },
    };

    this.#logger.info('Starting decay job', { reportId: report.id });

    try {
      const dbService = this.#services.get(DatabaseService);
      const logService = this.#services.get(LogService);

      // 1. Apply activation decay to memories
      const activationService = new ActivationService(
        dbService.knex,
        logService.child({ source: 'ActivationService' }),
        DEFAULT_ACTIVATION_CONFIG,
      );

      const decayResult = await activationService.runDecay();
      report.stats.decayProcessed = decayResult.processed;
      report.stats.decayUpdated = decayResult.updated;

      // 2. Apply decay to consolidated memories
      const consolidatedStore = new ConsolidatedMemoryStore(dbService.knex);
      const decayedCount = await consolidatedStore.applyDecay(DEFAULT_ACTIVATION_CONFIG.dailyDecayRate);
      report.stats.consolidatedMemoriesDecayed = decayedCount;

      // 3. Mark stale open loops
      const openLoopService = new OpenLoopService(this.#services);
      const staleResult = await openLoopService.markStale();
      report.stats.staleLoopsMarked = staleResult.marked;

      report.status = 'completed';
      report.completedAt = new Date().toISOString();

      this.#logger.info('Decay job completed', {
        reportId: report.id,
        decayProcessed: report.stats.decayProcessed,
        decayUpdated: report.stats.decayUpdated,
        consolidatedDecayed: report.stats.consolidatedMemoriesDecayed,
        staleMarked: report.stats.staleLoopsMarked,
      });
    } catch (error) {
      report.status = 'failed';
      report.completedAt = new Date().toISOString();
      report.stats.errors.push(error instanceof Error ? error.message : String(error));

      this.#logger.error('Decay job failed', {
        reportId: report.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return report;
  };

  /**
   * Run stale open loop cleanup.
   * Can be called independently if needed.
   */
  runStaleCleanup = async (): Promise<ConsolidationJobReport> => {
    const report: ConsolidationJobReport = {
      id: crypto.randomUUID(),
      type: 'stale_cleanup',
      startedAt: new Date().toISOString(),
      status: 'running',
      stats: {
        errors: [],
      },
    };

    this.#logger.info('Starting stale cleanup job', { reportId: report.id });

    try {
      const openLoopService = new OpenLoopService(this.#services);
      const result = await openLoopService.markStale();
      report.stats.staleLoopsMarked = result.marked;

      report.status = 'completed';
      report.completedAt = new Date().toISOString();

      this.#logger.info('Stale cleanup job completed', {
        reportId: report.id,
        marked: report.stats.staleLoopsMarked,
      });
    } catch (error) {
      report.status = 'failed';
      report.completedAt = new Date().toISOString();
      report.stats.errors.push(error instanceof Error ? error.message : String(error));

      this.#logger.error('Stale cleanup job failed', {
        reportId: report.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return report;
  };
}

// ============================================================================
// Exports
// ============================================================================

export type { ConsolidationJobConfig, ConsolidationJobReport };
export { ConsolidationJobService, DEFAULT_JOB_CONFIG };
