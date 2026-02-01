import type { Knex } from 'knex';

import type {
  Location,
  CreateLocationInput,
  UpdateLocationInput,
  CurrentLocation,
  LocationType,
  LocationSource,
  LocationConfidence,
  Address,
} from './location.schemas.ts';

// ============================================================================
// Row Types
// ============================================================================

type LocationRow = {
  id: string;
  name: string;
  type: string;
  latitude: number | null;
  longitude: number | null;
  address: string | null; // JSON
  timezone: string | null;
  is_default: number;
  tags: string | null; // JSON
  created_at: string;
  updated_at: string;
};

type LocationHistoryRow = {
  id: string;
  location_id: string | null;
  confidence: string;
  source: string;
  recorded_at: string;
};

// ============================================================================
// Converters
// ============================================================================

const now = (): string => new Date().toISOString();

const locationFromRow = (row: LocationRow): Location => ({
  id: row.id,
  name: row.name,
  type: row.type as LocationType,
  coordinates:
    row.latitude !== null && row.longitude !== null ? { latitude: row.latitude, longitude: row.longitude } : undefined,
  address: row.address ? (JSON.parse(row.address) as Address) : undefined,
  timezone: row.timezone ?? undefined,
  isDefault: row.is_default === 1,
  tags: row.tags ? (JSON.parse(row.tags) as string[]) : [],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// ============================================================================
// Location Operations
// ============================================================================

const getLocation = async (knex: Knex, id: string): Promise<Location | null> => {
  const row = await knex<LocationRow>('locations').where('id', id).first();
  return row ? locationFromRow(row) : null;
};

const getLocations = async (knex: Knex): Promise<Location[]> => {
  const rows = await knex<LocationRow>('locations').orderBy('name');
  return rows.map(locationFromRow);
};

const findLocationByName = async (knex: Knex, name: string): Promise<Location | null> => {
  const row = await knex<LocationRow>('locations').whereRaw('LOWER(name) = LOWER(?)', [name]).first();
  return row ? locationFromRow(row) : null;
};

const findLocationsByType = async (knex: Knex, type: LocationType): Promise<Location[]> => {
  const rows = await knex<LocationRow>('locations').where('type', type).orderBy('name');
  return rows.map(locationFromRow);
};

const getDefaultLocation = async (knex: Knex, type?: LocationType): Promise<Location | null> => {
  let query = knex<LocationRow>('locations').where('is_default', 1);
  if (type) {
    query = query.where('type', type);
  }
  const row = await query.first();
  return row ? locationFromRow(row) : null;
};

const createLocation = async (knex: Knex, input: CreateLocationInput): Promise<Location> => {
  const timestamp = now();
  const id = crypto.randomUUID();

  // If this is set as default, clear other defaults of same type
  if (input.isDefault) {
    await knex('locations').where('type', input.type).update({ is_default: 0 });
  }

  const row: LocationRow = {
    id,
    name: input.name,
    type: input.type,
    latitude: input.coordinates?.latitude ?? null,
    longitude: input.coordinates?.longitude ?? null,
    address: input.address ? JSON.stringify(input.address) : null,
    timezone: input.timezone ?? null,
    is_default: input.isDefault ? 1 : 0,
    tags: input.tags?.length ? JSON.stringify(input.tags) : null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  await knex('locations').insert(row);

  const result = await getLocation(knex, id);
  if (!result) {
    throw new Error('Failed to create location');
  }
  return result;
};

const updateLocation = async (knex: Knex, id: string, updates: UpdateLocationInput): Promise<Location> => {
  const existing = await getLocation(knex, id);
  if (!existing) {
    throw new Error('Location not found');
  }

  // If setting as default, clear other defaults of same type
  if (updates.isDefault) {
    const type = updates.type ?? existing.type;
    await knex('locations').where('type', type).where('id', '!=', id).update({ is_default: 0 });
  }

  const updateData: Partial<LocationRow> = {
    updated_at: now(),
  };

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.type !== undefined) updateData.type = updates.type;
  if (updates.coordinates !== undefined) {
    updateData.latitude = updates.coordinates?.latitude ?? null;
    updateData.longitude = updates.coordinates?.longitude ?? null;
  }
  if (updates.address !== undefined) {
    updateData.address = updates.address ? JSON.stringify(updates.address) : null;
  }
  if (updates.timezone !== undefined) updateData.timezone = updates.timezone ?? null;
  if (updates.isDefault !== undefined) updateData.is_default = updates.isDefault ? 1 : 0;
  if (updates.tags !== undefined) {
    updateData.tags = updates.tags.length ? JSON.stringify(updates.tags) : null;
  }

  await knex('locations').where('id', id).update(updateData);

  const result = await getLocation(knex, id);
  if (!result) {
    throw new Error('Failed to update location');
  }
  return result;
};

const deleteLocation = async (knex: Knex, id: string): Promise<void> => {
  await knex('location_history').where('location_id', id).delete();
  await knex('locations').where('id', id).delete();
};

// ============================================================================
// Current Location Operations
// ============================================================================

const getCurrentLocation = async (knex: Knex): Promise<CurrentLocation | null> => {
  const historyRow = await knex<LocationHistoryRow>('location_history').orderBy('recorded_at', 'desc').first();

  if (!historyRow) {
    return null;
  }

  let location: Location | null = null;
  if (historyRow.location_id) {
    location = await getLocation(knex, historyRow.location_id);
  }

  return {
    location,
    confidence: historyRow.confidence as LocationConfidence,
    source: historyRow.source as LocationSource,
    updatedAt: historyRow.recorded_at,
  };
};

const setCurrentLocation = async (
  knex: Knex,
  locationId: string | null,
  source: LocationSource = 'manual',
  confidence: LocationConfidence = 'exact',
): Promise<void> => {
  const timestamp = now();
  const id = crypto.randomUUID();

  await knex('location_history').insert({
    id,
    location_id: locationId,
    confidence,
    source,
    recorded_at: timestamp,
  });
};

const getLocationHistory = async (knex: Knex, limit = 10): Promise<CurrentLocation[]> => {
  const rows = await knex<LocationHistoryRow>('location_history').orderBy('recorded_at', 'desc').limit(limit);

  const results: CurrentLocation[] = [];
  for (const row of rows) {
    let location: Location | null = null;
    if (row.location_id) {
      location = await getLocation(knex, row.location_id);
    }
    results.push({
      location,
      confidence: row.confidence as LocationConfidence,
      source: row.source as LocationSource,
      updatedAt: row.recorded_at,
    });
  }

  return results;
};

export {
  // Locations
  getLocation,
  getLocations,
  findLocationByName,
  findLocationsByType,
  getDefaultLocation,
  createLocation,
  updateLocation,
  deleteLocation,
  // Current Location
  getCurrentLocation,
  setCurrentLocation,
  getLocationHistory,
};
