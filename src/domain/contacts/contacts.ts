import type { Services } from '../../core/services/services.ts';
import { DatabaseService } from '../../core/database/database.ts';

import type {
  Contact,
  CreateContactInput,
  UpdateContactInput,
  ContactGroup,
  CreateContactGroupInput,
  UpdateContactGroupInput,
  RelationshipType,
} from './contacts.schemas.ts';
import * as store from './contacts.store.ts';

/**
 * Contacts Service - manages contacts and relationships.
 *
 * Provides first-class support for people and relationships.
 * The agent needs to understand *who* is involved in the user's life.
 */
class ContactsService {
  #services: Services;

  constructor(services: Services) {
    this.#services = services;
  }

  // ==========================================================================
  // Contact CRUD
  // ==========================================================================

  /**
   * Gets a contact by ID.
   */
  getContact = async (id: string): Promise<Contact | null> => {
    const db = this.#services.get(DatabaseService);
    return store.getContact(db.knex, id);
  };

  /**
   * Gets all contacts.
   */
  getContacts = async (): Promise<Contact[]> => {
    const db = this.#services.get(DatabaseService);
    return store.getContacts(db.knex);
  };

  /**
   * Searches for contacts by name, email, or organization.
   */
  findContacts = async (query: string): Promise<Contact[]> => {
    const db = this.#services.get(DatabaseService);
    return store.findContacts(db.knex, query);
  };

  /**
   * Finds a contact by email address.
   */
  findByEmail = async (email: string): Promise<Contact | null> => {
    const db = this.#services.get(DatabaseService);
    return store.findByEmail(db.knex, email);
  };

  /**
   * Finds contacts by relationship type.
   */
  findByRelationship = async (type: RelationshipType): Promise<Contact[]> => {
    const db = this.#services.get(DatabaseService);
    return store.findByRelationship(db.knex, type);
  };

  /**
   * Gets contacts marked as high or critical importance.
   */
  getImportantContacts = async (): Promise<Contact[]> => {
    const db = this.#services.get(DatabaseService);
    return store.getImportantContacts(db.knex);
  };

  /**
   * Creates a new contact.
   */
  createContact = async (input: CreateContactInput): Promise<Contact> => {
    const db = this.#services.get(DatabaseService);
    return store.createContact(db.knex, input);
  };

  /**
   * Updates a contact.
   */
  updateContact = async (id: string, updates: UpdateContactInput): Promise<Contact> => {
    const db = this.#services.get(DatabaseService);
    return store.updateContact(db.knex, id, updates);
  };

  /**
   * Deletes a contact.
   */
  deleteContact = async (id: string): Promise<void> => {
    const db = this.#services.get(DatabaseService);
    return store.deleteContact(db.knex, id);
  };

  /**
   * Records an interaction with a contact.
   */
  recordInteraction = async (contactId: string, summary: string): Promise<void> => {
    const db = this.#services.get(DatabaseService);
    return store.recordInteraction(db.knex, contactId, summary);
  };

  // ==========================================================================
  // Contact Groups
  // ==========================================================================

  /**
   * Gets a contact group by ID.
   */
  getGroup = async (id: string): Promise<ContactGroup | null> => {
    const db = this.#services.get(DatabaseService);
    return store.getGroup(db.knex, id);
  };

  /**
   * Gets all contact groups.
   */
  getGroups = async (): Promise<ContactGroup[]> => {
    const db = this.#services.get(DatabaseService);
    return store.getGroups(db.knex);
  };

  /**
   * Gets all contacts in a group.
   */
  getGroupMembers = async (groupId: string): Promise<Contact[]> => {
    const db = this.#services.get(DatabaseService);
    return store.getGroupMembers(db.knex, groupId);
  };

  /**
   * Creates a new contact group.
   */
  createGroup = async (input: CreateContactGroupInput): Promise<ContactGroup> => {
    const db = this.#services.get(DatabaseService);
    return store.createGroup(db.knex, input);
  };

  /**
   * Updates a contact group.
   */
  updateGroup = async (id: string, updates: UpdateContactGroupInput): Promise<ContactGroup> => {
    const db = this.#services.get(DatabaseService);
    return store.updateGroup(db.knex, id, updates);
  };

  /**
   * Deletes a contact group.
   */
  deleteGroup = async (id: string): Promise<void> => {
    const db = this.#services.get(DatabaseService);
    return store.deleteGroup(db.knex, id);
  };
}

// Re-export types
export type {
  Contact,
  CreateContactInput,
  UpdateContactInput,
  ContactGroup,
  CreateContactGroupInput,
  UpdateContactGroupInput,
  RelationshipType,
  RelationshipImportance,
  Relationship,
} from './contacts.schemas.ts';

export { ContactsService };
