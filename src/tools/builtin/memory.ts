import { z } from 'zod';

import type { ToolDefinition, ToolContext, ToolRegistry } from '../tools.ts';
import { MemoryService, memoryTypeSchema, memoryEntrySchema, recallOptionsSchema } from '../../memory/memory.ts';

// ============================================================================
// Remember (Create Memory)
// ============================================================================

const rememberInputSchema = z.object({
  type: memoryTypeSchema.describe('Type of memory to store'),
  content: z.string().min(1).describe('Content to remember'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional metadata'),
  importance: z.number().min(0).max(1).optional().describe('Importance level (0-1). Defaults to 0.5.'),
});

const rememberOutputSchema = memoryEntrySchema;

type RememberInput = z.infer<typeof rememberInputSchema>;
type RememberOutput = z.infer<typeof rememberOutputSchema>;

const rememberTool: ToolDefinition<RememberInput, RememberOutput> = {
  id: 'memory.remember',
  name: 'Remember',
  description: 'Store a new memory with automatic embedding generation for semantic search.',
  category: 'memory',
  inputSchema: rememberInputSchema,
  outputSchema: rememberOutputSchema,
  risk: {
    level: 'low',
    reason: 'Creates a new memory entry',
    potentialImpact: 'Adds to long-term memory storage',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['memory', 'write'],
  examples: [
    {
      input: { type: 'fact', content: 'User prefers dark mode', importance: 0.7 },
      description: 'Remember a user preference',
    },
    {
      input: { type: 'procedure', content: 'To deploy: run npm build then npm publish' },
      description: 'Remember a procedure',
    },
  ],
  execute: async (input: RememberInput, context: ToolContext): Promise<RememberOutput> => {
    const memoryService = context.services.get(MemoryService);
    return memoryService.remember(input);
  },
};

// ============================================================================
// Recall (Semantic Search)
// ============================================================================

const recallInputSchema = z.object({
  query: z.string().min(1).describe('Natural language query to search for'),
  limit: z.number().positive().optional().describe('Maximum number of results'),
  types: z.array(memoryTypeSchema).optional().describe('Filter by memory types'),
  minImportance: z.number().min(0).max(1).optional().describe('Minimum importance threshold'),
});

const recallOutputSchema = z.object({
  memories: z.array(memoryEntrySchema),
  count: z.number(),
});

type RecallInput = z.infer<typeof recallInputSchema>;
type RecallOutput = z.infer<typeof recallOutputSchema>;

const recallTool: ToolDefinition<RecallInput, RecallOutput> = {
  id: 'memory.recall',
  name: 'Recall',
  description: 'Search for relevant memories using semantic similarity.',
  category: 'memory',
  inputSchema: recallInputSchema,
  outputSchema: recallOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['memory', 'search', 'read'],
  examples: [
    { input: { query: 'deployment process' }, description: 'Find memories about deployment' },
    { input: { query: 'user preferences', types: ['preference'] }, description: 'Find preference memories' },
  ],
  execute: async (input: RecallInput, context: ToolContext): Promise<RecallOutput> => {
    const memoryService = context.services.get(MemoryService);
    const { query, ...options } = input;
    const memories = await memoryService.recall(query, options);
    return { memories, count: memories.length };
  },
};

// ============================================================================
// Recall By Type
// ============================================================================

const recallByTypeInputSchema = z.object({
  type: memoryTypeSchema.describe('Type of memories to retrieve'),
  limit: z.number().positive().optional().describe('Maximum number of results'),
});

const recallByTypeOutputSchema = z.object({
  memories: z.array(memoryEntrySchema),
  count: z.number(),
});

type RecallByTypeInput = z.infer<typeof recallByTypeInputSchema>;
type RecallByTypeOutput = z.infer<typeof recallByTypeOutputSchema>;

const recallByTypeTool: ToolDefinition<RecallByTypeInput, RecallByTypeOutput> = {
  id: 'memory.recall_by_type',
  name: 'RecallByType',
  description: 'Retrieve memories by type without semantic search.',
  category: 'memory',
  inputSchema: recallByTypeInputSchema,
  outputSchema: recallByTypeOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['memory', 'list', 'read'],
  examples: [
    { input: { type: 'fact' }, description: 'Get all fact memories' },
    { input: { type: 'preference', limit: 5 }, description: 'Get recent preferences' },
  ],
  execute: async (input: RecallByTypeInput, context: ToolContext): Promise<RecallByTypeOutput> => {
    const memoryService = context.services.get(MemoryService);
    const memories = await memoryService.recallByType(input.type, input.limit);
    return { memories, count: memories.length };
  },
};

// ============================================================================
// Get Memory
// ============================================================================

const getMemoryInputSchema = z.object({
  id: z.string().describe('Memory ID'),
});

const getMemoryOutputSchema = z.object({
  memory: memoryEntrySchema.nullable(),
  found: z.boolean(),
});

type GetMemoryInput = z.infer<typeof getMemoryInputSchema>;
type GetMemoryOutput = z.infer<typeof getMemoryOutputSchema>;

const getMemoryTool: ToolDefinition<GetMemoryInput, GetMemoryOutput> = {
  id: 'memory.get',
  name: 'GetMemory',
  description: 'Get a specific memory by ID.',
  category: 'memory',
  inputSchema: getMemoryInputSchema,
  outputSchema: getMemoryOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['memory', 'read'],
  examples: [{ input: { id: '123' }, description: 'Get memory by ID' }],
  execute: async (input: GetMemoryInput, context: ToolContext): Promise<GetMemoryOutput> => {
    const memoryService = context.services.get(MemoryService);
    const memory = await memoryService.get(input.id);
    return { memory, found: memory !== null };
  },
};

// ============================================================================
// List Memories
// ============================================================================

const listMemoriesInputSchema = recallOptionsSchema;

const listMemoriesOutputSchema = z.object({
  memories: z.array(memoryEntrySchema),
  count: z.number(),
});

type ListMemoriesInput = z.infer<typeof listMemoriesInputSchema>;
type ListMemoriesOutput = z.infer<typeof listMemoriesOutputSchema>;

const listMemoriesTool: ToolDefinition<ListMemoriesInput, ListMemoriesOutput> = {
  id: 'memory.list',
  name: 'ListMemories',
  description: 'List memories with optional filtering by type, importance, or time range.',
  category: 'memory',
  inputSchema: listMemoriesInputSchema,
  outputSchema: listMemoriesOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['memory', 'list', 'read'],
  examples: [
    { input: {}, description: 'List all memories' },
    { input: { types: ['fact', 'preference'], limit: 10 }, description: 'List facts and preferences' },
  ],
  execute: async (input: ListMemoriesInput, context: ToolContext): Promise<ListMemoriesOutput> => {
    const memoryService = context.services.get(MemoryService);
    const memories = await memoryService.list(input);
    return { memories, count: memories.length };
  },
};

// ============================================================================
// Reinforce Memory
// ============================================================================

const reinforceInputSchema = z.object({
  id: z.string().describe('Memory ID to reinforce'),
});

const reinforceOutputSchema = memoryEntrySchema;

type ReinforceInput = z.infer<typeof reinforceInputSchema>;
type ReinforceOutput = z.infer<typeof reinforceOutputSchema>;

const reinforceTool: ToolDefinition<ReinforceInput, ReinforceOutput> = {
  id: 'memory.reinforce',
  name: 'ReinforceMemory',
  description: 'Increase the importance of a memory. Used when the memory proves useful.',
  category: 'memory',
  inputSchema: reinforceInputSchema,
  outputSchema: reinforceOutputSchema,
  risk: {
    level: 'low',
    reason: 'Increases memory importance',
    potentialImpact: 'Memory will be prioritized in future recalls',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['memory', 'write'],
  examples: [{ input: { id: '123' }, description: 'Reinforce a useful memory' }],
  execute: async (input: ReinforceInput, context: ToolContext): Promise<ReinforceOutput> => {
    const memoryService = context.services.get(MemoryService);
    return memoryService.reinforce(input.id);
  },
};

// ============================================================================
// Correct Memory
// ============================================================================

const correctInputSchema = z.object({
  id: z.string().describe('Memory ID to correct'),
  newContent: z.string().min(1).describe('Corrected content'),
});

const correctOutputSchema = memoryEntrySchema;

type CorrectInput = z.infer<typeof correctInputSchema>;
type CorrectOutput = z.infer<typeof correctOutputSchema>;

const correctTool: ToolDefinition<CorrectInput, CorrectOutput> = {
  id: 'memory.correct',
  name: 'CorrectMemory',
  description: 'Update a memory with corrected content. Regenerates the embedding automatically.',
  category: 'memory',
  inputSchema: correctInputSchema,
  outputSchema: correctOutputSchema,
  risk: {
    level: 'low',
    reason: 'Updates existing memory',
    potentialImpact: 'Memory content will be changed',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['memory', 'write'],
  examples: [
    {
      input: { id: '123', newContent: 'User prefers light mode (changed from dark)' },
      description: 'Correct a memory',
    },
  ],
  execute: async (input: CorrectInput, context: ToolContext): Promise<CorrectOutput> => {
    const memoryService = context.services.get(MemoryService);
    return memoryService.correct(input.id, input.newContent);
  },
};

// ============================================================================
// Forget Memory
// ============================================================================

const forgetInputSchema = z.object({
  id: z.string().describe('Memory ID to forget'),
});

const forgetOutputSchema = z.object({
  success: z.boolean(),
  deletedId: z.string(),
});

type ForgetInput = z.infer<typeof forgetInputSchema>;
type ForgetOutput = z.infer<typeof forgetOutputSchema>;

const forgetTool: ToolDefinition<ForgetInput, ForgetOutput> = {
  id: 'memory.forget',
  name: 'Forget',
  description: 'Delete a memory permanently.',
  category: 'memory',
  inputSchema: forgetInputSchema,
  outputSchema: forgetOutputSchema,
  risk: {
    level: 'medium',
    reason: 'Permanently deletes data',
    potentialImpact: 'Memory will be lost',
    reversible: false,
    categories: ['data_modification'],
  },
  tags: ['memory', 'write', 'destructive'],
  examples: [{ input: { id: '123' }, description: 'Forget a memory' }],
  execute: async (input: ForgetInput, context: ToolContext): Promise<ForgetOutput> => {
    const memoryService = context.services.get(MemoryService);
    const success = await memoryService.forget(input.id);
    return { success, deletedId: input.id };
  },
};

// ============================================================================
// Get Recent Topics
// ============================================================================

const getRecentTopicsInputSchema = z.object({
  limit: z.number().positive().optional().describe('Maximum number of topics. Defaults to 5.'),
});

const getRecentTopicsOutputSchema = z.object({
  topics: z.array(z.string()),
  count: z.number(),
});

type GetRecentTopicsInput = z.infer<typeof getRecentTopicsInputSchema>;
type GetRecentTopicsOutput = z.infer<typeof getRecentTopicsOutputSchema>;

const getRecentTopicsTool: ToolDefinition<GetRecentTopicsInput, GetRecentTopicsOutput> = {
  id: 'memory.get_recent_topics',
  name: 'GetRecentTopics',
  description: 'Get recent conversation topics from memory.',
  category: 'memory',
  inputSchema: getRecentTopicsInputSchema,
  outputSchema: getRecentTopicsOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['memory', 'topics', 'read'],
  examples: [
    { input: {}, description: 'Get recent topics' },
    { input: { limit: 10 }, description: 'Get more recent topics' },
  ],
  execute: async (input: GetRecentTopicsInput, context: ToolContext): Promise<GetRecentTopicsOutput> => {
    const memoryService = context.services.get(MemoryService);
    const topics = await memoryService.getRecentTopics(input.limit);
    return { topics, count: topics.length };
  },
};

// ============================================================================
// Registration
// ============================================================================

const registerMemoryTools = (registry: ToolRegistry): void => {
  registry.register(rememberTool);
  registry.register(recallTool);
  registry.register(recallByTypeTool);
  registry.register(getMemoryTool);
  registry.register(listMemoriesTool);
  registry.register(reinforceTool);
  registry.register(correctTool);
  registry.register(forgetTool);
  registry.register(getRecentTopicsTool);
};

export {
  rememberTool,
  recallTool,
  recallByTypeTool,
  getMemoryTool,
  listMemoriesTool,
  reinforceTool,
  correctTool,
  forgetTool,
  getRecentTopicsTool,
  registerMemoryTools,
};
