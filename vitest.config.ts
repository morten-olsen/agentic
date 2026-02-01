import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Increase timeout for flow tests that involve multiple LLM calls
    testTimeout: 30000,
  },
});
