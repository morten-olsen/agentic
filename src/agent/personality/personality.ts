import type { Services } from '../../core/services/services.ts';
import { DatabaseService } from '../../core/database/database.ts';
import type { AgentContext } from '../../agent/context/context.ts';
import type { TriggerContext } from '../../features/triggers/triggers.schemas.ts';

import type { PersonalityConfig, CreatePersonalityInput, UpdatePersonalityInput } from './personality.schemas.ts';
import {
  getPersonalityConfig,
  createPersonalityConfig,
  updatePersonalityConfig,
  deletePersonalityConfig,
  getOrCreateDefaultConfig,
} from './personality.store.ts';
import { buildSystemPrompt } from './personality.prompts.ts';

/**
 * Personality Service - manages agent personality configuration.
 */
class PersonalityService {
  #services: Services;

  constructor(services: Services) {
    this.#services = services;
  }

  /**
   * Gets the knex instance from the database service.
   */
  #db = () => {
    return this.#services.get(DatabaseService).knex;
  };

  /**
   * Gets the current personality config.
   * Returns the default config if none exists.
   */
  getConfig = async (id = 'default'): Promise<PersonalityConfig> => {
    const config = await getPersonalityConfig(this.#db(), id);
    if (config) return config;

    // If not found and asking for default, create it
    if (id === 'default') {
      return getOrCreateDefaultConfig(this.#db());
    }

    // Return default config for non-existent custom configs
    return getOrCreateDefaultConfig(this.#db());
  };

  /**
   * Creates a new personality config.
   */
  createConfig = async (input: CreatePersonalityInput): Promise<PersonalityConfig> => {
    return createPersonalityConfig(this.#db(), input);
  };

  /**
   * Updates an existing personality config.
   */
  updateConfig = async (id: string, updates: UpdatePersonalityInput): Promise<PersonalityConfig | null> => {
    return updatePersonalityConfig(this.#db(), id, updates);
  };

  /**
   * Deletes a personality config.
   */
  deleteConfig = async (id: string): Promise<boolean> => {
    // Don't allow deleting the default config
    if (id === 'default') {
      return false;
    }
    return deletePersonalityConfig(this.#db(), id);
  };

  /**
   * Builds the system prompt from the current config and optional context.
   */
  buildSystemPrompt = async (
    context?: AgentContext,
    configId = 'default',
    triggerContext?: TriggerContext,
  ): Promise<string> => {
    const config = await this.getConfig(configId);
    return buildSystemPrompt(config, context, triggerContext);
  };

  /**
   * Updates the default config with partial updates.
   */
  updateDefaultConfig = async (updates: UpdatePersonalityInput): Promise<PersonalityConfig> => {
    // Ensure default exists
    await this.getConfig('default');
    const updated = await this.updateConfig('default', updates);
    // Should always succeed since we just ensured it exists
    return updated as PersonalityConfig;
  };
}

// Re-export types and schemas
export type {
  Style,
  Traits,
  PersonalityExample,
  PersonalityConfig,
  CreatePersonalityInput,
  UpdatePersonalityInput,
} from './personality.schemas.ts';

export type { AgentContext } from '../../agent/context/context.ts';

export {
  styleSchema,
  traitsSchema,
  personalityExampleSchema,
  personalityConfigSchema,
  createPersonalityInputSchema,
  updatePersonalityInputSchema,
} from './personality.schemas.ts';

export { buildSystemPrompt } from './personality.prompts.ts';

export { PersonalityService };
