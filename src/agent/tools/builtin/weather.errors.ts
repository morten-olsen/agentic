/**
 * Error codes for weather operations.
 */
type WeatherErrorCode = 'LOCATION_NOT_FOUND' | 'GEOCODING_FAILED' | 'API_ERROR' | 'NETWORK_ERROR' | 'TIMEOUT';

/**
 * Error thrown when a weather operation fails.
 */
class WeatherError extends Error {
  readonly code: WeatherErrorCode;
  readonly location?: string;
  readonly statusCode?: number;

  constructor(code: WeatherErrorCode, message: string, location?: string, statusCode?: number) {
    super(message);
    this.name = 'WeatherError';
    this.code = code;
    this.location = location;
    this.statusCode = statusCode;
  }
}

/**
 * Creates a location not found error.
 */
const createLocationNotFoundError = (location: string): WeatherError => {
  return new WeatherError('LOCATION_NOT_FOUND', `Location not found: "${location}"`, location);
};

/**
 * Creates a geocoding failed error.
 */
const createGeocodingFailedError = (location: string, cause: string): WeatherError => {
  return new WeatherError('GEOCODING_FAILED', `Failed to geocode location "${location}": ${cause}`, location);
};

/**
 * Creates an API error.
 */
const createApiError = (message: string, statusCode?: number): WeatherError => {
  return new WeatherError('API_ERROR', `Weather API error: ${message}`, undefined, statusCode);
};

/**
 * Creates a network error.
 */
const createNetworkError = (cause: string): WeatherError => {
  return new WeatherError('NETWORK_ERROR', `Network error: ${cause}`);
};

/**
 * Creates a timeout error.
 */
const createTimeoutError = (timeoutMs: number): WeatherError => {
  return new WeatherError('TIMEOUT', `Request timed out after ${timeoutMs}ms`);
};

export type { WeatherErrorCode };
export {
  WeatherError,
  createLocationNotFoundError,
  createGeocodingFailedError,
  createApiError,
  createNetworkError,
  createTimeoutError,
};
