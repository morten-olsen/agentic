import type { Knex } from 'knex';

/**
 * Telegram client integration: Chat mapping table.
 * Maps Telegram chat IDs to GLaDOS conversation IDs for persistence.
 */
const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('telegram_chats', (table) => {
    table.integer('telegram_chat_id').primary();
    table.integer('telegram_user_id').notNullable();
    table.text('conversation_id').notNullable().references('id').inTable('conversations').onDelete('CASCADE');
    table.text('created_at').notNullable();
    table.text('last_activity_at').notNullable();
  });

  await knex.schema.raw('CREATE INDEX idx_telegram_chats_conversation ON telegram_chats(conversation_id)');
  await knex.schema.raw('CREATE INDEX idx_telegram_chats_user ON telegram_chats(telegram_user_id)');
};

const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('telegram_chats');
};

export { up, down };
