import { describe, it, beforeEach, afterEach, expect } from 'vitest';

import { Services } from '../../core/services/services.ts';
import { DatabaseService, createDatabaseService } from '../../core/database/database.ts';

import { EventService, EventEmissionError } from './events.ts';
import type { EmitEventInput } from './events.ts';
import {
  emitEvent,
  emitEvents,
  queryEvents,
  getEvent,
  getCheckpoint,
  setCheckpoint,
  deleteCheckpoint,
  cleanupEvents,
  countEvents,
  countEventsByDomain,
  generateContentHash,
  convertWildcardToLike,
} from './events.store.ts';
import { eventSchema, emitEventInputSchema, eventQueryFilterSchema } from './events.schemas.ts';

// ============================================================================
// Test Setup
// ============================================================================

const createTestServices = async (): Promise<Services> => {
  const services = new Services();
  const db = createDatabaseService(services, { path: ':memory:' });
  services.set(DatabaseService, db);
  await db.migrate();
  return services;
};

// ============================================================================
// Schema Tests
// ============================================================================

describe('Event Schemas', () => {
  describe('eventSchema', () => {
    it('parses a valid event', () => {
      const event = eventSchema.parse({
        id: 'test-id',
        type: 'calendar.event.created',
        timestamp: '2024-03-15T10:00:00Z',
        source: 'calendar-service',
        data: { title: 'Meeting' },
        createdAt: '2024-03-15T10:00:00Z',
      });

      expect(event.id).toBe('test-id');
      expect(event.type).toBe('calendar.event.created');
      expect(event.data).toEqual({ title: 'Meeting' });
    });

    it('allows optional fields', () => {
      const event = eventSchema.parse({
        id: 'test-id',
        type: 'health.sleep.logged',
        timestamp: '2024-03-15T10:00:00Z',
        source: 'apple-health',
        data: {},
        createdAt: '2024-03-15T10:00:00Z',
      });

      expect(event.summary).toBeUndefined();
      expect(event.entityId).toBeUndefined();
      expect(event.conversationId).toBeUndefined();
    });
  });

  describe('emitEventInputSchema', () => {
    it('validates valid input', () => {
      const input = emitEventInputSchema.parse({
        type: 'calendar.event.created',
        source: 'calendar-service',
        summary: 'Meeting created',
        data: { title: 'Standup' },
      });

      expect(input.type).toBe('calendar.event.created');
      expect(input.source).toBe('calendar-service');
    });

    it('provides default empty data', () => {
      const input = emitEventInputSchema.parse({
        type: 'system.trigger.fired',
        source: 'trigger-service',
      });

      expect(input.data).toEqual({});
    });

    it('rejects empty type', () => {
      expect(() =>
        emitEventInputSchema.parse({
          type: '',
          source: 'test',
        }),
      ).toThrow();
    });

    it('rejects empty source', () => {
      expect(() =>
        emitEventInputSchema.parse({
          type: 'test.event',
          source: '',
        }),
      ).toThrow();
    });
  });

  describe('eventQueryFilterSchema', () => {
    it('provides default pagination', () => {
      const filter = eventQueryFilterSchema.parse({});

      expect(filter.limit).toBe(100);
      expect(filter.offset).toBe(0);
    });

    it('accepts type wildcards', () => {
      const filter = eventQueryFilterSchema.parse({
        types: ['calendar.*', 'tasks.task.completed'],
      });

      expect(filter.types).toEqual(['calendar.*', 'tasks.task.completed']);
    });
  });
});

// ============================================================================
// Helper Tests
// ============================================================================

describe('Event Helpers', () => {
  describe('generateContentHash', () => {
    it('generates consistent hash for same content', () => {
      const input: EmitEventInput = {
        type: 'test.event',
        source: 'test',
        timestamp: '2024-03-15T10:00:00Z',
        entityId: 'entity-1',
        data: { foo: 'bar' },
      };

      const hash1 = generateContentHash(input);
      const hash2 = generateContentHash(input);

      expect(hash1).toBe(hash2);
    });

    it('generates different hash for different content', () => {
      const input1: EmitEventInput = {
        type: 'test.event',
        source: 'test',
        data: { foo: 'bar' },
      };

      const input2: EmitEventInput = {
        type: 'test.event',
        source: 'test',
        data: { foo: 'baz' },
      };

      const hash1 = generateContentHash(input1);
      const hash2 = generateContentHash(input2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('convertWildcardToLike', () => {
    it('converts wildcard pattern to LIKE', () => {
      const result = convertWildcardToLike('calendar.*');

      expect(result.pattern).toBe('calendar.%');
      expect(result.isWildcard).toBe(true);
    });

    it('leaves exact patterns unchanged', () => {
      const result = convertWildcardToLike('tasks.task.completed');

      expect(result.pattern).toBe('tasks.task.completed');
      expect(result.isWildcard).toBe(false);
    });

    it('handles multi-level wildcards', () => {
      const result = convertWildcardToLike('calendar.event.*');

      expect(result.pattern).toBe('calendar.event.%');
      expect(result.isWildcard).toBe(true);
    });
  });
});

// ============================================================================
// Event Store Tests
// ============================================================================

describe('Event Store', () => {
  let services: Services;

  beforeEach(async () => {
    services = await createTestServices();
  });

  afterEach(async () => {
    await services.destroy();
  });

  const db = () => services.get(DatabaseService).knex;

  describe('Event Emission', () => {
    it('emits an event', async () => {
      const result = await emitEvent(db(), {
        type: 'calendar.event.created',
        source: 'calendar-service',
        summary: 'Meeting created',
        data: { title: 'Standup' },
      });

      expect(result.status).toBe('created');
      expect(result.event).not.toBeNull();
      expect(result.event?.type).toBe('calendar.event.created');
    });

    it('generates timestamp if not provided', async () => {
      const before = new Date().toISOString();

      const result = await emitEvent(db(), {
        type: 'test.event',
        source: 'test',
      });

      const after = new Date().toISOString();

      expect(result.event?.timestamp).toBeDefined();
      const timestamp = result.event?.timestamp ?? '';
      expect(timestamp >= before).toBe(true);
      expect(timestamp <= after).toBe(true);
    });

    it('skips duplicate event by externalId with same content', async () => {
      await emitEvent(db(), {
        type: 'calendar.event.created',
        source: 'calendar-service',
        externalId: 'event-123',
        data: { title: 'Meeting' },
      });

      const result = await emitEvent(db(), {
        type: 'calendar.event.created',
        source: 'calendar-service',
        externalId: 'event-123',
        data: { title: 'Meeting' },
      });

      expect(result.status).toBe('skipped');
      expect(result.event).toBeNull();
    });

    it('errors on duplicate externalId with different content', async () => {
      await emitEvent(db(), {
        type: 'calendar.event.created',
        source: 'calendar-service',
        externalId: 'event-123',
        data: { title: 'Original' },
      });

      const result = await emitEvent(db(), {
        type: 'calendar.event.created',
        source: 'calendar-service',
        externalId: 'event-123',
        data: { title: 'Changed' },
      });

      expect(result.status).toBe('error');
      expect(result.error).toContain('different content');
    });

    it('allows same externalId from different sources', async () => {
      await emitEvent(db(), {
        type: 'calendar.event.created',
        source: 'source-a',
        externalId: 'event-123',
        data: { title: 'From A' },
      });

      const result = await emitEvent(db(), {
        type: 'calendar.event.created',
        source: 'source-b',
        externalId: 'event-123',
        data: { title: 'From B' },
      });

      expect(result.status).toBe('created');
    });

    it('skips duplicate by content hash within time window', async () => {
      const timestamp = new Date().toISOString();

      await emitEvent(db(), {
        type: 'test.event',
        source: 'test',
        timestamp,
        entityId: 'entity-1',
        data: { foo: 'bar' },
      });

      const result = await emitEvent(db(), {
        type: 'test.event',
        source: 'test',
        timestamp,
        entityId: 'entity-1',
        data: { foo: 'bar' },
      });

      expect(result.status).toBe('skipped');
    });

    it('emits multiple events in batch', async () => {
      const results = await emitEvents(db(), [
        { type: 'event.one', source: 'test', data: {} },
        { type: 'event.two', source: 'test', data: {} },
        { type: 'event.three', source: 'test', data: {} },
      ]);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.status === 'created')).toBe(true);
    });

    it('stores entity and conversation references', async () => {
      const result = await emitEvent(db(), {
        type: 'tasks.task.completed',
        source: 'task-service',
        entityId: 'task-456',
        entityType: 'task',
        conversationId: 'conv-789',
        messageId: 'msg-012',
        data: {},
      });

      expect(result.event?.entityId).toBe('task-456');
      expect(result.event?.entityType).toBe('task');
      expect(result.event?.conversationId).toBe('conv-789');
      expect(result.event?.messageId).toBe('msg-012');
    });
  });

  describe('Event Queries', () => {
    beforeEach(async () => {
      // Create test events with different timestamps
      const baseTime = new Date('2024-03-15T10:00:00Z');

      await emitEvent(db(), {
        type: 'calendar.event.created',
        source: 'calendar-service',
        timestamp: new Date(baseTime.getTime()).toISOString(),
        externalId: 'cal-1',
        data: { title: 'Meeting 1' },
      });

      await emitEvent(db(), {
        type: 'calendar.event.updated',
        source: 'calendar-service',
        timestamp: new Date(baseTime.getTime() + 1000).toISOString(),
        externalId: 'cal-2',
        data: { title: 'Meeting 2' },
      });

      await emitEvent(db(), {
        type: 'tasks.task.completed',
        source: 'task-service',
        timestamp: new Date(baseTime.getTime() + 2000).toISOString(),
        externalId: 'task-1',
        entityId: 'task-123',
        entityType: 'task',
        data: { title: 'Task 1' },
      });

      await emitEvent(db(), {
        type: 'system.trigger.fired',
        source: 'trigger-service',
        timestamp: new Date(baseTime.getTime() + 3000).toISOString(),
        externalId: 'trigger-1',
        data: { triggerId: 'trig-1' },
      });
    });

    it('queries all events', async () => {
      const result = await queryEvents(db(), {});

      expect(result.events.length).toBeGreaterThanOrEqual(4);
      expect(result.total).toBeGreaterThanOrEqual(4);
    });

    it('queries events by time range', async () => {
      const result = await queryEvents(db(), {
        since: '2024-03-15T10:00:00.500Z',
        until: '2024-03-15T10:00:01.500Z',
      });

      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe('calendar.event.updated');
    });

    it('queries events by type wildcard', async () => {
      const result = await queryEvents(db(), {
        types: ['calendar.*'],
      });

      expect(result.events).toHaveLength(2);
      expect(result.events.every((e) => e.type.startsWith('calendar.'))).toBe(true);
    });

    it('queries events by exact type', async () => {
      const result = await queryEvents(db(), {
        types: ['tasks.task.completed'],
      });

      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe('tasks.task.completed');
    });

    it('queries events by multiple type patterns', async () => {
      const result = await queryEvents(db(), {
        types: ['calendar.*', 'system.*'],
      });

      expect(result.events).toHaveLength(3);
    });

    it('queries events by entity', async () => {
      const result = await queryEvents(db(), {
        entityId: 'task-123',
        entityType: 'task',
      });

      expect(result.events).toHaveLength(1);
      expect(result.events[0].entityId).toBe('task-123');
    });

    it('paginates results', async () => {
      const page1 = await queryEvents(db(), { limit: 2, offset: 0 });
      const page2 = await queryEvents(db(), { limit: 2, offset: 2 });

      expect(page1.events).toHaveLength(2);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextOffset).toBe(2);

      expect(page2.events).toHaveLength(2);
      // Events should be different
      expect(page1.events[0].id).not.toBe(page2.events[0].id);
    });

    it('returns events in descending timestamp order', async () => {
      const result = await queryEvents(db(), {});

      for (let i = 1; i < result.events.length; i++) {
        expect(result.events[i - 1].timestamp >= result.events[i].timestamp).toBe(true);
      }
    });

    it('gets a single event by ID', async () => {
      const emitted = await emitEvent(db(), {
        type: 'test.event',
        source: 'test',
        externalId: 'unique-event',
        data: {},
      });

      const eventId = emitted.event?.id ?? '';
      const event = await getEvent(db(), eventId);

      expect(event).not.toBeNull();
      expect(event?.id).toBe(eventId);
    });

    it('returns null for non-existent event', async () => {
      const event = await getEvent(db(), 'non-existent-id');

      expect(event).toBeNull();
    });

    it('queries events since another event ID', async () => {
      // Get the first event
      const all = await queryEvents(db(), {});
      const oldestEvent = all.events[all.events.length - 1];

      // Query events since that event
      const result = await queryEvents(db(), {
        since: oldestEvent.id,
      });

      // Should return all events after the oldest one
      expect(result.events.length).toBe(all.events.length - 1);
      expect(result.events.every((e) => e.timestamp > oldestEvent.timestamp)).toBe(true);
    });
  });

  describe('Checkpoints', () => {
    it('sets and gets a checkpoint', async () => {
      await setCheckpoint(db(), 'test-task', 'event-123');

      const checkpoint = await getCheckpoint(db(), 'test-task');

      expect(checkpoint).toBe('event-123');
    });

    it('returns null for non-existent checkpoint', async () => {
      const checkpoint = await getCheckpoint(db(), 'non-existent');

      expect(checkpoint).toBeNull();
    });

    it('updates existing checkpoint', async () => {
      await setCheckpoint(db(), 'test-task', 'event-1');
      await setCheckpoint(db(), 'test-task', 'event-2');

      const checkpoint = await getCheckpoint(db(), 'test-task');

      expect(checkpoint).toBe('event-2');
    });

    it('deletes a checkpoint', async () => {
      await setCheckpoint(db(), 'test-task', 'event-123');

      const deleted = await deleteCheckpoint(db(), 'test-task');
      expect(deleted).toBe(true);

      const checkpoint = await getCheckpoint(db(), 'test-task');
      expect(checkpoint).toBeNull();
    });

    it('returns false when deleting non-existent checkpoint', async () => {
      const deleted = await deleteCheckpoint(db(), 'non-existent');

      expect(deleted).toBe(false);
    });
  });

  describe('Cleanup', () => {
    it('deletes events older than retention period', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 60); // 60 days ago

      await emitEvent(db(), {
        type: 'old.event',
        source: 'test',
        timestamp: oldDate.toISOString(),
        externalId: 'old-event',
        data: {},
      });

      await emitEvent(db(), {
        type: 'new.event',
        source: 'test',
        externalId: 'new-event',
        data: {},
      });

      const deleted = await cleanupEvents(db(), 30);

      expect(deleted).toBe(1);

      const remaining = await countEvents(db());
      expect(remaining).toBe(1);
    });

    it('counts events', async () => {
      const initial = await countEvents(db());

      await emitEvent(db(), { type: 'test.one', source: 'test', externalId: 'e1', data: {} });
      await emitEvent(db(), { type: 'test.two', source: 'test', externalId: 'e2', data: {} });

      const after = await countEvents(db());

      expect(after).toBe(initial + 2);
    });

    it('counts events by domain', async () => {
      await emitEvent(db(), { type: 'calendar.event.created', source: 'test', externalId: 'c1', data: {} });
      await emitEvent(db(), { type: 'calendar.event.updated', source: 'test', externalId: 'c2', data: {} });
      await emitEvent(db(), { type: 'tasks.task.completed', source: 'test', externalId: 't1', data: {} });

      const counts = await countEventsByDomain(db());

      expect(counts['calendar']).toBe(2);
      expect(counts['tasks']).toBe(1);
    });
  });
});

// ============================================================================
// EventService Tests
// ============================================================================

describe('EventService', () => {
  let services: Services;
  let eventService: EventService;

  beforeEach(async () => {
    services = await createTestServices();
    eventService = new EventService(services);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('Event Emission', () => {
    it('emits an event', async () => {
      const event = await eventService.emit({
        type: 'calendar.event.created',
        source: 'calendar-service',
        summary: 'Meeting created',
        data: { title: 'Standup' },
      });

      expect(event).not.toBeNull();
      expect(event?.type).toBe('calendar.event.created');
    });

    it('returns null for skipped duplicates', async () => {
      await eventService.emit({
        type: 'test.event',
        source: 'test',
        externalId: 'dup-1',
        data: {},
      });

      const duplicate = await eventService.emit({
        type: 'test.event',
        source: 'test',
        externalId: 'dup-1',
        data: {},
      });

      expect(duplicate).toBeNull();
    });

    it('throws EventEmissionError for conflicting events', async () => {
      await eventService.emit({
        type: 'test.event',
        source: 'test',
        externalId: 'conflict-1',
        data: { version: 1 },
      });

      await expect(
        eventService.emit({
          type: 'test.event',
          source: 'test',
          externalId: 'conflict-1',
          data: { version: 2 },
        }),
      ).rejects.toThrow(EventEmissionError);
    });

    it('emits batch of events', async () => {
      const events = await eventService.emitBatch([
        { type: 'batch.one', source: 'test', data: {} },
        { type: 'batch.two', source: 'test', data: {} },
      ]);

      expect(events).toHaveLength(2);
      expect(events.filter((e) => e !== null)).toHaveLength(2);
    });
  });

  describe('Event Queries', () => {
    beforeEach(async () => {
      await eventService.emit({
        type: 'calendar.event.created',
        source: 'calendar-service',
        externalId: 'cal-1',
        data: {},
      });
      await eventService.emit({
        type: 'tasks.task.completed',
        source: 'task-service',
        externalId: 'task-1',
        data: {},
      });
    });

    it('queries events with filters', async () => {
      const result = await eventService.query({
        types: ['calendar.*'],
      });

      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe('calendar.event.created');
    });

    it('gets event by ID', async () => {
      const emitted = await eventService.emit({
        type: 'test.event',
        source: 'test',
        externalId: 'get-test',
        data: {},
      });

      const emittedId = emitted?.id ?? '';
      const event = await eventService.get(emittedId);

      expect(event).not.toBeNull();
      expect(event?.id).toBe(emittedId);
    });

    it('gets events since an event ID', async () => {
      const first = await eventService.emit({
        type: 'first.event',
        source: 'test',
        externalId: 'first',
        timestamp: '2024-06-01T10:00:00Z',
        data: {},
      });

      await eventService.emit({
        type: 'second.event',
        source: 'test',
        externalId: 'second',
        timestamp: '2024-06-01T10:00:01Z',
        data: {},
      });

      const firstId = first?.id ?? '';
      const result = await eventService.since(firstId);

      expect(result.events.length).toBeGreaterThanOrEqual(1);
      expect(result.events.every((e) => e.id !== firstId)).toBe(true);
    });
  });

  describe('Checkpoint Management', () => {
    it('manages checkpoints', async () => {
      await eventService.setCheckpoint('my-task', 'event-123');

      const checkpoint = await eventService.getCheckpoint('my-task');

      expect(checkpoint).toBe('event-123');
    });

    it('gets events since checkpoint', async () => {
      // Emit some events with explicit timestamps
      const event1 = await eventService.emit({
        type: 'event.one',
        source: 'test',
        externalId: 'e1',
        timestamp: '2024-06-01T12:00:00Z',
        data: {},
      });

      // Set checkpoint at first event
      const event1Id = event1?.id ?? '';
      await eventService.setCheckpoint('test-task', event1Id);

      // Emit more events with later timestamps
      await eventService.emit({
        type: 'event.two',
        source: 'test',
        externalId: 'e2',
        timestamp: '2024-06-01T12:00:01Z',
        data: {},
      });

      await eventService.emit({
        type: 'event.three',
        source: 'test',
        externalId: 'e3',
        timestamp: '2024-06-01T12:00:02Z',
        data: {},
      });

      // Get events since checkpoint
      const result = await eventService.eventsSinceCheckpoint('test-task');

      expect(result.events.length).toBe(2);
      expect(result.events.every((e) => e.id !== event1Id)).toBe(true);
    });

    it('returns all events if no checkpoint exists', async () => {
      await eventService.emit({
        type: 'event.one',
        source: 'test',
        externalId: 'e1',
        data: {},
      });

      const result = await eventService.eventsSinceCheckpoint('no-checkpoint-task');

      expect(result.events.length).toBeGreaterThanOrEqual(1);
    });

    it('lists checkpoints', async () => {
      await eventService.setCheckpoint('task-1', 'event-1');
      await eventService.setCheckpoint('task-2', 'event-2');

      const checkpoints = await eventService.listCheckpoints();

      expect(checkpoints.length).toBeGreaterThanOrEqual(2);
    });

    it('deletes checkpoint', async () => {
      await eventService.setCheckpoint('delete-me', 'event-123');

      const deleted = await eventService.deleteCheckpoint('delete-me');
      expect(deleted).toBe(true);

      const checkpoint = await eventService.getCheckpoint('delete-me');
      expect(checkpoint).toBeNull();
    });
  });

  describe('Maintenance', () => {
    it('cleans up old events', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 60);

      await eventService.emit({
        type: 'old.event',
        source: 'test',
        timestamp: oldDate.toISOString(),
        externalId: 'old',
        data: {},
      });

      const deleted = await eventService.cleanup(30);

      expect(deleted).toBe(1);
    });

    it('counts events', async () => {
      const initial = await eventService.count();

      await eventService.emit({ type: 'count.test', source: 'test', externalId: 'ct1', data: {} });

      const after = await eventService.count();

      expect(after).toBe(initial + 1);
    });

    it('counts events by domain', async () => {
      await eventService.emit({ type: 'domain.a.event', source: 'test', externalId: 'da1', data: {} });
      await eventService.emit({ type: 'domain.b.event', source: 'test', externalId: 'db1', data: {} });

      const counts = await eventService.countByDomain();

      expect(counts['domain']).toBe(2);
    });
  });

  describe('Configuration', () => {
    it('uses default configuration', () => {
      expect(eventService.config.retentionDays).toBe(30);
      expect(eventService.config.defaultQueryLimit).toBe(100);
      expect(eventService.config.maxQueryLimit).toBe(1000);
    });

    it('accepts custom configuration', () => {
      const customService = new EventService(services, {
        retentionDays: 60,
        defaultQueryLimit: 50,
      });

      expect(customService.config.retentionDays).toBe(60);
      expect(customService.config.defaultQueryLimit).toBe(50);
    });
  });
});
