# GLaDOS Agent Architecture

> How a single AI assistant scales to handle everything without losing its mind.

This document describes the conceptual architecture of GLaDOS - not the code, but the *ideas* that make it work. It's intended as a guide for understanding how the agent thinks, learns, and grows.

## Table of Contents

1. [Core Philosophy](#core-philosophy)
2. [The World Model](#the-world-model) - Entities, Tasks, Knowledge
3. [Memory](#memory-how-the-agent-learns) - Facts, Patterns, Procedures
4. [Scaling Tools](#scaling-tools-without-bloating-context) - Discovery, Tool Sets
5. [Delegation](#delegation-how-complex-work-gets-done) - Sub-agents, Parallel Execution
6. [Task Complexity](#task-complexity-plan-before-you-leap) - Planning, Adaptive Execution
7. [Model Selection](#model-selection-right-tool-for-the-job) - Cost vs. Capability
8. [Proactive Behavior](#proactive-behavior) - Schedules, Routines, Attention Budget
9. [Reactive Behavior](#reactive-behavior) - Events, Triage
10. [Uncertainty & Confidence](#uncertainty--confidence) - When to Ask vs. Assume
11. [Human in the Loop](#human-in-the-loop) - Risk, Approval, Trust
12. [Growing Capabilities](#growing-capabilities) - Learning, Self-Improvement
13. [Avoiding Dead Ends](#avoiding-dead-ends) - Future-Proofing
14. [Summary](#summary-the-glados-difference)

## Core Philosophy

**One agent, one relationship.** You interact with a single assistant that knows you. Behind the scenes, it may delegate to specialized capabilities, but to you it's always the same GLaDOS. This is fundamentally different from having many specialized bots - it's more like having a capable assistant who can call in experts when needed but always remembers your preferences and context.

**Learn, don't configure.** Instead of endless settings and options, the agent learns from every interaction. Preferences emerge from conversations. Workflows develop from repetition. The goal is that using GLaDOS naturally teaches it how to be better for you.

**Proactive, not just reactive.** A good assistant doesn't just answer questions - they anticipate needs, follow up on pending items, and surface relevant information at the right time. GLaDOS operates continuously, not just when you invoke it.

---

## The World Model

Before the agent can help you, it needs to understand your world. GLaDOS maintains a rich model of the entities that matter to you.

### Core Entities

These aren't tools or features - they're fundamental knowledge that shapes every interaction:

| Entity | What It Captures | Why It Matters |
|--------|------------------|----------------|
| **You** | Identity, timezone, working hours, communication style, goals | Personalizes every response |
| **People** | Contacts, relationships, how you know them, communication history | Enables "ask Sarah about the proposal" |
| **Events** | Calendar, meetings, deadlines, recurring commitments | Time-awareness: "you have a call in 30 minutes" |
| **Places** | Locations, home/work, travel contexts | Context-awareness: travel time, "when you get to the office" |
| **Projects** | Larger initiatives with scope, status, related people | Focus: knows what you're working on |
| **Tasks** | Individual action items with various triggers and priorities | Execution: knows what needs doing and when |

This world model is always available - it's not activated like a tool, it's woven into how the agent thinks. When you say "remind me to follow up with the client after the meeting," the agent knows who the client is, when the meeting is, and what project this relates to.

### Tasks: The Execution Layer

Projects are containers for related work. **Tasks** are the actual things that need doing. They come in several flavors:

| Task Type | Trigger | Examples |
|-----------|---------|----------|
| **Deadline-based** | Specific due date/time | "Submit report by Friday", "Pay invoice before the 15th" |
| **Recurring (time)** | Fixed schedule | "Weekly team update every Monday", "Monthly review on the 1st" |
| **Recurring (completion)** | After last completion | "Water plants every 3 days", "Follow up 1 week after sending" |
| **Opportunistic** | When time permits | "Read that article sometime", "Organize photos when free" |
| **Future/Deferred** | Becomes relevant later | "After the move, set up home office", "Once Q4 starts, begin planning" |
| **Conditional** | When conditions are met | "When budget is approved, book the venue" |

The key insight: **not everything needs your attention now**. Future tasks exist in the system but don't clutter your current view. The agent surfaces them when they become relevant - either because time passed, a condition was met, or context changed.

```
User: "I need to renew my passport, but not until after the holidays"

Agent stores:
- Task: "Renew passport"
- Type: Future/Deferred
- Becomes relevant: January 2nd
- Related: Travel, Documents

[January 2nd, morning briefing]
Agent: "Now that the holidays are over, you mentioned wanting
       to renew your passport. Should I look up the process?"
```

> **Note**: Tasks here are *your* tasks - things you need to do. The agent also has its own task-like concepts: [Self-Scheduled Tasks](#self-scheduled-tasks) (agent's reminders to itself), and [Delegated Work](#delegation-how-complex-work-gets-done) (background operations). These are related but distinct: your tasks are what needs doing, the agent's tasks are how it helps you get there.

### Entity Knowledge: Your Personal Wiki

Beyond knowing about *you*, the agent builds knowledge about *things in your world*. This is like a personal wiki that grows through conversation:

| Entity | What the Agent Learns |
|--------|----------------------|
| **Acme Corp** | Client company, main contacts are Sarah and Mike, working on website redesign, prefers formal communication |
| **The Q4 Report** | Annual deliverable, stakeholders include finance and exec team, due mid-January, uses specific template |
| **London Conference** | AI Summit, March 15-17, speaking opportunity, need to book travel |
| **Home Espresso Machine** | Breville Barista Express, bought 2022, descale every 2 months, warranty expires June 2025 |
| **Project Moonshot** | Codename for the secret initiative, involves only core team, no external discussion |

Entity knowledge is different from facts about you. It's reference information the agent can draw on:

```
User: "Send the proposal to Acme"

Agent thinking:
- Acme Corp: client, formal communication preferred
- Main contact: Sarah (PM), Mike (Tech Lead)
- Current project: website redesign, Phase 2
- Last interaction: approved mockups last week

Agent: "I'll send the proposal to Sarah and CC Mike.
       Should I use the formal template given their preference?"
```

Entities can link to each other, forming a knowledge graph:
- **Acme Corp** → has contacts → **Sarah**, **Mike**
- **Website Redesign** → is project for → **Acme Corp**
- **Sarah** → prefers → email over Slack
- **Q4 Report** → uses template from → **2023 Q4 Report**

This knowledge accumulates naturally through conversation. When you mention "the Breville needs descaling," the agent learns and remembers.

### Natural References

All these entities - you, people, events, places, projects, tasks, and learned knowledge - work together to enable natural conversation:

- "What's happening with Acme?" (knows Acme is a client, recalls recent context)
- "Is Sarah free tomorrow?" (knows who Sarah is, can check her calendar)
- "When I get home, remind me to..." (knows where home is, creates location-triggered task)
- "Before my flight, I need to..." (knows your upcoming travel from calendar)
- "Handle this like the last invoice" (recalls past interactions and procedures)

This isn't magic - it's the result of maintaining structured knowledge about the entities in your life and connecting them intelligently.

---

## Memory: How the Agent Learns

Memory is what transforms a stateless chatbot into a personal assistant. GLaDOS remembers at multiple levels:

### Conversation Memory

Recent conversations are fully recalled. As they age, they're summarized - the key facts, decisions, and open items are extracted and stored. You can always ask "what did we discuss last Tuesday?" and get a useful answer.

### Learned Facts

Through conversation, the agent accumulates knowledge:
- "You prefer afternoon meetings"
- "You're vegetarian"
- "Your manager is Jamie"
- "You pronounce it 'data', not 'data'"

These facts aren't stored as rigid rules but as contextual knowledge that informs responses.

### Preferences & Patterns

Over time, patterns emerge:
- Communication style preferences (terse vs. detailed)
- Decision-making patterns (conservative vs. experimental)
- Topic expertise areas
- People you interact with frequently

The agent doesn't just remember what you said - it learns how you think.

### Procedural Knowledge

Beyond facts, the agent also learns **how to do things**. Through repeated interactions and user feedback, it accumulates procedural knowledge:

- How you prefer expense reports submitted
- The approval chain for different types of requests
- Your formatting preferences for meeting notes
- Common patterns in your workflows

This procedural knowledge is stored as memories with the `procedure` type, alongside `feedback` memories that capture corrections. Together, these help the agent improve its behavior over time.

**How procedural knowledge evolves:**

1. **Initial interaction**: Agent performs a task, notes the approach
2. **Refinement**: User corrects or adjusts ("actually, always CC finance on expenses")
3. **Observation**: Agent notices patterns from conversation history
4. **Recall**: Similar procedures are retrieved through semantic search

The goal: **the agent gets better at tasks through repetition**, just like a human assistant would.

### Memory Maintenance

Memory isn't infinite. The agent periodically:
1. **Consolidates** similar memories into richer ones
2. **Reinforces** frequently-accessed memories
3. **Decays** unused memories over time
4. **Extracts** higher-level patterns from raw data

This mirrors how human memory works - vivid recent memories, consolidated older ones, and general patterns.

### Knowledge Types Summary

The agent maintains several distinct types of knowledge:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         WHAT (Declarative)                          │
├─────────────────────────────────────────────────────────────────────┤
│  Facts About You          │  Entity Knowledge                       │
│  - Preferences            │  - Companies, products, concepts        │
│  - Goals                  │  - Reference information                │
│  - Relationships          │  - How things connect                   │
│  - History                │  - Context for future conversations     │
├─────────────────────────────────────────────────────────────────────┤
│                          HOW (Procedural)                           │
├─────────────────────────────────────────────────────────────────────┤
│  Procedures & Feedback    │  Learned Workflows                      │
│  - Step-by-step processes │  - Patterns from repetition             │
│  - User corrections       │  - Tool combinations that work          │
│  - Best practices         │  - Timing and sequencing                │
├─────────────────────────────────────────────────────────────────────┤
│                         WHEN (Temporal)                             │
├─────────────────────────────────────────────────────────────────────┤
│  Conversation History     │  Event Memory                           │
│  - What was discussed     │  - What happened when                   │
│  - Decisions made         │  - Outcomes of actions                  │
│  - Open items             │  - Patterns over time                   │
└─────────────────────────────────────────────────────────────────────┘
```

All of these work together. When you say "handle the Acme invoice like last time":
- **Entity knowledge**: Knows what Acme is
- **Conversation history**: Remembers "last time"
- **Procedural memory**: Recalls relevant procedures and past feedback
- **Facts about you**: Knows your approval authority

---

## Scaling Tools Without Bloating Context

A capable assistant needs access to many tools - email, calendar, file management, web search, code execution, and dozens of domain-specific capabilities. But an LLM can only hold so much context. How do we give the agent access to hundreds of tools without overwhelming it?

### The Tool Discovery Pattern

Instead of loading all tools at once, the agent has access to a **discovery system**:

```
User: "Book me a flight to London"

Agent thinking:
1. I don't have flight booking tools active
2. Let me search my tool catalog for "travel" or "flights"
3. Found: FlightSearch, FlightBooking, TravelPlanner
4. Activating travel tool set for this task
```

The agent always has:
- **Core tools**: Basic capabilities always available (search, ask questions, take notes)
- **Discovery tools**: Ability to find and activate other tool sets
- **Active tools**: Currently loaded tools for the ongoing task

### Tool Sets

Tools are grouped into logical sets that are often used together:

- **Communication**: Email, messaging, contacts
- **Scheduling**: Calendar, reminders, time management
- **Research**: Web search, document reading, summarization
- **Development**: Code execution, file management, git

When the agent activates a tool set, all related tools become available. When a task completes, tool sets can be deactivated to free up context.

### Tool Learning

The agent tracks which tools work well for which tasks:
- "Email drafting works better with the contacts tool also active"
- "User often uses code execution after web research"
- "This tool failed three times in similar situations - try alternatives first"

Over time, the agent gets better at selecting the right tools for each situation.

### Task Templates

For common tasks, predefined templates provide a head start:

| Task | Tool Sets | Initial Context |
|------|-----------|-----------------|
| Email triage | Email, Contacts, Calendar | Recent messages, known senders |
| Code review | Git, Filesystem, Code Analysis | Diff, project context |
| Meeting prep | Calendar, Contacts, Notes | Attendees, past meetings, agenda |

Templates aren't rigid - they're starting points that the agent adapts based on the specific request.

---

## Delegation: How Complex Work Gets Done

Some tasks are too complex for a single-threaded conversation. The agent can delegate work to specialized sub-agents while maintaining a unified experience.

### The Delegation Model

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Primary Agent                                 │
│  - Maintains conversation with user                                  │
│  - Holds full context (who you are, history, preferences)           │
│  - Decides when to delegate vs. handle directly                     │
│  - Synthesizes results back to user                                 │
└─────────────────────────────────────────────────────────────────────┘
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
        ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
        │  Research   │ │  Analysis   │ │  Execution  │
        │  Sub-agent  │ │  Sub-agent  │ │  Sub-agent  │
        │             │ │             │ │             │
        │ - Web search│ │ - Data work │ │ - API calls │
        │ - Reading   │ │ - Comparison│ │ - File ops  │
        │ - Summary   │ │ - Reasoning │ │ - External  │
        └─────────────┘ └─────────────┘ └─────────────┘
```

### When to Delegate

Not every task needs delegation. The primary agent handles most interactions directly. Delegation happens when:

| Situation | Why Delegate |
|-----------|--------------|
| **Deep research** | Extensive searching would interrupt conversation flow |
| **Parallel work** | Multiple independent subtasks can run simultaneously |
| **Specialized reasoning** | Task benefits from focused context (just code, just data) |
| **Long-running operations** | User shouldn't wait; work continues in background |
| **Risk isolation** | Dangerous operations contained in limited-scope agent |

### Context Sharing

Sub-agents don't get full context - they get what they need:

```
Primary agent thinking:
"User wants flight options to London for the conference.
 I'll delegate to a research sub-agent."

Context passed to sub-agent:
- Task: Find flight options SFO → London
- Dates: March 14-18
- Constraints: Under $2000, prefer direct
- Preferences: Aisle seat, no red-eyes (from user model)

Context NOT passed:
- Full conversation history
- Unrelated projects
- Other pending tasks
```

This keeps sub-agents focused and prevents context bloat.

### Results Flow Back

Sub-agents report results, not conversations:

```
Sub-agent result:
{
  status: "completed",
  summary: "Found 12 flights, filtered to 3 best options",
  data: [flight1, flight2, flight3],
  confidence: "high",
  notes: "March 14 has limited availability, consider March 13"
}

Primary agent to user:
"I found 3 good options for your London trip. Interestingly,
 March 14 has limited availability - would you consider
 flying out on the 13th instead? Here are the options..."
```

The user never interacts with sub-agents directly. The primary agent translates results into natural conversation.

### Parallel Execution

For complex requests, multiple sub-agents can work simultaneously:

```
User: "Prepare me for the Acme meeting tomorrow"

Primary agent spawns:
├── Research agent: Look up recent Acme news
├── Calendar agent: Pull past meeting notes with attendees
├── Email agent: Summarize recent Acme correspondence
└── Document agent: Find relevant proposals/contracts

[All run in parallel, results synthesized]

Primary agent: "Here's your prep for tomorrow's Acme meeting..."
```

### Sub-agent Limitations

Sub-agents are intentionally constrained:

- **No user interaction**: Can't ask clarifying questions (must work with what they have)
- **No high-risk actions**: Can research but not send emails
- **Time-bounded**: Must complete within limits or report partial results
- **Scoped tools**: Only get tools relevant to their specific task

This prevents sub-agents from going off-track or taking unauthorized actions.

### The Agent Builder: Creating Experts on Demand

Sub-agents aren't hardcoded - they're created by a specialized meta-agent called the **Agent Builder**. This follows the "conversation over configuration" principle: the system grows its own capabilities through need, not through development.

**How it works:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Primary Agent                                 │
│                                                                      │
│  "I need to analyze financial data, but I don't have a              │
│   specialist for that. Let me consult the Agent Builder."           │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Agent Builder                                 │
│  (itself a sub-agent, but with special capabilities)                │
│                                                                      │
│  Inputs:                                                            │
│  - What capability is needed                                         │
│  - What context/tools it should have                                │
│  - Performance requirements (speed vs. quality)                     │
│  - Examples of good/bad outputs (if available)                      │
│                                                                      │
│  Outputs:                                                           │
│  - Agent specification (prompt, tools, model tier, constraints)     │
│  - Stored in agent registry for future use                          │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    New "Financial Analyst" Agent                     │
│                                                                      │
│  - Specialized prompt for financial analysis                        │
│  - Tools: spreadsheet, calculator, data visualization               │
│  - Model: capable tier (needs reasoning)                            │
│  - Constraints: read-only, no external communication                │
└─────────────────────────────────────────────────────────────────────┘
```

**The Agent Registry:**

Created agents are stored, not discarded:

| Agent | Purpose | Tools | Model | Created | Last Used |
|-------|---------|-------|-------|---------|-----------|
| Research Scout | Web research, summarization | search, fetch, summarize | mid-tier | Jan 15 | Today |
| Financial Analyst | Data analysis, projections | spreadsheet, calculator, charts | capable | Feb 1 | Today |
| Email Drafter | Compose emails in user's voice | templates, contacts, calendar | capable | Dec 10 | Yesterday |
| Code Reviewer | Review code changes | git, filesystem, linter | capable | Jan 20 | 3 days ago |

**Creating a new agent:**

```
Primary agent: "I need to compare insurance policies, but I don't
              have a specialist for that."

[Invokes Agent Builder]

Agent Builder thinking:
- Task: Compare insurance policies
- Needs: Document reading, comparison tables, financial calculations
- User context: Prefers detailed analysis, risk-averse
- Similar to: Financial Analyst (can borrow patterns)

Agent Builder: "Created 'Insurance Analyst' agent:
              - Reads policy documents, extracts key terms
              - Builds comparison matrices
              - Highlights risks and exclusions
              - Uses capable model (nuanced document understanding)
              - Tools: document reader, table builder, calculator

              Ready for use. Should I run the comparison now?"
```

**Evolving existing agents:**

When a sub-agent underperforms, the primary agent can request modifications:

```
Primary agent: "The Email Drafter has been too formal lately.
              User corrected three drafts this week."

[Invokes Agent Builder with feedback]

Agent Builder: "Analyzed the corrections. Patterns I see:
              - User prefers shorter sentences
              - Less 'I hope this email finds you well'
              - More direct asks

              Updated Email Drafter prompt to:
              - Match user's casual style
              - Lead with the point
              - Skip pleasantries unless recipient is formal

              Applied to future drafts. Want me to re-draft
              the pending emails with the new style?"
```

**What the Agent Builder can modify:**

| Aspect | Example Change |
|--------|----------------|
| **Prompt/personality** | "Be more concise", "Match user's tone" |
| **Tool access** | Add/remove tools based on task needs |
| **Model tier** | Upgrade for quality, downgrade for speed |
| **Constraints** | Tighten for safety, loosen for capability |
| **Output format** | Tables vs. prose, detailed vs. summary |

**What requires human approval:**

- Creating agents with high-risk tool access
- Significantly changing a well-established agent
- Giving an agent new external communication abilities
- Promoting an agent to handle sensitive data

**The self-improving loop:**

```
Need arises → Agent Builder creates specialist
                        ↓
              Specialist performs task
                        ↓
              Results evaluated (by primary agent or user)
                        ↓
         ┌──────────────┴──────────────┐
         ↓                             ↓
    Good results                  Poor results
         ↓                             ↓
    Agent reinforced              Agent Builder refines
    (used more often)             (adjusts based on feedback)
         ↓                             ↓
         └──────────────┬──────────────┘
                        ↓
              Agent registry updated
                        ↓
              Better performance next time
```

This means the agent ecosystem evolves through use. Frequently-needed specialists get created and refined. Rarely-used ones fade away. The system naturally develops the capabilities its user actually needs.

---

## Task Complexity: Plan Before You Leap

Not all tasks are equal. A simple request ("what's on my calendar tomorrow?") needs no planning. A complex request ("help me prepare for relocating to London") requires research, strategy, and careful execution. The agent adapts its approach based on complexity.

### The Complexity Spectrum

```
┌─────────────────────────────────────────────────────────────────────┐
│  SIMPLE                                                              │
│  "What time is my next meeting?"                                    │
│                                                                      │
│  → Just do it. Look up calendar, respond.                           │
├─────────────────────────────────────────────────────────────────────┤
│  MODERATE                                                            │
│  "Schedule a meeting with Sarah next week"                          │
│                                                                      │
│  → Light planning. Check availability, propose times, execute.      │
├─────────────────────────────────────────────────────────────────────┤
│  COMPLEX                                                             │
│  "Plan my trip to the London conference"                            │
│                                                                      │
│  → Research first. Gather info, form plan, get approval, execute.   │
├─────────────────────────────────────────────────────────────────────┤
│  STRATEGIC                                                           │
│  "Help me transition to a new role over the next 3 months"          │
│                                                                      │
│  → Deep planning. Multiple phases, ongoing refinement, milestones.  │
└─────────────────────────────────────────────────────────────────────┘
```

### The Planning Process

For complex tasks, the agent follows a structured approach:

**1. Understand**
- What is the actual goal? (not just the literal request)
- What constraints exist? (time, budget, preferences)
- What's the scope? (one-time vs. ongoing, just me vs. involves others)

**2. Research**
- What information is needed?
- What do I already know? What do I need to find out?
- Are there unknowns that could change the approach?

**3. Plan**
- Break into concrete steps
- Identify dependencies (what must happen before what)
- Flag decision points (where user input is needed)
- Estimate effort and timeline

**4. Validate**
- Does this plan make sense given what I know about the user?
- Are there risks or assumptions I should surface?
- Is this the right level of detail?

**5. Execute**
- Follow the plan, adapting as needed
- Report progress at appropriate intervals
- Surface blockers early

### Plan Approval

Whether a plan needs approval depends on risk and confidence:

| Confidence | Low Risk | High Risk |
|------------|----------|-----------|
| **High** | Execute, inform after | Present plan, request approval |
| **Low** | Present plan, suggest approach | Present plan, request approval, highlight uncertainties |

```
[High confidence, low risk - execute directly]
User: "Book a table for 2 at my usual restaurant Friday night"
Agent: "Done - reserved at Chez Marie for 7:30pm Friday.
       Confirmation sent to your email."

[High confidence, high risk - request approval]
User: "Book my London flights"
Agent: "Here's my plan:
       1. Book United flight March 14 SFO→LHR ($1,450)
       2. Book return March 18 LHR→SFO
       3. Add to calendar with travel buffer
       4. Set packing reminder for March 13

       Total cost: $1,450. Ready to book?"

[Low confidence, low risk - suggest approach]
User: "Help me organize my photos from the trip"
Agent: "I could approach this a few ways:
       1. Sort by date into folders
       2. Sort by location using metadata
       3. Let you pick favorites first, then organize

       Which sounds right? Or did you have something else in mind?"

[Low confidence, high risk - surface uncertainties]
User: "Send the project update to stakeholders"
Agent: "Before I send, I want to confirm a few things:
       - Stakeholders: I have Sarah, Mike, and the exec team. Anyone else?
       - The update mentions the delayed timeline - is that approved to share?
       - Should this come from you or from the project account?

       Here's the draft for review..."
```

### Adaptive Execution

Plans aren't rigid. During execution, the agent adapts:

- **New information**: "I found out the venue is booked - adjusting plan"
- **Blocked step**: "Can't proceed without X - here are alternatives"
- **Scope change**: "This is bigger than expected - want to revisit the plan?"
- **Opportunity**: "I noticed a better option while working on this"

The agent communicates changes proportional to their impact - minor adjustments happen silently, significant changes get flagged.

---

## Model Selection: Right Tool for the Job

Different tasks have different needs. Using the most powerful model for everything is wasteful; using the cheapest model for everything produces poor results. The agent intelligently selects models based on task requirements.

### Task-Model Matching

| Task Type | Model Tier | Rationale |
|-----------|------------|-----------|
| **Simple retrieval** | Fast/cheap | "What's on my calendar?" - no reasoning needed |
| **Summarization** | Mid-tier | Condense information, modest reasoning |
| **Analysis & planning** | Capable | Complex reasoning, nuanced understanding |
| **Creative/strategic** | Most capable | Novel solutions, sophisticated judgment |
| **Bulk processing** | Fast/cheap | Triage 100 emails - speed matters |
| **High-stakes decisions** | Most capable | Errors are costly, quality matters |

### How It Works

```
User: "Summarize my unread emails and draft responses to urgent ones"

Agent orchestration:
├── Triage emails (fast model)
│   └── Classify: urgent/normal/spam, 50 emails → 3 seconds
├── Summarize batch (mid-tier model)
│   └── Generate summaries for 12 important emails → 5 seconds
├── Draft responses (capable model)
│   └── 3 urgent emails need thoughtful replies → 15 seconds
└── Review & present (primary agent)
    └── Synthesize results, present to user

Total: ~25 seconds, fraction of the cost of using best model throughout
```

### Cost-Quality Tradeoffs

The agent considers:

- **User preference**: Some users want speed, others want quality
- **Task visibility**: User-facing output deserves more care
- **Reversibility**: Easily-corrected actions can use cheaper models
- **Learning opportunity**: Feedback on important tasks improves future performance

### Cascading Strategy

For uncertain complexity, the agent can cascade:

1. **Try fast model first** - if it produces confident, correct-seeming result, done
2. **Escalate if needed** - ambiguous or complex? Route to capable model
3. **Learn from patterns** - "This type of query usually needs the capable model"

```
User: "What does the contract say about termination?"

Fast model attempt: [Low confidence - legal document, nuanced question]
→ Escalate to capable model

Capable model: "The contract specifies a 90-day notice period for
              termination without cause (Section 8.2), with immediate
              termination allowed for material breach (Section 8.3)..."
```

### Transparency

Users can understand resource usage:

- "I used the fast model for triage and the full model for your summary"
- Cost tracking available if user wants visibility
- User can override: "Use the best model for this one"

The goal: **excellent results at reasonable cost**. The agent shouldn't be penny-wise and pound-foolish, but shouldn't waste resources on trivial tasks either.

---

## Proactive Behavior

The agent doesn't wait to be invoked - it works in the background to anticipate needs.

### The Trigger System

Proactive behavior is powered by **triggers** - agent-managed scheduled invocations. Unlike traditional cron jobs, triggers are created, modified, and deleted by the agent itself through conversation.

**Trigger types:**

| Type | Schedule | Examples |
|------|----------|----------|
| **One-time** | Specific datetime | "Remind me at 3pm", "Follow up next Tuesday" |
| **Recurring** | Cron expression | "Every morning at 9am", "Weekdays at 5pm" |

**How triggers work:**

1. User requests a reminder or scheduled task
2. Agent uses `create_trigger` tool to schedule it
3. When the trigger fires, a background agent session runs
4. The agent executes the goal and can notify the user via `notify` tool
5. The agent can update or delete its own trigger based on results

```
User: "Remind me to follow up with David in 3 days if he hasn't replied"

Agent:
1. Creates trigger: { schedule: "once", at: "2024-03-18T09:00:00" }
2. Goal: "Check if David replied. If not, draft a follow-up and notify user."

[Trigger fires in 3 days]
Background agent:
1. Checks email/messages for David's reply
2. If no reply: drafts follow-up, sends notification
3. If replied: deletes trigger (no longer needed)
```

### Pre-installed Triggers

The system comes with default triggers that users can pause or delete:

| Trigger | Schedule | Purpose |
|---------|----------|---------|
| `daily-briefing` | Weekdays 8am | Morning summary of calendar, priorities |
| `calendar-lookahead` | Every hour | Surface upcoming events needing prep |
| `stale-followups` | Daily 9am | Identify tasks waiting too long |

### Day Planning

The agent supports structured **daily planning sessions** that produce a day plan loaded into every interaction. This gives the agent awareness of your intentions for the day.

**Day plan components:**
- **Intentions**: High-level themes ("make progress on API redesign")
- **Priorities**: Ordered list of what matters most today
- **Focus blocks**: Dedicated time for deep work
- **Energy level**: User's expected energy (low/medium/high)

```
[Morning planning session]
Agent: "Good morning! Let's plan your day. You have 3 meetings,
       leaving gaps at 8-10am and 2-4pm. What are your priorities?"

User: "I need to finish the proposal and prep for the client call"

Agent: "Got it. I've captured your day plan:
       ☐ Finish proposal (priority 1)
       ☐ Prep for client call (priority 2)
       📍 8-10am focus block for proposal work

       I'll keep this in mind throughout our conversations today."

[Later that day]
User: "What should I work on next?"

Agent: "Based on your day plan, you've finished the proposal (nice!).
       Your client call is in 2 hours - want to start prepping now?"
```

The day plan is part of the agent's context, so it naturally informs suggestions and prioritization.

### Creating Custom Triggers

Through conversation, users can create sophisticated scheduled behaviors:

- "Every Monday, review the project list and highlight stuck items"
- "After the conference, summarize my notes and create action items"
- "Remind me to water the plants every 3 days"
- "Check my calendar every morning and alert me if there are conflicts"

The agent translates these into triggers with appropriate schedules and goals.

### Future: Condition-Based Triggers

> **Note**: Not yet implemented. Planned for Phase 8 (Reactive Events).

Some tasks wait for conditions rather than times:

- "When the report is published, summarize it for me"
- "If any meeting gets added to tomorrow, alert me"
- "When flight prices drop below $500, let me know"

This requires event ingress infrastructure (webhooks, polling) not yet implemented.

### Notifications (Current Implementation)

When a trigger fires, the background agent can notify the user via the `notify` tool. Notifications support urgency levels:

| Urgency | Behavior |
|---------|----------|
| `low` | Informational, non-urgent |
| `medium` | Default, worth knowing |
| `high` | Time-sensitive, needs attention |
| `critical` | Urgent, interrupt immediately |

Currently, notifications are delivered via Telegram only. The agent should use good judgment about when to notify vs. when to work silently.

### Future: Attention Budget

> **Note**: Sophisticated attention management is planned for future phases. See `spec/notifications-future.md`.

The full vision includes an **attention budget** - awareness of how much the agent should demand user focus:

**Factors that will affect the budget:**

| Factor | Effect |
|--------|--------|
| **Time of day** | Quiet hours reduce interruptions to critical only |
| **Current activity** | In a meeting or focus block = higher threshold |
| **Recent interruptions** | Already pinged 3 times today = be more selective |
| **User responsiveness** | Not responding to notifications = back off |
| **Stated preference** | "Leave me alone this afternoon" = respect it |

**Planned interruption tiers:**

```
┌─────────────────────────────────────────────────────────────────────┐
│ CRITICAL     │ Interrupt always (security, time-sensitive crisis)   │
├──────────────┼──────────────────────────────────────────────────────┤
│ HIGH         │ Interrupt unless explicitly blocked                   │
├──────────────┼──────────────────────────────────────────────────────┤
│ MEDIUM       │ Queue for next natural break, or batch with others   │
├──────────────┼──────────────────────────────────────────────────────┤
│ LOW          │ Include in daily summary, don't interrupt            │
├──────────────┼──────────────────────────────────────────────────────┤
│ BACKGROUND   │ Just do it silently, no notification needed          │
└──────────────┴──────────────────────────────────────────────────────┘
```

**Planned features:**

- **Batching**: Group multiple notifications into summaries
- **Smart timing**: Deliver at natural breaks, not mid-task
- **Learning**: Calibrate based on user reactions
- **Do Not Disturb**: Quiet hours, focus blocks, manual DND
- **Multi-channel routing**: Email, SMS, Slack based on urgency

The goal: **the agent is helpful, not annoying**. A great assistant knows when to speak up and when to stay quiet.

---

## Reactive Behavior

The agent responds to external events, not just user messages.

### Event Sources

Events flow into the agent from multiple sources:

| Source | Events | Example Actions |
|--------|--------|-----------------|
| Email | New messages, replies, calendar invites | Triage, draft responses, update calendar |
| Webhooks | External system notifications | Process, alert user, trigger workflows |
| Calendar | Upcoming events, changes | Prep reminders, travel time alerts |
| File system | Document changes | Summarize updates, notify stakeholders |

### Event Processing

When an event arrives, the agent:

1. **Classifies** it (urgent/routine, spam/legitimate, actionable/informational)
2. **Enriches** it with context (who is this person? what project is this related to?)
3. **Decides** what to do (act automatically, draft response, alert user, ignore)
4. **Learns** from user feedback on its decisions

### Triage Intelligence

Not every event needs attention. The agent learns to filter:

- Unknown senders with generic pitches → likely spam, archive
- Known contact with question → draft response for review
- Urgent message from important contact → alert immediately
- Newsletter from subscribed source → summarize if relevant, otherwise archive

Over time, the agent's triage accuracy improves based on user corrections.

> **See also**: [Attention Budget](#attention-budget-when-not-to-interrupt) - reactive events are subject to the same interruption rules. An incoming email might be urgent, but if you're in a meeting, it gets queued rather than interrupting.

---

## Uncertainty & Confidence

The agent doesn't always know things with certainty. A good assistant is honest about what it knows, what it thinks, and what it's guessing.

### Confidence Levels

Knowledge exists on a spectrum:

| Level | Source | How Agent Communicates |
|-------|--------|------------------------|
| **Certain** | User explicitly stated, verified fact | States directly: "Your flight is at 3pm" |
| **High confidence** | Inferred from reliable sources | States with context: "Based on your calendar, you're free tomorrow afternoon" |
| **Moderate confidence** | Pattern-based inference | Hedges slightly: "You usually prefer morning meetings, so I suggested 10am" |
| **Low confidence** | Weak inference, old information | Explicit uncertainty: "I think Sarah is the PM, but I'm not certain - want me to check?" |
| **Unknown** | No information available | Asks: "I don't know your dietary restrictions - any I should note?" |

### When to Ask vs. Assume

The agent calibrates based on stakes:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         LOW STAKES                                   │
│  Higher tolerance for assumption                                     │
│  "I'll use your usual format for the notes"                         │
├─────────────────────────────────────────────────────────────────────┤
│                         MEDIUM STAKES                                │
│  State assumption, allow override                                    │
│  "I'll send to Sarah since she's the PM - unless you meant someone  │
│   else?"                                                            │
├─────────────────────────────────────────────────────────────────────┤
│                         HIGH STAKES                                  │
│  Ask before acting                                                   │
│  "I'm not sure if this should go to the whole team or just leads.  │
│   Who should receive it?"                                           │
└─────────────────────────────────────────────────────────────────────┘
```

### Handling Contradictions

When new information conflicts with existing knowledge:

**Explicit contradiction:**
```
Agent knows: "Jamie is your manager"
User says: "Send this to my manager Pat"

Agent response: "I'll send to Pat. Just to update my records -
               is Pat your new manager, or was I mistaken about Jamie?"
```

**Implicit conflict:**
```
Agent knows: "You're vegetarian"
User says: "Book us a table at the steakhouse"

Agent response: "I'll book the steakhouse. Just checking - I had noted
               you're vegetarian. Should I look for good veggie options
               there, or has that changed?"
```

**Temporal updates:**
```
Agent knows: "Project X is high priority" (from 3 months ago)
Context: Project X hasn't been mentioned in weeks

Agent internally: Lower confidence on priority status
Agent when relevant: "Is Project X still a priority? I haven't heard
                     about it recently."
```

### Confidence Decay

Old information becomes less reliable:

- **Recent + explicit**: High confidence ("you told me yesterday")
- **Recent + inferred**: Moderate confidence ("based on this week's emails")
- **Old + explicit**: Moderate confidence ("you mentioned this last year")
- **Old + inferred**: Low confidence ("I assumed this a while ago")

The agent surfaces uncertainty when acting on decayed knowledge:

```
"The last time you traveled to London, you stayed at the Savoy.
 Should I book there again, or would you prefer somewhere different?"
```

### Learning from Corrections

When the user corrects the agent:

1. **Update the specific fact**: "Got it, Pat is your manager now"
2. **Assess related knowledge**: Does this affect other things I believe?
3. **Adjust confidence model**: Was I overconfident? Should I be more careful about similar inferences?
4. **Thank, don't grovel**: "Thanks for the correction" not "I'm so sorry I was wrong"

The goal: **calibrated confidence**. The agent should be right when it's certain, and appropriately humble when it's not.

---

## Human in the Loop

Trust requires control. The agent can do a lot, but certain actions require explicit approval.

### Risk Levels

Every action has a risk profile:

| Level | Behavior | Examples |
|-------|----------|----------|
| Low | Execute immediately | Search, read, calculate |
| Medium | Execute, log for review | Create file, read API |
| High | **Require approval** | Send email, delete file |
| Critical | **Require approval + confirmation** | Financial transactions, bulk operations |

### The Approval Flow

When the agent wants to do something high-risk:

1. Agent proposes action with full context
2. User sees exactly what will happen
3. User can approve, modify, or reject
4. Agent learns from the decision

This isn't just a safety mechanism - it's how the agent learns boundaries. After approving similar actions repeatedly, you might tell the agent "you can send emails to my team without asking."

### Interrupts

Sometimes the agent needs to pause and ask:

- **Clarification**: "Do you mean the London office or London conference?"
- **Decision**: "Found 3 options - which approach do you prefer?"
- **Confirmation**: "This will delete 47 files. Are you sure?"
- **Escalation**: "I've been trying for 3 days with no response. How should I proceed?"

Interrupts can be immediate (CLI popup) or asynchronous (notification for later).

---

## Growing Capabilities

The goal is an agent that becomes more capable over time - not through code releases, but through learning and natural extension.

### Capability Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                     Natural Conversations                        │
│  "I learned that you prefer X" → becomes a stored preference    │
│  "Remember to always Y" → becomes a behavioral rule             │
├─────────────────────────────────────────────────────────────────┤
│                     Workflows & Procedures                       │
│  "Here's how I handle expense reports" → learned procedure      │
│  Repetition crystallizes into efficient workflows               │
├─────────────────────────────────────────────────────────────────┤
│                     Tools & Integrations                         │
│  New tool sets added through configuration                      │
│  MCP servers for external capabilities                          │
├─────────────────────────────────────────────────────────────────┤
│                     Code Execution                               │
│  Interpreter for ad-hoc computation                             │
│  Custom scripts for specific tasks                              │
├─────────────────────────────────────────────────────────────────┤
│                     Self-Modification (Advanced)                 │
│  Agent proposes improvements to its own code                    │
│  User reviews and approves via PR                               │
└─────────────────────────────────────────────────────────────────┘
```

### Learning Through Conversation

Many capabilities emerge from normal interaction:

| What You Say | What the Agent Learns |
|--------------|----------------------|
| "I always want meeting notes sent afterward" | New routine/procedure |
| "Use this format for weekly reports" | Template/preference |
| "John is my manager now, not Sarah" | World model update |
| "When vendors email, always check with finance first" | Workflow rule |
| "That response was too formal" | Communication style adjustment |

The key insight: **conversation is configuration**. Instead of filling out forms and settings, you just talk to the agent and it adapts.

### The Code Interpreter

For tasks that need computation, the agent can write and execute code:

- "Calculate the compound interest on these loan options"
- "Parse this CSV and find the outliers"
- "Generate a chart of this data"
- "Write a script to rename these files"

The code interpreter is a powerful escape hatch - when the agent doesn't have a specialized tool for something, it can often accomplish the task through code.

### Self-Improvement (Advanced)

The most ambitious capability: the agent can improve itself.

**How it works:**

1. Agent identifies a limitation ("I keep making this mistake" or "This workflow could be better")
2. Agent proposes a modification to its own code
3. Agent creates a branch, makes changes, writes tests
4. Agent opens a PR for user review
5. If approved, the improvement is merged

**Safety controls:**

- Agent only modifies its own codebase, not system files
- All changes go through PR review - nothing auto-merges
- Tests must pass before PR can be opened
- User can always reject or roll back

**Example scenario:**

```
Agent: I've noticed that my calendar conflict detection
       misses all-day events. I've prepared a fix.

       PR #42: Fix all-day event conflict detection
       - Modified: src/calendar/calendar.ts
       - Added test: calendar.test.ts
       - All tests passing

       Would you like to review the changes?
```

This creates a feedback loop where the agent can address its own limitations, subject to user oversight.

---

## Avoiding Dead Ends

A key goal is an architecture that can grow without hitting walls. Here's how we stay flexible:

### Data Over Code

Where possible, capabilities are defined as data rather than hardcoded:

- **Procedures**: Stored workflows, not hardcoded logic
- **Preferences**: Learned patterns, not configuration files
- **Tool definitions**: Declarative descriptions, not inline code
- **Routines**: Scheduled tasks, not cron jobs

This means the agent can learn new procedures through conversation without code changes.

### Plugin Architecture

New capabilities plug in cleanly:

- **MCP servers**: External tools that speak a standard protocol
- **Tool sets**: Grouped tools that can be added/removed
- **Event sources**: New inputs that feed the reactive system
- **Notification channels**: New ways to reach the user

Adding a new email provider, for example, shouldn't require rearchitecting - it's just a new event source with the same interface.

### Graceful Degradation

When capabilities aren't available, the agent adapts:

- No calendar integration? Still works, just asks about timing
- Tool fails? Tries alternatives, or asks the user
- Memory full? Consolidates more aggressively
- Offline? Queues actions for later

The agent should never completely fail because one component is unavailable.

### Evolution Path

Capabilities build on each other:

```
Phase 1: Foundation
  └─ Knows who you are, your schedule, your contacts
Phase 2: Conversation
  └─ Natural interaction, tool usage, helpful responses
Phase 3: Trust
  └─ Approval flows, risk management, transparency
Phase 4: Memory
  └─ Learning, patterns, long-term recall
Phase 5: Autonomy
  └─ Long-running tasks, proactive behavior
Phase 6: Reactivity
  └─ Event processing, email handling, monitoring
Phase 7: Growth
  └─ Self-scheduled improvements, code interpreter
Phase 8: Self-modification
  └─ Agent improves its own code
```

Each phase builds on the previous ones. You can stop at any phase and have a useful system - later phases just add more capability.

---

## Summary: The GLaDOS Difference

| Aspect | Traditional Bot | GLaDOS |
|--------|-----------------|--------|
| Identity | Stateless, generic | Knows you, your world, your history |
| Knowledge | None or static | Entity knowledge, procedures, learned facts |
| Task handling | Commands or nothing | Deadlines, recurring, deferred, conditional |
| Configuration | Settings and forms | Learn through conversation |
| Capabilities | Fixed set of tools | Discoverable, extensible, learnable |
| Behavior | Reactive only | Proactive + reactive |
| Consistency | Varies by interaction | Learned procedures ensure repeatability |
| Trust | All or nothing | Graduated, earned, transparent |
| Evolution | Code releases | Continuous learning + self-improvement |

GLaDOS isn't just a chatbot with more features. It's a different paradigm: **a persistent relationship with an AI that grows more capable and more personalized over time**.

The architecture supports this through:
- **World model**: Rich understanding of people, places, events, and entities
- **Task system**: Flexible scheduling that adapts to how work actually happens
- **Knowledge accumulation**: Facts, procedures, and patterns that compound over time
- **Proactive autonomy**: The agent works for you even when you're not there
- **Self-improvement**: Capabilities grow through learning and, ultimately, self-modification

---

## References

- [System Specification](../spec/agent.md) - Technical details
- [Getting Started](./getting-started.md) - Setup and usage
- [Coding Standards](./coding-standards.md) - Development conventions
