import type { Knex } from 'knex';

import type {
  DelegatedTask,
  DelegatedTaskRow,
  CreateDelegatedTaskInput,
  UpdateDelegatedTaskInput,
  DelegatedTaskStatus,
  TaskStep,
  TaskEvent,
  WaitingFor,
} from './tasks.schemas.ts';
import { createDelegatedTaskInputSchema } from './tasks.schemas.ts';

// ============================================================================
// Helpers
// ============================================================================

const generateId = (): string => crypto.randomUUID();
const now = (): string => new Date().toISOString();

const rowToDelegatedTask = (row: DelegatedTaskRow): DelegatedTask => ({
  id: row.id,
  description: row.description,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  userTaskId: row.user_task_id ?? undefined,
  status: row.status as DelegatedTaskStatus,
  statusReason: row.status_reason ?? undefined,
  steps: JSON.parse(row.steps),
  currentStepIndex: row.current_step_index,
  waitingFor: row.waiting_for ? JSON.parse(row.waiting_for) : undefined,
  conversationId: row.conversation_id ?? undefined,
  relatedContacts: row.related_contacts ? JSON.parse(row.related_contacts) : [],
  relatedProjects: row.related_projects ? JSON.parse(row.related_projects) : [],
  relatedEntities: row.related_entities ? JSON.parse(row.related_entities) : [],
  tags: row.tags ? JSON.parse(row.tags) : [],
  history: JSON.parse(row.history),
});

const createTaskEvent = (type: TaskEvent['type'], details: string, metadata?: Record<string, unknown>): TaskEvent => ({
  timestamp: now(),
  type,
  details,
  metadata,
});

// ============================================================================
// Delegated Task CRUD
// ============================================================================

const createDelegatedTask = async (db: Knex, input: CreateDelegatedTaskInput): Promise<DelegatedTask> => {
  const validated = createDelegatedTaskInputSchema.parse(input);
  const id = generateId();
  const timestamp = now();

  // Create steps with IDs and initial status
  const steps: TaskStep[] = validated.steps.map((step, index) => ({
    id: `${id}-step-${index}`,
    description: step.description,
    status: 'pending',
  }));

  // Initial history event
  const history: TaskEvent[] = [createTaskEvent('created', `Task created: ${validated.description}`)];

  const row: DelegatedTaskRow = {
    id,
    description: validated.description,
    user_task_id: validated.userTaskId ?? null,
    status: 'pending',
    status_reason: null,
    steps: JSON.stringify(steps),
    current_step_index: 0,
    waiting_for: null,
    conversation_id: validated.conversationId ?? null,
    related_contacts: JSON.stringify(validated.relatedContacts),
    related_projects: JSON.stringify(validated.relatedProjects),
    related_entities: JSON.stringify(validated.relatedEntities),
    tags: JSON.stringify(validated.tags),
    history: JSON.stringify(history),
    created_at: timestamp,
    updated_at: timestamp,
  };

  await db('delegated_tasks').insert(row);
  return rowToDelegatedTask(row);
};

const getDelegatedTask = async (db: Knex, id: string): Promise<DelegatedTask | null> => {
  const row = await db<DelegatedTaskRow>('delegated_tasks').where({ id }).first();
  return row ? rowToDelegatedTask(row) : null;
};

const updateDelegatedTask = async (
  db: Knex,
  id: string,
  updates: UpdateDelegatedTaskInput,
): Promise<DelegatedTask | null> => {
  const timestamp = now();

  const updateData: Partial<DelegatedTaskRow> = {
    updated_at: timestamp,
  };

  if (updates.description !== undefined) updateData.description = updates.description;
  if (updates.status !== undefined) updateData.status = updates.status;
  if (updates.statusReason !== undefined) updateData.status_reason = updates.statusReason;
  if (updates.waitingFor !== undefined) {
    updateData.waiting_for = updates.waitingFor ? JSON.stringify(updates.waitingFor) : null;
  }
  if (updates.relatedContacts !== undefined) updateData.related_contacts = JSON.stringify(updates.relatedContacts);
  if (updates.relatedProjects !== undefined) updateData.related_projects = JSON.stringify(updates.relatedProjects);
  if (updates.relatedEntities !== undefined) updateData.related_entities = JSON.stringify(updates.relatedEntities);
  if (updates.tags !== undefined) updateData.tags = JSON.stringify(updates.tags);

  const count = await db('delegated_tasks').where({ id }).update(updateData);
  if (count === 0) return null;

  return getDelegatedTask(db, id);
};

const deleteDelegatedTask = async (db: Knex, id: string): Promise<boolean> => {
  const count = await db('delegated_tasks').where({ id }).delete();
  return count > 0;
};

// ============================================================================
// Delegated Task Queries
// ============================================================================

const listDelegatedTasks = async (
  db: Knex,
  options?: { status?: DelegatedTaskStatus; userTaskId?: string; limit?: number },
): Promise<DelegatedTask[]> => {
  let query = db<DelegatedTaskRow>('delegated_tasks');

  if (options?.status) {
    query = query.where({ status: options.status });
  }

  if (options?.userTaskId) {
    query = query.where({ user_task_id: options.userTaskId });
  }

  query = query.orderBy('created_at', 'desc');

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const rows = await query;
  return rows.map(rowToDelegatedTask);
};

const getActiveDelegatedTasks = async (db: Knex): Promise<DelegatedTask[]> => {
  const rows = await db<DelegatedTaskRow>('delegated_tasks').where({ status: 'active' }).orderBy('created_at', 'asc');
  return rows.map(rowToDelegatedTask);
};

const getWaitingDelegatedTasks = async (db: Knex): Promise<DelegatedTask[]> => {
  const rows = await db<DelegatedTaskRow>('delegated_tasks').where({ status: 'waiting' }).orderBy('created_at', 'asc');
  return rows.map(rowToDelegatedTask);
};

const getDelegatedTasksForProject = async (db: Knex, projectId: string): Promise<DelegatedTask[]> => {
  const rows = await db<DelegatedTaskRow>('delegated_tasks')
    .whereRaw('json_array_length(related_projects) > 0 AND related_projects LIKE ?', [`%${projectId}%`])
    .orderBy('created_at', 'desc');

  return rows.map(rowToDelegatedTask).filter((task) => task.relatedProjects.includes(projectId));
};

const getDelegatedTasksForUserTask = async (db: Knex, userTaskId: string): Promise<DelegatedTask[]> => {
  const rows = await db<DelegatedTaskRow>('delegated_tasks')
    .where({ user_task_id: userTaskId })
    .orderBy('created_at', 'desc');
  return rows.map(rowToDelegatedTask);
};

// ============================================================================
// Step Management
// ============================================================================

const startTask = async (db: Knex, id: string): Promise<DelegatedTask | null> => {
  const task = await getDelegatedTask(db, id);
  if (!task) return null;
  if (task.status !== 'pending') return null;

  const timestamp = now();
  const steps = [...task.steps];
  if (steps.length > 0) {
    steps[0] = { ...steps[0], status: 'in_progress', startedAt: timestamp };
  }

  const history = [
    ...task.history,
    createTaskEvent('started', 'Task started'),
    ...(steps.length > 0 ? [createTaskEvent('step_started', `Started step: ${steps[0].description}`)] : []),
  ];

  await db('delegated_tasks')
    .where({ id })
    .update({
      status: 'active',
      steps: JSON.stringify(steps),
      history: JSON.stringify(history),
      updated_at: timestamp,
    });

  return getDelegatedTask(db, id);
};

const advanceStep = async (db: Knex, id: string, result?: unknown): Promise<DelegatedTask | null> => {
  const task = await getDelegatedTask(db, id);
  if (!task) return null;
  if (task.status !== 'active') return null;

  const timestamp = now();
  const steps = [...task.steps];
  const currentIndex = task.currentStepIndex;

  // Mark current step as completed
  if (currentIndex < steps.length) {
    steps[currentIndex] = {
      ...steps[currentIndex],
      status: 'completed',
      result,
      completedAt: timestamp,
    };
  }

  const history = [...task.history];
  history.push(createTaskEvent('step_completed', `Completed step: ${steps[currentIndex].description}`, { result }));

  const nextIndex = currentIndex + 1;

  // Check if all steps are done
  if (nextIndex >= steps.length) {
    history.push(createTaskEvent('completed', 'All steps completed'));

    await db('delegated_tasks')
      .where({ id })
      .update({
        status: 'completed',
        steps: JSON.stringify(steps),
        current_step_index: nextIndex,
        history: JSON.stringify(history),
        updated_at: timestamp,
      });
  } else {
    // Start next step
    steps[nextIndex] = { ...steps[nextIndex], status: 'in_progress', startedAt: timestamp };
    history.push(createTaskEvent('step_started', `Started step: ${steps[nextIndex].description}`));

    await db('delegated_tasks')
      .where({ id })
      .update({
        steps: JSON.stringify(steps),
        current_step_index: nextIndex,
        history: JSON.stringify(history),
        updated_at: timestamp,
      });
  }

  return getDelegatedTask(db, id);
};

const failStep = async (db: Knex, id: string, error: string): Promise<DelegatedTask | null> => {
  const task = await getDelegatedTask(db, id);
  if (!task) return null;
  if (task.status !== 'active') return null;

  const timestamp = now();
  const steps = [...task.steps];
  const currentIndex = task.currentStepIndex;

  if (currentIndex < steps.length) {
    steps[currentIndex] = {
      ...steps[currentIndex],
      status: 'failed',
      error,
      completedAt: timestamp,
    };
  }

  const history = [
    ...task.history,
    createTaskEvent('step_failed', `Step failed: ${steps[currentIndex].description}`, { error }),
    createTaskEvent('failed', `Task failed at step ${currentIndex + 1}: ${error}`),
  ];

  await db('delegated_tasks')
    .where({ id })
    .update({
      status: 'blocked',
      status_reason: error,
      steps: JSON.stringify(steps),
      history: JSON.stringify(history),
      updated_at: timestamp,
    });

  return getDelegatedTask(db, id);
};

const skipStep = async (db: Knex, id: string, reason: string): Promise<DelegatedTask | null> => {
  const task = await getDelegatedTask(db, id);
  if (!task) return null;
  if (task.status !== 'active') return null;

  const timestamp = now();
  const steps = [...task.steps];
  const currentIndex = task.currentStepIndex;

  if (currentIndex < steps.length) {
    steps[currentIndex] = {
      ...steps[currentIndex],
      status: 'skipped',
      error: reason,
      completedAt: timestamp,
    };
  }

  const history = [...task.history];
  history.push(createTaskEvent('step_skipped', `Skipped step: ${steps[currentIndex].description}`, { reason }));

  const nextIndex = currentIndex + 1;

  if (nextIndex >= steps.length) {
    history.push(createTaskEvent('completed', 'All steps completed (some skipped)'));

    await db('delegated_tasks')
      .where({ id })
      .update({
        status: 'completed',
        steps: JSON.stringify(steps),
        current_step_index: nextIndex,
        history: JSON.stringify(history),
        updated_at: timestamp,
      });
  } else {
    steps[nextIndex] = { ...steps[nextIndex], status: 'in_progress', startedAt: timestamp };
    history.push(createTaskEvent('step_started', `Started step: ${steps[nextIndex].description}`));

    await db('delegated_tasks')
      .where({ id })
      .update({
        steps: JSON.stringify(steps),
        current_step_index: nextIndex,
        history: JSON.stringify(history),
        updated_at: timestamp,
      });
  }

  return getDelegatedTask(db, id);
};

// ============================================================================
// Waiting Management
// ============================================================================

const setWaiting = async (db: Knex, id: string, waitingFor: WaitingFor): Promise<DelegatedTask | null> => {
  const task = await getDelegatedTask(db, id);
  if (!task) return null;
  if (task.status !== 'active') return null;

  const timestamp = now();
  const history = [
    ...task.history,
    createTaskEvent('waiting', `Waiting: ${waitingFor.description}`, {
      type: waitingFor.type,
      condition: waitingFor.condition,
    }),
  ];

  await db('delegated_tasks')
    .where({ id })
    .update({
      status: 'waiting',
      waiting_for: JSON.stringify(waitingFor),
      history: JSON.stringify(history),
      updated_at: timestamp,
    });

  return getDelegatedTask(db, id);
};

const resumeTask = async (db: Knex, id: string): Promise<DelegatedTask | null> => {
  const task = await getDelegatedTask(db, id);
  if (!task) return null;
  if (task.status !== 'waiting') return null;

  const timestamp = now();
  const history = [...task.history, createTaskEvent('resumed', 'Task resumed')];

  await db('delegated_tasks')
    .where({ id })
    .update({
      status: 'active',
      waiting_for: null,
      history: JSON.stringify(history),
      updated_at: timestamp,
    });

  return getDelegatedTask(db, id);
};

const checkWaitingConditions = async (db: Knex, currentTime: Date): Promise<DelegatedTask[]> => {
  const waitingTasks = await getWaitingDelegatedTasks(db);
  const readyTasks: DelegatedTask[] = [];

  for (const task of waitingTasks) {
    if (!task.waitingFor) continue;

    // Check time-based waiting
    if (task.waitingFor.type === 'time' && task.waitingFor.deadline) {
      const deadline = new Date(task.waitingFor.deadline);
      if (currentTime >= deadline) {
        readyTasks.push(task);
      }
    }
    // Other waiting types would be checked by external systems
    // and resume would be called explicitly
  }

  return readyTasks;
};

// ============================================================================
// Task Completion
// ============================================================================

const completeTask = async (db: Knex, id: string, summary: string): Promise<DelegatedTask | null> => {
  const task = await getDelegatedTask(db, id);
  if (!task) return null;
  if (task.status === 'completed' || task.status === 'cancelled') return null;

  const timestamp = now();
  const history = [...task.history, createTaskEvent('completed', summary)];

  await db('delegated_tasks')
    .where({ id })
    .update({
      status: 'completed',
      status_reason: summary,
      waiting_for: null,
      history: JSON.stringify(history),
      updated_at: timestamp,
    });

  return getDelegatedTask(db, id);
};

const cancelTask = async (db: Knex, id: string, reason: string): Promise<DelegatedTask | null> => {
  const task = await getDelegatedTask(db, id);
  if (!task) return null;
  if (task.status === 'completed' || task.status === 'cancelled') return null;

  const timestamp = now();
  const history = [...task.history, createTaskEvent('cancelled', reason)];

  await db('delegated_tasks')
    .where({ id })
    .update({
      status: 'cancelled',
      status_reason: reason,
      waiting_for: null,
      history: JSON.stringify(history),
      updated_at: timestamp,
    });

  return getDelegatedTask(db, id);
};

// ============================================================================
// History Management
// ============================================================================

const addHistoryEvent = async (db: Knex, id: string, event: TaskEvent): Promise<DelegatedTask | null> => {
  const task = await getDelegatedTask(db, id);
  if (!task) return null;

  const timestamp = now();
  const history = [...task.history, event];

  await db('delegated_tasks')
    .where({ id })
    .update({
      history: JSON.stringify(history),
      updated_at: timestamp,
    });

  return getDelegatedTask(db, id);
};

// ============================================================================
// Exports
// ============================================================================

export {
  createDelegatedTask,
  getDelegatedTask,
  updateDelegatedTask,
  deleteDelegatedTask,
  listDelegatedTasks,
  getActiveDelegatedTasks,
  getWaitingDelegatedTasks,
  getDelegatedTasksForProject,
  getDelegatedTasksForUserTask,
  startTask,
  advanceStep,
  failStep,
  skipStep,
  setWaiting,
  resumeTask,
  checkWaitingConditions,
  completeTask,
  cancelTask,
  addHistoryEvent,
};
