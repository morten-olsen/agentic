# Future Ideas

This document captures high-impact improvements to make GLaDOS more "Jarvis-like" - more proactive, more capable, and more personally attuned.

## 1. Messaging Integration

**Status:** Proposed
**Effort:** Medium
**Impact:** Very High
**Leverage:** Unified awareness across all communication channels

### Description

Channel-agnostic messaging awareness and management. Rather than siloed integrations, a unified abstraction over multiple messaging platforms.

**Supported Channels:**
- **Slack**: Workspaces, channels, DMs, threads
- **Signal**: Personal and group chats
- **Email**: Gmail, IMAP (lower priority, but included for completeness)
- **Telegram**: Already exists as a client, extend to read other chats
- **Future**: Discord, WhatsApp, SMS

**Read Operations:**
- Unified inbox across all channels
- Search with semantic understanding
- Summarize unread threads/conversations
- Identify urgent vs non-urgent
- Surface messages needing response
- Track conversation context (who is this person, history)

**Write Operations (high-risk gated):**
- Draft replies with full context
- Compose new messages with appropriate tone per channel
- Schedule sends where supported

**Intelligence:**
- Follow-up tracking ("remind me if Bob doesn't reply in 3 days")
- Cross-channel awareness ("Alice messaged you on Slack and Signal about the same thing")
- Thread summarization for long conversations
- Extract action items from messages
- Contact unification (same person across channels)

### Unified Message Model

```typescript
type Message = {
  id: string;
  channel: 'slack' | 'signal' | 'email' | 'telegram';
  channelId: string;            // workspace/chat/inbox identifier
  threadId?: string;

  from: {
    id: string;
    name: string;
    contactId?: string;         // Link to unified contact
  };

  timestamp: Date;
  content: string;
  contentType: 'text' | 'rich' | 'attachment';

  metadata: {
    isRead: boolean;
    isUrgent: boolean;
    needsResponse: boolean;
    mentionsMe: boolean;
  };
};
```

### Why It Matters

Communication is fragmented across platforms. A personal assistant needs unified awareness:

- "What messages need my attention?" (across all channels)
- "Summarize my unread Slack and Signal messages"
- "Draft a reply to Alice" (agent knows which channel to use)
- "Remind me if I don't hear back from the vendor by Friday" (tracks across channels)
- "Who's been trying to reach me while I was in meetings?"

### Implementation Approach

1. Create `messaging` module with channel abstraction
2. Implement channel adapters:
   - Slack: Bot token + Web API
   - Signal: signal-cli or libsignal bridge
   - Email: IMAP/Gmail API (optional)
3. Unified message storage with channel metadata
4. Contact linking across channels
5. Start read-only, add write with high-risk gating
6. Feed messages into Event Log for reactive triggers (Event Log now implemented)

### Security Considerations

- OAuth2 for Slack
- Signal requires local key management (most sensitive)
- Message content stored locally, never in cloud
- Write operations require human approval
- Per-channel permissions (read-only vs read-write)
- Clear audit trail of all sent messages

---

## 2. Anticipatory Intelligence

**Status:** Proposed
**Effort:** Medium
**Impact:** High
**Leverage:** Key differentiator from reactive chatbots

### Description

Move from reactive (responds to triggers/messages) to anticipatory (proactively identifies opportunities and risks).

**Examples:**
- "You're meeting Bob in 30 min—last time you wanted to follow up on the proposal"
- "You mentioned wanting to exercise more. You have a 2-hour gap this afternoon and the weather is nice"
- "Three emails from Alice this week about project X—might want to schedule a call"
- "Your flight to London is tomorrow but you haven't packed—you usually start the night before"
- "This task has been on your list for 2 weeks and keeps getting pushed"

### Why It Matters

True personal assistants don't just remember—they *anticipate*. This transforms the relationship from "tool I query" to "partner who watches out for me."

### Implementation Approach

1. Create background analysis trigger (runs every few hours)
2. Pattern detection across:
   - Calendar + tasks alignment
   - Memory mentions + upcoming events
   - Contact interaction frequency
   - Task aging and procrastination patterns
   - Goal progress tracking
3. Generate "nudges" as low-urgency notifications
4. Learn from user responses (did they act on the nudge?)

### Pattern Categories

| Category | Example |
|----------|---------|
| Preparation | Meeting prep, travel packing, deadline approach |
| Opportunity | Free time + good weather + stated goals |
| Follow-up | Promised actions, waiting responses |
| Wellness | Overwork detection, exercise gaps, social isolation |
| Relationships | Neglected contacts, interaction patterns |

---

## 3. Research & Execution Skills

**Status:** Proposed
**Effort:** Medium
**Impact:** High
**Leverage:** Skills framework already exists

### Description

Expand the skills system with high-value domain capabilities:

### Research Skill

Deep-dive information gathering:
- Multi-source web fetching (not just single page)
- Synthesis across sources with citation tracking
- Structured output (comparison tables, summaries)
- Source credibility assessment

**Use cases:**
- "Research the best project management tools for small teams"
- "What are the pros and cons of moving to Amsterdam?"
- "Summarize recent developments in AI regulation"

### Code Sandbox Skill

Safe execution environment:
- Run Python/JavaScript for calculations
- Data analysis and visualization
- Quick automation scripts
- File format conversions

**Use cases:**
- "Calculate compound interest on this loan"
- "Parse this CSV and find outliers"
- "Convert these timestamps to my timezone"

### Document Processing Skill

Handle files and documents:
- PDF text extraction and summarization
- Compare two documents for differences
- Extract structured data from unstructured docs
- Generate document outlines

**Use cases:**
- "Summarize this 50-page report"
- "What changed between v1 and v2 of this contract?"
- "Extract all dates and deadlines from this PDF"

### Writing Assistant Skill

Content creation support:
- Draft emails, messages, documents
- Tone adjustment (formal/casual/assertive/diplomatic)
- Expand bullet points into prose
- Editing and proofreading

**Use cases:**
- "Draft a polite decline for this meeting request"
- "Make this message more diplomatic"
- "Turn these notes into a proper proposal"

### Implementation Approach

Each skill follows the existing pattern:
1. Define skill with activation risk level
2. Implement tools with proper schemas
3. Register with SkillRegistry
4. Document usage patterns

---

## 4. Tool Builder Skill

**Status:** Proposed
**Effort:** High
**Impact:** Very High
**Leverage:** Self-extending agent - compound capability growth over time

### Description

A meta-skill that allows the agent to create, test, and deploy new tools and skills. Instead of requiring developer intervention for every new capability, the agent can identify gaps, prototype solutions, and request approval to add them to its permanent toolset.

**Core Capabilities:**
- Sandboxed code execution environment with elevated access
- Access to secrets (API keys, credentials) for integration development
- Framework access (HTTP clients, database connectors, parsers)
- Tool schema generation and validation
- Testing harness for new tools
- Approval workflow for promoting tools to production

### Workflow

```
1. IDENTIFY: Agent recognizes a capability gap
   "I need to fetch stock prices but don't have a tool for that"

2. DESIGN: Agent designs the tool schema
   - Input parameters (ticker symbol, date range)
   - Output format (price history, current quote)
   - Error handling
   - Risk classification

3. IMPLEMENT: Agent writes code in sandboxed environment
   - Access to HTTP client, JSON parsing
   - Can use stored API keys
   - Iterative development with test runs

4. TEST: Agent validates the tool works
   - Unit tests with sample inputs
   - Edge case handling
   - Error scenarios

5. PROPOSE: Agent submits tool for approval
   - Shows implementation
   - Demonstrates test results
   - Explains use cases
   - Declares risk level

6. APPROVE: Human reviews and approves
   - Code review
   - Security assessment
   - Approve / Request changes / Reject

7. DEPLOY: Tool becomes available
   - Added to tool registry
   - Optionally bundled into a skill
   - Available for future conversations
```

### Tool Builder Environment

```typescript
// Elevated sandbox with controlled access
const toolBuilderEnv = {
  // Code execution
  runtime: 'isolated-vm',          // Sandboxed JavaScript/TypeScript
  timeout: 30_000,                 // 30 second execution limit

  // Network access (allowlisted)
  http: {
    allowedDomains: ['api.example.com', ...userConfigured],
    rateLimited: true,
  },

  // Secret access (scoped)
  secrets: {
    available: ['STOCK_API_KEY', 'WEATHER_API_KEY'],
    requestNew: async (name, purpose) => { /* approval flow */ },
  },

  // Persistence
  storage: {
    drafts: true,                  // Save work-in-progress tools
    testData: true,                // Store test fixtures
  },

  // Frameworks
  libraries: ['zod', 'date-fns', 'lodash'],
};
```

### Tool Schema Format

```typescript
// Agent-generated tool definition
const toolDefinition = {
  name: 'getStockPrice',
  description: 'Fetches current or historical stock prices',
  version: '1.0.0',
  author: 'agent',

  // Zod schema for inputs
  inputSchema: z.object({
    ticker: z.string().describe('Stock ticker symbol'),
    date: z.string().optional().describe('Date for historical price'),
  }),

  // Zod schema for outputs
  outputSchema: z.object({
    ticker: z.string(),
    price: z.number(),
    currency: z.string(),
    timestamp: z.string(),
  }),

  // Risk classification
  risk: 'low',                     // read-only, no side effects

  // Implementation
  implementation: `
    async function execute({ ticker, date }) {
      const response = await http.get(\`https://api.stocks.com/\${ticker}\`);
      return { ticker, price: response.price, ... };
    }
  `,

  // Test cases
  tests: [
    { input: { ticker: 'AAPL' }, expectedShape: { price: 'number' } },
    { input: { ticker: 'INVALID' }, expectsError: true },
  ],
};
```

### Why It Matters

This transforms the agent from a **static tool user** to a **dynamic capability builder**:

| Without Tool Builder | With Tool Builder |
|---------------------|-------------------|
| "I can't do that, I don't have a tool" | "Let me build a tool for that" |
| New integrations require developer time | Agent prototypes, human approves |
| Capabilities frozen at deployment | Capabilities grow with usage |
| Generic tools for everyone | Custom tools for your workflows |

**Compound Growth:** Each approved tool makes the agent more capable, which helps it identify and build more tools.

### Use Cases

**API Integrations:**
- "I notice you often ask about your Jira tickets. Let me build a Jira integration tool."
- "You have a Notion workspace. I can create tools to read and update your databases."

**Data Processing:**
- "You frequently need CSV data analyzed. Let me build a specialized CSV tool."
- "I'll create a tool that parses your bank statement format."

**Custom Workflows:**
- "You always check the same 5 things in the morning. Let me bundle these into a single tool."
- "I'll create a deployment checker tool for your specific CI/CD setup."

### Skill Bundle Management

Beyond individual tools, the agent can compose skills:

```typescript
const skill = {
  name: 'stock-tracker',
  description: 'Track and analyze stock portfolios',
  tools: ['getStockPrice', 'getStockHistory', 'analyzePortfolio'],
  activationRisk: 'low',
  requiredSecrets: ['STOCK_API_KEY'],
};
```

### Security Model

**Sandboxing:**
- Isolated execution environment (no filesystem, no process spawning)
- Network allowlist (only approved domains)
- Resource limits (CPU, memory, time)

**Secret Management:**
- Agent can use pre-approved secrets
- Requesting new secrets requires human approval
- Secrets never exposed in tool output or logs

**Approval Gates:**
- All new tools require human approval before deployment
- Code is visible and auditable
- Risk level must be justified
- Humans can revoke tools at any time

**Audit Trail:**
- All tool creations logged
- All tool executions logged
- Version history maintained

### Implementation Approach

1. Create `tool-builder` skill with elevated sandbox environment
2. Design tool definition schema and validation
3. Implement code execution sandbox (isolated-vm or similar)
4. Build approval workflow with code review UI
5. Create tool registry for agent-built tools
6. Add skill bundling capabilities
7. Implement secret request/approval flow

### Challenges

- **Security**: Sandboxing must be robust; this is highest-risk capability
- **Quality**: Agent-generated code needs human review
- **Maintenance**: Who updates agent-built tools when APIs change?
- **Scope creep**: Clear boundaries on what agent can/cannot build

---

## 5. Memory Evolution

**Status:** Proposed
**Effort:** High
**Impact:** Very High
**Leverage:** Transforms assistant from "remembers" to "understands"

### Description

Evolve the memory system from storage/retrieval to genuine learning:

### Entity Linking

Recognize that different references point to the same entity:
- "Alice", "Alice Smith", "my sister" → same person
- "the project", "Johnson proposal", "that thing for work" → same project
- Build entity graphs with relationships

### Pattern Detection

Identify recurring patterns in user behavior:
- "User always procrastinates on expense reports"
- "Conversations about project X correlate with stress"
- "User is most productive in morning hours"
- "User forgets to follow up with Bob"

### Memory Consolidation

Periodically process memories:
- Summarize old detailed memories into higher-level insights
- Decay unimportant details over time
- Merge related memories into coherent narratives
- Identify contradictions or updates

### Temporal Awareness

Weight memories by recency and relevance:
- Recent memories more prominent
- Old memories summarized but accessible
- Track how things change over time
- "You used to prefer X but lately you've been choosing Y"

### Why It Matters

This is the difference between:
- "You told me on March 5th that you like Italian food"
- "You generally prefer Italian food, especially when stressed, though lately you've been trying to eat healthier"

### Implementation Approach

1. Add entity extraction to memory storage
2. Build entity resolution system (NLP + user confirmation)
3. Create consolidation trigger (weekly?)
4. Implement pattern detection algorithms
5. Add temporal decay to retrieval scoring

---

## 6. Financial Awareness

**Status:** Proposed
**Effort:** High
**Impact:** Medium
**Leverage:** Sensitive data requires careful handling

### Description

Optional financial tracking:
- Budget awareness
- Upcoming bills and subscriptions
- Spending pattern analysis
- Financial goal tracking

### Security Considerations

- Read-only integration preferred
- No storage of full account numbers
- Aggregated data only
- High-risk gating for any actions

---

## 7. Conversation Continuity

**Status:** Proposed
**Effort:** High
**Impact:** Very High
**Leverage:** Transforms fragmented sessions into unified relationship

### Description

Create the experience of talking to one agent in one continuous conversation, while behind the scenes managing context windows through automatic segmentation, reflection, and context rebuilding.

**Problem:** LLMs have limited context windows, forcing users to manage multiple conversations. Users shouldn't have to think about "starting a new conversation" or worry about losing context from previous discussions.

**Solution:** The user maintains one "infinite" conversation. The system automatically:
- Segments conversations at natural topic boundaries
- Reflects on completed segments (extracts memories, generates summaries)
- Rebuilds context on-demand when user references past discussions
- Compacts the active segment when it grows too large

### User Experience

From the user's perspective:
- Talk to GLaDOS forever in one conversation
- Reference past discussions naturally ("remember when we discussed X?")
- Never worry about context limits or conversation management
- Agent maintains continuity across all interactions

### System Architecture

```
User's View:
┌─────────────────────────────────┐
│     One Continuous Chat         │
│  "Hey GLaDOS..." → forever      │
└─────────────────────────────────┘

System's View:
┌──────────────────────────────────────────────────┐
│ Active Segment (current context window)          │
│ ├── Recent messages (verbatim)                   │
│ └── Compacted prefix (summaries if too long)     │
├──────────────────────────────────────────────────┤
│ Reflected Segments (searchable archive)          │
│ ├── Segment A: "API refactor discussion"         │
│ ├── Segment B: "Vacation planning"               │
│ └── Segment C: "Bug in auth module"              │
└──────────────────────────────────────────────────┘
```

### Core Flows

#### 1. Segmentation Flow (periodic)

Analyzes the active conversation and identifies natural topic boundaries for splitting.

**Triggers:**
- Periodic (e.g., hourly)
- When user explicitly creates a new conversation (reflects the old one)
- When context pressure requires it

**Segmentation signals:**
- Semantic shift (message embeddings diverge significantly)
- Time gaps (user returns after several hours)
- Task completion markers
- Explicit signals ("anyway, about something else...")

**Process:**
1. Analyze active conversation for topic boundaries
2. Split at natural breakpoints
3. Send completed segments to reflection
4. Keep most recent segment as active

#### 2. Reflection Flow (on segment completion)

Processes completed segments to extract durable value.

**Process:**
1. Generate segment summary (topic, key decisions, outcomes)
2. Extract memories → feed into Memory system
3. Identify action items or follow-ups
4. Store full transcript (searchable)
5. Mark segment as reflected

**Segment Record:**
```typescript
type ReflectedSegment = {
  id: string;
  timestamp: { start: Date; end: Date };

  // Content
  transcript: Message[];           // Full conversation
  summary: string;                 // LLM-generated summary
  topics: string[];                // Identified topics

  // Extracted value
  memoriesCreated: string[];       // IDs of memories extracted
  actionItems: string[];           // Follow-ups identified

  // Search optimization
  embedding: number[];             // For semantic search

  metadata: {
    messageCount: number;
    tokenCount: number;
    reflectedAt: Date;
  };
};
```

#### 3. Compaction Flow (context pressure)

When the active segment approaches token limits, compact older parts while preserving recent context.

**Strategy: Rolling Window**
- Keep last N tokens of messages verbatim
- Summarize everything before the window in chunks
- As conversation grows, window slides forward
- Full transcript remains searchable for detail recovery

**Process:**
1. Detect context pressure (approaching token limit)
2. Identify compaction boundary (preserve recent N tokens)
3. Generate summary of messages before boundary
4. Replace detailed messages with summary
5. Store full messages in searchable archive

```typescript
type CompactedConversation = {
  // What's in the context window
  compactedPrefix: {
    summary: string;               // "Earlier, we discussed X, decided Y..."
    tokenCount: number;            // How much this summary represents
    messageRange: [number, number]; // Original message indices
  }[];

  recentMessages: Message[];       // Verbatim recent messages

  // Full history (searchable, not in context)
  fullTranscript: Message[];
};
```

#### 4. Context Rebuilding Flow (on-demand)

When user references past discussions, rebuild relevant context.

**Trigger:** User references something not in current context
- "Remember when we talked about the API refactor?"
- "What did we decide about the deployment strategy?"
- "You mentioned something about Alice last week..."

**Strategy: Hierarchical Search**
1. Search segment summaries first (fast, gives overview)
2. If more detail needed, search within relevant transcripts
3. Load specific relevant exchanges into context
4. Provide agent with recovered context

**Tool Interface:**
```typescript
// Tool available to the agent
const recallConversation = {
  name: 'recallConversation',
  description: 'Search past conversations for context',
  input: z.object({
    query: z.string().describe('What to search for'),
    maxSegments: z.number().default(3),
    includeTranscript: z.boolean().default(false),
  }),
  output: z.object({
    segments: z.array(z.object({
      id: z.string(),
      summary: z.string(),
      relevanceScore: z.number(),
      timestamp: z.date(),
      transcript: z.array(MessageSchema).optional(),
    })),
  }),
};
```

### Why It Matters

This is the difference between:
- **Tool**: "Sorry, I don't have context from that conversation. Can you remind me?"
- **Assistant**: "Yes, we discussed that last Tuesday. You decided to go with option B because of the timeline constraints."

A true personal assistant remembers. Not just facts (that's Memory), but the flow of discussions, decisions made, context established. This feature bridges the gap between technical reality (limited context) and user expectation (continuous relationship).

### Implementation Approach

1. **Segment storage**: Extend conversation storage to support segments with summaries
2. **Reflection trigger**: Add background job that processes unreflected segments
3. **Segmentation logic**: Implement topic boundary detection (embeddings + heuristics)
4. **Compaction**: Add rolling window compaction to orchestrator
5. **Search tools**: Create `recallConversation` tool with hierarchical search
6. **Integration**: Connect reflection output to Memory system

### Relationship to Other Features

- **Memory Evolution (#5)**: Reflection feeds the memory system with extracted facts
- **Anticipatory Intelligence (#2)**: Past conversation context enables better anticipation
- **Messaging Integration (#1)**: Cross-channel conversations could use same segmentation

---

## 8. Health & Wellness Tracking

**Status:** Proposed
**Effort:** Medium
**Impact:** Medium
**Leverage:** Integrates with Anticipatory Intelligence and Conversation Continuity

### Description

Holistic wellness awareness:
- Sleep patterns (from wearables/manual input)
- Exercise tracking
- Energy level correlation with calendar
- Stress indicators from interaction patterns

### Use Cases

- "You have a big presentation tomorrow but only slept 5 hours—consider an earlier night"
- "You haven't exercised in 5 days and mentioned wanting to be more active"
- "Your calendar is packed—I blocked some recovery time"

---

## Priority Matrix

| Idea | Effort | Impact | Recommended Order |
|------|--------|--------|-------------------|
| Messaging Integration | Medium | Very High | 1 - Unified communication awareness |
| Conversation Continuity | High | Very High | 2 - Foundation for continuous relationship |
| Anticipatory Intelligence | Medium | High | 3 - Differentiator |
| Research & Execution Skills | Medium | High | 4 - Parallel track |
| Tool Builder Skill | High | Very High | 5 - Self-extending agent |
| Memory Evolution | High | Very High | 6 - Long-term investment |
| Health & Wellness | Medium | Medium | 7 - Nice to have |
| Financial Awareness | High | Medium | 8 - Complex, sensitive |

**Note:** Daily Briefings don't need a dedicated feature - they're just triggers with goals like "Summarize my calendar, tasks, and weather for today." The existing trigger system + tools (`getAgenda`, `listUserTasks`, `weather.get`, `notify`) already provide this capability with full user control over content.

---

## Notes

- All new features should follow existing patterns (Zod schemas, tool registry, risk gating)
- External services use the ExternalServiceRegistry pattern
- High-risk operations require human-in-the-loop approval
- Start read-only, add write capabilities incrementally
