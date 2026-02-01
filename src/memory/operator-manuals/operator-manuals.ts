import type { Services } from '../../services/services.ts';
import { DatabaseService } from '../../database/database.ts';

import type {
  OperatorManual,
  CreateManualInput,
  UpdateManualInput,
  AddCorrectionInput,
} from './operator-manuals.schemas.ts';
import {
  createManual,
  getManual,
  updateManual,
  deleteManual,
  findByName,
  findByDomain,
  searchManuals,
  listManuals,
  recordUsage,
  addCorrection,
  addBestPractice,
  addCommonMistake,
} from './operator-manuals.store.ts';

// ============================================================================
// Errors
// ============================================================================

class ManualNotFoundError extends Error {
  constructor(id: string) {
    super(`Operator manual not found: ${id}`);
    this.name = 'ManualNotFoundError';
  }
}

// ============================================================================
// Operator Manual Service
// ============================================================================

/**
 * Operator Manual Service - manages procedural knowledge for recurring tasks.
 *
 * Features:
 * - Store and retrieve operator manuals
 * - Track usage and success rates
 * - Accumulate user corrections and best practices
 */
class OperatorManualService {
  #services: Services;

  constructor(services: Services) {
    this.#services = services;
  }

  /**
   * Gets the Knex instance from the database service.
   */
  #db = () => {
    return this.#services.get(DatabaseService).knex;
  };

  // ==========================================================================
  // Manual CRUD
  // ==========================================================================

  /**
   * Creates a new operator manual.
   */
  create = async (input: CreateManualInput): Promise<OperatorManual> => {
    return createManual(this.#db(), input);
  };

  /**
   * Gets a manual by ID.
   */
  get = async (id: string): Promise<OperatorManual | null> => {
    return getManual(this.#db(), id);
  };

  /**
   * Updates a manual.
   */
  update = async (id: string, updates: UpdateManualInput): Promise<OperatorManual> => {
    const manual = await updateManual(this.#db(), id, updates);
    if (!manual) {
      throw new ManualNotFoundError(id);
    }
    return manual;
  };

  /**
   * Deletes a manual.
   */
  delete = async (id: string): Promise<boolean> => {
    return deleteManual(this.#db(), id);
  };

  // ==========================================================================
  // Manual Lookup
  // ==========================================================================

  /**
   * Finds a manual by exact name.
   */
  findByName = async (name: string): Promise<OperatorManual | null> => {
    return findByName(this.#db(), name);
  };

  /**
   * Finds manuals by domain.
   */
  findByDomain = async (domain: string): Promise<OperatorManual[]> => {
    return findByDomain(this.#db(), domain);
  };

  /**
   * Searches manuals by name/description.
   */
  search = async (query: string): Promise<OperatorManual[]> => {
    return searchManuals(this.#db(), query);
  };

  /**
   * Lists manuals with optional filtering.
   */
  list = async (options?: { domain?: string; limit?: number }): Promise<OperatorManual[]> => {
    return listManuals(this.#db(), options);
  };

  // ==========================================================================
  // Usage Tracking
  // ==========================================================================

  /**
   * Records a usage of the manual with success/failure outcome.
   * Updates use count and running success rate.
   */
  recordUsage = async (id: string, success: boolean): Promise<void> => {
    return recordUsage(this.#db(), id, success);
  };

  // ==========================================================================
  // Learning
  // ==========================================================================

  /**
   * Adds a user correction to the manual.
   */
  addCorrection = async (id: string, correction: AddCorrectionInput): Promise<OperatorManual> => {
    const manual = await addCorrection(this.#db(), id, correction);
    if (!manual) {
      throw new ManualNotFoundError(id);
    }
    return manual;
  };

  /**
   * Adds a best practice to the manual.
   */
  addBestPractice = async (id: string, practice: string): Promise<OperatorManual> => {
    const manual = await addBestPractice(this.#db(), id, practice);
    if (!manual) {
      throw new ManualNotFoundError(id);
    }
    return manual;
  };

  /**
   * Adds a common mistake to the manual.
   */
  addCommonMistake = async (id: string, mistake: string): Promise<OperatorManual> => {
    const manual = await addCommonMistake(this.#db(), id, mistake);
    if (!manual) {
      throw new ManualNotFoundError(id);
    }
    return manual;
  };
}

// ============================================================================
// Re-exports
// ============================================================================

export type {
  OperatorStep,
  UserCorrection,
  OperatorManual,
  CreateManualInput,
  UpdateManualInput,
  AddCorrectionInput,
} from './operator-manuals.schemas.ts';

export {
  operatorStepSchema,
  userCorrectionSchema,
  operatorManualSchema,
  createManualInputSchema,
  updateManualInputSchema,
  addCorrectionInputSchema,
} from './operator-manuals.schemas.ts';

export { OperatorManualService, ManualNotFoundError };
