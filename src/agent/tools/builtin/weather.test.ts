import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse, delay } from 'msw';

import { Services } from '../../../core/services/services.ts';
import type { ToolContext } from '../tools.ts';
import { server } from '../../../../test/setup.ts';

import { weatherTool, getWeatherCondition, WMO_WEATHER_CODES } from './weather.ts';
import { WeatherError } from './weather.errors.ts';

// ============================================================================
// Mock Data
// ============================================================================

const mockGeocodingResponse = {
  results: [
    {
      name: 'San Francisco',
      latitude: 37.7749,
      longitude: -122.4194,
      timezone: 'America/Los_Angeles',
      country: 'United States',
      admin1: 'California',
    },
  ],
};

const mockWeatherResponse = {
  latitude: 37.7749,
  longitude: -122.4194,
  timezone: 'America/Los_Angeles',
  current: {
    temperature_2m: 65.3,
    apparent_temperature: 63.1,
    relative_humidity_2m: 72,
    wind_speed_10m: 12.5,
    wind_direction_10m: 270,
    precipitation: 0,
    weather_code: 2,
    is_day: 1,
  },
  daily: {
    time: ['2024-01-15', '2024-01-16', '2024-01-17'],
    temperature_2m_max: [68.2, 70.1, 65.8],
    temperature_2m_min: [52.3, 54.1, 50.9],
    weather_code: [2, 3, 61],
    precipitation_probability_max: [10, 20, 80],
    precipitation_sum: [0, 0, 0.5],
    sunrise: ['2024-01-15T07:21', '2024-01-16T07:20', '2024-01-17T07:19'],
    sunset: ['2024-01-15T17:15', '2024-01-16T17:16', '2024-01-17T17:17'],
  },
};

const mockWeatherResponseCelsius = {
  latitude: 51.5074,
  longitude: -0.1278,
  timezone: 'Europe/London',
  current: {
    temperature_2m: 8.5,
    apparent_temperature: 5.2,
    relative_humidity_2m: 85,
    wind_speed_10m: 15.3,
    wind_direction_10m: 220,
    precipitation: 0.2,
    weather_code: 61,
    is_day: 1,
  },
};

// ============================================================================
// Utility Tests
// ============================================================================

describe('weather utilities', () => {
  describe('getWeatherCondition', () => {
    it('returns correct condition for known codes', () => {
      expect(getWeatherCondition(0)).toBe('Clear sky');
      expect(getWeatherCondition(2)).toBe('Partly cloudy');
      expect(getWeatherCondition(61)).toBe('Slight rain');
      expect(getWeatherCondition(95)).toBe('Thunderstorm');
    });

    it('returns Unknown for unknown codes', () => {
      expect(getWeatherCondition(999)).toBe('Unknown');
      expect(getWeatherCondition(-1)).toBe('Unknown');
    });
  });

  describe('WMO_WEATHER_CODES', () => {
    it('has expected codes defined', () => {
      expect(WMO_WEATHER_CODES[0]).toBeDefined();
      expect(WMO_WEATHER_CODES[45]).toBe('Fog');
      expect(WMO_WEATHER_CODES[71]).toBe('Slight snow fall');
    });
  });
});

// ============================================================================
// Tool Tests
// ============================================================================

describe('weatherTool', () => {
  let services: Services;
  let context: ToolContext;

  beforeEach(() => {
    services = new Services();
    context = {
      userId: 'test-user',
      conversationId: 'test-conversation',
      services,
    };
  });

  describe('tool definition', () => {
    it('has correct metadata', () => {
      expect(weatherTool.id).toBe('weather.get');
      expect(weatherTool.name).toBe('Get Weather');
      expect(weatherTool.category).toBe('weather');
      // Weather tool uses static risk profile
      const risk = weatherTool.risk as { level: string; categories: string[] };
      expect(risk.level).toBe('low');
      expect(risk.categories).toContain('external_communication');
    });

    it('has examples', () => {
      expect(weatherTool.examples).toBeDefined();
      expect(weatherTool.examples?.length).toBeGreaterThan(0);
    });
  });

  describe('location lookup', () => {
    it('geocodes location name and fetches weather', async () => {
      server.use(
        http.get('https://geocoding-api.open-meteo.com/v1/search', () => {
          return HttpResponse.json(mockGeocodingResponse);
        }),
        http.get('https://api.open-meteo.com/v1/forecast', () => {
          return HttpResponse.json(mockWeatherResponse);
        }),
      );

      const result = await weatherTool.execute({ location: 'San Francisco' }, context);

      expect(result.location.name).toBe('San Francisco, California');
      expect(result.location.latitude).toBeCloseTo(37.7749, 2);
      expect(result.location.longitude).toBeCloseTo(-122.4194, 2);
      expect(result.location.country).toBe('United States');
      expect(result.location.timezone).toBe('America/Los_Angeles');
    });

    it('includes current conditions', async () => {
      server.use(
        http.get('https://geocoding-api.open-meteo.com/v1/search', () => {
          return HttpResponse.json(mockGeocodingResponse);
        }),
        http.get('https://api.open-meteo.com/v1/forecast', () => {
          return HttpResponse.json(mockWeatherResponse);
        }),
      );

      const result = await weatherTool.execute({ location: 'San Francisco' }, context);

      expect(result.current.temperature).toBe(65.3);
      expect(result.current.feelsLike).toBe(63.1);
      expect(result.current.humidity).toBe(72);
      expect(result.current.windSpeed).toBe(12.5);
      expect(result.current.windDirection).toBe(270);
      expect(result.current.precipitation).toBe(0);
      expect(result.current.condition).toBe('Partly cloudy');
      expect(result.current.isDay).toBe(true);
    });

    it('includes 3-day forecast by default', async () => {
      server.use(
        http.get('https://geocoding-api.open-meteo.com/v1/search', () => {
          return HttpResponse.json(mockGeocodingResponse);
        }),
        http.get('https://api.open-meteo.com/v1/forecast', () => {
          return HttpResponse.json(mockWeatherResponse);
        }),
      );

      const result = await weatherTool.execute({ location: 'San Francisco' }, context);

      expect(result.forecast).toBeDefined();
      expect(result.forecast).toHaveLength(3);

      const forecast = result.forecast as NonNullable<typeof result.forecast>;
      expect(forecast[0].date).toBe('2024-01-15');
      expect(forecast[0].temperatureHigh).toBe(68.2);
      expect(forecast[0].temperatureLow).toBe(52.3);
      expect(forecast[0].condition).toBe('Partly cloudy');
      expect(forecast[0].precipitationProbability).toBe(10);
      expect(forecast[2].condition).toBe('Slight rain');
    });

    it('includes units information', async () => {
      server.use(
        http.get('https://geocoding-api.open-meteo.com/v1/search', () => {
          return HttpResponse.json(mockGeocodingResponse);
        }),
        http.get('https://api.open-meteo.com/v1/forecast', () => {
          return HttpResponse.json(mockWeatherResponse);
        }),
      );

      const result = await weatherTool.execute({ location: 'San Francisco' }, context);

      expect(result.units.temperature).toBe('°F');
      expect(result.units.windSpeed).toBe('mph');
      expect(result.units.precipitation).toBe('in');
    });

    it('includes fetchedAt timestamp', async () => {
      server.use(
        http.get('https://geocoding-api.open-meteo.com/v1/search', () => {
          return HttpResponse.json(mockGeocodingResponse);
        }),
        http.get('https://api.open-meteo.com/v1/forecast', () => {
          return HttpResponse.json(mockWeatherResponse);
        }),
      );

      const before = new Date().toISOString();
      const result = await weatherTool.execute({ location: 'San Francisco' }, context);
      const after = new Date().toISOString();

      expect(result.fetchedAt).toBeDefined();
      expect(result.fetchedAt >= before).toBe(true);
      expect(result.fetchedAt <= after).toBe(true);
    });
  });

  describe('coordinate lookup', () => {
    it('fetches weather by coordinates without geocoding', async () => {
      server.use(
        http.get('https://api.open-meteo.com/v1/forecast', ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get('latitude')).toBe('40.7128');
          expect(url.searchParams.get('longitude')).toBe('-74.006');
          return HttpResponse.json(mockWeatherResponse);
        }),
      );

      const result = await weatherTool.execute({ latitude: 40.7128, longitude: -74.006 }, context);

      expect(result.location.name).toBe('40.7128, -74.0060');
      expect(result.location.latitude).toBe(40.7128);
      expect(result.location.longitude).toBe(-74.006);
    });

    it('does not call geocoding API when coordinates provided', async () => {
      let geocodingCalled = false;

      server.use(
        http.get('https://geocoding-api.open-meteo.com/v1/search', () => {
          geocodingCalled = true;
          return HttpResponse.json(mockGeocodingResponse);
        }),
        http.get('https://api.open-meteo.com/v1/forecast', () => {
          return HttpResponse.json(mockWeatherResponse);
        }),
      );

      await weatherTool.execute({ latitude: 37.7749, longitude: -122.4194 }, context);

      expect(geocodingCalled).toBe(false);
    });
  });

  describe('unit options', () => {
    it('uses fahrenheit by default', async () => {
      server.use(
        http.get('https://api.open-meteo.com/v1/forecast', ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get('temperature_unit')).toBe('fahrenheit');
          expect(url.searchParams.get('wind_speed_unit')).toBe('mph');
          expect(url.searchParams.get('precipitation_unit')).toBe('inch');
          return HttpResponse.json(mockWeatherResponse);
        }),
      );

      const result = await weatherTool.execute({ latitude: 40.7128, longitude: -74.006 }, context);

      expect(result.units.temperature).toBe('°F');
      expect(result.units.windSpeed).toBe('mph');
      expect(result.units.precipitation).toBe('in');
    });

    it('supports celsius units', async () => {
      server.use(
        http.get('https://api.open-meteo.com/v1/forecast', ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get('temperature_unit')).toBe('celsius');
          expect(url.searchParams.get('wind_speed_unit')).toBe('kmh');
          expect(url.searchParams.get('precipitation_unit')).toBe('mm');
          return HttpResponse.json(mockWeatherResponseCelsius);
        }),
      );

      const result = await weatherTool.execute({ latitude: 51.5074, longitude: -0.1278, units: 'celsius' }, context);

      expect(result.units.temperature).toBe('°C');
      expect(result.units.windSpeed).toBe('km/h');
      expect(result.units.precipitation).toBe('mm');
    });
  });

  describe('forecast options', () => {
    it('excludes forecast when includeForecast is false', async () => {
      server.use(
        http.get('https://api.open-meteo.com/v1/forecast', ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.has('daily')).toBe(false);
          return HttpResponse.json(mockWeatherResponseCelsius);
        }),
      );

      const result = await weatherTool.execute(
        { latitude: 51.5074, longitude: -0.1278, includeForecast: false },
        context,
      );

      expect(result.forecast).toBeUndefined();
    });

    it('requests 3-day forecast when includeForecast is true', async () => {
      server.use(
        http.get('https://geocoding-api.open-meteo.com/v1/search', () => {
          return HttpResponse.json(mockGeocodingResponse);
        }),
        http.get('https://api.open-meteo.com/v1/forecast', ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get('forecast_days')).toBe('3');
          expect(url.searchParams.has('daily')).toBe(true);
          return HttpResponse.json(mockWeatherResponse);
        }),
      );

      const result = await weatherTool.execute({ location: 'San Francisco', includeForecast: true }, context);

      expect(result.forecast).toHaveLength(3);
    });
  });

  describe('error handling', () => {
    it('throws LOCATION_NOT_FOUND when location cannot be geocoded', async () => {
      server.use(
        http.get('https://geocoding-api.open-meteo.com/v1/search', () => {
          return HttpResponse.json({ results: [] });
        }),
      );

      await expect(weatherTool.execute({ location: 'Nonexistent Place XYZ' }, context)).rejects.toThrow(WeatherError);

      try {
        await weatherTool.execute({ location: 'Nonexistent Place XYZ' }, context);
      } catch (error) {
        expect(error).toBeInstanceOf(WeatherError);
        expect((error as WeatherError).code).toBe('LOCATION_NOT_FOUND');
        expect((error as WeatherError).location).toBe('Nonexistent Place XYZ');
      }
    });

    it('throws GEOCODING_FAILED on geocoding API error', async () => {
      server.use(
        http.get('https://geocoding-api.open-meteo.com/v1/search', () => {
          return new HttpResponse(null, { status: 500, statusText: 'Internal Server Error' });
        }),
      );

      await expect(weatherTool.execute({ location: 'San Francisco' }, context)).rejects.toThrow(WeatherError);

      try {
        await weatherTool.execute({ location: 'San Francisco' }, context);
      } catch (error) {
        expect(error).toBeInstanceOf(WeatherError);
        expect((error as WeatherError).code).toBe('GEOCODING_FAILED');
      }
    });

    it('throws API_ERROR on weather API error', async () => {
      server.use(
        http.get('https://api.open-meteo.com/v1/forecast', () => {
          return new HttpResponse(null, { status: 503, statusText: 'Service Unavailable' });
        }),
      );

      await expect(weatherTool.execute({ latitude: 40.7128, longitude: -74.006 }, context)).rejects.toThrow(
        WeatherError,
      );

      try {
        await weatherTool.execute({ latitude: 40.7128, longitude: -74.006 }, context);
      } catch (error) {
        expect(error).toBeInstanceOf(WeatherError);
        expect((error as WeatherError).code).toBe('API_ERROR');
        expect((error as WeatherError).statusCode).toBe(503);
      }
    });

    it('throws TIMEOUT on slow response', async () => {
      server.use(
        http.get('https://api.open-meteo.com/v1/forecast', async () => {
          // Delay longer than the tool's 10s timeout
          await delay(12000);
          return HttpResponse.json(mockWeatherResponse);
        }),
      );

      try {
        await weatherTool.execute({ latitude: 40.7128, longitude: -74.006 }, context);
        expect.fail('Should have thrown TIMEOUT error');
      } catch (error) {
        expect(error).toBeInstanceOf(WeatherError);
        expect((error as WeatherError).code).toBe('TIMEOUT');
      }
    }, 15000);

    it('throws API_ERROR when current weather data is missing', async () => {
      server.use(
        http.get('https://api.open-meteo.com/v1/forecast', () => {
          return HttpResponse.json({
            latitude: 37.7749,
            longitude: -122.4194,
            timezone: 'America/Los_Angeles',
            // Missing 'current' field
          });
        }),
      );

      await expect(weatherTool.execute({ latitude: 37.7749, longitude: -122.4194 }, context)).rejects.toThrow(
        WeatherError,
      );

      try {
        await weatherTool.execute({ latitude: 37.7749, longitude: -122.4194 }, context);
      } catch (error) {
        expect(error).toBeInstanceOf(WeatherError);
        expect((error as WeatherError).code).toBe('API_ERROR');
        expect((error as WeatherError).message).toContain('No current weather data');
      }
    });
  });

  describe('input validation', () => {
    it('requires either location or coordinates', async () => {
      await expect(weatherTool.execute({}, context)).rejects.toThrow();
    });

    it('requires both latitude and longitude when using coordinates', async () => {
      await expect(weatherTool.execute({ latitude: 40.7128 }, context)).rejects.toThrow();
      await expect(weatherTool.execute({ longitude: -74.006 }, context)).rejects.toThrow();
    });

    it('validates latitude range', async () => {
      await expect(weatherTool.execute({ latitude: 91, longitude: 0 }, context)).rejects.toThrow();
      await expect(weatherTool.execute({ latitude: -91, longitude: 0 }, context)).rejects.toThrow();
    });

    it('validates longitude range', async () => {
      await expect(weatherTool.execute({ latitude: 0, longitude: 181 }, context)).rejects.toThrow();
      await expect(weatherTool.execute({ latitude: 0, longitude: -181 }, context)).rejects.toThrow();
    });

    it('accepts valid latitude and longitude at boundaries', async () => {
      server.use(
        http.get('https://api.open-meteo.com/v1/forecast', () => {
          return HttpResponse.json(mockWeatherResponse);
        }),
      );

      // Should not throw for valid boundary values
      await expect(weatherTool.execute({ latitude: 90, longitude: 180 }, context)).resolves.toBeDefined();
      await expect(weatherTool.execute({ latitude: -90, longitude: -180 }, context)).resolves.toBeDefined();
    });
  });

  describe('isDay flag', () => {
    it('correctly interprets is_day value of 1 as true', async () => {
      server.use(
        http.get('https://api.open-meteo.com/v1/forecast', () => {
          return HttpResponse.json({
            ...mockWeatherResponse,
            current: { ...mockWeatherResponse.current, is_day: 1 },
          });
        }),
      );

      const result = await weatherTool.execute({ latitude: 37.7749, longitude: -122.4194 }, context);
      expect(result.current.isDay).toBe(true);
    });

    it('correctly interprets is_day value of 0 as false', async () => {
      server.use(
        http.get('https://api.open-meteo.com/v1/forecast', () => {
          return HttpResponse.json({
            ...mockWeatherResponse,
            current: { ...mockWeatherResponse.current, is_day: 0 },
          });
        }),
      );

      const result = await weatherTool.execute({ latitude: 37.7749, longitude: -122.4194 }, context);
      expect(result.current.isDay).toBe(false);
    });
  });
});
