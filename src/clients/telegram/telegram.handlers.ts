import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';

import type { Interrupt } from '../../orchestrator/orchestrator.ts';

/**
 * Sends a text message, splitting if necessary for Telegram's 4096 char limit.
 */
const sendLongMessage = async (ctx: Context, text: string): Promise<void> => {
  const MAX_LENGTH = 4000; // Leave some margin

  if (text.length <= MAX_LENGTH) {
    await ctx.reply(text);
    return;
  }

  // Split by paragraphs first, then by sentences if needed
  const chunks: string[] = [];
  let current = '';

  const paragraphs = text.split('\n\n');
  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length > MAX_LENGTH) {
      if (current) {
        chunks.push(current.trim());
      }
      // If single paragraph is too long, split by sentences
      if (para.length > MAX_LENGTH) {
        const sentences = para.match(/[^.!?]+[.!?]+/g) || [para];
        for (const sentence of sentences) {
          if ((current + sentence).length > MAX_LENGTH) {
            if (current) {
              chunks.push(current.trim());
            }
            current = sentence;
          } else {
            current += sentence;
          }
        }
      } else {
        current = para;
      }
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }

  if (current) {
    chunks.push(current.trim());
  }

  for (const chunk of chunks) {
    await ctx.reply(chunk);
  }
};

/**
 * Formats an interrupt as a message with inline keyboard.
 */
const formatInterruptMessage = (interrupt: Interrupt): { text: string; keyboard: InlineKeyboard } => {
  const parts: string[] = [];

  // Add tool info if present (plain text - no markdown to avoid parse errors)
  if (interrupt.type === 'tool_approval' && interrupt.toolCall) {
    const tool = interrupt.toolCall;
    parts.push(`🔧 Tool Request`);
    parts.push(`Tool: ${tool.toolName}`);
    parts.push(`Risk: ${tool.riskLevel}`);
    if (tool.riskReason) {
      parts.push(`Reason: ${tool.riskReason}`);
    }
    parts.push('');
  }

  // Add prompt
  parts.push(interrupt.prompt);

  // Build inline keyboard
  const keyboard = new InlineKeyboard();

  if (interrupt.type === 'tool_approval') {
    keyboard.text('✓ Approve', `approve:${interrupt.id}`).text('✗ Deny', `deny:${interrupt.id}`);
  } else if (interrupt.options && interrupt.options.length > 0) {
    // Add option buttons
    for (const opt of interrupt.options) {
      const label = opt.isRecommended ? `${opt.label} ★` : opt.label;
      keyboard.text(label, `option:${interrupt.id}:${opt.id}`).row();
    }
  }

  return {
    text: parts.join('\n'),
    keyboard,
  };
};

/**
 * Parses a callback query data string.
 */
const parseCallbackData = (
  data: string,
): { action: 'approve' | 'deny' | 'option'; interruptId: string; optionId?: string } | null => {
  const parts = data.split(':');

  if (parts[0] === 'approve' && parts[1]) {
    return { action: 'approve', interruptId: parts[1] };
  }

  if (parts[0] === 'deny' && parts[1]) {
    return { action: 'deny', interruptId: parts[1] };
  }

  if (parts[0] === 'option' && parts[1] && parts[2]) {
    return { action: 'option', interruptId: parts[1], optionId: parts[2] };
  }

  return null;
};

/**
 * Creates a welcome message for the /start command.
 */
const createWelcomeMessage = (assistantName: string): string => {
  return `👋 Hello! I'm *${assistantName}*, your personal AI assistant.

I can help you with various tasks - just send me a message and I'll do my best to assist.

*Commands:*
/new - Start a new conversation
/help - Show available commands

Let's get started! What can I help you with?`;
};

/**
 * Creates a help message.
 */
const createHelpMessage = (): string => {
  return `*Available Commands:*

/start - Welcome message
/new - Start a new conversation
/id - Show conversation ID (for debugging)
/debug - Export conversation as JSON file
/help - Show this help message

Just send me a text message to chat. I'll remember our conversation until you start a new one with /new.

When I need your approval for certain actions, I'll show you buttons to approve or deny.`;
};

/**
 * Creates an unauthorized message.
 */
const createUnauthorizedMessage = (): string => {
  return `⚠️ Sorry, I'm a personal assistant and I'm not configured to chat with you.

If you're the owner, please set the \`GLADOS_TELEGRAM_OWNER_ID\` environment variable to your Telegram user ID.

You can find your user ID by messaging @userinfobot on Telegram.`;
};

export {
  sendLongMessage,
  formatInterruptMessage,
  parseCallbackData,
  createWelcomeMessage,
  createHelpMessage,
  createUnauthorizedMessage,
};
