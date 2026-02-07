import type { Knex } from 'knex';

/**
 * Operator Manuals Migration
 *
 * Creates the operator_manuals table for storing procedural knowledge.
 *
 * NOTE: This feature has been deprecated and will be removed in a future migration.
 * The table is kept for backwards compatibility with existing databases.
 */
const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('operator_manuals', (table) => {
    table.text('id').primary();
    table.text('domain').notNullable();
    table.text('task_pattern').notNullable();
    table.text('description').notNullable();
    table.text('steps').notNullable(); // JSON array
    table.text('best_practices').nullable(); // JSON array
    table.text('corrections').nullable(); // JSON array
    table.text('metadata').nullable(); // JSON object
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
    table.integer('version').notNullable().defaultTo(1);

    table.unique(['domain', 'task_pattern']);
  });

  await knex.schema.raw('CREATE INDEX idx_operator_manuals_domain ON operator_manuals(domain)');
};

const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('operator_manuals');
};

export { up, down };
