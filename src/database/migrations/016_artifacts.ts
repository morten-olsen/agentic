import type { Knex } from 'knex';

/**
 * Artifacts System Migration
 * Creates table for storing large tool outputs with TTL-based expiration.
 */
const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('artifacts', (table) => {
    table.text('id').primary();
    table.text('conversation_id').notNullable().references('id').inTable('conversations').onDelete('CASCADE');
    table.text('message_id').notNullable();
    table.text('type').notNullable();
    table.text('mime_type').notNullable().defaultTo('application/json');

    // Data (JSON stored as text, binary as base64)
    table.text('data');

    // Metadata
    table.integer('size_bytes').notNullable();
    table.integer('summary_provided').notNullable().defaultTo(0); // SQLite boolean

    // Lifecycle
    table.integer('ttl_minutes').notNullable().defaultTo(60);
    table.text('created_at').notNullable();
    table.text('expires_at').notNullable();
    table.text('accessed_at').notNullable();
  });

  await knex.schema.raw('CREATE INDEX idx_artifacts_conversation ON artifacts(conversation_id)');
  await knex.schema.raw('CREATE INDEX idx_artifacts_message ON artifacts(message_id)');
  await knex.schema.raw('CREATE INDEX idx_artifacts_expires ON artifacts(expires_at)');
  await knex.schema.raw('CREATE INDEX idx_artifacts_type ON artifacts(type)');
};

const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('artifacts');
};

export { up, down };
