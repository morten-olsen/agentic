import type { Knex } from 'knex';

import type {
  EntityKnowledge,
  EntityRelation,
  CreateEntityInput,
  UpdateEntityInput,
  CreateRelationInput,
  EntityRow,
  RelationRow,
  EntityType,
} from './entity-knowledge.schemas.ts';
import { createEntityInputSchema, createRelationInputSchema } from './entity-knowledge.schemas.ts';

// ============================================================================
// Helpers
// ============================================================================

const generateId = (): string => crypto.randomUUID();
const now = (): string => new Date().toISOString();

const rowToEntity = (row: EntityRow): EntityKnowledge => ({
  id: row.id,
  name: row.name,
  type: row.type as EntityKnowledge['type'],
  description: row.description ?? undefined,
  attributes: row.attributes ? JSON.parse(row.attributes) : {},
  source: row.source as EntityKnowledge['source'],
  confidence: row.confidence,
  lastReferencedAt: row.last_referenced_at,
  referenceCount: row.reference_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const rowToRelation = (row: RelationRow): EntityRelation => ({
  id: row.id,
  sourceEntityId: row.source_entity_id,
  targetEntityId: row.target_entity_id,
  targetType: row.target_type as EntityRelation['targetType'],
  relationshipType: row.relationship_type,
  metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  createdAt: row.created_at,
});

// ============================================================================
// Entity CRUD
// ============================================================================

const createEntity = async (db: Knex, input: CreateEntityInput): Promise<EntityKnowledge> => {
  const validated = createEntityInputSchema.parse(input);
  const id = generateId();
  const timestamp = now();

  const row: EntityRow = {
    id,
    name: validated.name,
    type: validated.type,
    description: validated.description ?? null,
    attributes: JSON.stringify(validated.attributes),
    source: validated.source,
    confidence: validated.confidence,
    last_referenced_at: timestamp,
    reference_count: 0,
    created_at: timestamp,
    updated_at: timestamp,
  };

  await db('entity_knowledge').insert(row);
  return rowToEntity(row);
};

const getEntity = async (db: Knex, id: string): Promise<EntityKnowledge | null> => {
  const row = await db<EntityRow>('entity_knowledge').where({ id }).first();
  return row ? rowToEntity(row) : null;
};

const updateEntity = async (db: Knex, id: string, updates: UpdateEntityInput): Promise<EntityKnowledge | null> => {
  const timestamp = now();

  const updateData: Partial<EntityRow> = {
    updated_at: timestamp,
  };

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.type !== undefined) updateData.type = updates.type;
  if (updates.description !== undefined) updateData.description = updates.description;
  if (updates.attributes !== undefined) updateData.attributes = JSON.stringify(updates.attributes);
  if (updates.confidence !== undefined) updateData.confidence = updates.confidence;

  const count = await db('entity_knowledge').where({ id }).update(updateData);
  if (count === 0) return null;

  return getEntity(db, id);
};

const deleteEntity = async (db: Knex, id: string): Promise<boolean> => {
  const count = await db('entity_knowledge').where({ id }).delete();
  return count > 0;
};

// ============================================================================
// Entity Queries
// ============================================================================

const findByName = async (db: Knex, name: string): Promise<EntityKnowledge[]> => {
  const rows = await db<EntityRow>('entity_knowledge')
    .where('name', 'like', `%${name}%`)
    .orderBy('reference_count', 'desc')
    .limit(20);
  return rows.map(rowToEntity);
};

const findByType = async (db: Knex, type: EntityType): Promise<EntityKnowledge[]> => {
  const rows = await db<EntityRow>('entity_knowledge').where({ type }).orderBy('last_referenced_at', 'desc');
  return rows.map(rowToEntity);
};

const getRecentEntities = async (db: Knex, limit = 10): Promise<EntityKnowledge[]> => {
  const rows = await db<EntityRow>('entity_knowledge').orderBy('last_referenced_at', 'desc').limit(limit);
  return rows.map(rowToEntity);
};

const listEntities = async (db: Knex, options?: { type?: EntityType; limit?: number }): Promise<EntityKnowledge[]> => {
  let query = db<EntityRow>('entity_knowledge');

  if (options?.type) {
    query = query.where({ type: options.type });
  }

  query = query.orderBy('last_referenced_at', 'desc');

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const rows = await query;
  return rows.map(rowToEntity);
};

// ============================================================================
// Reference Tracking
// ============================================================================

const recordReference = async (db: Knex, id: string): Promise<void> => {
  const timestamp = now();
  await db('entity_knowledge')
    .where({ id })
    .update({
      last_referenced_at: timestamp,
      reference_count: db.raw('reference_count + 1'),
    });
};

// ============================================================================
// Relation CRUD
// ============================================================================

const createRelation = async (db: Knex, input: CreateRelationInput): Promise<EntityRelation> => {
  const validated = createRelationInputSchema.parse(input);
  const id = generateId();
  const timestamp = now();

  const row: RelationRow = {
    id,
    source_entity_id: validated.sourceEntityId,
    target_entity_id: validated.targetEntityId,
    target_type: validated.targetType,
    relationship_type: validated.relationshipType,
    metadata: validated.metadata ? JSON.stringify(validated.metadata) : null,
    created_at: timestamp,
  };

  await db('entity_relations').insert(row);
  return rowToRelation(row);
};

const getRelation = async (db: Knex, id: string): Promise<EntityRelation | null> => {
  const row = await db<RelationRow>('entity_relations').where({ id }).first();
  return row ? rowToRelation(row) : null;
};

const deleteRelation = async (db: Knex, id: string): Promise<boolean> => {
  const count = await db('entity_relations').where({ id }).delete();
  return count > 0;
};

const getRelationsForEntity = async (db: Knex, entityId: string): Promise<EntityRelation[]> => {
  const rows = await db<RelationRow>('entity_relations')
    .where({ source_entity_id: entityId })
    .orderBy('created_at', 'desc');
  return rows.map(rowToRelation);
};

const getRelationsToEntity = async (
  db: Knex,
  targetId: string,
  targetType: EntityRelation['targetType'],
): Promise<EntityRelation[]> => {
  const rows = await db<RelationRow>('entity_relations')
    .where({ target_entity_id: targetId, target_type: targetType })
    .orderBy('created_at', 'desc');
  return rows.map(rowToRelation);
};

const getRelatedEntities = async (db: Knex, entityId: string): Promise<EntityKnowledge[]> => {
  const relations = await getRelationsForEntity(db, entityId);
  const entityIds = relations.filter((r) => r.targetType === 'entity').map((r) => r.targetEntityId);

  if (entityIds.length === 0) return [];

  const rows = await db<EntityRow>('entity_knowledge').whereIn('id', entityIds);
  return rows.map(rowToEntity);
};

// ============================================================================
// Exports
// ============================================================================

export {
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
  getRelationsToEntity,
  getRelatedEntities,
};
