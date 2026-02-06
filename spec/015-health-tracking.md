# Health & Wellness Tracking Specification

> Unified health data ingestion from wearable devices and health platforms via webhooks

**Version**: 1.0
**Status**: Draft
**Dependencies**: 014-event-log.md, 009-external-services.md

## Overview

This specification introduces a generic health tracking system that ingests data from various wearable devices and health platforms. The system is designed to be brand-agnostic, with Oura Ring as the first implementation.

Rather than polling APIs periodically, this system uses webhooks to receive near real-time updates when health data is available. This requires adding an API server to GLaDOS.

### Goals

1. **Brand-Agnostic Architecture**: Generic health data model that works across different providers (Oura, Whoop, Apple Health, etc.)
2. **Webhook-First**: Use webhooks for near real-time data ingestion (Oura's recommended approach)
3. **Event Log Integration**: Health data flows into the Event Log for agent awareness
4. **Stable API Endpoints**: API routes are permanent to avoid reconfiguring webhooks later
5. **Simple API Server**: Minimal Fastify server, extensible for future API needs

### Non-Goals (for v1)

- Complex aggregations or analytics (future consideration)
- Multiple simultaneous providers (start with Oura only)
- Write operations back to health platforms
- Real-time dashboards or visualizations
- Apple Health integration (requires iOS app, different architecture)
- Historical data backfill (webhooks are for new data only)

### Key Design Decisions

1. **Fastify for API Server**: Lightweight, fast, excellent TypeScript support
2. **Webhook Authentication**: Verify webhook signatures to ensure authenticity
3. **Normalized Health Model**: Provider-specific data is normalized to a common schema
4. **Event-Driven**: All health data emits to Event Log for downstream consumers
5. **Separate from CLI/Telegram**: API server runs independently, shares services

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        Health Tracking System                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                   │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │                        External Health Providers                          │   │
│   │                                                                           │   │
│   │   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐               │   │
│   │   │   Oura   │  │  Whoop   │  │  Garmin  │  │  Fitbit  │  (future)     │   │
│   │   └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘               │   │
│   │        │              │              │              │                    │   │
│   └────────┼──────────────┼──────────────┼──────────────┼────────────────────┘   │
│            │              │              │              │                        │
│            │         Webhooks (HTTPS POST)             │                        │
│            │              │              │              │                        │
│            ▼              ▼              ▼              ▼                        │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │                        Fastify API Server                                │   │
│   │                                                                          │   │
│   │   POST /api/v1/webhooks/oura      ──────▶  OuraWebhookHandler           │   │
│   │   POST /api/v1/webhooks/whoop     ──────▶  WhoopWebhookHandler (future) │   │
│   │   GET  /api/v1/health             ──────▶  Health check                 │   │
│   │                                                                          │   │
│   └────────────────────────────────────┬────────────────────────────────────┘   │
│                                        │                                         │
│                                        ▼                                         │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │                        HealthService                                     │   │
│   │                                                                          │   │
│   │   - Normalize provider data to common schema                            │   │
│   │   - Store health records                                                │   │
│   │   - Emit events to Event Log                                            │   │
│   │                                                                          │   │
│   │   handleOuraWebhook(payload) ──▶ normalize ──▶ store ──▶ emit event    │   │
│   │                                                                          │   │
│   └────────────────────────────────────┬────────────────────────────────────┘   │
│                                        │                                         │
│               ┌────────────────────────┼────────────────────────────────┐       │
│               │                        │                                │       │
│               ▼                        ▼                                ▼       │
│   ┌───────────────────┐    ┌───────────────────┐    ┌───────────────────┐      │
│   │   Health Store    │    │   Event Log       │    │   Agent Tools     │      │
│   │   (SQLite)        │    │                   │    │                   │      │
│   │                   │    │  health.sleep.*   │    │  get_health_data  │      │
│   │   health_records  │    │  health.activity.*│    │  get_sleep_summary│      │
│   │   health_sync     │    │  health.readiness │    │                   │      │
│   └───────────────────┘    └───────────────────┘    └───────────────────┘      │
│                                                                                   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Webhook Flow

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                         Oura Webhook Flow                                          │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                    │
│  1. SUBSCRIPTION SETUP (one-time, via Oura developer portal or API)               │
│     ┌───────────────────────────────────────────────────────────────────────┐    │
│     │  POST https://api.ouraring.com/v2/webhook/subscription                 │    │
│     │  {                                                                     │    │
│     │    "callback_url": "https://your-domain.com/api/v1/webhooks/oura",    │    │
│     │    "event_type": "create",  // or "update", "delete"                  │    │
│     │    "data_type": "daily_sleep"  // or "daily_activity", etc.           │    │
│     │  }                                                                     │    │
│     └───────────────────────────────────────────────────────────────────────┘    │
│                                                                                    │
│  2. WEBHOOK DELIVERY (when Oura has new data)                                     │
│     ┌───────────────────────────────────────────────────────────────────────┐    │
│     │  Oura Cloud ──POST──▶ https://your-domain.com/api/v1/webhooks/oura    │    │
│     │                                                                        │    │
│     │  Headers:                                                              │    │
│     │    X-Oura-Signature: sha256=<signature>                               │    │
│     │                                                                        │    │
│     │  Body:                                                                 │    │
│     │    {                                                                   │    │
│     │      "event_type": "create",                                          │    │
│     │      "data_type": "daily_sleep",                                      │    │
│     │      "event_time": "2026-02-06T08:00:00Z",                            │    │
│     │      "user_id": "abc123",                                             │    │
│     │      "data": { ... sleep data ... }                                   │    │
│     │    }                                                                   │    │
│     └───────────────────────────────────────────────────────────────────────┘    │
│                                                                                    │
│  3. PROCESSING                                                                     │
│     ┌───────────────────────────────────────────────────────────────────────┐    │
│     │  Verify signature ──▶ Parse payload ──▶ Normalize data                │    │
│     │                                  │                                     │    │
│     │                                  ▼                                     │    │
│     │                          Store in health_records                       │    │
│     │                                  │                                     │    │
│     │                                  ▼                                     │    │
│     │                          Emit to Event Log                             │    │
│     │                          type: 'health.sleep.logged'                   │    │
│     └───────────────────────────────────────────────────────────────────────┘    │
│                                                                                    │
│  4. RESPONSE                                                                       │
│     ┌───────────────────────────────────────────────────────────────────────┐    │
│     │  Return HTTP 200 OK (Oura requires quick response)                    │    │
│     │  Process asynchronously if needed                                      │    │
│     └───────────────────────────────────────────────────────────────────────┘    │
│                                                                                    │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## API Server

### Fastify Setup

The API server is integrated into the existing `src/server/server.ts`, running alongside the Telegram bot in the same process. This provides:

- Single deployment target
- Shared service container
- Unified startup/shutdown handling
- Simpler operational model

```
src/
├── api/
│   ├── api.ts                    # Fastify server factory
│   ├── api.schemas.ts            # Request/response schemas
│   ├── routes/
│   │   ├── health.ts             # Health check endpoint
│   │   └── webhooks/
│   │       ├── oura.ts           # Oura webhook handler
│   │       └── index.ts          # Webhook routes registration
│   └── middleware/
│       ├── signature.ts          # Webhook signature verification
│       └── error-handler.ts      # Error handling
```

### Server Configuration

```typescript
// src/api/api.config.ts

type ApiConfig = {
  // Server
  host: string;           // Default: '0.0.0.0'
  port: number;           // Default: 3000

  // Base path (for reverse proxy setups)
  basePath: string;       // Default: '/api/v1'

  // Security
  trustProxy: boolean;    // Default: false, set true behind nginx/cloudflare

  // Rate limiting (future)
  rateLimit?: {
    max: number;          // Requests per window
    windowMs: number;     // Window in milliseconds
  };
};
```

### Environment Variables

```bash
# API Server
GLADOS_API_ENABLED=true              # Set to false to disable API server entirely
GLADOS_API_HOST=0.0.0.0
GLADOS_API_PORT=3000
GLADOS_API_TRUST_PROXY=true
GLADOS_API_PUBLIC_URL=https://glados.example.com  # Public URL for webhook callbacks

# Oura Integration
GLADOS_OURA_CLIENT_ID=your-client-id
GLADOS_OURA_CLIENT_SECRET=your-client-secret
GLADOS_OURA_WEBHOOK_SECRET=your-webhook-secret
```

**Note:** `GLADOS_API_PUBLIC_URL` is the externally-accessible URL where Oura (and other webhook providers) will send callbacks. This must be:
- HTTPS (required by most providers)
- Publicly accessible from the internet
- Pointing to your GLaDOS server (directly or via reverse proxy)

### Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Health check (returns 200 OK) |
| POST | `/api/v1/webhooks/oura` | Oura webhook receiver |

### Fastify Server Implementation

```typescript
// src/api/api.ts

import Fastify from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';

const createApiServer = async (deps: {
  services: ServiceContainer;
  config: Config;
  logger: Logger;
}): Promise<FastifyInstance> => {
  const fastify = Fastify({
    logger: deps.logger,
  }).withTypeProvider<TypeBoxTypeProvider>();

  // Register error handler
  fastify.setErrorHandler(errorHandler);

  // Health check
  fastify.get('/api/v1/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Webhook routes
  await fastify.register(webhookRoutes, { prefix: '/api/v1/webhooks' });

  return fastify;
};

const startApiServer = async (fastify: FastifyInstance, config: ApiConfig): Promise<void> => {
  await fastify.listen({
    host: config.host,
    port: config.port,
  });
};
```

---

## Data Model

### Generic Health Record

A normalized schema that works across providers:

```typescript
// src/health/health.schemas.ts

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

const healthProviderSchema = z.enum([
  'oura',
  'whoop',
  'garmin',
  'fitbit',
  'apple_health',
  'manual',
]);

type HealthProvider = z.infer<typeof healthProviderSchema>;

const healthRecordSchema = z.object({
  id: z.string().ulid(),

  // Source identification
  provider: healthProviderSchema,
  externalId: z.string(),              // Provider's unique ID

  // Record type and timing
  type: healthRecordTypeSchema,
  date: z.string(),                    // YYYY-MM-DD for daily records
  periodStart: z.string().datetime(),  // ISO8601 start of measurement period
  periodEnd: z.string().datetime(),    // ISO8601 end of measurement period

  // Normalized data (provider-agnostic fields)
  score: z.number().min(0).max(100).nullable(),  // Overall score (0-100)

  // Provider-specific data (full payload)
  rawData: z.record(z.string(), z.unknown()),

  // Timestamps
  recordedAt: z.string().datetime(),   // When provider recorded this
  receivedAt: z.string().datetime(),   // When we received via webhook
  createdAt: z.string().datetime(),
});

type HealthRecord = z.infer<typeof healthRecordSchema>;
```

### Sleep Data (Normalized)

```typescript
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
  efficiency: z.number().min(0).max(100).nullable(),  // Sleep efficiency %
  latencyMinutes: z.number().nullable(),               // Time to fall asleep

  // Biometrics during sleep
  averageHeartRate: z.number().nullable(),
  lowestHeartRate: z.number().nullable(),
  averageHrv: z.number().nullable(),
  respiratoryRate: z.number().nullable(),

  // Score (provider's overall assessment)
  score: z.number().min(0).max(100).nullable(),
});

type SleepData = z.infer<typeof sleepDataSchema>;
```

### Activity Data (Normalized)

```typescript
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
```

### Readiness Data (Normalized)

```typescript
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
```

---

## Oura Integration

Oura follows the External Services pattern (see `docs/external-services.md`), providing:
- Configuration via environment variables
- Service definition with `isConfigured` and `createClient`
- Tools with `requiredServices: ['oura']`
- Lazy initialization via `ExternalServiceRegistry`

### External Service Definition

```typescript
// src/external/oura/oura.ts

import { getConfig, isOuraConfigured } from '../../config/config.ts';
import type { ExternalServiceDefinition, ServiceClient } from '../external.schemas.ts';

type OuraClient = ServiceClient & {
  // OAuth token management
  getAccessToken(): Promise<string>;
  refreshToken(): Promise<void>;

  // Subscription management
  listSubscriptions(): Promise<OuraSubscription[]>;
  createSubscription(input: CreateSubscriptionInput): Promise<OuraSubscription>;
  deleteSubscription(id: string): Promise<void>;
  renewSubscription(id: string): Promise<OuraSubscription>;

  // Data fetching (for historical import, if needed)
  getDailySleep(startDate: string, endDate: string): Promise<OuraDailySleep[]>;
  getDailyActivity(startDate: string, endDate: string): Promise<OuraDailyActivity[]>;
  getDailyReadiness(startDate: string, endDate: string): Promise<OuraDailyReadiness[]>;
};

const ouraDefinition: ExternalServiceDefinition = {
  id: 'oura',
  name: 'Oura Ring',
  description: 'Health and wellness data from Oura Ring',

  isConfigured: isOuraConfigured,

  createClient: async (): Promise<OuraClient> => {
    const config = getConfig();

    return {
      getAccessToken: async () => {
        // OAuth2 token management
        // Uses client credentials for webhook subscriptions
        return await fetchOAuthToken(config.oura.clientId, config.oura.clientSecret);
      },

      listSubscriptions: async () => { /* ... */ },
      createSubscription: async (input) => { /* ... */ },
      deleteSubscription: async (id) => { /* ... */ },
      renewSubscription: async (id) => { /* ... */ },

      getDailySleep: async (startDate, endDate) => { /* ... */ },
      getDailyActivity: async (startDate, endDate) => { /* ... */ },
      getDailyReadiness: async (startDate, endDate) => { /* ... */ },

      disconnect: async () => {
        // No persistent connection to clean up
      },
    };
  },
};

export type { OuraClient };
export { ouraDefinition };
```

### Registration

```typescript
// src/external/external.tools.ts

import { ouraDefinition } from './oura/oura.ts';

const registerExternalServices = (registry: ExternalServiceRegistry): void => {
  registry.register(homeassistantDefinition);
  registry.register(ouraDefinition);  // Add Oura
};
```

### Oura Webhook Payload

Based on [Oura API v2 documentation](https://cloud.ouraring.com/v2/docs):

```typescript
// src/health/providers/oura/oura.schemas.ts

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

const ouraEventTypeSchema = z.enum([
  'create',
  'update',
  'delete',
]);

type OuraEventType = z.infer<typeof ouraEventTypeSchema>;

const ouraWebhookPayloadSchema = z.object({
  event_type: ouraEventTypeSchema,
  data_type: ouraDataTypeSchema,
  event_time: z.string().datetime(),
  user_id: z.string(),
  data: z.record(z.string(), z.unknown()),
});

type OuraWebhookPayload = z.infer<typeof ouraWebhookPayloadSchema>;
```

### Oura Webhook Handler

The webhook handler receives data from Oura, normalizes it using the Oura normalizer, and passes it to the HealthService for storage and event emission.

```typescript
// src/api/routes/webhooks/oura.ts

import { normalizeOuraWebhook } from '../../external/oura/oura.normalizer.ts';

type OuraWebhookRouteOptions = {
  healthService: HealthService;
  config: Config;
  logger: Logger;
};

const ouraWebhookRoute: FastifyPluginCallback<OuraWebhookRouteOptions> = (
  fastify,
  opts,
  done,
) => {
  const { healthService, config, logger } = opts;

  // Signature verification middleware
  const verifySignature = async (request: FastifyRequest): Promise<void> => {
    const signature = request.headers['x-oura-signature'];
    if (!signature || typeof signature !== 'string') {
      throw new UnauthorizedError('Missing signature');
    }

    const expectedSignature = crypto
      .createHmac('sha256', config.oura.webhookSecret)
      .update(JSON.stringify(request.body))
      .digest('hex');

    const providedSignature = signature.replace('sha256=', '');

    if (!crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(providedSignature),
    )) {
      throw new UnauthorizedError('Invalid signature');
    }
  };

  fastify.post('/oura', {
    preHandler: [verifySignature],
    schema: {
      body: ouraWebhookPayloadSchema,
    },
  }, async (request, reply) => {
    const payload = request.body as OuraWebhookPayload;

    // Respond quickly (Oura expects fast responses)
    reply.status(200).send({ received: true });

    // Process asynchronously
    try {
      // Normalize Oura data to generic health record
      const normalizedRecord = normalizeOuraWebhook(payload);

      // Store and emit event
      await healthService.ingestRecord(normalizedRecord);
    } catch (err) {
      logger.error('Failed to process Oura webhook', {
        error: err,
        dataType: payload.data_type,
        eventType: payload.event_type,
      });
    }
  });

  done();
};
```

### Signature Verification

```typescript
// src/api/middleware/signature.ts

const verifyOuraSignature = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const signature = request.headers['x-oura-signature'];

  if (!signature || typeof signature !== 'string') {
    throw new UnauthorizedError('Missing signature');
  }

  const expectedSignature = crypto
    .createHmac('sha256', config.oura.webhookSecret)
    .update(JSON.stringify(request.body))
    .digest('hex');

  const providedSignature = signature.replace('sha256=', '');

  if (!crypto.timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(providedSignature),
  )) {
    throw new UnauthorizedError('Invalid signature');
  }
};
```

### Oura Data Normalizer

```typescript
// src/health/providers/oura/oura.normalizer.ts

const normalizeOuraSleep = (data: OuraDailySleepData): SleepData => {
  return {
    totalSleepMinutes: data.contributors?.total_sleep ?? 0,
    remSleepMinutes: data.contributors?.rem_sleep ?? null,
    deepSleepMinutes: data.contributors?.deep_sleep ?? null,
    lightSleepMinutes: null, // Oura doesn't provide this directly
    awakeDurationMinutes: data.contributors?.awake_time ?? null,

    bedtimeStart: data.bedtime_start,
    bedtimeEnd: data.bedtime_end,

    efficiency: data.contributors?.efficiency ?? null,
    latencyMinutes: data.contributors?.latency ?? null,

    averageHeartRate: data.average_heart_rate ?? null,
    lowestHeartRate: data.lowest_heart_rate ?? null,
    averageHrv: data.average_hrv ?? null,
    respiratoryRate: data.average_breath ?? null,

    score: data.score ?? null,
  };
};

const normalizeOuraActivity = (data: OuraDailyActivityData): ActivityData => {
  return {
    steps: data.steps ?? null,
    activeCalories: data.active_calories ?? null,
    totalCalories: data.total_calories ?? null,

    sedentaryMinutes: data.sedentary_minutes ?? null,
    lightlyActiveMinutes: data.low_activity_minutes ?? null,
    moderatelyActiveMinutes: data.medium_activity_minutes ?? null,
    vigorouslyActiveMinutes: data.high_activity_minutes ?? null,

    targetCalories: data.target_calories ?? null,
    targetSteps: null, // Oura uses calories as primary goal

    score: data.score ?? null,
  };
};

const normalizeOuraReadiness = (data: OuraDailyReadinessData): ReadinessData => {
  return {
    score: data.score,

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
```

---

## Database Schema

### Migration: `xxx_health_tracking.ts`

```sql
-- Health records table
CREATE TABLE health_records (
  id TEXT PRIMARY KEY,                    -- ULID

  -- Source
  provider TEXT NOT NULL,                 -- 'oura', 'whoop', etc.
  external_id TEXT NOT NULL,              -- Provider's unique ID

  -- Type and timing
  type TEXT NOT NULL,                     -- 'sleep', 'activity', etc.
  date TEXT NOT NULL,                     -- YYYY-MM-DD
  period_start TEXT NOT NULL,             -- ISO8601
  period_end TEXT NOT NULL,               -- ISO8601

  -- Normalized score
  score INTEGER,                          -- 0-100 or NULL

  -- Full data
  normalized_data TEXT NOT NULL,          -- JSON (SleepData, ActivityData, etc.)
  raw_data TEXT NOT NULL,                 -- JSON (original payload)

  -- Timestamps
  recorded_at TEXT NOT NULL,              -- When provider recorded
  received_at TEXT NOT NULL,              -- When we received webhook
  created_at TEXT NOT NULL,

  -- Deduplication
  UNIQUE(provider, external_id)
);

-- Query by date range and type
CREATE INDEX idx_health_date ON health_records(date DESC);
CREATE INDEX idx_health_type_date ON health_records(type, date DESC);
CREATE INDEX idx_health_provider ON health_records(provider, type, date DESC);

-- Webhook sync state (tracks subscription status)
CREATE TABLE health_webhook_state (
  id TEXT PRIMARY KEY,                    -- 'oura', 'whoop', etc.
  subscription_id TEXT,                   -- Provider's subscription ID
  subscribed_types TEXT NOT NULL,         -- JSON array of data types
  callback_url TEXT NOT NULL,
  expires_at TEXT,                        -- Subscription expiry (Oura webhooks expire)
  last_event_at TEXT,                     -- Last received webhook timestamp
  status TEXT NOT NULL,                   -- 'active', 'expired', 'error'
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

---

## HealthService

### Interface

```typescript
// src/health/health.ts

type HealthService = {
  // Ingestion (called by webhook handlers with normalized data)
  ingestRecord(record: NormalizedHealthRecord): Promise<HealthRecord>;

  // Query methods
  getRecords(filter: HealthQueryFilter): Promise<HealthRecord[]>;
  getLatestByType(type: HealthRecordType): Promise<HealthRecord | null>;
  getSleepSummary(startDate: string, endDate: string): Promise<SleepSummary>;
  getActivitySummary(startDate: string, endDate: string): Promise<ActivitySummary>;
  getReadinessScore(date: string): Promise<number | null>;

  // Subscription state tracking
  getWebhookState(provider: HealthProvider): Promise<HealthWebhookState | null>;
  updateWebhookState(state: HealthWebhookState): Promise<void>;
};

// Input from normalizers (provider-agnostic)
type NormalizedHealthRecord = {
  provider: HealthProvider;
  externalId: string;
  type: HealthRecordType;
  date: string;                    // YYYY-MM-DD
  periodStart: string;             // ISO8601
  periodEnd: string;               // ISO8601
  score: number | null;
  data: SleepData | ActivityData | ReadinessData | Record<string, unknown>;
  rawData: Record<string, unknown>;
  recordedAt: string;
};

type HealthQueryFilter = {
  type?: HealthRecordType;
  provider?: HealthProvider;
  startDate?: string;              // YYYY-MM-DD
  endDate?: string;                // YYYY-MM-DD
  limit?: number;
};
```

### Implementation

The HealthService is provider-agnostic. It receives normalized records from webhook handlers and stores them.

```typescript
const createHealthService = (deps: {
  store: HealthStore;
  eventService: EventService;
  logger: Logger;
}): HealthService => {

  const ingestRecord = async (input: NormalizedHealthRecord): Promise<HealthRecord> => {
    // Create the record with generated ID and timestamp
    const record: HealthRecord = {
      id: ulid(),
      ...input,
      receivedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    // Upsert (provider + externalId is unique)
    const savedRecord = await deps.store.upsert(record);

    // Emit to Event Log
    await emitHealthEvent('logged', record);

    deps.logger.info('Health record ingested', {
      provider: record.provider,
      type: record.type,
      date: record.date,
      score: record.score,
    });

    return savedRecord;
  };

  const emitHealthEvent = async (
    action: 'logged' | 'updated' | 'deleted',
    record: HealthRecord,
  ): Promise<void> => {
    await deps.eventService.emit({
      type: `health.${record.type}.${action}`,
      source: 'health-service',
      externalId: `${record.provider}-${record.externalId}`,
      summary: buildHealthSummary(record),
      data: {
        provider: record.provider,
        type: record.type,
        date: record.date,
        score: record.score,
      },
      entityId: record.id,
      entityType: 'health-record',
    });
  };

  const buildHealthSummary = (record: HealthRecord): string => {
    const scoreText = record.score !== null ? ` (score: ${record.score})` : '';
    return `${record.type} data from ${record.provider} for ${record.date}${scoreText}`;
  };

  return {
    ingestRecord,
    getRecords,
    getLatestByType,
    getSleepSummary,
    getActivitySummary,
    getReadinessScore,
    getWebhookState,
    updateWebhookState,
  };
};
```

---

## Agent Tools

Health tools follow the external services pattern with `requiredServices`.

### get_health_data

```typescript
// src/health/health.tools.ts

const getHealthDataTool: ToolDefinition = {
  id: 'health.get_data',
  name: 'Get Health Data',
  description: `Retrieve health and wellness data from connected wearables.

    Use this to answer questions about:
    - Sleep quality and patterns
    - Activity levels and exercise
    - Recovery and readiness scores
    - Heart rate and HRV trends

    Examples:
    - "How did I sleep last night?" → type: 'sleep', last 1 day
    - "What's my readiness score?" → type: 'readiness', today
    - "How active was I this week?" → type: 'activity', last 7 days`,

  category: 'health',

  // Tool only available when at least one health provider is configured
  requiredServices: ['oura'],  // Will expand to ['oura', 'whoop', ...] with OR logic

  inputSchema: z.object({
    type: healthRecordTypeSchema.optional()
      .describe('Type of health data to retrieve'),
    startDate: z.string().optional()
      .describe('Start date (YYYY-MM-DD), defaults to 7 days ago'),
    endDate: z.string().optional()
      .describe('End date (YYYY-MM-DD), defaults to today'),
    limit: z.number().max(30).optional().default(7)
      .describe('Maximum records to return'),
  }),

  outputSchema: z.object({
    records: z.array(z.object({
      type: healthRecordTypeSchema,
      date: z.string(),
      score: z.number().nullable(),
      data: z.record(z.string(), z.unknown()),
    })),
  }),

  risk: { level: 'none', reason: 'Read-only health data access' },

  tags: ['health', 'oura'],

  execute: async (input, context) => {
    const healthService = context.services.get(HealthService);
    const records = await healthService.getRecords(input);
    return { records };
  },
};
```

### get_sleep_summary

```typescript
const getSleepSummaryTool: ToolDefinition = {
  id: 'health.get_sleep_summary',
  name: 'Get Sleep Summary',
  description: `Get a summary of sleep patterns over a date range.

    Returns average sleep duration, quality trends, and notable patterns.
    Useful for questions like "How have I been sleeping this week?"`,

  category: 'health',

  inputSchema: z.object({
    startDate: z.string().optional()
      .describe('Start date (YYYY-MM-DD), defaults to 7 days ago'),
    endDate: z.string().optional()
      .describe('End date (YYYY-MM-DD), defaults to today'),
  }),

  outputSchema: z.object({
    summary: z.object({
      averageDurationMinutes: z.number(),
      averageScore: z.number().nullable(),
      averageEfficiency: z.number().nullable(),
      totalNights: z.number(),
      trend: z.enum(['improving', 'declining', 'stable']),
    }),
    nights: z.array(z.object({
      date: z.string(),
      durationMinutes: z.number(),
      score: z.number().nullable(),
    })),
  }),

  risk: { level: 'none', reason: 'Read-only health data access' },
};
```

---

## Event Log Integration

Health data emits events to the Event Log for agent awareness:

| Event Type | Description |
|------------|-------------|
| `health.sleep.logged` | New sleep data received |
| `health.sleep.updated` | Sleep data updated |
| `health.activity.logged` | New activity data received |
| `health.readiness.logged` | New readiness score received |
| `health.workout.logged` | Workout recorded |
| `health.hrv.logged` | HRV measurement recorded |

This enables queries like:
- "What health updates came in today?"
- "Show me recent changes to my sleep data"

---

## Configuration

### Convict Schema Addition

```typescript
// Add to src/config/config.ts

api: {
  enabled: {
    doc: 'Enable the API server',
    format: Boolean,
    default: true,
    env: 'GLADOS_API_ENABLED',
  },
  host: {
    doc: 'API server host',
    format: String,
    default: '0.0.0.0',
    env: 'GLADOS_API_HOST',
  },
  port: {
    doc: 'API server port',
    format: 'port',
    default: 3000,
    env: 'GLADOS_API_PORT',
  },
  trustProxy: {
    doc: 'Trust X-Forwarded-* headers (set true behind reverse proxy)',
    format: Boolean,
    default: false,
    env: 'GLADOS_API_TRUST_PROXY',
  },
  publicUrl: {
    doc: 'Public URL for webhook callbacks (e.g., https://glados.example.com)',
    format: String,
    default: '',
    env: 'GLADOS_API_PUBLIC_URL',
  },
},

oura: {
  clientId: {
    doc: 'Oura OAuth2 client ID',
    format: String,
    default: '',
    env: 'GLADOS_OURA_CLIENT_ID',
  },
  clientSecret: {
    doc: 'Oura OAuth2 client secret',
    format: String,
    default: '',
    env: 'GLADOS_OURA_CLIENT_SECRET',
    sensitive: true,
  },
  webhookSecret: {
    doc: 'Secret for verifying Oura webhook signatures',
    format: String,
    default: '',
    env: 'GLADOS_OURA_WEBHOOK_SECRET',
    sensitive: true,
  },
},
```

---

## Oura Subscription Setup

Oura webhook subscriptions must be created via their API. The callback URL is constructed from `GLADOS_API_PUBLIC_URL`:

```
Callback URL: ${GLADOS_API_PUBLIC_URL}/api/v1/webhooks/oura
Example:      https://glados.example.com/api/v1/webhooks/oura
```

Subscriptions can be created:

1. **Manually via API call** (for initial setup)
2. **Via a setup script** (recommended for reproducibility)
3. **Via agent tool** (once implemented)

### Setup Script

```typescript
// scripts/setup-oura-webhooks.ts

import { loadConfig } from '../src/config/config.ts';

const OURA_DATA_TYPES = [
  'daily_sleep',
  'daily_activity',
  'daily_readiness',
  'daily_stress',
  'daily_spo2',
  'workout',
] as const;

const setupOuraWebhooks = async (): Promise<void> => {
  const config = loadConfig();

  if (!config.api.publicUrl) {
    console.error('Error: GLADOS_API_PUBLIC_URL is required for webhook setup');
    process.exit(1);
  }

  if (!config.oura.clientId || !config.oura.clientSecret) {
    console.error('Error: GLADOS_OURA_CLIENT_ID and GLADOS_OURA_CLIENT_SECRET are required');
    process.exit(1);
  }

  const callbackUrl = `${config.api.publicUrl}/api/v1/webhooks/oura`;
  console.log(`Setting up webhooks with callback URL: ${callbackUrl}`);

  const token = await getOuraToken(config.oura.clientId, config.oura.clientSecret);

  for (const dataType of OURA_DATA_TYPES) {
    for (const eventType of ['create', 'update', 'delete'] as const) {
      await createSubscription({
        token,
        callbackUrl,
        dataType,
        eventType,
      });
      console.log(`  Created subscription: ${dataType} / ${eventType}`);
    }
  }

  console.log('Oura webhook subscriptions created successfully');
};

// Run
setupOuraWebhooks().catch(console.error);
```

### Usage

```bash
# Set required environment variables
export GLADOS_API_PUBLIC_URL=https://glados.example.com
export GLADOS_OURA_CLIENT_ID=your-client-id
export GLADOS_OURA_CLIENT_SECRET=your-client-secret

# Run setup script
npx tsx scripts/setup-oura-webhooks.ts
```

### Subscription Renewal

Oura webhook subscriptions expire and must be renewed periodically. A trigger can handle this:

```typescript
// Example trigger for subscription renewal
const renewOuraSubscriptions = async (): Promise<void> => {
  const healthService = services.get(HealthService);
  const state = await healthService.getWebhookState('oura');

  if (state && isExpiringSoon(state.expiresAt)) {
    await renewSubscriptions(state.subscriptionId);
    await healthService.updateWebhookState({
      ...state,
      expiresAt: calculateNewExpiry(),
    });
  }
};
```

---

## Server Integration

The API server is started as part of `src/server/server.ts`, alongside the Telegram bot.

### Updated Server Components

```typescript
// src/server/server.ts

type ServerComponents = {
  services: Services;
  telegram: TelegramClientService | null;
  notificationRouter: NotificationRouter | null;
  api: FastifyInstance | null;  // NEW
};
```

### Server Startup Flow

```typescript
// In main() function of src/server/server.ts

// ... existing initialization ...

// Start API server (if configured)
if (isApiConfigured()) {
  console.log();
  console.log('Starting API server...');
  components.api = await createApiServer({
    services: components.services,
    config,
    logger: createLogger('api'),
  });

  await components.api.listen({
    host: config.api.host,
    port: config.api.port,
  });

  console.log(`  API server listening on ${config.api.host}:${config.api.port}`);
}

// ... existing Telegram startup ...

// Server ready message updated:
console.log('Components running:');
console.log('  - Telegram bot: listening for messages');
if (components.api) {
  console.log(`  - API server: listening on port ${config.api.port}`);
}
```

### Graceful Shutdown

```typescript
const shutdown = async (signal: string): Promise<void> => {
  console.log(`Received ${signal}, shutting down...`);

  // Stop API server
  if (components.api) {
    console.log('  Stopping API server...');
    await components.api.close();
  }

  // Stop Telegram bot
  if (components.telegram) {
    console.log('  Stopping Telegram bot...');
    await components.telegram.stop();
  }

  // ... rest of cleanup ...
};
```

### Configuration Check

```typescript
// src/config/config.ts

const isApiConfigured = (): boolean => {
  const config = loadConfig();
  return config.api.enabled && config.api.port > 0;
};

const isOuraConfigured = (): boolean => {
  const config = loadConfig();
  // Webhook secret is required to verify incoming webhooks
  // Client ID/secret are needed for API calls (subscription management)
  // Public URL is needed for webhook callbacks
  return !!(
    config.oura.webhookSecret &&
    config.oura.clientId &&
    config.api.publicUrl
  );
};
```

### Route Registration

The API server always starts with the health check endpoint. Provider-specific webhook routes are only registered if that provider is configured:

```typescript
// src/api/api.ts

const createApiServer = async (deps: Dependencies): Promise<FastifyInstance> => {
  const fastify = Fastify({ logger: deps.logger });

  // Always register health check
  await fastify.register(healthRoutes, { prefix: '/api/v1' });

  // Register Oura webhooks only if configured
  if (isOuraConfigured()) {
    await fastify.register(ouraWebhookRoutes, {
      prefix: '/api/v1/webhooks',
      healthService: deps.services.get(HealthService),
    });
  }

  return fastify;
};
```

---

## Testing Strategy

### Unit Tests

- Health record schema validation
- Oura data normalization
- Signature verification
- Event type mapping

### Integration Tests

- Webhook endpoint receives and processes payload
- Health records are stored correctly
- Events are emitted to Event Log
- Duplicate webhooks are handled idempotently

### Mock Oura Webhook

```typescript
const mockOuraSleepWebhook = {
  event_type: 'create',
  data_type: 'daily_sleep',
  event_time: '2026-02-06T08:00:00Z',
  user_id: 'test-user',
  data: {
    id: 'sleep-123',
    day: '2026-02-05',
    score: 85,
    contributors: {
      total_sleep: 480,
      rem_sleep: 90,
      deep_sleep: 120,
      efficiency: 92,
    },
    bedtime_start: '2026-02-05T23:00:00Z',
    bedtime_end: '2026-02-06T07:00:00Z',
    average_heart_rate: 52,
    lowest_heart_rate: 48,
    average_hrv: 45,
  },
};
```

---

## File Structure

```
src/
├── server/
│   └── server.ts                     # Updated to include API server startup
│
├── api/
│   ├── api.ts                        # Fastify server factory (createApiServer)
│   ├── api.schemas.ts                # Shared API schemas
│   ├── api.test.ts                   # API tests
│   ├── routes/
│   │   ├── health.ts                 # Health check endpoint
│   │   └── webhooks/
│   │       ├── index.ts              # Webhook routes registration
│   │       └── oura.ts               # Oura webhook handler
│   └── middleware/
│       ├── signature.ts              # Webhook signature verification
│       └── error-handler.ts          # Error handling
│
├── external/
│   ├── external.ts                   # ExternalServiceRegistry (existing)
│   ├── external.tools.ts             # Updated to register Oura
│   ├── homeassistant/                # Existing
│   └── oura/                         # NEW: Oura external service
│       ├── index.ts                  # Exports
│       ├── oura.ts                   # OuraClient and service definition
│       ├── oura.schemas.ts           # Oura API schemas
│       ├── oura.normalizer.ts        # Data normalization to generic model
│       └── oura.test.ts              # Tests
│
├── health/
│   ├── health.ts                     # HealthService (provider-agnostic)
│   ├── health.schemas.ts             # Generic health data schemas
│   ├── health.store.ts               # Database operations
│   ├── health.tools.ts               # Agent tools (with requiredServices)
│   └── health.test.ts                # Tests
```

---

## Implementation Phases

### Phase 1: API Server Foundation

- [ ] Add Fastify dependency
- [ ] Create API server factory (`src/api/api.ts`)
- [ ] Add configuration for API server (`config.api.*`)
- [ ] Create health check endpoint
- [ ] Integrate into `src/server/server.ts`
- [ ] Basic error handling middleware
- [ ] Graceful shutdown handling

### Phase 2: Health Data Infrastructure

- [ ] Create health record schemas
- [ ] Create database migration for health tables
- [ ] Implement HealthStore
- [ ] Implement HealthService (query methods)

### Phase 3: Oura External Service

- [ ] Add Oura configuration to `src/config/config.ts`
- [ ] Create `src/external/oura/oura.ts` with service definition
- [ ] Create `src/external/oura/oura.schemas.ts` with API schemas
- [ ] Create `src/external/oura/oura.normalizer.ts` for data normalization
- [ ] Register Oura in `src/external/external.tools.ts`
- [ ] Implement webhook signature verification
- [ ] Create webhook route in `src/api/routes/webhooks/oura.ts`

### Phase 4: Event Log Integration

- [ ] Emit health events to Event Log
- [ ] Add health event types to Event Log documentation
- [ ] Test event emission

### Phase 5: Agent Tools

- [ ] Implement `health.get_data` tool
- [ ] Implement `health.get_sleep_summary` tool
- [ ] Register tools with tool registry
- [ ] Add tool documentation

### Phase 6: Subscription Management

- [ ] Create `scripts/setup-oura-webhooks.ts` setup script
- [ ] Add `pnpm setup:oura` script to package.json
- [ ] Implement subscription state tracking in health_webhook_state table
- [ ] Add subscription renewal trigger (optional, Oura subscriptions expire)

### Phase 7: Testing & Documentation

- [ ] Unit tests for all components
- [ ] Integration tests for webhook flow
- [ ] Update CLAUDE.md with health tracking info
- [ ] Add configuration documentation

---

## Future Considerations

1. **Additional Providers**: Whoop, Garmin, Fitbit adapters using the same normalized model

2. **Apple Health**: Requires iOS app with HealthKit access, different architecture

3. **Aggregations**: Weekly/monthly summaries, trend analysis, correlations

4. **Alerts**: Notify on unusual patterns (poor sleep streak, low HRV trend)

5. **Goals**: Track health goals and progress

6. **Bidirectional Sync**: Push reminders or annotations back to providers

7. **Historical Import**: One-time import of historical data via API polling

8. **Privacy Controls**: Fine-grained control over what health data is stored/shared

---

## Security Considerations

- **Webhook Verification**: Always verify signatures before processing
- **Data Sensitivity**: Health data is highly personal; store encrypted at rest
- **Minimal Storage**: Only store what's needed; consider retention policies
- **Access Logging**: Log all access to health data
- **No External Sharing**: Health data never leaves the local system
- **Secure Secrets**: Webhook secrets and API keys in environment variables, never in code

---

## References

- [Oura API v2 Documentation](https://cloud.ouraring.com/v2/docs)
- [Oura Webhook Subscriptions](https://cloud.ouraring.com/v2/docs#tag/Webhook-Subscription-Routes)
- [Fastify Documentation](https://fastify.dev/docs/latest/)
- [@pinta365/oura-api](https://jsr.io/@pinta365/oura-api) - TypeScript Oura API client
