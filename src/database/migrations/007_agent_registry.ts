import type { Knex } from 'knex';

/**
 * Phase 7 Tool Discovery enhancement: Agent Registry tables.
 * Creates tables for storing agent specifications and feedback tracking.
 * Enables dynamic agent creation via the Agent Builder.
 */
const up = async (knex: Knex): Promise<void> => {
  // Agent specifications - describes sub-agents that can be created/evolved
  await knex.schema.createTable('agent_specifications', (table) => {
    table.text('id').primary();
    table.text('name').notNullable();
    table.text('purpose').notNullable();
    table.text('system_prompt').notNullable();
    table.text('tools').notNullable(); // JSON array of tool IDs
    table.text('model_tier').notNullable().defaultTo('balanced'); // 'fast' | 'balanced' | 'capable' | 'premium'
    table.integer('max_turns').notNullable().defaultTo(10);
    table.integer('can_ask_user').notNullable().defaultTo(0);
    table.text('risk_ceiling').notNullable().defaultTo('medium'); // Max risk level
    table.text('created_by').notNullable().defaultTo('builtin'); // 'builtin' | 'agent_builder'
    table.text('parent_agent_id').references('id').inTable('agent_specifications');
    table.integer('use_count').notNullable().defaultTo(0);
    table.float('feedback_score').notNullable().defaultTo(0.5);
    table.text('last_used_at');
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
  });

  await knex.schema.raw('CREATE INDEX idx_agent_specifications_purpose ON agent_specifications(purpose)');
  await knex.schema.raw('CREATE INDEX idx_agent_specifications_created_by ON agent_specifications(created_by)');

  // Agent feedback tracking - records outcomes for agent evolution
  await knex.schema.createTable('agent_feedback', (table) => {
    table.text('id').primary();
    table.text('agent_id').notNullable().references('id').inTable('agent_specifications').onDelete('CASCADE');
    table.text('task_id'); // Optional link to delegated task
    table.text('outcome').notNullable(); // 'success' | 'partial' | 'failure'
    table.integer('user_rating'); // 1-5 if user provided
    table.text('notes');
    table.text('created_at').notNullable();
  });

  await knex.schema.raw('CREATE INDEX idx_agent_feedback_agent ON agent_feedback(agent_id)');
};

const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('agent_feedback');
  await knex.schema.dropTableIfExists('agent_specifications');
};

export { up, down };
