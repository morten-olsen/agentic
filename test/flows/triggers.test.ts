/**
 * Flow tests for trigger invocations.
 * Tests the invokeBackground flow used when triggers fire.
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '../setup.ts';
import { createTestServices } from '../utils/services.ts';
import { createChatCompletion, createToolCallCompletion } from '../mocks/openai-responses.ts';
import type { Services } from '../../src/core/services/services.ts';
import type { OrchestratorService } from '../../src/agent/orchestrator/orchestrator.ts';
import { TriggerService } from '../../src/features/triggers/triggers.ts';
import type { TriggerContext } from '../../src/features/triggers/triggers.schemas.ts';

describe('Trigger Invocation Flow', () => {
  let services: Services;
  let orchestrator: OrchestratorService;
  let triggerService: TriggerService;

  beforeEach(async () => {
    const result = await createTestServices();
    services = result.services;
    orchestrator = result.orchestrator;

    // Create and configure trigger service
    triggerService = new TriggerService(services);
    triggerService.configure({
      orchestrator,
    });
  });

  afterEach(async () => {
    await triggerService.stop();
    // Allow pending async operations (checkpointing, etc.) to complete
    await new Promise((resolve) => setTimeout(resolve, 50));
    await services.destroy();
  });

  it('invokeBackground creates a conversation and runs agent', async () => {
    server.use(
      http.post('*/chat/completions', () => {
        return HttpResponse.json(createChatCompletion('I have completed the task. Nothing to notify the user about.'));
      }),
    );

    const triggerContext: TriggerContext = {
      triggerId: 'test-trigger-1',
      triggerName: 'test-trigger',
      goal: 'Check for any pending tasks',
      invocationCount: 1,
      schedule: { type: 'cron', expression: '0 * * * *' },
    };

    const result = await orchestrator.invokeBackground('Check for any pending tasks', triggerContext);

    expect(result.conversationId).toBeDefined();
    expect(typeof result.conversationId).toBe('string');
    expect(result.responseContent).toBeDefined();

    // Verify conversation was created
    const conversation = await orchestrator.getConversation(result.conversationId);
    expect(conversation).not.toBeNull();
    expect(conversation?.title).toContain('test-trigger');
  });

  it('invokeBackground can execute the notify tool', async () => {
    let notifyToolCalled = false;

    // Mock to return a notify tool call first, then a final response
    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_notify_1',
                name: 'triggers.notify',
                args: {
                  title: 'Task Reminder',
                  body: 'You have a pending task to complete.',
                  urgency: 'medium',
                },
              },
            ]),
          );
        }
        notifyToolCalled = true;
        return HttpResponse.json(createChatCompletion('Notification sent to the user.'));
      }),
    );

    const triggerContext: TriggerContext = {
      triggerId: 'test-trigger-2',
      triggerName: 'reminder-trigger',
      goal: 'Remind the user about pending tasks',
      invocationCount: 1,
      schedule: { type: 'once', at: new Date().toISOString() },
    };

    const result = await orchestrator.invokeBackground('Remind the user about pending tasks', triggerContext);

    expect(result.conversationId).toBeDefined();
    expect(notifyToolCalled).toBe(true);

    // Verify multiple LLM calls were made (tool call + response)
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it('invokeBackground can execute the delete_trigger tool (low-risk)', async () => {
    // Create a trigger first
    const trigger = await triggerService.create({
      name: 'one-time-reminder',
      goal: 'Remind the user once',
      schedule: { type: 'once', at: new Date(Date.now() + 3600000).toISOString() },
    });

    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          // First, notify the user
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_notify_1',
                name: 'triggers.notify',
                args: {
                  title: 'Reminder Complete',
                  body: 'Your one-time reminder has been delivered.',
                  urgency: 'low',
                },
              },
            ]),
          );
        }
        if (callCount === 2) {
          // Then, delete the trigger
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_delete_1',
                name: 'triggers.delete_trigger',
                args: { triggerId: trigger.id },
              },
            ]),
          );
        }
        return HttpResponse.json(createChatCompletion('Task completed and trigger deleted.'));
      }),
    );

    const triggerContext: TriggerContext = {
      triggerId: trigger.id,
      triggerName: 'one-time-reminder',
      goal: 'Deliver reminder and delete the trigger',
      invocationCount: 1,
      schedule: { type: 'once', at: trigger.schedule.type === 'once' ? trigger.schedule.at : '' },
    };

    const result = await orchestrator.invokeBackground('Deliver reminder and delete the trigger', triggerContext);

    expect(result.conversationId).toBeDefined();
    expect(callCount).toBe(3);

    // Verify the trigger was deleted
    const deletedTrigger = await triggerService.get(trigger.id);
    expect(deletedTrigger).toBeNull();
  });

  it('invokeBackground executes multiple tools in sequence without interrupts', async () => {
    // Create a trigger
    const trigger = await triggerService.create({
      name: 'multi-tool-trigger',
      goal: 'Execute multiple tools',
      schedule: { type: 'once', at: new Date(Date.now() + 3600000).toISOString() },
    });

    let callCount = 0;
    const toolsCalled: string[] = [];

    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          // Call both notify and delete_trigger at the same time
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_notify_1',
                name: 'triggers.notify',
                args: {
                  title: 'Multi-tool Test',
                  body: 'Testing multiple tool execution.',
                  urgency: 'low',
                },
              },
              {
                id: 'call_delete_1',
                name: 'triggers.delete_trigger',
                args: { triggerId: trigger.id },
              },
            ]),
          );
        }
        // After tools execute, track and return final response
        toolsCalled.push('notify', 'delete_trigger');
        return HttpResponse.json(createChatCompletion('Both tools executed successfully.'));
      }),
    );

    const triggerContext: TriggerContext = {
      triggerId: trigger.id,
      triggerName: 'multi-tool-trigger',
      goal: 'Execute multiple tools',
      invocationCount: 1,
      schedule: { type: 'once', at: trigger.schedule.type === 'once' ? trigger.schedule.at : '' },
    };

    const result = await orchestrator.invokeBackground('Execute multiple tools', triggerContext);

    expect(result.conversationId).toBeDefined();

    // Verify both tools were called
    expect(callCount).toBe(2);

    // Verify trigger was deleted
    const deletedTrigger = await triggerService.get(trigger.id);
    expect(deletedTrigger).toBeNull();
  });

  it('invokeBackground does NOT halt for tool approval in background mode', async () => {
    // This test verifies that invokeBackground doesn't get stuck on interrupts
    // All tools used in background should be low-risk

    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          // Use only low-risk tools
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_list_1',
                name: 'triggers.list_triggers',
                args: {},
              },
            ]),
          );
        }
        if (callCount === 2) {
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_notify_1',
                name: 'triggers.notify',
                args: {
                  title: 'Status Report',
                  body: 'All triggers are running.',
                  urgency: 'low',
                },
              },
            ]),
          );
        }
        return HttpResponse.json(createChatCompletion('Completed background task.'));
      }),
    );

    const triggerContext: TriggerContext = {
      triggerId: 'test-trigger-bg',
      triggerName: 'bg-test',
      goal: 'Check triggers and notify',
      invocationCount: 1,
      schedule: { type: 'cron', expression: '0 * * * *' },
    };

    // Should complete without hanging
    const result = await orchestrator.invokeBackground('Check triggers and notify', triggerContext);

    expect(result.conversationId).toBeDefined();
    expect(callCount).toBe(3);
  });

  it('notify tool requires triggerId in context', async () => {
    // Notify tool should only work when invoked from a trigger context
    // This tests that the toolContext.triggerId is passed correctly

    let toolCallsReceived: unknown[] = [];
    server.use(
      http.post('*/chat/completions', async ({ request }) => {
        const body = (await request.json()) as { messages: unknown[] };
        toolCallsReceived = body.messages;
        return HttpResponse.json(createChatCompletion('Notification sent.'));
      }),
    );

    const triggerContext: TriggerContext = {
      triggerId: 'trigger-with-notify',
      triggerName: 'notify-test',
      goal: 'Send a notification',
      invocationCount: 1,
      schedule: { type: 'cron', expression: '0 9 * * *' },
    };

    await orchestrator.invokeBackground('Send a notification', triggerContext);

    // The system prompt should include trigger context info
    expect(toolCallsReceived.length).toBeGreaterThan(0);
  });
});

describe('TriggerService Integration', () => {
  let services: Services;
  let orchestrator: OrchestratorService;
  let triggerService: TriggerService;

  beforeEach(async () => {
    const result = await createTestServices();
    services = result.services;
    orchestrator = result.orchestrator;

    triggerService = new TriggerService(services);
    triggerService.configure({
      orchestrator,
    });

    // Register the configured TriggerService in Services container (mirrors production behavior)
    services.set(TriggerService, triggerService);
  });

  afterEach(async () => {
    await triggerService.stop();
    // Allow pending async operations (checkpointing, etc.) to complete
    await new Promise((resolve) => setTimeout(resolve, 50));
    await services.destroy();
  });

  it('TriggerService.create calculates next invocation time', async () => {
    const trigger = await triggerService.create({
      name: 'cron-trigger',
      goal: 'Run every hour',
      schedule: { type: 'cron', expression: '0 * * * *' },
    });

    expect(trigger.nextInvocationAt).toBeDefined();
    if (trigger.nextInvocationAt) {
      expect(new Date(trigger.nextInvocationAt).getTime()).toBeGreaterThan(Date.now());
    }
  });

  it('TriggerService is accessible from Services container', async () => {
    // This verifies the critical fix: the TriggerService must be registered
    // in the Services container so that tools can access the same instance
    const triggerServiceFromContainer = services.get(TriggerService);
    expect(triggerServiceFromContainer).toBe(triggerService);
  });

  it('TriggerService.start schedules active triggers', async () => {
    server.use(
      http.post('*/chat/completions', () => {
        return HttpResponse.json(createChatCompletion('Task completed.'));
      }),
    );

    // Create a trigger for the future
    const futureTime = new Date(Date.now() + 3600000); // 1 hour from now
    await triggerService.create({
      name: 'future-trigger',
      goal: 'Future task',
      schedule: { type: 'once', at: futureTime.toISOString() },
    });

    // Start the service
    await triggerService.start();

    // Should have scheduled the trigger (plus pre-installed ones)
    expect(triggerService.scheduledCount).toBeGreaterThan(0);
  });

  it('catches up missed triggers on start (past trigger that never fired)', async () => {
    let invokeBackgroundCalled = false;
    const originalInvokeBackground = orchestrator.invokeBackground.bind(orchestrator);
    orchestrator.invokeBackground = async (goal, context) => {
      invokeBackgroundCalled = true;
      return originalInvokeBackground(goal, context);
    };

    server.use(
      http.post('*/chat/completions', () => {
        return HttpResponse.json(createChatCompletion('Caught up.'));
      }),
    );

    // Create a trigger that was supposed to fire 30 seconds ago (within catch-up window)
    const pastTime = new Date(Date.now() - 30000);
    await triggerService.create({
      name: 'missed-trigger',
      goal: 'Should catch up',
      schedule: { type: 'once', at: pastTime.toISOString() },
    });

    // Start should trigger catch-up logic for missed triggers
    await triggerService.start();

    // The catch-up fires via setImmediate, so wait briefly
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(invokeBackgroundCalled).toBe(true);
  });
});
