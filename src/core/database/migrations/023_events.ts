import type { Knex } from 'knex';

const up = async (knex: Knex): Promise<void> => {
  // Create events table
  await knex.schema.createTable('events', (table) => {
    table.text('id').primary();
    table.text('type').notNullable(); // Namespaced: 'calendar.event.created'
    table.text('timestamp').notNullable(); // ISO8601 when event occurred
    table.text('source').notNullable(); // 'calendar-service', 'homeassistant', etc.

    // Deduplication
    table.text('external_id');
    table.text('hash');

    // Content
    table.text('summary'); // Optional human-readable description
    table.text('data').notNullable(); // JSON

    // Relations
    table.text('entity_id');
    table.text('entity_type');
    table.text('conversation_id');
    table.text('message_id');

    // Timestamps
    table.text('created_at').notNullable();

    // Deduplication constraint
    table.unique(['source', 'external_id']);
  });

  // Primary query pattern: events since a timestamp
  await knex.schema.raw('CREATE INDEX idx_events_timestamp ON events(timestamp DESC)');

  // Filter by type (supports prefix matching for wildcards)
  await knex.schema.raw('CREATE INDEX idx_events_type_timestamp ON events(type, timestamp DESC)');

  // Filter by entity
  await knex.schema.raw('CREATE INDEX idx_events_entity ON events(entity_type, entity_id, timestamp DESC)');

  // Lookup by conversation
  await knex.schema.raw('CREATE INDEX idx_events_conversation ON events(conversation_id)');

  // Lookup by message
  await knex.schema.raw('CREATE INDEX idx_events_message ON events(message_id)');

  // Deduplication by hash (for events without external_id)
  await knex.schema.raw('CREATE INDEX idx_events_hash ON events(source, hash)');

  // Create checkpoints table for background task progress tracking
  await knex.schema.createTable('event_checkpoints', (table) => {
    table.text('task_id').primary(); // 'daily-briefing', 'calendar-sync', etc.
    table.text('last_event_id').notNullable(); // Last processed event ID
    table.text('updated_at').notNullable();
  });
};

const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('event_checkpoints');
  await knex.schema.dropTableIfExists('events');
};

export { up, down };
