import { z } from 'zod';

import type { ToolDefinition, ToolContext } from '../tools.ts';

import {
  WeatherError,
  createLocationNotFoundError,
  createGeocodingFailedError,
  createApiError,
  createNetworkError,
  createTimeoutError,
} from './weather.errors.ts';

// ============================================================================
// Constants
// ============================================================================

const GEOCODING_API_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const WEATHER_API_URL = 'https://api.open-meteo.com/v1/forecast';
const DEFAULT_TIMEOUT_MS = 10000;
const USER_AGENT = 'GLaDOS/1.0 (AI Assistant)';

/**
 * WMO Weather interpretation codes mapped to human-readable conditions.
 * https://open-meteo.com/en/docs
 */
const WMO_WEATHER_CODES: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snow fall',
  73: 'Moderate snow fall',
  75: 'Heavy snow fall',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

/**
 * Gets human-readable weather condition from WMO code.
 */
const getWeatherCondition = (code: number): string => {
  return WMO_WEATHER_CODES[code] ?? 'Unknown';
};

// ============================================================================
// Schemas
// ============================================================================

/**
 * Input schema for the weather tool.
 * Accepts either a location name OR latitude/longitude coordinates.
 */
const weatherInputSchema = z
  .object({
    location: z.string().optional().describe('Location name to look up (e.g., "San Francisco", "Paris, France")'),
    latitude: z.number().min(-90).max(90).optional().describe('Latitude coordinate (-90 to 90)'),
    longitude: z.number().min(-180).max(180).optional().describe('Longitude coordinate (-180 to 180)'),
    units: z
      .enum(['celsius', 'fahrenheit'])
      .optional()
      .default('fahrenheit')
      .describe('Temperature units (default: fahrenheit)'),
    includeForecast: z.boolean().optional().default(true).describe('Include 3-day forecast (default: true)'),
  })
  .refine((data) => data.location || (data.latitude !== undefined && data.longitude !== undefined), {
    message: 'Either location OR both latitude and longitude must be provided',
  });

type WeatherInput = z.input<typeof weatherInputSchema>;

/**
 * Location info schema.
 */
const locationInfoSchema = z.object({
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  timezone: z.string(),
  country: z.string().optional(),
});

type LocationInfo = z.infer<typeof locationInfoSchema>;

/**
 * Current conditions schema.
 */
const currentConditionsSchema = z.object({
  temperature: z.number(),
  feelsLike: z.number(),
  humidity: z.number(),
  windSpeed: z.number(),
  windDirection: z.number(),
  precipitation: z.number(),
  condition: z.string(),
  isDay: z.boolean(),
});

type CurrentConditions = z.infer<typeof currentConditionsSchema>;

/**
 * Daily forecast schema.
 */
const dailyForecastSchema = z.object({
  date: z.string(),
  temperatureHigh: z.number(),
  temperatureLow: z.number(),
  condition: z.string(),
  precipitationProbability: z.number(),
  precipitationSum: z.number(),
  sunrise: z.string(),
  sunset: z.string(),
});

type DailyForecast = z.infer<typeof dailyForecastSchema>;

/**
 * Units schema.
 */
const unitsSchema = z.object({
  temperature: z.string(),
  windSpeed: z.string(),
  precipitation: z.string(),
});

/**
 * Output schema for the weather tool.
 */
const weatherOutputSchema = z.object({
  location: locationInfoSchema,
  current: currentConditionsSchema,
  forecast: z.array(dailyForecastSchema).optional(),
  units: unitsSchema,
  fetchedAt: z.string(),
});

type WeatherOutput = z.infer<typeof weatherOutputSchema>;

// ============================================================================
// Geocoding API Types
// ============================================================================

type GeocodingResult = {
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
  country?: string;
  admin1?: string;
};

type GeocodingResponse = {
  results?: GeocodingResult[];
};

// ============================================================================
// Weather API Types
// ============================================================================

type WeatherApiResponse = {
  latitude: number;
  longitude: number;
  timezone: string;
  current?: {
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
    precipitation: number;
    weather_code: number;
    is_day: number;
  };
  daily?: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    weather_code: number[];
    precipitation_probability_max: number[];
    precipitation_sum: number[];
    sunrise: string[];
    sunset: string[];
  };
};

// ============================================================================
// Implementation
// ============================================================================

/**
 * Fetches with timeout and error handling.
 */
const fetchWithTimeout = async (url: string, timeout: number, abortSignal?: AbortSignal): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  if (abortSignal) {
    abortSignal.addEventListener('abort', () => controller.abort());
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw createTimeoutError(timeout);
    }
    throw createNetworkError(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timeoutId);
  }
};

/**
 * Geocodes a location name to coordinates using Open-Meteo Geocoding API.
 */
const geocodeLocation = async (
  location: string,
  abortSignal?: AbortSignal,
): Promise<{ latitude: number; longitude: number; name: string; timezone: string; country?: string }> => {
  const url = new URL(GEOCODING_API_URL);
  url.searchParams.set('name', location);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  let response: Response;
  try {
    response = await fetchWithTimeout(url.toString(), DEFAULT_TIMEOUT_MS, abortSignal);
  } catch (error) {
    if (error instanceof WeatherError) {
      throw error;
    }
    throw createGeocodingFailedError(location, error instanceof Error ? error.message : String(error));
  }

  if (!response.ok) {
    throw createGeocodingFailedError(location, `HTTP ${response.status}: ${response.statusText}`);
  }

  let data: GeocodingResponse;
  try {
    data = (await response.json()) as GeocodingResponse;
  } catch {
    throw createGeocodingFailedError(location, 'Invalid JSON response');
  }

  if (!data.results || data.results.length === 0) {
    throw createLocationNotFoundError(location);
  }

  const result = data.results[0];
  return {
    latitude: result.latitude,
    longitude: result.longitude,
    name: result.admin1 ? `${result.name}, ${result.admin1}` : result.name,
    timezone: result.timezone,
    country: result.country,
  };
};

/**
 * Fetches weather data from Open-Meteo API.
 */
const fetchWeather = async (
  latitude: number,
  longitude: number,
  units: 'celsius' | 'fahrenheit',
  includeForecast: boolean,
  abortSignal?: AbortSignal,
): Promise<WeatherApiResponse> => {
  const url = new URL(WEATHER_API_URL);
  url.searchParams.set('latitude', latitude.toString());
  url.searchParams.set('longitude', longitude.toString());

  // Current weather parameters
  const currentParams = [
    'temperature_2m',
    'apparent_temperature',
    'relative_humidity_2m',
    'wind_speed_10m',
    'wind_direction_10m',
    'precipitation',
    'weather_code',
    'is_day',
  ];
  url.searchParams.set('current', currentParams.join(','));

  // Daily forecast parameters (3 days)
  if (includeForecast) {
    const dailyParams = [
      'temperature_2m_max',
      'temperature_2m_min',
      'weather_code',
      'precipitation_probability_max',
      'precipitation_sum',
      'sunrise',
      'sunset',
    ];
    url.searchParams.set('daily', dailyParams.join(','));
    url.searchParams.set('forecast_days', '3');
  }

  // Set units
  if (units === 'fahrenheit') {
    url.searchParams.set('temperature_unit', 'fahrenheit');
    url.searchParams.set('wind_speed_unit', 'mph');
    url.searchParams.set('precipitation_unit', 'inch');
  } else {
    url.searchParams.set('temperature_unit', 'celsius');
    url.searchParams.set('wind_speed_unit', 'kmh');
    url.searchParams.set('precipitation_unit', 'mm');
  }

  url.searchParams.set('timezone', 'auto');

  let response: Response;
  try {
    response = await fetchWithTimeout(url.toString(), DEFAULT_TIMEOUT_MS, abortSignal);
  } catch (error) {
    if (error instanceof WeatherError) {
      throw error;
    }
    throw createNetworkError(error instanceof Error ? error.message : String(error));
  }

  if (!response.ok) {
    throw createApiError(`HTTP ${response.status}: ${response.statusText}`, response.status);
  }

  let data: WeatherApiResponse;
  try {
    data = (await response.json()) as WeatherApiResponse;
  } catch {
    throw createApiError('Invalid JSON response');
  }

  return data;
};

/**
 * Executes the weather tool.
 */
const execute = async (input: WeatherInput, context: ToolContext): Promise<WeatherOutput> => {
  const parsed = weatherInputSchema.parse(input);
  const { location: locationName, latitude: inputLat, longitude: inputLon, units, includeForecast } = parsed;

  // Resolve location to coordinates
  let locationInfo: LocationInfo;

  if (locationName) {
    // Geocode the location name
    const geocoded = await geocodeLocation(locationName, context.abortSignal);
    locationInfo = {
      name: geocoded.name,
      latitude: geocoded.latitude,
      longitude: geocoded.longitude,
      timezone: geocoded.timezone,
      country: geocoded.country,
    };
  } else {
    // Use provided coordinates (guaranteed by input validation)
    const lat = inputLat as number;
    const lon = inputLon as number;
    locationInfo = {
      name: `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
      latitude: lat,
      longitude: lon,
      timezone: 'auto',
    };
  }

  // Fetch weather data
  const weatherData = await fetchWeather(
    locationInfo.latitude,
    locationInfo.longitude,
    units,
    includeForecast,
    context.abortSignal,
  );

  // Update timezone from weather response
  locationInfo.timezone = weatherData.timezone;

  // Build current conditions
  const current = weatherData.current;
  if (!current) {
    throw createApiError('No current weather data available');
  }

  const currentConditions: CurrentConditions = {
    temperature: current.temperature_2m,
    feelsLike: current.apparent_temperature,
    humidity: current.relative_humidity_2m,
    windSpeed: current.wind_speed_10m,
    windDirection: current.wind_direction_10m,
    precipitation: current.precipitation,
    condition: getWeatherCondition(current.weather_code),
    isDay: current.is_day === 1,
  };

  // Build forecast if requested
  let forecast: DailyForecast[] | undefined;
  if (includeForecast && weatherData.daily) {
    const daily = weatherData.daily;
    forecast = daily.time.map((date, i) => ({
      date,
      temperatureHigh: daily.temperature_2m_max[i],
      temperatureLow: daily.temperature_2m_min[i],
      condition: getWeatherCondition(daily.weather_code[i]),
      precipitationProbability: daily.precipitation_probability_max[i],
      precipitationSum: daily.precipitation_sum[i],
      sunrise: daily.sunrise[i],
      sunset: daily.sunset[i],
    }));
  }

  // Build units info
  const unitsInfo = {
    temperature: units === 'fahrenheit' ? '°F' : '°C',
    windSpeed: units === 'fahrenheit' ? 'mph' : 'km/h',
    precipitation: units === 'fahrenheit' ? 'in' : 'mm',
  };

  return {
    location: locationInfo,
    current: currentConditions,
    forecast,
    units: unitsInfo,
    fetchedAt: new Date().toISOString(),
  };
};

// ============================================================================
// Tool Definition
// ============================================================================

/**
 * Weather tool - retrieves current weather and forecast.
 */
const weatherTool: ToolDefinition<WeatherInput, WeatherOutput> = {
  id: 'weather.get',
  name: 'Get Weather',
  description:
    'Gets current weather conditions and optionally a 3-day forecast for a location. Accepts either a location name (which will be geocoded) or explicit latitude/longitude coordinates. Uses the free Open-Meteo API.',
  category: 'weather',
  inputSchema: weatherInputSchema,
  outputSchema: weatherOutputSchema,
  risk: {
    level: 'low',
    reason: 'Reads weather data from a public API',
    potentialImpact: 'Makes external HTTP requests to Open-Meteo API',
    reversible: true,
    categories: ['external_communication'],
  },
  tags: ['weather', 'forecast', 'temperature', 'location'],
  examples: [
    {
      input: { location: 'San Francisco' },
      description: 'Get weather for San Francisco by name',
    },
    {
      input: { latitude: 40.7128, longitude: -74.006 },
      description: 'Get weather for New York by coordinates',
    },
    {
      input: { location: 'London', units: 'celsius', includeForecast: false },
      description: 'Get current weather only in Celsius',
    },
  ],
  execute,
};

export type { WeatherInput, WeatherOutput, LocationInfo, CurrentConditions, DailyForecast };
export { weatherTool, weatherInputSchema, weatherOutputSchema, getWeatherCondition, WMO_WEATHER_CODES };
