import { z } from 'zod';

import type { ToolDefinition, ToolContext, ToolRegistry } from '../tools.ts';
import {
  OpenLoopService,
  openLoopSchema,
  createOpenLoopInputSchema,
  openLoopStatusSchema,
} from '../../../agent/memory/consolidation/consolidation.ts';

// ============================================================================
// Create Open Loop
// ============================================================================

const createOpenLoopInputToolSchema = createOpenLoopInputSchema;

const createOpenLoopOutputSchema = z.object({
  loop: openLoopSchema,
  created: z.boolean(),
});

type CreateOpenLoopInput = z.infer<typeof createOpenLoopInputToolSchema>;
type CreateOpenLoopRawInput = z.input<typeof createOpenLoopInputToolSchema>;
type CreateOpenLoopOutput = z.infer<typeof createOpenLoopOutputSchema>;

const createOpenLoopTool: ToolDefinition<CreateOpenLoopInput, CreateOpenLoopOutput, CreateOpenLoopRawInput> = {
  id: 'memory.createOpenLoop',
  name: 'CreateOpenLoop',
  description: `Track an unresolved situation that should be surfaced when relevant.
    Use when the user mentions something they're deciding, waiting on, or tracking.
    The loop will be automatically surfaced when its activation patterns match future conversations.`,
  category: 'memory',
  inputSchema: createOpenLoopInputToolSchema,
  outputSchema: createOpenLoopOutputSchema,
  risk: {
    level: 'low',
    reason: 'Creates a tracking entry for unresolved situations',
    potentialImpact: 'Adds to open loop tracking',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['memory', 'open_loop', 'write'],
  examples: [
    {
      input: {
        topic: 'Job offer decision',
        description: 'Need to decide whether to accept the Acme Corp job offer',
        activationPatterns: ['job', 'offer', 'acme', 'career'],
      },
      description: 'Track a job decision',
    },
    {
      input: {
        topic: 'Waiting for Alice reply',
        description: 'Waiting to hear back from Alice about the weekend plans',
        activationPatterns: ['alice', 'weekend', 'plans'],
        staleAfterDays: 7,
      },
      description: 'Track waiting for a response',
    },
  ],
  execute: async (input: CreateOpenLoopInput, context: ToolContext): Promise<CreateOpenLoopOutput> => {
    const openLoopService = context.services.get(OpenLoopService);
    const loop = await openLoopService.create(input);
    return { loop, created: true };
  },
};

// ============================================================================
// Get Open Loop
// ============================================================================

const getOpenLoopInputSchema = z.object({
  id: z.string().describe('The open loop ID'),
});

const getOpenLoopOutputSchema = z.object({
  loop: openLoopSchema.nullable(),
  found: z.boolean(),
});

type GetOpenLoopInput = z.infer<typeof getOpenLoopInputSchema>;
type GetOpenLoopOutput = z.infer<typeof getOpenLoopOutputSchema>;

const getOpenLoopTool: ToolDefinition<GetOpenLoopInput, GetOpenLoopOutput> = {
  id: 'memory.getOpenLoop',
  name: 'GetOpenLoop',
  description: 'Get details of a specific open loop by ID.',
  category: 'memory',
  inputSchema: getOpenLoopInputSchema,
  outputSchema: getOpenLoopOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['memory', 'open_loop', 'read'],
  examples: [{ input: { id: 'loop-123' }, description: 'Get open loop by ID' }],
  execute: async (input: GetOpenLoopInput, context: ToolContext): Promise<GetOpenLoopOutput> => {
    const openLoopService = context.services.get(OpenLoopService);
    const loop = await openLoopService.get(input.id);
    return { loop, found: loop !== null };
  },
};

// ============================================================================
// List Open Loops
// ============================================================================

const listOpenLoopsInputSchema = z.object({
  status: openLoopStatusSchema.nullish().describe('Filter by status. Defaults to active.'),
  limit: z.number().positive().nullish().describe('Maximum number of loops to return'),
});

const listOpenLoopsOutputSchema = z.object({
  loops: z.array(openLoopSchema),
  count: z.number(),
});

type ListOpenLoopsInput = z.infer<typeof listOpenLoopsInputSchema>;
type ListOpenLoopsOutput = z.infer<typeof listOpenLoopsOutputSchema>;

const listOpenLoopsTool: ToolDefinition<ListOpenLoopsInput, ListOpenLoopsOutput> = {
  id: 'memory.listOpenLoops',
  name: 'ListOpenLoops',
  description: 'List open loops, optionally filtered by status.',
  category: 'memory',
  inputSchema: listOpenLoopsInputSchema,
  outputSchema: listOpenLoopsOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['memory', 'open_loop', 'list', 'read'],
  examples: [
    { input: {}, description: 'List all active open loops' },
    { input: { status: 'resolved' }, description: 'List resolved loops' },
  ],
  execute: async (input: ListOpenLoopsInput, context: ToolContext): Promise<ListOpenLoopsOutput> => {
    const openLoopService = context.services.get(OpenLoopService);
    const loops = await openLoopService.list({
      status: input.status ?? undefined,
      limit: input.limit ?? undefined,
    });
    return { loops, count: loops.length };
  },
};

// ============================================================================
// Resolve Open Loop
// ============================================================================

const resolveOpenLoopInputSchema = z.object({
  id: z.string().describe('The open loop ID to resolve'),
  resolution: z.string().nullish().describe('Optional note about how it was resolved'),
});

const resolveOpenLoopOutputSchema = z.object({
  loop: openLoopSchema.nullable(),
  resolved: z.boolean(),
});

type ResolveOpenLoopInput = z.infer<typeof resolveOpenLoopInputSchema>;
type ResolveOpenLoopOutput = z.infer<typeof resolveOpenLoopOutputSchema>;

const resolveOpenLoopTool: ToolDefinition<ResolveOpenLoopInput, ResolveOpenLoopOutput> = {
  id: 'memory.resolveOpenLoop',
  name: 'ResolveOpenLoop',
  description: 'Mark an open loop as resolved when the situation is concluded.',
  category: 'memory',
  inputSchema: resolveOpenLoopInputSchema,
  outputSchema: resolveOpenLoopOutputSchema,
  risk: {
    level: 'low',
    reason: 'Marks a situation as resolved',
    potentialImpact: 'Loop will no longer be surfaced',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['memory', 'open_loop', 'write'],
  examples: [
    { input: { id: 'loop-123' }, description: 'Resolve a loop' },
    { input: { id: 'loop-123', resolution: 'Decided to accept the offer' }, description: 'Resolve with note' },
  ],
  execute: async (input: ResolveOpenLoopInput, context: ToolContext): Promise<ResolveOpenLoopOutput> => {
    const openLoopService = context.services.get(OpenLoopService);
    const loop = await openLoopService.resolve(input.id, input.resolution ?? undefined);
    return { loop, resolved: loop !== null };
  },
};

// ============================================================================
// Add Pattern to Open Loop
// ============================================================================

const addPatternInputSchema = z.object({
  id: z.string().describe('The open loop ID'),
  pattern: z.string().min(1).describe('The pattern to add'),
});

const addPatternOutputSchema = z.object({
  loop: openLoopSchema.nullable(),
  added: z.boolean(),
});

type AddPatternInput = z.infer<typeof addPatternInputSchema>;
type AddPatternOutput = z.infer<typeof addPatternOutputSchema>;

const addPatternTool: ToolDefinition<AddPatternInput, AddPatternOutput> = {
  id: 'memory.addOpenLoopPattern',
  name: 'AddOpenLoopPattern',
  description: 'Add an activation pattern to an open loop. Patterns trigger the loop to surface in conversations.',
  category: 'memory',
  inputSchema: addPatternInputSchema,
  outputSchema: addPatternOutputSchema,
  risk: {
    level: 'low',
    reason: 'Adds a trigger pattern',
    potentialImpact: 'Loop may surface more often',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['memory', 'open_loop', 'write'],
  examples: [{ input: { id: 'loop-123', pattern: 'salary' }, description: 'Add salary as a trigger pattern' }],
  execute: async (input: AddPatternInput, context: ToolContext): Promise<AddPatternOutput> => {
    const openLoopService = context.services.get(OpenLoopService);
    const loop = await openLoopService.addPattern(input.id, input.pattern);
    return { loop, added: loop !== null };
  },
};

// ============================================================================
// Registration
// ============================================================================

const registerOpenLoopTools = (registry: ToolRegistry): void => {
  registry.register(createOpenLoopTool);
  registry.register(getOpenLoopTool);
  registry.register(listOpenLoopsTool);
  registry.register(resolveOpenLoopTool);
  registry.register(addPatternTool);
};

export {
  createOpenLoopTool,
  getOpenLoopTool,
  listOpenLoopsTool,
  resolveOpenLoopTool,
  addPatternTool,
  registerOpenLoopTools,
};
