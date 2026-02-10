import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { Services } from '../../../core/services/services.ts';
import { createDatabaseService, DatabaseService } from '../../../core/database/database.ts';
import { LogService } from '../../../core/logging/logging.ts';

import { OpenLoopService } from './openloop.service.ts';
import { MemoryIndexService } from './index.service.ts';
import { MessageRetrievalService, extractTopicKeywords } from './retrieval.service.ts';

// ============================================================================
// Test Setup
// ============================================================================

const createTestServices = async (): Promise<{ services: Services; cleanup: () => Promise<void> }> => {
  const services = new Services();
  const dbService = createDatabaseService(services, { path: ':memory:' });
  services.set(DatabaseService, dbService);
  await dbService.migrate();

  // Add LogService
  const logService = new LogService(services, { terminalEnabled: false, databaseEnabled: false });
  services.set(LogService, logService);

  // Add OpenLoopService
  const openLoopService = new OpenLoopService(services);
  services.set(OpenLoopService, openLoopService);

  // Add MemoryIndexService
  const memoryIndexService = new MemoryIndexService(services);
  services.set(MemoryIndexService, memoryIndexService);

  return {
    services,
    cleanup: async () => {
      await services.destroy();
    },
  };
};

// ============================================================================
// extractTopicKeywords Tests
// ============================================================================

describe('extractTopicKeywords', () => {
  it('should extract meaningful words', () => {
    const keywords = extractTopicKeywords('Should I take the job offer from Acme Corp?');
    expect(keywords).toContain('take');
    expect(keywords).toContain('offer');
    expect(keywords).toContain('acme');
    expect(keywords).toContain('corp');
  });

  it('should filter stop words', () => {
    const keywords = extractTopicKeywords('The quick brown fox jumps over the lazy dog');
    expect(keywords).not.toContain('the');
    expect(keywords).toContain('quick');
    expect(keywords).toContain('brown');
    expect(keywords).toContain('jumps');
    expect(keywords).toContain('over');
    expect(keywords).toContain('lazy');
  });

  it('should filter short words', () => {
    const keywords = extractTopicKeywords('I am at a big store');
    expect(keywords).not.toContain('am');
    expect(keywords).not.toContain('at');
    expect(keywords).not.toContain('big');
    expect(keywords).toContain('store');
  });

  it('should remove duplicates', () => {
    const keywords = extractTopicKeywords('offer offer offer great great');
    expect(keywords.filter((k) => k === 'offer').length).toBe(1);
    expect(keywords.filter((k) => k === 'great').length).toBe(1);
  });

  it('should handle empty string', () => {
    const keywords = extractTopicKeywords('');
    expect(keywords).toEqual([]);
  });
});

// ============================================================================
// MessageRetrievalService Tests
// ============================================================================

describe('MessageRetrievalService', () => {
  let services: Services;
  let service: MessageRetrievalService;
  let openLoopService: OpenLoopService;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = await createTestServices();
    services = setup.services;
    cleanup = setup.cleanup;
    service = new MessageRetrievalService(services);
    openLoopService = services.get(OpenLoopService);
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('extractEntitiesFromMessage', () => {
    it('should match known entities', () => {
      const knownEntities = ['Alice', 'Project X', 'Acme Corp'];
      const result = service.extractEntitiesFromMessage('I met with Alice about Project X today', knownEntities);

      expect(result.entities.length).toBe(2);
      expect(result.entities.map((e) => e.text)).toContain('Alice');
      expect(result.entities.map((e) => e.text)).toContain('Project X');
    });

    it('should be case insensitive for entities', () => {
      const knownEntities = ['Alice'];
      const result = service.extractEntitiesFromMessage('I talked to alice yesterday', knownEntities);

      expect(result.entities.length).toBe(1);
      expect(result.entities[0]?.text).toBe('Alice');
    });

    it('should match whole words only', () => {
      const knownEntities = ['Al'];
      const result = service.extractEntitiesFromMessage('I talked to Alice yesterday', knownEntities);

      expect(result.entities.length).toBe(0);
    });

    it('should extract topics', () => {
      const result = service.extractEntitiesFromMessage('What about the vacation plans for next summer?', []);

      expect(result.topics).toContain('vacation');
      expect(result.topics).toContain('plans');
      expect(result.topics).toContain('next');
      expect(result.topics).toContain('summer');
    });
  });

  describe('retrieveForMessage', () => {
    it('should return empty hints for unrelated message', async () => {
      const result = await service.retrieveForMessage('What is the weather today?');

      expect(result.hints.length).toBe(0);
      expect(result.matchedOpenLoops.length).toBe(0);
    });

    it('should match open loops and generate hints', async () => {
      // Create an open loop
      await openLoopService.create({
        topic: 'Job decision',
        description: 'Need to decide on job offer from Acme',
        activationPatterns: ['job', 'offer', 'acme', 'career'],
      });

      const result = await service.retrieveForMessage('Have you decided about the job offer yet?');

      expect(result.matchedOpenLoops.length).toBe(1);
      expect(result.matchedOpenLoops[0]?.topic).toBe('Job decision');
      expect(result.hints.length).toBeGreaterThan(0);
      expect(result.hints[0]?.type).toBe('open_loop');
    });

    it('should limit hints based on config', async () => {
      // Create multiple open loops
      for (let i = 0; i < 5; i++) {
        await openLoopService.create({
          topic: `Decision ${i}`,
          description: `Description ${i}`,
          activationPatterns: ['test', 'multiple'],
        });
      }

      // Create service with low max hints
      const limitedService = new MessageRetrievalService(services, { maxHints: 2, hintRelevanceThreshold: 0 });
      const result = await limitedService.retrieveForMessage('test multiple patterns');

      expect(result.hints.length).toBeLessThanOrEqual(2);
    });
  });

  describe('injectHints', () => {
    it('should return original message when no hints', () => {
      const message = 'Hello, how are you?';
      const result = service.injectHints(message, []);

      expect(result).toBe(message);
    });

    it('should append hints to message', () => {
      const message = 'What about the job?';
      const hints = [
        {
          memoryId: '1',
          type: 'open_loop' as const,
          hint: 'Open: Job decision (5 days ago)',
          relevanceScore: 0.9,
        },
      ];

      const result = service.injectHints(message, hints);

      expect(result).toContain(message);
      expect(result).toContain('<memory-context>');
      expect(result).toContain('Open: Job decision (5 days ago)');
      expect(result).toContain('</memory-context>');
    });

    it('should include multiple hints', () => {
      const message = 'Hello';
      const hints = [
        {
          memoryId: '1',
          type: 'open_loop' as const,
          hint: 'Hint 1',
          relevanceScore: 0.9,
        },
        {
          memoryId: '2',
          type: 'consolidated' as const,
          hint: 'Hint 2',
          relevanceScore: 0.8,
        },
      ];

      const result = service.injectHints(message, hints);

      expect(result).toContain('- Hint 1');
      expect(result).toContain('- Hint 2');
    });
  });

  describe('generateHints', () => {
    it('should filter by relevance threshold', async () => {
      // Create service with high threshold
      const strictService = new MessageRetrievalService(services, {
        maxHints: 10,
        hintRelevanceThreshold: 0.95,
      });

      // Create an open loop
      await openLoopService.create({
        topic: 'Test loop',
        description: 'Test',
        activationPatterns: ['test'],
      });

      const result = await strictService.retrieveForMessage('test pattern');

      // Open loop hints have 0.9 relevance, which is below 0.95 threshold
      expect(result.hints.length).toBe(0);
    });

    it('should sort hints by relevance', async () => {
      // Create multiple loops
      await openLoopService.create({
        topic: 'Loop 1',
        description: 'First loop',
        activationPatterns: ['common'],
      });

      await openLoopService.create({
        topic: 'Loop 2',
        description: 'Second loop',
        activationPatterns: ['common'],
      });

      const result = await service.retrieveForMessage('common pattern');

      // Hints should be present and sorted by relevance
      expect(result.hints.length).toBeGreaterThan(0);
      for (let i = 1; i < result.hints.length; i++) {
        const prevHint = result.hints[i - 1];
        const currHint = result.hints[i];
        if (prevHint && currHint) {
          expect(prevHint.relevanceScore).toBeGreaterThanOrEqual(currHint.relevanceScore);
        }
      }
    });
  });

  describe('config', () => {
    it('should use default config', () => {
      expect(service.config.maxHints).toBe(5);
      expect(service.config.hintRelevanceThreshold).toBe(0.6);
    });

    it('should allow custom config', () => {
      const customService = new MessageRetrievalService(services, {
        maxHints: 10,
        hintRelevanceThreshold: 0.3,
      });

      expect(customService.config.maxHints).toBe(10);
      expect(customService.config.hintRelevanceThreshold).toBe(0.3);
    });

    it('should allow updating config', () => {
      service.setConfig({ maxHints: 3 });
      expect(service.config.maxHints).toBe(3);
      expect(service.config.hintRelevanceThreshold).toBe(0.6); // Unchanged
    });
  });
});
