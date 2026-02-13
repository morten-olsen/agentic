import type { Knex } from 'knex';

/**
 * Phase 4 Memory tables.
 * Creates the memories table for long-term learning and retrieval.
 */
const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('memories', (table) => {
    table.text('id').primary();
    table.text('type').notNullable(); // 'conversation' | 'fact' | 'preference' | 'procedure' | 'event'
    table.text('content').notNullable();
    table.binary('embedding'); // Serialized float32 array
    table.text('metadata'); // JSON
    table.float('importance').notNullable().defaultTo(0.5);
    table.text('created_at').notNullable();
    table.text('last_accessed_at').notNullable();
    table.integer('access_count').notNullable().defaultTo(0);
  });

  await knex.schema.raw('CREATE INDEX idx_memories_type ON memories(type)');
  await knex.schema.raw('CREATE INDEX idx_memories_importance ON memories(importance)');
  await knex.schema.raw('CREATE INDEX idx_memories_created ON memories(created_at)');
};

const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('memories');
};

export { up, down };
