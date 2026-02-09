import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import type { Conversation, Message, ConversationRow, MessageRow, MessageRole } from './orchestrator.schemas.ts';
import type { DatabaseCheckpointer } from './orchestrator.checkpointer.ts';

/**
 * Converts a database row to a Conversation.
 */
const rowToConversation = (row: ConversationRow): Conversation => ({
  id: row.id,
  title: row.title ?? undefined,
  summary: row.summary ?? undefined,
  startedAt: row.started_at,
  lastActivityAt: row.last_activity_at,
  messageCount: row.message_count,
  metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
});

/**
 * Converts a database row to a Message.
 */
const rowToMessage = (row: MessageRow): Message => ({
  id: row.id,
  conversationId: row.conversation_id,
  role: row.role as MessageRole,
  content: row.content,
  toolCallId: row.tool_call_id ?? undefined,
  toolCalls: row.tool_calls ?? undefined,
  inputTokens: row.input_tokens ?? undefined,
  outputTokens: row.output_tokens ?? undefined,
  createdAt: row.created_at,
});

/**
 * Creates a new conversation.
 */
const createConversation = async (
  db: Knex,
  options?: { title?: string; metadata?: Record<string, unknown> },
): Promise<Conversation> => {
  const id = uuidv4();
  const now = new Date().toISOString();

  const row: ConversationRow = {
    id,
    title: options?.title ?? null,
    summary: null,
    started_at: now,
    last_activity_at: now,
    message_count: 0,
    metadata: options?.metadata ? JSON.stringify(options.metadata) : null,
    created_at: now,
    updated_at: now,
  };

  await db<ConversationRow>('conversations').insert(row);

  return rowToConversation(row);
};

/**
 * Gets a conversation by ID.
 */
const getConversation = async (db: Knex, id: string): Promise<Conversation | null> => {
  const row = await db<ConversationRow>('conversations').where({ id }).first();
  return row ? rowToConversation(row) : null;
};

/**
 * Updates a conversation.
 */
const updateConversation = async (
  db: Knex,
  id: string,
  updates: Partial<{
    title: string | null;
    summary: string | null;
    messageCount: number;
    metadata: Record<string, unknown>;
  }>,
): Promise<Conversation | null> => {
  const now = new Date().toISOString();

  const updateData: Partial<ConversationRow> = {
    updated_at: now,
    last_activity_at: now,
  };

  if (updates.title !== undefined) updateData.title = updates.title;
  if (updates.summary !== undefined) updateData.summary = updates.summary;
  if (updates.messageCount !== undefined) updateData.message_count = updates.messageCount;
  if (updates.metadata !== undefined) updateData.metadata = JSON.stringify(updates.metadata);

  await db<ConversationRow>('conversations').where({ id }).update(updateData);

  return getConversation(db, id);
};

/**
 * Lists conversations, most recent first.
 */
const listConversations = async (db: Knex, options?: { limit?: number; offset?: number }): Promise<Conversation[]> => {
  let query = db<ConversationRow>('conversations').orderBy('last_activity_at', 'desc');

  if (options?.limit) query = query.limit(options.limit);
  if (options?.offset) query = query.offset(options.offset);

  const rows = await query;
  return rows.map(rowToConversation);
};

/**
 * Deletes a conversation and all its messages.
 */
const deleteConversation = async (db: Knex, id: string): Promise<boolean> => {
  const deleted = await db<ConversationRow>('conversations').where({ id }).delete();
  return deleted > 0;
};

/**
 * Adds a message to a conversation.
 */
const addMessage = async (
  db: Knex,
  conversationId: string,
  data: {
    role: MessageRole;
    content: string;
    toolCallId?: string;
    toolCalls?: string;
    inputTokens?: number;
    outputTokens?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<Message> => {
  const id = uuidv4();
  const now = new Date().toISOString();

  const row: MessageRow = {
    id,
    conversation_id: conversationId,
    role: data.role,
    content: data.content,
    tool_call_id: data.toolCallId ?? null,
    tool_calls: data.toolCalls ?? null,
    input_tokens: data.inputTokens ?? null,
    output_tokens: data.outputTokens ?? null,
    metadata: data.metadata ? JSON.stringify(data.metadata) : null,
    created_at: now,
  };

  await db<MessageRow>('messages').insert(row);

  // Update conversation message count and last activity
  await db<ConversationRow>('conversations')
    .where({ id: conversationId })
    .increment('message_count', 1)
    .update({ last_activity_at: now, updated_at: now });

  return rowToMessage(row);
};

/**
 * Gets messages for a conversation.
 */
const getMessages = async (
  db: Knex,
  conversationId: string,
  options?: { limit?: number; offset?: number },
): Promise<Message[]> => {
  let query = db<MessageRow>('messages').where({ conversation_id: conversationId }).orderBy('created_at', 'asc');

  if (options?.limit) query = query.limit(options.limit);
  if (options?.offset) query = query.offset(options.offset);

  const rows = await query;
  return rows.map(rowToMessage);
};

/**
 * Gets the most recent messages for a conversation.
 */
const getRecentMessages = async (db: Knex, conversationId: string, limit: number): Promise<Message[]> => {
  const rows = await db<MessageRow>('messages')
    .where({ conversation_id: conversationId })
    .orderBy('created_at', 'desc')
    .limit(limit);

  // Reverse to get chronological order
  return rows.reverse().map(rowToMessage);
};

/**
 * Service for managing conversations and messages.
 *
 * Encapsulates all conversation CRUD operations and provides a clean interface
 * for the orchestrator. Optionally integrates with the checkpointer to handle
 * cascade deletes of checkpoint data.
 */
class ConversationStore {
  #db: Knex;
  #checkpointer: DatabaseCheckpointer | null = null;

  constructor(db: Knex) {
    this.#db = db;
  }

  /**
   * Sets the checkpointer for cascade deletes.
   * When a conversation is deleted, its checkpoint thread will also be deleted.
   */
  setCheckpointer = (checkpointer: DatabaseCheckpointer): void => {
    this.#checkpointer = checkpointer;
  };

  /**
   * Creates a new conversation.
   */
  create = async (options?: { title?: string; metadata?: Record<string, unknown> }): Promise<Conversation> => {
    return createConversation(this.#db, options);
  };

  /**
   * Gets a conversation by ID.
   */
  get = async (id: string): Promise<Conversation | null> => {
    return getConversation(this.#db, id);
  };

  /**
   * Updates a conversation.
   */
  update = async (
    id: string,
    updates: Partial<{
      title: string | null;
      summary: string | null;
      messageCount: number;
      metadata: Record<string, unknown>;
    }>,
  ): Promise<Conversation | null> => {
    return updateConversation(this.#db, id, updates);
  };

  /**
   * Lists conversations, most recent first.
   */
  list = async (options?: { limit?: number; offset?: number }): Promise<Conversation[]> => {
    return listConversations(this.#db, options);
  };

  /**
   * Deletes a conversation and all its data.
   * If a checkpointer is set, also deletes the checkpoint thread.
   */
  delete = async (id: string): Promise<boolean> => {
    // Delete checkpoints first if checkpointer is available
    if (this.#checkpointer) {
      await this.#checkpointer.deleteThread(id);
    }
    // Delete conversation (cascades to messages via foreign key)
    return deleteConversation(this.#db, id);
  };

  /**
   * Adds a message to a conversation.
   */
  addMessage = async (
    conversationId: string,
    data: {
      role: MessageRole;
      content: string;
      toolCallId?: string;
      toolCalls?: string;
      inputTokens?: number;
      outputTokens?: number;
      metadata?: Record<string, unknown>;
    },
  ): Promise<Message> => {
    return addMessage(this.#db, conversationId, data);
  };

  /**
   * Gets messages for a conversation.
   */
  getMessages = async (conversationId: string, options?: { limit?: number; offset?: number }): Promise<Message[]> => {
    return getMessages(this.#db, conversationId, options);
  };

  /**
   * Gets the most recent messages for a conversation.
   */
  getRecentMessages = async (conversationId: string, limit: number): Promise<Message[]> => {
    return getRecentMessages(this.#db, conversationId, limit);
  };
}

export {
  ConversationStore,
  createConversation,
  getConversation,
  updateConversation,
  listConversations,
  deleteConversation,
  addMessage,
  getMessages,
  getRecentMessages,
  rowToConversation,
  rowToMessage,
};
