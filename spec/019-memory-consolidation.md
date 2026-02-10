# Memory Consolidation & Scalable Recall Specification

> Long-term memory that scales gracefully over years of use through consolidation, activation-based indexing, and layered retrieval

**Version**: 1.0
**Status**: Draft
**Dependencies**: Memory System (Phase 4), Entity Knowledge

## Overview

The current memory system stores discrete memories with embeddings and retrieves them via semantic search. This works well initially but has two fundamental problems at scale:

1. **Index Bloat**: After years of use, thousands of entities/memories make any "table of contents" useless
2. **Unknown Unknowns**: The agent can't search for what it doesn't know exists - relevant context goes unfound

This spec introduces **Memory Consolidation** (transforming discrete memories into durable knowledge) and **Layered Retrieval** (ensuring the agent can discover relevant context without bloating the base context window).

### Goals

1. **Bounded Context**: Memory index stays ~500-800 tokens regardless of total data volume
2. **Temporal Relevance**: Recent and frequently-accessed memories surface naturally
3. **Consolidated Knowledge**: Old memories merge into higher-level insights while preserving detail access
4. **Proactive Surfacing**: Relevant memories surface automatically based on conversation entities/topics
5. **Graceful Scaling**: System works equally well with 100 memories or 100,000

### Non-Goals (for v1)

- Cross-conversation memory linking (see Conversation Continuity spec)
- Automatic entity resolution ("Alice" = "my sister") - requires separate NLP work
- Memory importance learning from user feedback
- Memory sharing across users

### The "Unknown Unknowns" Problem

```
User: "Should I take that job offer?"

Without this spec:
  Agent: [Doesn't search memory - doesn't know there's relevant context]
  Agent: "What factors are you considering?"

With this spec:
  Agent: [Entity detection: "job offer" → checks open loops]
  Agent: [Finds: Open loop about Acme Corp offer from last week]
  Agent: [Retrieves: Past discussion about career goals, work-life balance preferences]
  Agent: "Last week you mentioned the Acme Corp offer. You were concerned about
          the commute conflicting with your goal to exercise more. Have those
          factors changed?"
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Memory Consolidation System                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                     Dynamic Memory Index                                │ │
│  │  (~500-800 tokens, always in agent context)                            │ │
│  │                                                                         │ │
│  │  ├── Active Entities (high activation, max 15)                         │ │
│  │  ├── Open Loops (unresolved situations, max 10)                        │ │
│  │  ├── Memory Landscape (categories + stats, not items)                  │ │
│  │  └── Session Context (entities mentioned this conversation)            │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    Per-Message Retrieval Layer                          │ │
│  │  (Automatic, cheap, runs on every user message)                        │ │
│  │                                                                         │ │
│  │  1. Extract entities/topics from user message                          │ │
│  │  2. Check open loops for pattern matches                               │ │
│  │  3. Lookup memory hints for matched entities                           │ │
│  │  4. Inject relevant hints into context (~100-300 tokens)               │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    Agent-Initiated Retrieval                            │ │
│  │  (On-demand, when agent needs more detail)                             │ │
│  │                                                                         │ │
│  │  - Full semantic search across all memories                            │ │
│  │  - Drill down into consolidated memories                               │ │
│  │  - Retrieve original source memories                                   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    Background Consolidation                             │ │
│  │  (Periodic job, transforms memories into knowledge)                    │ │
│  │                                                                         │ │
│  │  ├── Entity Consolidation: Merge memories about same entity            │ │
│  │  ├── Period Consolidation: Summarize old time periods                  │ │
│  │  ├── Decision Logging: Extract decisions with rationale                │ │
│  │  └── Activation Decay: Reduce scores for untouched memories            │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Activation Over Recency**: Memories have activation scores that decay over time but boost on access. This surfaces what's relevant, not just what's recent.

2. **Consolidation Preserves Detail**: Original memories are archived, not deleted. Consolidated summaries link back to sources for drill-down.

3. **Three-Tier Storage**:
   - **Hot**: Last 7 days, full detail in index
   - **Warm**: 7-90 days, summaries in index, detail on request
   - **Cold**: >90 days, only consolidated insights indexed

4. **Entity-Triggered Retrieval**: When user mentions an entity, automatically surface relevant memory hints without requiring the agent to explicitly search.

5. **Open Loops as First-Class Concept**: Track unresolved situations explicitly so they can be surfaced when relevant.

---

## Data Model

### Consolidated Memory

```typescript
const consolidatedMemoryTypeSchema = z.enum([
  'entity',      // Knowledge about a person, project, place, etc.
  'decision',    // A decision with rationale and alternatives
  'period',      // Summary of a time period
  'insight',     // A learned pattern or lesson
  'preference',  // A preference with evolution history
]);

type ConsolidatedMemoryType = z.infer<typeof consolidatedMemoryTypeSchema>;

const consolidatedMemorySchema = z.object({
  id: z.string(),
  type: consolidatedMemoryTypeSchema,

  // The distilled knowledge
  content: z.object({
    summary: z.string(),
    structuredData: z.record(z.string(), z.unknown()).optional(),
    keyPoints: z.array(z.string()),
    lessons: z.array(z.string()).optional(),
  }),

  // Temporal info
  timespan: z.object({
    start: z.string(),              // ISO8601 - earliest source memory
    end: z.string(),                // ISO8601 - latest source memory
    consolidatedAt: z.string(),     // ISO8601 - when consolidation happened
  }),

  // Lineage - links to original memories
  sourceMemoryIds: z.array(z.string()),
  sourceMemoryCount: z.number(),

  // Versioning for incremental updates
  version: z.number(),
  supersedesId: z.string().optional(),

  // Activation & retrieval
  embedding: z.array(z.number()).optional(),
  activationScore: z.number().min(0).max(1),
  lastAccessedAt: z.string(),

  // Links
  entityIds: z.array(z.string()),   // Related entity IDs
  topics: z.array(z.string()),      // Topic tags for categorization

  createdAt: z.string(),
  updatedAt: z.string(),
});

type ConsolidatedMemory = z.infer<typeof consolidatedMemorySchema>;
```

### Open Loop

Tracks unresolved situations that should be surfaced when relevant:

```typescript
const openLoopStatusSchema = z.enum(['active', 'resolved', 'stale']);

const openLoopSchema = z.object({
  id: z.string(),
  topic: z.string(),                    // "Job offer decision"
  description: z.string(),              // More detail about the situation

  // Patterns that should trigger surfacing this loop
  activationPatterns: z.array(z.string()),  // ["job", "offer", "Acme", "career"]

  // Links to relevant memories
  linkedMemoryIds: z.array(z.string()),
  linkedConsolidatedIds: z.array(z.string()),

  // Status tracking
  status: openLoopStatusSchema,
  createdAt: z.string(),
  lastTriggeredAt: z.string().optional(),
  resolvedAt: z.string().optional(),

  // Auto-stale after this duration if not triggered
  staleAfterDays: z.number().default(30),
});

type OpenLoop = z.infer<typeof openLoopSchema>;
```

### Activation Score

Added to existing MemoryEntry:

```typescript
// Extension to existing memory schema
const memoryActivationSchema = z.object({
  memoryId: z.string(),
  activationScore: z.number().min(0).max(1),
  lastDecayAt: z.string(),

  // Configurable decay rate (score reduction per day)
  decayRate: z.number().default(0.02),

  // Track what boosted this memory
  boostHistory: z.array(z.object({
    timestamp: z.string(),
    reason: z.enum(['user_mention', 'agent_retrieval', 'related_entity', 'scheduled_event']),
    boostAmount: z.number(),
  })).default([]),
});

type MemoryActivation = z.infer<typeof memoryActivationSchema>;
```

### Dynamic Memory Index

What's included in the agent's base context:

```typescript
const memoryIndexSchema = z.object({
  // High-activation entities (bounded)
  activeEntities: z.array(z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),               // "person", "project", "place"
    snippet: z.string(),            // One-line summary
    activationScore: z.number(),
  })).max(15),

  // Open situations
  openLoops: z.array(z.object({
    id: z.string(),
    topic: z.string(),
    daysSinceCreated: z.number(),
  })).max(10),

  // Category overview (not individual items)
  memoryLandscape: z.object({
    totalMemories: z.number(),
    totalConsolidated: z.number(),
    categories: z.array(z.object({
      name: z.string(),
      count: z.number(),
      lastActivity: z.string(),     // "2 days ago", "3 months ago"
    })),
  }),

  // Built up during conversation
  sessionContext: z.object({
    mentionedEntities: z.array(z.string()),
    retrievedMemoryIds: z.array(z.string()),
    topicsDiscussed: z.array(z.string()),
  }),
});

type MemoryIndex = z.infer<typeof memoryIndexSchema>;
```

### Memory Hint

Lightweight memory reference for per-message injection:

```typescript
const memoryHintSchema = z.object({
  memoryId: z.string(),
  type: z.enum(['memory', 'consolidated', 'open_loop']),
  hint: z.string(),                 // One-line summary
  relevanceScore: z.number(),
  entityMatch: z.string().optional(), // Which entity triggered this
});

type MemoryHint = z.infer<typeof memoryHintSchema>;
```

---

## Database Schema

### Migration: `xxx_memory_consolidation.ts`

```sql
-- Consolidated memories (distilled knowledge from multiple memories)
CREATE TABLE consolidated_memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                       -- 'entity', 'decision', 'period', 'insight', 'preference'

  -- Content (JSON)
  content TEXT NOT NULL,                    -- JSON: {summary, structuredData, keyPoints, lessons}

  -- Temporal
  timespan_start TEXT NOT NULL,
  timespan_end TEXT NOT NULL,
  consolidated_at TEXT NOT NULL,

  -- Lineage
  source_memory_ids TEXT NOT NULL,          -- JSON array of memory IDs
  source_memory_count INTEGER NOT NULL,

  -- Versioning
  version INTEGER NOT NULL DEFAULT 1,
  supersedes_id TEXT REFERENCES consolidated_memories(id),

  -- Retrieval
  embedding BLOB,
  activation_score REAL NOT NULL DEFAULT 0.5,
  last_accessed_at TEXT NOT NULL,

  -- Links (JSON arrays)
  entity_ids TEXT NOT NULL DEFAULT '[]',
  topics TEXT NOT NULL DEFAULT '[]',

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_consolidated_type ON consolidated_memories(type);
CREATE INDEX idx_consolidated_activation ON consolidated_memories(activation_score DESC);
CREATE INDEX idx_consolidated_timespan ON consolidated_memories(timespan_end DESC);

-- Open loops (unresolved situations to track)
CREATE TABLE open_loops (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  description TEXT NOT NULL,

  -- Activation patterns (JSON array of strings)
  activation_patterns TEXT NOT NULL,

  -- Links (JSON arrays)
  linked_memory_ids TEXT NOT NULL DEFAULT '[]',
  linked_consolidated_ids TEXT NOT NULL DEFAULT '[]',

  -- Status
  status TEXT NOT NULL DEFAULT 'active',    -- 'active', 'resolved', 'stale'
  stale_after_days INTEGER NOT NULL DEFAULT 30,

  created_at TEXT NOT NULL,
  last_triggered_at TEXT,
  resolved_at TEXT
);

CREATE INDEX idx_open_loops_status ON open_loops(status);

-- Memory activation scores (extension to memories)
CREATE TABLE memory_activation (
  memory_id TEXT PRIMARY KEY,
  activation_score REAL NOT NULL DEFAULT 0.5,
  decay_rate REAL NOT NULL DEFAULT 0.02,
  last_decay_at TEXT NOT NULL,

  -- Boost history (JSON array)
  boost_history TEXT NOT NULL DEFAULT '[]',

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_memory_activation_score ON memory_activation(activation_score DESC);

-- Track which memories have been consolidated
ALTER TABLE memories ADD COLUMN consolidated_into_id TEXT REFERENCES consolidated_memories(id);
ALTER TABLE memories ADD COLUMN index_status TEXT DEFAULT 'hot';  -- 'hot', 'warm', 'cold', 'archived'

CREATE INDEX idx_memories_index_status ON memories(index_status);
CREATE INDEX idx_memories_consolidated ON memories(consolidated_into_id);

-- Consolidation job tracking
CREATE TABLE consolidation_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,                     -- 'running', 'completed', 'failed'

  -- Stats
  memories_processed INTEGER DEFAULT 0,
  consolidated_created INTEGER DEFAULT 0,
  consolidated_updated INTEGER DEFAULT 0,
  errors TEXT,                              -- JSON array of errors

  created_at TEXT NOT NULL
);
```

---

## Consolidation Process

### Triggers

```typescript
type ConsolidationTrigger =
  | { type: 'scheduled'; interval: 'daily' | 'weekly' }
  | { type: 'threshold'; entityId: string; memoryCount: number }
  | { type: 'age'; memoriesOlderThan: { days: number } }
  | { type: 'manual' };

const DEFAULT_TRIGGERS: ConsolidationTrigger[] = [
  // Weekly full consolidation
  { type: 'scheduled', interval: 'weekly' },

  // When an entity has too many unconsolidated memories
  { type: 'threshold', entityId: '*', memoryCount: 20 },

  // Consolidate memories older than 90 days
  { type: 'age', memoriesOlderThan: { days: 90 } },
];
```

### Phase 1: Grouping

Group related memories for consolidation:

```typescript
type MemoryGroup = {
  groupKey: string;                         // "entity:alice" or "period:2024-Q3"
  memories: MemoryEntry[];
  groupingReason: 'same_entity' | 'same_topic' | 'same_period' | 'semantic_cluster';
};

const groupMemoriesForConsolidation = async (
  memories: MemoryEntry[],
  strategy: 'entity' | 'topic' | 'temporal' | 'semantic',
): Promise<MemoryGroup[]> => {
  // Implementation varies by strategy
  // - entity: Group by linked entity IDs
  // - topic: Group by topic tags
  // - temporal: Group by time period (week/month/quarter)
  // - semantic: Cluster by embedding similarity
};
```

### Phase 2: Extraction

Use LLM to extract structured knowledge:

```typescript
const EXTRACTION_PROMPT = `Analyze the following memories about {entity_or_topic} and extract:

1. **Summary**: A 2-3 sentence overview of what is known
2. **Key Facts**: Structured data (for people: job, location, birthday, etc.)
3. **Key Points**: Important things to remember (bullet points)
4. **Patterns/Lessons**: Any learned patterns or insights
5. **Superseded Info**: Any information that has been updated/replaced

Memories:
{memories}

Respond in JSON format:
{
  "summary": "...",
  "structuredData": { ... },
  "keyPoints": ["...", "..."],
  "lessons": ["...", "..."],
  "supersededInfo": ["...", "..."]
}`;

type ExtractedKnowledge = {
  summary: string;
  structuredData: Record<string, unknown>;
  keyPoints: string[];
  lessons: string[];
  supersededInfo: string[];
};
```

### Phase 3: Synthesis

Create or update consolidated memory:

```typescript
const synthesizeConsolidatedMemory = async (
  group: MemoryGroup,
  extracted: ExtractedKnowledge,
  existing?: ConsolidatedMemory,
): Promise<ConsolidatedMemory> => {
  // If updating existing, merge intelligently
  const content = existing
    ? mergeWithExisting(existing.content, extracted)
    : {
        summary: extracted.summary,
        structuredData: extracted.structuredData,
        keyPoints: extracted.keyPoints,
        lessons: extracted.lessons,
      };

  return {
    id: existing?.id ?? generateId(),
    type: inferConsolidationType(group),
    content,
    timespan: {
      start: minDate(group.memories.map(m => m.createdAt)),
      end: maxDate(group.memories.map(m => m.createdAt)),
      consolidatedAt: new Date().toISOString(),
    },
    sourceMemoryIds: group.memories.map(m => m.id),
    sourceMemoryCount: group.memories.length,
    version: existing ? existing.version + 1 : 1,
    supersedesId: existing?.id,
    embedding: await generateEmbedding(content.summary),
    activationScore: calculateActivation(group.memories),
    lastAccessedAt: new Date().toISOString(),
    entityIds: extractEntityIds(group),
    topics: extractTopics(group),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};
```

### Phase 4: Commit

Store consolidated memory and update source memories:

```typescript
const commitConsolidation = async (
  consolidated: ConsolidatedMemory,
  sourceMemories: MemoryEntry[],
): Promise<void> => {
  await db.transaction(async (trx) => {
    // 1. Store/update consolidated memory
    await trx('consolidated_memories')
      .insert(toRow(consolidated))
      .onConflict('id')
      .merge();

    // 2. Mark source memories as consolidated
    await trx('memories')
      .whereIn('id', sourceMemories.map(m => m.id))
      .update({
        consolidated_into_id: consolidated.id,
        index_status: 'archived',
      });

    // 3. Update activation scores for source memories
    await trx('memory_activation')
      .whereIn('memory_id', sourceMemories.map(m => m.id))
      .update({
        activation_score: 0.1,  // Low but not zero (still searchable)
        updated_at: new Date().toISOString(),
      });
  });
};
```

---

## Activation System

### Score Calculation

```typescript
const ACTIVATION_CONFIG = {
  // Base decay per day (2% daily = ~50% after 30 days)
  dailyDecayRate: 0.02,

  // Boost amounts for different events
  boosts: {
    user_mention: 0.4,        // User explicitly mentions entity
    agent_retrieval: 0.2,     // Agent retrieves memory
    related_entity: 0.1,      // Related entity was mentioned
    scheduled_event: 0.3,     // Calendar event involving entity
  },

  // Thresholds
  hotThreshold: 0.5,          // Score > 0.5 = hot tier
  warmThreshold: 0.2,         // Score 0.2-0.5 = warm tier
  // Score < 0.2 = cold tier

  // Index inclusion threshold
  indexThreshold: 0.3,        // Only entities above this appear in index
};

const applyDecay = (current: number, daysSinceLastDecay: number): number => {
  const decayFactor = Math.pow(1 - ACTIVATION_CONFIG.dailyDecayRate, daysSinceLastDecay);
  return current * decayFactor;
};

const applyBoost = (current: number, reason: keyof typeof ACTIVATION_CONFIG.boosts): number => {
  const boost = ACTIVATION_CONFIG.boosts[reason];
  return Math.min(1.0, current + boost);
};
```

### Decay Job

Runs daily to decay all activation scores:

```typescript
const runActivationDecay = async (): Promise<void> => {
  const now = new Date();

  // Get all memories with activation records
  const activations = await db('memory_activation').select('*');

  for (const activation of activations) {
    const lastDecay = new Date(activation.last_decay_at);
    const daysSince = (now.getTime() - lastDecay.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSince >= 1) {
      const newScore = applyDecay(activation.activation_score, daysSince);

      await db('memory_activation')
        .where('memory_id', activation.memory_id)
        .update({
          activation_score: newScore,
          last_decay_at: now.toISOString(),
          updated_at: now.toISOString(),
        });
    }
  }

  // Also decay consolidated memories
  await db('consolidated_memories')
    .update({
      activation_score: db.raw('activation_score * ?', [
        Math.pow(1 - ACTIVATION_CONFIG.dailyDecayRate, 1)
      ]),
    });
};
```

---

## Per-Message Retrieval

### Entity Extraction

Fast extraction of entities/topics from user message:

```typescript
type ExtractedEntities = {
  entities: Array<{
    text: string;
    type: 'person' | 'project' | 'place' | 'organization' | 'topic';
    confidence: number;
  }>;
  topics: string[];
};

const extractEntitiesFromMessage = async (
  message: string,
  knownEntities: string[],  // From memory index
): Promise<ExtractedEntities> => {
  // Two-phase extraction:
  // 1. Fast pattern matching against known entities
  // 2. Lightweight NER for unknown entities

  const matched: ExtractedEntities['entities'] = [];

  // Phase 1: Pattern match known entities
  for (const entity of knownEntities) {
    if (message.toLowerCase().includes(entity.toLowerCase())) {
      matched.push({
        text: entity,
        type: 'topic', // Would be enriched from entity data
        confidence: 0.9,
      });
    }
  }

  // Phase 2: Could use a small local model for NER
  // For v1, skip unknown entity detection

  return {
    entities: matched,
    topics: extractTopicKeywords(message),
  };
};
```

### Open Loop Matching

Check if message matches any open loops:

```typescript
const matchOpenLoops = async (
  message: string,
  openLoops: OpenLoop[],
): Promise<OpenLoop[]> => {
  const matched: OpenLoop[] = [];
  const messageLower = message.toLowerCase();

  for (const loop of openLoops) {
    const matchScore = loop.activationPatterns.reduce((score, pattern) => {
      return messageLower.includes(pattern.toLowerCase()) ? score + 1 : score;
    }, 0);

    // Match if at least 2 patterns hit, or 1 high-confidence pattern
    if (matchScore >= 2 || (matchScore >= 1 && loop.activationPatterns.length <= 2)) {
      matched.push(loop);
    }
  }

  return matched;
};
```

### Hint Generation

Generate memory hints for matched entities/loops:

```typescript
const generateMemoryHints = async (
  entities: ExtractedEntities,
  matchedLoops: OpenLoop[],
  maxHints: number = 5,
): Promise<MemoryHint[]> => {
  const hints: MemoryHint[] = [];

  // Hints from open loops (highest priority)
  for (const loop of matchedLoops.slice(0, 2)) {
    hints.push({
      memoryId: loop.id,
      type: 'open_loop',
      hint: `Open: ${loop.topic} (${daysSince(loop.createdAt)} days ago)`,
      relevanceScore: 0.9,
    });
  }

  // Hints from entity matches
  for (const entity of entities.entities) {
    const consolidated = await findConsolidatedForEntity(entity.text);
    if (consolidated) {
      hints.push({
        memoryId: consolidated.id,
        type: 'consolidated',
        hint: consolidated.content.summary.slice(0, 100),
        relevanceScore: entity.confidence,
        entityMatch: entity.text,
      });
    }
  }

  // Sort by relevance and limit
  return hints
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, maxHints);
};
```

---

## Agent Tools

### Memory Index Tool

Always available, returns the dynamic index:

```typescript
const getMemoryIndexTool: ToolDefinition = {
  id: 'memory.getIndex',
  name: 'Get Memory Index',
  description: `Get an overview of available memories and knowledge.
    Returns active entities, open loops, and memory landscape.
    Use this to understand what context is available before searching.`,

  inputSchema: z.object({}),

  outputSchema: memoryIndexSchema,

  risk: { level: 'none' },

  execute: async (_, context) => {
    const memoryService = context.services.get(MemoryConsolidationService);
    return memoryService.getMemoryIndex();
  },
};
```

### Drill-Down Tool

Retrieve original memories from consolidated:

```typescript
const drillDownMemoryTool: ToolDefinition = {
  id: 'memory.drillDown',
  name: 'Drill Down Memory',
  description: `Retrieve the original memories that were consolidated into a summary.
    Use when you need more detail than the consolidated summary provides.`,

  inputSchema: z.object({
    consolidatedId: z.string().describe('ID of the consolidated memory'),
    filter: z.object({
      keywords: z.array(z.string()).optional(),
      limit: z.number().default(10),
    }).optional(),
  }),

  outputSchema: z.object({
    consolidated: z.object({
      summary: z.string(),
      keyPoints: z.array(z.string()),
    }),
    sourceMemories: z.array(z.object({
      id: z.string(),
      date: z.string(),
      content: z.string(),
      type: z.string(),
    })),
  }),

  risk: { level: 'none' },

  execute: async ({ consolidatedId, filter }, context) => {
    const memoryService = context.services.get(MemoryConsolidationService);
    return memoryService.drillDown(consolidatedId, filter);
  },
};
```

### Open Loop Tools

Create and manage open loops:

```typescript
const createOpenLoopTool: ToolDefinition = {
  id: 'memory.createOpenLoop',
  name: 'Create Open Loop',
  description: `Track an unresolved situation that should be surfaced when relevant.
    Use when the user mentions something they're deciding, waiting on, or tracking.`,

  inputSchema: z.object({
    topic: z.string().describe('Brief topic name'),
    description: z.string().describe('What the situation is about'),
    activationPatterns: z.array(z.string()).describe('Keywords that should trigger this'),
    linkedMemoryIds: z.array(z.string()).optional(),
  }),

  outputSchema: z.object({
    id: z.string(),
    created: z.boolean(),
  }),

  risk: { level: 'low' },
};

const resolveOpenLoopTool: ToolDefinition = {
  id: 'memory.resolveOpenLoop',
  name: 'Resolve Open Loop',
  description: 'Mark an open loop as resolved when the situation is concluded.',

  inputSchema: z.object({
    openLoopId: z.string(),
    resolution: z.string().optional().describe('How it was resolved'),
  }),

  risk: { level: 'low' },
};
```

### Enhanced Recall Tool

Updated recall with activation boosting:

```typescript
const recallMemoryTool: ToolDefinition = {
  id: 'memory.recall',
  name: 'Recall Memories',
  description: `Search memories semantically. Results boost activation scores.
    Includes both raw memories and consolidated knowledge.`,

  inputSchema: z.object({
    query: z.string(),
    options: z.object({
      limit: z.number().default(10),
      includeConsolidated: z.boolean().default(true),
      minActivation: z.number().default(0),
      types: z.array(memoryTypeSchema).optional(),
    }).optional(),
  }),

  outputSchema: z.object({
    memories: z.array(z.object({
      id: z.string(),
      type: z.string(),
      content: z.string(),
      isConsolidated: z.boolean(),
      relevanceScore: z.number(),
    })),
  }),

  risk: { level: 'none' },
};
```

---

## Context Builder Integration

### Memory Index Injection

Add memory index to system context:

```typescript
const buildMemoryContext = async (
  memoryService: MemoryConsolidationService,
): Promise<string> => {
  const index = await memoryService.getMemoryIndex();

  const parts: string[] = ['## Memory Context\n'];

  // Active entities
  if (index.activeEntities.length > 0) {
    parts.push('### People & Projects You Know');
    for (const entity of index.activeEntities) {
      parts.push(`- **${entity.name}** (${entity.type}): ${entity.snippet}`);
    }
    parts.push('');
  }

  // Open loops
  if (index.openLoops.length > 0) {
    parts.push('### Open Situations');
    for (const loop of index.openLoops) {
      parts.push(`- ${loop.topic} (${loop.daysSinceCreated} days)`);
    }
    parts.push('');
  }

  // Landscape summary
  parts.push('### Memory Overview');
  parts.push(`Total memories: ${index.memoryLandscape.totalMemories}`);
  parts.push(`Consolidated knowledge: ${index.memoryLandscape.totalConsolidated} summaries`);
  parts.push('Categories: ' + index.memoryLandscape.categories
    .map(c => `${c.name} (${c.count})`)
    .join(', '));

  return parts.join('\n');
};
```

### Per-Message Hint Injection

After entity extraction, inject hints:

```typescript
const injectMemoryHints = (
  hints: MemoryHint[],
  userMessage: string,
): string => {
  if (hints.length === 0) {
    return userMessage;
  }

  const hintText = hints
    .map(h => `- ${h.hint}`)
    .join('\n');

  return `${userMessage}

<memory-context>
Relevant memories detected:
${hintText}
</memory-context>`;
};
```

---

## Background Jobs

### Consolidation Job

```typescript
const CONSOLIDATION_SCHEDULE = '0 3 * * 0';  // 3 AM every Sunday

const runConsolidationJob = async (
  services: Services,
): Promise<ConsolidationReport> => {
  const memoryService = services.get(MemoryConsolidationService);
  const llm = services.get(LLMService);

  const report: ConsolidationReport = {
    id: generateId(),
    startedAt: new Date().toISOString(),
    status: 'running',
    memoriesProcessed: 0,
    consolidatedCreated: 0,
    consolidatedUpdated: 0,
    errors: [],
  };

  try {
    // 1. Entity-based consolidation
    const entitiesNeedingConsolidation = await memoryService.findEntitiesNeedingConsolidation(20);
    for (const entityId of entitiesNeedingConsolidation) {
      await consolidateEntity(memoryService, llm, entityId, report);
    }

    // 2. Age-based consolidation
    const oldMemories = await memoryService.findOldUnconsolidatedMemories(90, 500);
    if (oldMemories.length > 0) {
      await consolidateByPeriod(memoryService, llm, oldMemories, report);
    }

    // 3. Mark stale open loops
    await memoryService.markStaleOpenLoops();

    report.status = 'completed';
    report.completedAt = new Date().toISOString();

  } catch (error) {
    report.status = 'failed';
    report.errors.push(error instanceof Error ? error.message : String(error));
  }

  await memoryService.saveConsolidationReport(report);
  return report;
};
```

### Activation Decay Job

```typescript
const DECAY_SCHEDULE = '0 4 * * *';  // 4 AM daily

const runActivationDecayJob = async (services: Services): Promise<void> => {
  const memoryService = services.get(MemoryConsolidationService);
  await memoryService.applyActivationDecay();
};
```

---

## Configuration

```typescript
const memoryConsolidationConfigSchema = z.object({
  // Index bounds
  maxActiveEntities: z.number().default(15),
  maxOpenLoops: z.number().default(10),
  maxSessionEntities: z.number().default(20),

  // Activation thresholds
  indexActivationThreshold: z.number().default(0.3),
  hotTierThreshold: z.number().default(0.5),
  warmTierThreshold: z.number().default(0.2),

  // Decay settings
  dailyDecayRate: z.number().default(0.02),

  // Consolidation triggers
  entityConsolidationThreshold: z.number().default(20),
  ageConsolidationDays: z.number().default(90),

  // Per-message retrieval
  maxMemoryHints: z.number().default(5),
  hintRelevanceThreshold: z.number().default(0.6),

  // Open loops
  defaultStaleAfterDays: z.number().default(30),
});

type MemoryConsolidationConfig = z.infer<typeof memoryConsolidationConfigSchema>;
```

---

## Implementation Phases

### Phase 1: Activation System

- [ ] Add `memory_activation` table
- [ ] Implement activation scoring and decay
- [ ] Add decay background job
- [ ] Integrate activation boosting into existing recall

### Phase 2: Dynamic Memory Index

- [ ] Implement `getMemoryIndex()` method
- [ ] Add index to context builder
- [ ] Create `memory.getIndex` tool
- [ ] Bound index by activation scores

### Phase 3: Open Loops

- [ ] Add `open_loops` table
- [ ] Implement open loop CRUD
- [ ] Add open loop tools
- [ ] Integrate open loop matching into per-message flow

### Phase 4: Per-Message Retrieval

- [ ] Implement entity extraction from messages
- [ ] Implement open loop pattern matching
- [ ] Generate and inject memory hints
- [ ] Wire into orchestrator message handling

### Phase 5: Consolidation Infrastructure

- [ ] Add `consolidated_memories` table
- [ ] Add consolidation tracking to memories table
- [ ] Implement grouping strategies
- [ ] Implement LLM-based extraction

### Phase 6: Consolidation Process

- [ ] Implement entity consolidation
- [ ] Implement period consolidation
- [ ] Implement incremental updates
- [ ] Add drill-down tool

### Phase 7: Background Jobs

- [ ] Set up consolidation job scheduler
- [ ] Implement full consolidation workflow
- [ ] Add consolidation reporting
- [ ] Add stale open loop cleanup

### Phase 8: Testing & Tuning

- [ ] Unit tests for all components
- [ ] Integration tests for consolidation flow
- [ ] Flow tests in `test/flows/` for per-message retrieval
- [ ] Tune activation decay rates
- [ ] Tune consolidation thresholds

### Phase 9: Documentation

- [ ] Create `docs/memory-consolidation.md` with:
  - Overview of the consolidation system
  - How activation scoring works
  - Open loops usage guide
  - Configuration options
  - Troubleshooting guide
- [ ] Update `docs/debugging.md` with memory inspection commands
- [ ] Update `CLAUDE.md` with memory consolidation summary

---

## Future Considerations

1. **Entity Resolution**: Automatically link "Alice", "my sister", "Alice Smith" to the same entity. Requires NLP work beyond this spec.

2. **Learned Importance**: Use user feedback to adjust memory importance. If user frequently asks about something, boost its activation.

3. **Cross-User Consolidation**: For shared knowledge (not personal), could consolidate across users. Out of scope for personal assistant.

4. **Memory Graphs**: Build relationship graphs between entities based on co-occurrence in memories. Could enable "related to" queries.

5. **Conversation Continuity Integration**: Link consolidated memories to conversation segments when that spec is implemented.

6. **Proactive Surfacing**: Beyond per-message retrieval, periodically analyze context and proactively mention relevant memories.

---

## Testing Strategy

### Unit Tests

Location: `src/agent/memory/**/*.test.ts`

- Activation score calculation and decay
- Memory grouping strategies
- Entity extraction from messages
- Open loop pattern matching
- Memory index generation

### Integration Tests

Location: `src/agent/memory/**/*.test.ts`

- Full consolidation workflow
- Drill-down from consolidated to source
- Per-message hint injection
- Background job execution

### Flow Tests

Location: `test/flows/memory-consolidation.test.ts`

End-to-end tests using MSW to mock LLM responses:

- Entity mention → hints surface → agent uses context
- Open loop created → later triggered → agent references
- Memories accumulate → consolidate → index stays bounded
- Activation decay over simulated time
- Per-message retrieval with entity matching
