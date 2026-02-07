import { z } from 'zod';

/**
 * Configuration for the Telegram client.
 */
const telegramConfigSchema = z.object({
  botToken: z.string().min(1),
  ownerId: z.number().int().positive(),
});

type TelegramConfig = z.infer<typeof telegramConfigSchema>;

/**
 * Database row for telegram chat mappings.
 */
const telegramChatRowSchema = z.object({
  telegram_chat_id: z.number().int(),
  telegram_user_id: z.number().int(),
  conversation_id: z.string(),
  created_at: z.string(),
  last_activity_at: z.string(),
});

type TelegramChatRow = z.infer<typeof telegramChatRowSchema>;

/**
 * Telegram chat mapping (public API type).
 */
const telegramChatSchema = z.object({
  telegramChatId: z.number().int(),
  telegramUserId: z.number().int(),
  conversationId: z.string(),
  createdAt: z.string(),
  lastActivityAt: z.string(),
});

type TelegramChat = z.infer<typeof telegramChatSchema>;

/**
 * Input for creating a telegram chat mapping.
 */
const createTelegramChatInputSchema = z.object({
  telegramChatId: z.number().int(),
  telegramUserId: z.number().int(),
  conversationId: z.string(),
});

type CreateTelegramChatInput = z.infer<typeof createTelegramChatInputSchema>;

export type { TelegramConfig, TelegramChatRow, TelegramChat, CreateTelegramChatInput };

export { telegramConfigSchema, telegramChatRowSchema, telegramChatSchema, createTelegramChatInputSchema };
