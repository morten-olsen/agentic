import { z } from 'zod';

import type { ToolDefinition, ToolContext } from '../tools.ts';
import { InterruptSignal } from '../../orchestrator/interrupts/interrupts.ts';

/**
 * Input schema for the ask user tool.
 */
const askUserInputSchema = z.object({
  question: z.string().describe('The question to ask the user'),
  context: z.string().optional().describe('Additional context to help the user understand the question'),
  options: z
    .array(
      z.object({
        id: z.string().describe('Unique identifier for this option'),
        label: z.string().describe('Display label for the option'),
        description: z.string().optional().describe('Additional description of what this option means'),
        isRecommended: z.boolean().optional().describe('Whether this is the recommended option'),
      }),
    )
    .optional()
    .describe('Predefined options for the user to choose from'),
  allowFreeform: z.boolean().optional().default(true).describe('Whether to allow free-form text responses'),
});

type AskUserInput = z.input<typeof askUserInputSchema>;

/**
 * Output schema for the ask user tool.
 * Note: This is returned after the interrupt is resolved.
 */
const askUserOutputSchema = z.object({
  response: z.string().describe('The user response text'),
  selectedOptionId: z.string().optional().describe('ID of the selected option if options were provided'),
});

type AskUserOutput = z.infer<typeof askUserOutputSchema>;

/**
 * Ask User tool - pauses execution to ask the user a question.
 *
 * This tool allows the agent to proactively request information from the user
 * when it needs clarification, wants to offer choices, or needs a decision
 * before proceeding.
 *
 * The tool throws an InterruptSignal which is caught by the graph and
 * converted into a proper interrupt. The graph halts until the user responds.
 */
const askUserTool: ToolDefinition<AskUserInput, AskUserOutput> = {
  id: 'builtin.ask_user',
  name: 'AskUser',
  description:
    'Pause and ask the user a question when you need clarification, want to offer choices, or need a decision. Use this when you are uncertain about how to proceed or want to give the user control over a decision.',
  category: 'builtin',
  inputSchema: askUserInputSchema,
  outputSchema: askUserOutputSchema,
  risk: {
    level: 'low',
    reason: 'Only pauses execution to ask the user a question',
    potentialImpact: 'None - just waits for user input',
    reversible: true,
    categories: [],
  },
  tags: ['system', 'interaction', 'question'],
  examples: [
    {
      input: {
        question: 'Which database would you prefer to use for this project?',
        options: [
          { id: 'postgres', label: 'PostgreSQL', description: 'Robust relational database', isRecommended: true },
          { id: 'mysql', label: 'MySQL', description: 'Popular relational database' },
          { id: 'sqlite', label: 'SQLite', description: 'Lightweight file-based database' },
        ],
      },
      description: 'Ask user to choose a database with predefined options',
    },
    {
      input: {
        question: 'What should the project be called?',
        context: 'This will be used for the package name and directory.',
        allowFreeform: true,
      },
      description: 'Ask user for a free-form text response',
    },
    {
      input: {
        question: 'I found multiple files that match. Which one should I modify?',
        options: [
          { id: 'src/config.ts', label: 'src/config.ts' },
          { id: 'src/utils/config.ts', label: 'src/utils/config.ts' },
        ],
        allowFreeform: false,
      },
      description: 'Ask user to select from a list without allowing free-form',
    },
  ],

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  execute: async (input: AskUserInput, _context: ToolContext): Promise<AskUserOutput> => {
    // This tool doesn't execute normally - it throws an InterruptSignal
    // which is caught by the graph and converted into an interrupt.
    //
    // The actual response will come from the interrupt resolution process,
    // not from this execute function.
    throw new InterruptSignal({
      type: 'question',
      prompt: input.question,
      context: input.context,
      options: input.options?.map((opt) => ({
        id: opt.id,
        label: opt.label,
        description: opt.description,
        isRecommended: opt.isRecommended,
      })),
      allowFreeform: input.allowFreeform ?? true,
    });
  },
};

export type { AskUserInput, AskUserOutput };
export { askUserTool, askUserInputSchema, askUserOutputSchema };
