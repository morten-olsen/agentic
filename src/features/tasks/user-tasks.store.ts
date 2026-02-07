import type { Knex } from 'knex';

import type {
  UserTask,
  UserTaskRow,
  CreateUserTaskInput,
  UpdateUserTaskInput,
  TaskTrigger,
  UserTaskStatus,
} from './tasks.schemas.ts';
import { createUserTaskInputSchema } from './tasks.schemas.ts';

// ============================================================================
// Helpers
// ============================================================================

const generateId = (): string => crypto.randomUUID();
const now = (): string => new Date().toISOString();

const rowToUserTask = (row: UserTaskRow): UserTask => {
  const triggerConfig = JSON.parse(row.trigger_config);
  const trigger: TaskTrigger = {
    type: row.trigger_type as TaskTrigger['type'],
    ...triggerConfig,
  };

  return {
    id: row.id,
    description: row.description,
    trigger,
    status: row.status as UserTaskStatus,
    relatedProjects: row.related_projects ? JSON.parse(row.related_projects) : [],
    relatedContacts: row.related_contacts ? JSON.parse(row.related_contacts) : [],
    relatedEntities: row.related_entities ? JSON.parse(row.related_entities) : [],
    notes: row.notes ?? undefined,
    tags: row.tags ? JSON.parse(row.tags) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
  };
};

const triggerToConfig = (trigger: TaskTrigger): string => {
  // Extract everything except 'type' for storage
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { type, ...config } = trigger;
  return JSON.stringify(config);
};

// ============================================================================
// User Task CRUD
// ============================================================================

const createUserTask = async (db: Knex, input: CreateUserTaskInput): Promise<UserTask> => {
  const validated = createUserTaskInputSchema.parse(input);
  const id = generateId();
  const timestamp = now();

  const row: UserTaskRow = {
    id,
    description: validated.description,
    trigger_type: validated.trigger.type,
    trigger_config: triggerToConfig(validated.trigger),
    status: 'pending',
    related_projects: JSON.stringify(validated.relatedProjects),
    related_contacts: JSON.stringify(validated.relatedContacts),
    related_entities: JSON.stringify(validated.relatedEntities),
    notes: validated.notes ?? null,
    tags: JSON.stringify(validated.tags),
    created_at: timestamp,
    updated_at: timestamp,
    completed_at: null,
  };

  await db('user_tasks').insert(row);
  return rowToUserTask(row);
};

const getUserTask = async (db: Knex, id: string): Promise<UserTask | null> => {
  const row = await db<UserTaskRow>('user_tasks').where({ id }).first();
  return row ? rowToUserTask(row) : null;
};

const updateUserTask = async (db: Knex, id: string, updates: UpdateUserTaskInput): Promise<UserTask | null> => {
  const timestamp = now();

  const updateData: Partial<UserTaskRow> = {
    updated_at: timestamp,
  };

  if (updates.description !== undefined) updateData.description = updates.description;
  if (updates.trigger !== undefined) {
    updateData.trigger_type = updates.trigger.type;
    updateData.trigger_config = triggerToConfig(updates.trigger);
  }
  if (updates.status !== undefined) updateData.status = updates.status;
  if (updates.relatedProjects !== undefined) updateData.related_projects = JSON.stringify(updates.relatedProjects);
  if (updates.relatedContacts !== undefined) updateData.related_contacts = JSON.stringify(updates.relatedContacts);
  if (updates.relatedEntities !== undefined) updateData.related_entities = JSON.stringify(updates.relatedEntities);
  if (updates.notes !== undefined) updateData.notes = updates.notes;
  if (updates.tags !== undefined) updateData.tags = JSON.stringify(updates.tags);

  const count = await db('user_tasks').where({ id }).update(updateData);
  if (count === 0) return null;

  return getUserTask(db, id);
};

const deleteUserTask = async (db: Knex, id: string): Promise<boolean> => {
  const count = await db('user_tasks').where({ id }).delete();
  return count > 0;
};

// ============================================================================
// User Task Queries
// ============================================================================

const listUserTasks = async (
  db: Knex,
  options?: { status?: UserTaskStatus; triggerType?: string; limit?: number },
): Promise<UserTask[]> => {
  let query = db<UserTaskRow>('user_tasks');

  if (options?.status) {
    query = query.where({ status: options.status });
  }

  if (options?.triggerType) {
    query = query.where({ trigger_type: options.triggerType });
  }

  query = query.orderBy('created_at', 'desc');

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const rows = await query;
  return rows.map(rowToUserTask);
};

const getActiveUserTasks = async (db: Knex): Promise<UserTask[]> => {
  const rows = await db<UserTaskRow>('user_tasks')
    .whereIn('status', ['pending', 'active', 'waiting'])
    .orderBy('created_at', 'asc');
  return rows.map(rowToUserTask);
};

const getDueUserTasks = async (db: Knex, beforeDate: Date): Promise<UserTask[]> => {
  const isoDate = beforeDate.toISOString();
  const dateOnly = isoDate.split('T')[0]; // YYYY-MM-DD

  // Get deadline tasks that are due before the specified date
  const deadlineRows = await db<UserTaskRow>('user_tasks')
    .where({ trigger_type: 'deadline' })
    .whereIn('status', ['pending', 'active'])
    .whereRaw("json_extract(trigger_config, '$.dueAt') <= ?", [isoDate])
    .orderByRaw("json_extract(trigger_config, '$.dueAt') ASC");

  // Get date tasks that are due on or before the specified date
  const dateRows = await db<UserTaskRow>('user_tasks')
    .where({ trigger_type: 'date' })
    .whereIn('status', ['pending', 'active'])
    .whereRaw("json_extract(trigger_config, '$.date') <= ?", [dateOnly])
    .orderByRaw("json_extract(trigger_config, '$.date') ASC");

  // Combine and sort
  const allRows = [...deadlineRows, ...dateRows];
  return allRows.map(rowToUserTask);
};

const getUserTasksForProject = async (db: Knex, projectId: string): Promise<UserTask[]> => {
  // SQLite JSON functions to search array
  const rows = await db<UserTaskRow>('user_tasks')
    .whereRaw('json_array_length(related_projects) > 0 AND related_projects LIKE ?', [`%${projectId}%`])
    .orderBy('created_at', 'desc');

  // Filter in memory to ensure exact match (LIKE is approximate)
  return rows.map(rowToUserTask).filter((task) => task.relatedProjects.includes(projectId));
};

// ============================================================================
// User Task Status Operations
// ============================================================================

const completeUserTask = async (db: Knex, id: string): Promise<UserTask | null> => {
  const timestamp = now();

  const count = await db('user_tasks').where({ id }).whereNot({ status: 'completed' }).update({
    status: 'completed',
    completed_at: timestamp,
    updated_at: timestamp,
  });

  if (count === 0) return null;
  return getUserTask(db, id);
};

const cancelUserTask = async (db: Knex, id: string): Promise<UserTask | null> => {
  const timestamp = now();

  const count = await db('user_tasks').where({ id }).whereNotIn('status', ['completed', 'cancelled']).update({
    status: 'cancelled',
    updated_at: timestamp,
  });

  if (count === 0) return null;
  return getUserTask(db, id);
};

// ============================================================================
// Exports
// ============================================================================

export {
  createUserTask,
  getUserTask,
  updateUserTask,
  deleteUserTask,
  listUserTasks,
  getActiveUserTasks,
  getDueUserTasks,
  getUserTasksForProject,
  completeUserTask,
  cancelUserTask,
};
