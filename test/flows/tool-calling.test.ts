/**
 * Flow tests for tool calling.
 * These tests exercise the full tool execution flow including LangChain's ToolNode.
 *
 * CRITICAL: This is where the AIMessage spread bug manifests.
 * The bug in orchestrator.graph.ts:127-130 creates a plain object instead of
 * an AIMessage, causing ToolNode to fail with:
 * "Error: ToolNode only accepts BaseMessage[] or { messages: BaseMessage[] } as input"
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '../setup.ts';
import { createTestServices, collectChatResponse } from '../utils/services.ts';
import { createChatCompletion, createToolCallCompletion } from '../mocks/openai-responses.ts';
import type { Services } from '../../src/services/services.ts';
import type { OrchestratorService } from '../../src/orchestrator/orchestrator.ts';

describe('Tool Calling Flow', () => {
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

  it('executes a low-risk tool and returns result', async () => {
    // First call: LLM requests the echo tool
    // Second call: LLM processes the tool result and responds
    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_echo_1',
                name: 'builtin.echo',
                args: { message: 'test message' },
              },
            ]),
          );
        }
        return HttpResponse.json(createChatCompletion('The echo tool returned: test message'));
      }),
    );

    const conversationId = await orchestrator.startConversation();
    const { response, chunks } = await collectChatResponse(
      orchestrator.chat(conversationId, 'Please echo "test message"'),
    );

    // Should get a response
    expect(response).toContain('test message');
    expect(chunks.some((c) => c.type === 'done')).toBe(true);

    // Verify tool was executed (by checking multiple LLM calls were made)
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it('executes multiple tools in sequence', async () => {
    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_echo_1',
                name: 'builtin.echo',
                args: { message: 'first' },
              },
            ]),
          );
        }
        if (callCount === 2) {
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_echo_2',
                name: 'builtin.echo',
                args: { message: 'second' },
              },
            ]),
          );
        }
        return HttpResponse.json(createChatCompletion('I echoed both messages: first and second'));
      }),
    );

    const conversationId = await orchestrator.startConversation();
    const { response } = await collectChatResponse(orchestrator.chat(conversationId, 'Echo "first" then "second"'));

    expect(response).toContain('first');
    expect(response).toContain('second');
    expect(callCount).toBe(3);
  });

  it('handles tool with optional parameters', async () => {
    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_echo_upper',
                name: 'builtin.echo',
                args: { message: 'hello', uppercase: true },
              },
            ]),
          );
        }
        return HttpResponse.json(createChatCompletion('The echo returned: HELLO'));
      }),
    );

    const conversationId = await orchestrator.startConversation();
    const { response } = await collectChatResponse(orchestrator.chat(conversationId, 'Echo hello in uppercase'));

    expect(response).toContain('HELLO');
  });

  it('handles tool call with empty arguments', async () => {
    // This tests edge case where tool has no required args
    // The builtin.echo requires message, so we test with a valid minimal call
    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_echo_empty',
                name: 'builtin.echo',
                args: { message: '' },
              },
            ]),
          );
        }
        return HttpResponse.json(createChatCompletion('The echo returned an empty string.'));
      }),
    );

    const conversationId = await orchestrator.startConversation();
    const { response } = await collectChatResponse(orchestrator.chat(conversationId, 'Echo an empty string'));

    expect(response).toContain('empty');
  });

  it('LLM can choose not to call tools', async () => {
    server.use(
      http.post('*/chat/completions', () => {
        // No tool calls, just a text response
        return HttpResponse.json(createChatCompletion('I can help you with that without using any tools.'));
      }),
    );

    const conversationId = await orchestrator.startConversation();
    const { response, chunks } = await collectChatResponse(orchestrator.chat(conversationId, 'Just say hello'));

    expect(response).toContain('help');
    expect(chunks.some((c) => c.type === 'done')).toBe(true);
  });
});
