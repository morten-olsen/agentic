import type { Knex } from 'knex';

/**
 * Phase 5: Long-Running Tasks
 * Creates tables for User Tasks and Delegated Tasks.
 *
 * User Tasks: Items on the user's to-do list with flexible scheduling
 * Delegated Tasks: Multi-step workflows the agent performs autonomously
 */
const up = async (knex: Knex): Promise<void> => {
  // User Tasks table
  await knex.schema.createTable('user_tasks', (table) => {
    table.text('id').primary();
    table.text('description').notNullable();
    table.text('trigger_type').notNullable(); // deadline, recurring_time, recurring_completion, opportunistic, deferred, conditional
    table.text('trigger_config').notNullable(); // JSON with trigger-specific config
    table.text('status').notNullable().defaultTo('pending'); // pending, active, waiting, completed, cancelled

    // Context
    table.text('related_projects'); // JSON array of project IDs
    table.text('related_contacts'); // JSON array of contact IDs
    table.text('related_entities'); // JSON array of entity IDs

    // Metadata
    table.text('notes');
    table.text('tags'); // JSON array

    // Timestamps
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
    table.text('completed_at');
  });

  await knex.schema.raw('CREATE INDEX idx_user_tasks_status ON user_tasks(status)');
  await knex.schema.raw('CREATE INDEX idx_user_tasks_trigger_type ON user_tasks(trigger_type)');

  // Delegated Tasks table
  await knex.schema.createTable('delegated_tasks', (table) => {
    table.text('id').primary();
    table.text('description').notNullable();

    // Link to user task (if applicable)
    table.text('user_task_id').references('id').inTable('user_tasks').onDelete('SET NULL');

    // Status
    table.text('status').notNullable().defaultTo('pending'); // pending, active, waiting, blocked, completed, cancelled
    table.text('status_reason');

    // Multi-step workflow
    table.text('steps').notNullable(); // JSON array of TaskStep
    table.integer('current_step_index').notNullable().defaultTo(0);

    // Waiting for something
    table.text('waiting_for'); // JSON: { type, description, condition, deadline, checkSchedule, onTimeout }

    // Context
    table.text('conversation_id');
    table.text('related_contacts'); // JSON array
    table.text('related_projects'); // JSON array
    table.text('related_entities'); // JSON array
    table.text('tags'); // JSON array

    // Audit trail
    table.text('history').notNullable(); // JSON array of TaskEvent

    // Timestamps
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
  });

  await knex.schema.raw('CREATE INDEX idx_delegated_tasks_status ON delegated_tasks(status)');
  await knex.schema.raw('CREATE INDEX idx_delegated_tasks_user_task_id ON delegated_tasks(user_task_id)');
};

const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('delegated_tasks');
  await knex.schema.dropTableIfExists('user_tasks');
};

export { up, down };
