import { z } from 'zod';

import type { ToolDefinition, ToolContext } from '../tools.ts';

/**
 * Input schema for the echo tool.
 */
const echoInputSchema = z.object({
  message: z.string().describe('The message to echo back'),
  uppercase: z.boolean().optional().describe('Whether to convert to uppercase'),
});

type EchoInput = z.infer<typeof echoInputSchema>;

/**
 * Output schema for the echo tool.
 */
const echoOutputSchema = z.object({
  echoed: z.string(),
  timestamp: z.string(),
});

type EchoOutput = z.infer<typeof echoOutputSchema>;

/**
 * Echo tool - a simple test tool that echoes back a message.
 */
const echoTool: ToolDefinition<EchoInput, EchoOutput> = {
  id: 'builtin.echo',
  name: 'Echo',
  description: 'Echoes back the provided message. Useful for testing.',
  category: 'builtin',
  inputSchema: echoInputSchema,
  outputSchema: echoOutputSchema,
  risk: {
    level: 'low',
    reason: 'No side effects, only returns provided input',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['test', 'debug'],
  examples: [
    {
      input: { message: 'Hello, world!' },
      description: 'Simple echo',
    },
    {
      input: { message: 'hello', uppercase: true },
      description: 'Echo with uppercase conversion',
    },
  ],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  execute: async (input: EchoInput, _context: ToolContext): Promise<EchoOutput> => {
    const message = input.uppercase ? input.message.toUpperCase() : input.message;
    return {
      echoed: message,
      timestamp: new Date().toISOString(),
    };
  },
};

export type { EchoInput, EchoOutput };
export { echoTool, echoInputSchema, echoOutputSchema };
