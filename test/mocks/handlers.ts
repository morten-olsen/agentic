/**
 * MSW request handlers for mocking OpenAI-compatible APIs.
 */

import { http, HttpResponse, passthrough } from 'msw';

import { createChatCompletion, createEmbeddingResponse } from './openai-responses.ts';

/**
 * Default handlers - return simple responses.
 * Override these per-test using server.use() for specific behavior.
 */
const handlers = [
  // Allow HuggingFace requests to pass through (for local embeddings model downloads)
  http.get('https://huggingface.co/*', () => {
    return passthrough();
  }),

  // Chat completions endpoint
  http.post('*/chat/completions', () => {
    return HttpResponse.json(createChatCompletion('Default test response'));
  }),

  // Embeddings endpoint
  http.post('*/embeddings', () => {
    return HttpResponse.json(createEmbeddingResponse());
  }),
];

export { handlers };
