#!/usr/bin/env node --experimental-strip-types

import { Services } from '../../../core/services/services.ts';
import { DatabaseService, createDatabaseService } from '../../../core/database/database.ts';
import { UserModelService } from '../../../domain/user-model/user-model.ts';
import { LocationService } from '../../../domain/location/location.ts';
import { CalendarService } from '../../../domain/calendar/calendar.ts';
import { ContextBuilderService } from '../../../agent/context/context.ts';
import { PersonalityService } from '../../../agent/personality/personality.ts';
import { loadConfig, isTelegramConfigured } from '../../../core/config/config.ts';

import { TelegramClientService } from './telegram.ts';

/**
 * Main entry point for the GLaDOS Telegram bot.
 */
const main = async (): Promise<void> => {
  // Load configuration from environment
  const config = loadConfig();

  // Check for required Telegram configuration
  if (!isTelegramConfigured()) {
    console.error('Error: Telegram bot is not configured.');
    console.log();
    console.log('Required environment variables:');
    console.log('  GLADOS_TELEGRAM_BOT_TOKEN - Bot token from @BotFather');
    console.log('  GLADOS_TELEGRAM_OWNER_ID  - Your Telegram user ID');
    console.log();
    console.log('To get your user ID, message @userinfobot on Telegram.');
    console.log();
    console.log('Example:');
    console.log('  export GLADOS_TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz');
    console.log('  export GLADOS_TELEGRAM_OWNER_ID=12345678');
    console.log();
    process.exit(1);
  }

  // Check for LLM API key
  if (!config.llm.apiKey) {
    console.error('Error: GLADOS_LLM_API_KEY environment variable is required');
    console.log();
    console.log('Set your API key:');
    console.log('  export GLADOS_LLM_API_KEY=your-api-key-here');
    console.log();
    process.exit(1);
  }

  const services = new Services();
  let telegram: TelegramClientService | null = null;

  try {
    // Initialize database
    const db = createDatabaseService(services, { path: config.database.path });
    services.set(DatabaseService, db);

    // Run migrations
    console.log('Initializing database...');
    await db.migrate();

    // Initialize all required services
    services.get(UserModelService);
    services.get(LocationService);
    services.get(CalendarService);
    services.get(ContextBuilderService);
    services.get(PersonalityService);

    // Create and configure Telegram client
    telegram = new TelegramClientService(services);
    await telegram.configure(
      {
        botToken: config.telegram.botToken,
        ownerId: config.telegram.ownerId,
      },
      config,
    );

    // Start the bot
    await telegram.start();
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Handle graceful shutdown
  const shutdown = async (): Promise<void> => {
    console.log();
    console.log('Shutting down...');

    if (telegram) {
      await telegram.stop();
    }

    await services.destroy();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

// Run
main().catch((error) => {
  console.error('Fatal error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
