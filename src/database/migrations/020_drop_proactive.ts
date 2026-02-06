import type { Knex } from 'knex';

/**
 * Drop Proactive Tables Migration
 *
 * Removes the proactive_checks and proactive_runs tables as the proactive
 * scheduler has been deprecated in favor of the Trigger System.
 *
 * The Trigger System provides:
 * - Agent-managed scheduling (vs hardcoded checks)
 * - Continuation notes for stateful triggers
 * - One-time and cron schedules
 * - Self-management capabilities
 */
const up = async (knex: Knex): Promise<void> => {
  // First, remove the proactive_run_id foreign key from notifications table
  // SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
  // However, we can simply set all proactive_run_id values to NULL and drop the FK constraint
  // by recreating the notifications table without the FK

  // Check if the column exists before trying to modify
  const hasColumn = await knex.schema.hasColumn('notifications', 'proactive_run_id');
  if (hasColumn) {
    // SQLite workaround: create new table, copy data, drop old, rename new
    await knex.schema.createTable('notifications_new', (table) => {
      table.text('id').primary();
      table.text('type').notNullable();
      table.text('title').notNullable();
      table.text('body').notNullable();
      table.text('urgency').notNullable().defaultTo('low');
      table.text('status').notNullable().defaultTo('pending');
      table.text('delivered_via');
      table.text('delivered_at');
      table.text('read_at');
      table.text('dismissed_at');
      table.text('expires_at');
      table.text('snoozed_until');
      table.text('actions');
      table.text('source_type');
      table.text('source_id');
      // Removed: proactive_run_id
      table.text('metadata');
      table.text('created_at').notNullable();
      table.text('updated_at').notNullable();
    });

    // Copy data (excluding proactive_run_id)
    await knex.raw(`
      INSERT INTO notifications_new (
        id, type, title, body, urgency, status, delivered_via, delivered_at,
        read_at, dismissed_at, expires_at, snoozed_until, actions,
        source_type, source_id, metadata, created_at, updated_at
      )
      SELECT
        id, type, title, body, urgency, status, delivered_via, delivered_at,
        read_at, dismissed_at, expires_at, snoozed_until, actions,
        source_type, source_id, metadata, created_at, updated_at
      FROM notifications
    `);

    // Drop old table and rename new one
    await knex.schema.dropTable('notifications');
    await knex.schema.renameTable('notifications_new', 'notifications');

    // Recreate indexes
    await knex.schema.raw('CREATE INDEX idx_notifications_status ON notifications(status)');
    await knex.schema.raw('CREATE INDEX idx_notifications_urgency ON notifications(urgency)');
    await knex.schema.raw('CREATE INDEX idx_notifications_created_at ON notifications(created_at)');
    await knex.schema.raw('CREATE INDEX idx_notifications_source ON notifications(source_type, source_id)');
  }

  // Drop proactive tables (child table first due to FK)
  await knex.schema.dropTableIfExists('proactive_runs');
  await knex.schema.dropTableIfExists('proactive_checks');
};

const down = async (knex: Knex): Promise<void> => {
  // Recreate proactive_checks table
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

  // Recreate proactive_runs table
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

  // Restore proactive_run_id column on notifications table
  // SQLite workaround: recreate the table with the FK column
  await knex.schema.createTable('notifications_new', (table) => {
    table.text('id').primary();
    table.text('type').notNullable();
    table.text('title').notNullable();
    table.text('body').notNullable();
    table.text('urgency').notNullable().defaultTo('low');
    table.text('status').notNullable().defaultTo('pending');
    table.text('delivered_via');
    table.text('delivered_at');
    table.text('read_at');
    table.text('dismissed_at');
    table.text('expires_at');
    table.text('snoozed_until');
    table.text('actions');
    table.text('source_type');
    table.text('source_id');
    table.text('proactive_run_id').references('id').inTable('proactive_runs').onDelete('SET NULL');
    table.text('metadata');
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
  });

  // Copy data back
  await knex.raw(`
    INSERT INTO notifications_new (
      id, type, title, body, urgency, status, delivered_via, delivered_at,
      read_at, dismissed_at, expires_at, snoozed_until, actions,
      source_type, source_id, metadata, created_at, updated_at
    )
    SELECT
      id, type, title, body, urgency, status, delivered_via, delivered_at,
      read_at, dismissed_at, expires_at, snoozed_until, actions,
      source_type, source_id, metadata, created_at, updated_at
    FROM notifications
  `);

  await knex.schema.dropTable('notifications');
  await knex.schema.renameTable('notifications_new', 'notifications');

  // Recreate indexes
  await knex.schema.raw('CREATE INDEX idx_notifications_status ON notifications(status)');
  await knex.schema.raw('CREATE INDEX idx_notifications_urgency ON notifications(urgency)');
  await knex.schema.raw('CREATE INDEX idx_notifications_created_at ON notifications(created_at)');
  await knex.schema.raw('CREATE INDEX idx_notifications_source ON notifications(source_type, source_id)');
};

export { up, down };
