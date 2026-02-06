import { describe, it, beforeEach, afterEach, expect } from 'vitest';

import { Services } from '../services/services.ts';
import { DatabaseService, createDatabaseService } from '../database/database.ts';

import { PersonalityService } from './personality.ts';
import { buildSystemPrompt } from './personality.prompts.ts';
import type { PersonalityConfig, AgentContext } from './personality.ts';

describe('PersonalityService', () => {
  let services: Services;

  beforeEach(async () => {
    services = new Services();
    const db = createDatabaseService(services, { path: ':memory:' });
    services.set(DatabaseService, db);
    await db.migrate();
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('getConfig', () => {
    it('returns default config when none exists', async () => {
      const personality = new PersonalityService(services);
      const config = await personality.getConfig();

      expect(config.id).toBe('default');
      expect(config.name).toBe('GLaDOS');
      expect(config.role).toBe('personal assistant');
    });

    it('returns existing config', async () => {
      const personality = new PersonalityService(services);
      await personality.createConfig({
        id: 'custom',
        name: 'Custom Assistant',
        role: 'helper',
      });

      const config = await personality.getConfig('custom');
      expect(config.name).toBe('Custom Assistant');
      expect(config.role).toBe('helper');
    });
  });

  describe('createConfig', () => {
    it('creates a new config with defaults', async () => {
      const personality = new PersonalityService(services);
      const config = await personality.createConfig({
        id: 'test',
        name: 'Test Bot',
      });

      expect(config.id).toBe('test');
      expect(config.name).toBe('Test Bot');
      expect(config.style.formality).toBe('professional');
      expect(config.traits.proactivity).toBe('suggestive');
    });

    it('creates a config with custom style', async () => {
      const personality = new PersonalityService(services);
      const config = await personality.createConfig({
        id: 'casual',
        name: 'Casual Bot',
        style: {
          formality: 'casual',
          humor: 'witty',
        },
      });

      expect(config.style.formality).toBe('casual');
      expect(config.style.humor).toBe('witty');
      expect(config.style.verbosity).toBe('balanced'); // Default
    });
  });

  describe('updateConfig', () => {
    it('updates an existing config', async () => {
      const personality = new PersonalityService(services);
      await personality.createConfig({
        id: 'test',
        name: 'Original',
      });

      const updated = await personality.updateConfig('test', {
        name: 'Updated',
        style: { formality: 'formal' },
      });

      expect(updated?.name).toBe('Updated');
      expect(updated?.style.formality).toBe('formal');
    });

    it('returns null for non-existent config', async () => {
      const personality = new PersonalityService(services);
      const updated = await personality.updateConfig('nonexistent', { name: 'Test' });
      expect(updated).toBeNull();
    });

    it('can clear core instructions', async () => {
      const personality = new PersonalityService(services);
      await personality.createConfig({
        id: 'test',
        name: 'Test',
        coreInstructions: 'Some instructions',
      });

      const updated = await personality.updateConfig('test', {
        coreInstructions: null,
      });

      expect(updated?.coreInstructions).toBeUndefined();
    });
  });

  describe('deleteConfig', () => {
    it('deletes a config', async () => {
      const personality = new PersonalityService(services);
      await personality.createConfig({
        id: 'test',
        name: 'Test',
      });

      const deleted = await personality.deleteConfig('test');
      expect(deleted).toBe(true);

      // Should fall back to default
      const config = await personality.getConfig('test');
      expect(config.id).toBe('default');
    });

    it('does not delete default config', async () => {
      const personality = new PersonalityService(services);
      await personality.getConfig('default'); // Ensure it exists

      const deleted = await personality.deleteConfig('default');
      expect(deleted).toBe(false);

      const config = await personality.getConfig('default');
      expect(config.id).toBe('default');
    });
  });

  describe('buildSystemPrompt', () => {
    it('builds a system prompt', async () => {
      const personality = new PersonalityService(services);
      const prompt = await personality.buildSystemPrompt();

      expect(prompt).toContain('GLaDOS');
      expect(prompt).toContain('personal assistant');
    });

    it('includes context when provided', async () => {
      const personality = new PersonalityService(services);
      const context: AgentContext = {
        now: '2024-01-15T10:00:00Z',
        localTime: 'Mon, Jan 15, 2024, 10:00 AM',
        timezone: 'UTC',
        timeOfDay: 'morning',
        isWorkingHours: true,
        location: {
          current: {
            id: '1',
            name: 'Home',
            type: 'home',
            isDefault: true,
            tags: [],
            createdAt: '',
            updatedAt: '',
          },
          confidence: 'exact',
          atHome: true,
          atWork: false,
          traveling: false,
        },
        user: {
          name: 'Alice',
          activeProjects: [],
          currentGoals: [],
        },
        calendar: {
          currentEvent: null,
          nextEvent: null,
          minutesToNext: null,
          travelTimeToNext: null,
          shouldLeaveBy: null,
          todayAgenda: '',
        },
        pendingTasks: [],
        dayPlan: null,
      };

      const prompt = await personality.buildSystemPrompt(context);

      expect(prompt).toContain('Alice');
      expect(prompt).toContain('Home');
      expect(prompt).toContain('morning');
    });
  });
});

describe('buildSystemPrompt', () => {
  it('generates style instructions', () => {
    const config: PersonalityConfig = {
      id: 'test',
      name: 'Test',
      role: 'assistant',
      style: {
        formality: 'casual',
        verbosity: 'terse',
        humor: 'witty',
        emoji: 'moderate',
      },
      traits: {
        proactivity: 'reactive',
        confidence: 'humble',
        directness: 'direct',
      },
      topicGuidelines: {},
      examples: [],
    };

    const prompt = buildSystemPrompt(config);

    expect(prompt).toContain('relaxed, friendly');
    expect(prompt).toContain('concise');
    expect(prompt).toContain('witty');
    expect(prompt).toContain('enhance communication');
  });

  it('includes topic guidelines', () => {
    const config: PersonalityConfig = {
      id: 'test',
      name: 'Test',
      role: 'assistant',
      style: {
        formality: 'professional',
        verbosity: 'balanced',
        humor: 'none',
        emoji: 'never',
      },
      traits: {
        proactivity: 'suggestive',
        confidence: 'balanced',
        directness: 'balanced',
      },
      topicGuidelines: {
        health: 'Be careful with medical advice',
        legal: 'Recommend consulting a lawyer',
      },
      examples: [],
    };

    const prompt = buildSystemPrompt(config);

    expect(prompt).toContain('health');
    expect(prompt).toContain('medical advice');
    expect(prompt).toContain('legal');
    expect(prompt).toContain('lawyer');
  });

  it('includes examples', () => {
    const config: PersonalityConfig = {
      id: 'test',
      name: 'Test',
      role: 'assistant',
      style: {
        formality: 'professional',
        verbosity: 'balanced',
        humor: 'none',
        emoji: 'never',
      },
      traits: {
        proactivity: 'suggestive',
        confidence: 'balanced',
        directness: 'balanced',
      },
      topicGuidelines: {},
      examples: [
        {
          userInput: 'Hello',
          idealResponse: 'Hello! How can I help you today?',
          explanation: 'Friendly greeting',
        },
      ],
    };

    const prompt = buildSystemPrompt(config);

    expect(prompt).toContain('Example 1');
    expect(prompt).toContain('Hello');
    expect(prompt).toContain('How can I help');
    expect(prompt).toContain('Friendly greeting');
  });
});
