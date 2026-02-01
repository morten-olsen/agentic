import type { z } from 'zod';

import type { RiskProfile, ToolContext } from './tools.schemas.ts';

/**
 * A tool definition with strongly typed input/output.
 *
 * @template TInput - The input type (inferred from inputSchema)
 * @template TOutput - The output type (inferred from outputSchema)
 * @template TRawInput - The raw input type before transforms (defaults to TInput)
 *
 * Note: TRawInput is used for examples to allow providing input in its raw form
 * (before schema transforms). For schemas without transforms, TRawInput = TInput.
 */
type ToolDefinition<TInput = unknown, TOutput = unknown, TRawInput = TInput> = {
  /** Unique identifier for the tool */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what the tool does */
  description: string;
  /** Category for grouping (e.g., 'file', 'calendar', 'email') */
  category: string;
  /** Zod schema for validating input */
  inputSchema: z.ZodSchema<TInput>;
  /** Zod schema for validating output */
  outputSchema: z.ZodSchema<TOutput>;
  /** Risk profile for this tool */
  risk: RiskProfile;
  /** Function to execute the tool */
  execute: (input: TInput, context: ToolContext) => Promise<TOutput>;
  /** Tags for discovery and filtering */
  tags: string[];
  /** Usage examples - uses raw input type before transforms */
  examples: { input: TRawInput; description: string }[];
};

/**
 * A registered tool with metadata.
 */
type RegisteredTool<TInput = unknown, TOutput = unknown, TRawInput = TInput> = ToolDefinition<
  TInput,
  TOutput,
  TRawInput
> & {
  /** When the tool was registered */
  registeredAt: Date;
};

/**
 * Tool execution options.
 */
type ToolExecutionOptions = {
  /** Timeout in milliseconds */
  timeout?: number;
  /** Whether to validate input before execution */
  validateInput?: boolean;
  /** Whether to validate output after execution */
  validateOutput?: boolean;
};

/**
 * Tool execution event for logging/auditing.
 */
type ToolExecutionEvent = {
  toolId: string;
  toolName: string;
  conversationId: string;
  input: unknown;
  output?: unknown;
  error?: string;
  status: 'pending' | 'success' | 'error';
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
};

export type { ToolDefinition, RegisteredTool, ToolExecutionOptions, ToolExecutionEvent };
