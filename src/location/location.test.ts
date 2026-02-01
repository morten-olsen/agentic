import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { Services } from '../services/services.ts';
import { createDatabaseService, DatabaseService } from '../database/database.ts';
import { UserModelService } from '../user-model/user-model.ts';

import { LocationService } from './location.ts';
import { isAtHome, isAtWork, isTraveling } from './location.utils.ts';

describe('LocationService', () => {
  let services: Services;
  let location: LocationService;

  beforeEach(async () => {
    services = new Services();
    const db = createDatabaseService(services, { path: ':memory:' });
    services.set(DatabaseService, db);
    await db.migrate();
    location = services.get(LocationService);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('Location CRUD', () => {
    it('creates a location', async () => {
      const loc = await location.createLocation({
        name: 'Home',
        type: 'home',
        isDefault: true,
      });

      expect(loc.id).toBeDefined();
      expect(loc.name).toBe('Home');
      expect(loc.type).toBe('home');
      expect(loc.isDefault).toBe(true);
    });

    it('creates a location with all fields', async () => {
      const loc = await location.createLocation({
        name: 'Office',
        type: 'work',
        coordinates: { latitude: 37.7749, longitude: -122.4194 },
        address: {
          street: '123 Main St',
          city: 'San Francisco',
          region: 'CA',
          postalCode: '94102',
          country: 'USA',
        },
        timezone: 'America/Los_Angeles',
        isDefault: true,
        tags: ['primary', 'sf'],
      });

      expect(loc.coordinates?.latitude).toBe(37.7749);
      expect(loc.coordinates?.longitude).toBe(-122.4194);
      expect(loc.address?.city).toBe('San Francisco');
      expect(loc.timezone).toBe('America/Los_Angeles');
      expect(loc.tags).toContain('primary');
    });

    it('gets a location by ID', async () => {
      const created = await location.createLocation({
        name: 'Test',
        type: 'other',
      });

      const retrieved = await location.getLocation(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('Test');
    });

    it('returns null for non-existent location', async () => {
      const result = await location.getLocation('non-existent-id');
      expect(result).toBeNull();
    });

    it('gets all locations', async () => {
      await location.createLocation({ name: 'Home', type: 'home' });
      await location.createLocation({ name: 'Office', type: 'work' });

      const all = await location.getLocations();

      expect(all).toHaveLength(2);
    });

    it('updates a location', async () => {
      const loc = await location.createLocation({
        name: 'Original',
        type: 'other',
      });

      const updated = await location.updateLocation(loc.id, {
        name: 'Updated',
        type: 'home',
      });

      expect(updated.name).toBe('Updated');
      expect(updated.type).toBe('home');
    });

    it('deletes a location', async () => {
      const loc = await location.createLocation({
        name: 'To Delete',
        type: 'other',
      });

      await location.deleteLocation(loc.id);

      const result = await location.getLocation(loc.id);
      expect(result).toBeNull();
    });
  });

  describe('Location Search', () => {
    beforeEach(async () => {
      await location.createLocation({ name: 'Home', type: 'home', isDefault: true });
      await location.createLocation({ name: 'Office', type: 'work', isDefault: true });
      await location.createLocation({ name: 'Coffee Shop', type: 'other' });
    });

    it('finds location by name', async () => {
      const result = await location.findLocationByName('Home');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('Home');
    });

    it('finds location by name case-insensitively', async () => {
      const result = await location.findLocationByName('HOME');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('Home');
    });

    it('returns null for unknown name', async () => {
      const result = await location.findLocationByName('Unknown');
      expect(result).toBeNull();
    });

    it('finds locations by type', async () => {
      const homes = await location.findLocationsByType('home');

      expect(homes).toHaveLength(1);
      expect(homes[0]?.name).toBe('Home');
    });

    it('gets default location for type', async () => {
      const defaultHome = await location.getDefaultLocation('home');

      expect(defaultHome).not.toBeNull();
      expect(defaultHome?.name).toBe('Home');
    });

    it('gets any default location', async () => {
      const anyDefault = await location.getDefaultLocation();

      expect(anyDefault).not.toBeNull();
    });
  });

  describe('Default Location Management', () => {
    it('setting new default clears old default of same type', async () => {
      const home1 = await location.createLocation({
        name: 'Home 1',
        type: 'home',
        isDefault: true,
      });
      const home2 = await location.createLocation({
        name: 'Home 2',
        type: 'home',
        isDefault: true,
      });

      const updated1 = await location.getLocation(home1.id);
      const updated2 = await location.getLocation(home2.id);

      expect(updated1?.isDefault).toBe(false);
      expect(updated2?.isDefault).toBe(true);
    });

    it('different types can each have a default', async () => {
      await location.createLocation({ name: 'Home', type: 'home', isDefault: true });
      await location.createLocation({ name: 'Office', type: 'work', isDefault: true });

      const defaultHome = await location.getDefaultLocation('home');
      const defaultWork = await location.getDefaultLocation('work');

      expect(defaultHome?.name).toBe('Home');
      expect(defaultWork?.name).toBe('Office');
    });
  });

  describe('Current Location', () => {
    let home: Awaited<ReturnType<typeof location.createLocation>>;
    let office: Awaited<ReturnType<typeof location.createLocation>>;

    beforeEach(async () => {
      home = await location.createLocation({ name: 'Home', type: 'home', isDefault: true });
      office = await location.createLocation({ name: 'Office', type: 'work', isDefault: true });
    });

    it('returns null when no current location is set', async () => {
      const current = await location.getCurrentLocation();
      expect(current).toBeNull();
    });

    it('sets current location', async () => {
      await location.setCurrentLocation(home.id);

      const current = await location.getCurrentLocation();

      expect(current).not.toBeNull();
      expect(current?.location?.name).toBe('Home');
      expect(current?.source).toBe('manual');
      expect(current?.confidence).toBe('exact');
    });

    it('updates current location', async () => {
      await location.setCurrentLocation(home.id);
      await location.setCurrentLocation(office.id);

      const current = await location.getCurrentLocation();

      expect(current?.location?.name).toBe('Office');
    });

    it('clears current location', async () => {
      await location.setCurrentLocation(home.id);
      await location.clearCurrentLocation();

      const current = await location.getCurrentLocation();

      expect(current?.location).toBeNull();
      expect(current?.confidence).toBe('inferred');
    });

    it('gets location history', async () => {
      await location.setCurrentLocation(home.id);
      await location.setCurrentLocation(office.id);
      await location.setCurrentLocation(home.id);

      const history = await location.getLocationHistory(10);

      expect(history).toHaveLength(3);
      expect(history[0]?.location?.name).toBe('Home'); // Most recent
      expect(history[1]?.location?.name).toBe('Office');
      expect(history[2]?.location?.name).toBe('Home');
    });
  });

  describe('Location Inference', () => {
    beforeEach(async () => {
      // Set up user model with working hours
      const userModel = services.get(UserModelService);
      await userModel.createIdentity({
        name: 'Test User',
        workingHours: {
          start: '09:00',
          end: '17:00',
          days: [1, 2, 3, 4, 5],
        },
      });

      await location.createLocation({ name: 'Home', type: 'home', isDefault: true });
      await location.createLocation({ name: 'Office', type: 'work', isDefault: true });
    });

    it('infers location based on working hours', async () => {
      // Note: This test depends on current time. We're just testing that it returns something.
      const inferred = await location.inferCurrentLocation();

      expect(inferred).not.toBeNull();
      expect(inferred.confidence).toBe('inferred');
      expect(inferred.source).toBe('schedule');
      expect(inferred.location).not.toBeNull();
    });

    it('trusts recent manual location', async () => {
      const home = await location.findLocationByName('Home');
      expect(home).not.toBeNull();
      await location.setCurrentLocation(home?.id ?? '', 'manual');

      const inferred = await location.inferCurrentLocation();

      // Should return the manual location since it's recent
      expect(inferred.location?.name).toBe('Home');
      expect(inferred.source).toBe('manual');
      expect(inferred.confidence).toBe('exact');
    });
  });

  describe('Helper Methods', () => {
    beforeEach(async () => {
      await location.createLocation({ name: 'Home', type: 'home', isDefault: true });
      await location.createLocation({ name: 'Office', type: 'work', isDefault: true });
      await location.createLocation({ name: 'Airport', type: 'travel' });
    });

    it('isAtHome returns true when at home', async () => {
      const home = await location.findLocationByName('Home');
      expect(home).not.toBeNull();
      await location.setCurrentLocation(home?.id ?? '');

      expect(await location.isAtHome()).toBe(true);
      expect(await location.isAtWork()).toBe(false);
    });

    it('isAtWork returns true when at work', async () => {
      const office = await location.findLocationByName('Office');
      expect(office).not.toBeNull();
      await location.setCurrentLocation(office?.id ?? '');

      expect(await location.isAtWork()).toBe(true);
      expect(await location.isAtHome()).toBe(false);
    });

    it('isTraveling returns true when at travel location', async () => {
      const airport = await location.findLocationByName('Airport');
      expect(airport).not.toBeNull();
      await location.setCurrentLocation(airport?.id ?? '');

      expect(await location.isTraveling()).toBe(true);
      expect(await location.isAtHome()).toBe(false);
    });
  });
});

describe('Location Utils', () => {
  describe('isAtHome', () => {
    it('returns true when location type is home', () => {
      const current = {
        location: {
          id: '1',
          name: 'Home',
          type: 'home' as const,
          isDefault: true,
          tags: [],
          createdAt: '',
          updatedAt: '',
        },
        confidence: 'exact' as const,
        source: 'manual' as const,
        updatedAt: '',
      };

      expect(isAtHome(current)).toBe(true);
    });

    it('returns false when location type is not home', () => {
      const current = {
        location: {
          id: '1',
          name: 'Office',
          type: 'work' as const,
          isDefault: true,
          tags: [],
          createdAt: '',
          updatedAt: '',
        },
        confidence: 'exact' as const,
        source: 'manual' as const,
        updatedAt: '',
      };

      expect(isAtHome(current)).toBe(false);
    });

    it('returns false when location is null', () => {
      expect(isAtHome(null)).toBe(false);
      expect(isAtHome({ location: null, confidence: 'inferred', source: 'schedule', updatedAt: '' })).toBe(false);
    });
  });

  describe('isAtWork', () => {
    it('returns true when location type is work', () => {
      const current = {
        location: {
          id: '1',
          name: 'Office',
          type: 'work' as const,
          isDefault: true,
          tags: [],
          createdAt: '',
          updatedAt: '',
        },
        confidence: 'exact' as const,
        source: 'manual' as const,
        updatedAt: '',
      };

      expect(isAtWork(current)).toBe(true);
    });
  });

  describe('isTraveling', () => {
    it('returns true when location type is travel', () => {
      const current = {
        location: {
          id: '1',
          name: 'Airport',
          type: 'travel' as const,
          isDefault: false,
          tags: [],
          createdAt: '',
          updatedAt: '',
        },
        confidence: 'exact' as const,
        source: 'manual' as const,
        updatedAt: '',
      };

      expect(isTraveling(current)).toBe(true);
    });
  });
});
