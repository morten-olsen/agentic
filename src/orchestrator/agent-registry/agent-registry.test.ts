import { describe, it, beforeEach, afterEach, expect } from 'vitest';

import { Services } from '../../services/services.ts';
import { DatabaseService, createDatabaseService } from '../../database/database.ts';

import { AgentRegistryService, AgentNotFoundError } from './agent-registry.ts';

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
// Tests
// ============================================================================

describe('AgentRegistryService', () => {
  let services: Services;
  let registry: AgentRegistryService;

  beforeEach(async () => {
    services = await createTestServices();
    registry = new AgentRegistryService(services);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('create', () => {
    it('creates an agent with required fields', async () => {
      const agent = await registry.create({
        name: 'Research Scout',
        purpose: 'Web research and summarization',
        systemPrompt: 'You are a research assistant...',
      });

      expect(agent.id).toBeDefined();
      expect(agent.name).toBe('Research Scout');
      expect(agent.purpose).toBe('Web research and summarization');
      expect(agent.modelTier).toBe('balanced');
      expect(agent.maxTurns).toBe(10);
      expect(agent.canAskUser).toBe(false);
      expect(agent.riskCeiling).toBe('medium');
      expect(agent.createdBy).toBe('builtin');
      expect(agent.useCount).toBe(0);
      expect(agent.feedbackScore).toBe(0.5);
    });

    it('creates an agent with all fields', async () => {
      const agent = await registry.create({
        name: 'Code Reviewer',
        purpose: 'Review code changes',
        systemPrompt: 'You are a code reviewer...',
        tools: ['git', 'filesystem', 'linter'],
        modelTier: 'capable',
        maxTurns: 20,
        canAskUser: true,
        riskCeiling: 'high',
        createdBy: 'agent_builder',
      });

      expect(agent.tools).toEqual(['git', 'filesystem', 'linter']);
      expect(agent.modelTier).toBe('capable');
      expect(agent.maxTurns).toBe(20);
      expect(agent.canAskUser).toBe(true);
      expect(agent.riskCeiling).toBe('high');
      expect(agent.createdBy).toBe('agent_builder');
    });
  });

  describe('get', () => {
    it('returns null for non-existent agent', async () => {
      const agent = await registry.get('non-existent');
      expect(agent).toBeNull();
    });

    it('retrieves an existing agent', async () => {
      const created = await registry.create({
        name: 'Test Agent',
        purpose: 'Testing',
        systemPrompt: 'Test prompt',
      });

      const retrieved = await registry.get(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('Test Agent');
    });
  });

  describe('update', () => {
    it('updates agent fields', async () => {
      const agent = await registry.create({
        name: 'Original Name',
        purpose: 'Original purpose',
        systemPrompt: 'Original prompt',
      });

      const updated = await registry.update(agent.id, {
        name: 'Updated Name',
        tools: ['new-tool'],
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.tools).toEqual(['new-tool']);
      expect(updated.purpose).toBe('Original purpose');
    });

    it('throws AgentNotFoundError for non-existent agent', async () => {
      await expect(registry.update('non-existent', { name: 'Test' })).rejects.toThrow(AgentNotFoundError);
    });
  });

  describe('delete', () => {
    it('deletes an existing agent', async () => {
      const agent = await registry.create({
        name: 'To Delete',
        purpose: 'Testing',
        systemPrompt: 'Prompt',
      });

      const deleted = await registry.delete(agent.id);
      expect(deleted).toBe(true);

      const retrieved = await registry.get(agent.id);
      expect(retrieved).toBeNull();
    });

    it('returns false for non-existent agent', async () => {
      const deleted = await registry.delete('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('findByPurpose', () => {
    it('finds agents by purpose', async () => {
      await registry.create({
        name: 'Research Agent',
        purpose: 'Web research and summarization',
        systemPrompt: 'Prompt',
      });
      await registry.create({
        name: 'Code Agent',
        purpose: 'Code review and analysis',
        systemPrompt: 'Prompt',
      });

      const researchAgents = await registry.findByPurpose('research');
      expect(researchAgents).toHaveLength(1);
      expect(researchAgents[0].name).toBe('Research Agent');
    });
  });

  describe('findByCapability', () => {
    it('finds agents with specific tool', async () => {
      await registry.create({
        name: 'Git Agent',
        purpose: 'Git operations',
        systemPrompt: 'Prompt',
        tools: ['git', 'filesystem'],
      });
      await registry.create({
        name: 'Email Agent',
        purpose: 'Email handling',
        systemPrompt: 'Prompt',
        tools: ['email', 'calendar'],
      });

      const gitAgents = await registry.findByCapability('git');
      expect(gitAgents).toHaveLength(1);
      expect(gitAgents[0].name).toBe('Git Agent');
    });
  });

  describe('recordUsage', () => {
    it('increments use count', async () => {
      const agent = await registry.create({
        name: 'Test Agent',
        purpose: 'Testing',
        systemPrompt: 'Prompt',
      });

      await registry.recordUsage(agent.id);
      await registry.recordUsage(agent.id);

      const updated = await registry.get(agent.id);
      expect(updated?.useCount).toBe(2);
      expect(updated?.lastUsedAt).toBeDefined();
    });
  });

  describe('recordFeedback', () => {
    it('records feedback and updates score', async () => {
      const agent = await registry.create({
        name: 'Test Agent',
        purpose: 'Testing',
        systemPrompt: 'Prompt',
      });

      const feedback = await registry.recordFeedback({
        agentId: agent.id,
        outcome: 'success',
      });

      expect(feedback.id).toBeDefined();
      expect(feedback.agentId).toBe(agent.id);
      expect(feedback.outcome).toBe('success');

      const updated = await registry.get(agent.id);
      expect(updated?.feedbackScore).toBeGreaterThan(0.5);
    });

    it('records feedback with user rating', async () => {
      const agent = await registry.create({
        name: 'Test Agent',
        purpose: 'Testing',
        systemPrompt: 'Prompt',
      });

      const feedback = await registry.recordFeedback({
        agentId: agent.id,
        outcome: 'success',
        userRating: 5,
        notes: 'Great job!',
      });

      expect(feedback.userRating).toBe(5);
      expect(feedback.notes).toBe('Great job!');
    });

    it('reduces score on failure', async () => {
      const agent = await registry.create({
        name: 'Test Agent',
        purpose: 'Testing',
        systemPrompt: 'Prompt',
      });

      await registry.recordFeedback({
        agentId: agent.id,
        outcome: 'failure',
      });

      const updated = await registry.get(agent.id);
      expect(updated?.feedbackScore).toBeLessThan(0.5);
    });
  });

  describe('getFeedback', () => {
    it('retrieves feedback for an agent', async () => {
      const agent = await registry.create({
        name: 'Test Agent',
        purpose: 'Testing',
        systemPrompt: 'Prompt',
      });

      await registry.recordFeedback({ agentId: agent.id, outcome: 'success' });
      await registry.recordFeedback({ agentId: agent.id, outcome: 'partial' });
      await registry.recordFeedback({ agentId: agent.id, outcome: 'failure' });

      const feedback = await registry.getFeedback(agent.id);
      expect(feedback).toHaveLength(3);
    });
  });

  describe('evolve', () => {
    it('creates evolved agent from parent', async () => {
      const parent = await registry.create({
        name: 'Parent Agent',
        purpose: 'Original purpose',
        systemPrompt: 'Parent prompt',
        tools: ['tool1'],
        modelTier: 'balanced',
      });

      const evolved = await registry.evolve(parent.id, {
        name: 'Evolved Agent',
        tools: ['tool1', 'tool2'],
        modelTier: 'capable',
      });

      expect(evolved.name).toBe('Evolved Agent');
      expect(evolved.purpose).toBe('Original purpose');
      expect(evolved.tools).toEqual(['tool1', 'tool2']);
      expect(evolved.modelTier).toBe('capable');
      expect(evolved.parentAgentId).toBe(parent.id);
      expect(evolved.createdBy).toBe('agent_builder');
    });

    it('throws AgentNotFoundError for non-existent parent', async () => {
      await expect(registry.evolve('non-existent', { name: 'Test' })).rejects.toThrow(AgentNotFoundError);
    });
  });

  describe('list', () => {
    it('lists all agents sorted by use count', async () => {
      const agent1 = await registry.create({
        name: 'Agent 1',
        purpose: 'Testing',
        systemPrompt: 'Prompt',
      });
      const agent2 = await registry.create({
        name: 'Agent 2',
        purpose: 'Testing',
        systemPrompt: 'Prompt',
      });

      // Use agent2 more
      await registry.recordUsage(agent2.id);
      await registry.recordUsage(agent2.id);
      await registry.recordUsage(agent1.id);

      const agents = await registry.list();
      expect(agents).toHaveLength(2);
      expect(agents[0].name).toBe('Agent 2');
    });
  });

  describe('getBuiltinAgents', () => {
    it('returns only builtin agents', async () => {
      await registry.create({
        name: 'Builtin',
        purpose: 'Testing',
        systemPrompt: 'Prompt',
        createdBy: 'builtin',
      });
      await registry.create({
        name: 'Created',
        purpose: 'Testing',
        systemPrompt: 'Prompt',
        createdBy: 'agent_builder',
      });

      const builtin = await registry.getBuiltinAgents();
      expect(builtin).toHaveLength(1);
      expect(builtin[0].name).toBe('Builtin');
    });
  });

  describe('getCreatedAgents', () => {
    it('returns only agent_builder created agents', async () => {
      await registry.create({
        name: 'Builtin',
        purpose: 'Testing',
        systemPrompt: 'Prompt',
        createdBy: 'builtin',
      });
      await registry.create({
        name: 'Created',
        purpose: 'Testing',
        systemPrompt: 'Prompt',
        createdBy: 'agent_builder',
      });

      const created = await registry.getCreatedAgents();
      expect(created).toHaveLength(1);
      expect(created[0].name).toBe('Created');
    });
  });
});
