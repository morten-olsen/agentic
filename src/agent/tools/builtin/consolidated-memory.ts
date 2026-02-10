import { z } from 'zod';

import type { ToolDefinition, ToolContext, ToolRegistry } from '../tools.ts';
import { DatabaseService } from '../../../core/database/database.ts';
import { ConsolidatedMemoryStore } from '../../memory/consolidation/consolidated.store.ts';
import type { ConsolidatedMemory, ConsolidatedMemoryType } from '../../memory/consolidation/consolidation.schemas.ts';

// ============================================================================
// Schemas
// ============================================================================

// List consolidated memories
const listConsolidatedInputSchema = z.object({
  type: z
    .enum(['entity', 'decision', 'period', 'insight', 'preference'])
    .optional()
    .describe('Filter by consolidation type'),
  limit: z.number().int().positive().max(50).optional().default(10).describe('Maximum number of results'),
});

const consolidatedMemorySummarySchema = z.object({
  id: z.string(),
  type: z.string(),
  summary: z.string(),
  sourceMemoryCount: z.number(),
  timespanStart: z.string(),
  timespanEnd: z.string(),
  activationScore: z.number(),
  entityIds: z.array(z.string()).optional(),
  topics: z.array(z.string()).optional(),
});

const listConsolidatedOutputSchema = z.object({
  memories: z.array(consolidatedMemorySummarySchema),
  totalCount: z.number(),
});

// Get consolidated memory details
const getConsolidatedInputSchema = z.object({
  id: z.string().describe('The ID of the consolidated memory'),
});

const consolidatedMemoryDetailSchema = z.object({
  id: z.string(),
  type: z.string(),
  content: z.object({
    summary: z.string(),
    keyPoints: z.array(z.string()),
    structuredData: z.record(z.string(), z.unknown()).optional(),
    lessons: z.array(z.string()).optional(),
  }),
  sourceMemoryCount: z.number(),
  sourceMemoryIds: z.array(z.string()),
  timespanStart: z.string(),
  timespanEnd: z.string(),
  activationScore: z.number(),
  entityIds: z.array(z.string()),
  topics: z.array(z.string()),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const getConsolidatedOutputSchema = z.object({
  memory: consolidatedMemoryDetailSchema.nullable(),
});

// Drill down to source memories
const drillDownInputSchema = z.object({
  consolidatedId: z.string().describe('The ID of the consolidated memory to drill down into'),
  limit: z
    .number()
    .int()
    .positive()
    .max(50)
    .optional()
    .default(20)
    .describe('Maximum number of source memories to return'),
});

const sourceMemorySchema = z.object({
  id: z.string(),
  type: z.string(),
  content: z.string(),
  createdAt: z.string(),
  importance: z.number().optional(),
});

const drillDownOutputSchema = z.object({
  consolidatedId: z.string(),
  consolidatedSummary: z.string(),
  sourceMemories: z.array(sourceMemorySchema),
  totalSourceCount: z.number(),
});

// ============================================================================
// Types
// ============================================================================

type ListConsolidatedInput = z.infer<typeof listConsolidatedInputSchema>;
type ListConsolidatedOutput = z.infer<typeof listConsolidatedOutputSchema>;

type GetConsolidatedInput = z.infer<typeof getConsolidatedInputSchema>;
type GetConsolidatedOutput = z.infer<typeof getConsolidatedOutputSchema>;

type DrillDownInput = z.infer<typeof drillDownInputSchema>;
type DrillDownOutput = z.infer<typeof drillDownOutputSchema>;

// ============================================================================
// Helper Functions
// ============================================================================

const formatMemorySummary = (memory: ConsolidatedMemory): z.infer<typeof consolidatedMemorySummarySchema> => ({
  id: memory.id,
  type: memory.type,
  summary: memory.content.summary,
  sourceMemoryCount: memory.sourceMemoryCount,
  timespanStart: memory.timespan.start,
  timespanEnd: memory.timespan.end,
  activationScore: memory.activationScore,
  entityIds: memory.entityIds.length > 0 ? memory.entityIds : undefined,
  topics: memory.topics.length > 0 ? memory.topics : undefined,
});

const formatMemoryDetail = (memory: ConsolidatedMemory): z.infer<typeof consolidatedMemoryDetailSchema> => ({
  id: memory.id,
  type: memory.type,
  content: {
    summary: memory.content.summary,
    keyPoints: memory.content.keyPoints,
    structuredData: memory.content.structuredData ?? undefined,
    lessons: memory.content.lessons,
  },
  sourceMemoryCount: memory.sourceMemoryCount,
  sourceMemoryIds: memory.sourceMemoryIds,
  timespanStart: memory.timespan.start,
  timespanEnd: memory.timespan.end,
  activationScore: memory.activationScore,
  entityIds: memory.entityIds,
  topics: memory.topics,
  version: memory.version,
  createdAt: memory.createdAt,
  updatedAt: memory.updatedAt,
});

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * List consolidated memories.
 */
const listConsolidatedMemoriesTool: ToolDefinition<ListConsolidatedInput, ListConsolidatedOutput> = {
  id: 'memory.listConsolidated',
  name: 'ListConsolidatedMemories',
  category: 'memory',
  description:
    'List consolidated memories (distilled knowledge from multiple memories). Use this to browse high-level knowledge about entities, topics, and time periods.',
  inputSchema: listConsolidatedInputSchema,
  outputSchema: listConsolidatedOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only access to consolidated memories',
    potentialImpact: 'None',
    reversible: true,
    categories: ['data_access'],
  },
  tags: ['memory', 'consolidated', 'read'],
  examples: [
    {
      input: { type: 'entity', limit: 5 },
      description: 'List entity-type consolidated memories',
    },
    {
      input: { limit: 10 },
      description: 'List top 10 high-activation consolidated memories',
    },
  ],

  execute: async (input: ListConsolidatedInput, context: ToolContext): Promise<ListConsolidatedOutput> => {
    const dbService = context.services.get(DatabaseService);
    const store = new ConsolidatedMemoryStore(dbService.knex);

    let memories: ConsolidatedMemory[];

    if (input.type) {
      memories = await store.getByType(input.type as ConsolidatedMemoryType, input.limit);
    } else {
      memories = await store.getHighActivation(0, input.limit);
    }

    const totalCount = await store.getCount();

    return {
      memories: memories.map(formatMemorySummary),
      totalCount,
    };
  },
};

/**
 * Get details of a specific consolidated memory.
 */
const getConsolidatedMemoryTool: ToolDefinition<GetConsolidatedInput, GetConsolidatedOutput> = {
  id: 'memory.getConsolidated',
  name: 'GetConsolidatedMemory',
  category: 'memory',
  description:
    'Get detailed information about a specific consolidated memory, including key points, structured data, and lessons learned.',
  inputSchema: getConsolidatedInputSchema,
  outputSchema: getConsolidatedOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only access to a specific consolidated memory',
    potentialImpact: 'None',
    reversible: true,
    categories: ['data_access'],
  },
  tags: ['memory', 'consolidated', 'read'],
  examples: [
    {
      input: { id: 'c-12345' },
      description: 'Get details of a specific consolidated memory',
    },
  ],

  execute: async (input: GetConsolidatedInput, context: ToolContext): Promise<GetConsolidatedOutput> => {
    const dbService = context.services.get(DatabaseService);
    const store = new ConsolidatedMemoryStore(dbService.knex);

    const memory = await store.get(input.id);

    if (memory) {
      // Record access to boost activation
      await store.recordAccess(input.id);
    }

    return {
      memory: memory ? formatMemoryDetail(memory) : null,
    };
  },
};

/**
 * Drill down into source memories of a consolidated memory.
 */
const drillDownMemoriesTool: ToolDefinition<DrillDownInput, DrillDownOutput> = {
  id: 'memory.drillDown',
  name: 'DrillDownMemories',
  category: 'memory',
  description:
    'Access the original source memories that were combined into a consolidated memory. Use this when you need more detail or context about consolidated knowledge.',
  inputSchema: drillDownInputSchema,
  outputSchema: drillDownOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only access to source memories',
    potentialImpact: 'None',
    reversible: true,
    categories: ['data_access'],
  },
  tags: ['memory', 'consolidated', 'drill_down', 'read'],
  examples: [
    {
      input: { consolidatedId: 'c-12345', limit: 10 },
      description: 'Get source memories for a consolidated memory',
    },
  ],

  execute: async (input: DrillDownInput, context: ToolContext): Promise<DrillDownOutput> => {
    const dbService = context.services.get(DatabaseService);
    const store = new ConsolidatedMemoryStore(dbService.knex);
    const db = dbService.knex;

    // Get the consolidated memory
    const consolidated = await store.get(input.consolidatedId);
    if (!consolidated) {
      return {
        consolidatedId: input.consolidatedId,
        consolidatedSummary: 'Not found',
        sourceMemories: [],
        totalSourceCount: 0,
      };
    }

    // Get source memories
    const sourceIds = consolidated.sourceMemoryIds.slice(0, input.limit);
    const rows = await db('memories').whereIn('id', sourceIds).orderBy('created_at', 'desc');

    const sourceMemories = rows.map((row) => ({
      id: row.id as string,
      type: row.type as string,
      content: row.content as string,
      createdAt: row.created_at as string,
      importance: row.importance as number | undefined,
    }));

    // Record access to boost activation
    await store.recordAccess(input.consolidatedId);

    return {
      consolidatedId: consolidated.id,
      consolidatedSummary: consolidated.content.summary,
      sourceMemories,
      totalSourceCount: consolidated.sourceMemoryCount,
    };
  },
};

// ============================================================================
// Registration
// ============================================================================

/**
 * Register consolidated memory tools with the registry.
 */
const registerConsolidatedMemoryTools = (registry: ToolRegistry): void => {
  registry.register(listConsolidatedMemoriesTool);
  registry.register(getConsolidatedMemoryTool);
  registry.register(drillDownMemoriesTool);
};

// ============================================================================
// Exports
// ============================================================================

export {
  listConsolidatedMemoriesTool,
  getConsolidatedMemoryTool,
  drillDownMemoriesTool,
  registerConsolidatedMemoryTools,
};
