import type { Knex } from 'knex';

import type {
  Contact,
  CreateContactInput,
  UpdateContactInput,
  ContactGroup,
  CreateContactGroupInput,
  UpdateContactGroupInput,
  RelationshipType,
  RelationshipImportance,
} from './contacts.schemas.ts';

// ============================================================================
// Row Types
// ============================================================================

type ContactRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  organization: string | null;
  role: string | null;
  relationship_type: string | null;
  relationship_context: string | null;
  relationship_importance: string;
  notes: string | null;
  communication_style: string | null;
  last_interaction_at: string | null;
  tags: string | null;
  created_at: string;
  updated_at: string;
};

type ContactGroupRow = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
};

// ============================================================================
// Converters
// ============================================================================

const now = (): string => new Date().toISOString();

const contactFromRow = (row: ContactRow): Contact => ({
  id: row.id,
  name: row.name,
  email: row.email ?? undefined,
  phone: row.phone ?? undefined,
  organization: row.organization ?? undefined,
  role: row.role ?? undefined,
  relationship: {
    type: (row.relationship_type ?? 'other') as RelationshipType,
    context: row.relationship_context ?? undefined,
    importance: (row.relationship_importance ?? 'medium') as RelationshipImportance,
  },
  notes: row.notes ?? undefined,
  communicationStyle: row.communication_style ?? undefined,
  lastInteractionAt: row.last_interaction_at ?? undefined,
  tags: row.tags ? (JSON.parse(row.tags) as string[]) : [],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const contactGroupFromRow = (row: ContactGroupRow, memberIds: string[]): ContactGroup => ({
  id: row.id,
  name: row.name,
  description: row.description ?? undefined,
  contactIds: memberIds,
  createdAt: row.created_at,
});

// ============================================================================
// Contact Operations
// ============================================================================

const getContact = async (knex: Knex, id: string): Promise<Contact | null> => {
  const row = await knex<ContactRow>('contacts').where('id', id).first();
  return row ? contactFromRow(row) : null;
};

const getContacts = async (knex: Knex): Promise<Contact[]> => {
  const rows = await knex<ContactRow>('contacts').orderBy('name');
  return rows.map(contactFromRow);
};

const findContacts = async (knex: Knex, query: string): Promise<Contact[]> => {
  const searchPattern = `%${query}%`;
  const rows = await knex<ContactRow>('contacts')
    .where('name', 'like', searchPattern)
    .orWhere('email', 'like', searchPattern)
    .orWhere('organization', 'like', searchPattern)
    .orderBy('name');
  return rows.map(contactFromRow);
};

const findByEmail = async (knex: Knex, email: string): Promise<Contact | null> => {
  const row = await knex<ContactRow>('contacts').whereRaw('LOWER(email) = LOWER(?)', [email]).first();
  return row ? contactFromRow(row) : null;
};

const findByRelationship = async (knex: Knex, type: RelationshipType): Promise<Contact[]> => {
  const rows = await knex<ContactRow>('contacts').where('relationship_type', type).orderBy('name');
  return rows.map(contactFromRow);
};

const getImportantContacts = async (knex: Knex): Promise<Contact[]> => {
  // Order by importance: critical first, then high
  // Since SQLite orders alphabetically, we need a CASE expression
  const rows = await knex<ContactRow>('contacts')
    .whereIn('relationship_importance', ['high', 'critical'])
    .orderByRaw("CASE relationship_importance WHEN 'critical' THEN 1 WHEN 'high' THEN 2 END")
    .orderBy('name');
  return rows.map(contactFromRow);
};

const createContact = async (knex: Knex, input: CreateContactInput): Promise<Contact> => {
  const timestamp = now();
  const id = crypto.randomUUID();

  const row: ContactRow = {
    id,
    name: input.name,
    email: input.email ?? null,
    phone: input.phone ?? null,
    organization: input.organization ?? null,
    role: input.role ?? null,
    relationship_type: input.relationship.type,
    relationship_context: input.relationship.context ?? null,
    relationship_importance: input.relationship.importance ?? 'medium',
    notes: input.notes ?? null,
    communication_style: input.communicationStyle ?? null,
    last_interaction_at: null,
    tags: input.tags?.length ? JSON.stringify(input.tags) : null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  await knex('contacts').insert(row);

  const result = await getContact(knex, id);
  if (!result) {
    throw new Error('Failed to create contact');
  }
  return result;
};

const updateContact = async (knex: Knex, id: string, updates: UpdateContactInput): Promise<Contact> => {
  const existing = await getContact(knex, id);
  if (!existing) {
    throw new Error('Contact not found');
  }

  const updateData: Partial<ContactRow> = {
    updated_at: now(),
  };

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.email !== undefined) updateData.email = updates.email ?? null;
  if (updates.phone !== undefined) updateData.phone = updates.phone ?? null;
  if (updates.organization !== undefined) updateData.organization = updates.organization ?? null;
  if (updates.role !== undefined) updateData.role = updates.role ?? null;
  if (updates.relationship !== undefined) {
    updateData.relationship_type = updates.relationship.type;
    updateData.relationship_context = updates.relationship.context ?? null;
    updateData.relationship_importance = updates.relationship.importance ?? 'medium';
  }
  if (updates.notes !== undefined) updateData.notes = updates.notes ?? null;
  if (updates.communicationStyle !== undefined) {
    updateData.communication_style = updates.communicationStyle ?? null;
  }
  if (updates.tags !== undefined) {
    updateData.tags = updates.tags.length ? JSON.stringify(updates.tags) : null;
  }

  await knex('contacts').where('id', id).update(updateData);

  const result = await getContact(knex, id);
  if (!result) {
    throw new Error('Failed to update contact');
  }
  return result;
};

const deleteContact = async (knex: Knex, id: string): Promise<void> => {
  await knex('contact_group_members').where('contact_id', id).delete();
  await knex('project_contacts').where('contact_id', id).delete();
  await knex('contacts').where('id', id).delete();
};

const recordInteraction = async (knex: Knex, contactId: string, summary: string): Promise<void> => {
  void summary; // Will be used in future interactions table
  // For now, just update last interaction timestamp
  await knex('contacts').where('id', contactId).update({
    last_interaction_at: now(),
    updated_at: now(),
  });
};

// ============================================================================
// Contact Group Operations
// ============================================================================

const getGroup = async (knex: Knex, id: string): Promise<ContactGroup | null> => {
  const row = await knex<ContactGroupRow>('contact_groups').where('id', id).first();
  if (!row) return null;

  const members = await knex('contact_group_members').where('group_id', id).select('contact_id');
  const memberIds = members.map((m) => m.contact_id as string);

  return contactGroupFromRow(row, memberIds);
};

const getGroups = async (knex: Knex): Promise<ContactGroup[]> => {
  const rows = await knex<ContactGroupRow>('contact_groups').orderBy('name');

  const groupIds = rows.map((r) => r.id);
  const allMembers = await knex('contact_group_members').whereIn('group_id', groupIds).select('group_id', 'contact_id');

  const membersByGroup = new Map<string, string[]>();
  for (const member of allMembers) {
    const groupId = member.group_id as string;
    const existing = membersByGroup.get(groupId) ?? [];
    existing.push(member.contact_id as string);
    membersByGroup.set(groupId, existing);
  }

  return rows.map((row) => contactGroupFromRow(row, membersByGroup.get(row.id) ?? []));
};

const getGroupMembers = async (knex: Knex, groupId: string): Promise<Contact[]> => {
  const memberIds = await knex('contact_group_members').where('group_id', groupId).select('contact_id');

  if (memberIds.length === 0) return [];

  const rows = await knex<ContactRow>('contacts')
    .whereIn(
      'id',
      memberIds.map((m) => m.contact_id as string),
    )
    .orderBy('name');

  return rows.map(contactFromRow);
};

const createGroup = async (knex: Knex, input: CreateContactGroupInput): Promise<ContactGroup> => {
  const id = crypto.randomUUID();
  const timestamp = now();

  await knex('contact_groups').insert({
    id,
    name: input.name,
    description: input.description ?? null,
    created_at: timestamp,
  });

  if (input.contactIds?.length) {
    await knex('contact_group_members').insert(
      input.contactIds.map((contactId) => ({
        group_id: id,
        contact_id: contactId,
      })),
    );
  }

  const result = await getGroup(knex, id);
  if (!result) {
    throw new Error('Failed to create group');
  }
  return result;
};

const updateGroup = async (knex: Knex, id: string, updates: UpdateContactGroupInput): Promise<ContactGroup> => {
  const existing = await getGroup(knex, id);
  if (!existing) {
    throw new Error('Contact group not found');
  }

  if (updates.name !== undefined || updates.description !== undefined) {
    const updateData: Partial<ContactGroupRow> = {};
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description ?? null;
    await knex('contact_groups').where('id', id).update(updateData);
  }

  if (updates.contactIds !== undefined) {
    await knex('contact_group_members').where('group_id', id).delete();
    if (updates.contactIds.length) {
      await knex('contact_group_members').insert(
        updates.contactIds.map((contactId) => ({
          group_id: id,
          contact_id: contactId,
        })),
      );
    }
  }

  const result = await getGroup(knex, id);
  if (!result) {
    throw new Error('Failed to update group');
  }
  return result;
};

const deleteGroup = async (knex: Knex, id: string): Promise<void> => {
  await knex('contact_group_members').where('group_id', id).delete();
  await knex('contact_groups').where('id', id).delete();
};

export {
  // Contacts
  getContact,
  getContacts,
  findContacts,
  findByEmail,
  findByRelationship,
  getImportantContacts,
  createContact,
  updateContact,
  deleteContact,
  recordInteraction,
  // Groups
  getGroup,
  getGroups,
  getGroupMembers,
  createGroup,
  updateGroup,
  deleteGroup,
};
