import type { Knex } from 'knex';

/**
 * Phase 4 Memory enhancement: Operator Manuals table.
 * Creates table for storing procedural knowledge about how to perform
 * recurring tasks, with accumulated best practices and user corrections.
 */
const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('operator_manuals', (table) => {
    table.text('id').primary();
    table.text('name').notNullable();
    table.text('domain').notNullable(); // 'finance', 'communication', 'travel', 'meetings', etc.
    table.text('description');
    table.text('steps').notNullable(); // JSON array of OperatorStep
    table.text('best_practices'); // JSON array of strings
    table.text('common_mistakes'); // JSON array of strings
    table.text('user_corrections'); // JSON array of UserCorrection
    table.text('last_used_at');
    table.integer('use_count').notNullable().defaultTo(0);
    table.float('success_rate').notNullable().defaultTo(1.0);
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
  });

  await knex.schema.raw('CREATE INDEX idx_operator_manuals_domain ON operator_manuals(domain)');
  await knex.schema.raw('CREATE INDEX idx_operator_manuals_name ON operator_manuals(name)');
};

const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('operator_manuals');
};

export { up, down };
