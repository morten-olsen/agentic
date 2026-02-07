import { describe, it, beforeEach, afterEach, expect } from 'vitest';

import { Services } from '../../core/services/services.ts';
import { DatabaseService, createDatabaseService } from '../../core/database/database.ts';
import { EventService } from '../../features/events/events.ts';

import { HealthService } from './health.ts';
import type { NormalizedHealthRecordInput, SleepData, ActivityData, ReadinessData } from './health.schemas.ts';
import {
  healthRecordTypeSchema,
  healthProviderSchema,
  sleepDataSchema,
  activityDataSchema,
  readinessDataSchema,
  healthRecordSchema,
} from './health.schemas.ts';

// ============================================================================
// Test Setup
// ============================================================================

const createTestServices = async (): Promise<Services> => {
  const services = new Services();
  const db = createDatabaseService(services, { path: ':memory:' });
  services.set(DatabaseService, db);
  await db.migrate();
  return services;
};

const createSleepData = (overrides?: Partial<SleepData>): SleepData => ({
  totalSleepMinutes: 480,
  remSleepMinutes: 90,
  deepSleepMinutes: 120,
  lightSleepMinutes: 270,
  awakeDurationMinutes: 30,
  bedtimeStart: '2026-02-05T23:00:00Z',
  bedtimeEnd: '2026-02-06T07:30:00Z',
  efficiency: 92,
  latencyMinutes: 10,
  averageHeartRate: 52,
  lowestHeartRate: 48,
  averageHrv: 45,
  respiratoryRate: 14,
  score: 85,
  ...overrides,
});

const createActivityData = (overrides?: Partial<ActivityData>): ActivityData => ({
  steps: 8500,
  activeCalories: 450,
  totalCalories: 2200,
  sedentaryMinutes: 420,
  lightlyActiveMinutes: 180,
  moderatelyActiveMinutes: 45,
  vigorouslyActiveMinutes: 15,
  targetCalories: 500,
  targetSteps: null,
  score: 78,
  ...overrides,
});

const createReadinessData = (overrides?: Partial<ReadinessData>): ReadinessData => ({
  score: 82,
  previousNightScore: 85,
  sleepBalanceScore: 80,
  previousDayActivityScore: 75,
  activityBalanceScore: 78,
  bodyTemperatureScore: 90,
  restingHeartRateScore: 88,
  hrvBalanceScore: 82,
  recoveryIndexScore: 79,
  ...overrides,
});

const createSleepRecordInput = (
  date: string,
  overrides?: Partial<NormalizedHealthRecordInput>,
): NormalizedHealthRecordInput => ({
  provider: 'oura',
  externalId: `sleep-${date}`,
  type: 'sleep',
  date,
  periodStart: `${date}T23:00:00Z`,
  periodEnd: `${date}T07:30:00Z`,
  score: 85,
  normalizedData: createSleepData(),
  rawData: { id: `sleep-${date}`, day: date },
  recordedAt: new Date().toISOString(),
  ...overrides,
});

// ============================================================================
// Schema Tests
// ============================================================================

describe('Health Schemas', () => {
  describe('healthRecordTypeSchema', () => {
    it('accepts valid record types', () => {
      expect(healthRecordTypeSchema.parse('sleep')).toBe('sleep');
      expect(healthRecordTypeSchema.parse('activity')).toBe('activity');
      expect(healthRecordTypeSchema.parse('readiness')).toBe('readiness');
      expect(healthRecordTypeSchema.parse('hrv')).toBe('hrv');
    });

    it('rejects invalid types', () => {
      expect(() => healthRecordTypeSchema.parse('invalid')).toThrow();
    });
  });

  describe('healthProviderSchema', () => {
    it('accepts valid providers', () => {
      expect(healthProviderSchema.parse('oura')).toBe('oura');
      expect(healthProviderSchema.parse('whoop')).toBe('whoop');
      expect(healthProviderSchema.parse('manual')).toBe('manual');
    });

    it('rejects invalid providers', () => {
      expect(() => healthProviderSchema.parse('fitbits')).toThrow();
    });
  });

  describe('sleepDataSchema', () => {
    it('parses valid sleep data', () => {
      const data = createSleepData();
      const parsed = sleepDataSchema.parse(data);

      expect(parsed.totalSleepMinutes).toBe(480);
      expect(parsed.score).toBe(85);
    });

    it('allows nullable fields', () => {
      const data = createSleepData({
        remSleepMinutes: null,
        averageHrv: null,
      });
      const parsed = sleepDataSchema.parse(data);

      expect(parsed.remSleepMinutes).toBeNull();
      expect(parsed.averageHrv).toBeNull();
    });
  });

  describe('activityDataSchema', () => {
    it('parses valid activity data', () => {
      const data = createActivityData();
      const parsed = activityDataSchema.parse(data);

      expect(parsed.steps).toBe(8500);
      expect(parsed.score).toBe(78);
    });
  });

  describe('readinessDataSchema', () => {
    it('parses valid readiness data', () => {
      const data = createReadinessData();
      const parsed = readinessDataSchema.parse(data);

      expect(parsed.score).toBe(82);
      expect(parsed.hrvBalanceScore).toBe(82);
    });
  });

  describe('healthRecordSchema', () => {
    it('parses a valid health record', () => {
      const record = healthRecordSchema.parse({
        id: 'record-123',
        provider: 'oura',
        externalId: 'oura-456',
        type: 'sleep',
        date: '2026-02-05',
        periodStart: '2026-02-05T23:00:00Z',
        periodEnd: '2026-02-06T07:30:00Z',
        score: 85,
        normalizedData: createSleepData(),
        rawData: { id: 'oura-456' },
        recordedAt: '2026-02-06T08:00:00Z',
        receivedAt: '2026-02-06T08:05:00Z',
        createdAt: '2026-02-06T08:05:00Z',
      });

      expect(record.id).toBe('record-123');
      expect(record.type).toBe('sleep');
      expect(record.provider).toBe('oura');
    });
  });
});

// ============================================================================
// HealthService Tests
// ============================================================================

describe('HealthService', () => {
  let services: Services;
  let healthService: HealthService;
  let eventService: EventService;

  beforeEach(async () => {
    services = await createTestServices();
    healthService = services.get(HealthService);
    eventService = services.get(EventService);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('Record Ingestion', () => {
    it('ingests a sleep record', async () => {
      const input = createSleepRecordInput('2026-02-05');
      const record = await healthService.ingestRecord(input);

      expect(record.id).toBeDefined();
      expect(record.type).toBe('sleep');
      expect(record.provider).toBe('oura');
      expect(record.date).toBe('2026-02-05');
      expect(record.score).toBe(85);
    });

    it('emits event to Event Log on ingestion', async () => {
      const input = createSleepRecordInput('2026-02-05');
      await healthService.ingestRecord(input);

      const events = await eventService.query({ types: ['health.sleep.logged'] });

      expect(events.events).toHaveLength(1);
      expect(events.events[0].type).toBe('health.sleep.logged');
    });

    it('upserts record with same provider and externalId', async () => {
      const input1 = createSleepRecordInput('2026-02-05', { score: 80 });
      await healthService.ingestRecord(input1);

      const input2 = createSleepRecordInput('2026-02-05', { score: 85 });
      const updated = await healthService.ingestRecord(input2);

      expect(updated.score).toBe(85);

      // Should still only have one record
      const records = await healthService.getRecords({ type: 'sleep' });
      expect(records).toHaveLength(1);
    });

    it('ingests activity record', async () => {
      const input: NormalizedHealthRecordInput = {
        provider: 'oura',
        externalId: 'activity-2026-02-05',
        type: 'activity',
        date: '2026-02-05',
        periodStart: '2026-02-05T00:00:00Z',
        periodEnd: '2026-02-05T23:59:59Z',
        score: 78,
        normalizedData: createActivityData(),
        rawData: { id: 'activity-2026-02-05' },
        recordedAt: new Date().toISOString(),
      };

      const record = await healthService.ingestRecord(input);

      expect(record.type).toBe('activity');
      expect(record.score).toBe(78);
    });

    it('ingests readiness record', async () => {
      const input: NormalizedHealthRecordInput = {
        provider: 'oura',
        externalId: 'readiness-2026-02-05',
        type: 'readiness',
        date: '2026-02-05',
        periodStart: '2026-02-05T00:00:00Z',
        periodEnd: '2026-02-05T23:59:59Z',
        score: 82,
        normalizedData: createReadinessData(),
        rawData: { id: 'readiness-2026-02-05' },
        recordedAt: new Date().toISOString(),
      };

      const record = await healthService.ingestRecord(input);

      expect(record.type).toBe('readiness');
      expect(record.score).toBe(82);
    });
  });

  describe('Record Updates', () => {
    it('updates a record and emits update event', async () => {
      const input = createSleepRecordInput('2026-02-05', { score: 80 });
      await healthService.ingestRecord(input);

      const updateInput = createSleepRecordInput('2026-02-05', { score: 85 });
      await healthService.updateRecord(updateInput);

      const events = await eventService.query({ types: ['health.sleep.updated'] });
      expect(events.events.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Record Deletion', () => {
    it('deletes a record by external ID', async () => {
      const input = createSleepRecordInput('2026-02-05');
      await healthService.ingestRecord(input);

      const deleted = await healthService.deleteRecordByExternalId('oura', 'sleep-2026-02-05', 'sleep');

      expect(deleted).toBe(true);

      const records = await healthService.getRecords({ type: 'sleep' });
      expect(records).toHaveLength(0);
    });

    it('emits delete event', async () => {
      const input = createSleepRecordInput('2026-02-05');
      await healthService.ingestRecord(input);

      await healthService.deleteRecordByExternalId('oura', 'sleep-2026-02-05', 'sleep');

      const events = await eventService.query({ types: ['health.sleep.deleted'] });
      expect(events.events).toHaveLength(1);
    });

    it('returns false when record does not exist', async () => {
      const deleted = await healthService.deleteRecordByExternalId('oura', 'nonexistent', 'sleep');

      expect(deleted).toBe(false);
    });
  });

  describe('Record Queries', () => {
    beforeEach(async () => {
      // Create multiple records
      await healthService.ingestRecord(createSleepRecordInput('2026-02-01'));
      await healthService.ingestRecord(createSleepRecordInput('2026-02-02'));
      await healthService.ingestRecord(createSleepRecordInput('2026-02-03'));
      await healthService.ingestRecord({
        provider: 'oura',
        externalId: 'activity-2026-02-03',
        type: 'activity',
        date: '2026-02-03',
        periodStart: '2026-02-03T00:00:00Z',
        periodEnd: '2026-02-03T23:59:59Z',
        score: 78,
        normalizedData: createActivityData(),
        rawData: {},
        recordedAt: new Date().toISOString(),
      });
    });

    it('gets all records', async () => {
      const records = await healthService.getRecords({});

      expect(records).toHaveLength(4);
    });

    it('filters by type', async () => {
      const records = await healthService.getRecords({ type: 'sleep' });

      expect(records).toHaveLength(3);
      expect(records.every((r) => r.type === 'sleep')).toBe(true);
    });

    it('filters by date range', async () => {
      const records = await healthService.getRecords({
        startDate: '2026-02-02',
        endDate: '2026-02-03',
      });

      expect(records).toHaveLength(3); // 2 sleep + 1 activity
    });

    it('respects limit', async () => {
      const records = await healthService.getRecords({ limit: 2 });

      expect(records).toHaveLength(2);
    });

    it('orders by date descending', async () => {
      const records = await healthService.getRecords({ type: 'sleep' });

      expect(records[0].date).toBe('2026-02-03');
      expect(records[2].date).toBe('2026-02-01');
    });

    it('gets latest by type', async () => {
      const latest = await healthService.getLatestByType('sleep');

      expect(latest).not.toBeNull();
      expect(latest?.date).toBe('2026-02-03');
    });

    it('returns null for latest when no records', async () => {
      const latest = await healthService.getLatestByType('hrv');

      expect(latest).toBeNull();
    });
  });

  describe('Sleep Summary', () => {
    beforeEach(async () => {
      // Create a week of sleep data with varying scores
      const dates = ['2026-02-01', '2026-02-02', '2026-02-03', '2026-02-04', '2026-02-05'];
      const scores = [75, 78, 80, 82, 85];

      for (let i = 0; i < dates.length; i++) {
        await healthService.ingestRecord(
          createSleepRecordInput(dates[i], {
            score: scores[i],
            normalizedData: createSleepData({
              score: scores[i],
              totalSleepMinutes: 420 + i * 15, // 7h to 8h
              efficiency: 85 + i * 2,
            }),
          }),
        );
      }
    });

    it('calculates average duration', async () => {
      const summary = await healthService.getSleepSummary('2026-02-01', '2026-02-05');

      expect(summary.totalNights).toBe(5);
      expect(summary.averageDurationMinutes).toBeGreaterThan(0);
    });

    it('calculates average score', async () => {
      const summary = await healthService.getSleepSummary('2026-02-01', '2026-02-05');

      // Average of 75, 78, 80, 82, 85 = 80
      expect(summary.averageScore).toBe(80);
    });

    it('calculates trend as improving when recent scores are higher', async () => {
      const summary = await healthService.getSleepSummary('2026-02-01', '2026-02-05');

      expect(summary.trend).toBe('improving');
    });

    it('returns empty summary when no records', async () => {
      const summary = await healthService.getSleepSummary('2026-01-01', '2026-01-05');

      expect(summary.totalNights).toBe(0);
      expect(summary.averageDurationMinutes).toBe(0);
      expect(summary.averageScore).toBeNull();
      expect(summary.trend).toBe('stable');
    });
  });

  describe('Readiness Score', () => {
    it('gets readiness score for date', async () => {
      await healthService.ingestRecord({
        provider: 'oura',
        externalId: 'readiness-2026-02-05',
        type: 'readiness',
        date: '2026-02-05',
        periodStart: '2026-02-05T00:00:00Z',
        periodEnd: '2026-02-05T23:59:59Z',
        score: 82,
        normalizedData: createReadinessData(),
        rawData: {},
        recordedAt: new Date().toISOString(),
      });

      const score = await healthService.getReadinessScore('2026-02-05');

      expect(score).toBe(82);
    });

    it('returns null when no readiness for date', async () => {
      const score = await healthService.getReadinessScore('2026-01-01');

      expect(score).toBeNull();
    });
  });

  describe('Webhook State', () => {
    it('gets and updates webhook state', async () => {
      const state = await healthService.updateWebhookState({
        id: 'oura',
        subscriptionId: 'sub-123',
        subscribedTypes: ['daily_sleep', 'daily_activity'],
        callbackUrl: 'https://example.com/webhooks/oura',
        expiresAt: '2026-03-05T00:00:00Z',
        lastEventAt: null,
        status: 'active',
        errorMessage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      expect(state.id).toBe('oura');
      expect(state.status).toBe('active');

      const retrieved = await healthService.getWebhookState('oura');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.subscriptionId).toBe('sub-123');
    });

    it('returns null for unknown provider', async () => {
      const state = await healthService.getWebhookState('unknown');

      expect(state).toBeNull();
    });
  });

  describe('Configuration', () => {
    it('uses default configuration', () => {
      expect(healthService.config.defaultQueryLimit).toBe(7);
      expect(healthService.config.maxQueryLimit).toBe(100);
    });

    it('accepts custom configuration', () => {
      const customService = new HealthService(services, {
        defaultQueryLimit: 14,
        maxQueryLimit: 50,
      });

      expect(customService.config.defaultQueryLimit).toBe(14);
      expect(customService.config.maxQueryLimit).toBe(50);
    });
  });
});
