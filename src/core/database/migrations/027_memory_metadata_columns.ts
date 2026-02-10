import type { Knex } from 'knex';

/**
 * Add entity_ids and topics columns to memories table.
 * These are needed for memory consolidation grouping.
 */
const up = async (knex: Knex): Promise<void> => {
  await knex.schema.alterTable('memories', (table) => {
    table.text('entity_ids').defaultTo('[]'); // JSON array of entity IDs
    table.text('topics').defaultTo('[]'); // JSON array of topics
  });

  await knex.schema.raw('CREATE INDEX idx_memories_updated ON memories(last_accessed_at)');
};

const down = async (knex: Knex): Promise<void> => {
  await knex.schema.alterTable('memories', (table) => {
    table.dropColumn('entity_ids');
    table.dropColumn('topics');
  });

  await knex.schema.raw('DROP INDEX IF EXISTS idx_memories_updated');
};

export { up, down };
