#!/usr/bin/env node --experimental-strip-types

import { Services } from '../services/services.ts';
import { DatabaseService, createDatabaseService } from '../database/database.ts';
import { UserModelService } from '../user-model/user-model.ts';
import { CalendarService } from '../calendar/calendar.ts';
import { TaskService } from '../tasks/tasks.ts';
import { NotificationRouter } from '../notifications/notifications.ts';
import { loadConfig, isLLMConfigured } from '../config/config.ts';

import { ProactiveScheduler } from './proactive.ts';

/**
 * Main entry point for the GLaDOS Proactive Scheduler.
 */
const main = async (): Promise<void> => {
  // Load configuration from environment
  const config = loadConfig();

  // LLM key is optional for proactive scheduler (used by some checks)
  if (!isLLMConfigured()) {
    console.warn('Warning: GLADOS_LLM_API_KEY not set. Some checks may not work.');
    console.log();
  }

  const services = new Services();
  let scheduler: ProactiveScheduler | null = null;

  try {
    // Initialize database
    const db = createDatabaseService(services, { path: config.database.path });
    services.set(DatabaseService, db);

    // Run migrations
    console.log('Initializing database...');
    await db.migrate();

    // Initialize required services
    services.get(UserModelService);
    services.get(CalendarService);
    services.get(TaskService);

    // Create notification router
    const notificationRouter = new NotificationRouter(services);

    // Configure notification router from config
    notificationRouter.configure({
      quietHoursStart: config.notifications?.quietHoursStart ?? '22:00',
      quietHoursEnd: config.notifications?.quietHoursEnd ?? '07:00',
      maxInterruptionsPerHour: config.notifications?.maxInterruptionsPerHour ?? 5,
    });

    // Create scheduler
    scheduler = new ProactiveScheduler(services);
    scheduler.configure({
      checkIntervalMs: config.proactive?.checkIntervalMs ?? 60000,
      notificationRouter,
    });

    // Start the scheduler
    console.log('Starting proactive scheduler...');
    await scheduler.start();

    console.log('Proactive scheduler running. Press Ctrl+C to stop.');
    console.log();

    // List enabled checks
    const checks = await scheduler.listChecks({ enabled: true });
    console.log(`Enabled checks (${checks.length}):`);
    for (const check of checks) {
      console.log(`  - ${check.name}: ${check.description}`);
      console.log(`    Schedule: ${check.schedule}`);
    }
    console.log();
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Handle graceful shutdown
  const shutdown = async (): Promise<void> => {
    console.log();
    console.log('Shutting down...');

    if (scheduler) {
      scheduler.stop();
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
