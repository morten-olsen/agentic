import type { Knex } from 'knex';

const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('logs', (table) => {
    table.text('id').primary();
    table.text('timestamp').notNullable();
    table.text('level').notNullable();
    table.text('source').notNullable();
    table.text('message').notNullable();

    // Context references
    table.text('conversation_id');
    table.text('trigger_id');
    table.text('tool_name');

    // Error details
    table.text('error_name');
    table.text('error_message');
    table.text('error_stack');

    // Arbitrary metadata as JSON
    table.text('metadata');

    table.text('created_at').notNullable();

    // Indexes for common query patterns
    table.index('timestamp');
    table.index('level');
    table.index('source');
    table.index('conversation_id');
    table.index('trigger_id');
  });
};

const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTable('logs');
};

export { up, down };
