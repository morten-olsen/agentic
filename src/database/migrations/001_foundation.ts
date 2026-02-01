import type { Knex } from 'knex';

/**
 * Phase 1 Foundation Layer tables.
 * Creates all tables needed for User Model, Contacts, Location, and Calendar services.
 */
const up = async (knex: Knex): Promise<void> => {
  // User identity and preferences (single row)
  await knex.schema.createTable('user_identity', (table) => {
    table.text('id').primary().defaultTo('user');
    table.text('name').notNullable();
    table.text('timezone').notNullable().defaultTo('UTC');
    table.text('locale').notNullable().defaultTo('en-US');
    table.text('working_hours_start').defaultTo('09:00');
    table.text('working_hours_end').defaultTo('17:00');
    table.text('working_days').defaultTo('[1,2,3,4,5]'); // JSON array, Mon-Fri
    table.text('preferences'); // JSON (communication style, etc.)
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
  });

  // Projects
  await knex.schema.createTable('projects', (table) => {
    table.text('id').primary();
    table.text('name').notNullable();
    table.text('description');
    table.text('status').notNullable().defaultTo('active'); // 'active' | 'paused' | 'completed'
    table.text('priority').notNullable().defaultTo('medium'); // 'low' | 'medium' | 'high'
    table.text('tags'); // JSON array
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();

    table.index('status');
  });

  // Goals
  await knex.schema.createTable('goals', (table) => {
    table.text('id').primary();
    table.text('description').notNullable();
    table.text('timeframe').notNullable(); // 'short' | 'medium' | 'long'
    table.text('progress');
    table.text('related_projects'); // JSON array of project IDs
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
  });

  // Routines
  await knex.schema.createTable('routines', (table) => {
    table.text('id').primary();
    table.text('name').notNullable();
    table.text('schedule').notNullable(); // Cron expression
    table.text('description');
    table.integer('enabled').notNullable().defaultTo(1);
    table.text('default_location'); // Location ID
    table.text('last_run_at');
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();

    table.index('enabled');
  });

  // Contacts
  await knex.schema.createTable('contacts', (table) => {
    table.text('id').primary();
    table.text('name').notNullable();
    table.text('email');
    table.text('phone');
    table.text('organization');
    table.text('role');
    table.text('relationship_type'); // 'family' | 'colleague' | etc.
    table.text('relationship_context');
    table.text('relationship_importance').defaultTo('medium');
    table.text('notes');
    table.text('communication_style');
    table.text('last_interaction_at');
    table.text('tags'); // JSON array
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();

    table.index('email');
    table.index('relationship_importance');
  });

  // Contact groups
  await knex.schema.createTable('contact_groups', (table) => {
    table.text('id').primary();
    table.text('name').notNullable();
    table.text('description');
    table.text('created_at').notNullable();
  });

  // Contact group members
  await knex.schema.createTable('contact_group_members', (table) => {
    table.text('group_id').notNullable().references('id').inTable('contact_groups');
    table.text('contact_id').notNullable().references('id').inTable('contacts');
    table.primary(['group_id', 'contact_id']);
  });

  // Project-contact relationships
  await knex.schema.createTable('project_contacts', (table) => {
    table.text('project_id').notNullable().references('id').inTable('projects');
    table.text('contact_id').notNullable().references('id').inTable('contacts');
    table.text('role'); // Their role in this project
    table.primary(['project_id', 'contact_id']);
  });

  // Locations
  await knex.schema.createTable('locations', (table) => {
    table.text('id').primary();
    table.text('name').notNullable();
    table.text('type').notNullable(); // 'home' | 'work' | 'client' | etc.
    table.float('latitude');
    table.float('longitude');
    table.text('address'); // JSON (street, city, etc.)
    table.text('timezone');
    table.integer('is_default').notNullable().defaultTo(0);
    table.text('tags'); // JSON array
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();

    table.index('type');
  });

  // Current location tracking
  await knex.schema.createTable('location_history', (table) => {
    table.text('id').primary();
    table.text('location_id').references('id').inTable('locations');
    table.text('confidence').notNullable(); // 'exact' | 'approximate' | 'inferred'
    table.text('source').notNullable(); // 'manual' | 'calendar' | 'device' | 'schedule'
    table.text('recorded_at').notNullable();

    table.index('recorded_at');
  });

  // Calendar events
  await knex.schema.createTable('calendar_events', (table) => {
    table.text('id').primary();
    table.text('external_id');
    table.text('source').notNullable().defaultTo('local'); // 'local' | 'google' | 'outlook'
    table.text('title').notNullable();
    table.text('description');
    table.text('location');
    table.text('start_time').notNullable();
    table.text('end_time').notNullable();
    table.integer('all_day').notNullable().defaultTo(0);
    table.text('timezone').notNullable();
    table.text('attendees'); // JSON array
    table.text('recurrence_rule');
    table.text('recurrence_exceptions'); // JSON array
    table.integer('requires_prep').notNullable().defaultTo(0);
    table.text('prep_notes');
    table.integer('travel_time_minutes');
    table.text('tags'); // JSON array
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();

    table.index('start_time');
    table.index('source');
  });
};

const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('calendar_events');
  await knex.schema.dropTableIfExists('location_history');
  await knex.schema.dropTableIfExists('locations');
  await knex.schema.dropTableIfExists('project_contacts');
  await knex.schema.dropTableIfExists('contact_group_members');
  await knex.schema.dropTableIfExists('contact_groups');
  await knex.schema.dropTableIfExists('contacts');
  await knex.schema.dropTableIfExists('routines');
  await knex.schema.dropTableIfExists('goals');
  await knex.schema.dropTableIfExists('projects');
  await knex.schema.dropTableIfExists('user_identity');
};

export { up, down };
