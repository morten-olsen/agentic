import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { Services } from '../../core/services/services.ts';

import { createDatabaseService } from './database.ts';
import type { DatabaseService } from './database.ts';

describe('DatabaseService', () => {
  let services: Services;
  let db: DatabaseService;

  beforeEach(() => {
    services = new Services();
    db = createDatabaseService(services, { path: ':memory:' });
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('knex', () => {
    it('returns a Knex instance', () => {
      const knex = db.knex;

      expect(knex).toBeDefined();
      expect(typeof knex.raw).toBe('function');
    });

    it('returns the same instance on subsequent access', () => {
      const first = db.knex;
      const second = db.knex;

      expect(first).toBe(second);
    });
  });

  describe('migrate', () => {
    it('runs all migrations successfully', async () => {
      await db.migrate();

      // Verify tables were created
      const tables = await db.knex.raw("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
      const tableNames = tables.map((t: { name: string }) => t.name);

      expect(tableNames).toContain('user_identity');
      expect(tableNames).toContain('projects');
      expect(tableNames).toContain('goals');
      expect(tableNames).toContain('routines');
      expect(tableNames).toContain('contacts');
      expect(tableNames).toContain('contact_groups');
      expect(tableNames).toContain('contact_group_members');
      expect(tableNames).toContain('project_contacts');
      expect(tableNames).toContain('locations');
      expect(tableNames).toContain('location_history');
      expect(tableNames).toContain('calendar_events');
      expect(tableNames).toContain('memories');
    });

    it('is idempotent', async () => {
      await db.migrate();
      await db.migrate();

      const status = await db.getMigrationStatus();
      expect(status.pending).toHaveLength(0);
    });
  });

  describe('rollback', () => {
    it('rolls back migrations', async () => {
      await db.migrate();
      await db.rollback();

      const tables = await db.knex.raw(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'knex_%' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      );

      expect(tables).toHaveLength(0);
    });
  });

  describe('getMigrationStatus', () => {
    it('returns pending migrations when none are run', async () => {
      const status = await db.getMigrationStatus();

      expect(status.completed).toHaveLength(0);
      expect(status.pending).toContain('001_foundation');
    });

    it('returns completed migrations after running', async () => {
      await db.migrate();

      const status = await db.getMigrationStatus();

      expect(status.completed).toContain('001_foundation');
      expect(status.pending).toHaveLength(0);
    });
  });

  describe('table schema', () => {
    beforeEach(async () => {
      await db.migrate();
    });

    it('creates user_identity with correct columns', async () => {
      const columns = await db.knex('user_identity').columnInfo();

      expect(columns).toHaveProperty('id');
      expect(columns).toHaveProperty('name');
      expect(columns).toHaveProperty('timezone');
      expect(columns).toHaveProperty('locale');
      expect(columns).toHaveProperty('working_hours_start');
      expect(columns).toHaveProperty('working_hours_end');
      expect(columns).toHaveProperty('working_days');
      expect(columns).toHaveProperty('preferences');
      expect(columns).toHaveProperty('created_at');
      expect(columns).toHaveProperty('updated_at');
    });

    it('creates projects with correct columns', async () => {
      const columns = await db.knex('projects').columnInfo();

      expect(columns).toHaveProperty('id');
      expect(columns).toHaveProperty('name');
      expect(columns).toHaveProperty('description');
      expect(columns).toHaveProperty('status');
      expect(columns).toHaveProperty('priority');
      expect(columns).toHaveProperty('tags');
      expect(columns).toHaveProperty('created_at');
      expect(columns).toHaveProperty('updated_at');
    });

    it('creates contacts with correct columns', async () => {
      const columns = await db.knex('contacts').columnInfo();

      expect(columns).toHaveProperty('id');
      expect(columns).toHaveProperty('name');
      expect(columns).toHaveProperty('email');
      expect(columns).toHaveProperty('phone');
      expect(columns).toHaveProperty('organization');
      expect(columns).toHaveProperty('role');
      expect(columns).toHaveProperty('relationship_type');
      expect(columns).toHaveProperty('relationship_context');
      expect(columns).toHaveProperty('relationship_importance');
      expect(columns).toHaveProperty('notes');
      expect(columns).toHaveProperty('communication_style');
      expect(columns).toHaveProperty('last_interaction_at');
      expect(columns).toHaveProperty('tags');
    });

    it('creates locations with correct columns', async () => {
      const columns = await db.knex('locations').columnInfo();

      expect(columns).toHaveProperty('id');
      expect(columns).toHaveProperty('name');
      expect(columns).toHaveProperty('type');
      expect(columns).toHaveProperty('latitude');
      expect(columns).toHaveProperty('longitude');
      expect(columns).toHaveProperty('address');
      expect(columns).toHaveProperty('timezone');
      expect(columns).toHaveProperty('is_default');
      expect(columns).toHaveProperty('tags');
    });

    it('creates calendar_events with correct columns', async () => {
      const columns = await db.knex('calendar_events').columnInfo();

      expect(columns).toHaveProperty('id');
      expect(columns).toHaveProperty('external_id');
      expect(columns).toHaveProperty('source');
      expect(columns).toHaveProperty('title');
      expect(columns).toHaveProperty('description');
      expect(columns).toHaveProperty('location');
      expect(columns).toHaveProperty('start_time');
      expect(columns).toHaveProperty('end_time');
      expect(columns).toHaveProperty('all_day');
      expect(columns).toHaveProperty('timezone');
      expect(columns).toHaveProperty('attendees');
      expect(columns).toHaveProperty('recurrence_rule');
      expect(columns).toHaveProperty('requires_prep');
      expect(columns).toHaveProperty('prep_notes');
      expect(columns).toHaveProperty('travel_time_minutes');
    });
  });
});
