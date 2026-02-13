# Behavioral Memory Specification

> Adaptive behavioral templates that evolve organically through feedback

**Version**: 1.0
**Status**: Draft
**Dependencies**: Memory System (Phase 4), Memory Consolidation (019), Trigger System (003)

## Overview

GLaDOS currently stores what it *knows* (facts, preferences, events) but not how it should *act* in different situations. When the agent performs an action — sending a notification, responding to a question about work, giving a morning briefing — it improvises from first principles every time. There's no structured learning loop: if a user reacts negatively to a proactive check-in, that correction gets stored as a memory but doesn't systematically change future behavior.

Behavioral Memory introduces **behavioral templates** — lightweight strategy documents that describe how the agent should behave in a specific situation. Every agent action either matches an existing template or triggers the creation of a new one. Templates evolve continuously through user feedback, creating a closed-loop system that drives emergent positive behaviors.

**This system replaces the `feedback` memory type.** Currently, user corrections are stored as `feedback` memories — but they just sit there. Behavioral templates close the loop: corrections become evidence that actively changes future behavior. Existing `feedback` memories should be migrated into initial templates during adoption.

### The Core Insight

Instead of a complex behavioral model, the agent's context includes a **contextual behavioral index** — the top 10 template titles most relevant to the current conversation, selected by semantic search. The agent sees which templates might apply and decides itself whether to fetch one. If none match, it acts on best judgment and creates a new template from the outcome.

```
Agent context includes: Top 10 Behavioral Templates (semantic match to conversation)
  ├── "Morning briefing" (planning, confidence: 0.8)
  ├── "Task reminders" (productivity, confidence: 0.4)
  ├── "Health check-in" (health, confidence: 0.6)
  └── ... (up to 10, ranked by relevance to current context)

Agent decides to act
    ↓
Scans index: "Does any of these templates match what I'm about to do?"
    ↓
┌─── YES ──────────────────────┐  ┌─── NO ─────────────────────┐
│ Fetch full template          │  │ Act on best judgment        │
│ Follow strategy              │  │ Create new template from    │
│                              │  │ the action and outcome      │
└──────────────┬───────────────┘  └──────────────┬──────────────┘
               ↓                                  ↓
         Observe outcome (user feedback, engagement, corrections)
               ↓
         Update template with evidence
               ↓
         Refine strategy if needed
```

### Goals

1. **Template-Driven Behavior**: Every agent action should be traceable to a behavioral template
2. **Continuous Learning**: Templates evolve from user feedback — both explicit corrections and implicit signals
3. **Organic Refinement**: The agent naturally varies its approach on low-confidence templates and updates strategies based on what works
4. **Index-Driven Retrieval**: Template index lives in agent context — the agent sees titles and decides what to fetch, like the memory index pattern
5. **Emergent Improvement**: Over time, the system discovers interaction patterns that work well and reinforces them

### Non-Goals (for v1)

- Multi-armed bandit or RL algorithms — keep it simple, LLM-driven
- User-facing template editor — templates are agent-managed
- Cross-user behavioral learning — personal to each user
- Real-time A/B testing within a single conversation
- Template sharing or marketplace
- Explicit rules about when to create templates — let the agent develop this naturally and evaluate

### Replaces

- **`feedback` memory type**: User corrections are currently stored as `feedback` memories but never acted on. Behavioral templates replace this — corrections become evidence that actively shapes behavior. The `feedback` memory type should be deprecated and existing feedback memories migrated into initial templates.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Behavioral Memory System                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                  Contextual Template Index (in Agent Context)      │ │
│  │  (Per-conversation: top 10 templates by semantic relevance)        │ │
│  │                                                                    │ │
│  │  Semantic search against conversation context → top 10 titles.     │ │
│  │  Agent decides whether any template applies — no automated match.  │ │
│  │  Also shows pending outcomes awaiting feedback.                    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                              │                                           │
│                    Agent thinks a template applies                        │
│                              ▼                                           │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                  Fetch Template (Agent-Initiated)                  │ │
│  │  (On-demand: agent fetches full template via tool)                 │ │
│  │                                                                    │ │
│  │  - Full strategy, guidelines, evidence history                     │ │
│  │  - Agent incorporates into its action plan                         │ │
│  │  - Or: no template matches → act on best judgment, create after    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                              │                                           │
│                              ▼                                           │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                     Outcome Recording                              │ │
│  │  (Post-action: capture what happened)                              │ │
│  │                                                                    │ │
│  │  - User reaction: positive / neutral / negative / correction       │ │
│  │  - Engagement signal: replied, ignored, dismissed                  │ │
│  │  - Explicit feedback: "don't do that", "this was helpful"          │ │
│  │  - Context: time, situation, conversation state                    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                              │                                           │
│                              ▼                                           │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                    Template Evolution                               │ │
│  │  (Background: housekeeping)                                        │ │
│  │                                                                    │ │
│  │  - Decay activation on unmatched templates                         │ │
│  │  - Expire stale pending outcomes                                   │ │
│  │  - Retire consistently poor templates                              │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Contextual Index, Agent-Initiated Fetch**: Each conversation gets the top 10 templates most relevant to its context (via semantic search against conversation state). The agent sees titles and decides whether to fetch the full template — no hidden pre-action hook, no automated action matching. The agent's semantic judgment on "does this apply?" is better than any threshold. The `behavioral.searchTemplates` tool covers cases where the right template isn't in the top 10.

2. **Organic Evolution**: No formal experiment framework. The agent naturally varies its approach on low-confidence templates and refines strategies as part of recording outcomes. If something didn't work, the agent tweaks the strategy right there — no separate experiment design step. This keeps the system simple and leverages the agent's in-context judgment.

3. **Implicit + Explicit Signals**: The system reads both explicit feedback ("stop doing that") and implicit signals (user ignored the notification, user engaged with the summary). The LLM interprets what the signals mean — no signal processing pipeline.

5. **No Separate Personality System**: Behavioral templates don't replace the personality config — they complement it. Personality defines *who* the agent is (tone, style). Templates define *what to do* in specific situations (strategy, timing, approach).

---

## Data Model

### Behavioral Template

```typescript
const templateStatusSchema = z.enum([
  'active',       // In use
  'dormant',      // Exists but rarely matched (low activation)
  'retired',      // Superseded or consistently poor
]);

const behavioralTemplateSchema = z.object({
  id: z.string(),

  // What situation this template covers
  situation: z.object({
    description: z.string(),       // "User asks about their day plan"
    category: z.string(),          // "planning", "notification", "health", "social", ...
    triggerPatterns: z.array(z.string()),  // Semantic anchors for matching
  }),

  // Current strategy (the "playbook") — evolves organically through use
  strategy: z.object({
    approach: z.string(),          // "Provide a structured summary with top 3 priorities"
    guidelines: z.array(z.string()), // ["Keep it under 5 items", "Start with most urgent"]
    tone: z.string().optional(),   // Override for this specific situation
    timing: z.string().optional(), // "Proactive at 8am" or "Only when asked"
    parameters: z.record(z.string(), z.unknown()).optional(), // Tunable values
  }),

  // Evidence that shaped this strategy
  evidence: z.object({
    totalInteractions: z.number(),
    positiveOutcomes: z.number(),
    negativeOutcomes: z.number(),
    neutralOutcomes: z.number(),
    lastOutcomes: z.array(z.object({   // Rolling window of recent outcomes
      timestamp: z.string(),
      signal: z.enum(['positive', 'negative', 'neutral', 'correction']),
      detail: z.string(),              // What happened
      strategyChange: z.string().optional(), // If the agent tweaked the strategy after this outcome
    })).default([]),
    confidenceScore: z.number().min(0).max(1), // How confident we are in this strategy
  }),

  // Retrieval
  embedding: z.array(z.number()).optional(),
  activationScore: z.number().min(0).max(1),

  // Lifecycle
  status: templateStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  lastMatchedAt: z.string().optional(),
});

type BehavioralTemplate = z.infer<typeof behavioralTemplateSchema>;
```

### Outcome Record

Lightweight record of what happened after an action:

```typescript
const outcomeSignalSchema = z.enum([
  'positive',     // User engaged, thanked, followed up
  'negative',     // User dismissed, corrected, complained
  'neutral',      // No strong signal either way
  'correction',   // User explicitly told agent to behave differently
]);

const outcomeRecordSchema = z.object({
  id: z.string(),
  templateId: z.string(),

  // What happened
  action: z.string(),               // What the agent did
  signal: outcomeSignalSchema,
  detail: z.string(),               // What the user did/said in response
  strategyChange: z.string().optional(), // If the agent refined the strategy based on this outcome
  context: z.object({
    conversationId: z.string().optional(),
    triggerId: z.string().optional(),
    timeOfDay: z.string(),
    dayOfWeek: z.string(),
  }),

  createdAt: z.string(),
});

type OutcomeRecord = z.infer<typeof outcomeRecordSchema>;
```

### Pending Outcome

When a template is used in a background action (e.g., a trigger notification), the outcome can't be recorded immediately — the user's reaction will arrive in a different conversation. A **pending outcome** bridges this gap by tracking "I used this template, now I'm waiting for feedback."

```typescript
const pendingOutcomeSchema = z.object({
  id: z.string(),
  templateId: z.string(),

  // What the agent did (enough context for attribution in a different conversation)
  action: z.string(),                 // "Sent morning briefing with top 3 priorities"
  summary: z.string(),               // Short label for the index: "Morning briefing sent 2h ago"
  sourceConversationId: z.string(),  // Background conversation where template was used
  triggerId: z.string().optional(),  // If trigger-initiated

  // Lifecycle
  status: z.enum(['pending', 'resolved', 'expired']),
  createdAt: z.string(),
  expiresAt: z.string(),             // Auto-expire if no feedback within window
  resolvedAt: z.string().optional(),
  resolvedOutcomeId: z.string().optional(), // Links to the outcome record once resolved
});

type PendingOutcome = z.infer<typeof pendingOutcomeSchema>;
```

**How it works:**

1. **Background agent uses template** → creates a pending outcome alongside the notification
2. **Pending outcome appears in the behavioral index** in ALL subsequent conversations
3. **User replies in active thread** → agent sees the pending outcome in its context, recognizes the reply relates to it
4. **Agent calls `behavioral.recordOutcome`** with the pending outcome ID → resolves it, records the signal
5. **If no feedback arrives** → pending outcome expires after a configurable window (default: 24h), recorded as `neutral`

This solves the cross-conversation attribution problem without complex conversation linking — the agent does the attribution using its semantic understanding of the user's reply and the pending outcome's description.

---

## Database Schema

### Migration: `xxx_behavioral_memory.ts`

```sql
-- Behavioral templates
CREATE TABLE behavioral_templates (
  id TEXT PRIMARY KEY,

  -- Situation (what this template covers)
  situation_description TEXT NOT NULL,
  situation_category TEXT NOT NULL,
  trigger_patterns TEXT NOT NULL DEFAULT '[]',   -- JSON array

  -- Strategy (current playbook)
  strategy TEXT NOT NULL,                        -- JSON: {approach, guidelines, tone, timing, parameters}

  -- Evidence (accumulated outcomes)
  total_interactions INTEGER NOT NULL DEFAULT 0,
  positive_outcomes INTEGER NOT NULL DEFAULT 0,
  negative_outcomes INTEGER NOT NULL DEFAULT 0,
  neutral_outcomes INTEGER NOT NULL DEFAULT 0,
  last_outcomes TEXT NOT NULL DEFAULT '[]',      -- JSON array, rolling window (max 20)
  confidence_score REAL NOT NULL DEFAULT 0.3,

  -- Retrieval
  embedding BLOB,
  activation_score REAL NOT NULL DEFAULT 0.5,

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_matched_at TEXT
);

CREATE INDEX idx_bt_category ON behavioral_templates(situation_category);
CREATE INDEX idx_bt_status ON behavioral_templates(status);
CREATE INDEX idx_bt_activation ON behavioral_templates(activation_score DESC);
CREATE INDEX idx_bt_confidence ON behavioral_templates(confidence_score DESC);

-- Outcome records (action results)
CREATE TABLE behavioral_outcomes (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES behavioral_templates(id),

  action TEXT NOT NULL,
  signal TEXT NOT NULL,              -- 'positive', 'negative', 'neutral', 'correction'
  detail TEXT NOT NULL,
  strategy_change TEXT,              -- What the agent changed about the strategy (if anything)
  context TEXT NOT NULL DEFAULT '{}', -- JSON

  created_at TEXT NOT NULL
);

CREATE INDEX idx_bo_template ON behavioral_outcomes(template_id);
CREATE INDEX idx_bo_signal ON behavioral_outcomes(signal);
CREATE INDEX idx_bo_created ON behavioral_outcomes(created_at DESC);

-- Pending outcomes (awaiting user feedback, cross-conversation)
CREATE TABLE behavioral_pending_outcomes (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES behavioral_templates(id),

  action TEXT NOT NULL,                      -- What the agent did
  summary TEXT NOT NULL,                     -- Short label for index display
  source_conversation_id TEXT NOT NULL,      -- Where template was used
  trigger_id TEXT,                           -- If trigger-initiated

  status TEXT NOT NULL DEFAULT 'pending',    -- 'pending', 'resolved', 'expired'
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_outcome_id TEXT REFERENCES behavioral_outcomes(id)
);

CREATE INDEX idx_bpo_status ON behavioral_pending_outcomes(status);
CREATE INDEX idx_bpo_expires ON behavioral_pending_outcomes(expires_at);
```

---

## Template Lifecycle

### 1. Template Creation

Templates are created when the agent acts in a situation without a matching template:

```typescript
const createTemplateFromAction = async (
  action: string,
  situation: string,
  outcome: OutcomeRecord,
): Promise<BehavioralTemplate> => {
  // LLM generates initial template from the action and outcome
  const template = await llm.invoke(TEMPLATE_CREATION_PROMPT, {
    action,
    situation,
    outcome: outcome.detail,
    signal: outcome.signal,
  });

  // Generate embedding from situation description for future matching
  const embedding = await embeddings.generate(template.situation.description);

  return {
    ...template,
    embedding,
    activationScore: 0.5,
    status: 'active',
    evidence: {
      totalInteractions: 1,
      positiveOutcomes: outcome.signal === 'positive' ? 1 : 0,
      negativeOutcomes: outcome.signal === 'negative' ? 1 : 0,
      neutralOutcomes: outcome.signal === 'neutral' ? 1 : 0,
      lastOutcomes: [{ timestamp: outcome.createdAt, signal: outcome.signal, detail: outcome.detail }],
      confidenceScore: 0.3,  // Low confidence on first interaction
    },
  };
};
```

### 2. Template Matching (Agent-Driven)

The agent always sees the behavioral index in its context (see [Context Builder Integration](#context-builder-integration)). This is a compact list of template titles, categories, and confidence scores. The agent decides itself whether any template is relevant.

When the agent identifies a match, it fetches the full template using the `behavioral.getTemplate` tool. This returns the complete strategy, guidelines, and evidence history.

```
Example agent reasoning:

  I'm about to send a morning briefing notification.
  My behavioral index shows: "Morning briefing" (planning, confidence: 0.8)
  That matches — let me fetch the full template.

  [calls behavioral.getTemplate with id]

  Template says: "Top 3 priorities, sent at 7:30am, casual tone"
  Confidence is 0.8 — strategy is working well, I'll follow it closely.

  If confidence were low (say 0.3), I might try a variation:
  "Last few briefings got neutral reactions. Let me try including
   a motivational insight this time and see if that improves engagement."
  → After observing the outcome, I'd update the strategy accordingly.
```

If no template in the index seems relevant, the agent acts on best judgment. After observing the outcome, it creates a new template to capture what it did.

This mirrors the memory consolidation pattern: the memory index shows entity names and open loop topics in context, and the agent decides when to drill down with the recall tool.

### 4. Outcome Recording

Outcomes are recorded differently depending on whether the user can respond immediately or not:

**Same-conversation actions** (e.g., user asks a question, agent responds):
The agent observes the user's reaction in the same conversation and records the outcome directly.

**Background actions** (e.g., trigger fires, sends notification):
The agent can't observe the user's reaction because it's in a background conversation. Instead, it creates a **pending outcome**. This pending outcome appears in the behavioral index in all subsequent conversations. When the user's reply arrives (in any conversation), the agent resolves the pending outcome.

```typescript
// Same-conversation: record outcome and optionally refine strategy
const recordOutcome = async (
  templateId: string,
  action: string,
  signal: OutcomeSignal,
  detail: string,
  strategyChange: string | undefined,
  context: OutcomeContext,
): Promise<void> => {
  const outcome: OutcomeRecord = {
    id: generateId(),
    templateId,
    action,
    signal,
    detail,
    strategyChange,
    context,
    createdAt: new Date().toISOString(),
  };

  await store.saveOutcome(outcome);
  await store.incrementOutcome(templateId, signal);
  await store.appendToLastOutcomes(templateId, outcome, { maxSize: 20 });

  // If the agent decided to refine the strategy based on this outcome,
  // apply the change immediately
  if (strategyChange) {
    await store.updateStrategy(templateId, strategyChange);
    await store.recalculateConfidence(templateId);
  }
};

// Background action: create pending outcome
const createPendingOutcome = async (
  templateId: string,
  action: string,
  summary: string,
  sourceConversationId: string,
  triggerId?: string,
): Promise<PendingOutcome> => {
  return store.savePendingOutcome({
    id: generateId(),
    templateId,
    action,
    summary,
    sourceConversationId,
    triggerId,
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: addHours(new Date(), 24).toISOString(),
  });
};

// When user replies in active thread: resolve pending outcome
const resolvePendingOutcome = async (
  pendingOutcomeId: string,
  signal: OutcomeSignal,
  detail: string,
): Promise<void> => {
  const pending = await store.getPendingOutcome(pendingOutcomeId);

  // Record the actual outcome
  const outcome = await recordOutcome(
    pending.templateId,
    pending.action,
    signal,
    detail,
    { conversationId: undefined, triggerId: pending.triggerId, ... },
  );

  // Resolve the pending outcome
  await store.updatePendingOutcome(pendingOutcomeId, {
    status: 'resolved',
    resolvedAt: new Date().toISOString(),
    resolvedOutcomeId: outcome.id,
  });
};
```

### 5. Strategy Refinement (Organic)

There is no separate evolution step or background experiment engine. The agent refines templates **as part of the natural action-outcome flow**:

1. Agent fetches template, sees evidence history and confidence score
2. **High confidence** → follow the strategy closely
3. **Low confidence** → try a variation (agent decides what to change based on outcome patterns)
4. After observing the outcome, agent records it with an optional `strategyChange`
5. If `strategyChange` is provided, the template strategy is updated immediately

```
Example: Morning briefing with low confidence (0.3)

  Agent fetches template. Sees last 5 outcomes: 3 neutral, 1 negative, 1 positive.
  The positive one was when the briefing was shorter.
  Agent thinks: "I'll try a shorter format — just the top 3 items."
  → Sends short briefing.
  → User replies: "perfect, thanks!"
  → Records outcome: signal=positive, strategyChange="Reduced to top 3 items"
  → Template strategy updated, confidence increases.
```

The agent's in-context judgment replaces formal experiment design. It can see what worked and what didn't in the evidence history, and naturally iterate. Over many interactions, the strategy converges on what works — without experiment objects, hypothesis testing, or conclusion logic.

---

## Agent Integration

### How the Agent Uses Templates

The contextual behavioral index is part of the agent's context (like the memory index). Each conversation gets the top 10 templates most semantically relevant to the current context — so a conversation about health surfaces health-related templates, not planning ones. The agent decides when to fetch a full template. There is no automated pre-action hook — the agent drives the entire flow.

**In context** (top 10 by semantic relevance to conversation):
```
## Behavioral Templates

Relevant templates for this context (6 of 25 total):
- Morning briefing delivery [bt_01] (confidence: 0.8)
- Day plan check-in [bt_05] (confidence: 0.6)
- Task deadline reminders [bt_03] (confidence: 0.5)
- ...

Use behavioral.getTemplate to fetch full details.
Use behavioral.searchTemplates if the template you need isn't listed.
```

**Agent-initiated**: The agent calls `behavioral.getTemplate` when it recognizes a match, and `behavioral.createTemplate` / `behavioral.recordOutcome` after acting.

### Agent Tools

```typescript
const getTemplateTool: ToolDefinition = {
  id: 'behavioral.getTemplate',
  name: 'Get Behavioral Template',
  description: `Fetch the full behavioral template by ID. Use this when you see a
    template in your behavioral index that matches your current situation.
    Returns the complete strategy, guidelines, and evidence history.`,

  inputSchema: z.object({
    templateId: z.string().describe('Template ID from the behavioral index'),
  }),

  outputSchema: z.object({
    template: behavioralTemplateSchema,
  }),

  risk: { level: 'none' },
};

const recordOutcomeTool: ToolDefinition = {
  id: 'behavioral.recordOutcome',
  name: 'Record Behavioral Outcome',
  description: `Record the outcome of an action. Use this in two scenarios:
    1. After taking an action in the current conversation — provide templateId.
    2. When the user's reply relates to a pending outcome from a background action
       (shown in "Awaiting Feedback" in your behavioral index) — provide pendingOutcomeId.
    This feeds into the behavioral learning loop.`,

  inputSchema: z.object({
    // One of these two must be provided
    templateId: z.string().optional().describe('Template ID if recording for current conversation'),
    pendingOutcomeId: z.string().optional().describe('Pending outcome ID if resolving a background action'),
    action: z.string().describe('What the agent did'),
    signal: outcomeSignalSchema.describe('User reaction'),
    detail: z.string().describe('What happened — user response, engagement, etc.'),
    strategyChange: z.string().optional().describe('If you want to refine the strategy based on this outcome, describe the change'),
  }),

  risk: { level: 'low' },
};

const createTemplateTool: ToolDefinition = {
  id: 'behavioral.createTemplate',
  name: 'Create Behavioral Template',
  description: `Create a new behavioral template for a situation type you haven't
    encountered before. Use this after acting in a novel situation to capture
    what you did and how it went.`,

  inputSchema: z.object({
    situation: z.object({
      description: z.string(),
      category: z.string(),
      triggerPatterns: z.array(z.string()),
    }),
    strategy: z.object({
      approach: z.string(),
      guidelines: z.array(z.string()),
      tone: z.string().optional(),
      timing: z.string().optional(),
    }),
    initialOutcome: z.object({
      signal: outcomeSignalSchema,
      detail: z.string(),
    }).optional(),
  }),

  risk: { level: 'low' },
};

const searchTemplatesTool: ToolDefinition = {
  id: 'behavioral.searchTemplates',
  name: 'Search Behavioral Templates',
  description: `Search for behavioral templates by semantic similarity. Use this when
    the template index in your context is truncated and you think there might be a
    relevant template not shown in the index.`,

  inputSchema: z.object({
    query: z.string().describe('Description of the situation to search for'),
    limit: z.number().optional().default(5),
  }),

  outputSchema: z.object({
    templates: z.array(z.object({
      id: z.string(),
      situationDescription: z.string(),
      category: z.string(),
      confidenceScore: z.number(),
      recentTrend: z.enum(['improving', 'stable', 'declining']).optional(),
      similarity: z.number(),
    })),
  }),

  risk: { level: 'none' },
};
```

### Trigger Integration

When a trigger fires and invokes the agent, the behavioral index is part of the agent's context (same as any conversation). The agent sees its templates and decides whether any apply to the trigger's goal. No special trigger-specific lookup is needed — the pattern is the same everywhere.

---

## Outcome Signal Detection

Not all signals need explicit agent recording. Some can be detected automatically:

### Explicit Signals (Agent Records)
- User says "thanks", "great", "helpful" → `positive`
- User says "stop", "don't", "wrong" → `negative` or `correction`
- User provides explicit feedback → `correction`

### Implicit Signals (System Detects)
- **Notification ignored** (no reply within threshold): `neutral` → if pattern repeats, `negative`
- **Quick reply to notification**: `positive` (engaged)
- **User immediately changes topic**: `neutral`
- **User asks follow-up questions**: `positive` (found it useful)
- **Conversation length after agent action**: longer = more engaged

```typescript
const detectImplicitSignal = (
  agentAction: string,
  conversationAfter: Message[],
  timeSinceAction: number,
): OutcomeSignal | null => {
  // For trigger notifications
  if (isNotification(agentAction)) {
    if (conversationAfter.length === 0 && timeSinceAction > 3600000) {
      return 'neutral'; // Ignored for 1+ hour
    }
    if (conversationAfter.length > 0 && timeSinceAction < 300000) {
      return 'positive'; // Quick engagement
    }
  }

  // For proactive suggestions
  if (isSuggestion(agentAction)) {
    const userReplies = conversationAfter.filter(m => m.role === 'user');
    if (userReplies.some(m => containsPositiveSentiment(m.content))) {
      return 'positive';
    }
    if (userReplies.some(m => containsNegativeSentiment(m.content))) {
      return 'negative';
    }
  }

  return null;
};
```

---

## Context Builder Integration

The behavioral index is built per-conversation using **semantic search** against the conversation context (user model, recent messages, calendar, active topics). This surfaces the most relevant templates — not all of them. The index is bounded to 10 templates to keep the token budget low (~200-300 tokens).

```typescript
const buildBehavioralContext = async (
  behavioralService: BehavioralMemoryService,
  conversationContext: string,  // Summary of current conversation state
): Promise<string> => {
  const pendingOutcomes = await behavioralService.getPendingOutcomes();
  const totalTemplates = await behavioralService.getTemplateCount();

  const parts: string[] = ['## Behavioral Templates\n'];

  // Pending outcomes first — these need attention
  if (pendingOutcomes.length > 0) {
    parts.push('### Awaiting Feedback');
    parts.push('When the user\'s response relates to one of these, record the outcome.\n');
    for (const po of pendingOutcomes) {
      const ago = formatTimeAgo(po.createdAt);
      parts.push(`- **${po.summary}** [pending:${po.id}] (template: ${po.templateId}, ${ago})`);
    }
    parts.push('');
  }

  if (totalTemplates === 0 && pendingOutcomes.length === 0) {
    return '## Behavioral Templates\n\nNo behavioral templates yet.\n';
  }

  if (totalTemplates > 0) {
    // Semantic search: find top 10 templates relevant to current context
    const contextEmbedding = await embeddings.generate(conversationContext);
    const relevant = await behavioralService.searchTemplates(contextEmbedding, { limit: 10 });

    parts.push(`Relevant templates (${relevant.length} of ${totalTemplates} total):`);
    for (const t of relevant) {
      const confidence = t.evidence.confidenceScore.toFixed(1);
      parts.push(`- ${t.situation.description} [${t.id}] (confidence: ${confidence})`);
    }
    parts.push('');
    parts.push('Use behavioral.getTemplate to fetch full strategy. Use behavioral.searchTemplates if needed template isn\'t listed.');
  }

  return parts.join('\n');
};
```

### Example Context Output

```
## Behavioral Templates

### Awaiting Feedback
When the user's response relates to one of these, record the outcome.

- **Morning briefing sent** [pending:po_01] (template: bt_01, 2 hours ago)

Relevant templates (6 of 25 total):
- Morning briefing delivery [bt_01] (confidence: 0.8)
- Day plan check-in [bt_05] (confidence: 0.6)
- Task deadline reminders [bt_03] (confidence: 0.5)
- Project status updates [bt_06] (confidence: 0.3)
- Calendar event preparation [bt_11] (confidence: 0.7)
- Focus time suggestions [bt_14] (confidence: 0.4)

Use behavioral.getTemplate to fetch full strategy. Use behavioral.searchTemplates if needed template isn't listed.
```

### Token Budget

The index is designed to be lightweight:
- **Pending outcomes**: ~30 tokens each, max 10 = ~300 tokens worst case
- **Template entries**: ~20 tokens each, max 10 = ~200 tokens
- **Chrome** (headers, instructions): ~50 tokens
- **Total**: ~350-550 tokens per conversation

This is comparable to the memory index budget (~500-800 tokens).

---

## Example Scenarios

### Scenario 1: Morning Briefing Optimization

```
Day 1: Agent sends morning briefing at 8am with 10 items
        User reads it but doesn't respond → neutral
        → Template created: "Morning briefing, 10 items, 8am"

Day 3: Template matched again, neutral again. Confidence still low (0.3).
Day 5: Template matched. Agent sees 4 neutrals in evidence.
        Thinks: "10 items might be too much. Let me try top 3."
        → Sends short briefing.
        User replies: "perfect, thanks!" → positive
        → Records outcome with strategyChange: "Reduced to top 3 items"
        → Template updated, confidence bumps to 0.45

Day 7: Short briefing. User replies with follow-up question → positive
        → Confidence rises to 0.6

Day 10: Agent sees confidence is reasonable but wonders about timing.
         Tries sending at 7:30am instead of 8am.
         User reads, no response → neutral
         → No strategy change this time. Sticks with 8am.
```

### Scenario 2: Proactive Health Check-In (Cross-Conversation)

This scenario shows how pending outcomes bridge background triggers and user replies:

```
Week 1: [Background trigger conversation]
         Trigger checks Oura data, fetches template "Sleep data notification"
         Template says: "Notify about poor sleep"
         Agent sends notification: "You slept poorly last night"
         → Creates pending outcome: "Sleep alert sent" [pending:po_05]

         [Active Telegram conversation — 20 minutes later]
         Agent context shows: "Awaiting Feedback: Sleep alert sent [pending:po_05] (20 min ago)"
         User: "I know, please don't tell me when I sleep badly"
         Agent recognizes this relates to pending:po_05
         → Calls behavioral.recordOutcome(pendingOutcomeId: "po_05", signal: "correction",
             strategyChange: "Don't notify about individual poor sleep nights")
         → Template strategy updated immediately

Week 2: [Background trigger]
         Oura shows poor sleep. Template matched → strategy says don't notify.
         Agent suppresses notification (follows template).
         → No pending outcome created (correct non-action)

Week 3: [Background trigger]
         Oura shows 3 days of declining sleep trend.
         Agent sees template confidence is low (0.4) and only has one data point.
         Thinks: "The correction was about single nights. A multi-day trend is different."
         Agent sends: "I've noticed a 3-day declining sleep trend..."
         → Creates pending outcome: "Sleep trend alert sent" [pending:po_09]

         [Active Telegram conversation — 5 minutes later]
         Agent context shows: "Awaiting Feedback: Sleep trend alert [pending:po_09] (5 min ago)"
         User: "Oh interesting, I hadn't noticed. Thanks"
         → Resolves pending:po_09 as positive
         → strategyChange: "Notify on trends (3+ days), not single nights"
         → Template confidence increases
```

### Scenario 3: Task Reminder Calibration

```
Interaction 1: Agent proactively reminds about a task due tomorrow
               User: "Yeah I know, stop reminding me about things I already know"
               → negative/correction → Template: "Only remind about forgotten tasks"

Interaction 2: Agent holds back a reminder. Task was completed on time.
               → No signal (can't record what didn't happen — this is fine)

Interaction 3: User misses a deadline
               User: "Why didn't you remind me?!"
               → correction → Template updates:
                 "Remind about tasks that haven't shown recent activity,
                  but not tasks the user has been actively working on"
               → Confidence increases (now has two calibration points)
```

---

## Background Jobs

### Template Maintenance Job

The background job handles housekeeping — strategy refinement happens organically during agent interactions, not here.

```typescript
const MAINTENANCE_SCHEDULE = '0 2 * * *';  // 2 AM daily

const runTemplateMaintenance = async (services: Services): Promise<void> => {
  const behavioralService = services.get(BehavioralMemoryService);

  // 1. Decay activation on unmatched templates
  await behavioralService.applyActivationDecay();

  // 2. Expire stale pending outcomes (no feedback within window)
  const expired = await behavioralService.expirePendingOutcomes();
  // Expired pending outcomes are recorded as 'neutral' — no signal is a signal
  for (const pending of expired) {
    await behavioralService.recordOutcome(pending.templateId, pending.action, 'neutral',
      'No user feedback within expiration window', undefined, {});
  }

  // 3. Retire consistently poor templates
  const poorTemplates = await behavioralService.findPoorTemplates({
    minInteractions: 10,
    maxPositiveRate: 0.1,
  });
  for (const template of poorTemplates) {
    await behavioralService.retire(template.id);
  }
};
```

### Template Activation Decay

Reuses the same decay mechanism as memory consolidation:

```typescript
// Templates that aren't matched decay over time
// Decay rate: 1% per day (slower than memories — behaviors are more stable)
const TEMPLATE_DECAY_RATE = 0.01;
```

---

## Configuration

```typescript
const behavioralMemoryConfigSchema = z.object({
  // Index (semantic search per conversation)
  maxTemplatesInIndex: z.number().default(10),         // Top N from semantic search
  maxPendingInIndex: z.number().default(10),           // Max pending outcomes shown

  // Evidence
  lastOutcomesWindowSize: z.number().default(20),     // Rolling window of recent outcomes

  // Lifecycle
  activationDecayRate: z.number().default(0.01),      // 1% per day
  retirementThreshold: z.number().default(0.1),       // Positive rate below this → retire candidate
  retirementMinInteractions: z.number().default(10),  // Need this many before retiring

  // Pending outcomes
  pendingOutcomeExpirationHours: z.number().default(24),     // Auto-expire after this
  maxPendingOutcomes: z.number().default(10),                 // Max shown in index

  // Implicit signals
  notificationIgnoreThresholdMs: z.number().default(3600000), // 1 hour
  quickEngagementThresholdMs: z.number().default(300000),     // 5 minutes
});

type BehavioralMemoryConfig = z.infer<typeof behavioralMemoryConfigSchema>;
```

---

## Implementation Phases

### Phase 1: Data Model & Storage

- [ ] Create `behavioral_templates` migration
- [ ] Create `behavioral_outcomes` migration
- [ ] Implement `BehavioralTemplateStore` with CRUD operations
- [ ] Implement embedding-based template search
- [ ] Unit tests for store operations

### Phase 2: Template Index & Tools

- [ ] Implement `getTemplateCount()` and `searchTemplates()` for index generation
- [ ] Implement `getTemplate()` for full template fetch
- [ ] Implement `createTemplate()` — LLM-assisted template creation from action + outcome
- [ ] Implement `searchTemplates()` — embedding-based search for overflow
- [ ] Add `behavioral.getTemplate` tool
- [ ] Add `behavioral.createTemplate` tool
- [ ] Add `behavioral.searchTemplates` tool
- [ ] Unit tests for index generation, fetch, and creation

### Phase 3: Outcome Recording & Pending Outcomes

- [ ] Implement `recordOutcome()` — save outcome and update template evidence
- [ ] Implement `createPendingOutcome()` — for background/trigger actions
- [ ] Implement `resolvePendingOutcome()` — link pending to actual outcome
- [ ] Implement pending outcome expiration (auto-neutral after window)
- [ ] Add `behavioral.recordOutcome` tool (supports both direct and pending resolution)
- [ ] Wire pending outcome creation into trigger notification flow
- [ ] Unit tests for outcome tracking and pending outcome lifecycle

### Phase 4: Template Maintenance

- [ ] Implement activation decay for templates
- [ ] Implement pending outcome expiration
- [ ] Implement template retirement logic
- [ ] Schedule maintenance job
- [ ] Integration tests for maintenance flow

### Phase 5: Context Builder Integration

- [ ] Implement `buildBehavioralContext()` — semantic search index for agent context
- [ ] Include pending outcomes in behavioral index ("Awaiting Feedback" section)
- [ ] Integrate behavioral index into context builder
- [ ] Add tool set registration for behavioral tools
- [ ] Flow tests with MSW mocks (including cross-conversation pending outcome resolution)

### Phase 6: Implicit Signal Detection

- [ ] Implement notification engagement tracking
- [ ] Implement conversation-based signal detection
- [ ] Wire implicit signals into outcome recording
- [ ] Integration tests for signal detection

### Phase 7: Migration & Cleanup

- [x] Migrate existing `feedback` memories into initial behavioral templates
- [x] Deprecate `feedback` memory type
- [x] Remove feedback-related tools/prompts

### Phase 8: Testing & Tuning

- [x] End-to-end flow tests in `test/flows/`
- [x] Tune semantic search relevance for index generation
- [ ] Tune confidence score calculation (deferred — needs real usage data)
- [ ] Tune implicit signal thresholds (deferred — Phase 6 not yet implemented)
- [x] Documentation

---

## Module Organization

```
src/agent/behavioral/
├── behavioral.ts              # Public API (BehavioralMemoryService)
├── behavioral.schemas.ts      # Zod schemas
├── behavioral.types.ts        # Additional types
├── behavioral.store.ts        # Database operations
├── behavioral.tools.ts        # Agent tools
├── behavioral.signals.ts      # Implicit signal detection
├── behavioral.maintenance.ts  # Background maintenance job
├── behavioral.test.ts         # Tests
```

---

## Future Considerations

1. **Template Hierarchies**: Templates could have parent-child relationships — a "notifications" parent with "morning briefing" and "health alert" children inheriting base strategy. Not needed for v1 where template count is low.

2. **Behavioral Profiles**: Group templates into named profiles (e.g., "work mode", "weekend mode") that activate based on context. Currently, templates are individually matched — profiles could add a layer of coordination.

3. **Feedback Elicitation**: Proactively ask the user "Was this helpful?" after actions where the signal is ambiguous. Should be rare and well-timed to avoid being annoying.

4. **Template Sharing Between Situations**: If two templates develop similar strategies, consider merging them into a more general template. Requires similarity detection between template strategies, not just situations.

5. **Confidence Visualization**: Show the user a dashboard of behavioral templates with confidence scores and outcome history. Useful for debugging and trust-building.

6. **Cross-System Learning**: Feed behavioral insights back into the personality system — if templates consistently show the user prefers brief responses, adjust global verbosity.
