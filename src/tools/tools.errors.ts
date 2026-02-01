/**
 * Error thrown when a tool is not found in the registry.
 */
class ToolNotFoundError extends Error {
  readonly toolId: string;

  constructor(toolId: string) {
    super(`Tool not found: ${toolId}`);
    this.name = 'ToolNotFoundError';
    this.toolId = toolId;
  }
}

/**
 * Error thrown when a tool is already registered.
 */
class ToolAlreadyRegisteredError extends Error {
  readonly toolId: string;

  constructor(toolId: string) {
    super(`Tool already registered: ${toolId}`);
    this.name = 'ToolAlreadyRegisteredError';
    this.toolId = toolId;
  }
}

/**
 * Error thrown when tool execution fails.
 */
class ToolExecutionError extends Error {
  readonly toolId: string;
  readonly originalError: unknown;

  constructor(toolId: string, message: string, originalError?: unknown) {
    super(`Tool execution failed (${toolId}): ${message}`);
    this.name = 'ToolExecutionError';
    this.toolId = toolId;
    this.originalError = originalError;
  }
}

/**
 * Error thrown when tool input validation fails.
 */
class ToolInputValidationError extends Error {
  readonly toolId: string;
  readonly validationErrors: string[];

  constructor(toolId: string, validationErrors: string[]) {
    super(`Tool input validation failed (${toolId}): ${validationErrors.join(', ')}`);
    this.name = 'ToolInputValidationError';
    this.toolId = toolId;
    this.validationErrors = validationErrors;
  }
}

/**
 * Error thrown when tool output validation fails.
 */
class ToolOutputValidationError extends Error {
  readonly toolId: string;
  readonly validationErrors: string[];

  constructor(toolId: string, validationErrors: string[]) {
    super(`Tool output validation failed (${toolId}): ${validationErrors.join(', ')}`);
    this.name = 'ToolOutputValidationError';
    this.toolId = toolId;
    this.validationErrors = validationErrors;
  }
}

/**
 * Error thrown when tool execution times out.
 */
class ToolTimeoutError extends Error {
  readonly toolId: string;
  readonly timeoutMs: number;

  constructor(toolId: string, timeoutMs: number) {
    super(`Tool execution timed out (${toolId}): exceeded ${timeoutMs}ms`);
    this.name = 'ToolTimeoutError';
    this.toolId = toolId;
    this.timeoutMs = timeoutMs;
  }
}

export {
  ToolNotFoundError,
  ToolAlreadyRegisteredError,
  ToolExecutionError,
  ToolInputValidationError,
  ToolOutputValidationError,
  ToolTimeoutError,
};
