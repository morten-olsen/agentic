import type { Knex } from 'knex';

const up = async (knex: Knex): Promise<void> => {
  // Create health records table
  await knex.schema.createTable('health_records', (table) => {
    table.text('id').primary(); // ULID

    // Source identification
    table.text('provider').notNullable(); // 'oura', 'whoop', etc.
    table.text('external_id').notNullable(); // Provider's unique ID

    // Record type and timing
    table.text('type').notNullable(); // 'sleep', 'activity', 'readiness', etc.
    table.text('date').notNullable(); // YYYY-MM-DD
    table.text('period_start').notNullable(); // ISO8601
    table.text('period_end').notNullable(); // ISO8601

    // Normalized score
    table.integer('score'); // 0-100 or NULL

    // Full data
    table.text('normalized_data').notNullable(); // JSON (SleepData, ActivityData, etc.)
    table.text('raw_data').notNullable(); // JSON (original payload)

    // Timestamps
    table.text('recorded_at').notNullable(); // When provider recorded
    table.text('received_at').notNullable(); // When we received webhook
    table.text('created_at').notNullable();

    // Deduplication constraint
    table.unique(['provider', 'external_id']);
  });

  // Query by date range
  await knex.schema.raw('CREATE INDEX idx_health_date ON health_records(date DESC)');

  // Query by type and date
  await knex.schema.raw('CREATE INDEX idx_health_type_date ON health_records(type, date DESC)');

  // Query by provider, type, and date
  await knex.schema.raw('CREATE INDEX idx_health_provider ON health_records(provider, type, date DESC)');

  // Create webhook sync state table
  await knex.schema.createTable('health_webhook_state', (table) => {
    table.text('id').primary(); // 'oura', 'whoop', etc.
    table.text('subscription_id'); // Provider's subscription ID
    table.text('subscribed_types').notNullable(); // JSON array of data types
    table.text('callback_url').notNullable();
    table.text('expires_at'); // Subscription expiry (Oura webhooks expire)
    table.text('last_event_at'); // Last received webhook timestamp
    table.text('status').notNullable(); // 'active', 'expired', 'error'
    table.text('error_message');
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
  });
};

const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('health_webhook_state');
  await knex.schema.dropTableIfExists('health_records');
};

export { up, down };
