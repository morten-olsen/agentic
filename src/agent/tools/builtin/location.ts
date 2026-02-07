import { z } from 'zod';

import type { ToolDefinition, ToolContext, ToolRegistry } from '../tools.ts';
import { LocationService } from '../../../domain/location/location.ts';
import {
  locationTypeSchema,
  coordinatesSchema,
  addressSchema,
  locationSchema,
  currentLocationSchema,
} from '../../../domain/location/location.schemas.ts';

// ============================================================================
// Utilities
// ============================================================================

/** Converts null to undefined for service boundary compatibility */
const nullToUndefined = <T>(value: T | null | undefined): T | undefined => (value === null ? undefined : value);

// ============================================================================
// List Locations
// ============================================================================

const listLocationsInputSchema = z.object({
  type: locationTypeSchema.nullish().describe('Filter by location type'),
});

const listLocationsOutputSchema = z.object({
  locations: z.array(locationSchema),
  count: z.number(),
});

type ListLocationsInput = z.infer<typeof listLocationsInputSchema>;
type ListLocationsOutput = z.infer<typeof listLocationsOutputSchema>;

const listLocationsTool: ToolDefinition<ListLocationsInput, ListLocationsOutput> = {
  id: 'location.list',
  name: 'ListLocations',
  description: 'List saved locations with optional filtering by type.',
  category: 'location',
  inputSchema: listLocationsInputSchema,
  outputSchema: listLocationsOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['location', 'list', 'read'],
  examples: [
    { input: {}, description: 'List all locations' },
    { input: { type: 'work' }, description: 'List work locations' },
  ],
  execute: async (input: ListLocationsInput, context: ToolContext): Promise<ListLocationsOutput> => {
    const locationService = context.services.get(LocationService);

    let locations;
    if (input.type) {
      locations = await locationService.findLocationsByType(input.type);
    } else {
      locations = await locationService.getLocations();
    }

    return { locations, count: locations.length };
  },
};

// ============================================================================
// Get Location
// ============================================================================

const getLocationInputSchema = z.object({
  id: z.string().nullish().describe('Location ID'),
  name: z.string().nullish().describe('Location name'),
});

const getLocationOutputSchema = z.object({
  location: locationSchema.nullable(),
  found: z.boolean(),
});

type GetLocationInput = z.infer<typeof getLocationInputSchema>;
type GetLocationOutput = z.infer<typeof getLocationOutputSchema>;

const getLocationTool: ToolDefinition<GetLocationInput, GetLocationOutput> = {
  id: 'location.get',
  name: 'GetLocation',
  description: 'Get a specific location by ID or name.',
  category: 'location',
  inputSchema: getLocationInputSchema,
  outputSchema: getLocationOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['location', 'read'],
  examples: [
    { input: { id: '123' }, description: 'Get location by ID' },
    { input: { name: 'Office' }, description: 'Get location by name' },
  ],
  execute: async (input: GetLocationInput, context: ToolContext): Promise<GetLocationOutput> => {
    const locationService = context.services.get(LocationService);

    let location = null;
    if (input.id) {
      location = await locationService.getLocation(input.id);
    } else if (input.name) {
      location = await locationService.findLocationByName(input.name);
    }

    return { location, found: location !== null };
  },
};

// ============================================================================
// Get Current Location
// ============================================================================

const getCurrentLocationInputSchema = z.object({
  infer: z.boolean().nullish().describe('Infer location from context if not explicitly set'),
});

const getCurrentLocationOutputSchema = currentLocationSchema;

type GetCurrentLocationInput = z.infer<typeof getCurrentLocationInputSchema>;
type GetCurrentLocationOutput = z.infer<typeof getCurrentLocationOutputSchema>;

const getCurrentLocationTool: ToolDefinition<GetCurrentLocationInput, GetCurrentLocationOutput> = {
  id: 'location.get_current',
  name: 'GetCurrentLocation',
  description: "Get the user's current location. Can infer from schedule if not explicitly set.",
  category: 'location',
  inputSchema: getCurrentLocationInputSchema,
  outputSchema: getCurrentLocationOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['location', 'current', 'read'],
  examples: [
    { input: {}, description: 'Get current location' },
    { input: { infer: true }, description: 'Get or infer current location' },
  ],
  execute: async (input: GetCurrentLocationInput, context: ToolContext): Promise<GetCurrentLocationOutput> => {
    const locationService = context.services.get(LocationService);

    if (input.infer) {
      return locationService.inferCurrentLocation();
    }

    const current = await locationService.getCurrentLocation();
    if (current) {
      return current;
    }

    // If no current location, infer it
    return locationService.inferCurrentLocation();
  },
};

// ============================================================================
// Set Current Location
// ============================================================================

const setCurrentLocationInputSchema = z.object({
  locationId: z.string().describe('ID of the location to set as current'),
});

const setCurrentLocationOutputSchema = z.object({
  success: z.boolean(),
  locationId: z.string(),
});

type SetCurrentLocationInput = z.infer<typeof setCurrentLocationInputSchema>;
type SetCurrentLocationOutput = z.infer<typeof setCurrentLocationOutputSchema>;

const setCurrentLocationTool: ToolDefinition<SetCurrentLocationInput, SetCurrentLocationOutput> = {
  id: 'location.set_current',
  name: 'SetCurrentLocation',
  description: "Set the user's current location.",
  category: 'location',
  inputSchema: setCurrentLocationInputSchema,
  outputSchema: setCurrentLocationOutputSchema,
  risk: {
    level: 'low',
    reason: 'Updates current location status',
    potentialImpact: 'Updates location context',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['location', 'current', 'write'],
  examples: [{ input: { locationId: '123' }, description: 'Set current location' }],
  execute: async (input: SetCurrentLocationInput, context: ToolContext): Promise<SetCurrentLocationOutput> => {
    const locationService = context.services.get(LocationService);
    await locationService.setCurrentLocation(input.locationId);
    return { success: true, locationId: input.locationId };
  },
};

// ============================================================================
// Create Location
// ============================================================================

const createLocationInputSchema = z.object({
  name: z.string().min(1).describe('Location name'),
  type: locationTypeSchema.describe('Type of location'),
  coordinates: coordinatesSchema.nullish().describe('GPS coordinates'),
  address: addressSchema.nullish().describe('Street address'),
  timezone: z.string().nullish().describe('Timezone for this location'),
  isDefault: z.boolean().nullish().describe('Make this the default for its type'),
  tags: z.array(z.string()).nullish().describe('Tags for categorization'),
});

const createLocationOutputSchema = locationSchema;

type CreateLocationInput = z.infer<typeof createLocationInputSchema>;
type CreateLocationOutput = z.infer<typeof createLocationOutputSchema>;

const createLocationTool: ToolDefinition<CreateLocationInput, CreateLocationOutput> = {
  id: 'location.create',
  name: 'CreateLocation',
  description: 'Create a new saved location.',
  category: 'location',
  inputSchema: createLocationInputSchema,
  outputSchema: createLocationOutputSchema,
  risk: {
    level: 'low',
    reason: 'Creates a new record, easily reversible',
    potentialImpact: 'Adds a new location entry',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['location', 'write'],
  examples: [
    {
      input: { name: 'Main Office', type: 'work', isDefault: true },
      description: 'Create a work location',
    },
  ],
  execute: async (input: CreateLocationInput, context: ToolContext): Promise<CreateLocationOutput> => {
    const locationService = context.services.get(LocationService);
    return locationService.createLocation({
      name: input.name,
      type: input.type,
      coordinates: nullToUndefined(input.coordinates),
      address: nullToUndefined(input.address),
      timezone: nullToUndefined(input.timezone),
      isDefault: nullToUndefined(input.isDefault),
      tags: nullToUndefined(input.tags),
    });
  },
};

// ============================================================================
// Update Location
// ============================================================================

const updateLocationInputSchema = z.object({
  id: z.string().describe('Location ID to update'),
  name: z.string().nullish().describe('New name'),
  type: locationTypeSchema.nullish().describe('New type'),
  coordinates: coordinatesSchema.nullish().describe('New coordinates'),
  address: addressSchema.nullish().describe('New address'),
  timezone: z.string().nullish().describe('New timezone'),
  isDefault: z.boolean().nullish().describe('Update default status'),
  tags: z.array(z.string()).nullish().describe('New tags'),
});

const updateLocationOutputSchema = locationSchema;

type UpdateLocationInput = z.infer<typeof updateLocationInputSchema>;
type UpdateLocationOutput = z.infer<typeof updateLocationOutputSchema>;

const updateLocationTool: ToolDefinition<UpdateLocationInput, UpdateLocationOutput> = {
  id: 'location.update',
  name: 'UpdateLocation',
  description: 'Update an existing location.',
  category: 'location',
  inputSchema: updateLocationInputSchema,
  outputSchema: updateLocationOutputSchema,
  risk: {
    level: 'low',
    reason: 'Modifies existing record',
    potentialImpact: 'Modifies location data',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['location', 'write'],
  examples: [{ input: { id: '123', name: 'New Office' }, description: 'Rename a location' }],
  execute: async (input: UpdateLocationInput, context: ToolContext): Promise<UpdateLocationOutput> => {
    const locationService = context.services.get(LocationService);
    return locationService.updateLocation(input.id, {
      name: nullToUndefined(input.name),
      type: nullToUndefined(input.type),
      coordinates: nullToUndefined(input.coordinates),
      address: nullToUndefined(input.address),
      timezone: nullToUndefined(input.timezone),
      isDefault: nullToUndefined(input.isDefault),
      tags: nullToUndefined(input.tags),
    });
  },
};

// ============================================================================
// Delete Location
// ============================================================================

const deleteLocationInputSchema = z.object({
  id: z.string().describe('Location ID to delete'),
});

const deleteLocationOutputSchema = z.object({
  success: z.boolean(),
  deletedId: z.string(),
});

type DeleteLocationInput = z.infer<typeof deleteLocationInputSchema>;
type DeleteLocationOutput = z.infer<typeof deleteLocationOutputSchema>;

const deleteLocationTool: ToolDefinition<DeleteLocationInput, DeleteLocationOutput> = {
  id: 'location.delete',
  name: 'DeleteLocation',
  description: 'Delete a saved location.',
  category: 'location',
  inputSchema: deleteLocationInputSchema,
  outputSchema: deleteLocationOutputSchema,
  risk: {
    level: 'medium',
    reason: 'Permanently deletes data',
    potentialImpact: 'Location will be removed',
    reversible: false,
    categories: ['data_modification'],
  },
  tags: ['location', 'write', 'destructive'],
  examples: [{ input: { id: '123' }, description: 'Delete a location' }],
  execute: async (input: DeleteLocationInput, context: ToolContext): Promise<DeleteLocationOutput> => {
    const locationService = context.services.get(LocationService);
    await locationService.deleteLocation(input.id);
    return { success: true, deletedId: input.id };
  },
};

// ============================================================================
// Check Location Status
// ============================================================================

const checkLocationStatusInputSchema = z.object({});

const checkLocationStatusOutputSchema = z.object({
  isAtHome: z.boolean(),
  isAtWork: z.boolean(),
  isTraveling: z.boolean(),
});

type CheckLocationStatusInput = z.infer<typeof checkLocationStatusInputSchema>;
type CheckLocationStatusOutput = z.infer<typeof checkLocationStatusOutputSchema>;

const checkLocationStatusTool: ToolDefinition<CheckLocationStatusInput, CheckLocationStatusOutput> = {
  id: 'location.check_status',
  name: 'CheckLocationStatus',
  description: 'Check if the user is at home, at work, or traveling.',
  category: 'location',
  inputSchema: checkLocationStatusInputSchema,
  outputSchema: checkLocationStatusOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['location', 'status', 'read'],
  examples: [{ input: {}, description: 'Check current location status' }],
  execute: async (_input: CheckLocationStatusInput, context: ToolContext): Promise<CheckLocationStatusOutput> => {
    const locationService = context.services.get(LocationService);
    const [isAtHome, isAtWork, isTraveling] = await Promise.all([
      locationService.isAtHome(),
      locationService.isAtWork(),
      locationService.isTraveling(),
    ]);
    return { isAtHome, isAtWork, isTraveling };
  },
};

// ============================================================================
// Registration
// ============================================================================

const registerLocationTools = (registry: ToolRegistry): void => {
  registry.register(listLocationsTool);
  registry.register(getLocationTool);
  registry.register(getCurrentLocationTool);
  registry.register(setCurrentLocationTool);
  registry.register(createLocationTool);
  registry.register(updateLocationTool);
  registry.register(deleteLocationTool);
  registry.register(checkLocationStatusTool);
};

export {
  listLocationsTool,
  getLocationTool,
  getCurrentLocationTool,
  setCurrentLocationTool,
  createLocationTool,
  updateLocationTool,
  deleteLocationTool,
  checkLocationStatusTool,
  registerLocationTools,
};
