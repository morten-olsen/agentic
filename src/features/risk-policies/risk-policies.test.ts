import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Knex from 'knex';

import {
  addWhitelistedDomain,
  removeWhitelistedDomain,
  isWhitelisted,
  listWhitelistedDomains,
  getWhitelistedDomain,
  normalizeDomain,
} from './risk-policies.store.ts';

describe('risk-policies store', () => {
  let db: ReturnType<typeof Knex>;

  beforeEach(async () => {
    // Create in-memory SQLite database
    db = Knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    // Create the domain_whitelist table
    await db.schema.createTable('domain_whitelist', (table) => {
      table.text('domain').primary();
      table.text('added_at').notNullable();
      table.text('added_by_conversation_id');
      table.text('reason');
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('normalizeDomain', () => {
    it('converts to lowercase', () => {
      expect(normalizeDomain('Example.COM')).toBe('example.com');
    });

    it('trims whitespace', () => {
      expect(normalizeDomain('  example.com  ')).toBe('example.com');
    });
  });

  describe('addWhitelistedDomain', () => {
    it('adds a new domain', async () => {
      const result = await addWhitelistedDomain(db, 'example.com');

      expect(result.domain).toBe('example.com');
      expect(result.addedAt).toBeDefined();
      expect(result.addedByConversationId).toBeNull();
      expect(result.reason).toBeNull();
    });

    it('normalizes domain before storing', async () => {
      const result = await addWhitelistedDomain(db, 'EXAMPLE.COM');

      expect(result.domain).toBe('example.com');
    });

    it('stores conversation ID and reason', async () => {
      const result = await addWhitelistedDomain(db, 'example.com', 'conv-123', 'Trusted API');

      expect(result.addedByConversationId).toBe('conv-123');
      expect(result.reason).toBe('Trusted API');
    });

    it('handles duplicate domains gracefully', async () => {
      await addWhitelistedDomain(db, 'example.com', undefined, 'First');
      const second = await addWhitelistedDomain(db, 'example.com', undefined, 'Second');

      // Should not error, returns the domain (though reason may be from first insert)
      expect(second.domain).toBe('example.com');

      // Verify only one record exists
      const all = await listWhitelistedDomains(db);
      expect(all).toHaveLength(1);
    });
  });

  describe('removeWhitelistedDomain', () => {
    it('removes an existing domain', async () => {
      await addWhitelistedDomain(db, 'example.com');

      const result = await removeWhitelistedDomain(db, 'example.com');

      expect(result).toBe(true);
      expect(await isWhitelisted(db, 'example.com')).toBe(false);
    });

    it('returns false for non-existent domain', async () => {
      const result = await removeWhitelistedDomain(db, 'nonexistent.com');

      expect(result).toBe(false);
    });

    it('normalizes domain for removal', async () => {
      await addWhitelistedDomain(db, 'example.com');

      const result = await removeWhitelistedDomain(db, 'EXAMPLE.COM');

      expect(result).toBe(true);
    });
  });

  describe('isWhitelisted', () => {
    it('returns true for exact match', async () => {
      await addWhitelistedDomain(db, 'example.com');

      expect(await isWhitelisted(db, 'example.com')).toBe(true);
    });

    it('returns false for non-whitelisted domain', async () => {
      expect(await isWhitelisted(db, 'example.com')).toBe(false);
    });

    it('matches subdomains to parent domain', async () => {
      await addWhitelistedDomain(db, 'example.com');

      expect(await isWhitelisted(db, 'api.example.com')).toBe(true);
      expect(await isWhitelisted(db, 'sub.api.example.com')).toBe(true);
    });

    it('does not match parent to child domain', async () => {
      await addWhitelistedDomain(db, 'sub.example.com');

      expect(await isWhitelisted(db, 'example.com')).toBe(false);
    });

    it('handles case-insensitive matching', async () => {
      await addWhitelistedDomain(db, 'Example.COM');

      expect(await isWhitelisted(db, 'EXAMPLE.com')).toBe(true);
    });
  });

  describe('listWhitelistedDomains', () => {
    it('returns empty array when no domains', async () => {
      const result = await listWhitelistedDomains(db);

      expect(result).toEqual([]);
    });

    it('returns all whitelisted domains', async () => {
      await addWhitelistedDomain(db, 'first.com');
      await addWhitelistedDomain(db, 'second.com');

      const result = await listWhitelistedDomains(db);

      expect(result).toHaveLength(2);
      expect(result.map((d) => d.domain)).toContain('first.com');
      expect(result.map((d) => d.domain)).toContain('second.com');
    });

    it('orders by most recently added', async () => {
      await addWhitelistedDomain(db, 'first.com');
      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));
      await addWhitelistedDomain(db, 'second.com');

      const result = await listWhitelistedDomains(db);

      expect(result[0].domain).toBe('second.com');
      expect(result[1].domain).toBe('first.com');
    });
  });

  describe('getWhitelistedDomain', () => {
    it('returns domain if whitelisted', async () => {
      await addWhitelistedDomain(db, 'example.com', 'conv-1', 'Test reason');

      const result = await getWhitelistedDomain(db, 'example.com');

      expect(result).not.toBeNull();
      expect(result?.domain).toBe('example.com');
      expect(result?.addedByConversationId).toBe('conv-1');
      expect(result?.reason).toBe('Test reason');
    });

    it('returns null if not whitelisted', async () => {
      const result = await getWhitelistedDomain(db, 'nonexistent.com');

      expect(result).toBeNull();
    });

    it('normalizes domain for lookup', async () => {
      await addWhitelistedDomain(db, 'example.com');

      const result = await getWhitelistedDomain(db, 'EXAMPLE.COM');

      expect(result?.domain).toBe('example.com');
    });
  });
});
