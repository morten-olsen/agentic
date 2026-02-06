import { z } from 'zod';

// ============================================================================
// Oura Data Types
// ============================================================================

const ouraDataTypeSchema = z.enum([
  'daily_activity',
  'daily_readiness',
  'daily_sleep',
  'daily_spo2',
  'daily_stress',
  'heart_rate',
  'session',
  'sleep',
  'sleep_time',
  'workout',
  'tag',
  'enhanced_tag',
  'daily_cardiovascular_age',
  'vo2_max',
  'daily_resilience',
  'rest_mode_period',
]);

type OuraDataType = z.infer<typeof ouraDataTypeSchema>;

const ouraEventTypeSchema = z.enum(['create', 'update', 'delete']);

type OuraEventType = z.infer<typeof ouraEventTypeSchema>;

// ============================================================================
// Oura Webhook Payload
// ============================================================================

const ouraWebhookPayloadSchema = z.object({
  event_type: ouraEventTypeSchema,
  data_type: ouraDataTypeSchema,
  event_time: z.string(),
  user_id: z.string(),
  data: z.record(z.string(), z.unknown()),
});

type OuraWebhookPayload = z.infer<typeof ouraWebhookPayloadSchema>;

// ============================================================================
// Oura API Response Types
// ============================================================================

const ouraDailySleepContributorsSchema = z.object({
  total_sleep: z.number().nullable().optional(),
  rem_sleep: z.number().nullable().optional(),
  deep_sleep: z.number().nullable().optional(),
  efficiency: z.number().nullable().optional(),
  latency: z.number().nullable().optional(),
  restfulness: z.number().nullable().optional(),
  timing: z.number().nullable().optional(),
});

const ouraDailySleepDataSchema = z.object({
  id: z.string(),
  day: z.string(), // YYYY-MM-DD
  score: z.number().nullable().optional(),
  contributors: ouraDailySleepContributorsSchema.optional(),
  timestamp: z.string().optional(), // ISO8601
});

type OuraDailySleepData = z.infer<typeof ouraDailySleepDataSchema>;

// Extended sleep data with detailed fields (from sleep endpoint)
const ouraSleepDataSchema = z.object({
  id: z.string(),
  day: z.string(), // YYYY-MM-DD
  bedtime_start: z.string(), // ISO8601
  bedtime_end: z.string(), // ISO8601
  total_sleep_duration: z.number().nullable().optional(), // seconds
  rem_sleep_duration: z.number().nullable().optional(), // seconds
  deep_sleep_duration: z.number().nullable().optional(), // seconds
  light_sleep_duration: z.number().nullable().optional(), // seconds
  awake_time: z.number().nullable().optional(), // seconds
  efficiency: z.number().nullable().optional(), // percentage
  latency: z.number().nullable().optional(), // seconds
  average_heart_rate: z.number().nullable().optional(),
  lowest_heart_rate: z.number().nullable().optional(),
  average_hrv: z.number().nullable().optional(),
  average_breath: z.number().nullable().optional(),
  type: z.string().optional(), // 'long_sleep', 'deleted', 'sleep', 'rest'
});

type OuraSleepData = z.infer<typeof ouraSleepDataSchema>;

const ouraDailyActivityContributorsSchema = z.object({
  meet_daily_targets: z.number().nullable().optional(),
  move_every_hour: z.number().nullable().optional(),
  recovery_time: z.number().nullable().optional(),
  stay_active: z.number().nullable().optional(),
  training_frequency: z.number().nullable().optional(),
  training_volume: z.number().nullable().optional(),
});

const ouraDailyActivityDataSchema = z.object({
  id: z.string(),
  day: z.string(), // YYYY-MM-DD
  score: z.number().nullable().optional(),
  active_calories: z.number().nullable().optional(),
  total_calories: z.number().nullable().optional(),
  steps: z.number().nullable().optional(),
  equivalent_walking_distance: z.number().nullable().optional(), // meters
  sedentary_time: z.number().nullable().optional(), // seconds
  low_activity_time: z.number().nullable().optional(), // seconds
  medium_activity_time: z.number().nullable().optional(), // seconds
  high_activity_time: z.number().nullable().optional(), // seconds
  target_calories: z.number().nullable().optional(),
  contributors: ouraDailyActivityContributorsSchema.optional(),
  timestamp: z.string().optional(), // ISO8601
});

type OuraDailyActivityData = z.infer<typeof ouraDailyActivityDataSchema>;

const ouraDailyReadinessContributorsSchema = z.object({
  activity_balance: z.number().nullable().optional(),
  body_temperature: z.number().nullable().optional(),
  hrv_balance: z.number().nullable().optional(),
  previous_day_activity: z.number().nullable().optional(),
  previous_night: z.number().nullable().optional(),
  recovery_index: z.number().nullable().optional(),
  resting_heart_rate: z.number().nullable().optional(),
  sleep_balance: z.number().nullable().optional(),
});

const ouraDailyReadinessDataSchema = z.object({
  id: z.string(),
  day: z.string(), // YYYY-MM-DD
  score: z.number().nullable().optional(),
  contributors: ouraDailyReadinessContributorsSchema.optional(),
  temperature_deviation: z.number().nullable().optional(),
  temperature_trend_deviation: z.number().nullable().optional(),
  timestamp: z.string().optional(), // ISO8601
});

type OuraDailyReadinessData = z.infer<typeof ouraDailyReadinessDataSchema>;

// ============================================================================
// Oura Subscription Types
// ============================================================================

const ouraSubscriptionSchema = z.object({
  id: z.string(),
  callback_url: z.string(),
  data_type: ouraDataTypeSchema,
  event_type: ouraEventTypeSchema,
  expiration_time: z.string().optional(), // ISO8601
});

type OuraSubscription = z.infer<typeof ouraSubscriptionSchema>;

const createSubscriptionInputSchema = z.object({
  callback_url: z.string().url(),
  data_type: ouraDataTypeSchema,
  event_type: ouraEventTypeSchema,
});

type CreateSubscriptionInput = z.infer<typeof createSubscriptionInputSchema>;

// ============================================================================
// Exports
// ============================================================================

export type {
  OuraDataType,
  OuraEventType,
  OuraWebhookPayload,
  OuraDailySleepData,
  OuraSleepData,
  OuraDailyActivityData,
  OuraDailyReadinessData,
  OuraSubscription,
  CreateSubscriptionInput,
};

export {
  ouraDataTypeSchema,
  ouraEventTypeSchema,
  ouraWebhookPayloadSchema,
  ouraDailySleepDataSchema,
  ouraSleepDataSchema,
  ouraDailyActivityDataSchema,
  ouraDailyReadinessDataSchema,
  ouraSubscriptionSchema,
  createSubscriptionInputSchema,
};
