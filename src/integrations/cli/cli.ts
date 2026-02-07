#!/usr/bin/env node --experimental-strip-types

import { Services } from '../../core/services/services.ts';
import { DatabaseService, createDatabaseService } from '../../core/database/database.ts';
import { UserModelService } from '../../domain/user-model/user-model.ts';
import { LocationService } from '../../domain/location/location.ts';
import { CalendarService } from '../../domain/calendar/calendar.ts';
import { ContextBuilderService } from '../../agent/context/context.ts';
import { PersonalityService } from '../../agent/personality/personality.ts';
import { loadConfig, isLLMConfigured } from '../../core/config/config.ts';

import { Repl } from './cli.repl.ts';
import { formatError, formatSystem } from './cli.utils.ts';

/**
 * Main entry point for the GLaDOS CLI.
 */
const main = async (): Promise<void> => {
  // Load configuration from environment
  const config = loadConfig();

  // Check for required API key
  if (!isLLMConfigured()) {
    console.error(formatError('GLADOS_LLM_API_KEY environment variable is required'));
    console.log();
    console.log('Set your API key:');
    console.log('  export GLADOS_LLM_API_KEY=your-api-key-here');
    console.log();
    console.log('For OpenRouter (recommended):');
    console.log('  1. Sign up at https://openrouter.ai');
    console.log('  2. Get your API key from https://openrouter.ai/keys');
    console.log('  3. export GLADOS_LLM_API_KEY=sk-or-v1-...');
    console.log();
    process.exit(1);
  }

  const services = new Services();

  try {
    // Initialize database
    const db = createDatabaseService(services, { path: config.database.path });
    services.set(DatabaseService, db);

    // Run migrations
    console.log(formatSystem('Initializing database...'));
    await db.migrate();

    // Initialize all required services
    services.get(UserModelService);
    services.get(LocationService);
    services.get(CalendarService);
    services.get(ContextBuilderService);
    services.get(PersonalityService);

    // Start the REPL
    const repl = new Repl({ services });
    await repl.start();
  } catch (error) {
    console.error(formatError(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  } finally {
    // Cleanup
    await services.destroy();
  }
};

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log();
  console.log(formatSystem('Interrupted. Goodbye!'));
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(formatSystem('Terminated. Goodbye!'));
  process.exit(0);
});

// Run
main().catch((error) => {
  console.error(formatError(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
