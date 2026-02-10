/**
 * End-to-end test for notification injection visibility.
 * Verifies that notifications injected into the database are actually
 * seen by the agent in subsequent conversation turns.
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

import { server } from '../setup.ts';
import { createTestServices, collectChatResponse } from '../utils/services.ts';
import { createChatCompletion } from '../mocks/openai-responses.ts';
import type { Services } from '../../src/core/services/services.ts';
import type { OrchestratorService } from '../../src/agent/orchestrator/orchestrator.ts';

describe('Notification Injection E2E', () => {
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

  it('agent sees injected notification message in subsequent turn (using orchestrator method)', async () => {
    // Track the messages sent to the LLM
    const capturedRequests: { messages: ChatCompletionMessageParam[] }[] = [];

    server.use(
      http.post('*/chat/completions', async ({ request }) => {
        const body = (await request.json()) as { messages: ChatCompletionMessageParam[] };
        capturedRequests.push(body);
        return HttpResponse.json(createChatCompletion('I acknowledge the notification.'));
      }),
    );

    const conversationId = await orchestrator.startConversation();

    // Turn 1: Send initial message
    await collectChatResponse(orchestrator.chat(conversationId, 'Hello'));
    expect(capturedRequests).toHaveLength(1);

    // Inject a notification using the orchestrator's method (which updates both DB and checkpoint)
    await orchestrator.injectAssistantMessage(
      conversationId,
      '[Background notification sent]\n**Test Alert**\nSomething important happened!',
      {
        notificationId: 'test-notif-123',
        injectedNotification: true,
      },
    );

    // Turn 2: Send another message - the agent should see the notification
    await collectChatResponse(orchestrator.chat(conversationId, 'Did anything happen?'));

    // Verify the second request includes the injected notification
    expect(capturedRequests).toHaveLength(2);
    const secondRequest = capturedRequests[1];
    const messagesInRequest = secondRequest.messages;

    // Filter out system message to get conversation messages
    const conversationMessages = messagesInRequest.filter((m) => m.role !== 'system');

    // Check if the notification content is present in any message
    const allContent = messagesInRequest.map((m) => String(m.content)).join('\n');
    const hasNotification = allContent.includes('Background notification sent') || allContent.includes('Test Alert');

    expect(hasNotification).toBe(true);

    // Verify no duplicate messages (should have 4 messages: Hello, response, notification, new question)
    expect(conversationMessages.length).toBe(4);
  });

  it('database history includes injected notification', async () => {
    server.use(
      http.post('*/chat/completions', () => {
        return HttpResponse.json(createChatCompletion('Response'));
      }),
    );

    const conversationId = await orchestrator.startConversation();

    // Turn 1
    await collectChatResponse(orchestrator.chat(conversationId, 'Hello'));

    // Inject notification using the orchestrator method
    await orchestrator.injectAssistantMessage(conversationId, '[Notification] Test alert');

    // Turn 2
    await collectChatResponse(orchestrator.chat(conversationId, 'What happened?'));

    // Verify database history
    const history = await orchestrator.getHistory(conversationId);

    // Should have 5 messages: user, assistant, assistant (notification), user, assistant
    expect(history).toHaveLength(5);
    expect(history[2].content).toContain('[Notification]');
  });
});
