import { z } from 'zod';

// ============================================================================
// Sync Status
// ============================================================================

const syncStatusSchema = z.enum(['success', 'error', 'in_progress']);

type SyncStatus = z.infer<typeof syncStatusSchema>;

// ============================================================================
// Calendar Sync State
// ============================================================================

const calendarSyncStateSchema = z.object({
  sourceId: z.string(),
  lastSyncAt: z.string().datetime(),
  lastSyncStatus: syncStatusSchema,
  errorMessage: z.string().optional(),
  eventsInWindow: z.number().int().nonnegative(),
});

type CalendarSyncState = z.infer<typeof calendarSyncStateSchema>;

// ============================================================================
// Sync Result
// ============================================================================

const syncResultSchema = z.object({
  sourceId: z.string(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  deleted: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  errors: z.array(z.string()),
});

type SyncResult = z.infer<typeof syncResultSchema>;

export type { SyncStatus, CalendarSyncState, SyncResult };
export { syncStatusSchema, calendarSyncStateSchema, syncResultSchema };
