import { z } from 'zod';

// ============================================================================
// Relationship Types
// ============================================================================

const relationshipTypeSchema = z.enum([
  'family',
  'friend',
  'colleague',
  'manager',
  'report',
  'client',
  'vendor',
  'professional',
  'other',
]);

type RelationshipType = z.infer<typeof relationshipTypeSchema>;

const relationshipImportanceSchema = z.enum(['low', 'medium', 'high', 'critical']);

type RelationshipImportance = z.infer<typeof relationshipImportanceSchema>;

const relationshipSchema = z.object({
  type: relationshipTypeSchema,
  context: z.string().optional(),
  importance: relationshipImportanceSchema.optional().default('medium'),
});

type Relationship = z.infer<typeof relationshipSchema>;
type RelationshipInput = z.input<typeof relationshipSchema>;

// ============================================================================
// Contact
// ============================================================================

const contactSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  organization: z.string().optional(),
  role: z.string().optional(),
  relationship: relationshipSchema,
  notes: z.string().optional(),
  communicationStyle: z.string().optional(),
  lastInteractionAt: z.string().datetime().optional(),
  tags: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

type Contact = z.infer<typeof contactSchema>;

/**
 * Create contact input schema.
 * Uses .optional().default() pattern to make fields optional in input while providing defaults.
 */
const createContactInputSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  organization: z.string().optional(),
  role: z.string().optional(),
  relationship: relationshipSchema,
  notes: z.string().optional(),
  communicationStyle: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
});

type CreateContactInput = z.input<typeof createContactInputSchema>;

const updateContactInputSchema = createContactInputSchema.partial();

type UpdateContactInput = z.input<typeof updateContactInputSchema>;

// ============================================================================
// Contact Group
// ============================================================================

const contactGroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  contactIds: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
});

type ContactGroup = z.infer<typeof contactGroupSchema>;

/**
 * Create contact group input schema.
 * Uses .optional().default() pattern to make fields optional in input while providing defaults.
 */
const createContactGroupInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  contactIds: z.array(z.string()).optional().default([]),
});

type CreateContactGroupInput = z.input<typeof createContactGroupInputSchema>;

const updateContactGroupInputSchema = createContactGroupInputSchema.partial();

type UpdateContactGroupInput = z.input<typeof updateContactGroupInputSchema>;

export type {
  RelationshipType,
  RelationshipImportance,
  Relationship,
  RelationshipInput,
  Contact,
  CreateContactInput,
  UpdateContactInput,
  ContactGroup,
  CreateContactGroupInput,
  UpdateContactGroupInput,
};

export {
  relationshipTypeSchema,
  relationshipImportanceSchema,
  relationshipSchema,
  contactSchema,
  createContactInputSchema,
  updateContactInputSchema,
  contactGroupSchema,
  createContactGroupInputSchema,
  updateContactGroupInputSchema,
};
