import type { InterruptType, InterruptOption } from './interrupts.schemas.ts';

/**
 * Signal thrown by tools that need to interrupt execution for user input.
 * This is caught by the graph and converted into a proper interrupt.
 */
class InterruptSignal extends Error {
  readonly name = 'InterruptSignal';
  readonly type: InterruptType;
  readonly prompt: string;
  readonly context?: string;
  readonly options?: InterruptOption[];
  readonly allowFreeform: boolean;

  constructor(config: {
    type: InterruptType;
    prompt: string;
    context?: string;
    options?: InterruptOption[];
    allowFreeform?: boolean;
  }) {
    super(`Interrupt signal: ${config.prompt}`);
    this.type = config.type;
    this.prompt = config.prompt;
    this.context = config.context;
    this.options = config.options;
    this.allowFreeform = config.allowFreeform ?? true;
  }
}

/**
 * Type guard to check if an error is an InterruptSignal.
 */
const isInterruptSignal = (error: unknown): error is InterruptSignal => {
  return error instanceof Error && error.name === 'InterruptSignal';
};

export { InterruptSignal, isInterruptSignal };
