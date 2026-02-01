#!/usr/bin/env node --experimental-strip-types

/**
 * GLaDOS Server
 *
 * Unified entry point that runs both the Telegram bot and Proactive Scheduler.
 * This is the recommended way to deploy GLaDOS to a server.
 *
 * Usage:
 *   pnpm server
 *   node --experimental-strip-types src/server/server.ts
 *
 * Required environment variables:
 *   GLADOS_LLM_API_KEY         - LLM API key (OpenRouter, OpenAI, etc.)
 *   GLADOS_TELEGRAM_BOT_TOKEN  - Telegram bot token from @BotFather
 *   GLADOS_TELEGRAM_OWNER_ID   - Your Telegram user ID
 *
 * Optional environment variables:
 *   GLADOS_DB_PATH             - Database path (default: ./glados.db)
 *   GLADOS_LLM_MODEL           - Model to use (default: anthropic/claude-sonnet-4)
 *   GLADOS_PROACTIVE_ENABLED   - Enable proactive scheduler (default: true)
 */

import { Services } from '../services/services.ts';
import { DatabaseService, createDatabaseService } from '../database/database.ts';
import { UserModelService } from '../user-model/user-model.ts';
import { LocationService } from '../location/location.ts';
import { CalendarService } from '../calendar/calendar.ts';
import { ContextBuilderService } from '../context/context.ts';
import { PersonalityService } from '../personality/personality.ts';
import { TaskService } from '../tasks/tasks.ts';
import { NotificationRouter } from '../notifications/notifications.ts';
import { ProactiveScheduler } from '../proactive/proactive.ts';
import { TelegramClientService } from '../clients/telegram/telegram.ts';
import { loadConfig, isTelegramConfigured, isLLMConfigured } from '../config/config.ts';

// ============================================================================
// Types
// ============================================================================

type ServerComponents = {
  services: Services;
  telegram: TelegramClientService | null;
  scheduler: ProactiveScheduler | null;
  notificationRouter: NotificationRouter | null;
};

// ============================================================================
// Main
// ============================================================================

const main = async (): Promise<void> => {
  console.log('GLaDOS Server');
  console.log('=============');
  console.log();

  // Load configuration
  const config = loadConfig();

  // Validate required configuration
  if (!isLLMConfigured()) {
    console.error('Error: GLADOS_LLM_API_KEY environment variable is required');
    console.log();
    console.log('Set your API key:');
    console.log('  export GLADOS_LLM_API_KEY=your-api-key-here');
    console.log();
    process.exit(1);
  }

  if (!isTelegramConfigured()) {
    console.error('Error: Telegram bot is not configured.');
    console.log();
    console.log('Required environment variables:');
    console.log('  GLADOS_TELEGRAM_BOT_TOKEN - Bot token from @BotFather');
    console.log('  GLADOS_TELEGRAM_OWNER_ID  - Your Telegram user ID');
    console.log();
    console.log('To get your user ID, message @userinfobot on Telegram.');
    console.log();
    process.exit(1);
  }

  const components: ServerComponents = {
    services: new Services(),
    telegram: null,
    scheduler: null,
    notificationRouter: null,
  };

  try {
    // Initialize database
    console.log('Initializing database...');
    const db = createDatabaseService(components.services, { path: config.database.path });
    components.services.set(DatabaseService, db);
    await db.migrate();
    console.log(`  Database: ${config.database.path}`);

    // Initialize foundation services
    console.log('Initializing services...');
    components.services.get(UserModelService);
    components.services.get(LocationService);
    components.services.get(CalendarService);
    components.services.get(ContextBuilderService);
    components.services.get(PersonalityService);
    components.services.get(TaskService);

    // Create notification router
    components.notificationRouter = new NotificationRouter(components.services);
    components.notificationRouter.configure({
      quietHoursStart: config.notifications?.quietHoursStart ?? '22:00',
      quietHoursEnd: config.notifications?.quietHoursEnd ?? '07:00',
      maxInterruptionsPerHour: config.notifications?.maxInterruptionsPerHour ?? 5,
    });

    // Start Telegram bot
    console.log();
    console.log('Starting Telegram bot...');
    components.telegram = new TelegramClientService(components.services);
    await components.telegram.configure(
      {
        botToken: config.telegram.botToken,
        ownerId: config.telegram.ownerId,
      },
      config,
    );

    // Register Telegram as a notification channel
    if (components.notificationRouter && components.telegram) {
      const telegramChannelId = await registerTelegramNotificationChannel(
        components.notificationRouter,
        components.telegram,
        config.telegram.ownerId,
      );
      console.log(`  Registered Telegram notification channel: ${telegramChannelId}`);
    }

    await components.telegram.start();

    // Start proactive scheduler
    const proactiveEnabled = config.proactive?.enabled ?? true;
    if (proactiveEnabled) {
      console.log();
      console.log('Starting proactive scheduler...');
      components.scheduler = new ProactiveScheduler(components.services);
      components.scheduler.configure({
        checkIntervalMs: config.proactive?.checkIntervalMs ?? 60000,
        notificationRouter: components.notificationRouter,
      });
      await components.scheduler.start();

      // List enabled checks
      const checks = await components.scheduler.listChecks({ enabled: true });
      console.log(`  Enabled checks: ${checks.length}`);
      for (const check of checks) {
        console.log(`    - ${check.name} (${check.schedule})`);
      }
    } else {
      console.log();
      console.log('Proactive scheduler disabled.');
    }

    // Server ready
    console.log();
    console.log('=============');
    console.log('Server ready!');
    console.log();
    console.log('Components running:');
    console.log('  - Telegram bot: listening for messages');
    if (proactiveEnabled) {
      console.log('  - Proactive scheduler: running background checks');
    }
    console.log();
    console.log('Press Ctrl+C to stop.');

    // Keep the process alive (backup in case other intervals are cleared)
    const keepAlive = setInterval(() => {
      // Heartbeat - just keeps the event loop active
    }, 60000);

    // Store for cleanup
    process.on('beforeExit', () => {
      clearInterval(keepAlive);
    });
  } catch (error) {
    console.error();
    console.error('Error starting server:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }

  // Handle graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    console.log();
    console.log(`Received ${signal}, shutting down...`);

    if (components.scheduler) {
      console.log('  Stopping proactive scheduler...');
      components.scheduler.stop();
    }

    if (components.telegram) {
      console.log('  Stopping Telegram bot...');
      await components.telegram.stop();
    }

    console.log('  Cleaning up services...');
    await components.services.destroy();

    console.log('Shutdown complete.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Register Telegram as a notification channel.
 */
const registerTelegramNotificationChannel = async (
  router: NotificationRouter,
  telegram: TelegramClientService,
  ownerId: number,
): Promise<string> => {
  // Create or get the Telegram channel
  let channel = await router.getChannelByType('telegram');
  if (!channel) {
    channel = await router.createChannel({
      type: 'telegram',
      name: 'Telegram',
      enabled: true,
      minUrgency: 'medium',
      priority: 100,
    });
  }

  // Register the sender
  router.registerChannel(channel.id, {
    channelId: channel.id,
    send: async (notification) => {
      // Format the notification message
      const urgencyEmoji = {
        low: '',
        medium: '',
        high: '⚠️ ',
        critical: '🚨 ',
      }[notification.urgency];

      const message = `${urgencyEmoji}${notification.title}\n\n${notification.body}`;

      // Send via Telegram
      await telegram.sendMessage(ownerId, message);

      return { externalId: `telegram-${notification.id}` };
    },
  });

  return channel.id;
};

// ============================================================================
// Run
// ============================================================================

main().catch((error) => {
  console.error('Fatal error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
