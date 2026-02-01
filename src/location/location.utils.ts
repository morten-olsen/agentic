import type { Location, CurrentLocation, LocationType } from './location.schemas.ts';

/**
 * Determines if the current location matches a given type.
 */
const isAtLocationType = (current: CurrentLocation | null, type: LocationType): boolean => {
  if (!current?.location) return false;
  return current.location.type === type;
};

/**
 * Determines if the user is at home.
 */
const isAtHome = (current: CurrentLocation | null): boolean => {
  return isAtLocationType(current, 'home');
};

/**
 * Determines if the user is at work.
 */
const isAtWork = (current: CurrentLocation | null): boolean => {
  return isAtLocationType(current, 'work');
};

/**
 * Determines if the user is traveling.
 */
const isTraveling = (current: CurrentLocation | null): boolean => {
  return isAtLocationType(current, 'travel');
};

/**
 * Gets the timezone for a location, falling back to user default.
 */
const getLocationTimezone = (location: Location | null, defaultTimezone = 'UTC'): string => {
  return location?.timezone ?? defaultTimezone;
};

export { isAtLocationType, isAtHome, isAtWork, isTraveling, getLocationTimezone };
