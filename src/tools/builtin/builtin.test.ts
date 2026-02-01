import { describe, it, beforeEach, expect } from 'vitest';

import { CalendarService } from '../../calendar/calendar.ts';
import { ContactsService } from '../../contacts/contacts.ts';
import { createDatabaseService, DatabaseService } from '../../database/database.ts';
import { LocationService } from '../../location/location.ts';
import { MemoryService } from '../../memory/memory.ts';
import { Services } from '../../services/services.ts';
import { UserModelService } from '../../user-model/user-model.ts';
import type { ToolContext } from '../tools.ts';
import { ToolRegistry } from '../tools.ts';

import { registerBuiltinTools } from './builtin.ts';
import {
  getAgendaTool,
  getUpcomingEventsTool,
  getCalendarContextTool,
  getEventsInRangeTool,
  createEventTool,
  updateEventTool,
  deleteEventTool,
  checkBusyTool,
} from './calendar.ts';
import {
  searchContactsTool,
  listContactsTool,
  getContactTool,
  createContactTool,
  updateContactTool,
  deleteContactTool,
  recordInteractionTool,
} from './contacts.ts';
import {
  listLocationsTool,
  getLocationTool,
  getCurrentLocationTool,
  setCurrentLocationTool,
  createLocationTool,
  updateLocationTool,
  deleteLocationTool,
  checkLocationStatusTool,
} from './location.ts';
import {
  rememberTool,
  recallTool,
  recallByTypeTool,
  getMemoryTool,
  listMemoriesTool,
  reinforceTool,
  correctTool,
  forgetTool,
  getRecentTopicsTool,
} from './memory.ts';
import {
  listProjectsTool,
  createProjectTool,
  updateProjectTool,
  deleteProjectTool,
  listGoalsTool,
  createGoalTool,
  updateGoalTool,
} from './user-model.ts';

describe('Builtin Service Tools', () => {
  let services: Services;
  let context: ToolContext;

  beforeEach(async () => {
    services = new Services();

    // Set up database
    const dbService = createDatabaseService(services, { path: ':memory:' });
    services.set(DatabaseService, dbService);
    await dbService.migrate();

    // Set up services
    services.set(UserModelService, new UserModelService(services));
    services.set(ContactsService, new ContactsService(services));
    services.set(CalendarService, new CalendarService(services));
    services.set(LocationService, new LocationService(services));
    services.set(MemoryService, new MemoryService(services));

    context = {
      userId: 'test-user',
      conversationId: 'test-conversation',
      services,
    };
  });

  describe('registerBuiltinTools', () => {
    it('registers all service tools', () => {
      const registry = new ToolRegistry(services);
      registerBuiltinTools(registry);

      // Core tools
      expect(registry.has('builtin.echo')).toBe(true);
      expect(registry.has('builtin.ask_user')).toBe(true);

      // User Model tools
      expect(registry.has('user_model.list_projects')).toBe(true);
      expect(registry.has('user_model.create_project')).toBe(true);
      expect(registry.has('user_model.list_goals')).toBe(true);

      // Contacts tools
      expect(registry.has('contacts.search')).toBe(true);
      expect(registry.has('contacts.create')).toBe(true);

      // Calendar tools
      expect(registry.has('calendar.get_agenda')).toBe(true);
      expect(registry.has('calendar.create_event')).toBe(true);

      // Location tools
      expect(registry.has('location.list')).toBe(true);
      expect(registry.has('location.create')).toBe(true);

      // Memory tools
      expect(registry.has('memory.remember')).toBe(true);
      expect(registry.has('memory.recall')).toBe(true);
    });
  });

  describe('User Model Tools', () => {
    describe('listProjectsTool', () => {
      it('lists projects', async () => {
        const result = await listProjectsTool.execute({}, context);
        expect(result.projects).toEqual([]);
        expect(result.count).toBe(0);
      });
    });

    describe('createProjectTool', () => {
      it('creates a project', async () => {
        const result = await createProjectTool.execute(
          { name: 'Test Project', status: 'active', priority: 'medium' },
          context,
        );

        expect(result.name).toBe('Test Project');
        expect(result.status).toBe('active');
        expect(result.id).toBeDefined();
      });
    });

    describe('updateProjectTool', () => {
      it('updates a project', async () => {
        const created = await createProjectTool.execute(
          { name: 'Test Project', status: 'active', priority: 'medium' },
          context,
        );

        const result = await updateProjectTool.execute({ id: created.id, name: 'Updated Project' }, context);

        expect(result.name).toBe('Updated Project');
      });
    });

    describe('deleteProjectTool', () => {
      it('deletes a project', async () => {
        const created = await createProjectTool.execute(
          { name: 'Test Project', status: 'active', priority: 'medium' },
          context,
        );

        const result = await deleteProjectTool.execute({ id: created.id }, context);
        expect(result.success).toBe(true);
        expect(result.deletedId).toBe(created.id);
      });
    });

    describe('listGoalsTool', () => {
      it('lists goals', async () => {
        const result = await listGoalsTool.execute({}, context);
        expect(result.goals).toEqual([]);
        expect(result.count).toBe(0);
      });
    });

    describe('createGoalTool', () => {
      it('creates a goal', async () => {
        const result = await createGoalTool.execute(
          {
            description: 'Test Goal Description',
            timeframe: 'medium',
          },
          context,
        );

        expect(result.description).toBe('Test Goal Description');
        expect(result.timeframe).toBe('medium');
      });
    });

    describe('updateGoalTool', () => {
      it('updates a goal', async () => {
        const created = await createGoalTool.execute(
          {
            description: 'Test Goal Description',
            timeframe: 'medium',
          },
          context,
        );

        const result = await updateGoalTool.execute({ id: created.id, progress: '50% complete' }, context);
        expect(result.progress).toBe('50% complete');
      });
    });
  });

  describe('Contacts Tools', () => {
    describe('searchContactsTool', () => {
      it('searches contacts', async () => {
        await createContactTool.execute(
          { name: 'John Doe', email: 'john@example.com', relationship: { type: 'colleague' } },
          context,
        );

        const result = await searchContactsTool.execute({ query: 'John' }, context);
        expect(result.count).toBe(1);
        expect(result.contacts[0]?.name).toBe('John Doe');
      });
    });

    describe('listContactsTool', () => {
      it('lists all contacts', async () => {
        const result = await listContactsTool.execute({}, context);
        expect(result.contacts).toEqual([]);
        expect(result.count).toBe(0);
      });

      it('filters by relationship type', async () => {
        await createContactTool.execute({ name: 'John', relationship: { type: 'colleague' } }, context);
        await createContactTool.execute({ name: 'Jane', relationship: { type: 'friend' } }, context);

        const result = await listContactsTool.execute({ relationshipType: 'colleague' }, context);
        expect(result.count).toBe(1);
        expect(result.contacts[0]?.name).toBe('John');
      });
    });

    describe('getContactTool', () => {
      it('gets contact by id', async () => {
        const created = await createContactTool.execute(
          { name: 'John Doe', relationship: { type: 'colleague' } },
          context,
        );

        const result = await getContactTool.execute({ id: created.id }, context);
        expect(result.found).toBe(true);
        expect(result.contact?.name).toBe('John Doe');
      });

      it('returns not found for unknown id', async () => {
        const result = await getContactTool.execute({ id: 'unknown' }, context);
        expect(result.found).toBe(false);
        expect(result.contact).toBeNull();
      });
    });

    describe('createContactTool', () => {
      it('creates a contact', async () => {
        const result = await createContactTool.execute(
          { name: 'John Doe', email: 'john@example.com', relationship: { type: 'colleague', importance: 'high' } },
          context,
        );

        expect(result.name).toBe('John Doe');
        expect(result.email).toBe('john@example.com');
        expect(result.relationship.type).toBe('colleague');
      });
    });

    describe('updateContactTool', () => {
      it('updates a contact', async () => {
        const created = await createContactTool.execute(
          { name: 'John Doe', relationship: { type: 'colleague' } },
          context,
        );

        const result = await updateContactTool.execute({ id: created.id, name: 'John Smith' }, context);
        expect(result.name).toBe('John Smith');
      });
    });

    describe('deleteContactTool', () => {
      it('deletes a contact', async () => {
        const created = await createContactTool.execute(
          { name: 'John Doe', relationship: { type: 'colleague' } },
          context,
        );

        const result = await deleteContactTool.execute({ id: created.id }, context);
        expect(result.success).toBe(true);
      });
    });

    describe('recordInteractionTool', () => {
      it('records an interaction', async () => {
        const created = await createContactTool.execute(
          { name: 'John Doe', relationship: { type: 'colleague' } },
          context,
        );

        const result = await recordInteractionTool.execute(
          { contactId: created.id, summary: 'Had coffee meeting' },
          context,
        );
        expect(result.success).toBe(true);
      });
    });
  });

  describe('Calendar Tools', () => {
    describe('getAgendaTool', () => {
      it('gets agenda for today', async () => {
        const result = await getAgendaTool.execute({}, context);
        expect(result.agenda).toBeDefined();
        expect(result.eventCount).toBe(0);
      });
    });

    describe('getUpcomingEventsTool', () => {
      it('gets upcoming events', async () => {
        const result = await getUpcomingEventsTool.execute({}, context);
        expect(result.events).toEqual([]);
        expect(result.count).toBe(0);
      });
    });

    describe('getCalendarContextTool', () => {
      it('gets calendar context', async () => {
        const result = await getCalendarContextTool.execute({}, context);
        expect(result).toHaveProperty('currentEvent');
        expect(result).toHaveProperty('nextEvent');
      });
    });

    describe('getEventsInRangeTool', () => {
      it('gets events in range', async () => {
        const start = new Date().toISOString();
        const end = new Date(Date.now() + 86400000).toISOString();

        const result = await getEventsInRangeTool.execute({ start, end }, context);
        expect(result.events).toEqual([]);
        expect(result.count).toBe(0);
      });
    });

    describe('createEventTool', () => {
      it('creates an event', async () => {
        const start = new Date().toISOString();
        const end = new Date(Date.now() + 3600000).toISOString();

        const result = await createEventTool.execute(
          {
            title: 'Test Meeting',
            start,
            end,
            timezone: 'America/New_York',
          },
          context,
        );

        expect(result.title).toBe('Test Meeting');
        expect(result.id).toBeDefined();
      });
    });

    describe('updateEventTool', () => {
      it('updates an event', async () => {
        const start = new Date().toISOString();
        const end = new Date(Date.now() + 3600000).toISOString();

        const created = await createEventTool.execute(
          { title: 'Test Meeting', start, end, timezone: 'America/New_York' },
          context,
        );

        const result = await updateEventTool.execute({ id: created.id, title: 'Updated Meeting' }, context);
        expect(result.title).toBe('Updated Meeting');
      });
    });

    describe('deleteEventTool', () => {
      it('deletes an event', async () => {
        const start = new Date().toISOString();
        const end = new Date(Date.now() + 3600000).toISOString();

        const created = await createEventTool.execute(
          { title: 'Test Meeting', start, end, timezone: 'America/New_York' },
          context,
        );

        const result = await deleteEventTool.execute({ id: created.id }, context);
        expect(result.success).toBe(true);
      });
    });

    describe('checkBusyTool', () => {
      it('checks busy status', async () => {
        const result = await checkBusyTool.execute({}, context);
        expect(result.isBusy).toBe(false);
        expect(result.currentEvent).toBeNull();
      });
    });
  });

  describe('Location Tools', () => {
    describe('listLocationsTool', () => {
      it('lists locations', async () => {
        const result = await listLocationsTool.execute({}, context);
        expect(result.locations).toEqual([]);
        expect(result.count).toBe(0);
      });
    });

    describe('getLocationTool', () => {
      it('returns not found for unknown location', async () => {
        const result = await getLocationTool.execute({ id: 'unknown' }, context);
        expect(result.found).toBe(false);
        expect(result.location).toBeNull();
      });
    });

    describe('createLocationTool', () => {
      it('creates a location', async () => {
        const result = await createLocationTool.execute({ name: 'Home', type: 'home', isDefault: true }, context);

        expect(result.name).toBe('Home');
        expect(result.type).toBe('home');
        expect(result.id).toBeDefined();
      });
    });

    describe('updateLocationTool', () => {
      it('updates a location', async () => {
        const created = await createLocationTool.execute({ name: 'Home', type: 'home' }, context);

        const result = await updateLocationTool.execute({ id: created.id, name: 'My Home' }, context);
        expect(result.name).toBe('My Home');
      });
    });

    describe('deleteLocationTool', () => {
      it('deletes a location', async () => {
        const created = await createLocationTool.execute({ name: 'Home', type: 'home' }, context);

        const result = await deleteLocationTool.execute({ id: created.id }, context);
        expect(result.success).toBe(true);
      });
    });

    describe('getCurrentLocationTool', () => {
      it('gets current location (inferred)', async () => {
        const result = await getCurrentLocationTool.execute({ infer: true }, context);
        expect(result).toHaveProperty('location');
        expect(result).toHaveProperty('source');
      });
    });

    describe('setCurrentLocationTool', () => {
      it('sets current location', async () => {
        const created = await createLocationTool.execute({ name: 'Home', type: 'home' }, context);

        const result = await setCurrentLocationTool.execute({ locationId: created.id }, context);
        expect(result.success).toBe(true);
        expect(result.locationId).toBe(created.id);
      });
    });

    describe('checkLocationStatusTool', () => {
      it('checks location status', async () => {
        const result = await checkLocationStatusTool.execute({}, context);
        expect(result).toHaveProperty('isAtHome');
        expect(result).toHaveProperty('isAtWork');
        expect(result).toHaveProperty('isTraveling');
      });
    });
  });

  describe('Memory Tools', () => {
    describe('rememberTool', () => {
      it('stores a memory', async () => {
        const result = await rememberTool.execute(
          { type: 'fact', content: 'User likes coffee', importance: 0.7 },
          context,
        );

        expect(result.content).toBe('User likes coffee');
        expect(result.type).toBe('fact');
        expect(result.importance).toBe(0.7);
        expect(result.id).toBeDefined();
      });
    });

    describe('recallTool', () => {
      it('recalls memories by query', async () => {
        await rememberTool.execute({ type: 'fact', content: 'User likes coffee' }, context);

        // Without embedding service, falls back to recency-based retrieval
        const result = await recallTool.execute({ query: 'coffee' }, context);
        expect(result.memories).toBeDefined();
      });
    });

    describe('recallByTypeTool', () => {
      it('recalls memories by type', async () => {
        await rememberTool.execute({ type: 'fact', content: 'Test fact' }, context);
        await rememberTool.execute({ type: 'preference', content: 'Test preference' }, context);

        const result = await recallByTypeTool.execute({ type: 'fact' }, context);
        expect(result.count).toBe(1);
        expect(result.memories[0]?.type).toBe('fact');
      });
    });

    describe('getMemoryTool', () => {
      it('gets memory by id', async () => {
        const created = await rememberTool.execute({ type: 'fact', content: 'Test' }, context);

        const result = await getMemoryTool.execute({ id: created.id }, context);
        expect(result.found).toBe(true);
        expect(result.memory?.content).toBe('Test');
      });

      it('returns not found for unknown id', async () => {
        const result = await getMemoryTool.execute({ id: 'unknown' }, context);
        expect(result.found).toBe(false);
        expect(result.memory).toBeNull();
      });
    });

    describe('listMemoriesTool', () => {
      it('lists memories', async () => {
        await rememberTool.execute({ type: 'fact', content: 'Test 1' }, context);
        await rememberTool.execute({ type: 'fact', content: 'Test 2' }, context);

        const result = await listMemoriesTool.execute({}, context);
        expect(result.count).toBe(2);
      });

      it('filters by type', async () => {
        await rememberTool.execute({ type: 'fact', content: 'Test fact' }, context);
        await rememberTool.execute({ type: 'preference', content: 'Test preference' }, context);

        const result = await listMemoriesTool.execute({ types: ['fact'] }, context);
        expect(result.count).toBe(1);
      });
    });

    describe('reinforceTool', () => {
      it('reinforces a memory', async () => {
        const created = await rememberTool.execute({ type: 'fact', content: 'Test', importance: 0.5 }, context);

        const result = await reinforceTool.execute({ id: created.id }, context);
        expect(result.importance).toBeGreaterThan(0.5);
      });
    });

    describe('correctTool', () => {
      it('corrects a memory', async () => {
        const created = await rememberTool.execute({ type: 'fact', content: 'Old content' }, context);

        const result = await correctTool.execute({ id: created.id, newContent: 'New content' }, context);
        expect(result.content).toBe('New content');
      });
    });

    describe('forgetTool', () => {
      it('forgets a memory', async () => {
        const created = await rememberTool.execute({ type: 'fact', content: 'Test' }, context);

        const result = await forgetTool.execute({ id: created.id }, context);
        expect(result.success).toBe(true);

        const check = await getMemoryTool.execute({ id: created.id }, context);
        expect(check.found).toBe(false);
      });
    });

    describe('getRecentTopicsTool', () => {
      it('gets recent topics', async () => {
        const result = await getRecentTopicsTool.execute({}, context);
        expect(result.topics).toBeDefined();
        expect(result.count).toBeDefined();
      });
    });
  });
});
