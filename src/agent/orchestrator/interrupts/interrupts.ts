import type { Knex } from 'knex';

import type { Services } from '../../../core/services/services.ts';
import { DatabaseService } from '../../../core/database/database.ts';

import type { Interrupt, InterruptResponse, CreateInterruptInput } from './interrupts.schemas.ts';
import {
  createInterrupt,
  getInterrupt,
  getPendingInterrupt,
  respondToInterrupt,
  expireInterrupt,
  getExpiredInterrupts,
  deleteInterrupt,
  listInterrupts,
} from './interrupts.store.ts';

/**
 * Error thrown when an interrupt is not found.
 */
class InterruptNotFoundError extends Error {
  readonly name = 'InterruptNotFoundError';
  readonly interruptId: string;

  constructor(interruptId: string) {
    super(`Interrupt not found: ${interruptId}`);
    this.interruptId = interruptId;
  }
}

/**
 * Error thrown when trying to respond to an interrupt that is not pending.
 */
class InterruptNotPendingError extends Error {
  readonly name = 'InterruptNotPendingError';
  readonly interruptId: string;
  readonly status: string;

  constructor(interruptId: string, status: string) {
    super(`Interrupt ${interruptId} is not pending (status: ${status})`);
    this.interruptId = interruptId;
    this.status = status;
  }
}

/**
 * Service for managing interrupts in the human-in-the-loop flow.
 */
class InterruptService {
  #services: Services;

  constructor(services: Services) {
    this.#services = services;
  }

  /**
   * Gets the knex instance from the database service.
   */
  #db = (): Knex => {
    return this.#services.get(DatabaseService).knex;
  };

  /**
   * Creates a new interrupt.
   */
  create = async (input: CreateInterruptInput): Promise<Interrupt> => {
    return createInterrupt(this.#db(), input);
  };

  /**
   * Gets an interrupt by ID.
   */
  get = async (id: string): Promise<Interrupt | null> => {
    return getInterrupt(this.#db(), id);
  };

  /**
   * Gets the pending interrupt for a conversation.
   */
  getPending = async (conversationId: string): Promise<Interrupt | null> => {
    return getPendingInterrupt(this.#db(), conversationId);
  };

  /**
   * Responds to an interrupt.
   * Throws InterruptNotFoundError if the interrupt doesn't exist.
   * Throws InterruptNotPendingError if the interrupt is not pending.
   */
  respond = async (id: string, response: InterruptResponse): Promise<Interrupt> => {
    const interrupt = await this.get(id);

    if (!interrupt) {
      throw new InterruptNotFoundError(id);
    }

    if (interrupt.status !== 'pending') {
      throw new InterruptNotPendingError(id, interrupt.status);
    }

    return respondToInterrupt(this.#db(), id, response);
  };

  /**
   * Expires an interrupt.
   */
  expire = async (id: string): Promise<void> => {
    const interrupt = await this.get(id);

    if (!interrupt) {
      throw new InterruptNotFoundError(id);
    }

    return expireInterrupt(this.#db(), id);
  };

  /**
   * Gets all interrupts that have passed their expiration time.
   */
  getExpired = async (): Promise<Interrupt[]> => {
    return getExpiredInterrupts(this.#db());
  };

  /**
   * Processes expired interrupts, marking them as expired.
   * Returns the number of interrupts that were expired.
   */
  processExpired = async (): Promise<number> => {
    const expired = await this.getExpired();

    for (const interrupt of expired) {
      await expireInterrupt(this.#db(), interrupt.id);
    }

    return expired.length;
  };

  /**
   * Deletes an interrupt.
   */
  delete = async (id: string): Promise<boolean> => {
    return deleteInterrupt(this.#db(), id);
  };

  /**
   * Lists interrupts for a conversation.
   */
  list = async (
    conversationId: string,
    options?: { status?: Interrupt['status']; limit?: number },
  ): Promise<Interrupt[]> => {
    return listInterrupts(this.#db(), conversationId, options);
  };
}

// Re-export types and schemas
export type {
  InterruptType,
  InterruptOption,
  ToolCallInfo,
  InterruptStatus,
  InterruptResponse,
  Interrupt,
  CreateInterruptInput,
  InterruptRow,
} from './interrupts.schemas.ts';

export {
  interruptTypeSchema,
  interruptOptionSchema,
  toolCallInfoSchema,
  interruptStatusSchema,
  interruptResponseSchema,
  interruptSchema,
  createInterruptInputSchema,
  interruptRowSchema,
} from './interrupts.schemas.ts';

export { InterruptSignal, isInterruptSignal } from './interrupts.errors.ts';

export { InterruptService, InterruptNotFoundError, InterruptNotPendingError };
