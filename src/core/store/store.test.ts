import { describe, it, beforeEach, afterEach, expect } from 'vitest';

import { Services } from '../../core/services/services.ts';
import { createDatabaseService, DatabaseService } from '../../core/database/database.ts';

import {
  KnexStore,
  serializeNamespace,
  deserializeNamespace,
  cosineSimilarity,
  namespaceMatchesPrefix,
  namespaceMatchesSuffix,
  matchesFilter,
} from './store.ts';
import { InvalidNamespaceError } from './store.errors.ts';

describe('Store Module', () => {
  let services: Services;
  let db: DatabaseService;
  let store: KnexStore;

  beforeEach(async () => {
    services = new Services();
    db = createDatabaseService(services, { path: ':memory:' });
    services.set(DatabaseService, db);
    await db.migrate();
    store = new KnexStore(services);
    services.set(KnexStore, store);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('Database Migration', () => {
    it('creates store_items table with correct columns', async () => {
      const columns = await db.knex('store_items').columnInfo();

      expect(columns).toHaveProperty('namespace');
      expect(columns).toHaveProperty('key');
      expect(columns).toHaveProperty('value');
      expect(columns).toHaveProperty('created_at');
      expect(columns).toHaveProperty('updated_at');
    });

    it('creates store_embedding_index table', async () => {
      const columns = await db.knex('store_embedding_index').columnInfo();

      expect(columns).toHaveProperty('rowid');
      expect(columns).toHaveProperty('namespace');
      expect(columns).toHaveProperty('key');
      // Note: embeddings are stored in vec_items virtual table, not in store_embedding_index
    });

    it('creates vec_items virtual table', async () => {
      // Query sqlite_master to check if vec_items table exists
      const result = await db.knex.raw("SELECT name FROM sqlite_master WHERE type='table' AND name='vec_items'");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('vec_items');
    });
  });

  describe('Namespace Helpers', () => {
    describe('serializeNamespace', () => {
      it('serializes empty namespace', () => {
        expect(serializeNamespace([])).toBe('[]');
      });

      it('serializes single element', () => {
        expect(serializeNamespace(['memories'])).toBe('["memories"]');
      });

      it('serializes multiple elements', () => {
        expect(serializeNamespace(['memories', 'fact'])).toBe('["memories","fact"]');
      });
    });

    describe('deserializeNamespace', () => {
      it('deserializes empty namespace', () => {
        expect(deserializeNamespace('[]')).toEqual([]);
      });

      it('deserializes single element', () => {
        expect(deserializeNamespace('["memories"]')).toEqual(['memories']);
      });

      it('deserializes multiple elements', () => {
        expect(deserializeNamespace('["memories","fact"]')).toEqual(['memories', 'fact']);
      });

      it('throws for invalid JSON', () => {
        expect(() => deserializeNamespace('not-json')).toThrow(InvalidNamespaceError);
      });

      it('throws for non-array JSON', () => {
        expect(() => deserializeNamespace('{"foo": "bar"}')).toThrow(InvalidNamespaceError);
      });
    });

    describe('namespaceMatchesPrefix', () => {
      it('empty prefix matches everything', () => {
        expect(namespaceMatchesPrefix(['memories', 'fact'], [])).toBe(true);
        expect(namespaceMatchesPrefix([], [])).toBe(true);
      });

      it('exact match returns true', () => {
        expect(namespaceMatchesPrefix(['memories', 'fact'], ['memories', 'fact'])).toBe(true);
      });

      it('prefix match returns true', () => {
        expect(namespaceMatchesPrefix(['memories', 'fact'], ['memories'])).toBe(true);
      });

      it('non-prefix returns false', () => {
        expect(namespaceMatchesPrefix(['memories', 'fact'], ['entities'])).toBe(false);
      });

      it('longer prefix returns false', () => {
        expect(namespaceMatchesPrefix(['memories'], ['memories', 'fact'])).toBe(false);
      });
    });

    describe('namespaceMatchesSuffix', () => {
      it('empty suffix matches everything', () => {
        expect(namespaceMatchesSuffix(['memories', 'fact'], [])).toBe(true);
      });

      it('exact match returns true', () => {
        expect(namespaceMatchesSuffix(['memories', 'fact'], ['memories', 'fact'])).toBe(true);
      });

      it('suffix match returns true', () => {
        expect(namespaceMatchesSuffix(['memories', 'fact'], ['fact'])).toBe(true);
      });

      it('non-suffix returns false', () => {
        expect(namespaceMatchesSuffix(['memories', 'fact'], ['procedure'])).toBe(false);
      });
    });

    describe('matchesFilter', () => {
      it('matches exact values', () => {
        expect(matchesFilter({ type: 'fact', importance: 0.5 }, { type: 'fact' })).toBe(true);
      });

      it('rejects non-matching values', () => {
        expect(matchesFilter({ type: 'fact' }, { type: 'preference' })).toBe(false);
      });

      it('handles $eq operator', () => {
        expect(matchesFilter({ count: 5 }, { count: { $eq: 5 } })).toBe(true);
        expect(matchesFilter({ count: 5 }, { count: { $eq: 10 } })).toBe(false);
      });

      it('handles $ne operator', () => {
        expect(matchesFilter({ count: 5 }, { count: { $ne: 10 } })).toBe(true);
        expect(matchesFilter({ count: 5 }, { count: { $ne: 5 } })).toBe(false);
      });

      it('handles $gt operator', () => {
        expect(matchesFilter({ score: 0.8 }, { score: { $gt: 0.5 } })).toBe(true);
        expect(matchesFilter({ score: 0.5 }, { score: { $gt: 0.5 } })).toBe(false);
      });

      it('handles $gte operator', () => {
        expect(matchesFilter({ score: 0.5 }, { score: { $gte: 0.5 } })).toBe(true);
        expect(matchesFilter({ score: 0.4 }, { score: { $gte: 0.5 } })).toBe(false);
      });

      it('handles $lt operator', () => {
        expect(matchesFilter({ score: 0.3 }, { score: { $lt: 0.5 } })).toBe(true);
        expect(matchesFilter({ score: 0.5 }, { score: { $lt: 0.5 } })).toBe(false);
      });

      it('handles $lte operator', () => {
        expect(matchesFilter({ score: 0.5 }, { score: { $lte: 0.5 } })).toBe(true);
        expect(matchesFilter({ score: 0.6 }, { score: { $lte: 0.5 } })).toBe(false);
      });
    });
  });

  describe('Cosine Similarity', () => {
    it('returns 1 for identical vectors', () => {
      const vec = [0.5, 0.5, 0.5];
      expect(cosineSimilarity(vec, vec)).toBeCloseTo(1.0);
    });

    it('returns -1 for opposite vectors', () => {
      const vec1 = [1, 0, 0];
      const vec2 = [-1, 0, 0];
      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(-1.0);
    });

    it('returns 0 for orthogonal vectors', () => {
      const vec1 = [1, 0, 0];
      const vec2 = [0, 1, 0];
      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(0.0);
    });

    it('throws for mismatched dimensions', () => {
      const vec1 = [1, 0, 0];
      const vec2 = [1, 0];
      expect(() => cosineSimilarity(vec1, vec2)).toThrow('dimension mismatch');
    });

    it('returns 0 for zero vectors', () => {
      const vec1 = [0, 0, 0];
      const vec2 = [1, 2, 3];
      expect(cosineSimilarity(vec1, vec2)).toBe(0);
    });
  });

  describe('KnexStore', () => {
    describe('put and get', () => {
      it('stores and retrieves an item', async () => {
        await store.put(['memories', 'fact'], 'test-1', { content: 'Hello world' });

        const item = await store.get(['memories', 'fact'], 'test-1');

        expect(item).not.toBeNull();
        expect(item?.key).toBe('test-1');
        expect(item?.value).toEqual({ content: 'Hello world' });
        expect(item?.namespace).toEqual(['memories', 'fact']);
      });

      it('returns null for non-existent item', async () => {
        const item = await store.get(['memories', 'fact'], 'non-existent');
        expect(item).toBeNull();
      });

      it('updates an existing item', async () => {
        await store.put(['memories', 'fact'], 'test-1', { content: 'Original' });
        await store.put(['memories', 'fact'], 'test-1', { content: 'Updated' });

        const item = await store.get(['memories', 'fact'], 'test-1');
        expect(item?.value).toEqual({ content: 'Updated' });
      });

      it('stores items with different namespaces', async () => {
        await store.put(['memories', 'fact'], 'test-1', { content: 'A fact' });
        await store.put(['memories', 'preference'], 'test-1', { content: 'A preference' });

        const fact = await store.get(['memories', 'fact'], 'test-1');
        const pref = await store.get(['memories', 'preference'], 'test-1');

        expect(fact?.value).toEqual({ content: 'A fact' });
        expect(pref?.value).toEqual({ content: 'A preference' });
      });
    });

    describe('delete', () => {
      it('deletes an item', async () => {
        await store.put(['memories', 'fact'], 'test-1', { content: 'Hello' });
        await store.delete(['memories', 'fact'], 'test-1');

        const item = await store.get(['memories', 'fact'], 'test-1');
        expect(item).toBeNull();
      });

      it('handles deleting non-existent item', async () => {
        // Should not throw
        await store.delete(['memories', 'fact'], 'non-existent');
      });
    });

    describe('search', () => {
      beforeEach(async () => {
        await store.put(['memories', 'fact'], 'fact-1', { content: 'Fact 1', importance: 0.8 });
        await store.put(['memories', 'fact'], 'fact-2', { content: 'Fact 2', importance: 0.5 });
        await store.put(['memories', 'preference'], 'pref-1', { content: 'Preference 1', importance: 0.6 });
        await store.put(['entities', 'company'], 'company-1', { name: 'Acme Inc' });
      });

      it('searches by namespace prefix', async () => {
        const results = await store.search(['memories'], {});
        expect(results.length).toBe(3);
      });

      it('searches specific namespace', async () => {
        const results = await store.search(['memories', 'fact'], {});
        expect(results.length).toBe(2);
      });

      it('applies limit', async () => {
        const results = await store.search(['memories'], { limit: 2 });
        expect(results.length).toBe(2);
      });

      it('applies offset', async () => {
        const results = await store.search(['memories'], { limit: 1, offset: 1 });
        expect(results.length).toBe(1);
      });

      it('filters by value fields', async () => {
        const results = await store.search(['memories', 'fact'], {
          filter: { importance: { $gt: 0.6 } },
        });
        expect(results.length).toBe(1);
        expect(results[0]?.value['content']).toBe('Fact 1');
      });
    });

    describe('listNamespaces', () => {
      beforeEach(async () => {
        await store.put(['memories', 'fact'], 'fact-1', { content: 'A' });
        await store.put(['memories', 'preference'], 'pref-1', { content: 'B' });
        await store.put(['entities', 'company'], 'company-1', { name: 'C' });
      });

      it('lists all namespaces', async () => {
        const namespaces = await store.listNamespaces({});

        expect(namespaces.length).toBe(3);
        expect(namespaces).toContainEqual(['memories', 'fact']);
        expect(namespaces).toContainEqual(['memories', 'preference']);
        expect(namespaces).toContainEqual(['entities', 'company']);
      });

      it('filters by prefix', async () => {
        const namespaces = await store.listNamespaces({
          prefix: ['memories'],
        });

        expect(namespaces.length).toBe(2);
        expect(namespaces).toContainEqual(['memories', 'fact']);
        expect(namespaces).toContainEqual(['memories', 'preference']);
      });

      it('applies limit and offset', async () => {
        const namespaces = await store.listNamespaces({
          limit: 1,
          offset: 1,
        });

        expect(namespaces.length).toBe(1);
      });
    });

    describe('batch', () => {
      it('executes multiple operations', async () => {
        const results = await store.batch([
          { namespace: ['memories', 'fact'], key: 'test-1', value: { content: 'Hello' } },
          { namespace: ['memories', 'fact'], key: 'test-2', value: { content: 'World' } },
          { namespace: ['memories', 'fact'], key: 'test-1' },
          { namespacePrefix: ['memories'], limit: 10 },
        ]);

        // First two are puts (undefined results)
        expect(results[0]).toBeUndefined();
        expect(results[1]).toBeUndefined();
        // Third is a get
        expect((results[2] as { value: { content: string } } | null)?.value?.content).toBe('Hello');
        // Fourth is a search
        expect((results[3] as unknown[]).length).toBe(2);
      });
    });
  });
});
