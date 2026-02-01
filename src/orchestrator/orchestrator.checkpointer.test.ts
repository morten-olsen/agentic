import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { Services } from '../services/services.ts';
import { DatabaseService, createDatabaseService } from '../database/database.ts';

import { DatabaseCheckpointer } from './orchestrator.checkpointer.ts';

describe('DatabaseCheckpointer', () => {
  let services: Services;
  let checkpointer: DatabaseCheckpointer;

  beforeEach(async () => {
    services = new Services();
    const db = createDatabaseService(services, { path: ':memory:' });
    services.set(DatabaseService, db);
    await db.migrate();
    checkpointer = new DatabaseCheckpointer(db.knex);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('put and getTuple', () => {
    it('saves and retrieves a checkpoint', async () => {
      const threadId = uuidv4();
      const checkpointId = uuidv4();

      const config = { configurable: { thread_id: threadId } };
      const checkpoint = {
        id: checkpointId,
        v: 1,
        ts: new Date().toISOString(),
        channel_values: { messages: [] },
        channel_versions: {},
        versions_seen: {},
        pending_sends: [],
      };
      const metadata = { source: 'input' as const, step: 0, writes: {}, parents: {} };

      await checkpointer.put(config, checkpoint, metadata, {});

      const result = await checkpointer.getTuple(config);

      expect(result).toBeDefined();
      expect(result?.checkpoint.id).toBe(checkpointId);
      expect(result?.config.configurable?.thread_id).toBe(threadId);
      expect(result?.config.configurable?.checkpoint_id).toBe(checkpointId);
    });

    it('retrieves the latest checkpoint when no checkpoint_id specified', async () => {
      const threadId = uuidv4();
      const config = { configurable: { thread_id: threadId } };

      // Create two checkpoints
      const checkpoint1 = {
        id: uuidv4(),
        v: 1,
        ts: new Date().toISOString(),
        channel_values: { value: 'first' },
        channel_versions: {},
        versions_seen: {},
        pending_sends: [],
      };
      const checkpoint2 = {
        id: uuidv4(),
        v: 1,
        ts: new Date().toISOString(),
        channel_values: { value: 'second' },
        channel_versions: {},
        versions_seen: {},
        pending_sends: [],
      };
      const metadata = { source: 'input' as const, step: 0, writes: {}, parents: {} };

      await checkpointer.put(config, checkpoint1, metadata, {});
      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));
      await checkpointer.put(
        { configurable: { thread_id: threadId, checkpoint_id: checkpoint1.id } },
        checkpoint2,
        metadata,
        {},
      );

      const result = await checkpointer.getTuple(config);

      expect(result?.checkpoint.id).toBe(checkpoint2.id);
      expect(result?.parentConfig?.configurable?.checkpoint_id).toBe(checkpoint1.id);
    });

    it('returns undefined for non-existent thread', async () => {
      const config = { configurable: { thread_id: uuidv4() } };
      const result = await checkpointer.getTuple(config);
      expect(result).toBeUndefined();
    });

    it('returns undefined when no thread_id provided', async () => {
      const result = await checkpointer.getTuple({ configurable: {} });
      expect(result).toBeUndefined();
    });
  });

  describe('list', () => {
    it('lists checkpoints in reverse chronological order', async () => {
      const threadId = uuidv4();
      const config = { configurable: { thread_id: threadId } };
      const metadata = { source: 'input' as const, step: 0, writes: {}, parents: {} };

      // Create multiple checkpoints
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const checkpoint = {
          id: uuidv4(),
          v: 1,
          ts: new Date().toISOString(),
          channel_values: { step: i },
          channel_versions: {},
          versions_seen: {},
          pending_sends: [],
        };
        ids.push(checkpoint.id);
        await checkpointer.put(config, checkpoint, metadata, {});
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const results: string[] = [];
      for await (const tuple of checkpointer.list(config)) {
        results.push(tuple.checkpoint.id);
      }

      expect(results).toHaveLength(3);
      // Should be in reverse order (most recent first)
      expect(results[0]).toBe(ids[2]);
      expect(results[1]).toBe(ids[1]);
      expect(results[2]).toBe(ids[0]);
    });

    it('respects limit option', async () => {
      const threadId = uuidv4();
      const config = { configurable: { thread_id: threadId } };
      const metadata = { source: 'input' as const, step: 0, writes: {}, parents: {} };

      // Create multiple checkpoints
      for (let i = 0; i < 5; i++) {
        const checkpoint = {
          id: uuidv4(),
          v: 1,
          ts: new Date().toISOString(),
          channel_values: { step: i },
          channel_versions: {},
          versions_seen: {},
          pending_sends: [],
        };
        await checkpointer.put(config, checkpoint, metadata, {});
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const results: string[] = [];
      for await (const tuple of checkpointer.list(config, { limit: 2 })) {
        results.push(tuple.checkpoint.id);
      }

      expect(results).toHaveLength(2);
    });
  });

  describe('putWrites', () => {
    it('saves pending writes', async () => {
      const threadId = uuidv4();
      const checkpointId = uuidv4();

      const config = { configurable: { thread_id: threadId } };
      const checkpoint = {
        id: checkpointId,
        v: 1,
        ts: new Date().toISOString(),
        channel_values: {},
        channel_versions: {},
        versions_seen: {},
        pending_sends: [],
      };
      const metadata = { source: 'input' as const, step: 0, writes: {}, parents: {} };

      await checkpointer.put(config, checkpoint, metadata, {});

      const writes = [['channel1', 'value1']] as [string, unknown][];
      await checkpointer.putWrites(
        { configurable: { thread_id: threadId, checkpoint_id: checkpointId } },
        writes,
        'task1',
      );

      const result = await checkpointer.getTuple(config);
      expect(result?.pendingWrites).toBeDefined();
      expect(result?.pendingWrites).toHaveLength(1);
    });

    it('throws when checkpoint not found', async () => {
      const config = { configurable: { thread_id: uuidv4(), checkpoint_id: uuidv4() } };
      await expect(checkpointer.putWrites(config, [], 'task1')).rejects.toThrow('Checkpoint not found');
    });
  });

  describe('deleteThread', () => {
    it('deletes all checkpoints for a thread', async () => {
      const threadId = uuidv4();
      const config = { configurable: { thread_id: threadId } };
      const metadata = { source: 'input' as const, step: 0, writes: {}, parents: {} };

      // Create checkpoints
      for (let i = 0; i < 3; i++) {
        const checkpoint = {
          id: uuidv4(),
          v: 1,
          ts: new Date().toISOString(),
          channel_values: {},
          channel_versions: {},
          versions_seen: {},
          pending_sends: [],
        };
        await checkpointer.put(config, checkpoint, metadata, {});
      }

      await checkpointer.deleteThread(threadId);

      const result = await checkpointer.getTuple(config);
      expect(result).toBeUndefined();
    });
  });

  describe('getCheckpointIds', () => {
    it('returns checkpoint IDs in reverse chronological order', async () => {
      const threadId = uuidv4();
      const config = { configurable: { thread_id: threadId } };
      const metadata = { source: 'input' as const, step: 0, writes: {}, parents: {} };

      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const checkpoint = {
          id: uuidv4(),
          v: 1,
          ts: new Date().toISOString(),
          channel_values: {},
          channel_versions: {},
          versions_seen: {},
          pending_sends: [],
        };
        ids.push(checkpoint.id);
        await checkpointer.put(config, checkpoint, metadata, {});
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const result = await checkpointer.getCheckpointIds(threadId);

      expect(result).toHaveLength(3);
      expect(result[0]).toBe(ids[2]);
      expect(result[2]).toBe(ids[0]);
    });
  });
});
