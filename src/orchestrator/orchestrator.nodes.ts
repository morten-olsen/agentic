import type { MemoryService } from '../memory/memory.ts';

import type { OrchestratorState } from './orchestrator.state.ts';

/**
 * Creates a memory retriever node that retrieves relevant context from memory.
 *
 * @param memoryService - Optional MemoryService for semantic search
 * @returns A node function that retrieves memory context
 */
const createMemoryRetrieverNode = (memoryService?: MemoryService) => {
  return async (state: OrchestratorState): Promise<Partial<OrchestratorState>> => {
    // If no memory service, return empty context
    if (!memoryService) {
      return { memoryContext: [] };
    }

    // Find the last user message to use as query
    const lastUserMessage = [...state.messages].reverse().find((m) => m._getType() === 'human');

    if (!lastUserMessage) {
      return { memoryContext: [] };
    }

    // Extract query text
    const query =
      typeof lastUserMessage.content === 'string' ? lastUserMessage.content : JSON.stringify(lastUserMessage.content);

    // Skip empty queries
    if (!query || query.trim().length === 0) {
      return { memoryContext: [] };
    }

    try {
      // Recall relevant memories
      const memories = await memoryService.recall(query, { limit: 5 });

      // Format as context strings
      const memoryContext = memories.map((m) => `[${m.type}] ${m.content}`);

      return { memoryContext };
    } catch (error) {
      // Log error but don't fail the graph
      console.error('Memory retrieval error:', error);
      return { memoryContext: [] };
    }
  };
};

/**
 * Memory retriever node - retrieves relevant context from memory.
 * Default implementation without MemoryService (returns empty context).
 */
const memoryRetrieverNode = createMemoryRetrieverNode();

export { memoryRetrieverNode, createMemoryRetrieverNode };
