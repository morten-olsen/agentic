# GLaDOS - Future Phases Specification

> This document describes planned future capabilities for GLaDOS that extend beyond the initial implementation.

## Overview

The initial GLaDOS implementation (Phases 1-7) provides a complete personal AI assistant with:
- User model, contacts, calendar, and location awareness
- Conversational interaction via CLI and Telegram
- Risk-gated tool execution with human-in-the-loop
- Persistent memory with semantic search
- Long-running task management
- Proactive scheduling and notifications
- Dynamic tool discovery

This document specifies two additional phases that will extend GLaDOS with reactive event processing and advanced learning capabilities.

---

## Phase 8: Reactive Events

### Overview

Reactive events allow GLaDOS to respond to external triggers beyond scheduled checks. This includes webhooks, message queues, and integration with external services.

### Goals

1. **Event Ingress**: Unified system for receiving and processing external events
2. **Webhook Support**: HTTP endpoints for external services to trigger actions
3. **Event Routing**: Route events to appropriate handlers based on type and content
4. **Rate Limiting**: Prevent abuse and manage processing load

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Event Ingress                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   Webhook    │  │   Message    │  │   Polling    │       │
│  │   Receiver   │  │    Queue     │  │   Adapters   │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
│         │                 │                 │                │
│         └─────────────────┼─────────────────┘                │
│                           ▼                                  │
│                  ┌─────────────────┐                        │
│                  │  Event Router   │                        │
│                  │  (type-based)   │                        │
│                  └────────┬────────┘                        │
│                           │                                  │
│         ┌─────────────────┼─────────────────┐               │
│         ▼                 ▼                 ▼               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Handler    │  │   Handler    │  │   Handler    │      │
│  │   (email)    │  │  (calendar)  │  │   (custom)   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Module Structure

```
src/ingress/
├── ingress.ts              # Main IngressService
├── ingress.schemas.ts      # Event types, handler types
├── ingress.store.ts        # Event history, deduplication
├── ingress.router.ts       # Event routing logic
├── ingress.errors.ts       # Custom errors
├── ingress.webhook.ts      # HTTP webhook server
└── ingress.test.ts
```

### Types

```typescript
type EventSource = 'webhook' | 'poll' | 'push' | 'internal';

type IngressEvent = {
  id: string;
  source: EventSource;
  type: string;              // e.g., 'email.received', 'calendar.updated'
  payload: unknown;
  receivedAt: string;
  processedAt?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  metadata?: Record<string, unknown>;
};

type EventHandler = {
  id: string;
  eventType: string;         // Pattern matching, e.g., 'email.*'
  enabled: boolean;
  priority: number;
  handler: (event: IngressEvent) => Promise<EventResult>;
};

type EventResult = {
  handled: boolean;
  actions?: string[];        // Actions taken
  notifications?: string[];  // Notifications created
  tasks?: string[];          // Tasks created
};
```

### Webhook Server

```typescript
// Webhook configuration
type WebhookConfig = {
  enabled: boolean;
  port: number;
  basePath: string;          // e.g., '/webhooks'
  secretHeader: string;      // e.g., 'X-Webhook-Secret'
  rateLimitPerMinute: number;
};

// Webhook endpoint registration
type WebhookEndpoint = {
  id: string;
  path: string;              // e.g., '/github'
  secret: string;            // Shared secret for verification
  eventType: string;         // Maps to internal event type
  enabled: boolean;
  createdAt: string;
};
```

### Implementation Checklist

- [ ] Event ingress system with unified event type
- [ ] Event router with pattern-based handler matching
- [ ] Webhook HTTP server with signature verification
- [ ] Event deduplication and idempotency
- [ ] Rate limiting per source
- [ ] Event history and replay capability
- [ ] Built-in handlers for common event types

### Out of Scope (for this phase)

- Email integration (requires IMAP/SMTP complexity)
- Calendar sync with external providers (Google, Outlook)
- Real-time websocket connections

---

## Phase 9: Learning & Refinement

### Overview

Learning & Refinement enables GLaDOS to improve over time through feedback processing, memory consolidation, and pattern extraction.

### Goals

1. **Feedback Processing**: Learn from explicit corrections and implicit signals
2. **Memory Consolidation**: Merge, prune, and organize accumulated memories
3. **Preference Learning**: Extract and apply user preferences automatically
4. **Pattern Extraction**: Identify recurring themes and behaviors
5. **Model Selection Optimization**: Choose appropriate models based on task history

### Memory Consolidation Strategy

Memory consolidation runs periodically and uses a tiered approach:

#### Tier 1: Conversation Summarization (after each conversation)

```typescript
type ConversationSummary = {
  keyTopics: string[];
  decisionsReached: string[];
  actionsTaken: string[];
  openItems: string[];
  extractedFacts: string[];
  extractedPreferences: string[];
};
```

Process:
1. Generate summary using LLM
2. Extract facts and preferences as separate memory entries
3. Store summary, link to original messages
4. Original messages retained for 30 days, then pruned

#### Tier 2: Fact Deduplication (daily)

1. Group memories by type and semantic similarity (cosine > 0.85)
2. For each cluster:
   - If memories are complementary, merge into richer entry
   - If memories conflict, keep most recent, flag for review
   - Update importance = max(cluster importance)

```typescript
type MergeResult = {
  kept: string;              // ID of surviving memory
  merged: string[];          // IDs that were merged in
  conflict?: {
    entries: string[];
    requiresReview: boolean;
  };
};
```

#### Tier 3: Importance Decay (weekly)

```typescript
const decayImportance = (memory: MemoryEntry): number => {
  const daysSinceAccess = daysBetween(memory.lastAccessedAt, now());
  const decayRate = 0.95;    // 5% decay per week
  const minImportance = 0.1; // Floor to prevent complete loss

  const decayed = memory.importance * Math.pow(decayRate, daysSinceAccess / 7);
  return Math.max(decayed, minImportance);
};
```

Memories below threshold (0.2) for 90+ days are candidates for pruning.

#### Tier 4: Pattern Extraction (monthly)

LLM-based reflection to extract higher-level patterns:

```typescript
type PatternExtraction = {
  prompt: `Analyze these memories and extract higher-level patterns,
           recurring themes, and general principles about the user.`;
  input: MemoryEntry[];      // Recent high-importance memories
  output: {
    patterns: string[];
    principles: string[];
    suggestions: string[];   // Proactive improvements
  };
};
```

Extracted patterns become high-importance `procedure` or `preference` memories.

### Feedback Processing

```typescript
type FeedbackType =
  | 'correction'      // User corrected agent behavior
  | 'preference'      // User expressed preference
  | 'rating'          // Explicit thumbs up/down
  | 'implicit';       // Derived from behavior (edits, rejections)

type Feedback = {
  id: string;
  type: FeedbackType;
  context: string;           // What was happening
  content: string;           // The feedback itself
  applied: boolean;          // Has this been processed?
  resultingMemories?: string[]; // Memories created from this
  createdAt: string;
};
```

### Learning Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│                     Learning Pipeline                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐                                           │
│  │   Feedback   │ ◀── Corrections, ratings, implicit signals│
│  │   Collector  │                                           │
│  └──────┬───────┘                                           │
│         │                                                    │
│         ▼                                                    │
│  ┌──────────────┐                                           │
│  │   Pattern    │ ◀── Similar feedback clusters             │
│  │   Detector   │                                           │
│  └──────┬───────┘                                           │
│         │                                                    │
│         ▼                                                    │
│  ┌──────────────┐                                           │
│  │   Memory     │ ──▶ New preferences, procedures           │
│  │   Creator    │                                           │
│  └──────┬───────┘                                           │
│         │                                                    │
│         ▼                                                    │
│  ┌──────────────┐                                           │
│  │   Behavior   │ ──▶ Updated agent behavior                │
│  │   Updater    │                                           │
│  └──────────────┘                                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Module Structure

```
src/learning/
├── learning.ts             # Main LearningService
├── learning.schemas.ts     # Feedback, pattern types
├── learning.store.ts       # Feedback storage
├── learning.feedback.ts    # Feedback processing
├── learning.consolidation.ts # Memory consolidation
├── learning.patterns.ts    # Pattern extraction
├── learning.errors.ts      # Custom errors
└── learning.test.ts
```

### Contact Relationship Learning

Track interaction patterns with contacts to improve suggestions:

```typescript
type ContactInteraction = {
  contactId: string;
  type: 'message' | 'meeting' | 'task' | 'mention';
  sentiment?: 'positive' | 'neutral' | 'negative';
  topics?: string[];
  timestamp: string;
};

type RelationshipInsight = {
  contactId: string;
  interactionFrequency: 'daily' | 'weekly' | 'monthly' | 'rare';
  preferredChannels: string[];
  commonTopics: string[];
  relationshipTrend: 'strengthening' | 'stable' | 'fading';
  suggestedActions?: string[];
};
```

### Model Selection Optimization

Learn which model tiers work best for different task types:

```typescript
type ModelUsageRecord = {
  taskType: string;
  modelTier: 'fast' | 'balanced' | 'capable' | 'premium';
  success: boolean;
  latencyMs: number;
  tokenCount: number;
  userSatisfaction?: number; // 1-5 if rated
};

type ModelRecommendation = {
  taskType: string;
  recommendedTier: string;
  confidence: number;
  reasoning: string;
};
```

### Implementation Checklist

- [ ] Feedback collection system
- [ ] Conversation summarization (Tier 1)
- [ ] Fact deduplication (Tier 2)
- [ ] Importance decay (Tier 3)
- [ ] Pattern extraction (Tier 4)
- [ ] Preference learning from corrections
- [ ] Contact relationship tracking
- [ ] Model selection optimization
- [ ] Learning dashboard/insights

---

## Implementation Priority

These phases are designed to be implemented after the core system is stable and in use:

1. **Phase 8 (Reactive Events)** - Enables integration with external services
2. **Phase 9 (Learning)** - Requires accumulated interaction data to be useful

Both phases can be implemented incrementally, starting with the most valuable features.

---

## References

- [Memory Consolidation Research](https://arxiv.org/abs/2304.03442) - Generative Agents paper
- [Preference Learning](https://arxiv.org/abs/2009.01325) - Learning from human feedback
- [Webhook Best Practices](https://webhooks.fyi/)
