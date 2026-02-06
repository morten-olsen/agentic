import { z } from 'zod';

// ============================================================================
// Event
// ============================================================================

const eventSchema = z.object({
  id: z.string(),
  type: z.string(), // Namespaced: 'calendar.event.created', 'health.sleep.logged'
  timestamp: z.string(), // ISO8601 when event occurred
  source: z.string(), // 'calendar-service', 'homeassistant', etc.

  // Deduplication
  externalId: z.string().optional(),
  hash: z.string().optional(),

  // Content
  summary: z.string().optional(), // Optional human-readable description
  data: z.record(z.string(), z.unknown()), // Full event payload

  // Relations
  entityId: z.string().optional(),
  entityType: z.string().optional(),
  conversationId: z.string().optional(),
  messageId: z.string().optional(),

  // Timestamps
  createdAt: z.string(),
});

type Event = z.infer<typeof eventSchema>;

// ============================================================================
// Emit Event Input
// ============================================================================

const emitEventInputSchema = z.object({
  type: z.string().min(1), // Namespaced: 'calendar.event.created'
  timestamp: z.string().optional(), // Defaults to now
  source: z.string().min(1),
  externalId: z.string().optional(),
  summary: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional().default({}),
  entityId: z.string().optional(),
  entityType: z.string().optional(),
  conversationId: z.string().optional(),
  messageId: z.string().optional(),
});

type EmitEventInput = z.input<typeof emitEventInputSchema>;

// ============================================================================
// Event Query Filter
// ============================================================================

const eventQueryFilterSchema = z.object({
  // Time range
  since: z.string().optional(), // ISO8601 or event ID
  until: z.string().optional(), // ISO8601

  // Type filtering with wildcards
  types: z.array(z.string()).optional(), // e.g., ['calendar.*', 'tasks.task.completed']

  // Entity filtering
  entityId: z.string().optional(),
  entityType: z.string().optional(),

  // Conversation filtering
  conversationId: z.string().optional(),
  messageId: z.string().optional(),

  // Pagination
  limit: z.number().int().positive().optional().default(100),
  offset: z.number().int().nonnegative().optional().default(0),
});

type EventQueryFilter = z.input<typeof eventQueryFilterSchema>;

// ============================================================================
// Event Query Result
// ============================================================================

const eventQueryResultSchema = z.object({
  events: z.array(eventSchema),
  total: z.number().int().nonnegative(), // Total matching events (for pagination awareness)
  hasMore: z.boolean(),
  nextOffset: z.number().int().nonnegative().optional(),
});

type EventQueryResult = z.infer<typeof eventQueryResultSchema>;

// ============================================================================
// Event Database Row
// ============================================================================

const eventRowSchema = z.object({
  id: z.string(),
  type: z.string(),
  timestamp: z.string(),
  source: z.string(),
  external_id: z.string().nullable(),
  hash: z.string().nullable(),
  summary: z.string().nullable(),
  data: z.string(), // JSON string
  entity_id: z.string().nullable(),
  entity_type: z.string().nullable(),
  conversation_id: z.string().nullable(),
  message_id: z.string().nullable(),
  created_at: z.string(),
});

type EventRow = z.infer<typeof eventRowSchema>;

// ============================================================================
// Checkpoint
// ============================================================================

const checkpointSchema = z.object({
  taskId: z.string(),
  lastEventId: z.string(),
  updatedAt: z.string(),
});

type Checkpoint = z.infer<typeof checkpointSchema>;

const checkpointRowSchema = z.object({
  task_id: z.string(),
  last_event_id: z.string(),
  updated_at: z.string(),
});

type CheckpointRow = z.infer<typeof checkpointRowSchema>;

// ============================================================================
// Exports
// ============================================================================

export type { Event, EmitEventInput, EventQueryFilter, EventQueryResult, EventRow, Checkpoint, CheckpointRow };

export {
  eventSchema,
  emitEventInputSchema,
  eventQueryFilterSchema,
  eventQueryResultSchema,
  eventRowSchema,
  checkpointSchema,
  checkpointRowSchema,
};
