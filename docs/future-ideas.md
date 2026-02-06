# Future Ideas

This document captures high-impact improvements to make GLaDOS more "Jarvis-like" - more proactive, more capable, and more personally attuned.

## 1. Email Integration

**Status:** Proposed
**Effort:** Medium
**Impact:** Very High
**Leverage:** Most-used external service for personal productivity

### Description

Full email awareness and management capabilities:

**Read Operations:**
- Search inbox with semantic understanding
- Summarize unread threads
- Identify urgent vs non-urgent
- Surface emails needing response

**Write Operations (high-risk gated):**
- Draft replies with full context (who is this person, conversation history)
- Compose new emails with appropriate tone
- Schedule sends

**Intelligence:**
- Follow-up tracking ("remind me if Bob doesn't reply in 3 days")
- Triage suggestions ("this looks urgent" / "this can wait")
- Thread summarization for long conversations
- Extract action items from emails

### Why It Matters

Email is where most professional communication happens. A personal assistant without email access is severely limited. This enables:

- "What emails need my attention today?"
- "Draft a reply to Alice declining the meeting politely"
- "Remind me if I don't hear back from the vendor by Friday"

### Implementation Approach

1. Create `email` external service with provider abstraction
2. Support IMAP (universal), Gmail API, Microsoft Graph
3. Start read-only, add write with high-risk gating
4. Store email metadata locally for semantic search
5. Create email skill with triage and drafting tools

### Security Considerations

- OAuth2 for Gmail/Microsoft (no password storage)
- IMAP credentials in secure config
- Write operations require human approval
- No automatic sending without explicit confirmation

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

## 4. Memory Evolution

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

## 5. Financial Awareness

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

## 6. Health & Wellness Tracking

**Status:** Proposed
**Effort:** Medium
**Impact:** Medium
**Leverage:** Integrates with anticipatory intelligence

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
| Email Integration | Medium | Very High | 1 - Biggest capability gap |
| Anticipatory Intelligence | Medium | High | 2 - Differentiator |
| Research & Execution Skills | Medium | High | 3 - Parallel track |
| Memory Evolution | High | Very High | 4 - Long-term investment |
| Health & Wellness | Medium | Medium | 5 - Nice to have |
| Financial Awareness | High | Medium | 6 - Complex, sensitive |

**Note:** Daily Briefings don't need a dedicated feature - they're just triggers with goals like "Summarize my calendar, tasks, and weather for today." The existing trigger system + tools (`getAgenda`, `listUserTasks`, `weather.get`, `notify`) already provide this capability with full user control over content.

---

## Notes

- All new features should follow existing patterns (Zod schemas, tool registry, risk gating)
- External services use the ExternalServiceRegistry pattern
- High-risk operations require human-in-the-loop approval
- Start read-only, add write capabilities incrementally
