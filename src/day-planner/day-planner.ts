import type { Services } from '../services/services.ts';
import { DatabaseService } from '../database/database.ts';

import type {
  DayPlan,
  Priority,
  FocusBlock,
  Intention,
  CreateDayPlanInput,
  UpdateDayPlanInput,
  AddPriorityInput,
  UpdatePriorityInput,
  AddFocusBlockInput,
  UpdateFocusBlockInput,
  DayPlanContext,
} from './day-planner.schemas.ts';
import {
  createDayPlan,
  getDayPlan,
  getDayPlanByDate,
  updateDayPlan,
  deleteDayPlan,
  addIntention,
  removeIntention,
  addPriority,
  updatePriority,
  removePriority,
  reorderPriorities,
  addFocusBlock,
  updateFocusBlock,
  removeFocusBlock,
  getRecentPlans,
  getTodayDate,
} from './day-planner.store.ts';
import {
  DayPlanNotFoundError,
  DayPlanAlreadyExistsError,
  PriorityNotFoundError,
  FocusBlockNotFoundError,
  InvalidDayPlanStateError,
} from './day-planner.errors.ts';

// ============================================================================
// Day Plan Service
// ============================================================================

/**
 * Day Plan Service - manages daily planning and context.
 *
 * Provides structured daily planning sessions that produce a day plan
 * loaded into every agent interaction. The agent has awareness of the
 * user's intentions for the day, enabling better prioritization
 * suggestions and context-aware responses.
 */
class DayPlanService {
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
  // Plan Lifecycle
  // ==========================================================================

  /**
   * Creates a new day plan. Only one plan per date is allowed.
   * If a plan already exists for the date, throws DayPlanAlreadyExistsError.
   */
  createPlan = async (input: CreateDayPlanInput): Promise<DayPlan> => {
    const date = input.date ?? getTodayDate();

    // Check if plan already exists
    const existing = await getDayPlanByDate(this.#db(), date);
    if (existing) {
      throw new DayPlanAlreadyExistsError(date);
    }

    return createDayPlan(this.#db(), { ...input, date });
  };

  /**
   * Creates or updates a day plan for the given date.
   * If a plan exists, updates it; otherwise creates a new one.
   */
  upsertPlan = async (input: CreateDayPlanInput): Promise<DayPlan> => {
    const date = input.date ?? getTodayDate();

    const existing = await getDayPlanByDate(this.#db(), date);
    if (existing) {
      // Update existing plan
      await this.updatePlan(existing.id, {
        energyLevel: input.energyLevel,
        notes: input.notes,
      });

      // Replace intentions
      for (const intention of existing.intentions) {
        await removeIntention(this.#db(), intention.id);
      }
      for (const intentionText of input.intentions ?? []) {
        await addIntention(this.#db(), existing.id, intentionText);
      }

      // Replace priorities
      for (const priority of existing.priorities) {
        await removePriority(this.#db(), priority.id);
      }
      for (const priority of input.priorities ?? []) {
        await addPriority(this.#db(), existing.id, priority);
      }

      // Replace focus blocks
      for (const block of existing.focusBlocks) {
        await removeFocusBlock(this.#db(), block.id);
      }
      for (const block of input.focusBlocks ?? []) {
        await addFocusBlock(this.#db(), existing.id, block);
      }

      // Return fresh plan
      const updatedPlan = await getDayPlan(this.#db(), existing.id);
      if (!updatedPlan) {
        throw new DayPlanNotFoundError(existing.id, 'id');
      }
      return updatedPlan;
    }

    return createDayPlan(this.#db(), { ...input, date });
  };

  /**
   * Gets a day plan by ID.
   */
  getPlan = async (id: string): Promise<DayPlan | null> => {
    return getDayPlan(this.#db(), id);
  };

  /**
   * Gets a day plan by ID, throws if not found.
   */
  requirePlan = async (id: string): Promise<DayPlan> => {
    const plan = await this.getPlan(id);
    if (!plan) {
      throw new DayPlanNotFoundError(id, 'id');
    }
    return plan;
  };

  /**
   * Gets the day plan for a specific date.
   */
  getPlanByDate = async (date: string): Promise<DayPlan | null> => {
    return getDayPlanByDate(this.#db(), date);
  };

  /**
   * Gets today's day plan.
   */
  getTodayPlan = async (): Promise<DayPlan | null> => {
    return getDayPlanByDate(this.#db(), getTodayDate());
  };

  /**
   * Updates a day plan.
   */
  updatePlan = async (id: string, updates: UpdateDayPlanInput): Promise<DayPlan> => {
    const plan = await updateDayPlan(this.#db(), id, updates);
    if (!plan) {
      throw new DayPlanNotFoundError(id, 'id');
    }
    return plan;
  };

  /**
   * Deletes a day plan.
   */
  deletePlan = async (id: string): Promise<boolean> => {
    return deleteDayPlan(this.#db(), id);
  };

  // ==========================================================================
  // Status Management
  // ==========================================================================

  /**
   * Activates a draft plan.
   */
  activatePlan = async (id: string): Promise<DayPlan> => {
    const plan = await this.requirePlan(id);
    if (plan.status !== 'draft') {
      throw new InvalidDayPlanStateError(id, plan.status, 'activate');
    }
    return this.updatePlan(id, { status: 'active' });
  };

  /**
   * Marks a plan as completed.
   */
  completePlan = async (id: string): Promise<DayPlan> => {
    const plan = await this.requirePlan(id);
    if (plan.status === 'completed' || plan.status === 'abandoned') {
      throw new InvalidDayPlanStateError(id, plan.status, 'complete');
    }
    return this.updatePlan(id, { status: 'completed' });
  };

  /**
   * Marks a plan as abandoned.
   */
  abandonPlan = async (id: string): Promise<DayPlan> => {
    const plan = await this.requirePlan(id);
    if (plan.status === 'completed' || plan.status === 'abandoned') {
      throw new InvalidDayPlanStateError(id, plan.status, 'abandon');
    }
    return this.updatePlan(id, { status: 'abandoned' });
  };

  // ==========================================================================
  // Intention Management
  // ==========================================================================

  /**
   * Adds an intention to a day plan.
   */
  addIntention = async (planId: string, intention: string): Promise<Intention> => {
    await this.requirePlan(planId);
    return addIntention(this.#db(), planId, intention);
  };

  /**
   * Removes an intention from a day plan.
   */
  removeIntention = async (intentionId: string): Promise<boolean> => {
    return removeIntention(this.#db(), intentionId);
  };

  // ==========================================================================
  // Priority Management
  // ==========================================================================

  /**
   * Adds a priority to a day plan.
   */
  addPriority = async (planId: string, input: AddPriorityInput): Promise<Priority> => {
    await this.requirePlan(planId);
    return addPriority(this.#db(), planId, input);
  };

  /**
   * Updates a priority.
   */
  updatePriority = async (priorityId: string, updates: UpdatePriorityInput): Promise<Priority> => {
    const priority = await updatePriority(this.#db(), priorityId, updates);
    if (!priority) {
      throw new PriorityNotFoundError(priorityId);
    }
    return priority;
  };

  /**
   * Marks a priority as completed.
   */
  completePriority = async (priorityId: string): Promise<Priority> => {
    return this.updatePriority(priorityId, { completed: true });
  };

  /**
   * Removes a priority.
   */
  removePriority = async (priorityId: string): Promise<boolean> => {
    const removed = await removePriority(this.#db(), priorityId);
    if (!removed) {
      throw new PriorityNotFoundError(priorityId);
    }
    return true;
  };

  /**
   * Reorders priorities in a day plan.
   */
  reorderPriorities = async (planId: string, priorityIds: string[]): Promise<void> => {
    await this.requirePlan(planId);
    return reorderPriorities(this.#db(), planId, priorityIds);
  };

  // ==========================================================================
  // Focus Block Management
  // ==========================================================================

  /**
   * Adds a focus block to a day plan.
   */
  addFocusBlock = async (planId: string, input: AddFocusBlockInput): Promise<FocusBlock> => {
    await this.requirePlan(planId);
    return addFocusBlock(this.#db(), planId, input);
  };

  /**
   * Updates a focus block.
   */
  updateFocusBlock = async (focusBlockId: string, updates: UpdateFocusBlockInput): Promise<FocusBlock> => {
    const block = await updateFocusBlock(this.#db(), focusBlockId, updates);
    if (!block) {
      throw new FocusBlockNotFoundError(focusBlockId);
    }
    return block;
  };

  /**
   * Marks a focus block as completed.
   */
  completeFocusBlock = async (focusBlockId: string): Promise<FocusBlock> => {
    return this.updateFocusBlock(focusBlockId, { completed: true });
  };

  /**
   * Removes a focus block.
   */
  removeFocusBlock = async (focusBlockId: string): Promise<boolean> => {
    const removed = await removeFocusBlock(this.#db(), focusBlockId);
    if (!removed) {
      throw new FocusBlockNotFoundError(focusBlockId);
    }
    return true;
  };

  // ==========================================================================
  // Context for Agent
  // ==========================================================================

  /**
   * Gets the day plan context for a specific date.
   */
  getPlanContext = async (date: string): Promise<DayPlanContext | null> => {
    const plan = await getDayPlanByDate(this.#db(), date);
    if (!plan) return null;
    return this.#buildContext(plan);
  };

  /**
   * Gets today's day plan context for the agent.
   */
  getTodayPlanContext = async (): Promise<DayPlanContext | null> => {
    const plan = await this.getTodayPlan();
    if (!plan) return null;
    return this.#buildContext(plan);
  };

  /**
   * Builds a context object from a day plan.
   */
  #buildContext = (plan: DayPlan): DayPlanContext => {
    const completedPriorities = plan.priorities.filter((p) => p.completed).length;
    const totalPriorities = plan.priorities.length;

    const progressSummary =
      totalPriorities === 0 ? 'No priorities set' : `${completedPriorities} of ${totalPriorities} priorities completed`;

    return {
      date: plan.date,
      status: plan.status,
      intentions: plan.intentions.map((i) => i.intention),
      priorities: plan.priorities.map((p) => ({
        id: p.id,
        description: p.description,
        category: p.category,
        completed: p.completed,
      })),
      focusBlocks: plan.focusBlocks.map((b) => ({
        label: b.label,
        startTime: b.startTime,
        duration: b.duration,
        completed: b.completed,
      })),
      energyLevel: plan.energyLevel,
      notes: plan.notes,
      progressSummary,
    };
  };

  // ==========================================================================
  // History
  // ==========================================================================

  /**
   * Gets recent day plans.
   */
  getRecentPlans = async (days = 7): Promise<DayPlan[]> => {
    return getRecentPlans(this.#db(), days);
  };
}

// ============================================================================
// Re-exports
// ============================================================================

export type {
  DayPlanStatus,
  EnergyLevel,
  Priority,
  FocusBlock,
  Intention,
  DayPlan,
  CreatePriorityInput,
  CreateFocusBlockInput,
  CreateDayPlanInput,
  UpdateDayPlanInput,
  UpdatePriorityInput,
  UpdateFocusBlockInput,
  AddPriorityInput,
  AddFocusBlockInput,
  DayPlanContext,
} from './day-planner.schemas.ts';

export {
  dayPlanStatusSchema,
  energyLevelSchema,
  prioritySchema,
  focusBlockSchema,
  intentionSchema,
  dayPlanSchema,
  createPriorityInputSchema,
  createFocusBlockInputSchema,
  createDayPlanInputSchema,
  updateDayPlanInputSchema,
  updatePriorityInputSchema,
  updateFocusBlockInputSchema,
  addPriorityInputSchema,
  addFocusBlockInputSchema,
  dayPlanContextSchema,
} from './day-planner.schemas.ts';

export {
  DayPlanNotFoundError,
  DayPlanAlreadyExistsError,
  PriorityNotFoundError,
  FocusBlockNotFoundError,
  InvalidDayPlanStateError,
} from './day-planner.errors.ts';

export { DayPlanService };
