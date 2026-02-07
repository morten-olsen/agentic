import type { Knex } from 'knex';

import type {
  PersonalityConfig,
  CreatePersonalityInput,
  UpdatePersonalityInput,
  PersonalityRow,
} from './personality.schemas.ts';
import { styleSchema, traitsSchema } from './personality.schemas.ts';

/**
 * Converts a database row to a PersonalityConfig.
 */
const rowToConfig = (row: PersonalityRow): PersonalityConfig => {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    style: styleSchema.parse(JSON.parse(row.style)),
    traits: traitsSchema.parse(JSON.parse(row.traits)),
    coreInstructions: row.core_instructions ?? undefined,
    topicGuidelines: row.topic_guidelines ? JSON.parse(row.topic_guidelines) : {},
    examples: row.examples ? JSON.parse(row.examples) : [],
  };
};

/**
 * Gets the personality config from the database.
 */
const getPersonalityConfig = async (db: Knex, id = 'default'): Promise<PersonalityConfig | null> => {
  const row = await db<PersonalityRow>('personality').where({ id }).first();
  if (!row) return null;
  return rowToConfig(row);
};

/**
 * Creates a new personality config.
 */
const createPersonalityConfig = async (db: Knex, input: CreatePersonalityInput): Promise<PersonalityConfig> => {
  // Build config with proper defaults
  const defaultStyle = styleSchema.parse({});
  const defaultTraits = traitsSchema.parse({});

  const config: PersonalityConfig = {
    id: input.id ?? 'default',
    name: input.name,
    role: input.role ?? 'personal assistant',
    style: { ...defaultStyle, ...(input.style ?? {}) },
    traits: { ...defaultTraits, ...(input.traits ?? {}) },
    coreInstructions: input.coreInstructions,
    topicGuidelines: input.topicGuidelines ?? {},
    examples: input.examples ?? [],
  };
  const now = new Date().toISOString();

  await db('personality').insert({
    id: config.id,
    name: config.name,
    role: config.role,
    style: JSON.stringify(config.style),
    traits: JSON.stringify(config.traits),
    core_instructions: config.coreInstructions ?? null,
    topic_guidelines: JSON.stringify(config.topicGuidelines),
    examples: JSON.stringify(config.examples),
    created_at: now,
    updated_at: now,
  });

  return config;
};

/**
 * Updates an existing personality config.
 */
const updatePersonalityConfig = async (
  db: Knex,
  id: string,
  updates: UpdatePersonalityInput,
): Promise<PersonalityConfig | null> => {
  const existing = await getPersonalityConfig(db, id);
  if (!existing) return null;

  const now = new Date().toISOString();

  // Merge updates
  const updatedConfig: PersonalityConfig = {
    ...existing,
    name: updates.name ?? existing.name,
    role: updates.role ?? existing.role,
    style: updates.style ? { ...existing.style, ...updates.style } : existing.style,
    traits: updates.traits ? { ...existing.traits, ...updates.traits } : existing.traits,
    coreInstructions:
      updates.coreInstructions === null ? undefined : (updates.coreInstructions ?? existing.coreInstructions),
    topicGuidelines: updates.topicGuidelines ?? existing.topicGuidelines,
    examples: updates.examples ?? existing.examples,
  };

  await db('personality')
    .where({ id })
    .update({
      name: updatedConfig.name,
      role: updatedConfig.role,
      style: JSON.stringify(updatedConfig.style),
      traits: JSON.stringify(updatedConfig.traits),
      core_instructions: updatedConfig.coreInstructions ?? null,
      topic_guidelines: JSON.stringify(updatedConfig.topicGuidelines),
      examples: JSON.stringify(updatedConfig.examples),
      updated_at: now,
    });

  return updatedConfig;
};

/**
 * Deletes a personality config.
 */
const deletePersonalityConfig = async (db: Knex, id: string): Promise<boolean> => {
  const deleted = await db('personality').where({ id }).delete();
  return deleted > 0;
};

/**
 * Gets or creates the default personality config.
 */
const getOrCreateDefaultConfig = async (db: Knex): Promise<PersonalityConfig> => {
  const existing = await getPersonalityConfig(db, 'default');
  if (existing) return existing;

  return createPersonalityConfig(db, {
    name: 'GLaDOS',
    role: 'personal assistant',
  });
};

export {
  getPersonalityConfig,
  createPersonalityConfig,
  updatePersonalityConfig,
  deletePersonalityConfig,
  getOrCreateDefaultConfig,
  rowToConfig,
};
