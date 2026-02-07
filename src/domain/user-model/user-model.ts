import type { Services } from '../../core/services/services.ts';
import { DatabaseService } from '../../core/database/database.ts';

import type {
  Identity,
  IdentityInput,
  Project,
  CreateProjectInput,
  UpdateProjectInput,
  Goal,
  CreateGoalInput,
  UpdateGoalInput,
  Routine,
  CreateRoutineInput,
  UpdateRoutineInput,
  ProjectStatus,
  GoalTimeframe,
} from './user-model.schemas.ts';
import * as store from './user-model.store.ts';
import { getTimeOfDay, isWorkingHours, formatLocalTime } from './user-model.utils.ts';
import type { TimeOfDay } from './user-model.utils.ts';

/**
 * User Model Service - manages the user's identity, projects, goals, and routines.
 *
 * This is the core "who am I" component that transforms GLaDOS from a generic
 * chatbot to a personalized assistant.
 */
class UserModelService {
  #services: Services;

  constructor(services: Services) {
    this.#services = services;
  }

  // ==========================================================================
  // Identity
  // ==========================================================================

  /**
   * Gets the user's identity. Returns null if not yet configured.
   */
  getIdentity = async (): Promise<Identity | null> => {
    const db = this.#services.get(DatabaseService);
    return store.getIdentity(db.knex);
  };

  /**
   * Creates or initializes the user's identity.
   */
  createIdentity = async (input: IdentityInput): Promise<Identity> => {
    const db = this.#services.get(DatabaseService);
    return store.createIdentity(db.knex, input);
  };

  /**
   * Updates the user's identity.
   */
  updateIdentity = async (updates: Partial<IdentityInput>): Promise<Identity> => {
    const db = this.#services.get(DatabaseService);
    return store.updateIdentity(db.knex, updates);
  };

  /**
   * Checks if it's currently within the user's working hours.
   * Uses the user's configured timezone for calculation.
   */
  isWorkingHours = async (date: Date = new Date()): Promise<boolean> => {
    const identity = await this.getIdentity();
    if (!identity) return false;
    return isWorkingHours(identity.workingHours, date, identity.timezone);
  };

  /**
   * Gets the current time of day in the user's timezone.
   */
  getTimeOfDay = async (date: Date = new Date()): Promise<TimeOfDay> => {
    const identity = await this.getIdentity();
    return getTimeOfDay(date, identity?.timezone);
  };

  /**
   * Formats a date as a human-readable local time string in the user's timezone.
   */
  formatLocalTime = async (date: Date = new Date()): Promise<string> => {
    const identity = await this.getIdentity();
    return formatLocalTime(date, identity?.timezone ?? 'UTC');
  };

  // ==========================================================================
  // Projects
  // ==========================================================================

  /**
   * Gets all projects, optionally filtered by status.
   */
  getProjects = async (filter?: { status?: ProjectStatus }): Promise<Project[]> => {
    const db = this.#services.get(DatabaseService);
    return store.getProjects(db.knex, filter);
  };

  /**
   * Gets a project by ID.
   */
  getProject = async (id: string): Promise<Project | null> => {
    const db = this.#services.get(DatabaseService);
    return store.getProject(db.knex, id);
  };

  /**
   * Creates a new project.
   */
  createProject = async (input: CreateProjectInput): Promise<Project> => {
    const db = this.#services.get(DatabaseService);
    return store.createProject(db.knex, input);
  };

  /**
   * Updates a project.
   */
  updateProject = async (id: string, updates: UpdateProjectInput): Promise<Project> => {
    const db = this.#services.get(DatabaseService);
    return store.updateProject(db.knex, id, updates);
  };

  /**
   * Deletes a project.
   */
  deleteProject = async (id: string): Promise<void> => {
    const db = this.#services.get(DatabaseService);
    return store.deleteProject(db.knex, id);
  };

  /**
   * Gets all active projects.
   */
  getActiveProjects = async (): Promise<Project[]> => {
    return this.getProjects({ status: 'active' });
  };

  // ==========================================================================
  // Goals
  // ==========================================================================

  /**
   * Gets all goals, optionally filtered by timeframe.
   */
  getGoals = async (filter?: { timeframe?: GoalTimeframe }): Promise<Goal[]> => {
    const db = this.#services.get(DatabaseService);
    return store.getGoals(db.knex, filter);
  };

  /**
   * Gets a goal by ID.
   */
  getGoal = async (id: string): Promise<Goal | null> => {
    const db = this.#services.get(DatabaseService);
    return store.getGoal(db.knex, id);
  };

  /**
   * Creates a new goal.
   */
  createGoal = async (input: CreateGoalInput): Promise<Goal> => {
    const db = this.#services.get(DatabaseService);
    return store.createGoal(db.knex, input);
  };

  /**
   * Updates a goal.
   */
  updateGoal = async (id: string, updates: UpdateGoalInput): Promise<Goal> => {
    const db = this.#services.get(DatabaseService);
    return store.updateGoal(db.knex, id, updates);
  };

  /**
   * Deletes a goal.
   */
  deleteGoal = async (id: string): Promise<void> => {
    const db = this.#services.get(DatabaseService);
    return store.deleteGoal(db.knex, id);
  };

  // ==========================================================================
  // Routines
  // ==========================================================================

  /**
   * Gets all routines, optionally filtered by enabled status.
   */
  getRoutines = async (filter?: { enabled?: boolean }): Promise<Routine[]> => {
    const db = this.#services.get(DatabaseService);
    return store.getRoutines(db.knex, filter);
  };

  /**
   * Gets a routine by ID.
   */
  getRoutine = async (id: string): Promise<Routine | null> => {
    const db = this.#services.get(DatabaseService);
    return store.getRoutine(db.knex, id);
  };

  /**
   * Creates a new routine.
   */
  createRoutine = async (input: CreateRoutineInput): Promise<Routine> => {
    const db = this.#services.get(DatabaseService);
    return store.createRoutine(db.knex, input);
  };

  /**
   * Updates a routine.
   */
  updateRoutine = async (id: string, updates: UpdateRoutineInput): Promise<Routine> => {
    const db = this.#services.get(DatabaseService);
    return store.updateRoutine(db.knex, id, updates);
  };

  /**
   * Deletes a routine.
   */
  deleteRoutine = async (id: string): Promise<void> => {
    const db = this.#services.get(DatabaseService);
    return store.deleteRoutine(db.knex, id);
  };

  /**
   * Gets all enabled routines.
   */
  getActiveRoutines = async (): Promise<Routine[]> => {
    return this.getRoutines({ enabled: true });
  };

  /**
   * Records that a routine has just run.
   */
  recordRoutineRun = async (id: string): Promise<void> => {
    const db = this.#services.get(DatabaseService);
    return store.updateRoutineLastRun(db.knex, id);
  };
}

// Re-export types from schemas
export type {
  Identity,
  IdentityInput,
  Project,
  CreateProjectInput,
  UpdateProjectInput,
  ProjectStatus,
  ProjectPriority,
  Goal,
  CreateGoalInput,
  UpdateGoalInput,
  GoalTimeframe,
  Routine,
  CreateRoutineInput,
  UpdateRoutineInput,
  WorkingHours,
  Preferences,
} from './user-model.schemas.ts';
export type { TimeOfDay } from './user-model.utils.ts';

export { UserModelService };
export { getTimeOfDay, isWorkingHours, formatLocalTime, getTimeInTimezone } from './user-model.utils.ts';
