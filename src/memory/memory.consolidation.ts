import type { ChatOpenAI } from '@langchain/openai';
import type { BaseMessage } from '@langchain/core/messages';

import type { ConversationSummary, CreateMemoryInput } from './memory.schemas.ts';
import { MemoryService } from './memory.ts';

// ============================================================================
// Prompt Templates
// ============================================================================

const SUMMARIZATION_PROMPT = `Analyze the following conversation and extract:
1. A brief summary (1-2 sentences) of what was discussed
2. Any factual information about the user that was revealed (things they mentioned about themselves, their life, their work, etc.)
3. Any preferences the user expressed (likes, dislikes, how they want things done, etc.)

Respond in JSON format:
{
  "summary": "Brief summary of the conversation",
  "extractedFacts": ["fact 1", "fact 2"],
  "extractedPreferences": ["preference 1", "preference 2"]
}

Only include facts and preferences that were clearly stated or strongly implied. If none were found, use empty arrays.

Conversation:
`;

// ============================================================================
// Summarization
// ============================================================================

/**
 * Formats conversation messages for summarization.
 */
const formatConversation = (messages: BaseMessage[]): string => {
  return messages
    .filter((msg) => {
      const type = msg._getType();
      return type === 'human' || type === 'ai';
    })
    .map((msg) => {
      const role = msg._getType() === 'human' ? 'User' : 'Assistant';
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      return `${role}: ${content}`;
    })
    .join('\n');
};

/**
 * Summarizes a conversation and extracts facts and preferences.
 */
const summarizeConversation = async (llm: ChatOpenAI, messages: BaseMessage[]): Promise<ConversationSummary> => {
  // Skip if conversation is too short
  if (messages.length < 2) {
    return {
      summary: '',
      extractedFacts: [],
      extractedPreferences: [],
    };
  }

  const conversationText = formatConversation(messages);
  const prompt = SUMMARIZATION_PROMPT + conversationText;

  const response = await llm.invoke(prompt);
  const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

  // Extract JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      summary: content.slice(0, 200),
      extractedFacts: [],
      extractedPreferences: [],
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Partial<ConversationSummary>;
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      extractedFacts: Array.isArray(parsed.extractedFacts)
        ? parsed.extractedFacts.filter((f) => typeof f === 'string')
        : [],
      extractedPreferences: Array.isArray(parsed.extractedPreferences)
        ? parsed.extractedPreferences.filter((p) => typeof p === 'string')
        : [],
    };
  } catch {
    return {
      summary: content.slice(0, 200),
      extractedFacts: [],
      extractedPreferences: [],
    };
  }
};

/**
 * Processes a conversation end by summarizing and storing memories.
 */
const consolidateConversation = async (
  memoryService: MemoryService,
  llm: ChatOpenAI,
  messages: BaseMessage[],
  conversationId: string,
): Promise<void> => {
  const summary = await summarizeConversation(llm, messages);

  const memories: CreateMemoryInput[] = [];

  // Store conversation summary
  if (summary.summary && summary.summary.length > 0) {
    memories.push({
      type: 'conversation',
      content: summary.summary,
      metadata: { conversationId },
      importance: 0.5,
    });
  }

  // Store extracted facts
  for (const fact of summary.extractedFacts) {
    if (fact.length > 0) {
      memories.push({
        type: 'fact',
        content: fact,
        metadata: { conversationId, source: 'conversation_extraction' },
        importance: 0.6,
      });
    }
  }

  // Store extracted preferences
  for (const pref of summary.extractedPreferences) {
    if (pref.length > 0) {
      memories.push({
        type: 'preference',
        content: pref,
        metadata: { conversationId, source: 'conversation_extraction' },
        importance: 0.7, // Preferences are slightly more important
      });
    }
  }

  // Store all memories
  if (memories.length > 0) {
    await memoryService.rememberBatch(memories);
  }
};

export { summarizeConversation, consolidateConversation, formatConversation };
