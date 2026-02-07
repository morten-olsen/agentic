import { z } from 'zod';

import type { ToolDefinition, ToolContext, ToolRegistry } from '../tools.ts';
import { ContactsService } from '../../../domain/contacts/contacts.ts';
import {
  relationshipTypeSchema,
  relationshipImportanceSchema,
  relationshipSchema,
  contactSchema,
} from '../../../domain/contacts/contacts.schemas.ts';

// ============================================================================
// Utilities
// ============================================================================

/** Converts null to undefined for service boundary compatibility */
const nullToUndefined = <T>(value: T | null | undefined): T | undefined => (value === null ? undefined : value);

// ============================================================================
// Search Contacts
// ============================================================================

const searchContactsInputSchema = z.object({
  query: z.string().min(1).describe('Search term to match against name, email, or organization'),
});

const searchContactsOutputSchema = z.object({
  contacts: z.array(contactSchema),
  count: z.number(),
});

type SearchContactsInput = z.infer<typeof searchContactsInputSchema>;
type SearchContactsOutput = z.infer<typeof searchContactsOutputSchema>;

const searchContactsTool: ToolDefinition<SearchContactsInput, SearchContactsOutput> = {
  id: 'contacts.search',
  name: 'SearchContacts',
  description: 'Search for contacts by name, email, or organization.',
  category: 'contacts',
  inputSchema: searchContactsInputSchema,
  outputSchema: searchContactsOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['contacts', 'search', 'read'],
  examples: [
    { input: { query: 'John' }, description: 'Find contacts named John' },
    { input: { query: 'acme.com' }, description: 'Find contacts at Acme' },
  ],
  execute: async (input: SearchContactsInput, context: ToolContext): Promise<SearchContactsOutput> => {
    const contacts = context.services.get(ContactsService);
    const results = await contacts.findContacts(input.query);
    return { contacts: results, count: results.length };
  },
};

// ============================================================================
// List Contacts
// ============================================================================

const listContactsInputSchema = z.object({
  relationshipType: relationshipTypeSchema.nullish().describe('Filter by relationship type'),
  importantOnly: z.boolean().nullish().describe('Only return high/critical importance contacts'),
});

const listContactsOutputSchema = z.object({
  contacts: z.array(contactSchema),
  count: z.number(),
});

type ListContactsInput = z.infer<typeof listContactsInputSchema>;
type ListContactsOutput = z.infer<typeof listContactsOutputSchema>;

const listContactsTool: ToolDefinition<ListContactsInput, ListContactsOutput> = {
  id: 'contacts.list',
  name: 'ListContacts',
  description: 'List contacts with optional filtering by relationship type or importance.',
  category: 'contacts',
  inputSchema: listContactsInputSchema,
  outputSchema: listContactsOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['contacts', 'list', 'read'],
  examples: [
    { input: {}, description: 'List all contacts' },
    { input: { relationshipType: 'colleague' }, description: 'List colleagues' },
    { input: { importantOnly: true }, description: 'List important contacts' },
  ],
  execute: async (input: ListContactsInput, context: ToolContext): Promise<ListContactsOutput> => {
    const contactsService = context.services.get(ContactsService);

    let results;
    if (input.importantOnly) {
      results = await contactsService.getImportantContacts();
    } else if (input.relationshipType) {
      results = await contactsService.findByRelationship(input.relationshipType);
    } else {
      results = await contactsService.getContacts();
    }

    return { contacts: results, count: results.length };
  },
};

// ============================================================================
// Get Contact
// ============================================================================

const getContactInputSchema = z.object({
  id: z.string().nullish().describe('Contact ID'),
  email: z.string().email().nullish().describe('Contact email'),
});

const getContactOutputSchema = z.object({
  contact: contactSchema.nullable(),
  found: z.boolean(),
});

type GetContactInput = z.infer<typeof getContactInputSchema>;
type GetContactOutput = z.infer<typeof getContactOutputSchema>;

const getContactTool: ToolDefinition<GetContactInput, GetContactOutput> = {
  id: 'contacts.get',
  name: 'GetContact',
  description: 'Get a specific contact by ID or email.',
  category: 'contacts',
  inputSchema: getContactInputSchema,
  outputSchema: getContactOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['contacts', 'read'],
  examples: [
    { input: { id: '123' }, description: 'Get contact by ID' },
    { input: { email: 'john@example.com' }, description: 'Get contact by email' },
  ],
  execute: async (input: GetContactInput, context: ToolContext): Promise<GetContactOutput> => {
    const contactsService = context.services.get(ContactsService);

    let contact = null;
    if (input.id) {
      contact = await contactsService.getContact(input.id);
    } else if (input.email) {
      contact = await contactsService.findByEmail(input.email);
    }

    return { contact, found: contact !== null };
  },
};

// ============================================================================
// Create Contact
// ============================================================================

const createContactInputSchema = z.object({
  name: z.string().min(1).describe('Contact name'),
  email: z.string().email().nullish().describe('Email address'),
  phone: z.string().nullish().describe('Phone number'),
  organization: z.string().nullish().describe('Company/organization'),
  role: z.string().nullish().describe("Contact's role/title"),
  relationship: z
    .object({
      type: relationshipTypeSchema.describe('Type of relationship'),
      context: z.string().nullish().describe('Context for the relationship'),
      importance: relationshipImportanceSchema.nullish().describe('How important is this contact'),
    })
    .describe('Relationship information'),
  notes: z.string().nullish().describe('Notes about the contact'),
  tags: z.array(z.string()).nullish().describe('Tags for categorization'),
});

const createContactOutputSchema = contactSchema;

type CreateContactInput = z.infer<typeof createContactInputSchema>;
type CreateContactOutput = z.infer<typeof createContactOutputSchema>;

const createContactTool: ToolDefinition<CreateContactInput, CreateContactOutput> = {
  id: 'contacts.create',
  name: 'CreateContact',
  description: 'Create a new contact.',
  category: 'contacts',
  inputSchema: createContactInputSchema,
  outputSchema: createContactOutputSchema,
  risk: {
    level: 'low',
    reason: 'Creates a new record, easily reversible',
    potentialImpact: 'Adds a new contact entry',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['contacts', 'write'],
  examples: [
    {
      input: {
        name: 'John Doe',
        email: 'john@example.com',
        relationship: { type: 'colleague', importance: 'medium' },
      },
      description: 'Create a colleague contact',
    },
  ],
  execute: async (input: CreateContactInput, context: ToolContext): Promise<CreateContactOutput> => {
    const contactsService = context.services.get(ContactsService);
    return contactsService.createContact({
      name: input.name,
      email: nullToUndefined(input.email),
      phone: nullToUndefined(input.phone),
      organization: nullToUndefined(input.organization),
      role: nullToUndefined(input.role),
      relationship: {
        type: input.relationship.type,
        context: nullToUndefined(input.relationship.context),
        importance: nullToUndefined(input.relationship.importance),
      },
      notes: nullToUndefined(input.notes),
      tags: nullToUndefined(input.tags),
    });
  },
};

// ============================================================================
// Update Contact
// ============================================================================

const updateContactInputSchema = z.object({
  id: z.string().describe('Contact ID to update'),
  name: z.string().nullish().describe('New name'),
  email: z.string().email().nullish().describe('New email'),
  phone: z.string().nullish().describe('New phone'),
  organization: z.string().nullish().describe('New organization'),
  role: z.string().nullish().describe('New role'),
  relationship: relationshipSchema.nullish().describe('Updated relationship info'),
  notes: z.string().nullish().describe('Updated notes'),
  tags: z.array(z.string()).nullish().describe('Updated tags'),
});

const updateContactOutputSchema = contactSchema;

type UpdateContactInput = z.infer<typeof updateContactInputSchema>;
type UpdateContactOutput = z.infer<typeof updateContactOutputSchema>;

const updateContactTool: ToolDefinition<UpdateContactInput, UpdateContactOutput> = {
  id: 'contacts.update',
  name: 'UpdateContact',
  description: 'Update an existing contact.',
  category: 'contacts',
  inputSchema: updateContactInputSchema,
  outputSchema: updateContactOutputSchema,
  risk: {
    level: 'low',
    reason: 'Modifies existing record',
    potentialImpact: 'Modifies contact data',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['contacts', 'write'],
  examples: [{ input: { id: '123', role: 'Senior Engineer' }, description: 'Update contact role' }],
  execute: async (input: UpdateContactInput, context: ToolContext): Promise<UpdateContactOutput> => {
    const contactsService = context.services.get(ContactsService);
    return contactsService.updateContact(input.id, {
      name: nullToUndefined(input.name),
      email: nullToUndefined(input.email),
      phone: nullToUndefined(input.phone),
      organization: nullToUndefined(input.organization),
      role: nullToUndefined(input.role),
      relationship: nullToUndefined(input.relationship),
      notes: nullToUndefined(input.notes),
      tags: nullToUndefined(input.tags),
    });
  },
};

// ============================================================================
// Delete Contact
// ============================================================================

const deleteContactInputSchema = z.object({
  id: z.string().describe('Contact ID to delete'),
});

const deleteContactOutputSchema = z.object({
  success: z.boolean(),
  deletedId: z.string(),
});

type DeleteContactInput = z.infer<typeof deleteContactInputSchema>;
type DeleteContactOutput = z.infer<typeof deleteContactOutputSchema>;

const deleteContactTool: ToolDefinition<DeleteContactInput, DeleteContactOutput> = {
  id: 'contacts.delete',
  name: 'DeleteContact',
  description: 'Delete a contact. This action is irreversible.',
  category: 'contacts',
  inputSchema: deleteContactInputSchema,
  outputSchema: deleteContactOutputSchema,
  risk: {
    level: 'medium',
    reason: 'Permanently deletes data',
    potentialImpact: 'Contact data will be lost',
    reversible: false,
    categories: ['data_modification'],
  },
  tags: ['contacts', 'write', 'destructive'],
  examples: [{ input: { id: '123' }, description: 'Delete a contact' }],
  execute: async (input: DeleteContactInput, context: ToolContext): Promise<DeleteContactOutput> => {
    const contactsService = context.services.get(ContactsService);
    await contactsService.deleteContact(input.id);
    return { success: true, deletedId: input.id };
  },
};

// ============================================================================
// Record Interaction
// ============================================================================

const recordInteractionInputSchema = z.object({
  contactId: z.string().describe('Contact ID'),
  summary: z.string().describe('Summary of the interaction'),
});

const recordInteractionOutputSchema = z.object({
  success: z.boolean(),
  contactId: z.string(),
});

type RecordInteractionInput = z.infer<typeof recordInteractionInputSchema>;
type RecordInteractionOutput = z.infer<typeof recordInteractionOutputSchema>;

const recordInteractionTool: ToolDefinition<RecordInteractionInput, RecordInteractionOutput> = {
  id: 'contacts.record_interaction',
  name: 'RecordInteraction',
  description: 'Record an interaction with a contact. Updates the last interaction timestamp.',
  category: 'contacts',
  inputSchema: recordInteractionInputSchema,
  outputSchema: recordInteractionOutputSchema,
  risk: {
    level: 'low',
    reason: 'Adds interaction record',
    potentialImpact: 'Updates contact metadata',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['contacts', 'write', 'interaction'],
  examples: [{ input: { contactId: '123', summary: 'Had lunch meeting' }, description: 'Record a meeting' }],
  execute: async (input: RecordInteractionInput, context: ToolContext): Promise<RecordInteractionOutput> => {
    const contactsService = context.services.get(ContactsService);
    await contactsService.recordInteraction(input.contactId, input.summary);
    return { success: true, contactId: input.contactId };
  },
};

// ============================================================================
// Registration
// ============================================================================

const registerContactsTools = (registry: ToolRegistry): void => {
  registry.register(searchContactsTool);
  registry.register(listContactsTool);
  registry.register(getContactTool);
  registry.register(createContactTool);
  registry.register(updateContactTool);
  registry.register(deleteContactTool);
  registry.register(recordInteractionTool);
};

export {
  searchContactsTool,
  listContactsTool,
  getContactTool,
  createContactTool,
  updateContactTool,
  deleteContactTool,
  recordInteractionTool,
  registerContactsTools,
};
