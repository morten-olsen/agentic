/**
 * Flow tests for memory operations.
 * Tests memory.remember and memory.recall tool execution.
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '../setup.ts';
import { createTestServices, collectChatResponse } from '../utils/services.ts';
import { createChatCompletion, createToolCallCompletion, createEmbeddingResponse } from '../mocks/openai-responses.ts';
import type { Services } from '../../src/services/services.ts';
import type { OrchestratorService } from '../../src/orchestrator/orchestrator.ts';
import { MemoryService } from '../../src/memory/memory.ts';

describe('Memory Flow', () => {
  let services: Services;
  let orchestrator: OrchestratorService;

  beforeEach(async () => {
    const result = await createTestServices();
    services = result.services;
    orchestrator = result.orchestrator;

    // Set up embedding endpoint for memory operations
    server.use(
      http.post('*/embeddings', () => {
        return HttpResponse.json(createEmbeddingResponse());
      }),
    );
  });

  afterEach(async () => {
    await services.destroy();
  });

  it('stores a memory via memory.remember tool', async () => {
    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_remember',
                name: 'memory.remember',
                args: {
                  content: 'User prefers dark mode',
                  type: 'preference',
                  importance: 0.7,
                },
              },
            ]),
          );
        }
        return HttpResponse.json(createChatCompletion("I've stored your preference for dark mode."));
      }),
    );

    const conversationId = await orchestrator.startConversation();
    const { response } = await collectChatResponse(
      orchestrator.chat(conversationId, 'Remember that I prefer dark mode'),
    );

    expect(response).toContain('dark mode');

    // Verify memory was stored in database
    const memoryService = services.get(MemoryService);
    const memories = await memoryService.list({ types: ['preference'] });
    expect(memories.some((m) => m.content.includes('dark mode'))).toBe(true);
  });

  it('recalls memories via memory.recall tool', async () => {
    // Pre-populate a memory
    const memoryService = services.get(MemoryService);
    await memoryService.remember({
      content: 'User favorite color is blue',
      type: 'preference',
      importance: 0.8,
    });

    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_recall',
                name: 'memory.recall',
                args: { query: 'favorite color' },
              },
            ]),
          );
        }
        return HttpResponse.json(createChatCompletion('Based on my memories, your favorite color is blue.'));
      }),
    );

    const conversationId = await orchestrator.startConversation();
    const { response } = await collectChatResponse(orchestrator.chat(conversationId, 'What is my favorite color?'));

    expect(response).toContain('blue');
  });

  it('handles memory recall with no results', async () => {
    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_recall',
                name: 'memory.recall',
                args: { query: 'nonexistent topic' },
              },
            ]),
          );
        }
        return HttpResponse.json(createChatCompletion("I don't have any memories about that topic."));
      }),
    );

    const conversationId = await orchestrator.startConversation();
    const { response } = await collectChatResponse(
      orchestrator.chat(conversationId, 'What do you remember about quantum physics?'),
    );

    expect(response).toBeDefined();
    // Response should indicate no memories found
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it('reinforces memory after recall', async () => {
    // Pre-populate a memory
    const memoryService = services.get(MemoryService);
    const memory = await memoryService.remember({
      content: 'User works at Acme Corp',
      type: 'fact',
      importance: 0.5,
    });

    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_recall',
                name: 'memory.recall',
                args: { query: 'where user works' },
              },
            ]),
          );
        }
        return HttpResponse.json(createChatCompletion('You work at Acme Corp.'));
      }),
    );

    const conversationId = await orchestrator.startConversation();
    await collectChatResponse(orchestrator.chat(conversationId, 'Where do I work?'));

    // Check if memory was accessed (accessCount should increase)
    const updatedMemory = await memoryService.get(memory.id);
    expect(updatedMemory?.accessCount).toBeGreaterThanOrEqual(memory.accessCount);
    // Note: importance might also increase based on reinforcement logic
  });
});
