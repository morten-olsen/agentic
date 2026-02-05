import type { Knex } from 'knex';

/**
 * Adds continuation columns to triggers table.
 * This allows trigger-invoked agents to persist state between invocations.
 */
const up = async (knex: Knex): Promise<void> => {
  await knex.schema.alterTable('triggers', (table) => {
    table.text('continuation').nullable();
    table.text('continuation_updated_at').nullable(); // ISO8601 timestamp
  });
};

const down = async (knex: Knex): Promise<void> => {
  await knex.schema.alterTable('triggers', (table) => {
    table.dropColumn('continuation_updated_at');
    table.dropColumn('continuation');
  });
};

export { up, down };
