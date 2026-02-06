import { describe, it, expect } from 'vitest';

import { ouraDataTypeSchema, ouraEventTypeSchema, ouraWebhookPayloadSchema } from './oura.schemas.ts';
import {
  normalizeOuraSleep,
  normalizeOuraActivity,
  normalizeOuraReadiness,
  normalizeOuraWebhook,
  ouraDataTypeToHealthType,
} from './oura.normalizer.ts';
import type { OuraSleepData, OuraDailyActivityData, OuraDailyReadinessData } from './oura.schemas.ts';

// ============================================================================
// Schema Tests
// ============================================================================

describe('Oura Schemas', () => {
  describe('ouraDataTypeSchema', () => {
    it('accepts valid data types', () => {
      expect(ouraDataTypeSchema.parse('daily_sleep')).toBe('daily_sleep');
      expect(ouraDataTypeSchema.parse('daily_activity')).toBe('daily_activity');
      expect(ouraDataTypeSchema.parse('daily_readiness')).toBe('daily_readiness');
      expect(ouraDataTypeSchema.parse('workout')).toBe('workout');
    });

    it('rejects invalid data types', () => {
      expect(() => ouraDataTypeSchema.parse('invalid')).toThrow();
    });
  });

  describe('ouraEventTypeSchema', () => {
    it('accepts valid event types', () => {
      expect(ouraEventTypeSchema.parse('create')).toBe('create');
      expect(ouraEventTypeSchema.parse('update')).toBe('update');
      expect(ouraEventTypeSchema.parse('delete')).toBe('delete');
    });

    it('rejects invalid event types', () => {
      expect(() => ouraEventTypeSchema.parse('modify')).toThrow();
    });
  });

  describe('ouraWebhookPayloadSchema', () => {
    it('parses a valid webhook payload', () => {
      const payload = ouraWebhookPayloadSchema.parse({
        event_type: 'create',
        data_type: 'daily_sleep',
        event_time: '2026-02-06T08:00:00Z',
        user_id: 'user-123',
        data: { id: 'sleep-456', day: '2026-02-05', score: 85 },
      });

      expect(payload.event_type).toBe('create');
      expect(payload.data_type).toBe('daily_sleep');
      expect(payload.user_id).toBe('user-123');
    });
  });
});

// ============================================================================
// Type Mapping Tests
// ============================================================================

describe('ouraDataTypeToHealthType', () => {
  it('maps daily_sleep to sleep', () => {
    expect(ouraDataTypeToHealthType['daily_sleep']).toBe('sleep');
  });

  it('maps daily_activity to activity', () => {
    expect(ouraDataTypeToHealthType['daily_activity']).toBe('activity');
  });

  it('maps daily_readiness to readiness', () => {
    expect(ouraDataTypeToHealthType['daily_readiness']).toBe('readiness');
  });

  it('maps workout to workout', () => {
    expect(ouraDataTypeToHealthType['workout']).toBe('workout');
  });
});

// ============================================================================
// Normalizer Tests
// ============================================================================

describe('Oura Normalizers', () => {
  describe('normalizeOuraSleep', () => {
    it('converts Oura sleep data to normalized format', () => {
      const ouraData: OuraSleepData = {
        id: 'sleep-123',
        day: '2026-02-05',
        bedtime_start: '2026-02-05T23:00:00Z',
        bedtime_end: '2026-02-06T07:30:00Z',
        total_sleep_duration: 28800, // 8 hours in seconds
        rem_sleep_duration: 5400, // 90 min
        deep_sleep_duration: 7200, // 120 min
        light_sleep_duration: 16200, // 270 min
        awake_time: 1800, // 30 min
        efficiency: 92,
        latency: 600, // 10 min
        average_heart_rate: 52,
        lowest_heart_rate: 48,
        average_hrv: 45,
        average_breath: 14,
      };

      const normalized = normalizeOuraSleep(ouraData);

      expect(normalized.totalSleepMinutes).toBe(480); // 28800 / 60
      expect(normalized.remSleepMinutes).toBe(90);
      expect(normalized.deepSleepMinutes).toBe(120);
      expect(normalized.lightSleepMinutes).toBe(270);
      expect(normalized.awakeDurationMinutes).toBe(30);
      expect(normalized.bedtimeStart).toBe('2026-02-05T23:00:00Z');
      expect(normalized.bedtimeEnd).toBe('2026-02-06T07:30:00Z');
      expect(normalized.efficiency).toBe(92);
      expect(normalized.latencyMinutes).toBe(10);
      expect(normalized.averageHeartRate).toBe(52);
      expect(normalized.lowestHeartRate).toBe(48);
      expect(normalized.averageHrv).toBe(45);
      expect(normalized.respiratoryRate).toBe(14);
    });

    it('handles null values', () => {
      const ouraData: OuraSleepData = {
        id: 'sleep-123',
        day: '2026-02-05',
        bedtime_start: '2026-02-05T23:00:00Z',
        bedtime_end: '2026-02-06T07:30:00Z',
        total_sleep_duration: null,
        rem_sleep_duration: null,
        average_hrv: null,
      };

      const normalized = normalizeOuraSleep(ouraData);

      expect(normalized.totalSleepMinutes).toBe(0);
      expect(normalized.remSleepMinutes).toBeNull();
      expect(normalized.averageHrv).toBeNull();
    });
  });

  describe('normalizeOuraActivity', () => {
    it('converts Oura activity data to normalized format', () => {
      const ouraData: OuraDailyActivityData = {
        id: 'activity-123',
        day: '2026-02-05',
        score: 78,
        steps: 8500,
        active_calories: 450,
        total_calories: 2200,
        sedentary_time: 25200, // 420 min
        low_activity_time: 10800, // 180 min
        medium_activity_time: 2700, // 45 min
        high_activity_time: 900, // 15 min
        target_calories: 500,
      };

      const normalized = normalizeOuraActivity(ouraData);

      expect(normalized.steps).toBe(8500);
      expect(normalized.activeCalories).toBe(450);
      expect(normalized.totalCalories).toBe(2200);
      expect(normalized.sedentaryMinutes).toBe(420);
      expect(normalized.lightlyActiveMinutes).toBe(180);
      expect(normalized.moderatelyActiveMinutes).toBe(45);
      expect(normalized.vigorouslyActiveMinutes).toBe(15);
      expect(normalized.targetCalories).toBe(500);
      expect(normalized.score).toBe(78);
    });

    it('handles null values', () => {
      const ouraData: OuraDailyActivityData = {
        id: 'activity-123',
        day: '2026-02-05',
        score: null,
        steps: null,
      };

      const normalized = normalizeOuraActivity(ouraData);

      expect(normalized.steps).toBeNull();
      expect(normalized.score).toBeNull();
    });
  });

  describe('normalizeOuraReadiness', () => {
    it('converts Oura readiness data to normalized format', () => {
      const ouraData: OuraDailyReadinessData = {
        id: 'readiness-123',
        day: '2026-02-05',
        score: 82,
        contributors: {
          activity_balance: 78,
          body_temperature: 90,
          hrv_balance: 82,
          previous_day_activity: 75,
          previous_night: 85,
          recovery_index: 79,
          resting_heart_rate: 88,
          sleep_balance: 80,
        },
      };

      const normalized = normalizeOuraReadiness(ouraData);

      expect(normalized.score).toBe(82);
      expect(normalized.activityBalanceScore).toBe(78);
      expect(normalized.bodyTemperatureScore).toBe(90);
      expect(normalized.hrvBalanceScore).toBe(82);
      expect(normalized.previousDayActivityScore).toBe(75);
      expect(normalized.previousNightScore).toBe(85);
      expect(normalized.recoveryIndexScore).toBe(79);
      expect(normalized.restingHeartRateScore).toBe(88);
      expect(normalized.sleepBalanceScore).toBe(80);
    });

    it('handles missing contributors', () => {
      const ouraData: OuraDailyReadinessData = {
        id: 'readiness-123',
        day: '2026-02-05',
        score: 82,
      };

      const normalized = normalizeOuraReadiness(ouraData);

      expect(normalized.score).toBe(82);
      expect(normalized.activityBalanceScore).toBeNull();
    });
  });

  describe('normalizeOuraWebhook', () => {
    it('normalizes a sleep webhook payload', () => {
      const payload = {
        event_type: 'create' as const,
        data_type: 'sleep' as const,
        event_time: '2026-02-06T08:00:00Z',
        user_id: 'user-123',
        data: {
          id: 'sleep-456',
          day: '2026-02-05',
          bedtime_start: '2026-02-05T23:00:00Z',
          bedtime_end: '2026-02-06T07:30:00Z',
          total_sleep_duration: 28800,
          score: 85,
        },
      };

      const normalized = normalizeOuraWebhook(payload);

      expect(normalized).not.toBeNull();
      expect(normalized?.provider).toBe('oura');
      expect(normalized?.type).toBe('sleep');
      expect(normalized?.date).toBe('2026-02-05');
      expect(normalized?.externalId).toBe('sleep-456');
      expect(normalized?.score).toBe(85);
    });

    it('normalizes an activity webhook payload', () => {
      const payload = {
        event_type: 'create' as const,
        data_type: 'daily_activity' as const,
        event_time: '2026-02-06T08:00:00Z',
        user_id: 'user-123',
        data: {
          id: 'activity-456',
          day: '2026-02-05',
          steps: 8500,
          score: 78,
        },
      };

      const normalized = normalizeOuraWebhook(payload);

      expect(normalized).not.toBeNull();
      expect(normalized?.type).toBe('activity');
      expect(normalized?.score).toBe(78);
    });

    it('normalizes a readiness webhook payload', () => {
      const payload = {
        event_type: 'create' as const,
        data_type: 'daily_readiness' as const,
        event_time: '2026-02-06T08:00:00Z',
        user_id: 'user-123',
        data: {
          id: 'readiness-456',
          day: '2026-02-05',
          score: 82,
        },
      };

      const normalized = normalizeOuraWebhook(payload);

      expect(normalized).not.toBeNull();
      expect(normalized?.type).toBe('readiness');
      expect(normalized?.score).toBe(82);
    });

    it('returns null for unsupported data types', () => {
      const payload = {
        event_type: 'create' as const,
        data_type: 'tag' as const,
        event_time: '2026-02-06T08:00:00Z',
        user_id: 'user-123',
        data: { id: 'tag-123' },
      };

      const normalized = normalizeOuraWebhook(payload);

      expect(normalized).toBeNull();
    });

    it('uses user_id and day for externalId when id not present', () => {
      const payload = {
        event_type: 'create' as const,
        data_type: 'daily_sleep' as const,
        event_time: '2026-02-06T08:00:00Z',
        user_id: 'user-123',
        data: {
          day: '2026-02-05',
          score: 85,
        },
      };

      const normalized = normalizeOuraWebhook(payload);

      expect(normalized?.externalId).toBe('user-123-2026-02-05-daily_sleep');
    });

    it('preserves raw data in the output', () => {
      const payload = {
        event_type: 'create' as const,
        data_type: 'daily_sleep' as const,
        event_time: '2026-02-06T08:00:00Z',
        user_id: 'user-123',
        data: {
          id: 'sleep-456',
          day: '2026-02-05',
          custom_field: 'preserved',
        },
      };

      const normalized = normalizeOuraWebhook(payload);

      expect(normalized?.rawData).toEqual(payload.data);
      expect(normalized?.rawData['custom_field']).toBe('preserved');
    });
  });
});
