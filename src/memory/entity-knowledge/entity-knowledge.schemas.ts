import { z } from 'zod';

// ============================================================================
// Entity Type
// ============================================================================

const entityTypeSchema = z.enum([
  'company', // Organizations you interact with
  'project', // Work initiatives (beyond your own projects)
  'document', // Reports, contracts, templates
  'product', // Physical or digital products
  'concept', // Ideas, frameworks, processes
  'place', // Named places (beyond saved locations)
  'other',
]);

type EntityType = z.infer<typeof entityTypeSchema>;

// ============================================================================
// Entity Relation
// ============================================================================

const entityRelationSchema = z.object({
  id: z.string(),
  sourceEntityId: z.string(),
  targetEntityId: z.string(),
  targetType: z.enum(['entity', 'contact', 'project']),
  relationshipType: z.string(), // 'has_contact', 'belongs_to', 'uses_template', etc.
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string(),
});

type EntityRelation = z.infer<typeof entityRelationSchema>;

// ============================================================================
// Entity Knowledge
// ============================================================================

const entityKnowledgeSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: entityTypeSchema,
  description: z.string().optional(),

  // Flexible attributes based on entity type
  attributes: z.record(z.string(), z.unknown()).default({}),

  // Provenance
  source: z.enum(['explicit', 'inferred']),
  confidence: z.number().min(0).max(1),

  // Timestamps and usage tracking
  createdAt: z.string(),
  updatedAt: z.string(),
  lastReferencedAt: z.string(),
  referenceCount: z.number(),
});

type EntityKnowledge = z.infer<typeof entityKnowledgeSchema>;

// ============================================================================
// Create Entity Input
// ============================================================================

const createEntityInputSchema = z.object({
  name: z.string().min(1),
  type: entityTypeSchema,
  description: z.string().optional(),
  attributes: z.record(z.string(), z.unknown()).optional().default({}),
  source: z.enum(['explicit', 'inferred']).optional().default('explicit'),
  confidence: z.number().min(0).max(1).optional().default(1.0),
});

type CreateEntityInput = z.input<typeof createEntityInputSchema>;

// ============================================================================
// Update Entity Input
// ============================================================================

const updateEntityInputSchema = z.object({
  name: z.string().min(1).optional(),
  type: entityTypeSchema.optional(),
  description: z.string().optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

type UpdateEntityInput = z.infer<typeof updateEntityInputSchema>;

// ============================================================================
// Create Relation Input
// ============================================================================

const createRelationInputSchema = z.object({
  sourceEntityId: z.string(),
  targetEntityId: z.string(),
  targetType: z.enum(['entity', 'contact', 'project']),
  relationshipType: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

type CreateRelationInput = z.input<typeof createRelationInputSchema>;

// ============================================================================
// Database Rows
// ============================================================================

const entityRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  description: z.string().nullable(),
  attributes: z.string().nullable(), // JSON
  source: z.string(),
  confidence: z.number(),
  last_referenced_at: z.string(),
  reference_count: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

type EntityRow = z.infer<typeof entityRowSchema>;

const relationRowSchema = z.object({
  id: z.string(),
  source_entity_id: z.string(),
  target_entity_id: z.string(),
  target_type: z.string(),
  relationship_type: z.string(),
  metadata: z.string().nullable(), // JSON
  created_at: z.string(),
});

type RelationRow = z.infer<typeof relationRowSchema>;

// ============================================================================
// Exports
// ============================================================================

export type {
  EntityType,
  EntityRelation,
  EntityKnowledge,
  CreateEntityInput,
  UpdateEntityInput,
  CreateRelationInput,
  EntityRow,
  RelationRow,
};

export {
  entityTypeSchema,
  entityRelationSchema,
  entityKnowledgeSchema,
  createEntityInputSchema,
  updateEntityInputSchema,
  createRelationInputSchema,
  entityRowSchema,
  relationRowSchema,
};
