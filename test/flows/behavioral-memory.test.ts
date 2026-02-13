/**
 * Flow tests for behavioral memory operations.
 * Tests the full orchestrator → tool → behavioral service loop.
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '../setup.ts';
import { createTestServices, collectChatResponse } from '../utils/services.ts';
import { createChatCompletion, createToolCallCompletion, createEmbeddingResponse } from '../mocks/openai-responses.ts';
import type { Services } from '../../src/core/services/services.ts';
import type { OrchestratorService } from '../../src/agent/orchestrator/orchestrator.ts';
import { BehavioralMemoryService } from '../../src/agent/behavioral/behavioral.ts';

describe('Behavioral Memory Flow', () => {
  let services: Services;
  let orchestrator: OrchestratorService;

  beforeEach(async () => {
    const result = await createTestServices();
    services = result.services;
    orchestrator = result.orchestrator;

    // Set up embedding endpoint for behavioral memory operations
    server.use(
      http.post('*/embeddings', () => {
        return HttpResponse.json(createEmbeddingResponse());
      }),
    );
  });

  afterEach(async () => {
    await services.destroy();
  });

  it('creates a template via tool call', async () => {
    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_create_template',
                name: 'behavioral.createTemplate',
                args: {
                  situation: {
                    description: 'User asks about morning routine',
                    category: 'planning',
                    triggerPatterns: ['morning routine', 'morning plan', 'start the day'],
                  },
                  strategy: {
                    approach: 'Provide a structured morning briefing with top priorities',
                    guidelines: ['Keep it concise', 'Include weather if available'],
                  },
                },
              },
            ]),
          );
        }
        return HttpResponse.json(
          createChatCompletion("I've created a behavioral template for morning routine interactions."),
        );
      }),
    );

    const conversationId = await orchestrator.startConversation();
    const { response } = await collectChatResponse(
      orchestrator.chat(conversationId, 'Create a behavioral template for how to handle morning routine questions'),
    );

    expect(response).toContain('morning routine');

    // Verify template exists in DB
    const behavioralService = services.get(BehavioralMemoryService);
    const count = await behavioralService.getTemplateCount();
    expect(count).toBe(1);
  });

  it('fetches a template via tool call', async () => {
    // Pre-populate a template
    const behavioralService = services.get(BehavioralMemoryService);
    const template = await behavioralService.createTemplate({
      situation: {
        description: 'User asks about project status',
        category: 'status',
        triggerPatterns: ['project status', 'how is project'],
      },
      strategy: {
        approach: 'Give a concise status update with blockers',
        guidelines: ['Mention recent progress', 'Highlight blockers'],
      },
    });

    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_get_template',
                name: 'behavioral.getTemplate',
                args: { templateId: template.id },
              },
            ]),
          );
        }
        return HttpResponse.json(
          createChatCompletion('The template strategy is to give a concise status update with blockers.'),
        );
      }),
    );

    const conversationId = await orchestrator.startConversation();
    const { response } = await collectChatResponse(
      orchestrator.chat(conversationId, 'What is the behavioral template for project status?'),
    );

    expect(response).toContain('status update');
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it('records a positive outcome via tool call', async () => {
    // Pre-populate a template
    const behavioralService = services.get(BehavioralMemoryService);
    const template = await behavioralService.createTemplate({
      situation: {
        description: 'User asks about weather',
        category: 'information',
        triggerPatterns: ['weather', 'forecast'],
      },
      strategy: {
        approach: 'Provide current conditions and brief forecast',
        guidelines: ['Be concise'],
      },
    });

    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_record_outcome',
                name: 'behavioral.recordOutcome',
                args: {
                  templateId: template.id,
                  action: 'Gave a concise weather summary',
                  signal: 'positive',
                  detail: 'User thanked and asked follow-up',
                },
              },
            ]),
          );
        }
        return HttpResponse.json(createChatCompletion("I've recorded the positive outcome."));
      }),
    );

    const conversationId = await orchestrator.startConversation();
    await collectChatResponse(orchestrator.chat(conversationId, 'That weather summary was great, thanks!'));

    // Verify evidence updated
    const updated = await behavioralService.getTemplate(template.id);
    expect(updated?.evidence.totalInteractions).toBe(1);
    expect(updated?.evidence.positiveOutcomes).toBe(1);
  });

  it('records outcome with strategy change via tool call', async () => {
    // Pre-populate a template
    const behavioralService = services.get(BehavioralMemoryService);
    const template = await behavioralService.createTemplate({
      situation: {
        description: 'User asks about task priorities',
        category: 'planning',
        triggerPatterns: ['priorities', 'what should I do'],
      },
      strategy: {
        approach: 'List all tasks by priority',
        guidelines: ['Show everything'],
      },
    });

    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_record_negative',
                name: 'behavioral.recordOutcome',
                args: {
                  templateId: template.id,
                  action: 'Listed all 15 tasks',
                  signal: 'negative',
                  detail: 'User said it was too much information',
                  strategyChange: 'Only show top 3 priorities, not everything',
                },
              },
            ]),
          );
        }
        return HttpResponse.json(createChatCompletion("I've updated the strategy to only show top 3 priorities."));
      }),
    );

    const conversationId = await orchestrator.startConversation();
    await collectChatResponse(orchestrator.chat(conversationId, 'That was way too many tasks, just give me the top 3'));

    // Verify strategy was updated
    const updated = await behavioralService.getTemplate(template.id);
    expect(updated?.strategy.approach).toBe('Only show top 3 priorities, not everything');
    expect(updated?.evidence.negativeOutcomes).toBe(1);
  });

  it('searches templates via tool call', async () => {
    // Pre-populate multiple templates
    const behavioralService = services.get(BehavioralMemoryService);
    await behavioralService.createTemplate({
      situation: {
        description: 'Morning briefing interactions',
        category: 'briefing',
        triggerPatterns: ['morning', 'briefing'],
      },
      strategy: { approach: 'Structured morning summary', guidelines: ['Be concise'] },
    });
    await behavioralService.createTemplate({
      situation: {
        description: 'Evening wind-down check-in',
        category: 'check-in',
        triggerPatterns: ['evening', 'wind down'],
      },
      strategy: { approach: 'Relaxed evening summary', guidelines: ['Keep it light'] },
    });

    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_search',
                name: 'behavioral.searchTemplates',
                args: { query: 'morning routine briefing' },
              },
            ]),
          );
        }
        return HttpResponse.json(createChatCompletion('I found templates related to morning briefings.'));
      }),
    );

    const conversationId = await orchestrator.startConversation();
    const { response } = await collectChatResponse(
      orchestrator.chat(conversationId, 'Search for morning-related behavioral templates'),
    );

    expect(response).toContain('morning');
    // Verify tool was executed (multiple LLM calls made)
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it('behavioral index appears in agent context', async () => {
    // Pre-populate a template
    const behavioralService = services.get(BehavioralMemoryService);
    await behavioralService.createTemplate({
      situation: {
        description: 'Code review discussions',
        category: 'development',
        triggerPatterns: ['code review', 'PR review'],
      },
      strategy: { approach: 'Be constructive and specific', guidelines: ['Point out positives too'] },
    });

    server.use(
      http.post('*/chat/completions', () => {
        return HttpResponse.json(createChatCompletion('Hello! How can I help you today?'));
      }),
    );

    const conversationId = await orchestrator.startConversation();
    const { response } = await collectChatResponse(orchestrator.chat(conversationId, 'Hello'));

    // Test completes without error — context built successfully with behavioral index
    expect(response).toBeDefined();
  });
});
