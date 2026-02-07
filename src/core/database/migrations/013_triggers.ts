import type { Knex } from 'knex';

/**
 * Trigger System v2 Migration
 * Creates tables for agent-managed scheduled triggers.
 */
const up = async (knex: Knex): Promise<void> => {
  // Triggers table - defines scheduled agent invocations
  await knex.schema.createTable('triggers', (table) => {
    table.text('id').primary();
    table.text('name').notNullable().unique();
    table.text('goal').notNullable();
    table.text('schedule_type').notNullable(); // 'once' | 'cron'
    table.text('schedule_value').notNullable(); // ISO8601 or cron expression
    table.text('model_tier'); // fast, balanced, capable, premium
    table.text('setup_context');

    // Limits (for recurring triggers)
    table.integer('max_invocations');
    table.text('ends_at'); // ISO8601

    // State
    table.text('status').notNullable().defaultTo('active'); // active, paused, completed, failed
    table.integer('invocation_count').notNullable().defaultTo(0);
    table.integer('consecutive_failures').notNullable().defaultTo(0);
    table.text('last_invoked_at');
    table.text('next_invocation_at');
    table.text('last_error');

    // Relationships
    table.text('created_by_conversation_id').references('id').inTable('conversations').onDelete('SET NULL');

    // Timestamps
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
  });

  await knex.schema.raw('CREATE INDEX idx_triggers_status ON triggers(status)');
  await knex.schema.raw('CREATE INDEX idx_triggers_next_invocation ON triggers(next_invocation_at)');
  await knex.schema.raw('CREATE INDEX idx_triggers_created_by ON triggers(created_by_conversation_id)');

  // Trigger-Conversation junction table
  // Tracks which conversations were created by which triggers
  await knex.schema.createTable('trigger_conversations', (table) => {
    table.text('trigger_id').notNullable().references('id').inTable('triggers').onDelete('CASCADE');
    table.text('conversation_id').notNullable().references('id').inTable('conversations').onDelete('CASCADE');
    table.text('invoked_at').notNullable();
    table.primary(['trigger_id', 'conversation_id']);
  });

  await knex.schema.raw('CREATE INDEX idx_trigger_conversations_trigger ON trigger_conversations(trigger_id)');
  await knex.schema.raw(
    'CREATE INDEX idx_trigger_conversations_conversation ON trigger_conversations(conversation_id)',
  );
};

const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('trigger_conversations');
  await knex.schema.dropTableIfExists('triggers');
};

export { up, down };
