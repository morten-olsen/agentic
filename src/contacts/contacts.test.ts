import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { Services } from '../services/services.ts';
import { createDatabaseService, DatabaseService } from '../database/database.ts';

import { ContactsService } from './contacts.ts';

describe('ContactsService', () => {
  let services: Services;
  let contacts: ContactsService;

  beforeEach(async () => {
    services = new Services();
    const db = createDatabaseService(services, { path: ':memory:' });
    services.set(DatabaseService, db);
    await db.migrate();
    contacts = services.get(ContactsService);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('Contact CRUD', () => {
    it('creates a contact', async () => {
      const contact = await contacts.createContact({
        name: 'Alice Smith',
        email: 'alice@example.com',
        relationship: { type: 'colleague', importance: 'high' },
      });

      expect(contact.id).toBeDefined();
      expect(contact.name).toBe('Alice Smith');
      expect(contact.email).toBe('alice@example.com');
      expect(contact.relationship.type).toBe('colleague');
      expect(contact.relationship.importance).toBe('high');
    });

    it('creates a contact with all fields', async () => {
      const contact = await contacts.createContact({
        name: 'Bob Jones',
        email: 'bob@example.com',
        phone: '+1-555-123-4567',
        organization: 'Acme Corp',
        role: 'CEO',
        relationship: {
          type: 'client',
          context: 'Met at conference',
          importance: 'critical',
        },
        notes: 'Prefers morning calls',
        communicationStyle: 'Formal',
        tags: ['vip', 'conference'],
      });

      expect(contact.phone).toBe('+1-555-123-4567');
      expect(contact.organization).toBe('Acme Corp');
      expect(contact.role).toBe('CEO');
      expect(contact.relationship.context).toBe('Met at conference');
      expect(contact.notes).toBe('Prefers morning calls');
      expect(contact.tags).toContain('vip');
    });

    it('gets a contact by ID', async () => {
      const created = await contacts.createContact({
        name: 'Test',
        relationship: { type: 'friend' },
      });

      const retrieved = await contacts.getContact(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('Test');
    });

    it('returns null for non-existent contact', async () => {
      const result = await contacts.getContact('non-existent-id');
      expect(result).toBeNull();
    });

    it('gets all contacts', async () => {
      await contacts.createContact({ name: 'Alice', relationship: { type: 'friend' } });
      await contacts.createContact({ name: 'Bob', relationship: { type: 'colleague' } });

      const all = await contacts.getContacts();

      expect(all).toHaveLength(2);
    });

    it('updates a contact', async () => {
      const contact = await contacts.createContact({
        name: 'Original',
        relationship: { type: 'friend' },
      });

      const updated = await contacts.updateContact(contact.id, {
        name: 'Updated',
        email: 'new@example.com',
      });

      expect(updated.name).toBe('Updated');
      expect(updated.email).toBe('new@example.com');
    });

    it('updates relationship', async () => {
      const contact = await contacts.createContact({
        name: 'Test',
        relationship: { type: 'friend', importance: 'low' },
      });

      const updated = await contacts.updateContact(contact.id, {
        relationship: { type: 'colleague', importance: 'high' },
      });

      expect(updated.relationship.type).toBe('colleague');
      expect(updated.relationship.importance).toBe('high');
    });

    it('deletes a contact', async () => {
      const contact = await contacts.createContact({
        name: 'To Delete',
        relationship: { type: 'other' },
      });

      await contacts.deleteContact(contact.id);

      const result = await contacts.getContact(contact.id);
      expect(result).toBeNull();
    });
  });

  describe('Contact Search', () => {
    beforeEach(async () => {
      await contacts.createContact({
        name: 'Alice Smith',
        email: 'alice@example.com',
        organization: 'Tech Corp',
        relationship: { type: 'colleague' },
      });
      await contacts.createContact({
        name: 'Bob Jones',
        email: 'bob@other.com',
        organization: 'Acme Inc',
        relationship: { type: 'client' },
      });
      await contacts.createContact({
        name: 'Charlie Brown',
        email: 'charlie@tech.com',
        organization: 'Tech Corp',
        relationship: { type: 'friend' },
      });
    });

    it('finds contacts by name', async () => {
      const results = await contacts.findContacts('Alice');

      expect(results).toHaveLength(1);
      expect(results[0]?.name).toBe('Alice Smith');
    });

    it('finds contacts by email', async () => {
      const results = await contacts.findContacts('bob@');

      expect(results).toHaveLength(1);
      expect(results[0]?.name).toBe('Bob Jones');
    });

    it('finds contacts by organization', async () => {
      const results = await contacts.findContacts('Tech Corp');

      expect(results).toHaveLength(2);
    });

    it('finds contact by exact email', async () => {
      const result = await contacts.findByEmail('alice@example.com');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('Alice Smith');
    });

    it('findByEmail is case insensitive', async () => {
      const result = await contacts.findByEmail('ALICE@EXAMPLE.COM');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('Alice Smith');
    });

    it('returns null for unknown email', async () => {
      const result = await contacts.findByEmail('unknown@example.com');
      expect(result).toBeNull();
    });

    it('finds contacts by relationship type', async () => {
      const colleagues = await contacts.findByRelationship('colleague');

      expect(colleagues).toHaveLength(1);
      expect(colleagues[0]?.name).toBe('Alice Smith');
    });
  });

  describe('Important Contacts', () => {
    beforeEach(async () => {
      await contacts.createContact({
        name: 'Low Priority',
        relationship: { type: 'other', importance: 'low' },
      });
      await contacts.createContact({
        name: 'High Priority',
        relationship: { type: 'colleague', importance: 'high' },
      });
      await contacts.createContact({
        name: 'Critical',
        relationship: { type: 'family', importance: 'critical' },
      });
      await contacts.createContact({
        name: 'Medium',
        relationship: { type: 'friend', importance: 'medium' },
      });
    });

    it('returns only high and critical importance contacts', async () => {
      const important = await contacts.getImportantContacts();

      expect(important).toHaveLength(2);
      const names = important.map((c) => c.name);
      expect(names).toContain('High Priority');
      expect(names).toContain('Critical');
    });

    it('orders critical before high', async () => {
      const important = await contacts.getImportantContacts();

      expect(important[0]?.name).toBe('Critical');
    });
  });

  describe('Record Interaction', () => {
    it('updates last interaction timestamp', async () => {
      const contact = await contacts.createContact({
        name: 'Test',
        relationship: { type: 'friend' },
      });

      expect(contact.lastInteractionAt).toBeUndefined();

      await contacts.recordInteraction(contact.id, 'Had a call');

      const updated = await contacts.getContact(contact.id);
      expect(updated?.lastInteractionAt).toBeDefined();
    });
  });

  describe('Contact Groups', () => {
    let alice: Awaited<ReturnType<typeof contacts.createContact>>;
    let bob: Awaited<ReturnType<typeof contacts.createContact>>;

    beforeEach(async () => {
      alice = await contacts.createContact({
        name: 'Alice',
        relationship: { type: 'colleague' },
      });
      bob = await contacts.createContact({
        name: 'Bob',
        relationship: { type: 'colleague' },
      });
    });

    it('creates a group', async () => {
      const group = await contacts.createGroup({
        name: 'Team',
        description: 'My team members',
      });

      expect(group.id).toBeDefined();
      expect(group.name).toBe('Team');
      expect(group.description).toBe('My team members');
      expect(group.contactIds).toHaveLength(0);
    });

    it('creates a group with members', async () => {
      const group = await contacts.createGroup({
        name: 'Team',
        contactIds: [alice.id, bob.id],
      });

      expect(group.contactIds).toHaveLength(2);
      expect(group.contactIds).toContain(alice.id);
      expect(group.contactIds).toContain(bob.id);
    });

    it('gets group members', async () => {
      const group = await contacts.createGroup({
        name: 'Team',
        contactIds: [alice.id, bob.id],
      });

      const members = await contacts.getGroupMembers(group.id);

      expect(members).toHaveLength(2);
      const names = members.map((c) => c.name);
      expect(names).toContain('Alice');
      expect(names).toContain('Bob');
    });

    it('gets all groups', async () => {
      await contacts.createGroup({ name: 'Group 1' });
      await contacts.createGroup({ name: 'Group 2' });

      const groups = await contacts.getGroups();

      expect(groups).toHaveLength(2);
    });

    it('updates a group', async () => {
      const group = await contacts.createGroup({
        name: 'Original',
        contactIds: [alice.id],
      });

      const updated = await contacts.updateGroup(group.id, {
        name: 'Updated',
        contactIds: [bob.id],
      });

      expect(updated.name).toBe('Updated');
      expect(updated.contactIds).toHaveLength(1);
      expect(updated.contactIds[0]).toBe(bob.id);
    });

    it('deletes a group', async () => {
      const group = await contacts.createGroup({
        name: 'To Delete',
        contactIds: [alice.id],
      });

      await contacts.deleteGroup(group.id);

      const result = await contacts.getGroup(group.id);
      expect(result).toBeNull();

      // Contact should still exist
      const aliceStillExists = await contacts.getContact(alice.id);
      expect(aliceStillExists).not.toBeNull();
    });

    it('deleting a contact removes them from groups', async () => {
      const group = await contacts.createGroup({
        name: 'Team',
        contactIds: [alice.id, bob.id],
      });

      await contacts.deleteContact(alice.id);

      const updatedGroup = await contacts.getGroup(group.id);
      expect(updatedGroup?.contactIds).toHaveLength(1);
      expect(updatedGroup?.contactIds[0]).toBe(bob.id);
    });
  });
});
