import * as readline from 'node:readline';

import type { Services } from '../../core/services/services.ts';
import { OrchestratorService } from '../../agent/orchestrator/orchestrator.ts';
import type { Interrupt } from '../../agent/orchestrator/orchestrator.ts';
import { PersonalityService } from '../../agent/personality/personality.ts';
import { getConfig } from '../../core/config/config.ts';

import {
  formatUserPrompt,
  formatAssistantName,
  formatSystem,
  formatError,
  formatSuccess,
  printSeparator,
  clearScreen,
  printBanner,
  printHelp,
  printApprovalPrompt,
  colorize,
} from './cli.utils.ts';

type ReplConfig = {
  services: Services;
};

/**
 * Interactive REPL for chatting with the agent.
 */
class Repl {
  #services: Services;
  #orchestrator: OrchestratorService;
  #rl: readline.Interface;
  #currentConversationId: string | null = null;
  #assistantName = 'GLaDOS';
  #running = false;
  #pendingInterrupt: Interrupt | null = null;

  constructor(config: ReplConfig) {
    this.#services = config.services;
    this.#orchestrator = new OrchestratorService(this.#services);
    this.#rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  /**
   * Starts the REPL.
   */
  start = async (): Promise<void> => {
    // Load configuration
    const appConfig = getConfig();

    // Load personality name
    const personality = this.#services.get(PersonalityService);
    const personalityConfig = await personality.getConfig();
    this.#assistantName = personalityConfig.name;

    // Configure orchestrator from config
    this.#orchestrator.configure({
      llm: {
        baseUrl: appConfig.llm.baseUrl,
        apiKey: appConfig.llm.apiKey,
        model: appConfig.llm.model,
        temperature: appConfig.llm.temperature,
        maxTokens: appConfig.llm.maxTokens,
      },
    });

    // Print welcome
    clearScreen();
    printBanner(this.#assistantName);
    console.log(formatSystem('Type a message to chat, or /help for commands.'));
    printSeparator();
    console.log();

    // Start a new conversation
    await this.#startNewConversation();

    // Main loop
    this.#running = true;
    await this.#loop();
  };

  /**
   * Stops the REPL.
   */
  stop = (): void => {
    this.#running = false;
    this.#rl.close();
    console.log();
    console.log(formatSuccess('Goodbye!'));
  };

  /**
   * Main input loop.
   */
  #loop = async (): Promise<void> => {
    while (this.#running) {
      const input = await this.#prompt();

      if (input === null) {
        // EOF (Ctrl+D)
        this.stop();
        break;
      }

      const trimmed = input.trim();
      if (!trimmed) continue;

      // Handle commands
      if (trimmed.startsWith('/')) {
        await this.#handleCommand(trimmed);
        continue;
      }

      // Send message to orchestrator
      await this.#chat(trimmed);
    }
  };

  /**
   * Prompts for user input.
   */
  #prompt = (): Promise<string | null> => {
    return new Promise((resolve) => {
      this.#rl.question(formatUserPrompt(), (answer) => {
        resolve(answer);
      });

      this.#rl.once('close', () => {
        resolve(null);
      });
    });
  };

  /**
   * Handles a command.
   */
  #handleCommand = async (input: string): Promise<void> => {
    const [command] = input.slice(1).split(' ');
    const cmd = command?.toLowerCase();

    switch (cmd) {
      case 'new':
        await this.#startNewConversation();
        break;

      case 'history':
        await this.#showHistory();
        break;

      case 'clear':
        clearScreen();
        printBanner(this.#assistantName);
        break;

      case 'help':
        printHelp();
        break;

      case 'quit':
      case 'exit':
        this.stop();
        break;

      default:
        console.log(formatError(`Unknown command: /${cmd}`));
        console.log(formatSystem('Type /help for available commands.'));
    }
  };

  /**
   * Starts a new conversation.
   */
  #startNewConversation = async (): Promise<void> => {
    this.#currentConversationId = await this.#orchestrator.startConversation();
    console.log(formatSystem(`Started new conversation.`));
    console.log();
  };

  /**
   * Shows the conversation history.
   */
  #showHistory = async (): Promise<void> => {
    if (!this.#currentConversationId) {
      console.log(formatSystem('No active conversation.'));
      return;
    }

    const history = await this.#orchestrator.getHistory(this.#currentConversationId);

    if (history.length === 0) {
      console.log(formatSystem('No messages in this conversation.'));
      return;
    }

    console.log();
    printSeparator();
    console.log(formatSystem('Conversation History:'));
    printSeparator();

    for (const message of history) {
      if (message.role === 'user') {
        console.log(formatUserPrompt() + message.content);
      } else if (message.role === 'assistant') {
        console.log(formatAssistantName(this.#assistantName) + message.content);
      }
    }

    printSeparator();
    console.log();
  };

  /**
   * Sends a message and displays the response.
   */
  #chat = async (message: string): Promise<void> => {
    if (!this.#currentConversationId) {
      await this.#startNewConversation();
    }

    // Check if we're responding to an interrupt
    if (!this.#pendingInterrupt) {
      process.stdout.write(formatAssistantName(this.#assistantName));
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      for await (const chunk of this.#orchestrator.chat(this.#currentConversationId!, message)) {
        switch (chunk.type) {
          case 'token':
            process.stdout.write(chunk.content);
            break;

          case 'tool_start':
            process.stdout.write(formatSystem(`\n[Using tool: ${chunk.name}]\n`));
            break;

          case 'tool_end':
            process.stdout.write(formatSystem(`[Tool complete]\n`));
            break;

          case 'done':
            process.stdout.write('\n\n');
            break;

          case 'error':
            console.log();
            console.log(formatError(chunk.error));
            break;

          case 'interrupt':
            await this.#handleInterrupt(chunk.interrupt);
            break;

          case 'interrupt_resolved':
            this.#pendingInterrupt = null;
            if (chunk.approved) {
              console.log(formatSystem('Tool execution approved.'));
            } else {
              console.log(formatSystem('Tool execution denied.'));
            }
            console.log();
            process.stdout.write(formatAssistantName(this.#assistantName));
            break;
        }
      }
    } catch (error) {
      console.log();
      console.log(formatError(error instanceof Error ? error.message : String(error)));
    }
  };

  /**
   * Handles an interrupt by displaying the approval prompt.
   */
  #handleInterrupt = async (interrupt: Interrupt): Promise<void> => {
    this.#pendingInterrupt = interrupt;

    // Display the approval prompt
    printApprovalPrompt(
      interrupt.prompt,
      interrupt.toolCall
        ? {
            toolName: interrupt.toolCall.toolName,
            riskLevel: interrupt.toolCall.riskLevel,
            riskReason: interrupt.toolCall.riskReason,
            input: interrupt.toolCall.input,
          }
        : undefined,
    );

    // Display options if available
    if (interrupt.options && interrupt.options.length > 0) {
      console.log('Options:');
      interrupt.options.forEach((opt, i) => {
        const marker = opt.isRecommended ? colorize('*', 'green') : ' ';
        console.log(`${marker} ${i + 1}. ${opt.label}`);
        if (opt.description) {
          console.log(colorize(`    ${opt.description}`, 'dim'));
        }
      });
      console.log();
    }

    // Show approval prompt for tool_approval type
    if (interrupt.type === 'tool_approval') {
      console.log(colorize('Respond with: y (yes) / n (no) / or type a message', 'cyan'));
    } else if (interrupt.allowFreeform) {
      console.log(colorize('Type your response:', 'cyan'));
    }
    console.log();
  };
}

export { Repl };
export type { ReplConfig };
