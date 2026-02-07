import type { Knex } from 'knex';

/**
 * Phase 6: Notifications
 * Creates tables for notification management, channels, and attention budget.
 */
const up = async (knex: Knex): Promise<void> => {
  // Notification channels table - configured delivery channels
  await knex.schema.createTable('notification_channels', (table) => {
    table.text('id').primary();
    table.text('type').notNullable(); // cli, telegram, email, sms, slack, webhook
    table.text('name').notNullable();
    table.boolean('enabled').notNullable().defaultTo(true);
    table.text('min_urgency').notNullable().defaultTo('low'); // low, medium, high, critical
    table.integer('priority').notNullable().defaultTo(0); // Higher = preferred
    table.text('config'); // JSON - channel-specific config
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
  });

  await knex.schema.raw('CREATE INDEX idx_notification_channels_type ON notification_channels(type)');
  await knex.schema.raw('CREATE INDEX idx_notification_channels_enabled ON notification_channels(enabled)');

  // Notifications table - individual notifications
  await knex.schema.createTable('notifications', (table) => {
    table.text('id').primary();
    table.text('type').notNullable(); // info, action_required, reminder, alert
    table.text('title').notNullable();
    table.text('body').notNullable();
    table.text('urgency').notNullable().defaultTo('low'); // low, medium, high, critical
    table.text('status').notNullable().defaultTo('pending'); // pending, delivered, read, dismissed, expired, snoozed
    table.text('delivered_via'); // Channel ID that delivered it
    table.text('delivered_at');
    table.text('read_at');
    table.text('dismissed_at');
    table.text('expires_at');
    table.text('snoozed_until');

    // Actions
    table.text('actions'); // JSON - array of action buttons

    // Source tracking
    table.text('source_type'); // proactive_check, task, user, system
    table.text('source_id'); // ID of the source (check_id, task_id, etc.)
    table.text('proactive_run_id').references('id').inTable('proactive_runs').onDelete('SET NULL');

    // Metadata
    table.text('metadata'); // JSON - additional data

    // Timestamps
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
  });

  await knex.schema.raw('CREATE INDEX idx_notifications_status ON notifications(status)');
  await knex.schema.raw('CREATE INDEX idx_notifications_urgency ON notifications(urgency)');
  await knex.schema.raw('CREATE INDEX idx_notifications_created_at ON notifications(created_at)');
  await knex.schema.raw('CREATE INDEX idx_notifications_source ON notifications(source_type, source_id)');

  // Notification deliveries table - delivery attempt history
  await knex.schema.createTable('notification_deliveries', (table) => {
    table.text('id').primary();
    table.text('notification_id').notNullable().references('id').inTable('notifications').onDelete('CASCADE');
    table.text('channel_id').notNullable().references('id').inTable('notification_channels').onDelete('CASCADE');
    table.text('status').notNullable(); // pending, sent, delivered, failed
    table.text('attempted_at').notNullable();
    table.text('delivered_at');
    table.text('error');
    table.text('external_id'); // External message ID (e.g., Telegram message ID)
  });

  await knex.schema.raw(
    'CREATE INDEX idx_notification_deliveries_notification_id ON notification_deliveries(notification_id)',
  );
  await knex.schema.raw('CREATE INDEX idx_notification_deliveries_channel_id ON notification_deliveries(channel_id)');

  // Attention budget table - singleton for tracking interruption state
  await knex.schema.createTable('attention_budget', (table) => {
    table.text('id').primary().defaultTo('singleton');
    table.integer('recent_interruptions').notNullable().defaultTo(0);
    table.text('last_interruption_at');
    table.text('user_responsiveness').notNullable().defaultTo('medium'); // high, medium, low
    table.boolean('quiet_hours_active').notNullable().defaultTo(false);
    table.boolean('focus_block_active').notNullable().defaultTo(false);
    table.text('manual_dnd_until');
    table.text('last_reset_at').notNullable();
    table.text('updated_at').notNullable();
  });

  // Insert default attention budget row
  const now = new Date().toISOString();
  await knex('attention_budget').insert({
    id: 'singleton',
    recent_interruptions: 0,
    user_responsiveness: 'medium',
    quiet_hours_active: false,
    focus_block_active: false,
    last_reset_at: now,
    updated_at: now,
  });
};

const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('attention_budget');
  await knex.schema.dropTableIfExists('notification_deliveries');
  await knex.schema.dropTableIfExists('notifications');
  await knex.schema.dropTableIfExists('notification_channels');
};

export { up, down };
