import type { Knex } from 'knex';

/**
 * Drop Operator Manuals Migration
 *
 * Removes the operator_manuals table as the feature has been deprecated.
 * The functionality was not integrated into the agent workflow and
 * overlapped with existing memory types.
 */
const up = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('operator_manuals');
};

const down = async (knex: Knex): Promise<void> => {
  // Recreate the table if rolling back
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

export { up, down };
