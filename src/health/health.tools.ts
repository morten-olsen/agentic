import { z } from 'zod';

import type { ToolDefinition } from '../tools/tools.types.ts';
import type { ToolContext } from '../tools/tools.schemas.ts';

import { HealthService } from './health.ts';
import { healthRecordTypeSchema } from './health.schemas.ts';

// ============================================================================
// Input/Output Schemas
// ============================================================================

const getHealthDataInputSchema = z.object({
  type: healthRecordTypeSchema.optional().describe('Type of health data to retrieve'),
  startDate: z.string().optional().describe('Start date (YYYY-MM-DD), defaults to 7 days ago'),
  endDate: z.string().optional().describe('End date (YYYY-MM-DD), defaults to today'),
  limit: z.number().max(30).optional().default(7).describe('Maximum records to return'),
});

type GetHealthDataInput = z.input<typeof getHealthDataInputSchema>;

const healthRecordOutputSchema = z.object({
  type: healthRecordTypeSchema,
  date: z.string(),
  score: z.number().nullable(),
  provider: z.string(),
  data: z.record(z.string(), z.unknown()),
});

const getHealthDataOutputSchema = z.object({
  records: z.array(healthRecordOutputSchema),
});

type GetHealthDataOutput = z.infer<typeof getHealthDataOutputSchema>;

const getSleepSummaryInputSchema = z.object({
  startDate: z.string().optional().describe('Start date (YYYY-MM-DD), defaults to 7 days ago'),
  endDate: z.string().optional().describe('End date (YYYY-MM-DD), defaults to today'),
});

type GetSleepSummaryInput = z.input<typeof getSleepSummaryInputSchema>;

const getSleepSummaryOutputSchema = z.object({
  summary: z.object({
    averageDurationMinutes: z.number(),
    averageScore: z.number().nullable(),
    averageEfficiency: z.number().nullable(),
    totalNights: z.number(),
    trend: z.enum(['improving', 'declining', 'stable']),
  }),
  nights: z.array(
    z.object({
      date: z.string(),
      durationMinutes: z.number(),
      score: z.number().nullable(),
    }),
  ),
});

type GetSleepSummaryOutput = z.infer<typeof getSleepSummaryOutputSchema>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Gets the default start date (7 days ago).
 */
const getDefaultStartDate = (): string => {
  const date = new Date();
  date.setDate(date.getDate() - 7);
  return date.toISOString().split('T')[0];
};

/**
 * Gets today's date.
 */
const getToday = (): string => {
  return new Date().toISOString().split('T')[0];
};

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Tool for retrieving health data.
 */
const getHealthDataTool: ToolDefinition<GetHealthDataInput, GetHealthDataOutput> = {
  id: 'health.get_data',
  name: 'Get Health Data',
  description: `Retrieve health and wellness data from connected wearables.

Use this to answer questions about:
- Sleep quality and patterns
- Activity levels and exercise
- Recovery and readiness scores
- Heart rate and HRV trends

Examples:
- "How did I sleep last night?" -> type: 'sleep', last 1 day
- "What's my readiness score?" -> type: 'readiness', today
- "How active was I this week?" -> type: 'activity', last 7 days`,

  category: 'health',

  inputSchema: getHealthDataInputSchema,
  outputSchema: getHealthDataOutputSchema,

  risk: {
    level: 'low',
    reason: 'Read-only health data access',
    potentialImpact: 'None - only reads health data',
    reversible: true,
    categories: ['data_access'],
  },

  tags: ['health', 'oura', 'wearable', 'sleep', 'activity'],

  examples: [
    {
      input: { type: 'sleep', limit: 1 },
      description: "Get last night's sleep data",
    },
    {
      input: { type: 'readiness' },
      description: 'Get readiness scores for the past week',
    },
    {
      input: { type: 'activity', startDate: '2026-02-01', endDate: '2026-02-06' },
      description: 'Get activity data for a specific date range',
    },
  ],

  requiredServices: ['oura'],

  execute: async (input: GetHealthDataInput, context: ToolContext): Promise<GetHealthDataOutput> => {
    const healthService = context.services.get(HealthService);

    const startDate = input.startDate ?? getDefaultStartDate();
    const endDate = input.endDate ?? getToday();

    const records = await healthService.getRecords({
      type: input.type,
      startDate,
      endDate,
      limit: input.limit,
    });

    return {
      records: records.map((r) => ({
        type: r.type,
        date: r.date,
        score: r.score,
        provider: r.provider,
        data: r.normalizedData as Record<string, unknown>,
      })),
    };
  },
};

/**
 * Tool for getting a sleep summary.
 */
const getSleepSummaryTool: ToolDefinition<GetSleepSummaryInput, GetSleepSummaryOutput> = {
  id: 'health.get_sleep_summary',
  name: 'Get Sleep Summary',
  description: `Get a summary of sleep patterns over a date range.

Returns average sleep duration, quality trends, and notable patterns.
Useful for questions like "How have I been sleeping this week?" or "What's my sleep trend?"`,

  category: 'health',

  inputSchema: getSleepSummaryInputSchema,
  outputSchema: getSleepSummaryOutputSchema,

  risk: {
    level: 'low',
    reason: 'Read-only health data access',
    potentialImpact: 'None - only reads health data',
    reversible: true,
    categories: ['data_access'],
  },

  tags: ['health', 'oura', 'wearable', 'sleep'],

  examples: [
    {
      input: {},
      description: 'Get sleep summary for the past week',
    },
    {
      input: { startDate: '2026-01-01', endDate: '2026-01-31' },
      description: 'Get sleep summary for January',
    },
  ],

  requiredServices: ['oura'],

  execute: async (input: GetSleepSummaryInput, context: ToolContext): Promise<GetSleepSummaryOutput> => {
    const healthService = context.services.get(HealthService);

    const startDate = input.startDate ?? getDefaultStartDate();
    const endDate = input.endDate ?? getToday();

    // Get the summary
    const summary = await healthService.getSleepSummary(startDate, endDate);

    // Get individual nights for detail
    const records = await healthService.getRecords({
      type: 'sleep',
      startDate,
      endDate,
      limit: 30,
    });

    type SleepDataWithDuration = {
      totalSleepMinutes?: number;
      score?: number | null;
    };

    const nights = records.map((r) => {
      const data = r.normalizedData as SleepDataWithDuration;
      return {
        date: r.date,
        durationMinutes: data.totalSleepMinutes ?? 0,
        score: r.score,
      };
    });

    return {
      summary,
      nights,
    };
  },
};

// ============================================================================
// Tool Registration
// ============================================================================

// ============================================================================
// Exports
// ============================================================================

export type { GetHealthDataInput, GetHealthDataOutput, GetSleepSummaryInput, GetSleepSummaryOutput };

export { getHealthDataTool, getSleepSummaryTool };
