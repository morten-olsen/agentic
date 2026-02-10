/**
 * Flow tests for domain whitelist and dynamic risk assessment.
 * Tests that web.fetch risk changes based on domain whitelist status.
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '../setup.ts';
import { createTestServices, collectChatResponse } from '../utils/services.ts';
import type { Services } from '../../src/core/services/services.ts';
import type { OrchestratorService, ChatChunk } from '../../src/agent/orchestrator/orchestrator.ts';
import { createChatCompletion, createToolCallCompletion } from '../mocks/openai-responses.ts';
import { DomainWhitelistService } from '../../src/features/risk-policies/risk-policies.ts';

describe('Domain Whitelist Flow', () => {
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

  it('web.fetch to non-whitelisted domain requires approval', async () => {
    // Mock HTTP for external fetch
    server.use(
      http.get('https://api.example.com/data', () => {
        return HttpResponse.json({ message: 'success' });
      }),
    );

    server.use(
      http.post('*/chat/completions', () => {
        return HttpResponse.json(
          createToolCallCompletion([
            {
              id: 'call_fetch',
              name: 'web.fetch',
              args: { url: 'https://api.example.com/data' },
            },
          ]),
        );
      }),
    );

    const conversationId = await orchestrator.startConversation();
    const chunks: ChatChunk[] = [];

    for await (const chunk of orchestrator.chat(conversationId, 'Fetch data from api.example.com')) {
      chunks.push(chunk);
    }

    // Should have an interrupt chunk due to medium risk
    const interruptChunk = chunks.find((c) => c.type === 'interrupt');
    expect(interruptChunk).toBeDefined();
    expect(interruptChunk?.type).toBe('interrupt');

    // Verify interrupt was stored for tool approval
    const interrupt = await orchestrator.interruptService.getPending(conversationId);
    expect(interrupt).not.toBeNull();
    expect(interrupt?.type).toBe('tool_approval');
    expect(interrupt?.toolCall?.toolName).toBe('web.fetch');
  });

  it('web.fetch to whitelisted domain does not require approval', async () => {
    // Pre-whitelist the domain
    const whitelistService = services.get(DomainWhitelistService);
    await whitelistService.add('api.example.com');

    // Mock HTTP for external fetch
    server.use(
      http.get('https://api.example.com/data', () => {
        return HttpResponse.json({ result: 'fetched data' });
      }),
    );

    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_fetch',
                name: 'web.fetch',
                args: { url: 'https://api.example.com/data' },
              },
            ]),
          );
        }
        return HttpResponse.json(createChatCompletion('I fetched the data for you.'));
      }),
    );

    const conversationId = await orchestrator.startConversation();
    const { chunks } = await collectChatResponse(orchestrator.chat(conversationId, 'Fetch api.example.com'));

    // Should NOT have an interrupt chunk - low risk for whitelisted domain
    const interruptChunk = chunks.find((c) => c.type === 'interrupt');
    expect(interruptChunk).toBeUndefined();

    // Should complete normally
    expect(chunks.some((c) => c.type === 'done')).toBe(true);
  });

  it('whitelisting a parent domain allows subdomains', async () => {
    // Whitelist parent domain
    const whitelistService = services.get(DomainWhitelistService);
    await whitelistService.add('example.com');

    // Mock HTTP for subdomain fetch
    server.use(
      http.get('https://api.example.com/endpoint', () => {
        return HttpResponse.json({ status: 'ok' });
      }),
    );

    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_fetch',
                name: 'web.fetch',
                args: { url: 'https://api.example.com/endpoint' },
              },
            ]),
          );
        }
        return HttpResponse.json(createChatCompletion('Data retrieved successfully.'));
      }),
    );

    const conversationId = await orchestrator.startConversation();
    const { chunks } = await collectChatResponse(orchestrator.chat(conversationId, 'Get data from api.example.com'));

    // Should NOT have an interrupt - subdomain inherits trust from parent
    const interruptChunk = chunks.find((c) => c.type === 'interrupt');
    expect(interruptChunk).toBeUndefined();

    // Should complete normally
    expect(chunks.some((c) => c.type === 'done')).toBe(true);
  });

  it('whitelist_domain tool requires approval (medium risk)', async () => {
    server.use(
      http.post('*/chat/completions', () => {
        return HttpResponse.json(
          createToolCallCompletion([
            {
              id: 'call_whitelist',
              name: 'security.whitelist_domain',
              args: { domain: 'trusted.com', reason: 'Company API' },
            },
          ]),
        );
      }),
    );

    const conversationId = await orchestrator.startConversation();
    const chunks: ChatChunk[] = [];

    for await (const chunk of orchestrator.chat(conversationId, 'Add trusted.com to the whitelist')) {
      chunks.push(chunk);
    }

    // Should have an interrupt chunk - medium risk tool
    const interruptChunk = chunks.find((c) => c.type === 'interrupt');
    expect(interruptChunk).toBeDefined();

    const interrupt = await orchestrator.interruptService.getPending(conversationId);
    expect(interrupt).not.toBeNull();
    expect(interrupt?.type).toBe('tool_approval');
    expect(interrupt?.toolCall?.toolName).toBe('security.whitelist_domain');
  });

  it('full flow: whitelist then fetch without approval', async () => {
    // Mock HTTP for external fetch
    server.use(
      http.get('https://api.trusted.com/resource', () => {
        return HttpResponse.json({ data: 'important' });
      }),
    );

    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          // First call: whitelist the domain
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_whitelist',
                name: 'security.whitelist_domain',
                args: { domain: 'api.trusted.com' },
              },
            ]),
          );
        }
        if (callCount === 2) {
          // After approval: confirm whitelist success
          return HttpResponse.json(createChatCompletion('Domain whitelisted successfully.'));
        }
        if (callCount === 3) {
          // Second conversation: fetch from whitelisted domain
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_fetch',
                name: 'web.fetch',
                args: { url: 'https://api.trusted.com/resource' },
              },
            ]),
          );
        }
        // After fetch: return result
        return HttpResponse.json(createChatCompletion('Here is the data from the API.'));
      }),
    );

    const conversationId = await orchestrator.startConversation();

    // Step 1: Request to whitelist triggers interrupt
    const whitelistChunks: ChatChunk[] = [];
    for await (const chunk of orchestrator.chat(conversationId, 'Whitelist api.trusted.com')) {
      whitelistChunks.push(chunk);
    }
    expect(whitelistChunks.some((c) => c.type === 'interrupt')).toBe(true);

    // Step 2: Approve the whitelist
    await collectChatResponse(orchestrator.chat(conversationId, 'yes'));

    // Verify domain was whitelisted
    const whitelistService = services.get(DomainWhitelistService);
    const isWhitelisted = await whitelistService.isWhitelisted('api.trusted.com');
    expect(isWhitelisted).toBe(true);

    // Step 3: Now fetch from the whitelisted domain - should NOT require approval
    const fetchChunks: ChatChunk[] = [];
    for await (const chunk of orchestrator.chat(conversationId, 'Fetch from api.trusted.com')) {
      fetchChunks.push(chunk);
    }

    // Should NOT have an interrupt - domain is now whitelisted
    const interruptChunk = fetchChunks.find((c) => c.type === 'interrupt');
    expect(interruptChunk).toBeUndefined();
  });

  it('list_whitelisted_domains is low risk', async () => {
    // Pre-whitelist some domains
    const whitelistService = services.get(DomainWhitelistService);
    await whitelistService.add('domain1.com');
    await whitelistService.add('domain2.com');

    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_list',
                name: 'security.list_whitelisted_domains',
                args: {},
              },
            ]),
          );
        }
        return HttpResponse.json(createChatCompletion('You have 2 domains whitelisted.'));
      }),
    );

    const conversationId = await orchestrator.startConversation();
    const { chunks } = await collectChatResponse(orchestrator.chat(conversationId, 'Show whitelisted domains'));

    // Should NOT have an interrupt - low risk read-only tool
    const interruptChunk = chunks.find((c) => c.type === 'interrupt');
    expect(interruptChunk).toBeUndefined();

    // Should complete normally
    expect(chunks.some((c) => c.type === 'done')).toBe(true);
  });

  it('remove_whitelisted_domain is low risk', async () => {
    // Pre-whitelist a domain
    const whitelistService = services.get(DomainWhitelistService);
    await whitelistService.add('untrust.com');

    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_remove',
                name: 'security.remove_whitelisted_domain',
                args: { domain: 'untrust.com' },
              },
            ]),
          );
        }
        return HttpResponse.json(createChatCompletion('Domain removed from whitelist.'));
      }),
    );

    const conversationId = await orchestrator.startConversation();
    const { chunks } = await collectChatResponse(orchestrator.chat(conversationId, 'Remove untrust.com'));

    // Should NOT have an interrupt - low risk (more restrictive action)
    const interruptChunk = chunks.find((c) => c.type === 'interrupt');
    expect(interruptChunk).toBeUndefined();

    // Should complete normally
    expect(chunks.some((c) => c.type === 'done')).toBe(true);

    // Verify domain was removed
    const isWhitelisted = await whitelistService.isWhitelisted('untrust.com');
    expect(isWhitelisted).toBe(false);
  });
});
