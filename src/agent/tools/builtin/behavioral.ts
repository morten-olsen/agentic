import { z } from 'zod';

import type { ToolDefinition, ToolContext, ToolRegistry } from '../tools.ts';
import {
  BehavioralMemoryService,
  behavioralTemplateSchema,
  outcomeSignalSchema,
  situationSchema,
  strategySchema,
} from '../../../agent/behavioral/behavioral.ts';

// ============================================================================
// Get Template
// ============================================================================

const getTemplateInputSchema = z.object({
  templateId: z.string().describe('Template ID from the behavioral index'),
});

const getTemplateOutputSchema = z.object({
  template: behavioralTemplateSchema.nullable(),
  found: z.boolean(),
});

type GetTemplateInput = z.infer<typeof getTemplateInputSchema>;
type GetTemplateOutput = z.infer<typeof getTemplateOutputSchema>;

const getTemplateTool: ToolDefinition<GetTemplateInput, GetTemplateOutput> = {
  id: 'behavioral.getTemplate',
  name: 'Get Behavioral Template',
  description: `Fetch the full behavioral template by ID. Use this when you see a template in your behavioral index that matches your current situation. Returns the complete strategy, guidelines, and evidence history.`,
  category: 'behavioral',
  inputSchema: getTemplateInputSchema,
  outputSchema: getTemplateOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['behavioral', 'read'],
  examples: [{ input: { templateId: 'bt_01' }, description: 'Fetch a behavioral template' }],
  execute: async (input: GetTemplateInput, context: ToolContext): Promise<GetTemplateOutput> => {
    const service = context.services.get(BehavioralMemoryService);
    const template = await service.getTemplate(input.templateId);
    return { template, found: template !== null };
  },
};

// ============================================================================
// Record Outcome
// ============================================================================

const recordOutcomeInputSchema = z.object({
  templateId: z.string().optional().describe('Template ID if recording for current conversation'),
  pendingOutcomeId: z.string().optional().describe('Pending outcome ID if resolving a background action'),
  action: z.string().describe('What the agent did'),
  signal: outcomeSignalSchema.describe('User reaction'),
  detail: z.string().describe('What happened — user response, engagement, etc.'),
  strategyChange: z
    .string()
    .optional()
    .describe('If you want to refine the strategy based on this outcome, describe the change'),
});

const recordOutcomeOutputSchema = z.object({
  outcomeId: z.string(),
  templateId: z.string(),
  signal: outcomeSignalSchema,
});

type RecordOutcomeInput = z.infer<typeof recordOutcomeInputSchema>;
type RecordOutcomeOutput = z.infer<typeof recordOutcomeOutputSchema>;

const recordOutcomeTool: ToolDefinition<RecordOutcomeInput, RecordOutcomeOutput> = {
  id: 'behavioral.recordOutcome',
  name: 'Record Behavioral Outcome',
  description: `Record the outcome of an action. Use this in two scenarios:
    1. After taking an action in the current conversation — provide templateId.
    2. When the user's reply relates to a pending outcome from a background action
       (shown in "Awaiting Feedback" in your behavioral index) — provide pendingOutcomeId.
    This feeds into the behavioral learning loop.`,
  category: 'behavioral',
  inputSchema: recordOutcomeInputSchema,
  outputSchema: recordOutcomeOutputSchema,
  risk: {
    level: 'low',
    reason: 'Updates behavioral template evidence',
    potentialImpact: 'Modifies template strategy and confidence',
    reversible: false,
    categories: ['data_modification'],
  },
  tags: ['behavioral', 'write'],
  examples: [
    {
      input: {
        templateId: 'bt_01',
        action: 'Sent morning briefing with top 3 priorities',
        signal: 'positive',
        detail: 'User thanked and asked a follow-up question',
      },
      description: 'Record positive outcome for a template',
    },
  ],
  execute: async (input: RecordOutcomeInput, context: ToolContext): Promise<RecordOutcomeOutput> => {
    const service = context.services.get(BehavioralMemoryService);
    const outcome = await service.recordOutcome(input);
    return {
      outcomeId: outcome.id,
      templateId: outcome.templateId,
      signal: outcome.signal,
    };
  },
};

// ============================================================================
// Create Template
// ============================================================================

const createTemplateInputSchema = z.object({
  situation: situationSchema.describe('What situation this template covers'),
  strategy: strategySchema.describe('The playbook for this situation'),
  initialOutcome: z
    .object({
      signal: outcomeSignalSchema,
      detail: z.string(),
    })
    .optional()
    .describe('Optional initial outcome from the action that prompted template creation'),
});

const createTemplateOutputSchema = z.object({
  templateId: z.string(),
  situationDescription: z.string(),
});

type CreateTemplateInput = z.infer<typeof createTemplateInputSchema>;
type CreateTemplateOutput = z.infer<typeof createTemplateOutputSchema>;

const createTemplateTool: ToolDefinition<CreateTemplateInput, CreateTemplateOutput> = {
  id: 'behavioral.createTemplate',
  name: 'Create Behavioral Template',
  description: `Create a new behavioral template for a situation type you haven't encountered before. Use this after acting in a novel situation to capture what you did and how it went.`,
  category: 'behavioral',
  inputSchema: createTemplateInputSchema,
  outputSchema: createTemplateOutputSchema,
  risk: {
    level: 'low',
    reason: 'Creates a new behavioral template',
    potentialImpact: 'Adds to behavioral memory',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['behavioral', 'write'],
  examples: [
    {
      input: {
        situation: {
          description: 'User asks about their day plan',
          category: 'planning',
          triggerPatterns: ['day plan', 'what should I do today', 'priorities'],
        },
        strategy: {
          approach: 'Provide a structured summary with top 3 priorities',
          guidelines: ['Keep it under 5 items', 'Start with most urgent'],
        },
      },
      description: 'Create a template for day planning interactions',
    },
  ],
  execute: async (input: CreateTemplateInput, context: ToolContext): Promise<CreateTemplateOutput> => {
    const service = context.services.get(BehavioralMemoryService);
    const template = await service.createTemplate(input);
    return {
      templateId: template.id,
      situationDescription: template.situation.description,
    };
  },
};

// ============================================================================
// Search Templates
// ============================================================================

const searchTemplatesInputSchema = z.object({
  query: z.string().describe('Description of the situation to search for'),
  limit: z.number().optional().describe('Max results (default: 5)'),
});

const searchTemplateResultSchema = z.object({
  id: z.string(),
  situationDescription: z.string(),
  category: z.string(),
  confidenceScore: z.number(),
  similarity: z.number(),
});

const searchTemplatesOutputSchema = z.object({
  templates: z.array(searchTemplateResultSchema),
});

type SearchTemplatesInput = z.infer<typeof searchTemplatesInputSchema>;
type SearchTemplatesOutput = z.infer<typeof searchTemplatesOutputSchema>;

const searchTemplatesTool: ToolDefinition<SearchTemplatesInput, SearchTemplatesOutput> = {
  id: 'behavioral.searchTemplates',
  name: 'Search Behavioral Templates',
  description: `Search for behavioral templates by semantic similarity. Use this when the template index in your context doesn't show the template you need, or when looking for templates related to a specific situation.`,
  category: 'behavioral',
  inputSchema: searchTemplatesInputSchema,
  outputSchema: searchTemplatesOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only search operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['behavioral', 'search', 'read'],
  examples: [
    {
      input: { query: 'morning briefing notification', limit: 5 },
      description: 'Search for morning briefing templates',
    },
  ],
  execute: async (input: SearchTemplatesInput, context: ToolContext): Promise<SearchTemplatesOutput> => {
    const service = context.services.get(BehavioralMemoryService);
    const results = await service.searchTemplatesByQuery(input.query, {
      limit: input.limit ?? 5,
    });
    return {
      templates: results.map((t) => ({
        id: t.id,
        situationDescription: t.situation.description,
        category: t.situation.category,
        confidenceScore: t.evidence.confidenceScore,
        similarity: t.similarity,
      })),
    };
  },
};

// ============================================================================
// Registration
// ============================================================================

const registerBehavioralTools = (registry: ToolRegistry): void => {
  registry.register(getTemplateTool);
  registry.register(recordOutcomeTool);
  registry.register(createTemplateTool);
  registry.register(searchTemplatesTool);
};

export { getTemplateTool, recordOutcomeTool, createTemplateTool, searchTemplatesTool, registerBehavioralTools };
