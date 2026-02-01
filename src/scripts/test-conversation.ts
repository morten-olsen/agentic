#!/usr/bin/env node --experimental-strip-types

/**
 * Interactive script for testing conversations with the orchestrator.
 *
 * Usage:
 *   pnpm conversation:test <command> [args]
 *
 * Commands:
 *   new                     - Start a new conversation
 *   send <id> <message>     - Send a message to a conversation
 *   approve <interrupt-id>  - Approve a pending interrupt
 *   deny <interrupt-id>     - Deny a pending interrupt
 *   status <id>             - Show conversation status and pending interrupts
 */

import { Services } from '../services/services.ts';
import { DatabaseService, createDatabaseService } from '../database/database.ts';
import { UserModelService } from '../user-model/user-model.ts';
import { LocationService } from '../location/location.ts';
import { CalendarService } from '../calendar/calendar.ts';
import { ContactsService } from '../contacts/contacts.ts';
import { ContextBuilderService } from '../context/context.ts';
import { PersonalityService } from '../personality/personality.ts';
import { MemoryService } from '../memory/memory.ts';
import { loadConfig } from '../config/config.ts';
import { OrchestratorService } from '../orchestrator/orchestrator.ts';
import type { ChatChunk } from '../orchestrator/orchestrator.ts';

/**
 * Initialize services.
 */
const initServices = async () => {
  const config = loadConfig();

  if (!config.llm.apiKey) {
    console.error('Error: GLADOS_LLM_API_KEY environment variable is required');
    process.exit(1);
  }

  const services = new Services();
  const db = createDatabaseService(services, { path: config.database.path });
  services.set(DatabaseService, db);
  await db.migrate();

  // Initialize required services
  services.get(UserModelService);
  services.get(LocationService);
  services.get(CalendarService);
  services.get(ContactsService);
  services.get(ContextBuilderService);
  services.get(PersonalityService);
  services.get(MemoryService);

  // Create and configure orchestrator
  const orchestrator = new OrchestratorService(services);
  orchestrator.configure({
    llm: {
      baseUrl: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
      model: config.llm.model,
      temperature: config.llm.temperature,
      maxTokens: config.llm.maxTokens,
    },
  });

  return { services, orchestrator, config };
};

/**
 * Process and display chat chunks.
 */
const processChunks = async (chunks: AsyncGenerator<ChatChunk>): Promise<void> => {
  let responseBuffer = '';

  for await (const chunk of chunks) {
    switch (chunk.type) {
      case 'token':
        responseBuffer += chunk.content;
        break;

      case 'tool_start':
        console.log(`\n[TOOL START] ${chunk.name}`);
        console.log(`  Args: ${JSON.stringify(chunk.args)}`);
        break;

      case 'interrupt':
        console.log('\n[INTERRUPT CREATED]');
        console.log(`  ID: ${chunk.interrupt.id}`);
        console.log(`  Type: ${chunk.interrupt.type}`);
        console.log(`  Prompt: ${chunk.interrupt.prompt}`);
        if (chunk.interrupt.toolCall) {
          console.log(`  Tool: ${chunk.interrupt.toolCall.toolName}`);
          console.log(`  Risk: ${chunk.interrupt.toolCall.riskLevel}`);
          console.log(`  Input: ${JSON.stringify(chunk.interrupt.toolCall.input)}`);
        }
        console.log('\nTo approve: pnpm conversation:test approve ' + chunk.interrupt.id);
        console.log('To deny: pnpm conversation:test deny ' + chunk.interrupt.id);
        break;

      case 'interrupt_resolved':
        console.log(`\n[INTERRUPT RESOLVED] ${chunk.approved ? 'APPROVED' : 'DENIED'}`);
        break;

      case 'done':
        if (responseBuffer.trim()) {
          console.log('\n[ASSISTANT RESPONSE]');
          console.log(responseBuffer);
        }
        if (chunk.inputTokens || chunk.outputTokens) {
          console.log(`\n[TOKENS] ${chunk.inputTokens ?? 0} in / ${chunk.outputTokens ?? 0} out`);
        }
        responseBuffer = '';
        break;

      case 'error':
        console.error(`\n[ERROR] ${chunk.error}`);
        break;
    }
  }
};

/**
 * Command: new - Start a new conversation
 */
const cmdNew = async () => {
  const { services, orchestrator } = await initServices();

  try {
    const conversationId = await orchestrator.startConversation({
      title: 'Test Conversation',
    });

    console.log('Created new conversation:');
    console.log(`  ID: ${conversationId}`);
    console.log('\nTo send a message:');
    console.log(`  pnpm conversation:test send ${conversationId} "your message here"`);
  } finally {
    await services.destroy();
  }
};

/**
 * Command: send - Send a message to a conversation
 */
const cmdSend = async (conversationId: string, message: string) => {
  const { services, orchestrator } = await initServices();

  try {
    console.log(`[USER] ${message}`);
    console.log('\nProcessing...');

    await processChunks(orchestrator.chat(conversationId, message));
  } finally {
    await services.destroy();
  }
};

/**
 * Command: approve - Approve a pending interrupt
 */
const cmdApprove = async (interruptId: string) => {
  const { services, orchestrator } = await initServices();

  try {
    console.log(`Approving interrupt: ${interruptId}`);
    console.log('\nProcessing...');

    await processChunks(orchestrator.respondToInterrupt(interruptId, { approved: true }));
  } finally {
    await services.destroy();
  }
};

/**
 * Command: deny - Deny a pending interrupt
 */
const cmdDeny = async (interruptId: string) => {
  const { services, orchestrator } = await initServices();

  try {
    console.log(`Denying interrupt: ${interruptId}`);
    console.log('\nProcessing...');

    await processChunks(orchestrator.respondToInterrupt(interruptId, { approved: false }));
  } finally {
    await services.destroy();
  }
};

/**
 * Command: status - Show conversation status
 */
const cmdStatus = async (conversationId: string) => {
  const { services, orchestrator } = await initServices();
  const knex = services.get(DatabaseService).knex;

  try {
    const conversation = await orchestrator.getConversation(conversationId);
    if (!conversation) {
      console.error(`Conversation not found: ${conversationId}`);
      process.exit(1);
    }

    console.log('=== CONVERSATION ===');
    console.log(`ID: ${conversation.id}`);
    console.log(`Title: ${conversation.title ?? '(none)'}`);
    console.log(`Messages: ${conversation.messageCount}`);
    console.log(`Last Activity: ${conversation.lastActivityAt}`);

    // Check for pending interrupts
    const pendingInterrupts = await knex('interrupts')
      .where({ conversation_id: conversationId, status: 'pending' })
      .select('*');

    if (pendingInterrupts.length > 0) {
      console.log('\n=== PENDING INTERRUPTS ===');
      for (const interrupt of pendingInterrupts) {
        console.log(`\nID: ${interrupt.id}`);
        console.log(`Type: ${interrupt.type}`);
        console.log(`Prompt: ${interrupt.prompt}`);
        if (interrupt.tool_call) {
          const toolCall = JSON.parse(interrupt.tool_call);
          console.log(`Tool: ${toolCall.toolName} (${toolCall.riskLevel})`);
        }
      }
    } else {
      console.log('\nNo pending interrupts.');
    }

    console.log('\nTo send a message:');
    console.log(`  pnpm conversation:test send ${conversationId} "your message"`);
  } finally {
    await services.destroy();
  }
};

/**
 * Main entry point.
 */
const main = async (): Promise<void> => {
  const [command, ...args] = process.argv.slice(2);

  if (!command) {
    console.log('Usage: pnpm conversation:test <command> [args]');
    console.log();
    console.log('Commands:');
    console.log('  new                     - Start a new conversation');
    console.log('  send <id> <message>     - Send a message to a conversation');
    console.log('  approve <interrupt-id>  - Approve a pending interrupt');
    console.log('  deny <interrupt-id>     - Deny a pending interrupt');
    console.log('  status <id>             - Show conversation status');
    process.exit(1);
  }

  switch (command) {
    case 'new':
      await cmdNew();
      break;

    case 'send':
      if (args.length < 2) {
        console.error('Usage: pnpm conversation:test send <conversation-id> <message>');
        process.exit(1);
      }
      await cmdSend(args[0], args.slice(1).join(' '));
      break;

    case 'approve':
      if (args.length < 1) {
        console.error('Usage: pnpm conversation:test approve <interrupt-id>');
        process.exit(1);
      }
      await cmdApprove(args[0]);
      break;

    case 'deny':
      if (args.length < 1) {
        console.error('Usage: pnpm conversation:test deny <interrupt-id>');
        process.exit(1);
      }
      await cmdDeny(args[0]);
      break;

    case 'status':
      if (args.length < 1) {
        console.error('Usage: pnpm conversation:test status <conversation-id>');
        process.exit(1);
      }
      await cmdStatus(args[0]);
      break;

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
};

// Run
main().catch((error) => {
  console.error('Error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
