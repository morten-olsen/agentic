import { z } from 'zod';

import type { ToolDefinition, ToolContext, ToolRegistry } from '../tools.ts';
import { EventService, eventSchema } from '../../events/events.ts';

// ============================================================================
// Query Events
// ============================================================================

const queryEventsInputSchema = z.object({
  types: z
    .array(z.string())
    .optional()
    .describe(
      'Event types to filter. Supports wildcards: "calendar.*" matches all calendar events. ' +
        'Examples: ["calendar.event.created", "tasks.*", "triggers.fired"]',
    ),
  since: z.string().optional().describe('Start of time range (ISO8601) or event ID to fetch events after'),
  until: z.string().optional().describe('End of time range (ISO8601)'),
  entityId: z.string().optional().describe('Filter by entity ID (e.g., a specific task or calendar event ID)'),
  entityType: z.string().optional().describe('Filter by entity type (e.g., "calendar-event", "user-task", "trigger")'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Maximum number of events to return (default 20, max 100)'),
});

const queryEventsOutputSchema = z.object({
  events: z.array(eventSchema),
  total: z.number(),
  hasMore: z.boolean(),
  summary: z.string().describe('Human-readable summary of the results'),
});

type QueryEventsInput = z.infer<typeof queryEventsInputSchema>;
type QueryEventsOutput = z.infer<typeof queryEventsOutputSchema>;

const queryEventsTool: ToolDefinition<QueryEventsInput, QueryEventsOutput> = {
  id: 'events.query',
  name: 'QueryEvents',
  description:
    'Query the event log to see what has happened in the system. ' +
    'Use this to understand recent changes, track entity history, or find events by type. ' +
    'Supports wildcard type filtering (e.g., "calendar.*" for all calendar events).',
  category: 'events',
  inputSchema: queryEventsInputSchema,
  outputSchema: queryEventsOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['events', 'history', 'read'],
  examples: [
    {
      input: { types: ['calendar.*'], limit: 10 },
      description: 'Get recent calendar events',
    },
    {
      input: { types: ['tasks.*'], since: '2024-01-15T00:00:00Z' },
      description: 'Get task events since a specific time',
    },
    {
      input: { entityId: 'task-123', entityType: 'user-task' },
      description: 'Get all events for a specific task',
    },
    {
      input: { types: ['triggers.fired'], limit: 5 },
      description: 'Get recent trigger executions',
    },
  ],
  execute: async (input: QueryEventsInput, context: ToolContext): Promise<QueryEventsOutput> => {
    const eventService = context.services.get(EventService);
    const result = await eventService.query({
      types: input.types,
      since: input.since,
      until: input.until,
      entityId: input.entityId,
      entityType: input.entityType,
      limit: input.limit ?? 20,
    });

    // Generate a human-readable summary
    let summary: string;
    if (result.events.length === 0) {
      summary = 'No events found matching the criteria.';
    } else {
      const typeGroups: Record<string, number> = {};
      for (const event of result.events) {
        const domain = event.type.split('.')[0];
        typeGroups[domain] = (typeGroups[domain] ?? 0) + 1;
      }
      const groupSummary = Object.entries(typeGroups)
        .map(([domain, count]) => `${domain}: ${count}`)
        .join(', ');

      summary = `Found ${result.events.length} events (${groupSummary}).`;
      if (result.hasMore) {
        summary += ` ${result.total - result.events.length} more events available.`;
      }
    }

    return {
      events: result.events,
      total: result.total,
      hasMore: result.hasMore,
      summary,
    };
  },
};

// ============================================================================
// Get Recent Changes
// ============================================================================

const getRecentChangesInputSchema = z.object({
  hours: z.number().positive().optional().describe('How many hours back to look (default 24)'),
  types: z.array(z.string()).optional().describe('Event types to filter. Supports wildcards like "calendar.*"'),
  limit: z.number().int().min(1).max(50).optional().describe('Maximum number of events (default 10, max 50)'),
});

const getRecentChangesOutputSchema = z.object({
  events: z.array(eventSchema),
  count: z.number(),
  oldestTimestamp: z.string().optional(),
  newestTimestamp: z.string().optional(),
  summary: z.string(),
});

type GetRecentChangesInput = z.infer<typeof getRecentChangesInputSchema>;
type GetRecentChangesOutput = z.infer<typeof getRecentChangesOutputSchema>;

const getRecentChangesTool: ToolDefinition<GetRecentChangesInput, GetRecentChangesOutput> = {
  id: 'events.get_recent_changes',
  name: 'GetRecentChanges',
  description:
    'Get a summary of recent system changes. ' +
    'Useful for understanding what has happened recently without complex queries.',
  category: 'events',
  inputSchema: getRecentChangesInputSchema,
  outputSchema: getRecentChangesOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['events', 'history', 'read', 'summary'],
  examples: [
    {
      input: {},
      description: 'Get changes from the last 24 hours',
    },
    {
      input: { hours: 1 },
      description: 'Get changes from the last hour',
    },
    {
      input: { types: ['calendar.*', 'tasks.*'], hours: 12 },
      description: 'Get calendar and task changes from the last 12 hours',
    },
  ],
  execute: async (input: GetRecentChangesInput, context: ToolContext): Promise<GetRecentChangesOutput> => {
    const eventService = context.services.get(EventService);
    const hours = input.hours ?? 24;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const result = await eventService.query({
      types: input.types,
      since,
      limit: input.limit ?? 10,
    });

    const events = result.events;
    const oldestTimestamp = events.length > 0 ? events[events.length - 1].timestamp : undefined;
    const newestTimestamp = events.length > 0 ? events[0].timestamp : undefined;

    // Generate summary
    let summary: string;
    if (events.length === 0) {
      summary = `No changes in the last ${hours} hour${hours === 1 ? '' : 's'}.`;
    } else {
      const typeGroups: Record<string, number> = {};
      for (const event of events) {
        const domain = event.type.split('.')[0];
        typeGroups[domain] = (typeGroups[domain] ?? 0) + 1;
      }

      const parts: string[] = [];
      for (const [domain, count] of Object.entries(typeGroups)) {
        parts.push(`${count} ${domain} event${count === 1 ? '' : 's'}`);
      }

      summary = `${events.length} change${events.length === 1 ? '' : 's'} in the last ${hours} hour${hours === 1 ? '' : 's'}: ${parts.join(', ')}.`;
    }

    return {
      events,
      count: events.length,
      oldestTimestamp,
      newestTimestamp,
      summary,
    };
  },
};

// ============================================================================
// Get Event By ID
// ============================================================================

const getEventInputSchema = z.object({
  id: z.string().describe('Event ID to retrieve'),
});

const getEventOutputSchema = z.object({
  event: eventSchema.nullable(),
  found: z.boolean(),
});

type GetEventInput = z.infer<typeof getEventInputSchema>;
type GetEventOutput = z.infer<typeof getEventOutputSchema>;

const getEventTool: ToolDefinition<GetEventInput, GetEventOutput> = {
  id: 'events.get',
  name: 'GetEvent',
  description: 'Get a specific event by its ID.',
  category: 'events',
  inputSchema: getEventInputSchema,
  outputSchema: getEventOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['events', 'read'],
  examples: [
    {
      input: { id: '550e8400-e29b-41d4-a716-446655440000' },
      description: 'Get a specific event',
    },
  ],
  execute: async (input: GetEventInput, context: ToolContext): Promise<GetEventOutput> => {
    const eventService = context.services.get(EventService);
    const event = await eventService.get(input.id);
    return {
      event,
      found: event !== null,
    };
  },
};

// ============================================================================
// Get Event Stats
// ============================================================================

const getEventStatsInputSchema = z.object({});

const getEventStatsOutputSchema = z.object({
  totalEvents: z.number(),
  eventsByDomain: z.record(z.string(), z.number()),
  retentionDays: z.number(),
  summary: z.string(),
});

type GetEventStatsInput = z.infer<typeof getEventStatsInputSchema>;
type GetEventStatsOutput = z.infer<typeof getEventStatsOutputSchema>;

const getEventStatsTool: ToolDefinition<GetEventStatsInput, GetEventStatsOutput> = {
  id: 'events.stats',
  name: 'GetEventStats',
  description: 'Get statistics about the event log including total count and breakdown by domain.',
  category: 'events',
  inputSchema: getEventStatsInputSchema,
  outputSchema: getEventStatsOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['events', 'stats', 'read'],
  examples: [
    {
      input: {},
      description: 'Get event log statistics',
    },
  ],
  execute: async (_input: GetEventStatsInput, context: ToolContext): Promise<GetEventStatsOutput> => {
    const eventService = context.services.get(EventService);
    const [totalEvents, eventsByDomain] = await Promise.all([eventService.count(), eventService.countByDomain()]);

    const { retentionDays } = eventService.config;

    const domainSummary = Object.entries(eventsByDomain)
      .sort((a, b) => b[1] - a[1])
      .map(([domain, count]) => `${domain}: ${count}`)
      .join(', ');

    const summary =
      totalEvents === 0
        ? 'Event log is empty.'
        : `${totalEvents} events in log (${domainSummary}). Retention: ${retentionDays} days.`;

    return {
      totalEvents,
      eventsByDomain,
      retentionDays,
      summary,
    };
  },
};

// ============================================================================
// Cleanup Events
// ============================================================================

const cleanupEventsInputSchema = z.object({
  retentionDays: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Days to retain (uses configured default if not specified)'),
});

const cleanupEventsOutputSchema = z.object({
  deletedCount: z.number(),
  retentionDays: z.number(),
  summary: z.string(),
});

type CleanupEventsInput = z.infer<typeof cleanupEventsInputSchema>;
type CleanupEventsOutput = z.infer<typeof cleanupEventsOutputSchema>;

const cleanupEventsTool: ToolDefinition<CleanupEventsInput, CleanupEventsOutput> = {
  id: 'events.cleanup',
  name: 'CleanupEvents',
  description:
    'Delete events older than the retention period. ' +
    'Use this periodically to manage event log size. Default retention is 30 days.',
  category: 'events',
  inputSchema: cleanupEventsInputSchema,
  outputSchema: cleanupEventsOutputSchema,
  risk: {
    level: 'low',
    reason: 'Deletes old events beyond retention period - expected maintenance operation',
    potentialImpact: 'Removes historical events older than retention period',
    reversible: false,
    categories: ['data_modification'],
  },
  tags: ['events', 'maintenance', 'cleanup'],
  examples: [
    {
      input: {},
      description: 'Clean up events using default retention (30 days)',
    },
    {
      input: { retentionDays: 7 },
      description: 'Clean up events older than 7 days',
    },
  ],
  execute: async (input: CleanupEventsInput, context: ToolContext): Promise<CleanupEventsOutput> => {
    const eventService = context.services.get(EventService);
    const retentionDays = input.retentionDays ?? eventService.config.retentionDays;
    const deletedCount = await eventService.cleanup(retentionDays);

    const summary =
      deletedCount === 0
        ? `No events older than ${retentionDays} days to clean up.`
        : `Deleted ${deletedCount} event${deletedCount === 1 ? '' : 's'} older than ${retentionDays} days.`;

    return {
      deletedCount,
      retentionDays,
      summary,
    };
  },
};

// ============================================================================
// Registration
// ============================================================================

const registerEventTools = (registry: ToolRegistry): void => {
  registry.register(queryEventsTool);
  registry.register(getRecentChangesTool);
  registry.register(getEventTool);
  registry.register(getEventStatsTool);
  registry.register(cleanupEventsTool);
};

export {
  queryEventsTool,
  getRecentChangesTool,
  getEventTool,
  getEventStatsTool,
  cleanupEventsTool,
  registerEventTools,
};

export type {
  QueryEventsInput,
  QueryEventsOutput,
  GetRecentChangesInput,
  GetRecentChangesOutput,
  GetEventInput,
  GetEventOutput,
  GetEventStatsInput,
  GetEventStatsOutput,
  CleanupEventsInput,
  CleanupEventsOutput,
};
