import type { Knex } from 'knex';

/**
 * Phase 2 Orchestration Layer tables.
 * Creates all tables needed for Personality, Conversations, Messages, Tool Usage, and Checkpoints.
 */
const up = async (knex: Knex): Promise<void> => {
  // Personality configuration (single row, id='default')
  await knex.schema.createTable('personality', (table) => {
    table.text('id').primary().defaultTo('default');
    table.text('name').notNullable().defaultTo('GLaDOS');
    table.text('role').notNullable().defaultTo('personal assistant');
    table.text('style').notNullable(); // JSON: { formality, verbosity, humor, emoji }
    table.text('traits').notNullable(); // JSON: { proactivity, confidence, directness }
    table.text('core_instructions'); // Custom instructions
    table.text('topic_guidelines'); // JSON: Record<string, string>
    table.text('examples'); // JSON: PersonalityExample[]
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
  });

  // Conversations
  await knex.schema.createTable('conversations', (table) => {
    table.text('id').primary();
    table.text('title');
    table.text('summary');
    table.text('started_at').notNullable();
    table.text('last_activity_at').notNullable();
    table.integer('message_count').notNullable().defaultTo(0);
    table.text('metadata'); // JSON for extensibility
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();

    table.index('last_activity_at');
  });

  // Messages
  await knex.schema.createTable('messages', (table) => {
    table.text('id').primary();
    table.text('conversation_id').notNullable().references('id').inTable('conversations').onDelete('CASCADE');
    table.text('role').notNullable(); // 'system' | 'user' | 'assistant' | 'tool'
    table.text('content').notNullable();
    table.text('tool_call_id'); // For tool messages
    table.text('tool_calls'); // JSON array of tool calls for assistant messages
    table.integer('input_tokens');
    table.integer('output_tokens');
    table.text('metadata'); // JSON for extensibility
    table.text('created_at').notNullable();

    table.index('conversation_id');
    table.index('created_at');
  });

  // Tool usage logging
  await knex.schema.createTable('tool_usage', (table) => {
    table.text('id').primary();
    table.text('conversation_id').references('id').inTable('conversations').onDelete('SET NULL');
    table.text('message_id').references('id').inTable('messages').onDelete('SET NULL');
    table.text('tool_id').notNullable();
    table.text('tool_name').notNullable();
    table.text('input').notNullable(); // JSON
    table.text('output'); // JSON
    table.text('error'); // Error message if failed
    table.text('status').notNullable(); // 'pending' | 'success' | 'error'
    table.integer('duration_ms');
    table.text('started_at').notNullable();
    table.text('completed_at');

    table.index('conversation_id');
    table.index('tool_id');
    table.index('status');
    table.index('started_at');
  });

  // LangGraph checkpoints for resumable conversations
  await knex.schema.createTable('checkpoints', (table) => {
    table.text('conversation_id').notNullable();
    table.text('checkpoint_id').notNullable();
    table.text('parent_checkpoint_id');
    table.text('state').notNullable(); // JSON serialized checkpoint
    table.text('metadata'); // JSON metadata
    table.text('pending_writes'); // JSON array of pending writes
    table.text('created_at').notNullable();
    table.text('updated_at');
    table.primary(['conversation_id', 'checkpoint_id']);

    table.index('conversation_id');
    table.index('created_at');
  });
};

const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('checkpoints');
  await knex.schema.dropTableIfExists('tool_usage');
  await knex.schema.dropTableIfExists('messages');
  await knex.schema.dropTableIfExists('conversations');
  await knex.schema.dropTableIfExists('personality');
};

export { up, down };
