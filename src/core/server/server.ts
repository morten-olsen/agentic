#!/usr/bin/env node --experimental-strip-types

/**
 * GLaDOS Server
 *
 * Unified entry point that runs the Telegram bot.
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
 */

import type { FastifyInstance } from 'fastify';

import { Services } from '../../core/services/services.ts';
import { DatabaseService, createDatabaseService } from '../../core/database/database.ts';
import { UserModelService } from '../../domain/user-model/user-model.ts';
import { LocationService } from '../../domain/location/location.ts';
import { CalendarService } from '../../domain/calendar/calendar.ts';
import { ContextBuilderService } from '../../agent/context/context.ts';
import { PersonalityService } from '../../agent/personality/personality.ts';
import { TaskService } from '../../features/tasks/tasks.ts';
import { HealthService } from '../../integrations/health/health.ts';
import { NotificationRouter } from '../../features/notifications/notifications.ts';
import { TelegramClientService } from '../../integrations/clients/telegram/telegram.ts';
import { OrchestratorService } from '../../agent/orchestrator/orchestrator.ts';
import { MemoryService } from '../../agent/memory/memory.ts';
import { ContactsService } from '../../domain/contacts/contacts.ts';
import { loadConfig, isTelegramConfigured, isLLMConfigured, isApiConfigured } from '../../core/config/config.ts';
import { createApiServer, startApiServer, setupOuraWebhooks } from '../../integrations/api/api.ts';

// ============================================================================
// Types
// ============================================================================

type ServerComponents = {
  services: Services;
  telegram: TelegramClientService | null;
  notificationRouter: NotificationRouter | null;
  api: FastifyInstance | null;
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
    notificationRouter: null,
    api: null,
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
    components.services.get(ContactsService);
    components.services.get(ContextBuilderService);
    components.services.get(PersonalityService);
    components.services.get(MemoryService);
    components.services.get(TaskService);
    components.services.get(HealthService);

    // Create and configure orchestrator (needed by API server)
    console.log('Configuring orchestrator...');
    const orchestrator = new OrchestratorService(components.services);
    components.services.set(OrchestratorService, orchestrator);
    orchestrator.configure({
      llm: {
        baseUrl: config.llm.baseUrl,
        apiKey: config.llm.apiKey,
        model: config.llm.model,
        temperature: config.llm.temperature,
        maxTokens: config.llm.maxTokens,
      },
    });

    // Create notification router
    components.notificationRouter = new NotificationRouter(components.services);
    components.notificationRouter.configure({
      quietHoursStart: config.notifications?.quietHoursStart ?? '22:00',
      quietHoursEnd: config.notifications?.quietHoursEnd ?? '07:00',
      maxInterruptionsPerHour: config.notifications?.maxInterruptionsPerHour ?? 5,
    });

    // Start API server (if configured)
    if (isApiConfigured()) {
      console.log();
      console.log('Starting API server...');
      components.api = await createApiServer({
        services: components.services,
        config,
      });

      const apiInfo = await startApiServer(components.api, config);
      console.log(`  API server listening on ${apiInfo.host}:${apiInfo.port}`);

      // Set up Oura webhook subscriptions after API is listening
      await setupOuraWebhooks({ services: components.services, config });
    }

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

    // Server ready
    console.log();
    console.log('=============');
    console.log('Server ready!');
    console.log();
    console.log('Components running:');
    console.log('  - Telegram bot: listening for messages');
    if (components.api) {
      console.log(`  - API server: listening on port ${config.api.port}`);
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

    // Stop API server first
    if (components.api) {
      console.log('  Stopping API server...');
      await components.api.close();
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
