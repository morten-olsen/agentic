import type { Knex } from 'knex';

import type {
  AgentSpecification,
  AgentFeedback,
  CreateAgentInput,
  UpdateAgentInput,
  RecordFeedbackInput,
  AgentRow,
  FeedbackRow,
  FeedbackOutcome,
} from './agent-registry.schemas.ts';
import { createAgentInputSchema, recordFeedbackInputSchema } from './agent-registry.schemas.ts';

// ============================================================================
// Helpers
// ============================================================================

const generateId = (): string => crypto.randomUUID();
const now = (): string => new Date().toISOString();

const rowToAgent = (row: AgentRow): AgentSpecification => ({
  id: row.id,
  name: row.name,
  purpose: row.purpose,
  systemPrompt: row.system_prompt,
  tools: JSON.parse(row.tools),
  modelTier: row.model_tier as AgentSpecification['modelTier'],
  maxTurns: row.max_turns,
  canAskUser: row.can_ask_user === 1,
  riskCeiling: row.risk_ceiling as AgentSpecification['riskCeiling'],
  createdBy: row.created_by as AgentSpecification['createdBy'],
  parentAgentId: row.parent_agent_id ?? undefined,
  useCount: row.use_count,
  feedbackScore: row.feedback_score,
  lastUsedAt: row.last_used_at ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const rowToFeedback = (row: FeedbackRow): AgentFeedback => ({
  id: row.id,
  agentId: row.agent_id,
  taskId: row.task_id ?? undefined,
  outcome: row.outcome as FeedbackOutcome,
  userRating: row.user_rating ?? undefined,
  notes: row.notes ?? undefined,
  createdAt: row.created_at,
});

// ============================================================================
// Agent CRUD
// ============================================================================

const createAgent = async (db: Knex, input: CreateAgentInput): Promise<AgentSpecification> => {
  const validated = createAgentInputSchema.parse(input);
  const id = generateId();
  const timestamp = now();

  const row: AgentRow = {
    id,
    name: validated.name,
    purpose: validated.purpose,
    system_prompt: validated.systemPrompt,
    tools: JSON.stringify(validated.tools),
    model_tier: validated.modelTier,
    max_turns: validated.maxTurns,
    can_ask_user: validated.canAskUser ? 1 : 0,
    risk_ceiling: validated.riskCeiling,
    created_by: validated.createdBy,
    parent_agent_id: validated.parentAgentId ?? null,
    use_count: 0,
    feedback_score: 0.5,
    last_used_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  await db('agent_specifications').insert(row);
  return rowToAgent(row);
};

const getAgent = async (db: Knex, id: string): Promise<AgentSpecification | null> => {
  const row = await db<AgentRow>('agent_specifications').where({ id }).first();
  return row ? rowToAgent(row) : null;
};

const updateAgent = async (db: Knex, id: string, updates: UpdateAgentInput): Promise<AgentSpecification | null> => {
  const timestamp = now();

  const updateData: Partial<AgentRow> = {
    updated_at: timestamp,
  };

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.purpose !== undefined) updateData.purpose = updates.purpose;
  if (updates.systemPrompt !== undefined) updateData.system_prompt = updates.systemPrompt;
  if (updates.tools !== undefined) updateData.tools = JSON.stringify(updates.tools);
  if (updates.modelTier !== undefined) updateData.model_tier = updates.modelTier;
  if (updates.maxTurns !== undefined) updateData.max_turns = updates.maxTurns;
  if (updates.canAskUser !== undefined) updateData.can_ask_user = updates.canAskUser ? 1 : 0;
  if (updates.riskCeiling !== undefined) updateData.risk_ceiling = updates.riskCeiling;

  const count = await db('agent_specifications').where({ id }).update(updateData);
  if (count === 0) return null;

  return getAgent(db, id);
};

const deleteAgent = async (db: Knex, id: string): Promise<boolean> => {
  const count = await db('agent_specifications').where({ id }).delete();
  return count > 0;
};

// ============================================================================
// Agent Queries
// ============================================================================

const listAgents = async (db: Knex): Promise<AgentSpecification[]> => {
  const rows = await db<AgentRow>('agent_specifications').orderBy('use_count', 'desc');
  return rows.map(rowToAgent);
};

const findByPurpose = async (db: Knex, purpose: string): Promise<AgentSpecification[]> => {
  const rows = await db<AgentRow>('agent_specifications')
    .where('purpose', 'like', `%${purpose}%`)
    .orderBy('feedback_score', 'desc')
    .limit(10);
  return rows.map(rowToAgent);
};

const findByCapability = async (db: Knex, toolId: string): Promise<AgentSpecification[]> => {
  // Search for agents that have this tool in their tools array
  const rows = await db<AgentRow>('agent_specifications')
    .where('tools', 'like', `%"${toolId}"%`)
    .orderBy('feedback_score', 'desc');
  return rows.map(rowToAgent);
};

const getBuiltinAgents = async (db: Knex): Promise<AgentSpecification[]> => {
  const rows = await db<AgentRow>('agent_specifications').where({ created_by: 'builtin' }).orderBy('name');
  return rows.map(rowToAgent);
};

const getCreatedAgents = async (db: Knex): Promise<AgentSpecification[]> => {
  const rows = await db<AgentRow>('agent_specifications')
    .where({ created_by: 'agent_builder' })
    .orderBy('last_used_at', 'desc');
  return rows.map(rowToAgent);
};

// ============================================================================
// Usage Tracking
// ============================================================================

const recordUsage = async (db: Knex, id: string): Promise<void> => {
  const timestamp = now();
  await db('agent_specifications')
    .where({ id })
    .update({
      last_used_at: timestamp,
      use_count: db.raw('use_count + 1'),
      updated_at: timestamp,
    });
};

// ============================================================================
// Feedback
// ============================================================================

const recordFeedback = async (db: Knex, input: RecordFeedbackInput): Promise<AgentFeedback> => {
  const validated = recordFeedbackInputSchema.parse(input);
  const id = generateId();
  const timestamp = now();

  // Get current agent for score calculation
  const agent = await getAgent(db, validated.agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${validated.agentId}`);
  }

  // Insert feedback
  const row: FeedbackRow = {
    id,
    agent_id: validated.agentId,
    task_id: validated.taskId ?? null,
    outcome: validated.outcome,
    user_rating: validated.userRating ?? null,
    notes: validated.notes ?? null,
    created_at: timestamp,
  };

  await db('agent_feedback').insert(row);

  // Calculate new feedback score
  // Outcome weights: success = 1, partial = 0.5, failure = 0
  const outcomeScore = validated.outcome === 'success' ? 1 : validated.outcome === 'partial' ? 0.5 : 0;

  // If user rating provided, blend with outcome score
  const scoreToAdd = validated.userRating
    ? (outcomeScore + (validated.userRating - 1) / 4) / 2 // Normalize rating 1-5 to 0-1
    : outcomeScore;

  // Running average
  const newFeedbackCount = agent.useCount + 1;
  const newFeedbackScore = (agent.feedbackScore * agent.useCount + scoreToAdd) / newFeedbackCount;

  await db('agent_specifications')
    .where({ id: validated.agentId })
    .update({
      feedback_score: Math.max(0, Math.min(1, newFeedbackScore)),
      updated_at: timestamp,
    });

  return rowToFeedback(row);
};

const getFeedbackForAgent = async (db: Knex, agentId: string, limit = 20): Promise<AgentFeedback[]> => {
  const rows = await db<FeedbackRow>('agent_feedback')
    .where({ agent_id: agentId })
    .orderBy('created_at', 'desc')
    .limit(limit);
  return rows.map(rowToFeedback);
};

// ============================================================================
// Evolution
// ============================================================================

const evolveAgent = async (
  db: Knex,
  parentId: string,
  modifications: UpdateAgentInput,
): Promise<AgentSpecification | null> => {
  const parent = await getAgent(db, parentId);
  if (!parent) return null;

  // Create a new agent based on the parent
  return createAgent(db, {
    name: modifications.name ?? `${parent.name} (evolved)`,
    purpose: modifications.purpose ?? parent.purpose,
    systemPrompt: modifications.systemPrompt ?? parent.systemPrompt,
    tools: modifications.tools ?? parent.tools,
    modelTier: modifications.modelTier ?? parent.modelTier,
    maxTurns: modifications.maxTurns ?? parent.maxTurns,
    canAskUser: modifications.canAskUser ?? parent.canAskUser,
    riskCeiling: modifications.riskCeiling ?? parent.riskCeiling,
    createdBy: 'agent_builder',
    parentAgentId: parentId,
  });
};

// ============================================================================
// Exports
// ============================================================================

export {
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
};
