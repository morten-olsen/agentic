/**
 * Factory functions for creating OpenAI-compatible API responses.
 * Used by MSW handlers to mock LLM responses.
 */

type ToolCallSpec = {
  id?: string;
  name: string;
  args: Record<string, unknown>;
};

/**
 * Creates a chat completion response with text content.
 */
const createChatCompletion = (content: string) => ({
  id: `chatcmpl-${Date.now()}`,
  object: 'chat.completion',
  created: Math.floor(Date.now() / 1000),
  model: 'test-model',
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop',
    },
  ],
});

/**
 * Creates a chat completion response with tool calls.
 */
const createToolCallCompletion = (toolCalls: ToolCallSpec[]) => ({
  id: `chatcmpl-${Date.now()}`,
  object: 'chat.completion',
  created: Math.floor(Date.now() / 1000),
  model: 'test-model',
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: null,
        tool_calls: toolCalls.map((tc, index) => ({
          id: tc.id ?? `call_${Date.now()}_${index}`,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args),
          },
        })),
      },
      finish_reason: 'tool_calls',
    },
  ],
});

/**
 * Creates an embedding response.
 */
const createEmbeddingResponse = (dimensions = 1536) => {
  // Create a random normalized vector
  const embedding = Array.from({ length: dimensions }, () => Math.random() - 0.5);
  const norm = Math.sqrt(embedding.reduce((sum, x) => sum + x * x, 0));
  const normalized = embedding.map((x) => x / norm);

  return {
    object: 'list',
    data: [
      {
        object: 'embedding',
        index: 0,
        embedding: normalized,
      },
    ],
    model: 'text-embedding-ada-002',
    usage: { prompt_tokens: 5, total_tokens: 5 },
  };
};

/**
 * Creates a batch embedding response.
 */
const createBatchEmbeddingResponse = (count: number, dimensions = 1536) => {
  const data = Array.from({ length: count }, (_, index) => {
    const embedding = Array.from({ length: dimensions }, () => Math.random() - 0.5);
    const norm = Math.sqrt(embedding.reduce((sum, x) => sum + x * x, 0));
    const normalized = embedding.map((x) => x / norm);
    return {
      object: 'embedding',
      index,
      embedding: normalized,
    };
  });

  return {
    object: 'list',
    data,
    model: 'text-embedding-ada-002',
    usage: { prompt_tokens: 5 * count, total_tokens: 5 * count },
  };
};

export type { ToolCallSpec };
export { createChatCompletion, createToolCallCompletion, createEmbeddingResponse, createBatchEmbeddingResponse };
