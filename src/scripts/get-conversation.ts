#!/usr/bin/env node --experimental-strip-types

/**
 * Script to fetch and display conversation data for debugging.
 *
 * Usage:
 *   pnpm conversation <conversation-id>
 *
 * This script helps debug issues with conversations by displaying:
 * - Conversation metadata (title, timestamps, message count)
 * - All messages in chronological order
 * - Tool calls and their results
 * - Any pending interrupts
 */

import { Services } from '../services/services.ts';
import { DatabaseService, createDatabaseService } from '../database/database.ts';
import { loadConfig } from '../config/config.ts';
import { getConversation, getMessages } from '../orchestrator/orchestrator.store.ts';
import { getTelegramChatByConversation } from '../clients/telegram/telegram.store.ts';

/**
 * Formats a message for display.
 */
const formatMessage = (msg: {
  id: string;
  role: string;
  content: string;
  toolCallId?: string;
  toolCalls?: string;
  inputTokens?: number;
  outputTokens?: number;
  createdAt: string;
}): string => {
  const parts: string[] = [];

  // Header with role and timestamp
  const roleEmoji = msg.role === 'user' ? '👤' : msg.role === 'assistant' ? '🤖' : '🔧';
  parts.push(`${roleEmoji} [${msg.role.toUpperCase()}] ${msg.createdAt}`);
  parts.push(`   ID: ${msg.id}`);

  // Token usage for assistant messages
  if (msg.inputTokens || msg.outputTokens) {
    parts.push(`   Tokens: ${msg.inputTokens ?? 0} in / ${msg.outputTokens ?? 0} out`);
  }

  // Tool call ID for tool messages
  if (msg.toolCallId) {
    parts.push(`   Tool Call ID: ${msg.toolCallId}`);
  }

  // Content
  if (msg.content) {
    const contentLines = msg.content.split('\n');
    if (contentLines.length === 1 && msg.content.length < 100) {
      parts.push(`   Content: ${msg.content}`);
    } else {
      parts.push(`   Content:`);
      parts.push('   ---');
      for (const line of contentLines) {
        parts.push(`   ${line}`);
      }
      parts.push('   ---');
    }
  }

  // Tool calls
  if (msg.toolCalls) {
    try {
      const calls = JSON.parse(msg.toolCalls);
      parts.push(`   Tool Calls: ${JSON.stringify(calls, null, 2).split('\n').join('\n   ')}`);
    } catch {
      parts.push(`   Tool Calls (raw): ${msg.toolCalls}`);
    }
  }

  return parts.join('\n');
};

/**
 * Main entry point.
 */
const main = async (): Promise<void> => {
  const conversationId = process.argv[2];

  if (!conversationId) {
    console.error('Usage: pnpm conversation <conversation-id>');
    console.log();
    console.log('Get the conversation ID from Telegram using the /id command.');
    process.exit(1);
  }

  // Load configuration
  const config = loadConfig();

  // Initialize services
  const services = new Services();
  const db = createDatabaseService(services, { path: config.database.path });
  services.set(DatabaseService, db);

  // Run migrations to ensure schema exists
  await db.migrate();

  const knex = db.knex;

  try {
    // Fetch conversation
    const conversation = await getConversation(knex, conversationId);

    if (!conversation) {
      console.error(`Conversation not found: ${conversationId}`);
      process.exit(1);
    }

    console.log('='.repeat(80));
    console.log('CONVERSATION');
    console.log('='.repeat(80));
    console.log(`ID:            ${conversation.id}`);
    console.log(`Title:         ${conversation.title ?? '(none)'}`);
    console.log(`Started:       ${conversation.startedAt}`);
    console.log(`Last Activity: ${conversation.lastActivityAt}`);
    console.log(`Message Count: ${conversation.messageCount}`);

    // Check for Telegram mapping
    const telegramChat = await getTelegramChatByConversation(knex, conversationId);
    if (telegramChat) {
      console.log();
      console.log('Telegram Chat:');
      console.log(`  Chat ID:     ${telegramChat.telegramChatId}`);
      console.log(`  User ID:     ${telegramChat.telegramUserId}`);
      console.log(`  Created:     ${telegramChat.createdAt}`);
      console.log(`  Last Active: ${telegramChat.lastActivityAt}`);
    }

    // Fetch messages
    const messages = await getMessages(knex, conversationId);

    console.log();
    console.log('='.repeat(80));
    console.log(`MESSAGES (${messages.length})`);
    console.log('='.repeat(80));

    if (messages.length === 0) {
      console.log('(no messages)');
    } else {
      for (const msg of messages) {
        console.log();
        // Convert null to undefined for formatMessage
        console.log(
          formatMessage({
            ...msg,
            toolCallId: msg.toolCallId ?? undefined,
            toolCalls: msg.toolCalls ?? undefined,
            inputTokens: msg.inputTokens ?? undefined,
            outputTokens: msg.outputTokens ?? undefined,
          }),
        );
      }
    }

    // Check for pending interrupts
    const pendingInterrupts = await knex('interrupts')
      .where({ conversation_id: conversationId, status: 'pending' })
      .select('*');

    if (pendingInterrupts.length > 0) {
      console.log();
      console.log('='.repeat(80));
      console.log('PENDING INTERRUPTS');
      console.log('='.repeat(80));
      for (const interrupt of pendingInterrupts) {
        console.log();
        console.log(`ID:      ${interrupt.id}`);
        console.log(`Type:    ${interrupt.type}`);
        console.log(`Prompt:  ${interrupt.prompt}`);
        console.log(`Created: ${interrupt.created_at}`);
        if (interrupt.tool_call) {
          try {
            const toolCall = JSON.parse(interrupt.tool_call);
            console.log(`Tool:    ${JSON.stringify(toolCall, null, 2).split('\n').join('\n         ')}`);
          } catch {
            console.log(`Tool:    ${interrupt.tool_call}`);
          }
        }
      }
    }

    console.log();
  } finally {
    await services.destroy();
  }
};

// Run
main().catch((error) => {
  console.error('Error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
