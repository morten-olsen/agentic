import { z } from 'zod';

import type { ToolDefinition, ToolContext } from '../../../agent/tools/tools.ts';
import { TriggerService } from '../../../features/triggers/triggers.ts';
import { DatabaseService } from '../../../core/database/database.ts';
import { getConversation, getMessages, listConversations } from '../../../agent/orchestrator/orchestrator.store.ts';
import { getTelegramChatByConversation } from '../../../integrations/clients/telegram/telegram.store.ts';
import { ContextBuilderService } from '../../../agent/context/context.ts';
import { PersonalityService } from '../../../agent/personality/personality.ts';
import { OrchestratorService } from '../../../agent/orchestrator/orchestrator.ts';

// Helper to convert null to undefined
const nullToUndefined = <T>(value: T | null | undefined): T | undefined => (value === null ? undefined : value);

import {
  schedulerStateSchema,
  triggerSchedulerStateSchema,
  triggerInvocationSchema,
  conversationDebugViewSchema,
  systemHealthSchema,
} from './debugging.schemas.ts';

// ============================================================================
// debug_list_triggers
// ============================================================================

const debugListTriggersInputSchema = z.object({
  status: z.enum(['active', 'paused', 'completed', 'failed']).nullish().describe('Filter by status'),
  includeSchedulerState: z.boolean().nullish().default(true).describe('Include in-memory scheduler state'),
  limit: z.number().nullish().default(50).describe('Maximum number of triggers to return'),
});

const debugListTriggersOutputSchema = z.object({
  triggers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      goal: z.string(),
      schedule: z.object({
        type: z.enum(['once', 'cron']),
        at: z.string().optional(),
        expression: z.string().optional(),
      }),
      status: z.string(),
      invocationCount: z.number(),
      consecutiveFailures: z.number(),
      lastInvokedAt: z.string().optional(),
      nextInvocationAt: z.string().optional(),
      lastError: z.string().optional(),
      continuation: z.string().nullable(),
      createdAt: z.string(),
      schedulerState: triggerSchedulerStateSchema.optional(),
    }),
  ),
  schedulerRunning: z.boolean(),
  totalScheduled: z.number(),
});

type DebugListTriggersInput = z.infer<typeof debugListTriggersInputSchema>;
type DebugListTriggersInputRaw = z.input<typeof debugListTriggersInputSchema>;
type DebugListTriggersOutput = z.infer<typeof debugListTriggersOutputSchema>;

const debugListTriggersTool: ToolDefinition<
  DebugListTriggersInput,
  DebugListTriggersOutput,
  DebugListTriggersInputRaw
> = {
  id: 'debugging_list_triggers',
  name: 'DebugListTriggers',
  description: `List all triggers with complete state information for debugging.

Unlike the normal list_triggers tool, this includes:
- Internal state (consecutive failures, last error)
- Scheduler state (is timer scheduled, when will it fire)
- Continuation notes

Use this to get an overview of trigger system health.`,
  category: 'debugging',
  inputSchema: debugListTriggersInputSchema,
  outputSchema: debugListTriggersOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only query of trigger data',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['debugging', 'triggers', 'read'],
  examples: [
    { input: {}, description: 'List all triggers' },
    { input: { status: 'failed' }, description: 'List only failed triggers' },
  ],
  execute: async (input: DebugListTriggersInput, context: ToolContext): Promise<DebugListTriggersOutput> => {
    const triggerService = context.services.get(TriggerService);

    const triggers = await triggerService.list({
      status: nullToUndefined(input.status),
      limit: nullToUndefined(input.limit),
    });

    const schedulerState = triggerService.getSchedulerState();

    const triggersWithState = triggers.map((trigger) => {
      const scheduled = schedulerState.scheduledTriggers.find((s) => s.triggerId === trigger.id);
      return {
        id: trigger.id,
        name: trigger.name,
        goal: trigger.goal,
        schedule: trigger.schedule,
        status: trigger.status,
        invocationCount: trigger.invocationCount,
        consecutiveFailures: trigger.consecutiveFailures,
        lastInvokedAt: trigger.lastInvokedAt,
        nextInvocationAt: trigger.nextInvocationAt,
        lastError: trigger.lastError,
        continuation: trigger.continuation,
        createdAt: trigger.createdAt,
        ...(input.includeSchedulerState && {
          schedulerState: {
            isScheduled: !!scheduled,
            scheduledFireTime: scheduled?.scheduledFireTime ?? null,
            timerDelayMs: scheduled?.delayMs ?? null,
          },
        }),
      };
    });

    return {
      triggers: triggersWithState,
      schedulerRunning: schedulerState.running,
      totalScheduled: schedulerState.scheduledCount,
    };
  },
};

// ============================================================================
// debug_get_trigger
// ============================================================================

const debugGetTriggerInputSchema = z.object({
  triggerId: z.string().nullish().describe('Trigger ID'),
  triggerName: z.string().nullish().describe('Or lookup by name'),
  includeConversations: z.boolean().nullish().default(true).describe('Include conversation summaries'),
  conversationLimit: z.number().nullish().default(10).describe('How many recent conversations'),
});

const debugGetTriggerOutputSchema = z.object({
  trigger: z.object({
    id: z.string(),
    name: z.string(),
    goal: z.string(),
    schedule: z.object({
      type: z.enum(['once', 'cron']),
      at: z.string().optional(),
      expression: z.string().optional(),
    }),
    modelTier: z.string().optional(),
    setupContext: z.string().optional(),
    maxInvocations: z.number().optional(),
    endsAt: z.string().optional(),
    status: z.string(),
    invocationCount: z.number(),
    consecutiveFailures: z.number(),
    lastInvokedAt: z.string().optional(),
    nextInvocationAt: z.string().optional(),
    lastError: z.string().optional(),
    continuation: z.string().nullable(),
    continuationUpdatedAt: z.string().nullable(),
    createdByConversationId: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    schedulerState: triggerSchedulerStateSchema,
  }),
  conversations: z.array(
    z.object({
      id: z.string(),
      invokedAt: z.string(),
      messageCount: z.number(),
      title: z.string().optional(),
    }),
  ),
});

type DebugGetTriggerInput = z.infer<typeof debugGetTriggerInputSchema>;
type DebugGetTriggerInputRaw = z.input<typeof debugGetTriggerInputSchema>;
type DebugGetTriggerOutput = z.infer<typeof debugGetTriggerOutputSchema>;

const debugGetTriggerTool: ToolDefinition<DebugGetTriggerInput, DebugGetTriggerOutput, DebugGetTriggerInputRaw> = {
  id: 'debugging_get_trigger',
  name: 'DebugGetTrigger',
  description: `Get complete debugging information for a specific trigger.

Includes:
- Full trigger configuration and state
- Scheduler timer state
- Recent invocation history with conversation IDs
- Any errors or failure information

Use this after debug_list_triggers to drill into a specific trigger.`,
  category: 'debugging',
  inputSchema: debugGetTriggerInputSchema,
  outputSchema: debugGetTriggerOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only query of trigger data',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['debugging', 'triggers', 'read'],
  examples: [
    { input: { triggerName: 'daily-briefing' }, description: 'Get the daily briefing trigger' },
    { input: { triggerId: 'abc123', conversationLimit: 5 }, description: 'Get trigger by ID with limited history' },
  ],
  execute: async (input: DebugGetTriggerInput, context: ToolContext): Promise<DebugGetTriggerOutput> => {
    const triggerService = context.services.get(TriggerService);
    const db = context.services.get(DatabaseService).knex;

    if (!input.triggerId && !input.triggerName) {
      throw new Error('Either triggerId or triggerName must be provided');
    }

    const trigger = input.triggerId
      ? await triggerService.get(input.triggerId)
      : input.triggerName
        ? await triggerService.getByName(input.triggerName)
        : null;

    if (!trigger) {
      throw new Error(`Trigger not found: ${input.triggerId ?? input.triggerName}`);
    }

    // Get scheduler state
    const schedulerState = triggerService.getSchedulerState();
    const scheduled = schedulerState.scheduledTriggers.find((s) => s.triggerId === trigger.id);

    // Get conversations if requested
    const conversations: { id: string; invokedAt: string; messageCount: number; title?: string }[] = [];
    if (input.includeConversations) {
      const conversationIds = await triggerService.getConversations(trigger.id, {
        limit: nullToUndefined(input.conversationLimit),
      });

      for (const convId of conversationIds) {
        const conv = await getConversation(db, convId);
        if (conv) {
          conversations.push({
            id: conv.id,
            invokedAt: conv.startedAt,
            messageCount: conv.messageCount,
            title: nullToUndefined(conv.title),
          });
        }
      }
    }

    return {
      trigger: {
        id: trigger.id,
        name: trigger.name,
        goal: trigger.goal,
        schedule: trigger.schedule,
        modelTier: trigger.modelTier,
        setupContext: trigger.setupContext,
        maxInvocations: trigger.maxInvocations,
        endsAt: trigger.endsAt,
        status: trigger.status,
        invocationCount: trigger.invocationCount,
        consecutiveFailures: trigger.consecutiveFailures,
        lastInvokedAt: trigger.lastInvokedAt,
        nextInvocationAt: trigger.nextInvocationAt,
        lastError: trigger.lastError,
        continuation: trigger.continuation,
        continuationUpdatedAt: trigger.continuationUpdatedAt,
        createdByConversationId: trigger.createdByConversationId,
        createdAt: trigger.createdAt,
        updatedAt: trigger.updatedAt,
        schedulerState: {
          isScheduled: !!scheduled,
          scheduledFireTime: scheduled?.scheduledFireTime ?? null,
          timerDelayMs: scheduled?.delayMs ?? null,
        },
      },
      conversations,
    };
  },
};

// ============================================================================
// debug_trigger_history
// ============================================================================

const debugTriggerHistoryInputSchema = z.object({
  triggerId: z.string().nullish().describe('Filter to specific trigger'),
  since: z.string().nullish().describe('Only invocations after this ISO8601 time'),
  limit: z.number().nullish().default(50).describe('Maximum number of invocations'),
});

const debugTriggerHistoryOutputSchema = z.object({
  invocations: z.array(triggerInvocationSchema),
});

type DebugTriggerHistoryInput = z.infer<typeof debugTriggerHistoryInputSchema>;
type DebugTriggerHistoryInputRaw = z.input<typeof debugTriggerHistoryInputSchema>;
type DebugTriggerHistoryOutput = z.infer<typeof debugTriggerHistoryOutputSchema>;

const debugTriggerHistoryTool: ToolDefinition<
  DebugTriggerHistoryInput,
  DebugTriggerHistoryOutput,
  DebugTriggerHistoryInputRaw
> = {
  id: 'debugging_trigger_history',
  name: 'DebugTriggerHistory',
  description: `Get recent trigger invocation history.

Shows when triggers fired, which conversations they created, and whether
they succeeded or failed. Useful for understanding trigger activity over time.

Can filter to a specific trigger or show all trigger activity.`,
  category: 'debugging',
  inputSchema: debugTriggerHistoryInputSchema,
  outputSchema: debugTriggerHistoryOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only query of historical data',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['debugging', 'triggers', 'history', 'read'],
  examples: [
    { input: {}, description: 'Get recent trigger history' },
    { input: { triggerId: 'abc123' }, description: 'Get history for specific trigger' },
  ],
  execute: async (input: DebugTriggerHistoryInput, context: ToolContext): Promise<DebugTriggerHistoryOutput> => {
    const db = context.services.get(DatabaseService).knex;
    const triggerService = context.services.get(TriggerService);

    // Build query for trigger_conversations
    let query = db('trigger_conversations')
      .orderBy('invoked_at', 'desc')
      .limit(input.limit ?? 50);

    if (input.triggerId) {
      query = query.where({ trigger_id: input.triggerId });
    }

    if (input.since) {
      query = query.where('invoked_at', '>=', input.since);
    }

    const rows = await query;

    // Fetch trigger names
    const triggerIds = [...new Set(rows.map((r: { trigger_id: string }) => r.trigger_id))];
    const triggers = await Promise.all(triggerIds.map((id) => triggerService.get(id as string)));
    const validTriggers = triggers.filter((t): t is NonNullable<typeof t> => t !== null);
    const triggerMap = new Map(validTriggers.map((t) => [t.id, t.name]));

    const invocations = rows.map((row: { trigger_id: string; conversation_id: string; invoked_at: string }) => ({
      triggerId: row.trigger_id,
      triggerName: triggerMap.get(row.trigger_id) ?? 'Unknown',
      conversationId: row.conversation_id,
      invokedAt: row.invoked_at,
    }));

    return { invocations };
  },
};

// ============================================================================
// debug_scheduler_state
// ============================================================================

const debugSchedulerStateInputSchema = z.object({});

const debugSchedulerStateOutputSchema = schedulerStateSchema.extend({
  scheduledTriggers: z.array(
    z.object({
      triggerId: z.string(),
      triggerName: z.string(),
      scheduledFireTime: z.string(),
      delayMs: z.number(),
    }),
  ),
});

type DebugSchedulerStateInput = z.infer<typeof debugSchedulerStateInputSchema>;
type DebugSchedulerStateOutput = z.infer<typeof debugSchedulerStateOutputSchema>;

const debugSchedulerStateTool: ToolDefinition<DebugSchedulerStateInput, DebugSchedulerStateOutput> = {
  id: 'debugging_scheduler_state',
  name: 'DebugSchedulerState',
  description: `Get the current state of the in-memory trigger scheduler.

Shows:
- Whether the scheduler is running
- All currently scheduled timers
- When each timer will fire
- How long until each timer fires

This shows the LIVE scheduler state, not just database state.
A trigger might be 'active' in the database but not scheduled in memory
if there was an issue during startup.`,
  category: 'debugging',
  inputSchema: debugSchedulerStateInputSchema,
  outputSchema: debugSchedulerStateOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only query of scheduler state',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['debugging', 'scheduler', 'read'],
  examples: [{ input: {}, description: 'Get current scheduler state' }],
  execute: async (_input: DebugSchedulerStateInput, context: ToolContext): Promise<DebugSchedulerStateOutput> => {
    const triggerService = context.services.get(TriggerService);
    const schedulerState = triggerService.getSchedulerState();

    // Enrich with trigger names
    const enrichedTriggers = await Promise.all(
      schedulerState.scheduledTriggers.map(async (s) => {
        const trigger = await triggerService.get(s.triggerId);
        return {
          triggerId: s.triggerId,
          triggerName: trigger?.name ?? 'Unknown',
          scheduledFireTime: s.scheduledFireTime,
          delayMs: s.delayMs,
        };
      }),
    );

    return {
      running: schedulerState.running,
      scheduledCount: schedulerState.scheduledCount,
      scheduledTriggers: enrichedTriggers,
    };
  },
};

// ============================================================================
// debug_get_conversation
// ============================================================================

const debugGetConversationInputSchema = z.object({
  conversationId: z.string().describe('The conversation ID to inspect'),
});

const debugGetConversationOutputSchema = conversationDebugViewSchema;

type DebugGetConversationInput = z.infer<typeof debugGetConversationInputSchema>;
type DebugGetConversationOutput = z.infer<typeof debugGetConversationOutputSchema>;

const debugGetConversationTool: ToolDefinition<DebugGetConversationInput, DebugGetConversationOutput> = {
  id: 'debugging_get_conversation',
  name: 'DebugGetConversation',
  description: `Get complete conversation data for debugging.

Includes:
- Conversation metadata
- All messages with full content
- Tool calls and their results
- Any pending interrupts
- Trigger association (if trigger-invoked)
- Telegram chat mapping (if applicable)

Use this to trace exactly what happened in a conversation.`,
  category: 'debugging',
  inputSchema: debugGetConversationInputSchema,
  outputSchema: debugGetConversationOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only query of conversation data',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['debugging', 'conversations', 'read'],
  examples: [{ input: { conversationId: 'abc-123' }, description: 'Get conversation details' }],
  execute: async (input: DebugGetConversationInput, context: ToolContext): Promise<DebugGetConversationOutput> => {
    const db = context.services.get(DatabaseService).knex;
    const triggerService = context.services.get(TriggerService);

    const conversation = await getConversation(db, input.conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${input.conversationId}`);
    }

    const messages = await getMessages(db, input.conversationId);

    // Get trigger association
    const trigger = await triggerService.getByConversation(input.conversationId);

    // Get Telegram chat mapping
    const telegramChat = await getTelegramChatByConversation(db, input.conversationId);

    // Get pending interrupts
    const pendingInterrupts = await db('interrupts')
      .where({ conversation_id: input.conversationId, status: 'pending' })
      .select('*');

    return {
      id: conversation.id,
      title: nullToUndefined(conversation.title),
      summary: nullToUndefined(conversation.summary),
      startedAt: conversation.startedAt,
      lastActivityAt: conversation.lastActivityAt,
      messageCount: conversation.messageCount,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant' | 'tool',
        content: m.content,
        toolCallId: nullToUndefined(m.toolCallId),
        toolCalls: m.toolCalls ? JSON.parse(m.toolCalls) : undefined,
        inputTokens: nullToUndefined(m.inputTokens),
        outputTokens: nullToUndefined(m.outputTokens),
        createdAt: m.createdAt,
      })),
      trigger: trigger ? { id: trigger.id, name: trigger.name } : undefined,
      telegramChat: telegramChat
        ? {
            chatId: telegramChat.telegramChatId,
            userId: telegramChat.telegramUserId,
          }
        : undefined,
      pendingInterrupts: pendingInterrupts.map(
        (i: { id: string; type: string; status: string; prompt: string; created_at: string }) => ({
          id: i.id,
          type: i.type,
          status: i.status,
          prompt: i.prompt,
          createdAt: i.created_at,
        }),
      ),
    };
  },
};

// ============================================================================
// debug_list_conversations
// ============================================================================

const debugListConversationsInputSchema = z.object({
  triggerOnly: z.boolean().nullish().default(false).describe('Only trigger-invoked conversations'),
  triggerId: z.string().nullish().describe('Only conversations from this trigger'),
  since: z.string().nullish().describe('Only after this ISO8601 time'),
  limit: z.number().nullish().default(20).describe('Maximum number of conversations'),
});

const debugListConversationsOutputSchema = z.object({
  conversations: z.array(
    z.object({
      id: z.string(),
      title: z.string().optional(),
      startedAt: z.string(),
      lastActivityAt: z.string(),
      messageCount: z.number(),
      trigger: z
        .object({
          id: z.string(),
          name: z.string(),
        })
        .optional(),
    }),
  ),
});

type DebugListConversationsInput = z.infer<typeof debugListConversationsInputSchema>;
type DebugListConversationsInputRaw = z.input<typeof debugListConversationsInputSchema>;
type DebugListConversationsOutput = z.infer<typeof debugListConversationsOutputSchema>;

const debugListConversationsTool: ToolDefinition<
  DebugListConversationsInput,
  DebugListConversationsOutput,
  DebugListConversationsInputRaw
> = {
  id: 'debugging_list_conversations',
  name: 'DebugListConversations',
  description: `List recent conversations for debugging.

Can filter to trigger-created conversations only, or include all.
Useful for finding conversation IDs to inspect with debug_get_conversation.`,
  category: 'debugging',
  inputSchema: debugListConversationsInputSchema,
  outputSchema: debugListConversationsOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only query of conversation list',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['debugging', 'conversations', 'read'],
  examples: [
    { input: {}, description: 'List recent conversations' },
    { input: { triggerOnly: true }, description: 'List only trigger-invoked conversations' },
  ],
  execute: async (input: DebugListConversationsInput, context: ToolContext): Promise<DebugListConversationsOutput> => {
    const db = context.services.get(DatabaseService).knex;
    const triggerService = context.services.get(TriggerService);

    let conversationIds: string[];

    if (input.triggerId) {
      // Get conversations for specific trigger
      conversationIds = await triggerService.getConversations(input.triggerId, {
        limit: nullToUndefined(input.limit),
      });
    } else if (input.triggerOnly) {
      // Get all trigger conversations
      let query = db('trigger_conversations')
        .orderBy('invoked_at', 'desc')
        .limit(input.limit ?? 20);
      if (input.since) {
        query = query.where('invoked_at', '>=', input.since);
      }
      const rows = await query;
      conversationIds = rows.map((r: { conversation_id: string }) => r.conversation_id);
    } else {
      // Get all recent conversations
      const convs = await listConversations(db, { limit: nullToUndefined(input.limit) });
      conversationIds = convs.map((c) => c.id);
    }

    // Fetch full conversation data
    const conversations = await Promise.all(
      conversationIds.map(async (id) => {
        const conv = await getConversation(db, id);
        if (!conv) return null;

        const trigger = await triggerService.getByConversation(id);
        return {
          id: conv.id,
          title: nullToUndefined(conv.title),
          startedAt: conv.startedAt,
          lastActivityAt: conv.lastActivityAt,
          messageCount: conv.messageCount,
          trigger: trigger ? { id: trigger.id, name: trigger.name } : undefined,
        };
      }),
    );

    return {
      conversations: conversations.filter((c): c is NonNullable<typeof c> => c !== null),
    };
  },
};

// ============================================================================
// debug_system_health
// ============================================================================

const debugSystemHealthInputSchema = z.object({});
const debugSystemHealthOutputSchema = systemHealthSchema;

type DebugSystemHealthInput = z.infer<typeof debugSystemHealthInputSchema>;
type DebugSystemHealthOutput = z.infer<typeof debugSystemHealthOutputSchema>;

const debugSystemHealthTool: ToolDefinition<DebugSystemHealthInput, DebugSystemHealthOutput> = {
  id: 'debugging_system_health',
  name: 'DebugSystemHealth',
  description: `Get GLaDOS system health and configuration status.

Shows:
- Service configuration status
- Trigger system statistics
- Recent conversation counts

Use this for a quick overview of system state.`,
  category: 'debugging',
  inputSchema: debugSystemHealthInputSchema,
  outputSchema: debugSystemHealthOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only system status query',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['debugging', 'system', 'health', 'read'],
  examples: [{ input: {}, description: 'Get system health status' }],
  execute: async (_input: DebugSystemHealthInput, context: ToolContext): Promise<DebugSystemHealthOutput> => {
    const db = context.services.get(DatabaseService).knex;
    const triggerService = context.services.get(TriggerService);

    // Get trigger statistics
    const allTriggers = await triggerService.list({});
    const triggerStats = {
      total: allTriggers.length,
      active: allTriggers.filter((t) => t.status === 'active').length,
      paused: allTriggers.filter((t) => t.status === 'paused').length,
      completed: allTriggers.filter((t) => t.status === 'completed').length,
      failed: allTriggers.filter((t) => t.status === 'failed').length,
    };

    // Get conversation counts
    const totalConversations = await db('conversations').count('* as count').first();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recentConversations = await db('conversations')
      .where('started_at', '>=', oneDayAgo)
      .count('* as count')
      .first();

    // Get scheduler state
    const schedulerState = triggerService.getSchedulerState();

    return {
      services: {
        database: {
          configured: true, // If we got here, DB is working
        },
        orchestrator: {
          configured: true, // Inferred from trigger service being configured
        },
        triggerService: {
          configured: triggerService.isConfigured,
          running: schedulerState.running,
          scheduledCount: schedulerState.scheduledCount,
        },
        telegramClient: {
          configured: true, // Would need to inject this info
        },
      },
      triggers: triggerStats,
      conversations: {
        total: (totalConversations?.count as number) ?? 0,
        recentCount: (recentConversations?.count as number) ?? 0,
      },
    };
  },
};

// ============================================================================
// debugging_search_logs
// ============================================================================

const debugSearchLogsInputSchema = z.object({
  level: z
    .array(z.enum(['debug', 'info', 'warn', 'error']))
    .nullish()
    .describe('Filter by log level(s)'),
  source: z.array(z.string()).nullish().describe('Filter by source(s), supports wildcards like "tool:*"'),
  conversationId: z.string().nullish().describe('Filter by conversation ID'),
  triggerId: z.string().nullish().describe('Filter by trigger ID'),
  toolName: z.string().nullish().describe('Filter by tool name'),
  since: z.string().nullish().describe('Only logs after this time (ISO8601 or relative like "1 hour ago")'),
  until: z.string().nullish().describe('Only logs before this time'),
  search: z.string().nullish().describe('Search text in log messages'),
  limit: z.number().nullish().default(50).describe('Maximum logs to return'),
  offset: z.number().nullish().default(0).describe('Offset for pagination'),
});

const debugSearchLogsOutputSchema = z.object({
  logs: z.array(
    z.object({
      id: z.string(),
      timestamp: z.string(),
      level: z.enum(['debug', 'info', 'warn', 'error']),
      source: z.string(),
      message: z.string(),
      conversationId: z.string().optional(),
      triggerId: z.string().optional(),
      toolName: z.string().optional(),
      errorName: z.string().optional(),
      errorMessage: z.string().optional(),
      errorStack: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
  total: z.number(),
  hasMore: z.boolean(),
});

type DebugSearchLogsInput = z.infer<typeof debugSearchLogsInputSchema>;
type DebugSearchLogsInputRaw = z.input<typeof debugSearchLogsInputSchema>;
type DebugSearchLogsOutput = z.infer<typeof debugSearchLogsOutputSchema>;

const debugSearchLogsTool: ToolDefinition<DebugSearchLogsInput, DebugSearchLogsOutput, DebugSearchLogsInputRaw> = {
  id: 'debugging_search_logs',
  name: 'DebugSearchLogs',
  description: `Search system logs with filters.

Use this to investigate errors, trace execution flow, or understand
what happened during a specific conversation or trigger invocation.

Examples:
- Find all errors: { level: 'error' }
- Errors in last hour: { level: 'error', since: '2024-01-15T10:00:00Z' }
- Logs for a conversation: { conversationId: '...' }
- Tool execution logs: { source: 'tool:*' }
- Search for specific text: { search: '400' }`,
  category: 'debugging',
  inputSchema: debugSearchLogsInputSchema,
  outputSchema: debugSearchLogsOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only query of log data',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['debugging', 'logs', 'read'],
  examples: [
    { input: { level: ['error'] }, description: 'Find all errors' },
    { input: { level: ['error'], search: '400' }, description: 'Find 400 errors' },
    { input: { conversationId: 'abc123' }, description: 'Logs for a conversation' },
  ],
  execute: async (input: DebugSearchLogsInput, context: ToolContext): Promise<DebugSearchLogsOutput> => {
    const { LogService } = await import('../../../core/logging/index.ts');
    const logService = context.services.get(LogService);

    const result = await logService.query({
      level: nullToUndefined(input.level),
      source: nullToUndefined(input.source),
      conversationId: nullToUndefined(input.conversationId),
      triggerId: nullToUndefined(input.triggerId),
      toolName: nullToUndefined(input.toolName),
      since: nullToUndefined(input.since),
      until: nullToUndefined(input.until),
      search: nullToUndefined(input.search),
      limit: input.limit ?? 50,
      offset: input.offset ?? 0,
      order: 'desc',
    });

    return {
      logs: result.logs,
      total: result.total,
      hasMore: result.hasMore,
    };
  },
};

// ============================================================================
// debugging_get_log_context
// ============================================================================

const debugGetLogContextInputSchema = z.object({
  logId: z.string().describe('The log entry ID to get context for'),
  before: z.number().nullish().default(10).describe('Number of log entries before'),
  after: z.number().nullish().default(10).describe('Number of log entries after'),
  sameSourceOnly: z.boolean().nullish().default(false).describe('Only include logs from the same source'),
});

const debugGetLogContextOutputSchema = z.object({
  target: z
    .object({
      id: z.string(),
      timestamp: z.string(),
      level: z.enum(['debug', 'info', 'warn', 'error']),
      source: z.string(),
      message: z.string(),
      conversationId: z.string().optional(),
      triggerId: z.string().optional(),
      toolName: z.string().optional(),
      errorName: z.string().optional(),
      errorMessage: z.string().optional(),
      errorStack: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .nullable(),
  before: z.array(
    z.object({
      id: z.string(),
      timestamp: z.string(),
      level: z.enum(['debug', 'info', 'warn', 'error']),
      source: z.string(),
      message: z.string(),
    }),
  ),
  after: z.array(
    z.object({
      id: z.string(),
      timestamp: z.string(),
      level: z.enum(['debug', 'info', 'warn', 'error']),
      source: z.string(),
      message: z.string(),
    }),
  ),
});

type DebugGetLogContextInput = z.infer<typeof debugGetLogContextInputSchema>;
type DebugGetLogContextInputRaw = z.input<typeof debugGetLogContextInputSchema>;
type DebugGetLogContextOutput = z.infer<typeof debugGetLogContextOutputSchema>;

const debugGetLogContextTool: ToolDefinition<
  DebugGetLogContextInput,
  DebugGetLogContextOutput,
  DebugGetLogContextInputRaw
> = {
  id: 'debugging_get_log_context',
  name: 'DebugGetLogContext',
  description: `Get log entries surrounding a specific log entry.

Useful when you find an error and want to see what happened
before and after it. Returns logs within a time window.`,
  category: 'debugging',
  inputSchema: debugGetLogContextInputSchema,
  outputSchema: debugGetLogContextOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only query of log data',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['debugging', 'logs', 'read'],
  examples: [{ input: { logId: 'abc123' }, description: 'Get context for a log entry' }],
  execute: async (input: DebugGetLogContextInput, context: ToolContext): Promise<DebugGetLogContextOutput> => {
    const { LogService } = await import('../../../core/logging/index.ts');
    const logService = context.services.get(LogService);

    const result = await logService.getContext(input.logId, {
      before: input.before ?? 10,
      after: input.after ?? 10,
      sameSourceOnly: input.sameSourceOnly ?? false,
    });

    return {
      target: result.target,
      before: result.before.map((log) => ({
        id: log.id,
        timestamp: log.timestamp,
        level: log.level,
        source: log.source,
        message: log.message,
      })),
      after: result.after.map((log) => ({
        id: log.id,
        timestamp: log.timestamp,
        level: log.level,
        source: log.source,
        message: log.message,
      })),
    };
  },
};

// ============================================================================
// debugging_log_stats
// ============================================================================

const debugLogStatsInputSchema = z.object({
  since: z.string().nullish().describe('Only stats for logs after this time'),
});

const debugLogStatsOutputSchema = z.object({
  total: z.number(),
  byLevel: z.object({
    debug: z.number(),
    info: z.number(),
    warn: z.number(),
    error: z.number(),
  }),
  bySource: z.record(z.string(), z.number()),
  timeRange: z.object({
    oldest: z.string().nullable(),
    newest: z.string().nullable(),
  }),
  errorsLast24h: z.number(),
  warningsLast24h: z.number(),
});

type DebugLogStatsInput = z.infer<typeof debugLogStatsInputSchema>;
type DebugLogStatsOutput = z.infer<typeof debugLogStatsOutputSchema>;

const debugLogStatsTool: ToolDefinition<DebugLogStatsInput, DebugLogStatsOutput> = {
  id: 'debugging_log_stats',
  name: 'DebugLogStats',
  description: `Get aggregate statistics about system logs.

Shows error/warning counts, logs by source, time ranges, etc.
Useful for getting an overview of system health.`,
  category: 'debugging',
  inputSchema: debugLogStatsInputSchema,
  outputSchema: debugLogStatsOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only aggregate query',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['debugging', 'logs', 'stats', 'read'],
  examples: [
    { input: {}, description: 'Get overall log stats' },
    { input: { since: '2024-01-15T00:00:00Z' }, description: 'Get stats since a date' },
  ],
  execute: async (input: DebugLogStatsInput, context: ToolContext): Promise<DebugLogStatsOutput> => {
    const { LogService } = await import('../../../core/logging/index.ts');
    const logService = context.services.get(LogService);

    return logService.stats(nullToUndefined(input.since));
  },
};

// ============================================================================
// debug_get_system_prompt
// ============================================================================

const debugGetSystemPromptInputSchema = z.object({
  includeContext: z.boolean().nullish().default(true).describe('Include current context in the prompt generation'),
  personalityId: z.string().nullish().default('default').describe('Personality config ID to use'),
});

const debugGetSystemPromptOutputSchema = z.object({
  systemPrompt: z.string(),
  personalityId: z.string(),
  contextIncluded: z.boolean(),
  promptLength: z.number(),
});

type DebugGetSystemPromptInput = z.infer<typeof debugGetSystemPromptInputSchema>;
type DebugGetSystemPromptInputRaw = z.input<typeof debugGetSystemPromptInputSchema>;
type DebugGetSystemPromptOutput = z.infer<typeof debugGetSystemPromptOutputSchema>;

const debugGetSystemPromptTool: ToolDefinition<
  DebugGetSystemPromptInput,
  DebugGetSystemPromptOutput,
  DebugGetSystemPromptInputRaw
> = {
  id: 'debugging_get_system_prompt',
  name: 'DebugGetSystemPrompt',
  description: `Generate and return the system prompt that would be used for a conversation.

Uses the context builder to gather current context (time, location, calendar, etc.)
and the personality service to assemble the full system prompt.

Useful for:
- Understanding what context the agent sees
- Debugging prompt construction issues
- Verifying personality configuration effects
- Inspecting what instructions the agent receives`,
  category: 'debugging',
  inputSchema: debugGetSystemPromptInputSchema,
  outputSchema: debugGetSystemPromptOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only generation of system prompt',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['debugging', 'prompt', 'context', 'read'],
  examples: [
    { input: {}, description: 'Generate system prompt with current context' },
    { input: { includeContext: false }, description: 'Generate system prompt without context' },
    { input: { personalityId: 'custom' }, description: 'Generate using a custom personality' },
  ],
  execute: async (input: DebugGetSystemPromptInput, context: ToolContext): Promise<DebugGetSystemPromptOutput> => {
    const personalityService = context.services.get(PersonalityService);
    const personalityId = input.personalityId ?? 'default';

    let agentContext = undefined;
    if (input.includeContext) {
      const contextBuilder = context.services.get(ContextBuilderService);
      const { context: builtContext } = await contextBuilder.buildContext();
      agentContext = builtContext;
    }

    const systemPrompt = await personalityService.buildSystemPrompt(agentContext, personalityId);

    return {
      systemPrompt,
      personalityId,
      contextIncluded: input.includeContext ?? true,
      promptLength: systemPrompt.length,
    };
  },
};

// ============================================================================
// debugging_list_available_tools
// ============================================================================

const debugListAvailableToolsInputSchema = z.object({
  category: z.string().nullish().describe('Filter by category'),
  includeSkillTools: z.boolean().nullish().default(true).describe('Include tools from skills'),
  includeRiskInfo: z.boolean().nullish().default(true).describe('Include risk level information'),
});

const debugListAvailableToolsOutputSchema = z.object({
  baseTools: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      category: z.string(),
      description: z.string(),
      riskLevel: z.string().optional(),
      tags: z.array(z.string()),
    }),
  ),
  skills: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      activationRisk: z.string(),
      tools: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          category: z.string(),
          description: z.string(),
          riskLevel: z.string().optional(),
        }),
      ),
    }),
  ),
  summary: z.object({
    totalBaseTools: z.number(),
    totalSkills: z.number(),
    totalSkillTools: z.number(),
    categoryCounts: z.record(z.string(), z.number()),
  }),
});

type DebugListAvailableToolsInput = z.infer<typeof debugListAvailableToolsInputSchema>;
type DebugListAvailableToolsInputRaw = z.input<typeof debugListAvailableToolsInputSchema>;
type DebugListAvailableToolsOutput = z.infer<typeof debugListAvailableToolsOutputSchema>;

const debugListAvailableToolsTool: ToolDefinition<
  DebugListAvailableToolsInput,
  DebugListAvailableToolsOutput,
  DebugListAvailableToolsInputRaw
> = {
  id: 'debugging_list_available_tools',
  name: 'DebugListAvailableTools',
  description: `List all tools currently registered with the orchestrator.

Shows:
- Base tools (always available)
- Skill tools (grouped by skill, require activation)
- Risk levels for each tool
- Category breakdown

Use this to understand what capabilities are available and how they're organized.`,
  category: 'debugging',
  inputSchema: debugListAvailableToolsInputSchema,
  outputSchema: debugListAvailableToolsOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only query of tool registry',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['debugging', 'tools', 'read'],
  examples: [
    { input: {}, description: 'List all available tools' },
    { input: { category: 'calendar' }, description: 'List only calendar tools' },
    { input: { includeSkillTools: false }, description: 'List only base tools' },
  ],
  execute: async (
    input: DebugListAvailableToolsInput,
    context: ToolContext,
  ): Promise<DebugListAvailableToolsOutput> => {
    const orchestratorService = context.services.get(OrchestratorService);
    const toolRegistry = orchestratorService.toolRegistry;
    const skillRegistry = orchestratorService.skillRegistry;

    // Get base tools
    let baseTools = toolRegistry.getAll();
    if (input.category) {
      baseTools = baseTools.filter((t) => t.category === input.category);
    }

    const baseToolsOutput = baseTools.map((tool) => {
      const riskLevel = input.includeRiskInfo && 'level' in tool.risk ? (tool.risk.level as string) : undefined;
      return {
        id: tool.id,
        name: tool.name,
        category: tool.category,
        description: tool.description.split('\n')[0], // First line only
        riskLevel,
        tags: tool.tags,
      };
    });

    // Get skills and their tools
    const skillsOutput: DebugListAvailableToolsOutput['skills'] = [];
    if (input.includeSkillTools) {
      const allSkills = skillRegistry.getAll();
      for (const skill of allSkills) {
        let skillTools = skill.tools;
        if (input.category) {
          skillTools = skillTools.filter((t) => t.category === input.category);
        }
        if (skillTools.length === 0 && input.category) {
          continue; // Skip skills with no matching tools when filtering
        }
        skillsOutput.push({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          activationRisk: skill.activationRisk,
          tools: skillTools.map((tool) => {
            const riskLevel = input.includeRiskInfo && 'level' in tool.risk ? (tool.risk.level as string) : undefined;
            return {
              id: tool.id,
              name: tool.name,
              category: tool.category,
              description: tool.description.split('\n')[0],
              riskLevel,
            };
          }),
        });
      }
    }

    // Build category counts
    const categoryCounts: Record<string, number> = {};
    for (const tool of baseToolsOutput) {
      categoryCounts[tool.category] = (categoryCounts[tool.category] ?? 0) + 1;
    }
    for (const skill of skillsOutput) {
      for (const tool of skill.tools) {
        categoryCounts[tool.category] = (categoryCounts[tool.category] ?? 0) + 1;
      }
    }

    const totalSkillTools = skillsOutput.reduce((sum, skill) => sum + skill.tools.length, 0);

    return {
      baseTools: baseToolsOutput,
      skills: skillsOutput,
      summary: {
        totalBaseTools: baseToolsOutput.length,
        totalSkills: skillsOutput.length,
        totalSkillTools,
        categoryCounts,
      },
    };
  },
};

// ============================================================================
// debugging_fire_trigger
// ============================================================================

const debugFireTriggerInputSchema = z.object({
  triggerId: z.string().nullish().describe('Trigger ID to fire'),
  triggerName: z.string().nullish().describe('Or lookup by name'),
});

const debugFireTriggerOutputSchema = z.object({
  triggerId: z.string(),
  triggerName: z.string(),
  conversationId: z.string(),
  message: z.string(),
});

type DebugFireTriggerInput = z.infer<typeof debugFireTriggerInputSchema>;
type DebugFireTriggerInputRaw = z.input<typeof debugFireTriggerInputSchema>;
type DebugFireTriggerOutput = z.infer<typeof debugFireTriggerOutputSchema>;

const debugFireTriggerTool: ToolDefinition<DebugFireTriggerInput, DebugFireTriggerOutput, DebugFireTriggerInputRaw> = {
  id: 'debugging_fire_trigger',
  name: 'DebugFireTrigger',
  description: `Manually fire a registered trigger for debugging/testing purposes.

This bypasses the scheduler and fires the trigger immediately. The trigger
will be invoked even if it's paused or hasn't reached its scheduled time.

Use this to:
- Test a trigger without waiting for its schedule
- Debug trigger behavior
- Manually retry a failed trigger

The trigger's invocation count will be incremented and a new conversation
will be created, just like a normal scheduled firing.`,
  category: 'debugging',
  inputSchema: debugFireTriggerInputSchema,
  outputSchema: debugFireTriggerOutputSchema,
  risk: {
    level: 'medium',
    reason: 'Executes trigger which may send notifications or make external calls',
    potentialImpact: 'May send notifications or invoke external services',
    reversible: false,
    categories: ['external_communication'],
  },
  tags: ['debugging', 'triggers', 'execute'],
  examples: [
    { input: { triggerName: 'daily-briefing' }, description: 'Fire the daily briefing trigger' },
    { input: { triggerId: 'abc123' }, description: 'Fire trigger by ID' },
  ],
  execute: async (input: DebugFireTriggerInput, context: ToolContext): Promise<DebugFireTriggerOutput> => {
    const triggerService = context.services.get(TriggerService);

    if (!input.triggerId && !input.triggerName) {
      throw new Error('Either triggerId or triggerName must be provided');
    }

    // Look up the trigger
    const trigger = input.triggerId
      ? await triggerService.get(input.triggerId)
      : input.triggerName
        ? await triggerService.getByName(input.triggerName)
        : null;

    if (!trigger) {
      throw new Error(`Trigger not found: ${input.triggerId ?? input.triggerName}`);
    }

    // Fire the trigger
    const result = await triggerService.fireManually(trigger.id);

    return {
      triggerId: trigger.id,
      triggerName: trigger.name,
      conversationId: result.conversationId,
      message: `Trigger "${trigger.name}" fired successfully. Conversation ID: ${result.conversationId}`,
    };
  },
};

// ============================================================================
// Exports
// ============================================================================

export {
  debugListTriggersTool,
  debugGetTriggerTool,
  debugTriggerHistoryTool,
  debugSchedulerStateTool,
  debugGetConversationTool,
  debugListConversationsTool,
  debugSystemHealthTool,
  debugSearchLogsTool,
  debugGetLogContextTool,
  debugLogStatsTool,
  debugGetSystemPromptTool,
  debugListAvailableToolsTool,
  debugFireTriggerTool,
};
