# Orchestrator Rewrite Specification

> Simplify and stabilize the orchestration layer to handle tools, skills, and interrupts reliably.

**Version**: 1.1
**Status**: Partially Implemented
**Dependencies**: 001-agent.md, 006-skills.md

## Overview

The current orchestrator has grown organically to ~3500 lines across 11 files, with the main `orchestrator.ts` at 1558 lines. It handles conversation management, graph execution, interrupt handling, skill activation, tool loading, memory retrieval, and more. This complexity has led to subtle bugs like duplicate tool declarations, inconsistent state handling, and difficult-to-follow code paths.

### Current Problems

1. **Duplicated Tool Loading Logic**: The same tool collection pattern is repeated in `chat()`, `#resumeAfterApproval()`, `#resumeAfterTurnLimit()`, and `invokeBackground()`. Each must correctly handle base tools, skill tools, service filters, and avoid duplicates.

2. **Graph Recreation on Every Invocation**: The LangGraph is recreated for each message, requiring tools to be bound anew. This led to the duplicate tool bug where skill tools persisted in the registry across invocations.

3. **Monolithic Service**: `OrchestratorService` handles too many concerns:
   - Conversation CRUD
   - Message history management
   - Graph construction and execution
   - Tool collection and filtering
   - Interrupt creation and handling
   - Skill activation flows
   - Memory context injection
   - Background invocations for triggers

4. **Complex Resume Logic**: There are 6+ different resume paths depending on interrupt type:
   - `#handleInterruptResponse` (dispatcher)
   - `#resumeAfterApproval` (tool approval)
   - `#resumeAfterTurnLimit` (continue after pause)
   - `#handleDeniedTool` (tool denial)
   - `#resumeAfterSkillActivation` (skill approval)
   - `#handleDeniedSkillActivation` (skill denial)

5. **Implicit State Dependencies**: Tools registered to the global `ToolRegistry` persist across invocations, creating hidden state. The `activeSkills` in checkpoint state must match what's in the registry.

6. **Testing Difficulty**: The tight coupling makes unit testing hard; most tests require full integration setup.

### Goals

1. **Single Source of Truth for Tools**: Tools should be collected once per conversation session, not rebuilt on every message.

2. **Clear Separation of Concerns**: Split the monolith into focused services:
   - Conversation management (CRUD, history)
   - Graph execution (LLM calls, tool execution)
   - Interrupt handling (approval flows)
   - Tool management (collection, filtering, skills)

3. **Unified Resume Path**: A single, understandable code path for resuming after any interrupt type.

4. **Stateless Tool Collection**: Tool collection should be a pure function of inputs (active skills, configured services) with no hidden state.

5. **Testable Components**: Each component should be testable in isolation.

### Non-Goals (for v1)

- Changing the LangGraph structure itself
- Modifying the checkpoint/persistence system
- Changing the tool or skill definition formats
- Multi-model support (different LLMs for different tasks)

---

## Architecture

### Current Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     OrchestratorService                          │
│  (1558 lines - does everything)                                  │
├─────────────────────────────────────────────────────────────────┤
│  - configure()                                                   │
│  - startConversation(), getConversation(), deleteConversation()  │
│  - chat() → builds tools, creates graph, handles interrupts      │
│  - #resumeAfterApproval() → rebuilds tools, creates graph        │
│  - #resumeAfterTurnLimit() → rebuilds tools, creates graph       │
│  - #resumeAfterSkillActivation() → rebuilds tools, creates graph │
│  - invokeBackground() → builds tools, creates graph              │
│  - #handleInterruptResponse() → dispatches to 6 handlers         │
│  - #getActiveSkillTools() → mutates global registry              │
└─────────────────────────────────────────────────────────────────┘
```

### Proposed Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              Public API                                   │
│                         OrchestratorService                               │
│  (thin facade - delegates to specialized services)                        │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐  │
│  │ ConversationStore  │  │   GraphExecutor    │  │  InterruptHandler  │  │
│  │                    │  │                    │  │                    │  │
│  │ - create()         │  │ - execute()        │  │ - create()         │  │
│  │ - get()            │  │ - resume()         │  │ - respond()        │  │
│  │ - list()           │  │                    │  │ - getResumePath()  │  │
│  │ - delete()         │  │ Uses:              │  │                    │  │
│  │ - addMessage()     │  │ - ToolCollector    │  │                    │  │
│  │ - getMessages()    │  │ - GraphBuilder     │  │                    │  │
│  └────────────────────┘  └────────────────────┘  └────────────────────┘  │
│                                   │                                       │
│                    ┌──────────────┴──────────────┐                       │
│                    │                             │                       │
│           ┌────────▼───────┐          ┌─────────▼────────┐              │
│           │ ToolCollector  │          │   GraphBuilder   │              │
│           │                │          │                  │              │
│           │ - collect()    │          │ - build()        │              │
│           │   (pure fn)    │          │   (deterministic)│              │
│           │                │          │                  │              │
│           │ Inputs:        │          │ Inputs:          │              │
│           │ - activeSkills │          │ - tools          │              │
│           │ - services     │          │ - llm            │              │
│           │ - toolRegistry │          │ - systemPrompt   │              │
│           │ - skillRegistry│          │                  │              │
│           └────────────────┘          └──────────────────┘              │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Data Model

### ToolCollectionResult

```typescript
type ToolCollectionResult = {
  /** All tools available for this invocation (base + skill tools) */
  tools: DynamicStructuredTool[];

  /** Tool IDs from active skills (for reference) */
  skillToolIds: Set<string>;

  /** Active skill definitions (for context building) */
  activeSkillDefinitions: SkillDefinition[];
};
```

### GraphExecutionContext

```typescript
type GraphExecutionContext = {
  conversationId: string;
  systemPrompt: string;
  tools: DynamicStructuredTool[];
  toolRegistry: ToolRegistry;
  skillRegistry: SkillRegistry;
  memoryService?: MemoryService;
  checkpointer: DatabaseCheckpointer;
};
```

### ResumeContext

```typescript
type ResumeContext = {
  interrupt: Interrupt;
  response: InterruptResponse;
  conversationId: string;
  /** Pre-computed state updates based on interrupt type */
  stateUpdates: Partial<OrchestratorState>;
};
```

---

## Implementation Phases

### Phase 1: Extract ToolCollector ✅ IMPLEMENTED

Create a pure function for tool collection that takes explicit inputs and returns tools without side effects.

- [x] Create `orchestrator.tool-collector.ts` with `collectTools()` function
- [x] Make tool collection stateless (no registry mutation)
- [x] Collect skill tools directly from skill definitions, not from global registry
- [x] Update `chat()` to use new `collectTools()`
- [x] Update all resume methods to use `collectTools()`
- [x] Add unit tests for `collectTools()` in isolation

**Implementation Notes:**
- Created `orchestrator.tool-collector.ts` with `collectTools()` function
- Uses a `ToolLookup` interface that works with both `ToolRegistry` and a `Map` of tool definitions
- Returns `{ tools, toolLookup, skillToolIds }` - the toolLookup is used by the risk gate
- Updated `orchestrator.risk-gate.ts` to accept `ToolLookup` instead of just `ToolRegistry`
- All resume handlers now use `collectTools()` instead of direct registry manipulation

### Phase 2: Extract ConversationStore ✅ IMPLEMENTED

Move conversation CRUD to a dedicated module (mostly exists in `orchestrator.store.ts` already).

- [x] Ensure `orchestrator.store.ts` is self-contained
- [x] Remove conversation methods from `OrchestratorService` (delegate instead)
- [x] Add missing tests for store operations

**Implementation Notes:**
- Created `ConversationStore` class that encapsulates all conversation/message operations
- Store accepts optional checkpointer for cascade deletes (checkpoint data deleted when conversation deleted)
- `OrchestratorService` now uses `#conversationStore` instance instead of calling functions directly
- Added 26 unit tests for `ConversationStore` in `orchestrator.store.test.ts`
- All 1087 tests pass

### Phase 3: Unify Resume Logic ✅ IMPLEMENTED

Consolidate the 6 resume handlers into a single path with strategy pattern.

- [x] Create `orchestrator.resume.ts` with `ResumeStrategy` type
- [x] Define strategies for `approvalStrategy`, `turnLimitStrategy`, `skillActivationStrategy`
- [x] Add `getResumeStrategy(interruptType)` function
- [x] Add tests for resume strategies
- [x] Single `#resumeWithStrategy()` method in OrchestratorService that applies context and continues
- [x] Simplify `#resumeAfterApproval`, `#resumeAfterTurnLimit`, `#resumeAfterSkillActivation` to delegate to unified method
- [x] All existing tests pass through unified path

**Implementation Notes:**
- Created `orchestrator.resume.ts` with strategy definitions
- Added unified `#resumeWithStrategy()` method (~190 lines) containing all common resume logic
- Simplified approval handlers from ~190 lines each to ~10 lines each
- Denial handlers remain separate (they just call `chat()` recursively, no duplication)
- All 1061 tests pass

### Phase 4: Extract GraphExecutor ✅ IMPLEMENTED

Isolate graph construction and execution.

- [x] Create `GraphExecutor` class
- [x] `execute(context, input)` - new conversation or continued chat
- [x] `resume(context, input)` - after interrupt
- [x] `getState(conversationId)` - get checkpoint state
- [x] Graph is built once per execution
- [x] Add tests for GraphExecutor

**Implementation Notes:**
- Created `orchestrator.executor.ts` with `GraphExecutor` class
- Encapsulates graph creation, compilation, and execution
- Provides clean interface: `execute()`, `resume()`, `getState()`
- `ExecutionResult` includes state and interrupt type detection
- Updated `chat()`, `#resumeWithStrategy()`, `invokeBackground()`, and `getState()` to use executor
- Removed direct `createOrchestratorGraph()` calls from orchestrator
- Added 9 unit tests for `GraphExecutor`
- All 1096 tests pass

### Phase 5: Simplify OrchestratorService ✅ IMPLEMENTED

Reduce duplication and improve code organization through helper methods.

- [x] `chat()` uses helpers: `#buildSystemPrompt`, `#collectExecutionTools`, `#handleExecutionInterrupts`, `#extractResponse`
- [x] `respondToInterrupt()` uses strategy pattern via `#resumeWithStrategy`
- [x] `invokeBackground()` uses `#extractResponse` helper
- [x] Combined denial handlers into unified `#handleDenial` method
- [x] Added `#getActiveSkillsFromCheckpoint` helper
- [x] Reduced from ~1120 lines to 997 lines (55 lines are re-exports)

**Implementation Notes:**
- The orchestrator now uses extracted helpers instead of duplicated inline code
- All resume handlers delegate to `#resumeWithStrategy` with strategy pattern
- The <300 line target was optimistic; the remaining code is necessary coordination logic
- Exports (~55 lines) and imports (~43 lines) account for ~10% of the file
- All 1096 tests pass

### Phase 6: Documentation and Migration

- [ ] Update `docs/debugging.md` with new architecture
- [ ] Update `CLAUDE.md` if module organization changes
- [x] Ensure all 1096+ tests still pass
- [ ] Performance benchmarking (should be faster with less redundant work)

---

## Key Design Decisions

### 1. Session-Scoped Tool Registry

**Problem**: Skill tools registered to the global `ToolRegistry` persist across invocations.

**Solution**: For each graph execution, create a shallow copy of the tool registry that includes skill tools. The global registry remains unchanged.

```typescript
const collectTools = (
  baseRegistry: ToolRegistry,
  skillRegistry: SkillRegistry,
  activeSkills: ActiveSkill[],
  serviceFilter: (tool: RegisteredTool) => boolean,
): ToolCollectionResult => {
  // Create session-scoped registry (copy of base)
  const sessionRegistry = baseRegistry.clone();

  // Add skill tools to session registry
  const skillDefs = skillRegistry.getActiveSkillDefinitions(activeSkills);
  const skillToolIds = new Set<string>();

  for (const skill of skillDefs) {
    for (const tool of skill.tools) {
      sessionRegistry.register(tool);
      skillToolIds.add(tool.id);
    }
  }

  // Collect all tools that pass filters
  const tools = sessionRegistry.getAll()
    .filter(serviceFilter)
    .map(tool => toLangChainTool(tool, context));

  return { tools, skillToolIds, activeSkillDefinitions: skillDefs };
};
```

### 2. Unified Resume with Strategy Pattern

**Problem**: 6 different resume handlers with duplicated setup logic.

**Solution**: Each interrupt type defines how to compute the resume state, then a single executor applies it.

```typescript
type ResumeStrategy = {
  computeStateUpdates(interrupt: Interrupt, response: InterruptResponse): Partial<OrchestratorState>;
  getToolCallId(interrupt: Interrupt): string | null;
};

const resumeStrategies: Record<InterruptType, ResumeStrategy> = {
  tool_approval: {
    computeStateUpdates: (interrupt, response) => ({
      approvedToolCalls: response.approved ? [interrupt.toolCall] : [],
      interruptRequired: false,
      pendingToolCall: null,
    }),
    getToolCallId: (interrupt) => interrupt.toolCall?.id ?? null,
  },
  skill_activation: {
    computeStateUpdates: (interrupt, response) => ({
      // ... skill-specific updates
    }),
    getToolCallId: (interrupt) => interrupt.skillActivation?.toolCallId ?? null,
  },
  // ... other types
};
```

### 3. Graph Reuse Within Session

**Problem**: Graph is rebuilt for every message, wasting computation.

**Solution**: Cache the compiled graph per conversation session. Invalidate when skills change.

```typescript
class GraphExecutor {
  #graphCache = new Map<string, CompiledGraph>();

  getOrBuildGraph(conversationId: string, context: GraphExecutionContext): CompiledGraph {
    const cacheKey = this.#computeCacheKey(conversationId, context);

    if (!this.#graphCache.has(cacheKey)) {
      const graph = createOrchestratorGraph(...);
      this.#graphCache.set(cacheKey, graph.compile({ checkpointer: context.checkpointer }));
    }

    return this.#graphCache.get(cacheKey)!;
  }

  invalidate(conversationId: string): void {
    // Remove all entries for this conversation
    for (const key of this.#graphCache.keys()) {
      if (key.startsWith(conversationId)) {
        this.#graphCache.delete(key);
      }
    }
  }
}
```

---

## Future Considerations

- **Multi-Model Support**: Different LLMs for different tasks (fast model for simple queries, powerful model for complex reasoning)
- **Streaming Improvements**: Better streaming support with partial tool call updates
- **Parallel Tool Execution**: Execute independent tools in parallel
- **Graph Visualization**: Debug tool showing graph state and transitions
- **Conversation Branching**: Fork conversations to explore different paths

---

## Migration Notes

The rewrite should be done incrementally:

1. Each phase can be merged independently
2. The public API (`chat()`, `respondToInterrupt()`, `invokeBackground()`) stays the same
3. All existing tests should pass throughout
4. New tests added for extracted components

This is a refactoring effort, not a feature change. The behavior should remain identical, just better organized and more reliable.
