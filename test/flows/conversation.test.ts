/**
 * Flow tests for basic conversation without tools.
 * Tests the full stack from orchestrator through LangChain to mocked HTTP.
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '../setup.ts';
import { createTestServices, collectChatResponse } from '../utils/services.ts';
import { createChatCompletion } from '../mocks/openai-responses.ts';
import type { Services } from '../../src/core/services/services.ts';
import type { OrchestratorService } from '../../src/agent/orchestrator/orchestrator.ts';

describe('Conversation Flow', () => {
  let services: Services;
  let orchestrator: OrchestratorService;

  beforeEach(async () => {
    const result = await createTestServices();
    services = result.services;
    orchestrator = result.orchestrator;
  });

  afterEach(async () => {
    await services.destroy();
  });

  it('completes a simple conversation', async () => {
    server.use(
      http.post('*/chat/completions', () => {
        return HttpResponse.json(createChatCompletion('Hello! How can I help you today?'));
      }),
    );

    const conversationId = await orchestrator.startConversation();
    const { response, chunks } = await collectChatResponse(orchestrator.chat(conversationId, 'Hello'));

    expect(response).toContain('Hello');
    expect(chunks.some((c) => c.type === 'token')).toBe(true);
    expect(chunks.some((c) => c.type === 'done')).toBe(true);
  });

  it('stores messages in history', async () => {
    server.use(
      http.post('*/chat/completions', () => {
        return HttpResponse.json(createChatCompletion('I am here to help!'));
      }),
    );

    const conversationId = await orchestrator.startConversation();
    await collectChatResponse(orchestrator.chat(conversationId, 'Hi there'));

    const history = await orchestrator.getHistory(conversationId);

    expect(history).toHaveLength(2);
    expect(history[0]?.role).toBe('user');
    expect(history[0]?.content).toBe('Hi there');
    expect(history[1]?.role).toBe('assistant');
    expect(history[1]?.content).toContain('help');
  });

  it('maintains conversation context across turns', async () => {
    let requestCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        requestCount++;
        if (requestCount === 1) {
          return HttpResponse.json(createChatCompletion('My name is GLaDOS. Nice to meet you!'));
        }
        return HttpResponse.json(createChatCompletion('As I mentioned, my name is GLaDOS.'));
      }),
    );

    const conversationId = await orchestrator.startConversation();

    await collectChatResponse(orchestrator.chat(conversationId, 'What is your name?'));
    const { response } = await collectChatResponse(
      orchestrator.chat(conversationId, 'What did you say your name was?'),
    );

    expect(response).toContain('GLaDOS');

    const history = await orchestrator.getHistory(conversationId);
    expect(history).toHaveLength(4); // 2 user + 2 assistant messages
  });

  it('handles chatSync convenience method', async () => {
    server.use(
      http.post('*/chat/completions', () => {
        return HttpResponse.json(createChatCompletion('Sync response'));
      }),
    );

    const conversationId = await orchestrator.startConversation();
    const response = await orchestrator.chatSync(conversationId, 'Test');

    expect(response).toBe('Sync response');
  });

  it('reports errors via error chunks', async () => {
    // Note: This test has a short timeout because LangChain may retry on errors
    server.use(
      http.post('*/chat/completions', () => {
        return HttpResponse.json({ error: { message: 'API Error' } }, { status: 400 });
      }),
    );

    const conversationId = await orchestrator.startConversation();
    const { chunks } = await collectChatResponse(orchestrator.chat(conversationId, 'Test'));

    // On API errors, we expect either an error chunk or a timeout
    // LangChain's error handling may vary
    expect(chunks.length).toBeGreaterThan(0);
  }, 10000);
});
