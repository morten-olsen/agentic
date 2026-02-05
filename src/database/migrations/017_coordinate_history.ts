import type { Knex } from 'knex';

/**
 * Coordinate History Migration
 * Tracks GPS coordinates over time from any location provider.
 * Provider-agnostic design allows switching between HA, iOS, Android, etc.
 */
const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('coordinate_history', (table) => {
    table.text('id').primary();

    // Core coordinates
    table.float('latitude').notNullable();
    table.float('longitude').notNullable();
    table.float('accuracy').nullable(); // meters
    table.float('altitude').nullable(); // meters
    table.float('speed').nullable(); // m/s
    table.float('bearing').nullable(); // degrees

    // Provider info (agnostic - not HA-specific)
    table.text('provider').notNullable(); // e.g., 'homeassistant', 'ios', 'android', 'manual'
    table.text('source').nullable(); // e.g., 'device_tracker.pixel_9', 'gps', 'wifi'

    // Zone/state info (optional - what the provider thinks)
    table.text('zone').nullable(); // e.g., 'home', 'work', 'not_home'

    // Timestamps
    table.text('recorded_at').notNullable(); // when the coordinate was recorded by the provider
    table.text('created_at').notNullable(); // when we stored it
  });

  // Indexes for common queries
  await knex.schema.raw('CREATE INDEX idx_coordinate_history_recorded_at ON coordinate_history(recorded_at)');
  await knex.schema.raw('CREATE INDEX idx_coordinate_history_provider ON coordinate_history(provider)');
  await knex.schema.raw('CREATE INDEX idx_coordinate_history_zone ON coordinate_history(zone)');
};

const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('coordinate_history');
};

export { up, down };
