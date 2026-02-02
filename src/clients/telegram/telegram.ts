import { Bot, InputFile } from 'grammy';
import type { Context } from 'grammy';
import type { Knex } from 'knex';

import type { Services } from '../../services/services.ts';
import { DatabaseService } from '../../database/database.ts';
import { OrchestratorService } from '../../orchestrator/orchestrator.ts';
import { getConversation, getMessages } from '../../orchestrator/orchestrator.store.ts';
import { PersonalityService } from '../../personality/personality.ts';
import { TriggerService } from '../../triggers/triggers.ts';
import type { Config } from '../../config/config.ts';

import type { TelegramConfig } from './telegram.schemas.ts';
import { telegramConfigSchema } from './telegram.schemas.ts';
import { createTelegramChat, getTelegramChat, updateLastActivity, deleteTelegramChat } from './telegram.store.ts';
import {
  sendLongMessage,
  formatInterruptMessage,
  parseCallbackData,
  createWelcomeMessage,
  createHelpMessage,
  createUnauthorizedMessage,
} from './telegram.handlers.ts';

/**
 * Typing indicator refresh interval in milliseconds.
 * Telegram's typing indicator expires after ~5 seconds, so we refresh every 4 seconds.
 */
const TYPING_INTERVAL_MS = 4000;

/**
 * Starts a continuous typing indicator that refreshes until stopped.
 * Returns a cleanup function to stop the indicator.
 */
const startTypingIndicator = (ctx: Context): (() => void) => {
  // Send immediately
  void ctx.replyWithChatAction('typing');

  // Refresh on interval
  const interval = setInterval(() => {
    void ctx.replyWithChatAction('typing');
  }, TYPING_INTERVAL_MS);

  return () => clearInterval(interval);
};

/**
 * Error thrown when the Telegram client is not configured.
 */
class TelegramNotConfiguredError extends Error {
  readonly name = 'TelegramNotConfiguredError';

  constructor() {
    super('Telegram client is not configured. Set GLADOS_TELEGRAM_BOT_TOKEN and GLADOS_TELEGRAM_OWNER_ID.');
  }
}

/**
 * Telegram client service for GLaDOS.
 */
class TelegramClientService {
  #services: Services;
  #config: TelegramConfig | null = null;
  #bot: Bot | null = null;
  #orchestrator: OrchestratorService | null = null;
  #triggerService: TriggerService | null = null;
  #assistantName = 'GLaDOS';
  #pendingInterrupts = new Map<number, string>(); // chatId -> interruptId

  constructor(services: Services) {
    this.#services = services;
  }

  /**
   * Gets the knex instance from the database service.
   */
  #db = (): Knex => {
    return this.#services.get(DatabaseService).knex;
  };

  /**
   * Configures the Telegram client.
   */
  configure = async (config: TelegramConfig, appConfig: Config): Promise<void> => {
    this.#config = telegramConfigSchema.parse(config);

    // Load personality name
    const personality = this.#services.get(PersonalityService);
    const personalityConfig = await personality.getConfig();
    this.#assistantName = personalityConfig.name;

    // Create orchestrator
    this.#orchestrator = new OrchestratorService(this.#services);
    this.#orchestrator.configure({
      llm: {
        baseUrl: appConfig.llm.baseUrl,
        apiKey: appConfig.llm.apiKey,
        model: appConfig.llm.model,
        temperature: appConfig.llm.temperature,
        maxTokens: appConfig.llm.maxTokens,
      },
    });

    // Create and configure trigger service
    this.#triggerService = new TriggerService(this.#services);
    this.#triggerService.configure({
      orchestrator: this.#orchestrator,
      telegramClient: this,
    });

    // Register the configured TriggerService in the Services container
    // This is crucial so that tools can access the same instance via services.get(TriggerService)
    this.#services.set(TriggerService, this.#triggerService);

    // Create bot
    this.#bot = new Bot(this.#config.botToken);
    this.#setupHandlers();
  };

  /**
   * Gets the configured owner ID.
   */
  get ownerId(): number {
    return this.#config?.ownerId ?? 0;
  }

  /**
   * Checks if a user is authorized.
   */
  #isAuthorized = (userId: number): boolean => {
    return userId === this.#config?.ownerId;
  };

  /**
   * Sets up bot handlers.
   */
  #setupHandlers = (): void => {
    if (!this.#bot) return;

    // Authorization middleware
    this.#bot.use(async (ctx, next) => {
      const userId = ctx.from?.id;
      if (!userId || !this.#isAuthorized(userId)) {
        if (ctx.message) {
          await ctx.reply(createUnauthorizedMessage(), { parse_mode: 'Markdown' });
        }
        return;
      }
      await next();
    });

    // Command handlers
    this.#bot.command('start', this.#handleStart);
    this.#bot.command('new', this.#handleNew);
    this.#bot.command('help', this.#handleHelp);
    this.#bot.command('id', this.#handleId);
    this.#bot.command('debug', this.#handleDebug);

    // Message handler
    this.#bot.on('message:text', this.#handleMessage);

    // Callback query handler (for inline keyboard responses)
    this.#bot.on('callback_query:data', this.#handleCallback);

    // Error handler
    this.#bot.catch((err) => {
      console.error('Telegram bot error:', err);
    });
  };

  /**
   * Handles the /start command.
   */
  #handleStart = async (ctx: Context): Promise<void> => {
    await ctx.reply(createWelcomeMessage(this.#assistantName), { parse_mode: 'Markdown' });

    // Ensure a conversation exists
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    if (chatId && userId) {
      await this.#getOrCreateConversation(chatId, userId);
    }
  };

  /**
   * Handles the /new command.
   */
  #handleNew = async (ctx: Context): Promise<void> => {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;

    if (!chatId || !userId) return;

    // Delete existing mapping if any
    await deleteTelegramChat(this.#db(), chatId);

    // Clear any pending interrupts
    this.#pendingInterrupts.delete(chatId);

    // Create new conversation
    await this.#getOrCreateConversation(chatId, userId);

    await ctx.reply('✨ Started a new conversation. What would you like to talk about?');
  };

  /**
   * Handles the /help command.
   */
  #handleHelp = async (ctx: Context): Promise<void> => {
    await ctx.reply(createHelpMessage(), { parse_mode: 'Markdown' });
  };

  /**
   * Handles the /id command - shows the current conversation ID for debugging.
   */
  #handleId = async (ctx: Context): Promise<void> => {
    const chatId = ctx.chat?.id;

    if (!chatId) {
      await ctx.reply('❌ Unable to determine chat ID');
      return;
    }

    const existing = await getTelegramChat(this.#db(), chatId);
    if (existing) {
      await ctx.reply(
        `🔍 *Debug Info*\n\nConversation ID:\n\`${existing.conversationId}\`\n\nUse this ID with \`pnpm conversation <id>\` to inspect the conversation.`,
        { parse_mode: 'Markdown' },
      );
    } else {
      await ctx.reply('No conversation found for this chat. Send a message to start one.');
    }
  };

  /**
   * Handles the /debug command - exports the current conversation as JSON.
   */
  #handleDebug = async (ctx: Context): Promise<void> => {
    const chatId = ctx.chat?.id;

    if (!chatId) {
      await ctx.reply('❌ Unable to determine chat ID');
      return;
    }

    const existing = await getTelegramChat(this.#db(), chatId);
    if (!existing) {
      await ctx.reply('No conversation found for this chat. Send a message to start one.');
      return;
    }

    const conversation = await getConversation(this.#db(), existing.conversationId);
    if (!conversation) {
      await ctx.reply('❌ Conversation not found in database.');
      return;
    }

    const messages = await getMessages(this.#db(), existing.conversationId);

    // Parse toolCalls JSON for better readability
    const messagesWithParsedToolCalls = messages.map((msg) => ({
      ...msg,
      toolCalls: msg.toolCalls ? JSON.parse(msg.toolCalls) : undefined,
    }));

    const debugData = {
      conversation,
      messages: messagesWithParsedToolCalls,
    };

    const json = JSON.stringify(debugData, null, 2);
    const buffer = Buffer.from(json, 'utf-8');
    const filename = `conversation-${existing.conversationId}.json`;

    await ctx.replyWithDocument(new InputFile(buffer, filename), {
      caption: `🔍 Debug export for conversation ${existing.conversationId}`,
    });
  };

  /**
   * Handles incoming text messages.
   */
  #handleMessage = async (ctx: Context): Promise<void> => {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const messageText = ctx.message?.text;

    if (!chatId || !userId || !messageText || !this.#orchestrator) return;

    // Get or create conversation
    const conversationId = await this.#getOrCreateConversation(chatId, userId);

    // Start continuous typing indicator
    const stopTyping = startTypingIndicator(ctx);

    try {
      let responseBuffer = '';

      for await (const chunk of this.#orchestrator.chat(conversationId, messageText)) {
        switch (chunk.type) {
          case 'token':
            responseBuffer += chunk.content;
            break;

          case 'tool_start':
            // Typing indicator is already running continuously
            break;

          case 'interrupt': {
            // Store pending interrupt
            this.#pendingInterrupts.set(chatId, chunk.interrupt.id);

            // Send interrupt message with inline keyboard (plain text to avoid parse errors)
            const { text, keyboard } = formatInterruptMessage(chunk.interrupt);
            await ctx.reply(text, { reply_markup: keyboard });
            break;
          }

          case 'interrupt_resolved': {
            // Clear pending interrupt
            this.#pendingInterrupts.delete(chatId);

            const statusMsg = chunk.approved ? '✓ Approved' : '✗ Denied';
            await ctx.reply(statusMsg);
            break;
          }

          case 'done':
            stopTyping();
            if (responseBuffer.trim()) {
              await sendLongMessage(ctx, responseBuffer);
            }
            responseBuffer = '';
            break;

          case 'error':
            stopTyping();
            await ctx.reply(`❌ Error: ${chunk.error}`);
            break;
        }
      }
    } catch (error) {
      stopTyping();
      const errorMessage = error instanceof Error ? error.message : String(error);
      await ctx.reply(`❌ Error: ${errorMessage}`);
    }
  };

  /**
   * Handles callback queries from inline keyboards.
   */
  #handleCallback = async (ctx: Context): Promise<void> => {
    const data = ctx.callbackQuery?.data;
    const chatId = ctx.chat?.id;

    if (!data || !chatId || !this.#orchestrator) {
      await ctx.answerCallbackQuery({ text: 'Invalid request' });
      return;
    }

    const parsed = parseCallbackData(data);
    if (!parsed) {
      await ctx.answerCallbackQuery({ text: 'Invalid action' });
      return;
    }

    // Verify this is the expected interrupt
    const pendingInterruptId = this.#pendingInterrupts.get(chatId);
    if (pendingInterruptId !== parsed.interruptId) {
      await ctx.answerCallbackQuery({ text: 'This action has expired' });
      return;
    }

    // Answer the callback to remove loading state
    await ctx.answerCallbackQuery();

    // Edit the message to remove keyboard
    await ctx.editMessageReplyMarkup(undefined);

    // Start continuous typing indicator
    const stopTyping = startTypingIndicator(ctx);

    try {
      // Build response based on action
      const response =
        parsed.action === 'approve'
          ? { approved: true }
          : parsed.action === 'deny'
            ? { approved: false }
            : { selectedOptionId: parsed.optionId };

      let responseBuffer = '';

      for await (const chunk of this.#orchestrator.respondToInterrupt(parsed.interruptId, response)) {
        switch (chunk.type) {
          case 'token':
            responseBuffer += chunk.content;
            break;

          case 'tool_start':
            // Typing indicator is already running continuously
            break;

          case 'interrupt': {
            this.#pendingInterrupts.set(chatId, chunk.interrupt.id);
            const { text, keyboard } = formatInterruptMessage(chunk.interrupt);
            await ctx.reply(text, { reply_markup: keyboard });
            break;
          }

          case 'interrupt_resolved':
            this.#pendingInterrupts.delete(chatId);
            break;

          case 'done':
            stopTyping();
            if (responseBuffer.trim()) {
              await sendLongMessage(ctx, responseBuffer);
            }
            responseBuffer = '';
            break;

          case 'error':
            stopTyping();
            await ctx.reply(`❌ Error: ${chunk.error}`);
            break;
        }
      }
    } catch (error) {
      stopTyping();
      const errorMessage = error instanceof Error ? error.message : String(error);
      await ctx.reply(`❌ Error: ${errorMessage}`);
    }
  };

  /**
   * Gets or creates a conversation for a Telegram chat.
   */
  #getOrCreateConversation = async (chatId: number, userId: number): Promise<string> => {
    // Check for existing mapping
    const existing = await getTelegramChat(this.#db(), chatId);
    if (existing) {
      await updateLastActivity(this.#db(), chatId);
      return existing.conversationId;
    }

    // Create new conversation
    if (!this.#orchestrator) {
      throw new TelegramNotConfiguredError();
    }

    const conversationId = await this.#orchestrator.startConversation({
      title: `Telegram Chat ${chatId}`,
    });

    // Store mapping
    await createTelegramChat(this.#db(), {
      telegramChatId: chatId,
      telegramUserId: userId,
      conversationId,
    });

    return conversationId;
  };

  /**
   * Starts the bot (polling mode) and trigger service.
   */
  start = async (): Promise<void> => {
    if (!this.#bot) {
      throw new TelegramNotConfiguredError();
    }

    console.log(`Starting ${this.#assistantName} Telegram bot...`);
    console.log(`Authorized user ID: ${this.#config?.ownerId}`);

    // Start the trigger service first
    if (this.#triggerService) {
      await this.#triggerService.start();
    }

    await this.#bot.start({
      onStart: (botInfo) => {
        console.log(`Bot started as @${botInfo.username}`);
      },
    });
  };

  /**
   * Stops the bot and trigger service.
   */
  stop = async (): Promise<void> => {
    // Stop the trigger service
    if (this.#triggerService) {
      await this.#triggerService.stop();
    }

    if (this.#bot) {
      await this.#bot.stop();
      console.log('Telegram bot stopped.');
    }
  };

  /**
   * Sends a message to a chat (for proactive notifications).
   */
  sendMessage = async (chatId: number, message: string): Promise<void> => {
    if (!this.#bot) {
      throw new TelegramNotConfiguredError();
    }

    await this.#bot.api.sendMessage(chatId, message);
  };
}

// Re-export types and schemas
export type { TelegramConfig, TelegramChat, CreateTelegramChatInput } from './telegram.schemas.ts';
export { telegramConfigSchema, telegramChatSchema, createTelegramChatInputSchema } from './telegram.schemas.ts';

export { TelegramClientService, TelegramNotConfiguredError };
