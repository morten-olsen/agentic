import type { Services } from '../../../core/services/services.ts';
import { KnexStore } from '../../../core/store/store.ts';
import type { Item } from '../../../core/store/store.ts';

import type { EntityKnowledge, CreateEntityInput, UpdateEntityInput, EntityType } from './entity-knowledge.schemas.ts';
import { createEntityInputSchema } from './entity-knowledge.schemas.ts';

// ============================================================================
// Errors
// ============================================================================

class EntityNotFoundError extends Error {
  constructor(id: string) {
    super(`Entity not found: ${id}`);
    this.name = 'EntityNotFoundError';
  }
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Namespace prefix for all entities.
 */
const ENTITIES_NAMESPACE = 'entities';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generates a unique ID for an entity.
 */
const generateId = (): string => crypto.randomUUID();

/**
 * Gets the current timestamp as ISO string.
 */
const now = (): string => new Date().toISOString();

/**
 * Converts a store Item to an EntityKnowledge.
 */
const itemToEntity = (item: Item, type: EntityType): EntityKnowledge => {
  const value = item.value;
  return {
    id: item.key,
    name: value['name'] as string,
    type,
    description: value['description'] as string | undefined,
    attributes: (value['attributes'] as Record<string, unknown>) ?? {},
    source: value['source'] as 'explicit' | 'inferred',
    confidence: value['confidence'] as number,
    lastReferencedAt: value['lastReferencedAt'] as string,
    referenceCount: value['referenceCount'] as number,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
};

/**
 * Converts entity data to a store value.
 */
const entityToValue = (entity: {
  name: string;
  description?: string;
  attributes: Record<string, unknown>;
  source: 'explicit' | 'inferred';
  confidence: number;
  lastReferencedAt: string;
  referenceCount: number;
}): Record<string, unknown> => {
  return {
    name: entity.name,
    description: entity.description,
    attributes: entity.attributes,
    source: entity.source,
    confidence: entity.confidence,
    lastReferencedAt: entity.lastReferencedAt,
    referenceCount: entity.referenceCount,
  };
};

// ============================================================================
// Entity Knowledge Service
// ============================================================================

/**
 * Entity Knowledge Service - manages knowledge about things in the user's world.
 *
 * This is a facade over KnexStore that provides a domain-specific API for entities.
 *
 * Features:
 * - Store and retrieve entity knowledge (companies, products, documents, etc.)
 * - Reference counting for relevance tracking
 *
 * Note: Entity relations have been removed in favor of simpler flat storage.
 */
class EntityKnowledgeService {
  #store: KnexStore;

  constructor(services: Services) {
    this.#store = services.get(KnexStore);
  }

  // ==========================================================================
  // Entity CRUD
  // ==========================================================================

  /**
   * Creates a new entity.
   */
  create = async (input: CreateEntityInput): Promise<EntityKnowledge> => {
    const validated = createEntityInputSchema.parse(input);
    const id = generateId();
    const timestamp = now();

    const value = entityToValue({
      name: validated.name,
      description: validated.description,
      attributes: validated.attributes ?? {},
      source: validated.source ?? 'explicit',
      confidence: validated.confidence ?? 1.0,
      lastReferencedAt: timestamp,
      referenceCount: 0,
    });

    await this.#store.put([ENTITIES_NAMESPACE, validated.type], id, value);

    return {
      id,
      name: validated.name,
      type: validated.type,
      description: validated.description,
      attributes: validated.attributes ?? {},
      source: validated.source ?? 'explicit',
      confidence: validated.confidence ?? 1.0,
      lastReferencedAt: timestamp,
      referenceCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  };

  /**
   * Gets an entity by ID.
   */
  get = async (id: string): Promise<EntityKnowledge | null> => {
    // Search across all entity types to find by ID
    const types: EntityType[] = ['company', 'project', 'document', 'product', 'concept', 'place', 'other'];

    for (const type of types) {
      const item = await this.#store.get([ENTITIES_NAMESPACE, type], id);
      if (item) {
        return itemToEntity(item, type);
      }
    }

    return null;
  };

  /**
   * Updates an entity.
   */
  update = async (id: string, updates: UpdateEntityInput): Promise<EntityKnowledge> => {
    const existing = await this.get(id);
    if (!existing) {
      throw new EntityNotFoundError(id);
    }

    const timestamp = now();
    const value = entityToValue({
      name: updates.name ?? existing.name,
      description: updates.description ?? existing.description,
      attributes: updates.attributes ?? existing.attributes,
      source: existing.source,
      confidence: updates.confidence ?? existing.confidence,
      lastReferencedAt: existing.lastReferencedAt,
      referenceCount: existing.referenceCount,
    });

    // If type changed, delete from old namespace and create in new
    const newType = updates.type ?? existing.type;
    if (newType !== existing.type) {
      await this.#store.delete([ENTITIES_NAMESPACE, existing.type], id);
    }

    await this.#store.put([ENTITIES_NAMESPACE, newType], id, value);

    return {
      ...existing,
      name: updates.name ?? existing.name,
      type: newType,
      description: updates.description ?? existing.description,
      attributes: updates.attributes ?? existing.attributes,
      confidence: updates.confidence ?? existing.confidence,
      updatedAt: timestamp,
    };
  };

  /**
   * Deletes an entity.
   */
  delete = async (id: string): Promise<boolean> => {
    const existing = await this.get(id);
    if (!existing) {
      return false;
    }

    await this.#store.delete([ENTITIES_NAMESPACE, existing.type], id);
    return true;
  };

  // ==========================================================================
  // Entity Search
  // ==========================================================================

  /**
   * Finds entities by name (partial match).
   */
  findByName = async (name: string): Promise<EntityKnowledge[]> => {
    const types: EntityType[] = ['company', 'project', 'document', 'product', 'concept', 'place', 'other'];
    const matches: EntityKnowledge[] = [];
    const searchTerm = name.toLowerCase();

    for (const type of types) {
      const items = await this.#store.search([ENTITIES_NAMESPACE, type], {
        limit: 100,
      });

      for (const item of items) {
        const entityName = (item.value['name'] as string) ?? '';
        if (entityName.toLowerCase().includes(searchTerm)) {
          matches.push(itemToEntity(item, type));
        }
      }
    }

    // Sort by reference count descending
    matches.sort((a, b) => b.referenceCount - a.referenceCount);
    return matches.slice(0, 20);
  };

  /**
   * Finds entities by type.
   */
  findByType = async (type: EntityType): Promise<EntityKnowledge[]> => {
    const items = await this.#store.search([ENTITIES_NAMESPACE, type], {
      limit: 100,
    });

    const entities = items.map((item) => itemToEntity(item, type));

    // Sort by lastReferencedAt descending
    entities.sort((a, b) => new Date(b.lastReferencedAt).getTime() - new Date(a.lastReferencedAt).getTime());

    return entities;
  };

  /**
   * Gets recently referenced entities.
   */
  getRecent = async (limit = 10): Promise<EntityKnowledge[]> => {
    const types: EntityType[] = ['company', 'project', 'document', 'product', 'concept', 'place', 'other'];
    const allEntities: EntityKnowledge[] = [];

    for (const type of types) {
      const items = await this.#store.search([ENTITIES_NAMESPACE, type], {
        limit: 50,
      });

      for (const item of items) {
        allEntities.push(itemToEntity(item, type));
      }
    }

    // Sort by lastReferencedAt descending
    allEntities.sort((a, b) => new Date(b.lastReferencedAt).getTime() - new Date(a.lastReferencedAt).getTime());

    return allEntities.slice(0, limit);
  };

  /**
   * Lists entities with optional filtering.
   */
  list = async (options?: { type?: EntityType; limit?: number }): Promise<EntityKnowledge[]> => {
    const types: EntityType[] = options?.type
      ? [options.type]
      : ['company', 'project', 'document', 'product', 'concept', 'place', 'other'];
    const limit = options?.limit ?? 100;
    const allEntities: EntityKnowledge[] = [];

    for (const type of types) {
      const items = await this.#store.search([ENTITIES_NAMESPACE, type], {
        limit: 100,
      });

      for (const item of items) {
        allEntities.push(itemToEntity(item, type));
      }
    }

    // Sort by lastReferencedAt descending
    allEntities.sort((a, b) => new Date(b.lastReferencedAt).getTime() - new Date(a.lastReferencedAt).getTime());

    return allEntities.slice(0, limit);
  };

  // ==========================================================================
  // Reference Tracking
  // ==========================================================================

  /**
   * Records a reference to an entity (updates lastReferencedAt and count).
   */
  recordReference = async (id: string): Promise<void> => {
    const existing = await this.get(id);
    if (!existing) return;

    const timestamp = now();
    const value = entityToValue({
      name: existing.name,
      description: existing.description,
      attributes: existing.attributes,
      source: existing.source,
      confidence: existing.confidence,
      lastReferencedAt: timestamp,
      referenceCount: existing.referenceCount + 1,
    });

    await this.#store.put([ENTITIES_NAMESPACE, existing.type], id, value);
  };
}

// ============================================================================
// Re-exports
// ============================================================================

export type { EntityType, EntityKnowledge, CreateEntityInput, UpdateEntityInput } from './entity-knowledge.schemas.ts';

export {
  entityTypeSchema,
  entityKnowledgeSchema,
  createEntityInputSchema,
  updateEntityInputSchema,
} from './entity-knowledge.schemas.ts';

export { EntityKnowledgeService, EntityNotFoundError };
