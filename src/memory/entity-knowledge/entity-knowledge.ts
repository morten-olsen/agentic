import type { Services } from '../../services/services.ts';
import { DatabaseService } from '../../database/database.ts';

import type {
  EntityKnowledge,
  EntityRelation,
  CreateEntityInput,
  UpdateEntityInput,
  CreateRelationInput,
  EntityType,
} from './entity-knowledge.schemas.ts';
import {
  createEntity,
  getEntity,
  updateEntity,
  deleteEntity,
  findByName,
  findByType,
  getRecentEntities,
  listEntities,
  recordReference,
  createRelation,
  getRelation,
  deleteRelation,
  getRelationsForEntity,
  getRelatedEntities,
} from './entity-knowledge.store.ts';

// ============================================================================
// Errors
// ============================================================================

class EntityNotFoundError extends Error {
  constructor(id: string) {
    super(`Entity not found: ${id}`);
    this.name = 'EntityNotFoundError';
  }
}

class RelationNotFoundError extends Error {
  constructor(id: string) {
    super(`Relation not found: ${id}`);
    this.name = 'RelationNotFoundError';
  }
}

// ============================================================================
// Entity Knowledge Service
// ============================================================================

/**
 * Entity Knowledge Service - manages knowledge about things in the user's world.
 *
 * Features:
 * - Store and retrieve entity knowledge (companies, products, documents, etc.)
 * - Track relationships between entities
 * - Reference counting for relevance tracking
 */
class EntityKnowledgeService {
  #services: Services;

  constructor(services: Services) {
    this.#services = services;
  }

  /**
   * Gets the Knex instance from the database service.
   */
  #db = () => {
    return this.#services.get(DatabaseService).knex;
  };

  // ==========================================================================
  // Entity CRUD
  // ==========================================================================

  /**
   * Creates a new entity.
   */
  create = async (input: CreateEntityInput): Promise<EntityKnowledge> => {
    return createEntity(this.#db(), input);
  };

  /**
   * Gets an entity by ID.
   */
  get = async (id: string): Promise<EntityKnowledge | null> => {
    return getEntity(this.#db(), id);
  };

  /**
   * Updates an entity.
   */
  update = async (id: string, updates: UpdateEntityInput): Promise<EntityKnowledge> => {
    const entity = await updateEntity(this.#db(), id, updates);
    if (!entity) {
      throw new EntityNotFoundError(id);
    }
    return entity;
  };

  /**
   * Deletes an entity and its relations.
   */
  delete = async (id: string): Promise<boolean> => {
    return deleteEntity(this.#db(), id);
  };

  // ==========================================================================
  // Entity Search
  // ==========================================================================

  /**
   * Finds entities by name (partial match).
   */
  findByName = async (name: string): Promise<EntityKnowledge[]> => {
    return findByName(this.#db(), name);
  };

  /**
   * Finds entities by type.
   */
  findByType = async (type: EntityType): Promise<EntityKnowledge[]> => {
    return findByType(this.#db(), type);
  };

  /**
   * Gets recently referenced entities.
   */
  getRecent = async (limit?: number): Promise<EntityKnowledge[]> => {
    return getRecentEntities(this.#db(), limit);
  };

  /**
   * Lists entities with optional filtering.
   */
  list = async (options?: { type?: EntityType; limit?: number }): Promise<EntityKnowledge[]> => {
    return listEntities(this.#db(), options);
  };

  // ==========================================================================
  // Reference Tracking
  // ==========================================================================

  /**
   * Records a reference to an entity (updates lastReferencedAt and count).
   */
  recordReference = async (id: string): Promise<void> => {
    return recordReference(this.#db(), id);
  };

  // ==========================================================================
  // Relations
  // ==========================================================================

  /**
   * Adds a relation from an entity to another object.
   */
  addRelation = async (input: CreateRelationInput): Promise<EntityRelation> => {
    // Verify source entity exists
    const entity = await getEntity(this.#db(), input.sourceEntityId);
    if (!entity) {
      throw new EntityNotFoundError(input.sourceEntityId);
    }
    return createRelation(this.#db(), input);
  };

  /**
   * Gets a relation by ID.
   */
  getRelation = async (id: string): Promise<EntityRelation | null> => {
    return getRelation(this.#db(), id);
  };

  /**
   * Removes a relation.
   */
  removeRelation = async (id: string): Promise<boolean> => {
    return deleteRelation(this.#db(), id);
  };

  /**
   * Gets all relations from an entity.
   */
  getRelationsFrom = async (entityId: string): Promise<EntityRelation[]> => {
    return getRelationsForEntity(this.#db(), entityId);
  };

  /**
   * Gets all related entities (entities linked via relations).
   */
  getRelatedEntities = async (entityId: string): Promise<EntityKnowledge[]> => {
    return getRelatedEntities(this.#db(), entityId);
  };
}

// ============================================================================
// Re-exports
// ============================================================================

export type {
  EntityType,
  EntityRelation,
  EntityKnowledge,
  CreateEntityInput,
  UpdateEntityInput,
  CreateRelationInput,
} from './entity-knowledge.schemas.ts';

export {
  entityTypeSchema,
  entityRelationSchema,
  entityKnowledgeSchema,
  createEntityInputSchema,
  updateEntityInputSchema,
  createRelationInputSchema,
} from './entity-knowledge.schemas.ts';

export { EntityKnowledgeService, EntityNotFoundError, RelationNotFoundError };
