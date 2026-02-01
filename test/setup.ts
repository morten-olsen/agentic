/**
 * Vitest setup file for flow tests.
 * Configures MSW server to intercept HTTP requests.
 */

import { beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';

import { handlers } from './mocks/handlers.ts';

// Create MSW server with default handlers
const server = setupServer(...handlers);

// Start server before all tests
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

// Reset handlers after each test (removes test-specific handlers)
afterEach(() => {
  server.resetHandlers();
});

// Close server after all tests
afterAll(() => {
  server.close();
});

export { server };
