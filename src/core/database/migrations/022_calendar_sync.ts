import type { Knex } from 'knex';

const up = async (knex: Knex): Promise<void> => {
  // Add calendar_source_id to calendar_events
  await knex.schema.alterTable('calendar_events', (table) => {
    table.text('calendar_source_id');
  });

  // Create index for efficient queries by source and calendar
  await knex.schema.raw(
    'CREATE INDEX idx_calendar_events_source_calendar ON calendar_events(source, calendar_source_id)',
  );

  // Create sync state table
  await knex.schema.createTable('calendar_sync_state', (table) => {
    table.text('source_id').primary();
    table.text('last_sync_at').notNullable();
    table.text('last_sync_status').notNullable().defaultTo('success');
    table.text('error_message');
    table.integer('events_in_window').notNullable().defaultTo(0);
  });
};

const down = async (knex: Knex): Promise<void> => {
  // Drop sync state table
  await knex.schema.dropTable('calendar_sync_state');

  // Drop index
  await knex.schema.raw('DROP INDEX IF EXISTS idx_calendar_events_source_calendar');

  // Remove calendar_source_id column
  // Note: SQLite doesn't support DROP COLUMN directly, need to recreate table
  // For simplicity, we'll use knex which handles this
  await knex.schema.alterTable('calendar_events', (table) => {
    table.dropColumn('calendar_source_id');
  });
};

export { up, down };
