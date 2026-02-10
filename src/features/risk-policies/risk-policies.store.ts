import type { Knex } from 'knex';

import type { WhitelistedDomain, WhitelistedDomainRow } from './risk-policies.schemas.ts';

/**
 * Converts a database row to a WhitelistedDomain.
 */
const rowToDomain = (row: WhitelistedDomainRow): WhitelistedDomain => ({
  domain: row.domain,
  addedAt: row.added_at,
  addedByConversationId: row.added_by_conversation_id,
  reason: row.reason,
});

/**
 * Normalizes a domain for storage (lowercase, trimmed).
 */
const normalizeDomain = (domain: string): string => {
  return domain.toLowerCase().trim();
};

/**
 * Adds a domain to the whitelist.
 *
 * @param db - Knex instance
 * @param domain - Domain to whitelist
 * @param conversationId - Optional conversation that added it
 * @param reason - Optional reason for whitelisting
 * @returns The whitelisted domain record
 */
const addWhitelistedDomain = async (
  db: Knex,
  domain: string,
  conversationId?: string,
  reason?: string,
): Promise<WhitelistedDomain> => {
  const normalizedDomain = normalizeDomain(domain);
  const timestamp = new Date().toISOString();

  // Use INSERT OR IGNORE to handle duplicates gracefully
  await db('domain_whitelist')
    .insert({
      domain: normalizedDomain,
      added_at: timestamp,
      added_by_conversation_id: conversationId ?? null,
      reason: reason ?? null,
    })
    .onConflict('domain')
    .ignore();

  return {
    domain: normalizedDomain,
    addedAt: timestamp,
    addedByConversationId: conversationId ?? null,
    reason: reason ?? null,
  };
};

/**
 * Removes a domain from the whitelist.
 *
 * @param db - Knex instance
 * @param domain - Domain to remove
 * @returns true if the domain was removed, false if it wasn't found
 */
const removeWhitelistedDomain = async (db: Knex, domain: string): Promise<boolean> => {
  const count = await db('domain_whitelist')
    .where({ domain: normalizeDomain(domain) })
    .delete();
  return count > 0;
};

/**
 * Checks if a domain is whitelisted.
 * Also checks parent domains (e.g., "sub.example.com" matches "example.com").
 *
 * @param db - Knex instance
 * @param domain - Domain to check
 * @returns true if the domain or a parent domain is whitelisted
 */
const isWhitelisted = async (db: Knex, domain: string): Promise<boolean> => {
  const normalizedDomain = normalizeDomain(domain);

  // Check exact match first
  const exact = await db('domain_whitelist').where({ domain: normalizedDomain }).first();
  if (exact) return true;

  // Check if any parent domain is whitelisted
  // e.g., "sub.example.com" should match "example.com"
  const parts = normalizedDomain.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const parentDomain = parts.slice(i).join('.');
    const parent = await db('domain_whitelist').where({ domain: parentDomain }).first();
    if (parent) return true;
  }

  return false;
};

/**
 * Lists all whitelisted domains.
 *
 * @param db - Knex instance
 * @returns Array of whitelisted domains, sorted by most recently added
 */
const listWhitelistedDomains = async (db: Knex): Promise<WhitelistedDomain[]> => {
  const rows = await db<WhitelistedDomainRow>('domain_whitelist').orderBy('added_at', 'desc');
  return rows.map(rowToDomain);
};

/**
 * Gets a specific whitelisted domain.
 *
 * @param db - Knex instance
 * @param domain - Domain to look up
 * @returns The whitelisted domain or null if not found
 */
const getWhitelistedDomain = async (db: Knex, domain: string): Promise<WhitelistedDomain | null> => {
  const row = await db<WhitelistedDomainRow>('domain_whitelist')
    .where({ domain: normalizeDomain(domain) })
    .first();
  return row ? rowToDomain(row) : null;
};

export {
  addWhitelistedDomain,
  removeWhitelistedDomain,
  isWhitelisted,
  listWhitelistedDomains,
  getWhitelistedDomain,
  normalizeDomain,
};
