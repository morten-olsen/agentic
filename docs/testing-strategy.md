# Testing Strategy

This document describes the testing strategy and patterns used in the GLaDOS project. The project uses **Vitest** as the test runner with a layered testing approach.

## Test Layers

### 1. Unit Tests (`src/**/*.test.ts`)

Unit tests focus on individual modules in isolation. They:

- Test a single module's public API
- Mock dependencies via the Services container
- Use in-memory SQLite databases
- Live alongside the code they test

**Example location**: `src/contacts/contacts.test.ts`

### 2. Flow Tests (`test/flows/*.test.ts`)

Flow tests exercise the full application stack with HTTP-level mocking. They:

- Test end-to-end flows (conversation → LLM → tool execution → response)
- Mock at the HTTP level using MSW (Mock Service Worker)
- Use real services with in-memory databases
- Catch integration issues that unit tests miss

**Test files**:
- `test/flows/conversation.test.ts` - Basic chat flows
- `test/flows/tool-calling.test.ts` - Tool execution flows
- `test/flows/memory.test.ts` - Memory recall and storage
- `test/flows/interrupts.test.ts` - Human-in-the-loop approval flows

---

## Test Infrastructure

### MSW Setup (`test/setup.ts`)

The MSW server intercepts all HTTP requests during tests:

```typescript
import { setupServer } from 'msw/node';
import { handlers } from './mocks/handlers.ts';

export const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

### Mock Handlers (`test/mocks/handlers.ts`)

Default handlers provide baseline responses. Override per-test for specific behavior:

```typescript
import { http, HttpResponse } from 'msw';
import { createChatCompletion } from './openai-responses.ts';

export const handlers = [
  http.post('*/chat/completions', () => {
    return HttpResponse.json(createChatCompletion('Default response'));
  }),
];
```

### Response Factories (`test/mocks/openai-responses.ts`)

Factory functions create properly-structured OpenAI API responses:

- `createChatCompletion(content)` - Text response
- `createToolCallCompletion(toolCalls)` - Tool call response
- `createEmbeddingResponse(dimensions)` - Embedding response

### Test Services (`test/utils/services.ts`)

Creates a fully-initialized services container for testing:

```typescript
import { createTestServices } from '../utils/services.ts';

const { services, orchestrator } = await createTestServices();
// orchestrator is pre-configured with test API key
```

---

## Writing Tests

### Unit Test Pattern

```typescript
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { Services } from '../services/services.ts';
import { DatabaseService, createDatabaseService } from '../database/database.ts';
import { MyService } from './my-service.ts';

describe('MyService', () => {
  let services: Services;

  beforeEach(async () => {
    services = new Services();
    const db = createDatabaseService(services, { path: ':memory:' });
    services.set(DatabaseService, db);
    await db.migrate();
  });

  afterEach(async () => {
    await services.destroy();
  });

  it('does something', async () => {
    const myService = services.get(MyService);
    const result = await myService.doSomething();
    expect(result).toBe(expected);
  });
});
```

### Flow Test Pattern

```typescript
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../setup.ts';
import { createTestServices, collectChatResponse } from '../utils/services.ts';
import { createChatCompletion, createToolCallCompletion } from '../mocks/openai-responses.ts';

describe('Feature Flow', () => {
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

  it('executes a tool and returns result', async () => {
    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          // First call: LLM requests tool
          return HttpResponse.json(
            createToolCallCompletion([{
              name: 'builtin.echo',
              args: { message: 'test' },
            }]),
          );
        }
        // Second call: LLM processes tool result
        return HttpResponse.json(createChatCompletion('Done!'));
      }),
    );

    const conversationId = await orchestrator.startConversation();
    const { response } = await collectChatResponse(
      orchestrator.chat(conversationId, 'Echo test'),
    );

    expect(response).toContain('Done');
    expect(callCount).toBe(2);
  });
});
```

---

## Key Patterns

### Mocking LLM Responses

For tool-calling flows, the LLM is called multiple times:

1. **Initial call**: Returns tool call request
2. **After tool execution**: Returns final text response

```typescript
let callCount = 0;
server.use(
  http.post('*/chat/completions', () => {
    callCount++;
    if (callCount === 1) {
      return HttpResponse.json(createToolCallCompletion([...]));
    }
    return HttpResponse.json(createChatCompletion('Final response'));
  }),
);
```

### Testing Interrupts

For medium/high-risk tools that require approval:

```typescript
// Trigger interrupt
for await (const chunk of orchestrator.chat(conversationId, 'Delete item')) {
  if (chunk.type === 'interrupt') {
    // Interrupt was created
  }
}

// Approve the interrupt
const { response } = await collectChatResponse(
  orchestrator.chat(conversationId, 'yes'),
);
```

### Tool Names

In tests, use the tool's `id` (not display name) as the tool call name. This matches how LangChain tools work:

```typescript
// Tool registered with id: 'contacts.delete', name: 'DeleteContact'
// In mock, use the id:
createToolCallCompletion([{ name: 'contacts.delete', args: {...} }]);
```

---

## Running Tests

```bash
pnpm test              # All tests (lint + unit + flow)
pnpm test:unit         # Unit and flow tests
pnpm test:lint         # ESLint checks

# Run specific test file
pnpm test:unit test/flows/tool-calling.test.ts

# Run tests matching pattern
pnpm test:unit -t "executes a tool"
```

---

## Configuration

### `vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 30000,
  },
});
```

---

## Best Practices

1. **Use in-memory databases**: Always use `:memory:` for SQLite in tests
2. **Clean up after tests**: Call `services.destroy()` in `afterEach`
3. **Reset MSW handlers**: Happens automatically via `server.resetHandlers()` in setup
4. **Track LLM call counts**: Use counters to verify expected call sequences
5. **Test the happy path and error cases**: Include tests for both success and failure scenarios
6. **Keep flow tests focused**: Each test should verify one specific flow
