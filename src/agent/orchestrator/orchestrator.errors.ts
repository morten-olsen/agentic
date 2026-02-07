/**
 * Error thrown when a conversation is not found.
 */
class ConversationNotFoundError extends Error {
  readonly conversationId: string;

  constructor(conversationId: string) {
    super(`Conversation not found: ${conversationId}`);
    this.name = 'ConversationNotFoundError';
    this.conversationId = conversationId;
  }
}

/**
 * Error thrown when the orchestrator is not configured.
 */
class OrchestratorNotConfiguredError extends Error {
  constructor(message = 'Orchestrator is not configured') {
    super(message);
    this.name = 'OrchestratorNotConfiguredError';
  }
}

/**
 * Error thrown when LLM invocation fails.
 */
class LLMInvocationError extends Error {
  readonly originalError: unknown;

  constructor(message: string, originalError?: unknown) {
    super(message);
    this.name = 'LLMInvocationError';
    this.originalError = originalError;
  }
}

export { ConversationNotFoundError, OrchestratorNotConfiguredError, LLMInvocationError };
