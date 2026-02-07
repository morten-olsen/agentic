import type {
  NormalizedHealthRecordInput,
  HealthRecordType,
  SleepData,
  ActivityData,
  ReadinessData,
  GenericHealthData,
} from '../../../integrations/health/health.schemas.ts';

import type {
  OuraWebhookPayload,
  OuraDataType,
  OuraSleepData,
  OuraDailyActivityData,
  OuraDailyReadinessData,
} from './oura.schemas.ts';

// ============================================================================
// Type Mapping
// ============================================================================

/**
 * Maps Oura data types to our normalized health record types.
 */
const ouraDataTypeToHealthType: Partial<Record<OuraDataType, HealthRecordType>> = {
  daily_sleep: 'sleep',
  sleep: 'sleep',
  daily_activity: 'activity',
  daily_readiness: 'readiness',
  daily_spo2: 'spo2',
  daily_stress: 'stress',
  workout: 'workout',
  heart_rate: 'heart_rate',
  daily_cardiovascular_age: 'cardiovascular_age',
  vo2_max: 'vo2_max',
  daily_resilience: 'resilience',
};

// ============================================================================
// Sleep Normalizer
// ============================================================================

/**
 * Normalizes Oura sleep data to our SleepData schema.
 */
const normalizeOuraSleep = (data: OuraSleepData): SleepData => {
  // Convert seconds to minutes
  const secondsToMinutes = (seconds: number | null | undefined): number | null => {
    if (seconds === null || seconds === undefined) return null;
    return Math.round(seconds / 60);
  };

  return {
    totalSleepMinutes: secondsToMinutes(data.total_sleep_duration) ?? 0,
    remSleepMinutes: secondsToMinutes(data.rem_sleep_duration),
    deepSleepMinutes: secondsToMinutes(data.deep_sleep_duration),
    lightSleepMinutes: secondsToMinutes(data.light_sleep_duration),
    awakeDurationMinutes: secondsToMinutes(data.awake_time),

    bedtimeStart: data.bedtime_start,
    bedtimeEnd: data.bedtime_end,

    efficiency: data.efficiency ?? null,
    latencyMinutes: secondsToMinutes(data.latency),

    averageHeartRate: data.average_heart_rate ?? null,
    lowestHeartRate: data.lowest_heart_rate ?? null,
    averageHrv: data.average_hrv ?? null,
    respiratoryRate: data.average_breath ?? null,

    // Score comes from the webhook data, not the sleep data itself
    score: null,
  };
};

// ============================================================================
// Activity Normalizer
// ============================================================================

/**
 * Normalizes Oura activity data to our ActivityData schema.
 */
const normalizeOuraActivity = (data: OuraDailyActivityData): ActivityData => {
  // Convert seconds to minutes
  const secondsToMinutes = (seconds: number | null | undefined): number | null => {
    if (seconds === null || seconds === undefined) return null;
    return Math.round(seconds / 60);
  };

  return {
    steps: data.steps ?? null,
    activeCalories: data.active_calories ?? null,
    totalCalories: data.total_calories ?? null,

    sedentaryMinutes: secondsToMinutes(data.sedentary_time),
    lightlyActiveMinutes: secondsToMinutes(data.low_activity_time),
    moderatelyActiveMinutes: secondsToMinutes(data.medium_activity_time),
    vigorouslyActiveMinutes: secondsToMinutes(data.high_activity_time),

    targetCalories: data.target_calories ?? null,
    targetSteps: null, // Oura uses calories as primary goal

    score: data.score ?? null,
  };
};

// ============================================================================
// Readiness Normalizer
// ============================================================================

/**
 * Normalizes Oura readiness data to our ReadinessData schema.
 */
const normalizeOuraReadiness = (data: OuraDailyReadinessData): ReadinessData => {
  return {
    score: data.score ?? 0,

    previousNightScore: data.contributors?.previous_night ?? null,
    sleepBalanceScore: data.contributors?.sleep_balance ?? null,
    previousDayActivityScore: data.contributors?.previous_day_activity ?? null,
    activityBalanceScore: data.contributors?.activity_balance ?? null,
    bodyTemperatureScore: data.contributors?.body_temperature ?? null,
    restingHeartRateScore: data.contributors?.resting_heart_rate ?? null,
    hrvBalanceScore: data.contributors?.hrv_balance ?? null,
    recoveryIndexScore: data.contributors?.recovery_index ?? null,
  };
};

// ============================================================================
// Main Normalizer
// ============================================================================

/**
 * Normalizes an Oura webhook payload to our generic health record input.
 */
const normalizeOuraWebhook = (payload: OuraWebhookPayload): NormalizedHealthRecordInput | null => {
  const data = payload.data;
  const healthType = ouraDataTypeToHealthType[payload.data_type];

  if (!healthType) {
    // Unsupported data type
    return null;
  }

  // Extract common fields
  const day = (data.day as string) ?? new Date().toISOString().split('T')[0];
  const externalId = (data.id as string) ?? `${payload.user_id}-${day}-${payload.data_type}`;

  // Calculate period start/end based on data type
  let periodStart: string;
  let periodEnd: string;

  if (payload.data_type === 'sleep' || payload.data_type === 'daily_sleep') {
    // Sleep has explicit times
    periodStart = (data.bedtime_start as string) ?? `${day}T00:00:00Z`;
    periodEnd = (data.bedtime_end as string) ?? `${day}T23:59:59Z`;
  } else {
    // Daily data covers the full day
    periodStart = `${day}T00:00:00Z`;
    periodEnd = `${day}T23:59:59Z`;
  }

  // Normalize data based on type
  let normalizedData: SleepData | ActivityData | ReadinessData | GenericHealthData;
  let score: number | null = null;

  switch (payload.data_type) {
    case 'daily_sleep':
    case 'sleep':
      normalizedData = normalizeOuraSleep(data as unknown as OuraSleepData);
      score = (data.score as number) ?? normalizedData.score;
      break;
    case 'daily_activity': {
      const activityData = normalizeOuraActivity(data as unknown as OuraDailyActivityData);
      normalizedData = activityData;
      score = activityData.score;
      break;
    }
    case 'daily_readiness': {
      const readinessData = normalizeOuraReadiness(data as unknown as OuraDailyReadinessData);
      normalizedData = readinessData;
      score = readinessData.score;
      break;
    }
    default:
      // For other types, just store the raw data
      normalizedData = data as GenericHealthData;
      score = (data.score as number) ?? null;
  }

  return {
    provider: 'oura',
    externalId,
    type: healthType,
    date: day,
    periodStart,
    periodEnd,
    score,
    normalizedData,
    rawData: data as Record<string, unknown>,
    recordedAt: payload.event_time,
  };
};

// ============================================================================
// Exports
// ============================================================================

export {
  normalizeOuraSleep,
  normalizeOuraActivity,
  normalizeOuraReadiness,
  normalizeOuraWebhook,
  ouraDataTypeToHealthType,
};
