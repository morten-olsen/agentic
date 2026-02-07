import type { Knex } from 'knex';

/**
 * Day Planner Migration
 * Creates tables for daily planning with intentions, priorities, and focus blocks.
 */
const up = async (knex: Knex): Promise<void> => {
  // Day plans table - main entity, one per day
  await knex.schema.createTable('day_plans', (table) => {
    table.text('id').primary();
    table.text('date').notNullable().unique(); // YYYY-MM-DD, only one plan per day
    table.text('status').notNullable().defaultTo('draft'); // draft, active, completed, abandoned
    table.text('energy_level'); // low, medium, high
    table.text('notes');
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
    table.text('completed_at');
  });

  await knex.schema.raw('CREATE INDEX idx_day_plans_date ON day_plans(date)');

  // Day plan intentions table - high-level intentions for the day
  await knex.schema.createTable('day_plan_intentions', (table) => {
    table.text('id').primary();
    table.text('day_plan_id').notNullable().references('id').inTable('day_plans').onDelete('CASCADE');
    table.text('intention').notNullable();
    table.integer('sort_order').notNullable();
    table.text('created_at').notNullable();
  });

  await knex.schema.raw('CREATE INDEX idx_day_plan_intentions_plan ON day_plan_intentions(day_plan_id)');

  // Day plan priorities table - ordered list of priorities
  await knex.schema.createTable('day_plan_priorities', (table) => {
    table.text('id').primary();
    table.text('day_plan_id').notNullable().references('id').inTable('day_plans').onDelete('CASCADE');
    table.text('description').notNullable();
    table.text('category'); // e.g., 'work', 'personal', 'health'
    table.text('linked_project_id'); // Reference to user-model project
    table.text('linked_task_id'); // Reference to delegated/user task
    table.integer('completed').notNullable().defaultTo(0); // SQLite boolean
    table.text('completed_at');
    table.integer('sort_order').notNullable();
    table.text('created_at').notNullable();
  });

  await knex.schema.raw('CREATE INDEX idx_day_plan_priorities_plan ON day_plan_priorities(day_plan_id)');

  // Day plan focus blocks table - dedicated time for deep work
  await knex.schema.createTable('day_plan_focus_blocks', (table) => {
    table.text('id').primary();
    table.text('day_plan_id').notNullable().references('id').inTable('day_plans').onDelete('CASCADE');
    table.text('label').notNullable();
    table.text('start_time'); // Optional - can be unscheduled
    table.integer('duration').notNullable(); // Minutes
    table.integer('completed').notNullable().defaultTo(0); // SQLite boolean
    table.integer('sort_order').notNullable();
    table.text('created_at').notNullable();
  });

  await knex.schema.raw('CREATE INDEX idx_day_plan_focus_blocks_plan ON day_plan_focus_blocks(day_plan_id)');
};

const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('day_plan_focus_blocks');
  await knex.schema.dropTableIfExists('day_plan_priorities');
  await knex.schema.dropTableIfExists('day_plan_intentions');
  await knex.schema.dropTableIfExists('day_plans');
};

export { up, down };
