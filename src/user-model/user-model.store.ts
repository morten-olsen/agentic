import type { Knex } from 'knex';

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
  Preferences,
} from './user-model.schemas.ts';
import { now } from './user-model.utils.ts';

// ============================================================================
// Row Types (DB representation)
// ============================================================================

type IdentityRow = {
  id: string;
  name: string;
  timezone: string;
  locale: string;
  working_hours_start: string;
  working_hours_end: string;
  working_days: string; // JSON
  preferences: string | null; // JSON
  created_at: string;
  updated_at: string;
};

type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  priority: string;
  tags: string | null; // JSON
  created_at: string;
  updated_at: string;
};

type GoalRow = {
  id: string;
  description: string;
  timeframe: string;
  progress: string | null;
  related_projects: string | null; // JSON
  created_at: string;
  updated_at: string;
};

type RoutineRow = {
  id: string;
  name: string;
  schedule: string;
  description: string | null;
  enabled: number;
  default_location: string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
};

// ============================================================================
// Converters
// ============================================================================

const identityFromRow = (row: IdentityRow): Identity => ({
  name: row.name,
  timezone: row.timezone,
  locale: row.locale,
  workingHours: {
    start: row.working_hours_start,
    end: row.working_hours_end,
    days: JSON.parse(row.working_days) as number[],
  },
  preferences: row.preferences
    ? (JSON.parse(row.preferences) as Preferences)
    : { communicationStyle: 'professional', verbosity: 'balanced', proactivityLevel: 'moderate' },
});

const projectFromRow = (row: ProjectRow): Project => ({
  id: row.id,
  name: row.name,
  description: row.description ?? undefined,
  status: row.status as Project['status'],
  priority: row.priority as Project['priority'],
  relatedContacts: [], // TODO: fetch from project_contacts table
  tags: row.tags ? (JSON.parse(row.tags) as string[]) : [],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const goalFromRow = (row: GoalRow): Goal => ({
  id: row.id,
  description: row.description,
  timeframe: row.timeframe as Goal['timeframe'],
  progress: row.progress ?? undefined,
  relatedProjects: row.related_projects ? (JSON.parse(row.related_projects) as string[]) : [],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const routineFromRow = (row: RoutineRow): Routine => ({
  id: row.id,
  name: row.name,
  schedule: row.schedule,
  description: row.description ?? undefined,
  enabled: row.enabled === 1,
  defaultLocation: row.default_location ?? undefined,
  lastRunAt: row.last_run_at ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// ============================================================================
// Store Functions
// ============================================================================

const getIdentity = async (knex: Knex): Promise<Identity | null> => {
  const row = await knex<IdentityRow>('user_identity').where('id', 'user').first();
  return row ? identityFromRow(row) : null;
};

const createIdentity = async (knex: Knex, input: IdentityInput): Promise<Identity> => {
  const timestamp = now();
  const row: IdentityRow = {
    id: 'user',
    name: input.name,
    timezone: input.timezone ?? 'UTC',
    locale: input.locale ?? 'en-US',
    working_hours_start: input.workingHours?.start ?? '09:00',
    working_hours_end: input.workingHours?.end ?? '17:00',
    working_days: JSON.stringify(input.workingHours?.days ?? [1, 2, 3, 4, 5]),
    preferences: input.preferences ? JSON.stringify(input.preferences) : null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  await knex('user_identity').insert(row);
  return identityFromRow(row);
};

const updateIdentity = async (knex: Knex, updates: Partial<IdentityInput>): Promise<Identity> => {
  const existing = await getIdentity(knex);
  if (!existing) {
    // Create a default identity first, then apply updates
    const defaultIdentity = await createIdentity(knex, {
      name: updates.name ?? 'User',
      timezone: updates.timezone,
      locale: updates.locale,
      workingHours: updates.workingHours,
      preferences: updates.preferences,
    });
    return defaultIdentity;
  }

  const updateData: Partial<IdentityRow> = {
    updated_at: now(),
  };

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.timezone !== undefined) updateData.timezone = updates.timezone;
  if (updates.locale !== undefined) updateData.locale = updates.locale;
  if (updates.workingHours !== undefined) {
    updateData.working_hours_start = updates.workingHours.start;
    updateData.working_hours_end = updates.workingHours.end;
    updateData.working_days = JSON.stringify(updates.workingHours.days);
  }
  if (updates.preferences !== undefined) {
    updateData.preferences = JSON.stringify(updates.preferences);
  }

  await knex('user_identity').where('id', 'user').update(updateData);

  const result = await getIdentity(knex);
  if (!result) {
    throw new Error('Failed to update identity');
  }
  return result;
};

// ============================================================================
// Projects
// ============================================================================

const getProjects = async (knex: Knex, filter?: { status?: ProjectStatus }): Promise<Project[]> => {
  let query = knex<ProjectRow>('projects');
  if (filter?.status) {
    query = query.where('status', filter.status);
  }
  const rows = await query.orderBy('created_at', 'desc');
  return rows.map(projectFromRow);
};

const getProject = async (knex: Knex, id: string): Promise<Project | null> => {
  const row = await knex<ProjectRow>('projects').where('id', id).first();
  return row ? projectFromRow(row) : null;
};

const createProject = async (knex: Knex, input: CreateProjectInput): Promise<Project> => {
  const timestamp = now();
  const id = crypto.randomUUID();

  const row: ProjectRow = {
    id,
    name: input.name,
    description: input.description ?? null,
    status: input.status ?? 'active',
    priority: input.priority ?? 'medium',
    tags: input.tags?.length ? JSON.stringify(input.tags) : null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  await knex('projects').insert(row);

  // Handle related contacts
  if (input.relatedContacts?.length) {
    await knex('project_contacts').insert(
      input.relatedContacts.map((contactId) => ({
        project_id: id,
        contact_id: contactId,
      })),
    );
  }

  const result = await getProject(knex, id);
  if (!result) {
    throw new Error('Failed to create project');
  }
  return result;
};

const updateProject = async (knex: Knex, id: string, updates: UpdateProjectInput): Promise<Project> => {
  const existing = await getProject(knex, id);
  if (!existing) {
    throw new Error('Project not found');
  }

  const updateData: Partial<ProjectRow> = {
    updated_at: now(),
  };

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.description !== undefined) updateData.description = updates.description ?? null;
  if (updates.status !== undefined) updateData.status = updates.status;
  if (updates.priority !== undefined) updateData.priority = updates.priority;
  if (updates.tags !== undefined) updateData.tags = updates.tags.length ? JSON.stringify(updates.tags) : null;

  await knex('projects').where('id', id).update(updateData);

  const result = await getProject(knex, id);
  if (!result) {
    throw new Error('Failed to update project');
  }
  return result;
};

const deleteProject = async (knex: Knex, id: string): Promise<void> => {
  await knex('project_contacts').where('project_id', id).delete();
  await knex('projects').where('id', id).delete();
};

// ============================================================================
// Goals
// ============================================================================

const getGoals = async (knex: Knex, filter?: { timeframe?: GoalTimeframe }): Promise<Goal[]> => {
  let query = knex<GoalRow>('goals');
  if (filter?.timeframe) {
    query = query.where('timeframe', filter.timeframe);
  }
  const rows = await query.orderBy('created_at', 'desc');
  return rows.map(goalFromRow);
};

const getGoal = async (knex: Knex, id: string): Promise<Goal | null> => {
  const row = await knex<GoalRow>('goals').where('id', id).first();
  return row ? goalFromRow(row) : null;
};

const createGoal = async (knex: Knex, input: CreateGoalInput): Promise<Goal> => {
  const timestamp = now();
  const id = crypto.randomUUID();

  const row: GoalRow = {
    id,
    description: input.description,
    timeframe: input.timeframe,
    progress: input.progress ?? null,
    related_projects: input.relatedProjects?.length ? JSON.stringify(input.relatedProjects) : null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  await knex('goals').insert(row);

  const result = await getGoal(knex, id);
  if (!result) {
    throw new Error('Failed to create goal');
  }
  return result;
};

const updateGoal = async (knex: Knex, id: string, updates: UpdateGoalInput): Promise<Goal> => {
  const existing = await getGoal(knex, id);
  if (!existing) {
    throw new Error('Goal not found');
  }

  const updateData: Partial<GoalRow> = {
    updated_at: now(),
  };

  if (updates.description !== undefined) updateData.description = updates.description;
  if (updates.timeframe !== undefined) updateData.timeframe = updates.timeframe;
  if (updates.progress !== undefined) updateData.progress = updates.progress ?? null;
  if (updates.relatedProjects !== undefined) {
    updateData.related_projects = updates.relatedProjects.length ? JSON.stringify(updates.relatedProjects) : null;
  }

  await knex('goals').where('id', id).update(updateData);

  const result = await getGoal(knex, id);
  if (!result) {
    throw new Error('Failed to update goal');
  }
  return result;
};

const deleteGoal = async (knex: Knex, id: string): Promise<void> => {
  await knex('goals').where('id', id).delete();
};

// ============================================================================
// Routines
// ============================================================================

const getRoutines = async (knex: Knex, filter?: { enabled?: boolean }): Promise<Routine[]> => {
  let query = knex<RoutineRow>('routines');
  if (filter?.enabled !== undefined) {
    query = query.where('enabled', filter.enabled ? 1 : 0);
  }
  const rows = await query.orderBy('created_at', 'desc');
  return rows.map(routineFromRow);
};

const getRoutine = async (knex: Knex, id: string): Promise<Routine | null> => {
  const row = await knex<RoutineRow>('routines').where('id', id).first();
  return row ? routineFromRow(row) : null;
};

const createRoutine = async (knex: Knex, input: CreateRoutineInput): Promise<Routine> => {
  const timestamp = now();
  const id = crypto.randomUUID();

  const row: RoutineRow = {
    id,
    name: input.name,
    schedule: input.schedule,
    description: input.description ?? null,
    enabled: input.enabled === false ? 0 : 1,
    default_location: input.defaultLocation ?? null,
    last_run_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  await knex('routines').insert(row);

  const result = await getRoutine(knex, id);
  if (!result) {
    throw new Error('Failed to create routine');
  }
  return result;
};

const updateRoutine = async (knex: Knex, id: string, updates: UpdateRoutineInput): Promise<Routine> => {
  const existing = await getRoutine(knex, id);
  if (!existing) {
    throw new Error('Routine not found');
  }

  const updateData: Partial<RoutineRow> = {
    updated_at: now(),
  };

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.schedule !== undefined) updateData.schedule = updates.schedule;
  if (updates.description !== undefined) updateData.description = updates.description ?? null;
  if (updates.enabled !== undefined) updateData.enabled = updates.enabled ? 1 : 0;
  if (updates.defaultLocation !== undefined) updateData.default_location = updates.defaultLocation ?? null;

  await knex('routines').where('id', id).update(updateData);

  const result = await getRoutine(knex, id);
  if (!result) {
    throw new Error('Failed to update routine');
  }
  return result;
};

const deleteRoutine = async (knex: Knex, id: string): Promise<void> => {
  await knex('routines').where('id', id).delete();
};

const updateRoutineLastRun = async (knex: Knex, id: string): Promise<void> => {
  await knex('routines').where('id', id).update({
    last_run_at: now(),
    updated_at: now(),
  });
};

export {
  // Identity
  getIdentity,
  createIdentity,
  updateIdentity,
  // Projects
  getProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  // Goals
  getGoals,
  getGoal,
  createGoal,
  updateGoal,
  deleteGoal,
  // Routines
  getRoutines,
  getRoutine,
  createRoutine,
  updateRoutine,
  deleteRoutine,
  updateRoutineLastRun,
};
