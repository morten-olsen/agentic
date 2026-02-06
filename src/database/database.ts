import knex from 'knex';
import type { Knex } from 'knex';
import type Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

import type { Services } from '../services/services.ts';
import { destroySymbol } from '../services/services.ts';

import type { DatabaseConfig } from './database.schemas.ts';
import { databaseConfigSchema } from './database.schemas.ts';
import * as migration001 from './migrations/001_foundation.ts';
import * as migration002 from './migrations/002_orchestration.ts';
import * as migration003 from './migrations/003_interrupts.ts';
import * as migration004 from './migrations/004_memory.ts';
import * as migration005 from './migrations/005_entity_knowledge.ts';
import * as migration006 from './migrations/006_operator_manuals.ts';
import * as migration008 from './migrations/008_telegram_chats.ts';
import * as migration009 from './migrations/009_tasks.ts';
import * as migration010 from './migrations/010_proactive.ts';
import * as migration011 from './migrations/011_notifications.ts';
import * as migration012 from './migrations/012_day_planner.ts';
import * as migration013 from './migrations/013_triggers.ts';
import * as migration014 from './migrations/014_trigger_continuation.ts';
import * as migration015 from './migrations/015_skills.ts';
import * as migration016 from './migrations/016_artifacts.ts';
import * as migration017 from './migrations/017_coordinate_history.ts';
import * as migration018 from './migrations/018_store_items.ts';
import * as migration019 from './migrations/019_drop_operator_manuals.ts';
import * as migration020 from './migrations/020_drop_proactive.ts';
import * as migration021 from './migrations/021_create_logs.ts';
import * as migration022 from './migrations/022_calendar_sync.ts';
import * as migration023 from './migrations/023_events.ts';
import * as migration024 from './migrations/024_health_tracking.ts';

type MigrationSource = {
  getMigrations: () => Promise<string[]>;
  getMigration: (name: string) => Promise<{ up: Knex.Migration['up']; down: Knex.Migration['down'] }>;
  getMigrationName: (migration: string) => string;
};

const createMigrationSource = (): MigrationSource => {
  const migrations: Record<string, { up: Knex.Migration['up']; down: Knex.Migration['down'] }> = {
    '001_foundation': migration001,
    '002_orchestration': migration002,
    '003_interrupts': migration003,
    '004_memory': migration004,
    '005_entity_knowledge': migration005,
    '006_operator_manuals': migration006,
    '008_telegram_chats': migration008,
    '009_tasks': migration009,
    '010_proactive': migration010,
    '011_notifications': migration011,
    '012_day_planner': migration012,
    '013_triggers': migration013,
    '014_trigger_continuation': migration014,
    '015_skills': migration015,
    '016_artifacts': migration016,
    '017_coordinate_history': migration017,
    '018_store_items': migration018,
    '019_drop_operator_manuals': migration019,
    '020_drop_proactive': migration020,
    '021_create_logs': migration021,
    '022_calendar_sync': migration022,
    '023_events': migration023,
    '024_health_tracking': migration024,
  };

  return {
    getMigrations: async () => Object.keys(migrations).sort(),
    getMigration: async (name: string) => {
      const migration = migrations[name];
      if (!migration) {
        throw new Error(`Migration not found: ${name}`);
      }
      return migration;
    },
    getMigrationName: (migration: string) => migration,
  };
};

class DatabaseService {
  #knex: Knex | null = null;
  #config: DatabaseConfig;

  constructor(_services: Services, config?: Partial<DatabaseConfig>) {
    this.#config = databaseConfigSchema.parse(config ?? {});
  }

  /**
   * Gets the Knex instance, creating it if necessary.
   * Loads sqlite-vec extension on connection creation.
   */
  get knex(): Knex {
    if (!this.#knex) {
      this.#knex = knex({
        client: 'better-sqlite3',
        connection: {
          filename: this.#config.path,
        },
        useNullAsDefault: true,
        pool: {
          afterCreate: (conn: Database.Database, done: (err: Error | null, conn: Database.Database) => void) => {
            // Load sqlite-vec extension on every new connection
            try {
              sqliteVec.load(conn);
              done(null, conn);
            } catch (err) {
              done(err instanceof Error ? err : new Error(String(err)), conn);
            }
          },
        },
      });
    }
    return this.#knex;
  }

  /**
   * Runs all pending migrations.
   */
  migrate = async (): Promise<void> => {
    await this.knex.migrate.latest({
      migrationSource: createMigrationSource(),
    });
  };

  /**
   * Rolls back the last batch of migrations.
   */
  rollback = async (): Promise<void> => {
    await this.knex.migrate.rollback({
      migrationSource: createMigrationSource(),
    });
  };

  /**
   * Gets the current migration status.
   */
  getMigrationStatus = async (): Promise<{ completed: string[]; pending: string[] }> => {
    const source = createMigrationSource();
    const all = await source.getMigrations();
    const [completed] = await this.knex.migrate.list({
      migrationSource: source,
    });
    const completedNames = (completed as { name: string }[]).map((m) => m.name);
    const pending = all.filter((m) => !completedNames.includes(m));
    return { completed: completedNames, pending };
  };

  /**
   * Destroys the database connection.
   */
  [destroySymbol] = async (): Promise<void> => {
    if (this.#knex) {
      await this.#knex.destroy();
      this.#knex = null;
    }
  };
}

/**
 * Creates a DatabaseService with custom config.
 * Use this factory when you need to specify a custom database path.
 */
const createDatabaseService = (services: Services, config?: Partial<DatabaseConfig>): DatabaseService => {
  return new DatabaseService(services, config);
};

export type { DatabaseConfig, MigrationSource };
export { DatabaseService, createDatabaseService, databaseConfigSchema };
