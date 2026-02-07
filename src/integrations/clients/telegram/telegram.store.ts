import type { Knex } from 'knex';

import type { TelegramChat, TelegramChatRow, CreateTelegramChatInput } from './telegram.schemas.ts';

/**
 * Converts a database row to a TelegramChat.
 */
const rowToChat = (row: TelegramChatRow): TelegramChat => ({
  telegramChatId: row.telegram_chat_id,
  telegramUserId: row.telegram_user_id,
  conversationId: row.conversation_id,
  createdAt: row.created_at,
  lastActivityAt: row.last_activity_at,
});

/**
 * Creates a new telegram chat mapping.
 */
const createTelegramChat = async (db: Knex, input: CreateTelegramChatInput): Promise<TelegramChat> => {
  const now = new Date().toISOString();

  const row: TelegramChatRow = {
    telegram_chat_id: input.telegramChatId,
    telegram_user_id: input.telegramUserId,
    conversation_id: input.conversationId,
    created_at: now,
    last_activity_at: now,
  };

  await db('telegram_chats').insert(row);
  return rowToChat(row);
};

/**
 * Gets a telegram chat mapping by chat ID.
 */
const getTelegramChat = async (db: Knex, telegramChatId: number): Promise<TelegramChat | null> => {
  const row = await db('telegram_chats').where('telegram_chat_id', telegramChatId).first();

  if (!row) {
    return null;
  }

  return rowToChat(row as TelegramChatRow);
};

/**
 * Gets a telegram chat mapping by conversation ID.
 */
const getTelegramChatByConversation = async (db: Knex, conversationId: string): Promise<TelegramChat | null> => {
  const row = await db('telegram_chats').where('conversation_id', conversationId).first();

  if (!row) {
    return null;
  }

  return rowToChat(row as TelegramChatRow);
};

/**
 * Updates the last activity timestamp for a chat.
 */
const updateLastActivity = async (db: Knex, telegramChatId: number): Promise<void> => {
  await db('telegram_chats')
    .where('telegram_chat_id', telegramChatId)
    .update({ last_activity_at: new Date().toISOString() });
};

/**
 * Deletes a telegram chat mapping.
 */
const deleteTelegramChat = async (db: Knex, telegramChatId: number): Promise<boolean> => {
  const deleted = await db('telegram_chats').where('telegram_chat_id', telegramChatId).delete();
  return deleted > 0;
};

/**
 * Lists all telegram chat mappings for a user.
 */
const listTelegramChatsByUser = async (db: Knex, telegramUserId: number): Promise<TelegramChat[]> => {
  const rows = await db('telegram_chats').where('telegram_user_id', telegramUserId).orderBy('last_activity_at', 'desc');

  return rows.map((row) => rowToChat(row as TelegramChatRow));
};

export {
  createTelegramChat,
  getTelegramChat,
  getTelegramChatByConversation,
  updateLastActivity,
  deleteTelegramChat,
  listTelegramChatsByUser,
};
