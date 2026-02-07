import { z } from 'zod';

// ============================================================================
// Location Type
// ============================================================================

const locationTypeSchema = z.enum(['home', 'work', 'client', 'travel', 'venue', 'other']);

type LocationType = z.infer<typeof locationTypeSchema>;

// ============================================================================
// Coordinates
// ============================================================================

const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

type Coordinates = z.infer<typeof coordinatesSchema>;

// ============================================================================
// Address
// ============================================================================

const addressSchema = z.object({
  street: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
});

type Address = z.infer<typeof addressSchema>;

// ============================================================================
// Location
// ============================================================================

const locationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  type: locationTypeSchema,
  coordinates: coordinatesSchema.optional(),
  address: addressSchema.optional(),
  timezone: z.string().optional(),
  isDefault: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

type Location = z.infer<typeof locationSchema>;

/**
 * Create location input schema.
 * Uses .optional().default() pattern to make fields optional in input while providing defaults.
 */
const createLocationInputSchema = z.object({
  name: z.string().min(1),
  type: locationTypeSchema,
  coordinates: coordinatesSchema.optional(),
  address: addressSchema.optional(),
  timezone: z.string().optional(),
  isDefault: z.boolean().optional().default(false),
  tags: z.array(z.string()).optional().default([]),
});

type CreateLocationInput = z.input<typeof createLocationInputSchema>;

const updateLocationInputSchema = createLocationInputSchema.partial();

type UpdateLocationInput = z.input<typeof updateLocationInputSchema>;

// ============================================================================
// Current Location
// ============================================================================

const locationConfidenceSchema = z.enum(['exact', 'approximate', 'inferred']);

type LocationConfidence = z.infer<typeof locationConfidenceSchema>;

const locationSourceSchema = z.enum(['manual', 'calendar', 'device', 'schedule']);

type LocationSource = z.infer<typeof locationSourceSchema>;

const currentLocationSchema = z.object({
  location: locationSchema.nullable(),
  confidence: locationConfidenceSchema,
  source: locationSourceSchema,
  updatedAt: z.string().datetime(),
});

type CurrentLocation = z.infer<typeof currentLocationSchema>;

// ============================================================================
// Coordinate History (GPS tracking)
// ============================================================================

/**
 * Provider identifiers for coordinate history.
 * Provider-agnostic design - not tied to any specific service.
 */
const coordinateProviderSchema = z.enum(['homeassistant', 'ios', 'android', 'manual', 'other']);

type CoordinateProvider = z.infer<typeof coordinateProviderSchema>;

/**
 * A single coordinate history entry.
 * Tracks GPS coordinates over time from any location provider.
 */
const coordinateHistoryEntrySchema = z.object({
  id: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().nullable(), // meters
  altitude: z.number().nullable(), // meters
  speed: z.number().nullable(), // m/s
  bearing: z.number().nullable(), // degrees

  // Provider info
  provider: coordinateProviderSchema,
  source: z.string().nullable(), // e.g., 'device_tracker.pixel_9'

  // Zone info (what the provider thinks)
  zone: z.string().nullable(), // e.g., 'home', 'work', 'not_home'

  // Timestamps
  recordedAt: z.string().datetime(), // when recorded by provider
  createdAt: z.string().datetime(), // when stored
});

type CoordinateHistoryEntry = z.infer<typeof coordinateHistoryEntrySchema>;

/**
 * Input for recording a new coordinate.
 */
const recordCoordinateInputSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().optional(),
  altitude: z.number().optional(),
  speed: z.number().optional(),
  bearing: z.number().optional(),
  provider: coordinateProviderSchema,
  source: z.string().optional(),
  zone: z.string().optional(),
  recordedAt: z.string().datetime().optional(), // defaults to now
});

type RecordCoordinateInput = z.input<typeof recordCoordinateInputSchema>;

export type {
  LocationType,
  Coordinates,
  Address,
  Location,
  CreateLocationInput,
  UpdateLocationInput,
  LocationConfidence,
  LocationSource,
  CurrentLocation,
  CoordinateProvider,
  CoordinateHistoryEntry,
  RecordCoordinateInput,
};

export {
  locationTypeSchema,
  coordinatesSchema,
  addressSchema,
  locationSchema,
  createLocationInputSchema,
  updateLocationInputSchema,
  locationConfidenceSchema,
  locationSourceSchema,
  currentLocationSchema,
  coordinateProviderSchema,
  coordinateHistoryEntrySchema,
  recordCoordinateInputSchema,
};
