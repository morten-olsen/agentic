import type { Knex } from 'knex';
import type { RunnableConfig } from '@langchain/core/runnables';
import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
  type CheckpointListOptions,
  type ChannelVersions,
  type PendingWrite,
} from '@langchain/langgraph-checkpoint';

/**
 * Database row for checkpoints.
 */
type CheckpointRow = {
  conversation_id: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  state: string;
  metadata: string | null;
  pending_writes: string | null;
  created_at: string;
  updated_at: string | null;
};

/**
 * Custom checkpoint saver that persists to SQLite via Knex.
 * Enables resumable conversations across process restarts.
 */
class DatabaseCheckpointer extends BaseCheckpointSaver {
  #db: Knex;

  constructor(db: Knex) {
    super();
    this.#db = db;
  }

  /**
   * Extracts thread_id (conversation_id) from config.
   */
  #getThreadId = (config: RunnableConfig): string | undefined => {
    return config.configurable?.thread_id as string | undefined;
  };

  /**
   * Extracts checkpoint_id from config.
   */
  #getCheckpointId = (config: RunnableConfig): string | undefined => {
    return config.configurable?.checkpoint_id as string | undefined;
  };

  /**
   * Gets a checkpoint tuple by thread_id and optional checkpoint_id.
   */
  getTuple = async (config: RunnableConfig): Promise<CheckpointTuple | undefined> => {
    const threadId = this.#getThreadId(config);
    if (!threadId) return undefined;

    const checkpointId = this.#getCheckpointId(config);

    let query = this.#db<CheckpointRow>('checkpoints').where({ conversation_id: threadId });

    if (checkpointId) {
      query = query.where({ checkpoint_id: checkpointId });
    }

    const row = await query.orderBy('created_at', 'desc').first();

    if (!row) return undefined;

    const checkpoint = JSON.parse(row.state) as Checkpoint;
    const metadata = row.metadata ? (JSON.parse(row.metadata) as CheckpointMetadata) : undefined;

    const configWithId: RunnableConfig = {
      configurable: {
        ...config.configurable,
        thread_id: threadId,
        checkpoint_id: checkpoint.id,
      },
    };

    let parentConfig: RunnableConfig | undefined;
    if (row.parent_checkpoint_id) {
      parentConfig = {
        configurable: {
          thread_id: threadId,
          checkpoint_id: row.parent_checkpoint_id,
        },
      };
    }

    const pendingWrites = row.pending_writes ? JSON.parse(row.pending_writes) : undefined;

    return {
      config: configWithId,
      checkpoint,
      metadata,
      parentConfig,
      pendingWrites,
    };
  };

  /**
   * Lists checkpoints for a thread.
   */
  list = async function* (
    this: DatabaseCheckpointer,
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = this.#getThreadId(config);
    if (!threadId) return;

    let query = this.#db<CheckpointRow>('checkpoints')
      .where({ conversation_id: threadId })
      .orderBy('created_at', 'desc');

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    if (options?.before?.configurable?.checkpoint_id) {
      const beforeRow = await this.#db<CheckpointRow>('checkpoints')
        .where({
          conversation_id: threadId,
          checkpoint_id: options.before.configurable.checkpoint_id as string,
        })
        .first();
      if (beforeRow) {
        query = query.where('created_at', '<', beforeRow.created_at);
      }
    }

    const rows = await query;

    for (const row of rows) {
      const checkpoint = JSON.parse(row.state) as Checkpoint;
      const metadata = row.metadata ? (JSON.parse(row.metadata) as CheckpointMetadata) : undefined;

      const configWithId: RunnableConfig = {
        configurable: {
          thread_id: threadId,
          checkpoint_id: checkpoint.id,
        },
      };

      let parentConfig: RunnableConfig | undefined;
      if (row.parent_checkpoint_id) {
        parentConfig = {
          configurable: {
            thread_id: threadId,
            checkpoint_id: row.parent_checkpoint_id,
          },
        };
      }

      const pendingWrites = row.pending_writes ? JSON.parse(row.pending_writes) : undefined;

      yield {
        config: configWithId,
        checkpoint,
        metadata,
        parentConfig,
        pendingWrites,
      };
    }
  };

  /**
   * Saves a checkpoint.
   */
  put: (
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions: ChannelVersions,
  ) => Promise<RunnableConfig> = async (config, checkpoint, metadata) => {
    const threadId = this.#getThreadId(config);
    if (!threadId) {
      throw new Error('thread_id is required in config.configurable');
    }

    const parentCheckpointId = this.#getCheckpointId(config);
    const now = new Date().toISOString();

    await this.#db<CheckpointRow>('checkpoints')
      .insert({
        conversation_id: threadId,
        checkpoint_id: checkpoint.id,
        parent_checkpoint_id: parentCheckpointId ?? null,
        state: JSON.stringify(checkpoint),
        metadata: JSON.stringify(metadata),
        created_at: now,
        pending_writes: null,
        updated_at: null,
      })
      .onConflict(['conversation_id', 'checkpoint_id'])
      .merge({
        state: JSON.stringify(checkpoint),
        metadata: JSON.stringify(metadata),
        updated_at: now,
      });

    return {
      configurable: {
        ...config.configurable,
        thread_id: threadId,
        checkpoint_id: checkpoint.id,
      },
    };
  };

  /**
   * Saves pending writes for a checkpoint.
   */
  putWrites = async (config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> => {
    const threadId = this.#getThreadId(config);
    const checkpointId = this.#getCheckpointId(config);

    if (!threadId || !checkpointId) {
      throw new Error('thread_id and checkpoint_id are required in config.configurable');
    }

    const existingRow = await this.#db<CheckpointRow>('checkpoints')
      .where({ conversation_id: threadId, checkpoint_id: checkpointId })
      .first();

    if (!existingRow) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    const existingWrites = existingRow.pending_writes ? JSON.parse(existingRow.pending_writes) : [];
    const newWrites = writes.map((w) => [taskId, ...w]);
    const allWrites = [...existingWrites, ...newWrites];

    await this.#db<CheckpointRow>('checkpoints')
      .where({ conversation_id: threadId, checkpoint_id: checkpointId })
      .update({
        pending_writes: JSON.stringify(allWrites),
        updated_at: new Date().toISOString(),
      });
  };

  /**
   * Deletes all checkpoints for a thread (conversation).
   */
  deleteThread = async (threadId: string): Promise<void> => {
    await this.#db<CheckpointRow>('checkpoints').where({ conversation_id: threadId }).delete();
  };

  /**
   * Gets all checkpoint IDs for a thread.
   */
  getCheckpointIds = async (threadId: string): Promise<string[]> => {
    const rows = await this.#db<CheckpointRow>('checkpoints')
      .where({ conversation_id: threadId })
      .select('checkpoint_id')
      .orderBy('created_at', 'desc');

    return rows.map((r) => r.checkpoint_id);
  };
}

export type { CheckpointRow };
export { DatabaseCheckpointer };
