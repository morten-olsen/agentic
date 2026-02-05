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
// Exports
// ============================================================================

export type { EntityType, EntityKnowledge, CreateEntityInput, UpdateEntityInput };

export { entityTypeSchema, entityKnowledgeSchema, createEntityInputSchema, updateEntityInputSchema };
