import { z } from 'zod';

// ============================================================================
// Health Record Types
// ============================================================================

const healthRecordTypeSchema = z.enum([
  'sleep',
  'activity',
  'readiness',
  'heart_rate',
  'hrv',
  'spo2',
  'stress',
  'workout',
  'cardiovascular_age',
  'vo2_max',
  'resilience',
]);

type HealthRecordType = z.infer<typeof healthRecordTypeSchema>;

const healthProviderSchema = z.enum(['oura', 'whoop', 'garmin', 'fitbit', 'apple_health', 'manual']);

type HealthProvider = z.infer<typeof healthProviderSchema>;

// ============================================================================
// Normalized Data Schemas
// ============================================================================

const sleepDataSchema = z.object({
  // Duration
  totalSleepMinutes: z.number(),
  remSleepMinutes: z.number().nullable(),
  deepSleepMinutes: z.number().nullable(),
  lightSleepMinutes: z.number().nullable(),
  awakeDurationMinutes: z.number().nullable(),

  // Timing
  bedtimeStart: z.string().datetime(),
  bedtimeEnd: z.string().datetime(),

  // Quality metrics
  efficiency: z.number().min(0).max(100).nullable(), // Sleep efficiency %
  latencyMinutes: z.number().nullable(), // Time to fall asleep

  // Biometrics during sleep
  averageHeartRate: z.number().nullable(),
  lowestHeartRate: z.number().nullable(),
  averageHrv: z.number().nullable(),
  respiratoryRate: z.number().nullable(),

  // Score (provider's overall assessment)
  score: z.number().min(0).max(100).nullable(),
});

type SleepData = z.infer<typeof sleepDataSchema>;

const activityDataSchema = z.object({
  // Movement
  steps: z.number().nullable(),
  activeCalories: z.number().nullable(),
  totalCalories: z.number().nullable(),

  // Activity levels (minutes)
  sedentaryMinutes: z.number().nullable(),
  lightlyActiveMinutes: z.number().nullable(),
  moderatelyActiveMinutes: z.number().nullable(),
  vigorouslyActiveMinutes: z.number().nullable(),

  // Goals
  targetCalories: z.number().nullable(),
  targetSteps: z.number().nullable(),

  // Score
  score: z.number().min(0).max(100).nullable(),
});

type ActivityData = z.infer<typeof activityDataSchema>;

const readinessDataSchema = z.object({
  score: z.number().min(0).max(100),

  // Contributing factors (0-100 each)
  previousNightScore: z.number().nullable(),
  sleepBalanceScore: z.number().nullable(),
  previousDayActivityScore: z.number().nullable(),
  activityBalanceScore: z.number().nullable(),
  bodyTemperatureScore: z.number().nullable(),
  restingHeartRateScore: z.number().nullable(),
  hrvBalanceScore: z.number().nullable(),
  recoveryIndexScore: z.number().nullable(),
});

type ReadinessData = z.infer<typeof readinessDataSchema>;

// Generic data for types that don't have normalized schemas yet
const genericHealthDataSchema = z.record(z.string(), z.unknown());

type GenericHealthData = z.infer<typeof genericHealthDataSchema>;

// Union of all normalized data types
type NormalizedData = SleepData | ActivityData | ReadinessData | GenericHealthData;

// ============================================================================
// Health Record
// ============================================================================

const healthRecordSchema = z.object({
  id: z.string(),

  // Source identification
  provider: healthProviderSchema,
  externalId: z.string(), // Provider's unique ID

  // Record type and timing
  type: healthRecordTypeSchema,
  date: z.string(), // YYYY-MM-DD for daily records
  periodStart: z.string().datetime(), // ISO8601 start of measurement period
  periodEnd: z.string().datetime(), // ISO8601 end of measurement period

  // Normalized score
  score: z.number().min(0).max(100).nullable(),

  // Data
  normalizedData: z.union([sleepDataSchema, activityDataSchema, readinessDataSchema, genericHealthDataSchema]),
  rawData: z.record(z.string(), z.unknown()),

  // Timestamps
  recordedAt: z.string().datetime(), // When provider recorded this
  receivedAt: z.string().datetime(), // When we received via webhook
  createdAt: z.string().datetime(),
});

type HealthRecord = z.infer<typeof healthRecordSchema>;

// ============================================================================
// Input Types
// ============================================================================

/**
 * Input for ingesting a normalized health record (from webhook handlers).
 */
const normalizedHealthRecordInputSchema = z.object({
  provider: healthProviderSchema,
  externalId: z.string(),
  type: healthRecordTypeSchema,
  date: z.string(), // YYYY-MM-DD
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  score: z.number().min(0).max(100).nullable(),
  normalizedData: z.union([sleepDataSchema, activityDataSchema, readinessDataSchema, genericHealthDataSchema]),
  rawData: z.record(z.string(), z.unknown()),
  recordedAt: z.string().datetime(),
});

type NormalizedHealthRecordInput = z.infer<typeof normalizedHealthRecordInputSchema>;

// ============================================================================
// Query Types
// ============================================================================

const healthQueryFilterSchema = z.object({
  type: healthRecordTypeSchema.optional(),
  provider: healthProviderSchema.optional(),
  startDate: z.string().optional(), // YYYY-MM-DD
  endDate: z.string().optional(), // YYYY-MM-DD
  limit: z.number().max(100).optional().default(7),
});

type HealthQueryFilter = z.input<typeof healthQueryFilterSchema>;

// ============================================================================
// Summary Types
// ============================================================================

const sleepSummarySchema = z.object({
  averageDurationMinutes: z.number(),
  averageScore: z.number().nullable(),
  averageEfficiency: z.number().nullable(),
  totalNights: z.number(),
  trend: z.enum(['improving', 'declining', 'stable']),
});

type SleepSummary = z.infer<typeof sleepSummarySchema>;

// ============================================================================
// Webhook State
// ============================================================================

const webhookStatusSchema = z.enum(['active', 'expired', 'error']);

type WebhookStatus = z.infer<typeof webhookStatusSchema>;

const healthWebhookStateSchema = z.object({
  id: z.string(), // Provider ID
  subscriptionId: z.string().nullable(),
  subscribedTypes: z.array(z.string()),
  callbackUrl: z.string(),
  expiresAt: z.string().datetime().nullable(),
  lastEventAt: z.string().datetime().nullable(),
  status: webhookStatusSchema,
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

type HealthWebhookState = z.infer<typeof healthWebhookStateSchema>;

// ============================================================================
// Exports
// ============================================================================

export type {
  HealthRecordType,
  HealthProvider,
  SleepData,
  ActivityData,
  ReadinessData,
  GenericHealthData,
  NormalizedData,
  HealthRecord,
  NormalizedHealthRecordInput,
  HealthQueryFilter,
  SleepSummary,
  WebhookStatus,
  HealthWebhookState,
};

export {
  healthRecordTypeSchema,
  healthProviderSchema,
  sleepDataSchema,
  activityDataSchema,
  readinessDataSchema,
  genericHealthDataSchema,
  healthRecordSchema,
  normalizedHealthRecordInputSchema,
  healthQueryFilterSchema,
  sleepSummarySchema,
  webhookStatusSchema,
  healthWebhookStateSchema,
};
