/**
 * API routes integration tests.
 * Tests the API endpoints using fastify.inject().
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import type { FastifyInstance } from 'fastify';

import { server } from '../../../test/setup.ts';
import { Services } from '../../core/services/services.ts';
import { DatabaseService, createDatabaseService } from '../../core/database/database.ts';
import { UserModelService } from '../../domain/user-model/user-model.ts';
import { LocationService } from '../../domain/location/location.ts';
import { CalendarService } from '../../domain/calendar/calendar.ts';
import { ContactsService } from '../../domain/contacts/contacts.ts';
import { ContextBuilderService } from '../../agent/context/context.ts';
import { PersonalityService } from '../../agent/personality/personality.ts';
import { MemoryService } from '../../agent/memory/memory.ts';
import { OrchestratorService } from '../../agent/orchestrator/orchestrator.ts';
import type { Config } from '../../core/config/config.ts';

import { createApiServer } from './api.ts';

// ============================================================================
// Test Helpers
// ============================================================================

const createChatCompletion = (content: string) => ({
  id: 'chatcmpl-test',
  object: 'chat.completion',
  created: Date.now(),
  model: 'test-model',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
});

const createTestConfig = (): Config =>
  ({
    env: 'test',
    api: {
      enabled: true,
      host: '0.0.0.0',
      port: 3000,
      trustProxy: false,
      publicUrl: '',
      docsEnabled: false, // Disable docs in tests
      toolsEnabled: true,
      corsOrigins: '*',
    },
    oura: {
      clientId: '',
      clientSecret: '',
      webhookSecret: '',
    },
  }) as Config;

type TestContext = {
  services: Services;
  orchestrator: OrchestratorService;
  fastify: FastifyInstance;
};

const createTestContext = async (): Promise<TestContext> => {
  const services = new Services();

  // Initialize database with in-memory SQLite
  const db = createDatabaseService(services, { path: ':memory:' });
  services.set(DatabaseService, db);
  await db.migrate();

  // Initialize required services
  services.get(UserModelService);
  services.get(LocationService);
  services.get(ContactsService);
  services.get(CalendarService);
  services.get(ContextBuilderService);
  services.get(PersonalityService);
  services.get(MemoryService);

  // Create and configure orchestrator
  const orchestrator = new OrchestratorService(services);
  services.set(OrchestratorService, orchestrator);

  await orchestrator.configure({
    llm: {
      apiKey: 'test-api-key',
      baseUrl: 'https://api.test.com/v1',
    },
  });

  // Create API server
  const config = createTestConfig();
  const fastify = await createApiServer({ services, config });

  return { services, orchestrator, fastify };
};

// ============================================================================
// Health Route Tests
// ============================================================================

describe('Health Routes', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.fastify.close();
    await ctx.services.destroy();
  });

  it('GET /api/v1/health returns ok status', async () => {
    const response = await ctx.fastify.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
  });
});

// ============================================================================
// Conversation Route Tests
// ============================================================================

describe('Conversation Routes', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.fastify.close();
    await ctx.services.destroy();
  });

  describe('POST /api/v1/conversations', () => {
    it('creates a new conversation', async () => {
      const response = await ctx.fastify.inject({
        method: 'POST',
        url: '/api/v1/conversations',
        payload: { title: 'Test Conversation' },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.id).toBeDefined();
      expect(body.title).toBe('Test Conversation');
      expect(body.createdAt).toBeDefined();
    });

    it('creates conversation without title', async () => {
      const response = await ctx.fastify.inject({
        method: 'POST',
        url: '/api/v1/conversations',
        payload: {},
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.id).toBeDefined();
      expect(body.title).toBeNull();
    });
  });

  describe('GET /api/v1/conversations/:id', () => {
    it('returns conversation by id', async () => {
      // Create a conversation first
      const createResponse = await ctx.fastify.inject({
        method: 'POST',
        url: '/api/v1/conversations',
        payload: { title: 'Test' },
      });
      const { id } = JSON.parse(createResponse.body);

      // Get the conversation
      const response = await ctx.fastify.inject({
        method: 'GET',
        url: `/api/v1/conversations/${id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(id);
    });

    it('returns 404 for non-existent conversation', async () => {
      const response = await ctx.fastify.inject({
        method: 'GET',
        url: '/api/v1/conversations/non-existent-id',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/v1/conversations/:id', () => {
    it('deletes a conversation', async () => {
      // Create a conversation first
      const createResponse = await ctx.fastify.inject({
        method: 'POST',
        url: '/api/v1/conversations',
        payload: {},
      });
      const { id } = JSON.parse(createResponse.body);

      // Delete it
      const deleteResponse = await ctx.fastify.inject({
        method: 'DELETE',
        url: `/api/v1/conversations/${id}`,
      });

      expect(deleteResponse.statusCode).toBe(204);

      // Verify it's gone
      const getResponse = await ctx.fastify.inject({
        method: 'GET',
        url: `/api/v1/conversations/${id}`,
      });
      expect(getResponse.statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/conversations/:id/messages', () => {
    it('returns empty messages for new conversation', async () => {
      const createResponse = await ctx.fastify.inject({
        method: 'POST',
        url: '/api/v1/conversations',
        payload: {},
      });
      const { id } = JSON.parse(createResponse.body);

      const response = await ctx.fastify.inject({
        method: 'GET',
        url: `/api/v1/conversations/${id}/messages`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.messages).toEqual([]);
    });
  });
});

// ============================================================================
// Chat Route Tests
// ============================================================================

describe('Chat Routes', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.fastify.close();
    await ctx.services.destroy();
  });

  describe('POST /api/v1/chat/:conversationId', () => {
    it('sends message and receives response', async () => {
      server.use(
        http.post('*/chat/completions', () => {
          return HttpResponse.json(createChatCompletion('Hello! How can I help?'));
        }),
      );

      // Create conversation
      const createResponse = await ctx.fastify.inject({
        method: 'POST',
        url: '/api/v1/conversations',
        payload: {},
      });
      const { id } = JSON.parse(createResponse.body);

      // Send chat message
      const response = await ctx.fastify.inject({
        method: 'POST',
        url: `/api/v1/chat/${id}`,
        payload: { message: 'Hello' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.conversationId).toBe(id);
      expect(body.response).toContain('Hello');
    });

    it('returns 404 for non-existent conversation', async () => {
      const response = await ctx.fastify.inject({
        method: 'POST',
        url: '/api/v1/chat/non-existent',
        payload: { message: 'Hello' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /api/v1/chat/:conversationId/stream', () => {
    it('streams response as SSE', async () => {
      server.use(
        http.post('*/chat/completions', () => {
          return HttpResponse.json(createChatCompletion('Streaming response'));
        }),
      );

      // Create conversation
      const createResponse = await ctx.fastify.inject({
        method: 'POST',
        url: '/api/v1/conversations',
        payload: {},
      });
      const { id } = JSON.parse(createResponse.body);

      // Send streaming chat message
      const response = await ctx.fastify.inject({
        method: 'POST',
        url: `/api/v1/chat/${id}/stream`,
        payload: { message: 'Hello' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('text/event-stream');
      expect(response.body).toContain('event:');
      expect(response.body).toContain('data:');
    });
  });
});

// ============================================================================
// Tool Route Tests
// ============================================================================

describe('Tool Routes', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.fastify.close();
    await ctx.services.destroy();
  });

  describe('GET /api/v1/tools', () => {
    it('lists available tools', async () => {
      const response = await ctx.fastify.inject({
        method: 'GET',
        url: '/api/v1/tools',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.tools).toBeDefined();
      expect(Array.isArray(body.tools)).toBe(true);
      expect(body.total).toBeGreaterThanOrEqual(0);
    });

    it('filters tools by category', async () => {
      const response = await ctx.fastify.inject({
        method: 'GET',
        url: '/api/v1/tools?category=builtin',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.tools.every((t: { category: string }) => t.category === 'builtin')).toBe(true);
    });
  });

  describe('GET /api/v1/tools/:toolId', () => {
    it('returns tool details', async () => {
      // First list tools to get a valid ID
      const listResponse = await ctx.fastify.inject({
        method: 'GET',
        url: '/api/v1/tools',
      });
      const { tools } = JSON.parse(listResponse.body);

      if (tools.length > 0) {
        const toolId = tools[0].id;

        const response = await ctx.fastify.inject({
          method: 'GET',
          url: `/api/v1/tools/${toolId}`,
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.id).toBe(toolId);
        expect(body.inputSchema).toBeDefined();
        expect(body.outputSchema).toBeDefined();
      }
    });

    it('returns 404 for non-existent tool', async () => {
      const response = await ctx.fastify.inject({
        method: 'GET',
        url: '/api/v1/tools/non.existent.tool',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /api/v1/tools/{category}/{name}', () => {
    it('executes the echo tool', async () => {
      const response = await ctx.fastify.inject({
        method: 'POST',
        url: '/api/v1/tools/builtin/echo',
        payload: { message: 'Hello, World!' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.toolId).toBe('builtin.echo');
      expect(body.output.echoed).toBe('Hello, World!');
      expect(body.durationMs).toBeDefined();
    });

    it('returns 404 for non-existent tool', async () => {
      const response = await ctx.fastify.inject({
        method: 'POST',
        url: '/api/v1/tools/non/existent',
        payload: {},
      });

      expect(response.statusCode).toBe(404);
    });
  });
});

// ============================================================================
// Interrupt Route Tests
// ============================================================================

describe('Interrupt Routes', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.fastify.close();
    await ctx.services.destroy();
  });

  describe('GET /api/v1/interrupts/:conversationId', () => {
    it('returns 204 when no pending interrupt', async () => {
      // Create conversation
      const createResponse = await ctx.fastify.inject({
        method: 'POST',
        url: '/api/v1/conversations',
        payload: {},
      });
      const { id } = JSON.parse(createResponse.body);

      const response = await ctx.fastify.inject({
        method: 'GET',
        url: `/api/v1/interrupts/${id}`,
      });

      expect(response.statusCode).toBe(204);
    });

    it('returns 404 for non-existent conversation', async () => {
      const response = await ctx.fastify.inject({
        method: 'GET',
        url: '/api/v1/interrupts/non-existent',
      });

      expect(response.statusCode).toBe(404);
    });
  });
});

// ============================================================================
// OpenAPI Route Tests
// ============================================================================

describe('OpenAPI Routes', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.fastify.close();
    await ctx.services.destroy();
  });

  it('GET /api/v1/openapi.json returns OpenAPI spec', async () => {
    const response = await ctx.fastify.inject({
      method: 'GET',
      url: '/api/v1/openapi.json',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.openapi).toBeDefined();
    expect(body.info).toBeDefined();
    expect(body.info.title).toBe('GLaDOS API');
  });
});
