import type { Knex } from 'knex';

/**
 * Phase 6: Proactive Scheduler
 * Creates tables for proactive checks and their execution history.
 */
const up = async (knex: Knex): Promise<void> => {
  // Proactive checks table - defines scheduled checks
  await knex.schema.createTable('proactive_checks', (table) => {
    table.text('id').primary();
    table.text('name').notNullable().unique();
    table.text('description').notNullable();
    table.text('schedule').notNullable(); // Cron expression
    table.text('check_type').notNullable().defaultTo('builtin'); // builtin, custom
    table.boolean('enabled').notNullable().defaultTo(true);
    table.text('config'); // JSON - check-specific configuration
    table.text('last_run_at');
    table.text('last_result'); // JSON - ProactiveResult
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
  });

  await knex.schema.raw('CREATE INDEX idx_proactive_checks_enabled ON proactive_checks(enabled)');
  await knex.schema.raw('CREATE INDEX idx_proactive_checks_name ON proactive_checks(name)');

  // Proactive runs table - execution history
  await knex.schema.createTable('proactive_runs', (table) => {
    table.text('id').primary();
    table.text('check_id').notNullable().references('id').inTable('proactive_checks').onDelete('CASCADE');
    table.text('started_at').notNullable();
    table.text('completed_at');
    table.text('status').notNullable().defaultTo('running'); // running, completed, failed, skipped
    table.text('result'); // JSON - ProactiveResult
    table.text('error'); // Error message if failed
    table.text('notification_id'); // Link to notification if one was created
  });

  await knex.schema.raw('CREATE INDEX idx_proactive_runs_check_id ON proactive_runs(check_id)');
  await knex.schema.raw('CREATE INDEX idx_proactive_runs_started_at ON proactive_runs(started_at)');
  await knex.schema.raw('CREATE INDEX idx_proactive_runs_status ON proactive_runs(status)');
};

const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('proactive_runs');
  await knex.schema.dropTableIfExists('proactive_checks');
};

export { up, down };
