# Memory Consolidation

The Memory Consolidation system transforms discrete memories into durable knowledge while maintaining scalable retrieval. This ensures the agent can work effectively with years of accumulated memories.

## Overview

The consolidation system solves two key problems:

1. **Index Bloat**: Thousands of memories make any "table of contents" useless
2. **Unknown Unknowns**: The agent can't search for what it doesn't know exists

### Key Features

- **Activation-Based Decay**: Memories have activation scores that decay over time but boost on access
- **Consolidated Knowledge**: Old memories merge into higher-level insights while preserving detail access
- **Open Loops**: Track unresolved situations that surface when relevant
- **Three-Tier Storage**: Hot (recent), warm (summaries), cold (consolidated only)

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                     Memory Consolidation System                     │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Activation Layer         Open Loops           Consolidated Store  │
│   ├── Score decay          ├── Pattern match    ├── Entity knowledge│
│   ├── Access boosting      ├── Status tracking  ├── Period summaries│
│   └── Tier assignment      └── Hint generation  └── Incremental     │
│                                                      updates        │
│                                                                     │
│   Background Jobs                                                   │
│   ├── Weekly consolidation (Sunday 3 AM)                           │
│   ├── Daily decay (4 AM)                                           │
│   └── Stale loop cleanup                                           │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

## Activation System

Every memory has an activation score (0.0 to 1.0) that determines how likely it is to be surfaced.

### Decay

Scores decay over time using the formula:

```typescript
newScore = currentScore * (1 - dailyDecayRate) ^ daysSinceLastDecay
```

Default decay rate: 2% per day (~50% after 30 days)

### Boosting

Activation is boosted when memories are accessed:

| Event | Boost Amount |
|-------|--------------|
| User mention | +0.4 |
| Agent retrieval | +0.2 |
| Related entity | +0.1 |
| Scheduled event | +0.3 |

### Tiers

Memories are categorized into tiers based on activation:

| Tier | Score Range | Treatment |
|------|-------------|-----------|
| Hot | ≥ 0.5 | Full detail in index |
| Warm | 0.2 - 0.5 | Summaries in index, detail on request |
| Cold | < 0.2 | Only consolidated insights indexed |

## Consolidated Memories

Consolidated memories distill knowledge from multiple source memories.

### Types

| Type | Description |
|------|-------------|
| `entity` | Knowledge about a person, project, place |
| `decision` | A decision with rationale |
| `period` | Summary of a time period |
| `insight` | A learned pattern or lesson |
| `preference` | A preference with evolution history |

### Structure

```typescript
type ConsolidatedMemory = {
  id: string;
  type: ConsolidatedMemoryType;
  content: {
    summary: string;
    structuredData?: Record<string, unknown>;
    keyPoints: string[];
    lessons?: string[];
  };
  timespan: {
    start: string;      // Earliest source memory
    end: string;        // Latest source memory
    consolidatedAt: string;
  };
  sourceMemoryIds: string[];
  sourceMemoryCount: number;
  version: number;
  activationScore: number;
  entityIds: string[];
  topics: string[];
};
```

### Grouping Strategies

Memories are grouped for consolidation by:

1. **Entity**: All memories about the same entity
2. **Topic**: Memories sharing the same topic tags
3. **Temporal**: Memories from the same time period

## Open Loops

Open loops track unresolved situations that should be surfaced when relevant.

### Creating Open Loops

The agent can create open loops when users mention things they're deciding, waiting on, or tracking:

```typescript
await openLoopService.create({
  topic: 'Job offer decision',
  description: 'Deciding whether to accept the Acme Corp offer',
  activationPatterns: ['job', 'offer', 'acme', 'career'],
  staleAfterDays: 30,
});
```

### Pattern Matching

When a user sends a message, the system checks for matching patterns:

```typescript
const matched = await openLoopService.matchMessage('What about that job offer?');
// Returns loops where 'job' or 'offer' matches activationPatterns
```

### Status Lifecycle

```
active → resolved (when concluded)
active → stale (after staleAfterDays without triggering)
stale → active (can be reactivated)
resolved → active (can be reactivated)
```

## Background Jobs

### Consolidation Job

Runs weekly (Sunday at 3 AM by default):

1. Groups unconsolidated memories by entity/topic/period
2. Extracts knowledge using LLM (or default extractor)
3. Creates consolidated memory records
4. Marks source memories as archived

### Decay Job

Runs daily (4 AM by default):

1. Applies activation decay to all memory activation records
2. Applies decay to consolidated memory activation scores
3. Marks stale open loops

### Manual Execution

Jobs can be run manually:

```typescript
const jobService = new ConsolidationJobService(services);

// Run consolidation
const consolidationReport = await jobService.runConsolidation();

// Run decay
const decayReport = await jobService.runDecay();

// Run stale cleanup only
const staleReport = await jobService.runStaleCleanup();
```

## Tools

### Consolidated Memory Tools

| Tool | Description |
|------|-------------|
| `memory.listConsolidated` | List consolidated memories by type |
| `memory.getConsolidated` | Get details of a specific consolidated memory |
| `memory.drillDown` | Access source memories from consolidated |

### Open Loop Tools

| Tool | Description |
|------|-------------|
| `memory.createOpenLoop` | Create a new open loop |
| `memory.getOpenLoop` | Get an open loop by ID |
| `memory.listOpenLoops` | List open loops by status |
| `memory.resolveOpenLoop` | Mark an open loop as resolved |
| `memory.addOpenLoopPattern` | Add activation pattern to a loop |

## Configuration

```typescript
type ConsolidationJobConfig = {
  // Cron schedules
  consolidationSchedule: string;  // Default: '0 3 * * 0' (3 AM Sunday)
  decaySchedule: string;          // Default: '0 4 * * *' (4 AM daily)

  // Behavior
  runOnStart: boolean;            // Run jobs on service start

  // Worker settings
  workerConfig: {
    minMemoriesForConsolidation: number;  // Default: 3
    maxGroupsPerRun: number;               // Default: 50
    maxErrorsBeforeAbort: number;          // Default: 5
    enableEntityConsolidation: boolean;    // Default: true
    enableTopicConsolidation: boolean;     // Default: true
    enableTemporalConsolidation: boolean;  // Default: false
  };
};
```

## Integration

### Starting the Job Service

```typescript
const jobService = new ConsolidationJobService(services, {
  runOnStart: false,
});

// Optionally set custom knowledge extractor
jobService.setKnowledgeExtractor(async (memories, groupKey) => {
  // Use LLM to extract knowledge
  return { summary, structuredData, keyPoints, lessons, supersededInfo };
});

// Start scheduled jobs
await jobService.start();

// Stop when shutting down
await jobService.stop();
```

### Using with External LLM

```typescript
jobService.setKnowledgeExtractor(async (memories, groupKey) => {
  const prompt = buildExtractionPrompt(memories, groupKey);
  const response = await llm.complete(prompt);
  return parseExtractedKnowledge(response);
});

jobService.setEmbeddingGenerator(async (text) => {
  return embeddingService.embed(text);
});
```

## Database Schema

### Tables

- `consolidated_memories` - Stored consolidated knowledge
- `open_loops` - Tracked unresolved situations
- `memory_activation` - Activation scores per memory
- `consolidation_runs` - Job run history

### Memory Table Extensions

```sql
-- Added to memories table
ALTER TABLE memories ADD COLUMN consolidated_into_id TEXT;
ALTER TABLE memories ADD COLUMN index_status TEXT DEFAULT 'hot';
ALTER TABLE memories ADD COLUMN entity_ids TEXT DEFAULT '[]';
ALTER TABLE memories ADD COLUMN topics TEXT DEFAULT '[]';
```

## Troubleshooting

### Jobs Not Running

Check if the service is started:

```typescript
console.log(jobService.isRunning);
console.log(jobService.getNextScheduledTimes());
```

### Memories Not Consolidating

Verify minimum memory threshold:

```typescript
// Default requires 3+ memories to consolidate
const config = { workerConfig: { minMemoriesForConsolidation: 3 } };
```

### Open Loops Not Matching

Check activation patterns are keyword-based:

```typescript
// Good: specific keywords
activationPatterns: ['project', 'alpha', 'deadline']

// Bad: phrases (won't match)
activationPatterns: ['project alpha deadline']
```

### High Memory Activation Not Decaying

Verify last_decay_at is being updated:

```sql
SELECT memory_id, activation_score, last_decay_at
FROM memory_activation
ORDER BY activation_score DESC;
```
