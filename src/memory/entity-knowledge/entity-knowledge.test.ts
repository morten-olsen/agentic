import { describe, it, beforeEach, afterEach, expect } from 'vitest';

import { Services } from '../../services/services.ts';
import { DatabaseService, createDatabaseService } from '../../database/database.ts';

import { EntityKnowledgeService, EntityNotFoundError } from './entity-knowledge.ts';

// ============================================================================
// Test Setup
// ============================================================================

const createTestServices = async (): Promise<Services> => {
  const services = new Services();
  const db = createDatabaseService(services, { path: ':memory:' });
  services.set(DatabaseService, db);
  await db.migrate();
  return services;
};

// ============================================================================
// Tests
// ============================================================================

describe('EntityKnowledgeService', () => {
  let services: Services;
  let entityService: EntityKnowledgeService;

  beforeEach(async () => {
    services = await createTestServices();
    entityService = new EntityKnowledgeService(services);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('create', () => {
    it('creates an entity with required fields', async () => {
      const entity = await entityService.create({
        name: 'Acme Corp',
        type: 'company',
      });

      expect(entity.id).toBeDefined();
      expect(entity.name).toBe('Acme Corp');
      expect(entity.type).toBe('company');
      expect(entity.source).toBe('explicit');
      expect(entity.confidence).toBe(1.0);
      expect(entity.referenceCount).toBe(0);
    });

    it('creates an entity with all fields', async () => {
      const entity = await entityService.create({
        name: 'Q4 Report',
        type: 'document',
        description: 'Quarterly financial report',
        attributes: { format: 'pdf', size: 2500000 },
        source: 'inferred',
        confidence: 0.8,
      });

      expect(entity.name).toBe('Q4 Report');
      expect(entity.type).toBe('document');
      expect(entity.description).toBe('Quarterly financial report');
      expect(entity.attributes).toEqual({ format: 'pdf', size: 2500000 });
      expect(entity.source).toBe('inferred');
      expect(entity.confidence).toBe(0.8);
    });
  });

  describe('get', () => {
    it('returns null for non-existent entity', async () => {
      const entity = await entityService.get('non-existent');
      expect(entity).toBeNull();
    });

    it('retrieves an existing entity', async () => {
      const created = await entityService.create({
        name: 'Test Entity',
        type: 'concept',
      });

      const retrieved = await entityService.get(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('Test Entity');
    });
  });

  describe('update', () => {
    it('updates entity fields', async () => {
      const entity = await entityService.create({
        name: 'Original Name',
        type: 'company',
      });

      const updated = await entityService.update(entity.id, {
        name: 'Updated Name',
        description: 'New description',
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.description).toBe('New description');
      expect(updated.type).toBe('company');
    });

    it('throws EntityNotFoundError for non-existent entity', async () => {
      await expect(entityService.update('non-existent', { name: 'Test' })).rejects.toThrow(EntityNotFoundError);
    });
  });

  describe('delete', () => {
    it('deletes an existing entity', async () => {
      const entity = await entityService.create({
        name: 'To Delete',
        type: 'concept',
      });

      const deleted = await entityService.delete(entity.id);
      expect(deleted).toBe(true);

      const retrieved = await entityService.get(entity.id);
      expect(retrieved).toBeNull();
    });

    it('returns false for non-existent entity', async () => {
      const deleted = await entityService.delete('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('findByName', () => {
    it('finds entities by partial name match', async () => {
      await entityService.create({ name: 'Acme Corporation', type: 'company' });
      await entityService.create({ name: 'Acme Products', type: 'company' });
      await entityService.create({ name: 'Other Corp', type: 'company' });

      const results = await entityService.findByName('Acme');
      expect(results).toHaveLength(2);
      expect(results.map((e) => e.name)).toContain('Acme Corporation');
      expect(results.map((e) => e.name)).toContain('Acme Products');
    });
  });

  describe('findByType', () => {
    it('finds entities by type', async () => {
      await entityService.create({ name: 'Company A', type: 'company' });
      await entityService.create({ name: 'Company B', type: 'company' });
      await entityService.create({ name: 'Document A', type: 'document' });

      const companies = await entityService.findByType('company');
      expect(companies).toHaveLength(2);
      expect(companies.every((e) => e.type === 'company')).toBe(true);
    });
  });

  describe('recordReference', () => {
    it('increments reference count and updates timestamp', async () => {
      const entity = await entityService.create({
        name: 'Referenced Entity',
        type: 'concept',
      });

      const originalTimestamp = entity.lastReferencedAt;

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      await entityService.recordReference(entity.id);

      const updated = await entityService.get(entity.id);
      expect(updated?.referenceCount).toBe(1);
      expect(updated?.lastReferencedAt).not.toBe(originalTimestamp);
    });
  });

  describe('relations', () => {
    it('creates a relation between entities', async () => {
      const entity1 = await entityService.create({ name: 'Company', type: 'company' });
      const entity2 = await entityService.create({ name: 'Product', type: 'product' });

      const relation = await entityService.addRelation({
        sourceEntityId: entity1.id,
        targetEntityId: entity2.id,
        targetType: 'entity',
        relationshipType: 'makes',
      });

      expect(relation.id).toBeDefined();
      expect(relation.sourceEntityId).toBe(entity1.id);
      expect(relation.targetEntityId).toBe(entity2.id);
      expect(relation.relationshipType).toBe('makes');
    });

    it('throws EntityNotFoundError when source entity does not exist', async () => {
      const entity = await entityService.create({ name: 'Target', type: 'concept' });

      await expect(
        entityService.addRelation({
          sourceEntityId: 'non-existent',
          targetEntityId: entity.id,
          targetType: 'entity',
          relationshipType: 'related_to',
        }),
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('gets relations from an entity', async () => {
      const company = await entityService.create({ name: 'Company', type: 'company' });
      const product1 = await entityService.create({ name: 'Product 1', type: 'product' });
      const product2 = await entityService.create({ name: 'Product 2', type: 'product' });

      await entityService.addRelation({
        sourceEntityId: company.id,
        targetEntityId: product1.id,
        targetType: 'entity',
        relationshipType: 'makes',
      });
      await entityService.addRelation({
        sourceEntityId: company.id,
        targetEntityId: product2.id,
        targetType: 'entity',
        relationshipType: 'makes',
      });

      const relations = await entityService.getRelationsFrom(company.id);
      expect(relations).toHaveLength(2);
    });

    it('gets related entities', async () => {
      const company = await entityService.create({ name: 'Company', type: 'company' });
      const product1 = await entityService.create({ name: 'Product 1', type: 'product' });
      const product2 = await entityService.create({ name: 'Product 2', type: 'product' });

      await entityService.addRelation({
        sourceEntityId: company.id,
        targetEntityId: product1.id,
        targetType: 'entity',
        relationshipType: 'makes',
      });
      await entityService.addRelation({
        sourceEntityId: company.id,
        targetEntityId: product2.id,
        targetType: 'entity',
        relationshipType: 'makes',
      });

      const related = await entityService.getRelatedEntities(company.id);
      expect(related).toHaveLength(2);
      expect(related.map((e) => e.name)).toContain('Product 1');
      expect(related.map((e) => e.name)).toContain('Product 2');
    });

    it('removes a relation', async () => {
      const entity1 = await entityService.create({ name: 'Entity 1', type: 'concept' });
      const entity2 = await entityService.create({ name: 'Entity 2', type: 'concept' });

      const relation = await entityService.addRelation({
        sourceEntityId: entity1.id,
        targetEntityId: entity2.id,
        targetType: 'entity',
        relationshipType: 'related_to',
      });

      const removed = await entityService.removeRelation(relation.id);
      expect(removed).toBe(true);

      const retrieved = await entityService.getRelation(relation.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('getRecent', () => {
    it('returns recently referenced entities', async () => {
      // Create two entities - entity1 exists but is not referenced
      await entityService.create({ name: 'Entity 1', type: 'concept' });
      const entity2 = await entityService.create({ name: 'Entity 2', type: 'concept' });

      // Reference entity2 more recently
      await new Promise((resolve) => setTimeout(resolve, 10));
      await entityService.recordReference(entity2.id);

      const recent = await entityService.getRecent(10);
      expect(recent[0].id).toBe(entity2.id);
    });
  });
});
