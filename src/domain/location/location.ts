import type { Services } from '../../core/services/services.ts';
import { DatabaseService } from '../../core/database/database.ts';
import { UserModelService } from '../../domain/user-model/user-model.ts';
import { EventService } from '../../features/events/events.ts';

import type {
  Location,
  CreateLocationInput,
  UpdateLocationInput,
  CurrentLocation,
  LocationType,
  LocationSource,
} from './location.schemas.ts';
import * as store from './location.store.ts';
import { isAtHome, isAtWork, isTraveling } from './location.utils.ts';

/**
 * Location Service - manages locations and current location tracking.
 *
 * Where you are shapes what's relevant. Location enables travel time calculations,
 * context-aware suggestions, and geofenced reminders.
 */
class LocationService {
  #services: Services;

  constructor(services: Services) {
    this.#services = services;
  }

  // ==========================================================================
  // Saved Locations
  // ==========================================================================

  /**
   * Gets a location by ID.
   */
  getLocation = async (id: string): Promise<Location | null> => {
    const db = this.#services.get(DatabaseService);
    return store.getLocation(db.knex, id);
  };

  /**
   * Gets all saved locations.
   */
  getLocations = async (): Promise<Location[]> => {
    const db = this.#services.get(DatabaseService);
    return store.getLocations(db.knex);
  };

  /**
   * Finds a location by name (case-insensitive).
   */
  findLocationByName = async (name: string): Promise<Location | null> => {
    const db = this.#services.get(DatabaseService);
    return store.findLocationByName(db.knex, name);
  };

  /**
   * Finds locations by type.
   */
  findLocationsByType = async (type: LocationType): Promise<Location[]> => {
    const db = this.#services.get(DatabaseService);
    return store.findLocationsByType(db.knex, type);
  };

  /**
   * Gets the default location for a given type (e.g., default 'home' or 'work').
   */
  getDefaultLocation = async (type?: LocationType): Promise<Location | null> => {
    const db = this.#services.get(DatabaseService);
    return store.getDefaultLocation(db.knex, type);
  };

  /**
   * Creates a new location.
   */
  createLocation = async (input: CreateLocationInput): Promise<Location> => {
    const db = this.#services.get(DatabaseService);
    const location = await store.createLocation(db.knex, input);

    await this.#services.get(EventService).emit({
      type: 'location.created',
      source: 'location-service',
      externalId: `${location.id}-created`,
      summary: `Location created: ${location.name}`,
      data: {
        locationId: location.id,
        name: location.name,
        type: location.type,
        isDefault: location.isDefault,
      },
      entityId: location.id,
      entityType: 'location',
    });

    return location;
  };

  /**
   * Updates a location.
   */
  updateLocation = async (id: string, updates: UpdateLocationInput): Promise<Location> => {
    const db = this.#services.get(DatabaseService);
    const location = await store.updateLocation(db.knex, id, updates);

    await this.#services.get(EventService).emit({
      type: 'location.updated',
      source: 'location-service',
      externalId: `${location.id}-updated-${location.updatedAt}`,
      summary: `Location updated: ${location.name}`,
      data: {
        locationId: location.id,
        name: location.name,
        type: location.type,
        updatedFields: Object.keys(updates),
      },
      entityId: location.id,
      entityType: 'location',
    });

    return location;
  };

  /**
   * Deletes a location.
   */
  deleteLocation = async (id: string): Promise<void> => {
    const db = this.#services.get(DatabaseService);
    const location = await store.getLocation(db.knex, id);

    await store.deleteLocation(db.knex, id);

    if (location) {
      await this.#services.get(EventService).emit({
        type: 'location.deleted',
        source: 'location-service',
        externalId: `${id}-deleted-${new Date().toISOString()}`,
        summary: `Location deleted: ${location.name}`,
        data: {
          locationId: id,
          name: location.name,
          type: location.type,
        },
        entityId: id,
        entityType: 'location',
      });
    }
  };

  // ==========================================================================
  // Current Location
  // ==========================================================================

  /**
   * Gets the current location.
   */
  getCurrentLocation = async (): Promise<CurrentLocation | null> => {
    const db = this.#services.get(DatabaseService);
    return store.getCurrentLocation(db.knex);
  };

  /**
   * Sets the current location.
   */
  setCurrentLocation = async (locationId: string, source: LocationSource = 'manual'): Promise<void> => {
    const db = this.#services.get(DatabaseService);
    const location = await store.getLocation(db.knex, locationId);

    await store.setCurrentLocation(db.knex, locationId, source, 'exact');

    if (location) {
      await this.#services.get(EventService).emit({
        type: 'location.current.changed',
        source: 'location-service',
        externalId: `current-${locationId}-${new Date().toISOString()}`,
        summary: `Current location set to: ${location.name}`,
        data: {
          locationId,
          locationName: location.name,
          locationType: location.type,
          updateSource: source,
          confidence: 'exact',
        },
        entityId: locationId,
        entityType: 'location',
      });
    }
  };

  /**
   * Clears the current location (user is in transit/unknown).
   */
  clearCurrentLocation = async (source: LocationSource = 'manual'): Promise<void> => {
    const db = this.#services.get(DatabaseService);
    await store.setCurrentLocation(db.knex, null, source, 'inferred');

    await this.#services.get(EventService).emit({
      type: 'location.current.cleared',
      source: 'location-service',
      externalId: `current-cleared-${new Date().toISOString()}`,
      summary: 'Current location cleared (in transit/unknown)',
      data: {
        updateSource: source,
      },
    });
  };

  /**
   * Gets the location history.
   */
  getLocationHistory = async (limit = 10): Promise<CurrentLocation[]> => {
    const db = this.#services.get(DatabaseService);
    return store.getLocationHistory(db.knex, limit);
  };

  /**
   * Infers the current location from context.
   *
   * Priority:
   * 1. Most recent manual/device update (if recent)
   * 2. Based on user's working hours (work during work hours, home otherwise)
   */
  inferCurrentLocation = async (): Promise<CurrentLocation> => {
    const db = this.#services.get(DatabaseService);
    const userModel = this.#services.get(UserModelService);

    // Check if we have a recent location
    const current = await store.getCurrentLocation(db.knex);
    if (current) {
      // If the location was set manually or by device within the last hour, trust it
      const lastUpdate = new Date(current.updatedAt);
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

      if (lastUpdate > hourAgo && (current.source === 'manual' || current.source === 'device')) {
        return current;
      }
    }

    // Infer based on working hours
    const isWorking = await userModel.isWorkingHours();
    const locationType: LocationType = isWorking ? 'work' : 'home';
    const defaultLocation = await store.getDefaultLocation(db.knex, locationType);

    const now = new Date().toISOString();

    if (defaultLocation) {
      // Record this inference
      await store.setCurrentLocation(db.knex, defaultLocation.id, 'schedule', 'inferred');

      return {
        location: defaultLocation,
        confidence: 'inferred',
        source: 'schedule',
        updatedAt: now,
      };
    }

    // No default location found - try any default
    const anyDefault = await store.getDefaultLocation(db.knex);
    if (anyDefault) {
      await store.setCurrentLocation(db.knex, anyDefault.id, 'schedule', 'inferred');

      return {
        location: anyDefault,
        confidence: 'inferred',
        source: 'schedule',
        updatedAt: now,
      };
    }

    // No locations at all
    return {
      location: null,
      confidence: 'inferred',
      source: 'schedule',
      updatedAt: now,
    };
  };

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Checks if the user is at home.
   */
  isAtHome = async (): Promise<boolean> => {
    const current = await this.getCurrentLocation();
    return isAtHome(current);
  };

  /**
   * Checks if the user is at work.
   */
  isAtWork = async (): Promise<boolean> => {
    const current = await this.getCurrentLocation();
    return isAtWork(current);
  };

  /**
   * Checks if the user is traveling.
   */
  isTraveling = async (): Promise<boolean> => {
    const current = await this.getCurrentLocation();
    return isTraveling(current);
  };
}

// Re-export types
export type {
  Location,
  CreateLocationInput,
  UpdateLocationInput,
  CurrentLocation,
  LocationType,
  LocationSource,
  LocationConfidence,
  Coordinates,
  Address,
} from './location.schemas.ts';

export { LocationService };
export { isAtHome, isAtWork, isTraveling, getLocationTimezone } from './location.utils.ts';
