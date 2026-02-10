import type { Services } from '../../core/services/services.ts';
import { DatabaseService } from '../../core/database/database.ts';
import { destroySymbol } from '../../core/services/services.ts';

import type { WhitelistedDomain } from './risk-policies.schemas.ts';
import {
  addWhitelistedDomain,
  removeWhitelistedDomain,
  isWhitelisted,
  listWhitelistedDomains,
  getWhitelistedDomain,
} from './risk-policies.store.ts';

/**
 * Service for managing domain whitelist for risk policies.
 *
 * Whitelisted domains are trusted for external communication,
 * reducing the risk level of tools like web.fetch when accessing them.
 */
class DomainWhitelistService {
  #services: Services;

  constructor(services: Services) {
    this.#services = services;
  }

  /**
   * Gets the Knex instance from the database service.
   */
  #db = () => this.#services.get(DatabaseService).knex;

  /**
   * Adds a domain to the whitelist.
   *
   * @param domain - Domain to whitelist (e.g., "example.com")
   * @param conversationId - Optional conversation that added it
   * @param reason - Optional reason for whitelisting
   * @returns The whitelisted domain record
   */
  add = async (domain: string, conversationId?: string, reason?: string): Promise<WhitelistedDomain> => {
    return addWhitelistedDomain(this.#db(), domain, conversationId, reason);
  };

  /**
   * Removes a domain from the whitelist.
   *
   * @param domain - Domain to remove
   * @returns true if removed, false if not found
   */
  remove = async (domain: string): Promise<boolean> => {
    return removeWhitelistedDomain(this.#db(), domain);
  };

  /**
   * Checks if a domain is whitelisted.
   * Also matches parent domains (e.g., "sub.example.com" matches "example.com").
   *
   * @param domain - Domain to check
   * @returns true if whitelisted
   */
  isWhitelisted = async (domain: string): Promise<boolean> => {
    return isWhitelisted(this.#db(), domain);
  };

  /**
   * Lists all whitelisted domains.
   *
   * @returns Array of whitelisted domains
   */
  list = async (): Promise<WhitelistedDomain[]> => {
    return listWhitelistedDomains(this.#db());
  };

  /**
   * Gets a specific whitelisted domain.
   *
   * @param domain - Domain to look up
   * @returns The whitelisted domain or null
   */
  get = async (domain: string): Promise<WhitelistedDomain | null> => {
    return getWhitelistedDomain(this.#db(), domain);
  };

  /**
   * Cleanup method for the services container.
   */
  [destroySymbol] = async (): Promise<void> => {
    // No cleanup needed
  };
}

export type { WhitelistedDomain };
export { DomainWhitelistService };
export { whitelistedDomainSchema } from './risk-policies.schemas.ts';
