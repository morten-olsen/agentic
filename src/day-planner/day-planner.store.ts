import type { Knex } from 'knex';

import type {
  DayPlan,
  Priority,
  FocusBlock,
  Intention,
  DayPlanRow,
  IntentionRow,
  PriorityRow,
  FocusBlockRow,
  CreateDayPlanInput,
  UpdateDayPlanInput,
  AddPriorityInput,
  UpdatePriorityInput,
  AddFocusBlockInput,
  UpdateFocusBlockInput,
  DayPlanStatus,
  EnergyLevel,
} from './day-planner.schemas.ts';
import { createDayPlanInputSchema, addPriorityInputSchema, addFocusBlockInputSchema } from './day-planner.schemas.ts';

// ============================================================================
// Helpers
// ============================================================================

const generateId = (): string => crypto.randomUUID();
const now = (): string => new Date().toISOString();

/**
 * Gets today's date in YYYY-MM-DD format.
 */
const getTodayDate = (): string => {
  const today = new Date();
  return today.toISOString().split('T')[0];
};

// ============================================================================
// Row to Domain Converters
// ============================================================================

const rowToIntention = (row: IntentionRow): Intention => ({
  id: row.id,
  intention: row.intention,
  sortOrder: row.sort_order,
  createdAt: row.created_at,
});

const rowToPriority = (row: PriorityRow): Priority => ({
  id: row.id,
  description: row.description,
  category: row.category ?? undefined,
  linkedProjectId: row.linked_project_id ?? undefined,
  linkedTaskId: row.linked_task_id ?? undefined,
  completed: row.completed === 1,
  completedAt: row.completed_at ?? undefined,
  sortOrder: row.sort_order,
  createdAt: row.created_at,
});

const rowToFocusBlock = (row: FocusBlockRow): FocusBlock => ({
  id: row.id,
  label: row.label,
  startTime: row.start_time ?? undefined,
  duration: row.duration,
  completed: row.completed === 1,
  sortOrder: row.sort_order,
  createdAt: row.created_at,
});

const rowToDayPlan = (
  row: DayPlanRow,
  intentions: Intention[],
  priorities: Priority[],
  focusBlocks: FocusBlock[],
): DayPlan => ({
  id: row.id,
  date: row.date,
  status: row.status as DayPlanStatus,
  energyLevel: (row.energy_level as EnergyLevel) ?? undefined,
  notes: row.notes ?? undefined,
  intentions,
  priorities,
  focusBlocks,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  completedAt: row.completed_at ?? undefined,
});

// ============================================================================
// Fetch Related Data
// ============================================================================

const fetchIntentions = async (db: Knex, dayPlanId: string): Promise<Intention[]> => {
  const rows = await db<IntentionRow>('day_plan_intentions')
    .where({ day_plan_id: dayPlanId })
    .orderBy('sort_order', 'asc');
  return rows.map(rowToIntention);
};

const fetchPriorities = async (db: Knex, dayPlanId: string): Promise<Priority[]> => {
  const rows = await db<PriorityRow>('day_plan_priorities')
    .where({ day_plan_id: dayPlanId })
    .orderBy('sort_order', 'asc');
  return rows.map(rowToPriority);
};

const fetchFocusBlocks = async (db: Knex, dayPlanId: string): Promise<FocusBlock[]> => {
  const rows = await db<FocusBlockRow>('day_plan_focus_blocks')
    .where({ day_plan_id: dayPlanId })
    .orderBy('sort_order', 'asc');
  return rows.map(rowToFocusBlock);
};

const fetchDayPlanWithRelations = async (db: Knex, row: DayPlanRow): Promise<DayPlan> => {
  const [intentions, priorities, focusBlocks] = await Promise.all([
    fetchIntentions(db, row.id),
    fetchPriorities(db, row.id),
    fetchFocusBlocks(db, row.id),
  ]);
  return rowToDayPlan(row, intentions, priorities, focusBlocks);
};

// ============================================================================
// Day Plan CRUD
// ============================================================================

const createDayPlan = async (db: Knex, input: CreateDayPlanInput): Promise<DayPlan> => {
  const validated = createDayPlanInputSchema.parse(input);
  const id = generateId();
  const timestamp = now();
  const date = validated.date ?? getTodayDate();

  // Insert day plan
  const planRow: DayPlanRow = {
    id,
    date,
    status: 'draft',
    energy_level: validated.energyLevel ?? null,
    notes: validated.notes ?? null,
    created_at: timestamp,
    updated_at: timestamp,
    completed_at: null,
  };
  await db('day_plans').insert(planRow);

  // Insert intentions
  const intentions: Intention[] = [];
  for (let i = 0; i < validated.intentions.length; i++) {
    const intentionId = generateId();
    const intentionRow: IntentionRow = {
      id: intentionId,
      day_plan_id: id,
      intention: validated.intentions[i],
      sort_order: i,
      created_at: timestamp,
    };
    await db('day_plan_intentions').insert(intentionRow);
    intentions.push(rowToIntention(intentionRow));
  }

  // Insert priorities
  const priorities: Priority[] = [];
  for (let i = 0; i < validated.priorities.length; i++) {
    const priorityId = generateId();
    const p = validated.priorities[i];
    const priorityRow: PriorityRow = {
      id: priorityId,
      day_plan_id: id,
      description: p.description,
      category: p.category ?? null,
      linked_project_id: p.linkedProjectId ?? null,
      linked_task_id: p.linkedTaskId ?? null,
      completed: 0,
      completed_at: null,
      sort_order: i,
      created_at: timestamp,
    };
    await db('day_plan_priorities').insert(priorityRow);
    priorities.push(rowToPriority(priorityRow));
  }

  // Insert focus blocks
  const focusBlocks: FocusBlock[] = [];
  for (let i = 0; i < validated.focusBlocks.length; i++) {
    const blockId = generateId();
    const b = validated.focusBlocks[i];
    const blockRow: FocusBlockRow = {
      id: blockId,
      day_plan_id: id,
      label: b.label,
      start_time: b.startTime ?? null,
      duration: b.duration,
      completed: 0,
      sort_order: i,
      created_at: timestamp,
    };
    await db('day_plan_focus_blocks').insert(blockRow);
    focusBlocks.push(rowToFocusBlock(blockRow));
  }

  return rowToDayPlan(planRow, intentions, priorities, focusBlocks);
};

const getDayPlan = async (db: Knex, id: string): Promise<DayPlan | null> => {
  const row = await db<DayPlanRow>('day_plans').where({ id }).first();
  if (!row) return null;
  return fetchDayPlanWithRelations(db, row);
};

const getDayPlanByDate = async (db: Knex, date: string): Promise<DayPlan | null> => {
  const row = await db<DayPlanRow>('day_plans').where({ date }).first();
  if (!row) return null;
  return fetchDayPlanWithRelations(db, row);
};

const updateDayPlan = async (db: Knex, id: string, updates: UpdateDayPlanInput): Promise<DayPlan | null> => {
  const timestamp = now();

  const updateData: Partial<DayPlanRow> = {
    updated_at: timestamp,
  };

  if (updates.energyLevel !== undefined) {
    updateData.energy_level = updates.energyLevel;
  }
  if (updates.notes !== undefined) {
    updateData.notes = updates.notes;
  }
  if (updates.status !== undefined) {
    updateData.status = updates.status;
    if (updates.status === 'completed' || updates.status === 'abandoned') {
      updateData.completed_at = timestamp;
    }
  }

  const count = await db('day_plans').where({ id }).update(updateData);
  if (count === 0) return null;

  return getDayPlan(db, id);
};

const deleteDayPlan = async (db: Knex, id: string): Promise<boolean> => {
  const count = await db('day_plans').where({ id }).delete();
  return count > 0;
};

// ============================================================================
// Intention Operations
// ============================================================================

const addIntention = async (db: Knex, dayPlanId: string, intention: string): Promise<Intention> => {
  const timestamp = now();

  // Get max sort order
  const maxResult = await db('day_plan_intentions')
    .where({ day_plan_id: dayPlanId })
    .max('sort_order as maxOrder')
    .first();
  const sortOrder = (maxResult?.maxOrder ?? -1) + 1;

  const id = generateId();
  const row: IntentionRow = {
    id,
    day_plan_id: dayPlanId,
    intention,
    sort_order: sortOrder,
    created_at: timestamp,
  };

  await db('day_plan_intentions').insert(row);

  // Update day plan timestamp
  await db('day_plans').where({ id: dayPlanId }).update({ updated_at: timestamp });

  return rowToIntention(row);
};

const removeIntention = async (db: Knex, intentionId: string): Promise<boolean> => {
  // Get the intention first to update parent
  const intention = await db<IntentionRow>('day_plan_intentions').where({ id: intentionId }).first();
  if (!intention) return false;

  const count = await db('day_plan_intentions').where({ id: intentionId }).delete();
  if (count === 0) return false;

  // Update day plan timestamp
  await db('day_plans').where({ id: intention.day_plan_id }).update({ updated_at: now() });

  return true;
};

// ============================================================================
// Priority Operations
// ============================================================================

const addPriority = async (db: Knex, dayPlanId: string, input: AddPriorityInput): Promise<Priority> => {
  const validated = addPriorityInputSchema.parse(input);
  const timestamp = now();
  const id = generateId();

  // Get current priorities to determine sort order
  const priorities = await db<PriorityRow>('day_plan_priorities')
    .where({ day_plan_id: dayPlanId })
    .orderBy('sort_order', 'asc');

  let sortOrder: number;
  if (validated.position !== undefined && validated.position < priorities.length) {
    // Insert at specific position - shift others
    sortOrder = validated.position;
    await db('day_plan_priorities')
      .where({ day_plan_id: dayPlanId })
      .where('sort_order', '>=', sortOrder)
      .increment('sort_order', 1);
  } else {
    // Append at end
    const maxResult = await db('day_plan_priorities')
      .where({ day_plan_id: dayPlanId })
      .max('sort_order as maxOrder')
      .first();
    sortOrder = (maxResult?.maxOrder ?? -1) + 1;
  }

  const row: PriorityRow = {
    id,
    day_plan_id: dayPlanId,
    description: validated.description,
    category: validated.category ?? null,
    linked_project_id: validated.linkedProjectId ?? null,
    linked_task_id: validated.linkedTaskId ?? null,
    completed: 0,
    completed_at: null,
    sort_order: sortOrder,
    created_at: timestamp,
  };

  await db('day_plan_priorities').insert(row);

  // Update day plan timestamp
  await db('day_plans').where({ id: dayPlanId }).update({ updated_at: timestamp });

  return rowToPriority(row);
};

const getPriority = async (db: Knex, priorityId: string): Promise<Priority | null> => {
  const row = await db<PriorityRow>('day_plan_priorities').where({ id: priorityId }).first();
  return row ? rowToPriority(row) : null;
};

const updatePriority = async (db: Knex, priorityId: string, updates: UpdatePriorityInput): Promise<Priority | null> => {
  const timestamp = now();

  // Get priority first to find parent
  const existing = await db<PriorityRow>('day_plan_priorities').where({ id: priorityId }).first();
  if (!existing) return null;

  const updateData: Partial<PriorityRow> = {};

  if (updates.description !== undefined) {
    updateData.description = updates.description;
  }
  if (updates.category !== undefined) {
    updateData.category = updates.category;
  }
  if (updates.linkedProjectId !== undefined) {
    updateData.linked_project_id = updates.linkedProjectId;
  }
  if (updates.linkedTaskId !== undefined) {
    updateData.linked_task_id = updates.linkedTaskId;
  }
  if (updates.completed !== undefined) {
    updateData.completed = updates.completed ? 1 : 0;
    if (updates.completed) {
      updateData.completed_at = timestamp;
    } else {
      updateData.completed_at = null;
    }
  }

  if (Object.keys(updateData).length > 0) {
    await db('day_plan_priorities').where({ id: priorityId }).update(updateData);
    // Update day plan timestamp
    await db('day_plans').where({ id: existing.day_plan_id }).update({ updated_at: timestamp });
  }

  return getPriority(db, priorityId);
};

const removePriority = async (db: Knex, priorityId: string): Promise<boolean> => {
  // Get priority first to update parent
  const priority = await db<PriorityRow>('day_plan_priorities').where({ id: priorityId }).first();
  if (!priority) return false;

  const count = await db('day_plan_priorities').where({ id: priorityId }).delete();
  if (count === 0) return false;

  // Update day plan timestamp
  await db('day_plans').where({ id: priority.day_plan_id }).update({ updated_at: now() });

  return true;
};

const reorderPriorities = async (db: Knex, dayPlanId: string, priorityIds: string[]): Promise<void> => {
  const timestamp = now();

  for (let i = 0; i < priorityIds.length; i++) {
    await db('day_plan_priorities').where({ id: priorityIds[i], day_plan_id: dayPlanId }).update({ sort_order: i });
  }

  // Update day plan timestamp
  await db('day_plans').where({ id: dayPlanId }).update({ updated_at: timestamp });
};

// ============================================================================
// Focus Block Operations
// ============================================================================

const addFocusBlock = async (db: Knex, dayPlanId: string, input: AddFocusBlockInput): Promise<FocusBlock> => {
  const validated = addFocusBlockInputSchema.parse(input);
  const timestamp = now();
  const id = generateId();

  // Get max sort order
  const maxResult = await db('day_plan_focus_blocks')
    .where({ day_plan_id: dayPlanId })
    .max('sort_order as maxOrder')
    .first();
  const sortOrder = (maxResult?.maxOrder ?? -1) + 1;

  const row: FocusBlockRow = {
    id,
    day_plan_id: dayPlanId,
    label: validated.label,
    start_time: validated.startTime ?? null,
    duration: validated.duration,
    completed: 0,
    sort_order: sortOrder,
    created_at: timestamp,
  };

  await db('day_plan_focus_blocks').insert(row);

  // Update day plan timestamp
  await db('day_plans').where({ id: dayPlanId }).update({ updated_at: timestamp });

  return rowToFocusBlock(row);
};

const getFocusBlock = async (db: Knex, focusBlockId: string): Promise<FocusBlock | null> => {
  const row = await db<FocusBlockRow>('day_plan_focus_blocks').where({ id: focusBlockId }).first();
  return row ? rowToFocusBlock(row) : null;
};

const updateFocusBlock = async (
  db: Knex,
  focusBlockId: string,
  updates: UpdateFocusBlockInput,
): Promise<FocusBlock | null> => {
  const timestamp = now();

  // Get focus block first to find parent
  const existing = await db<FocusBlockRow>('day_plan_focus_blocks').where({ id: focusBlockId }).first();
  if (!existing) return null;

  const updateData: Partial<FocusBlockRow> = {};

  if (updates.label !== undefined) {
    updateData.label = updates.label;
  }
  if (updates.startTime !== undefined) {
    updateData.start_time = updates.startTime;
  }
  if (updates.duration !== undefined) {
    updateData.duration = updates.duration;
  }
  if (updates.completed !== undefined) {
    updateData.completed = updates.completed ? 1 : 0;
  }

  if (Object.keys(updateData).length > 0) {
    await db('day_plan_focus_blocks').where({ id: focusBlockId }).update(updateData);
    // Update day plan timestamp
    await db('day_plans').where({ id: existing.day_plan_id }).update({ updated_at: timestamp });
  }

  return getFocusBlock(db, focusBlockId);
};

const removeFocusBlock = async (db: Knex, focusBlockId: string): Promise<boolean> => {
  // Get focus block first to update parent
  const block = await db<FocusBlockRow>('day_plan_focus_blocks').where({ id: focusBlockId }).first();
  if (!block) return false;

  const count = await db('day_plan_focus_blocks').where({ id: focusBlockId }).delete();
  if (count === 0) return false;

  // Update day plan timestamp
  await db('day_plans').where({ id: block.day_plan_id }).update({ updated_at: now() });

  return true;
};

// ============================================================================
// Query Operations
// ============================================================================

const getRecentPlans = async (db: Knex, days: number): Promise<DayPlan[]> => {
  const rows = await db<DayPlanRow>('day_plans').orderBy('date', 'desc').limit(days);

  const plans: DayPlan[] = [];
  for (const row of rows) {
    plans.push(await fetchDayPlanWithRelations(db, row));
  }
  return plans;
};

// ============================================================================
// Exports
// ============================================================================

export {
  // Helpers
  getTodayDate,
  // Day Plan CRUD
  createDayPlan,
  getDayPlan,
  getDayPlanByDate,
  updateDayPlan,
  deleteDayPlan,
  // Intention operations
  addIntention,
  removeIntention,
  // Priority operations
  addPriority,
  getPriority,
  updatePriority,
  removePriority,
  reorderPriorities,
  // Focus block operations
  addFocusBlock,
  getFocusBlock,
  updateFocusBlock,
  removeFocusBlock,
  // Query operations
  getRecentPlans,
};
