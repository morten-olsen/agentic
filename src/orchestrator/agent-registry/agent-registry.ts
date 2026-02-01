import type { Services } from '../../services/services.ts';
import { DatabaseService } from '../../database/database.ts';

import type {
  AgentSpecification,
  AgentFeedback,
  CreateAgentInput,
  UpdateAgentInput,
  RecordFeedbackInput,
} from './agent-registry.schemas.ts';
import {
  createAgent,
  getAgent,
  updateAgent,
  deleteAgent,
  listAgents,
  findByPurpose,
  findByCapability,
  getBuiltinAgents,
  getCreatedAgents,
  recordUsage,
  recordFeedback,
  getFeedbackForAgent,
  evolveAgent,
} from './agent-registry.store.ts';

// ============================================================================
// Errors
// ============================================================================

class AgentNotFoundError extends Error {
  constructor(id: string) {
    super(`Agent not found: ${id}`);
    this.name = 'AgentNotFoundError';
  }
}

// ============================================================================
// Agent Registry Service
// ============================================================================

/**
 * Agent Registry Service - manages sub-agent specifications.
 *
 * Features:
 * - Store and retrieve agent specifications
 * - Track agent usage and feedback
 * - Evolve agents based on feedback
 * - Find agents by capability or purpose
 *
 * This enables the Agent Builder pattern where new specialized agents
 * can be created dynamically based on observed needs.
 */
class AgentRegistryService {
  #services: Services;

  constructor(services: Services) {
    this.#services = services;
  }

  /**
   * Gets the Knex instance from the database service.
   */
  #db = () => {
    return this.#services.get(DatabaseService).knex;
  };

  // ==========================================================================
  // Agent CRUD
  // ==========================================================================

  /**
   * Creates a new agent specification.
   */
  create = async (input: CreateAgentInput): Promise<AgentSpecification> => {
    return createAgent(this.#db(), input);
  };

  /**
   * Gets an agent by ID.
   */
  get = async (id: string): Promise<AgentSpecification | null> => {
    return getAgent(this.#db(), id);
  };

  /**
   * Updates an agent specification.
   */
  update = async (id: string, updates: UpdateAgentInput): Promise<AgentSpecification> => {
    const agent = await updateAgent(this.#db(), id, updates);
    if (!agent) {
      throw new AgentNotFoundError(id);
    }
    return agent;
  };

  /**
   * Deletes an agent specification.
   */
  delete = async (id: string): Promise<boolean> => {
    return deleteAgent(this.#db(), id);
  };

  // ==========================================================================
  // Agent Discovery
  // ==========================================================================

  /**
   * Lists all agents.
   */
  list = async (): Promise<AgentSpecification[]> => {
    return listAgents(this.#db());
  };

  /**
   * Finds agents by purpose (semantic search).
   */
  findByPurpose = async (purpose: string): Promise<AgentSpecification[]> => {
    return findByPurpose(this.#db(), purpose);
  };

  /**
   * Finds agents that have a specific tool capability.
   */
  findByCapability = async (toolId: string): Promise<AgentSpecification[]> => {
    return findByCapability(this.#db(), toolId);
  };

  /**
   * Gets all built-in agents.
   */
  getBuiltinAgents = async (): Promise<AgentSpecification[]> => {
    return getBuiltinAgents(this.#db());
  };

  /**
   * Gets agents created by the Agent Builder.
   */
  getCreatedAgents = async (): Promise<AgentSpecification[]> => {
    return getCreatedAgents(this.#db());
  };

  // ==========================================================================
  // Usage Tracking
  // ==========================================================================

  /**
   * Records that an agent was used.
   */
  recordUsage = async (id: string): Promise<void> => {
    return recordUsage(this.#db(), id);
  };

  // ==========================================================================
  // Feedback
  // ==========================================================================

  /**
   * Records feedback for an agent's performance.
   * Updates the agent's feedback score.
   */
  recordFeedback = async (input: RecordFeedbackInput): Promise<AgentFeedback> => {
    return recordFeedback(this.#db(), input);
  };

  /**
   * Gets recent feedback for an agent.
   */
  getFeedback = async (agentId: string, limit?: number): Promise<AgentFeedback[]> => {
    return getFeedbackForAgent(this.#db(), agentId, limit);
  };

  // ==========================================================================
  // Evolution
  // ==========================================================================

  /**
   * Creates a new agent evolved from an existing one.
   * The new agent inherits properties from the parent with modifications.
   */
  evolve = async (parentId: string, modifications: UpdateAgentInput): Promise<AgentSpecification> => {
    const agent = await evolveAgent(this.#db(), parentId, modifications);
    if (!agent) {
      throw new AgentNotFoundError(parentId);
    }
    return agent;
  };
}

// ============================================================================
// Re-exports
// ============================================================================

export type {
  ModelTier,
  RiskLevel,
  AgentSpecification,
  CreateAgentInput,
  UpdateAgentInput,
  FeedbackOutcome,
  AgentFeedback,
  RecordFeedbackInput,
} from './agent-registry.schemas.ts';

export {
  modelTierSchema,
  riskLevelSchema,
  agentSpecificationSchema,
  createAgentInputSchema,
  updateAgentInputSchema,
  feedbackOutcomeSchema,
  agentFeedbackSchema,
  recordFeedbackInputSchema,
} from './agent-registry.schemas.ts';

export { AgentRegistryService, AgentNotFoundError };
