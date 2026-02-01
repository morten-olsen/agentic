import type { Services } from '../services/services.ts';

import type { ToolContext } from './tools.schemas.ts';
import type { ToolDefinition, RegisteredTool, ToolExecutionOptions, ToolExecutionEvent } from './tools.types.ts';
import {
  ToolNotFoundError,
  ToolAlreadyRegisteredError,
  ToolExecutionError,
  ToolInputValidationError,
  ToolOutputValidationError,
  ToolTimeoutError,
} from './tools.errors.ts';

/**
 * Default execution options.
 */
const DEFAULT_OPTIONS: Required<ToolExecutionOptions> = {
  timeout: 30000, // 30 seconds
  validateInput: true,
  validateOutput: true,
};

/**
 * Tool Registry - manages tool registration and execution.
 */
class ToolRegistry {
  #services: Services;
  #tools = new Map<string, RegisteredTool>();
  #eventListeners: ((event: ToolExecutionEvent) => void)[] = [];

  constructor(services: Services) {
    this.#services = services;
  }

  /**
   * Gets the services container (for tools that need dependencies).
   */
  get services(): Services {
    return this.#services;
  }

  /**
   * Registers a tool.
   * The third type parameter TRawInput is for examples (raw input before transforms).
   */
  register = <TInput, TOutput, TRawInput = TInput>(tool: ToolDefinition<TInput, TOutput, TRawInput>): void => {
    if (this.#tools.has(tool.id)) {
      throw new ToolAlreadyRegisteredError(tool.id);
    }

    const registered: RegisteredTool<TInput, TOutput, TRawInput> = {
      ...tool,
      registeredAt: new Date(),
    };

    this.#tools.set(tool.id, registered as RegisteredTool);
  };

  /**
   * Unregisters a tool.
   */
  unregister = (toolId: string): boolean => {
    return this.#tools.delete(toolId);
  };

  /**
   * Gets a tool by ID.
   */
  get = <TInput = unknown, TOutput = unknown>(toolId: string): RegisteredTool<TInput, TOutput> | undefined => {
    return this.#tools.get(toolId) as RegisteredTool<TInput, TOutput> | undefined;
  };

  /**
   * Gets a tool by ID, throwing if not found.
   */
  getOrThrow = <TInput = unknown, TOutput = unknown>(toolId: string): RegisteredTool<TInput, TOutput> => {
    const tool = this.get<TInput, TOutput>(toolId);
    if (!tool) {
      throw new ToolNotFoundError(toolId);
    }
    return tool;
  };

  /**
   * Gets all registered tools.
   */
  getAll = (): RegisteredTool[] => {
    return Array.from(this.#tools.values());
  };

  /**
   * Gets tools by category.
   */
  getByCategory = (category: string): RegisteredTool[] => {
    return this.getAll().filter((tool) => tool.category === category);
  };

  /**
   * Gets tools by tag.
   */
  getByTag = (tag: string): RegisteredTool[] => {
    return this.getAll().filter((tool) => tool.tags.includes(tag));
  };

  /**
   * Checks if a tool is registered.
   */
  has = (toolId: string): boolean => {
    return this.#tools.has(toolId);
  };

  /**
   * Gets the count of registered tools.
   */
  get size(): number {
    return this.#tools.size;
  }

  /**
   * Adds an event listener for tool execution events.
   */
  onExecution = (listener: (event: ToolExecutionEvent) => void): (() => void) => {
    this.#eventListeners.push(listener);
    return () => {
      const index = this.#eventListeners.indexOf(listener);
      if (index !== -1) {
        this.#eventListeners.splice(index, 1);
      }
    };
  };

  /**
   * Emits a tool execution event.
   */
  #emitEvent = (event: ToolExecutionEvent): void => {
    for (const listener of this.#eventListeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  };

  /**
   * Executes a tool by ID.
   */
  execute = async <TInput, TOutput>(
    toolId: string,
    input: TInput,
    context: ToolContext,
    options: ToolExecutionOptions = {},
  ): Promise<TOutput> => {
    const tool = this.getOrThrow<TInput, TOutput>(toolId);
    const opts = { ...DEFAULT_OPTIONS, ...options };

    const event: ToolExecutionEvent = {
      toolId,
      toolName: tool.name,
      conversationId: context.conversationId,
      input,
      status: 'pending',
      startedAt: new Date(),
    };

    this.#emitEvent(event);

    // Validate input
    if (opts.validateInput) {
      const inputResult = tool.inputSchema.safeParse(input);
      if (!inputResult.success) {
        const zodError = inputResult.error;
        // Handle both Zod 3 and Zod 4 error formats
        const errors =
          'errors' in zodError && Array.isArray(zodError.errors)
            ? zodError.errors.map(
                (e: { path?: (string | number)[]; message?: string }) =>
                  `${(e.path ?? []).join('.')}: ${e.message ?? 'Unknown error'}`,
              )
            : ['Validation failed'];
        const error = new ToolInputValidationError(toolId, errors);
        this.#emitEvent({
          ...event,
          status: 'error',
          error: error.message,
          completedAt: new Date(),
          durationMs: Date.now() - event.startedAt.getTime(),
        });
        throw error;
      }
    }

    // Execute with timeout
    try {
      const result = await this.#executeWithTimeout(tool, input, context, opts.timeout);

      // Validate output
      if (opts.validateOutput) {
        const outputResult = tool.outputSchema.safeParse(result);
        if (!outputResult.success) {
          const zodError = outputResult.error;
          // Handle both Zod 3 and Zod 4 error formats
          const errors =
            'errors' in zodError && Array.isArray(zodError.errors)
              ? zodError.errors.map(
                  (e: { path?: (string | number)[]; message?: string }) =>
                    `${(e.path ?? []).join('.')}: ${e.message ?? 'Unknown error'}`,
                )
              : ['Validation failed'];
          throw new ToolOutputValidationError(toolId, errors);
        }
      }

      const completedAt = new Date();
      this.#emitEvent({
        ...event,
        status: 'success',
        output: result,
        completedAt,
        durationMs: completedAt.getTime() - event.startedAt.getTime(),
      });

      return result;
    } catch (error) {
      const completedAt = new Date();
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.#emitEvent({
        ...event,
        status: 'error',
        error: errorMessage,
        completedAt,
        durationMs: completedAt.getTime() - event.startedAt.getTime(),
      });

      // Re-throw validation and timeout errors as-is
      if (
        error instanceof ToolInputValidationError ||
        error instanceof ToolOutputValidationError ||
        error instanceof ToolTimeoutError
      ) {
        throw error;
      }

      throw new ToolExecutionError(toolId, errorMessage, error);
    }
  };

  /**
   * Executes a tool with a timeout.
   */
  #executeWithTimeout = async <TInput, TOutput>(
    tool: RegisteredTool<TInput, TOutput>,
    input: TInput,
    context: ToolContext,
    timeout: number,
  ): Promise<TOutput> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Create a combined abort signal if one was provided
    const combinedContext: ToolContext = {
      ...context,
      abortSignal: context.abortSignal
        ? this.#combineAbortSignals(context.abortSignal, controller.signal)
        : controller.signal,
    };

    try {
      const result = await Promise.race([
        tool.execute(input, combinedContext),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new ToolTimeoutError(tool.id, timeout));
          });
        }),
      ]);
      return result;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  /**
   * Combines two abort signals into one.
   */
  #combineAbortSignals = (signal1: AbortSignal, signal2: AbortSignal): AbortSignal => {
    const controller = new AbortController();

    const abort = (): void => controller.abort();

    if (signal1.aborted || signal2.aborted) {
      controller.abort();
    } else {
      signal1.addEventListener('abort', abort);
      signal2.addEventListener('abort', abort);
    }

    return controller.signal;
  };

  /**
   * Clears all registered tools.
   */
  clear = (): void => {
    this.#tools.clear();
  };
}

// Re-export types and schemas
export type { RiskLevel, RiskCategory, RiskProfile, ToolContext, ToolResult } from './tools.schemas.ts';
export type { ToolDefinition, RegisteredTool, ToolExecutionOptions, ToolExecutionEvent } from './tools.types.ts';
export {
  riskLevelSchema,
  riskCategorySchema,
  riskProfileSchema,
  toolContextSchema,
  toolResultSchema,
} from './tools.schemas.ts';
export {
  ToolNotFoundError,
  ToolAlreadyRegisteredError,
  ToolExecutionError,
  ToolInputValidationError,
  ToolOutputValidationError,
  ToolTimeoutError,
} from './tools.errors.ts';

export { ToolRegistry };
