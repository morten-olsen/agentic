# Skills System Specification

> Domain-specific capabilities with gated activation

**Version**: 1.0
**Status**: Implemented
**Dependencies**: Tool Sets (Phase 7), Interrupts (Phase 3)

## Overview

The Skills System provides a mechanism for the agent to dynamically acquire domain-specific knowledge and tools when needed, without bloating the base context. Some skills require human approval before activation, enabling powerful capabilities (like executing scripts or modifying system configuration) to be safely unlocked on demand.

### Goals

1. **Context Efficiency**: Keep the base agent context minimal; load specialized knowledge only when needed
2. **Gated Activation**: High-capability skills require user approval before activation
3. **Post-Activation Freedom**: Once approved, the agent can freely use skill tools without per-call approval
4. **Domain Knowledge Injection**: Skills provide not just tools, but instructions on how to use them effectively
5. **Self-Management**: Skills can be deactivated when no longer needed

### Non-Goals (for v1)

- Skill dependencies (skill A requires skill B)
- Skill persistence across conversations
- Automatic skill detection (agent must explicitly activate)
- Skill-specific memory or state (beyond what tools provide)

### Relationship to Tool Sets

Skills build on top of Tool Sets:

| Concept | Tool Sets | Skills |
|---------|-----------|--------|
| What it contains | Tools only | Tools + domain knowledge + activation logic |
| Activation | Discovery agent recommends | Agent explicitly activates |
| Approval | Individual tool risk | Skill-level approval gate |
| Context | Tool descriptions | Rich domain instructions |

A skill may wrap one or more tool sets, adding domain knowledge and an activation gate.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Skills System                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌───────────────────────────────────────────────────────────────┐ │
│   │                      SkillRegistry                            │ │
│   │  - Registered skills (id → definition)                        │ │
│   │  - Activation tools (always available)                        │ │
│   └───────────────────────────────────────────────────────────────┘ │
│                                │                                     │
│                                ▼                                     │
│   ┌───────────────────────────────────────────────────────────────┐ │
│   │                    Activation Flow                            │ │
│   │                                                               │ │
│   │  1. Agent calls activate_<skill>                              │ │
│   │  2. If skill.activationRisk >= threshold → Interrupt          │ │
│   │  3. User approves (or denies)                                 │ │
│   │  4. On approval:                                              │ │
│   │     - Skill tools added to availableTools                     │ │
│   │     - Domain knowledge injected into context                  │ │
│   │     - Skill marked active in state                            │ │
│   └───────────────────────────────────────────────────────────────┘ │
│                                │                                     │
│                                ▼                                     │
│   ┌───────────────────────────────────────────────────────────────┐ │
│   │                    Active Skill                               │ │
│   │                                                               │ │
│   │  - Tools available without further approval (except their     │ │
│   │    individual risk profiles)                                  │ │
│   │  - Domain instructions in system context                      │ │
│   │  - Agent can deactivate when done                             │ │
│   └───────────────────────────────────────────────────────────────┘ │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Skill-Level Approval Gate**: Unlike individual tool approval (which happens per-call), skill approval is a one-time gate. Once a skill is activated, its tools can be used freely (subject to their own individual risk profiles).

2. **Activation Risk vs Tool Risk**: A skill's activation risk represents the danger of _having access_ to its tools. Individual tools within the skill still have their own risk profiles for actual execution.

3. **Context Injection**: When a skill activates, it injects domain knowledge into the agent's context. This knowledge guides how the agent should use the skill's tools.

4. **Explicit Activation Only**: Skills must be explicitly activated by the agent calling an activation tool. There's no automatic detection - the agent must recognize when it needs a skill.

---

## Data Model

### Skill Definition

```typescript
type ActivationRisk = 'none' | 'low' | 'medium' | 'high' | 'critical';

type SkillDefinition = {
  id: string;
  name: string;
  description: string;                    // Shown to agent in activation tool

  // Activation
  activationRisk: ActivationRisk;         // Risk level for activating the skill
  activationReason: string;               // Why this risk level (for approval prompt)
  activationSchema?: z.ZodSchema;         // Optional parameters for activation

  // What the skill provides
  tools: ToolDefinition[];                // Tools available after activation
  domainKnowledge: string;                // Markdown instructions injected on activation

  // Optional: data loading
  onActivate?: (params: unknown, context: SkillContext) => Promise<SkillActivationResult>;
  onDeactivate?: (context: SkillContext) => Promise<void>;

  // Metadata
  tags: string[];
  relatedSkills: string[];                // Other skills often used together
};

type SkillContext = {
  conversationId: string;
  services: ServiceContainer;
  logger: Logger;
};

type SkillActivationResult = {
  success: boolean;
  additionalContext?: string;             // Extra context to inject (e.g., loaded data summary)
  error?: string;                         // If activation failed
};
```

### Active Skill State

```typescript
type ActiveSkill = {
  id: string;
  activatedAt: string;                    // ISO8601
  activationParams?: unknown;             // Parameters passed to activation
  additionalContext?: string;             // Context returned by onActivate
};

// Added to OrchestratorState
type OrchestratorState = {
  // ... existing fields

  activeSkills: ActiveSkill[];            // Currently active skills
};
```

### Skill Activation Interrupt

When a skill requires approval, the activation tool creates an interrupt:

```typescript
type SkillActivationInterrupt = Interrupt & {
  type: 'skill_activation';
  skillId: string;
  skillName: string;
  activationRisk: ActivationRisk;
  activationReason: string;
  activationParams?: unknown;

  // What capabilities will be unlocked
  toolsSummary: string;                   // Human-readable list of tools
};
```

---

## Activation Flow

### Risk Thresholds

| Activation Risk | Behavior |
|-----------------|----------|
| `none` | Activate immediately |
| `low` | Activate immediately, log activation |
| `medium` | Activate immediately, log activation (same as low for v1) |
| `high` | **Require user approval** |
| `critical` | **Require user approval + confirmation** |

### Activation Sequence

```
User: "Can you build a custom tool to monitor my server?"

Agent: [Recognizes need for tool-builder skill]
Agent: [Calls activate_tool_builder]

SkillRegistry: [Checks activationRisk = 'high']
SkillRegistry: [Creates interrupt]

Interrupt to User:
  "I'd like to activate the Tool Builder skill.

   This skill allows me to create and test custom tools, which requires
   executing scripts on your machine.

   Capabilities that will be unlocked:
   - Create tool definitions
   - Test tools by executing them
   - Install tools into the tool registry

   [Approve] [Deny]"

User: [Approves]

SkillRegistry: [Adds tool-builder tools to availableTools]
SkillRegistry: [Injects domain knowledge into context]
SkillRegistry: [Marks skill as active]

Agent: [Now has access to tool creation tools]
Agent: [Proceeds to build the monitoring tool]
```

### Post-Activation Tool Usage

Once a skill is activated, its tools become available. Each tool still has its own risk profile:

```
Skill activated: tool-builder (activationRisk: high)
  └── create_tool_definition (tool risk: low) → executes immediately
  └── test_tool (tool risk: high) → requires per-call approval
  └── install_tool (tool risk: medium) → executes immediately
```

The skill's `activationRisk` gates access to the capability. Individual tools within the skill still respect their own risk profiles.

---

## Agent Tools

### Activation Tools

Each skill registers an activation tool. These are always available in the base tools.

```typescript
// Generated for each skill
const createActivationTool = (skill: SkillDefinition): ToolDefinition => ({
  id: `activate_${skill.id}`,
  name: `Activate ${skill.name}`,
  description: `Activate the ${skill.name} skill. ${skill.description}

    After activation, you'll have access to:
    ${skill.tools.map(t => `- ${t.name}: ${t.description}`).join('\n')}`,

  category: 'skills',

  inputSchema: skill.activationSchema ?? z.object({}),
  outputSchema: z.object({
    activated: z.boolean(),
    message: z.string(),
  }),

  risk: {
    level: 'low',  // Activation tool itself is low risk
    reason: 'Activation may require approval based on skill risk',
    potentialImpact: 'Unlocks additional capabilities',
    reversible: true,
    categories: [],
  },

  tags: ['skill', 'activation', ...skill.tags],
  examples: [],

  execute: async (input, context) => {
    // Handled by skill activation logic, not direct execution
    // See SkillActivationNode below
    throw new Error('Handled by skill activation node');
  },
});
```

### Deactivation Tool

A single tool for deactivating any active skill:

```typescript
const deactivateSkillTool: ToolDefinition = {
  id: 'deactivate_skill',
  name: 'Deactivate Skill',
  description: `Deactivate a currently active skill when you no longer need its capabilities.
    This removes the skill's tools from your available tools.`,

  inputSchema: z.object({
    skillId: z.string().describe('ID of the skill to deactivate'),
  }),

  outputSchema: z.object({
    deactivated: z.boolean(),
    message: z.string(),
  }),

  risk: {
    level: 'low',
    reason: 'Only removes capabilities',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },

  // ...
};
```

### List Skills Tool

```typescript
const listSkillsTool: ToolDefinition = {
  id: 'list_skills',
  name: 'List Skills',
  description: 'List all available skills and their activation status.',

  inputSchema: z.object({
    includeInactive: z.boolean().default(true),
  }),

  outputSchema: z.object({
    activeSkills: z.array(z.object({
      id: z.string(),
      name: z.string(),
      activatedAt: z.string(),
    })),
    availableSkills: z.array(z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      activationRisk: z.enum(['none', 'low', 'medium', 'high', 'critical']),
    })),
  }),

  // ...
};
```

---

## Orchestrator Integration

### Skill Activation Node

The orchestrator graph includes a node that handles skill activation:

```typescript
const skillActivationNode = async (state: OrchestratorState): Promise<OrchestratorState | Interrupt> => {
  const pendingToolCall = state.pendingToolCall;
  if (!pendingToolCall?.toolId.startsWith('activate_')) {
    return state;
  }

  const skillId = pendingToolCall.toolId.replace('activate_', '');
  const skill = skillRegistry.get(skillId);

  if (!skill) {
    return state; // Unknown skill, let tool execution handle error
  }

  // Check if already active
  if (state.activeSkills.some(s => s.id === skillId)) {
    return {
      ...state,
      pendingToolCall: null,
      lastToolResult: {
        toolId: pendingToolCall.toolId,
        result: { activated: true, message: `${skill.name} is already active` },
      },
    };
  }

  // Check activation risk
  if (skill.activationRisk === 'high' || skill.activationRisk === 'critical') {
    return createInterrupt({
      type: 'skill_activation',
      skillId: skill.id,
      skillName: skill.name,
      activationRisk: skill.activationRisk,
      activationReason: skill.activationReason,
      activationParams: pendingToolCall.input,
      toolsSummary: skill.tools.map(t => `- ${t.name}: ${t.description}`).join('\n'),
      prompt: formatSkillActivationPrompt(skill),
      options: [
        { id: 'approve', label: 'Approve' },
        { id: 'deny', label: 'Deny' },
      ],
      resumeState: state,
    });
  }

  // Low/medium/none risk: activate immediately
  return await activateSkill(state, skill, pendingToolCall.input);
};

const activateSkill = async (
  state: OrchestratorState,
  skill: SkillDefinition,
  params: unknown,
): Promise<OrchestratorState> => {
  // Run onActivate hook if present
  let additionalContext: string | undefined;
  if (skill.onActivate) {
    const result = await skill.onActivate(params, buildSkillContext(state));
    if (!result.success) {
      return {
        ...state,
        pendingToolCall: null,
        lastToolResult: {
          toolId: `activate_${skill.id}`,
          result: { activated: false, message: result.error ?? 'Activation failed' },
        },
      };
    }
    additionalContext = result.additionalContext;
  }

  // Add skill to active skills
  const activeSkill: ActiveSkill = {
    id: skill.id,
    activatedAt: new Date().toISOString(),
    activationParams: params,
    additionalContext,
  };

  // Merge skill tools into available tools
  const newTools = skill.tools.filter(
    t => !state.availableTools.some(existing => existing.id === t.id)
  );

  return {
    ...state,
    activeSkills: [...state.activeSkills, activeSkill],
    availableTools: [...state.availableTools, ...newTools],
    pendingToolCall: null,
    lastToolResult: {
      toolId: `activate_${skill.id}`,
      result: { activated: true, message: `${skill.name} activated successfully` },
    },
  };
};
```

### Context Injection

When building the agent's context, active skills inject their domain knowledge:

```typescript
const buildAgentContext = (state: OrchestratorState): string => {
  const parts: string[] = [];

  // ... existing context building

  // Inject active skill knowledge
  for (const activeSkill of state.activeSkills) {
    const skill = skillRegistry.get(activeSkill.id);
    if (skill) {
      parts.push(`## Active Skill: ${skill.name}\n\n${skill.domainKnowledge}`);

      if (activeSkill.additionalContext) {
        parts.push(activeSkill.additionalContext);
      }
    }
  }

  return parts.join('\n\n---\n\n');
};
```

---

## Example Skills

### Tool Builder Skill

A skill for creating custom tools, requiring high approval due to script execution.

```typescript
const toolBuilderSkill: SkillDefinition = {
  id: 'tool-builder',
  name: 'Tool Builder',
  description: 'Create, test, and install custom tools for the agent',

  activationRisk: 'high',
  activationReason: 'Allows executing arbitrary scripts during tool testing',

  tools: [
    createToolDefinitionTool,
    validateToolSchemaTool,
    testToolTool,          // risk: high (executes code)
    installToolTool,       // risk: medium
    listCustomToolsTool,   // risk: low
  ],

  domainKnowledge: `
# Tool Builder Skill

You are now able to create custom tools for yourself. Follow these guidelines:

## Creating Tools

1. **Understand the requirement**: What capability does the user need?
2. **Design the interface**: What inputs and outputs should the tool have?
3. **Implement carefully**: Tools should be focused and do one thing well
4. **Test thoroughly**: Always test with edge cases before installing

## Tool Structure

Tools must follow the GLaDOS tool definition format:
- Clear name and description
- Zod input/output schemas
- Risk profile (be honest about risks)
- Proper error handling

## Testing

When testing tools, scripts will be executed on the user's machine. Be careful:
- Validate all inputs
- Don't access files outside allowed directories
- Don't make network requests without clear purpose
- Clean up any temporary files

## Installation

Once tested, tools can be installed and will be available in future conversations.
Installed tools appear in the 'custom' tool set.
`,

  tags: ['development', 'extensibility'],
  relatedSkills: ['scripting', 'automation'],
};
```

### System Configuration Skill

A skill for modifying GLaDOS configuration.

```typescript
const systemConfigSkill: SkillDefinition = {
  id: 'system-config',
  name: 'System Configuration',
  description: 'Modify GLaDOS system configuration and settings',

  activationRisk: 'high',
  activationReason: 'Can modify system behavior and settings',

  tools: [
    getConfigTool,         // risk: low
    updateConfigTool,      // risk: high
    validateConfigTool,    // risk: low
    reloadConfigTool,      // risk: medium
  ],

  domainKnowledge: `
# System Configuration Skill

You can now view and modify GLaDOS configuration.

## Available Settings

- LLM configuration (model, temperature, etc.)
- Notification preferences
- Trigger defaults
- Tool set defaults

## Safety

- Always validate configuration before applying
- Keep backups of working configurations
- Some changes require restart to take effect
`,

  tags: ['system', 'admin'],
  relatedSkills: [],
};
```

### Data Analysis Skill

A skill with no activation gate (low risk) for data analysis.

```typescript
const dataAnalysisSkill: SkillDefinition = {
  id: 'data-analysis',
  name: 'Data Analysis',
  description: 'Analyze data files and generate insights',

  activationRisk: 'none',
  activationReason: 'Read-only data analysis',

  tools: [
    loadDataFileTool,      // risk: low
    describeDataTool,      // risk: low
    queryDataTool,         // risk: low
    generateChartTool,     // risk: low
    exportResultsTool,     // risk: medium
  ],

  domainKnowledge: `
# Data Analysis Skill

You can now analyze data files (CSV, JSON, Excel, etc.).

## Workflow

1. Load data with load_data_file
2. Explore with describe_data
3. Query with query_data (SQL-like syntax)
4. Visualize with generate_chart
5. Export results if needed

## Supported Formats

- CSV, TSV
- JSON, JSONL
- Excel (.xlsx, .xls)
- Parquet

## Tips

- Always start by describing the data to understand its structure
- Use appropriate aggregations for large datasets
- Check for missing values before analysis
`,

  tags: ['data', 'analysis'],
  relatedSkills: [],
};
```

---

## Database Schema

### Migration: `xxx_skills.ts`

```sql
-- Track skill activations (for analytics and debugging)
CREATE TABLE skill_activations (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  skill_id TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  deactivated_at TEXT,
  activation_params TEXT,                -- JSON
  activation_risk TEXT NOT NULL,
  required_approval INTEGER NOT NULL,    -- 0 or 1
  approved_at TEXT,                       -- When user approved (if required)

  created_at TEXT NOT NULL
);

CREATE INDEX idx_skill_activations_conversation ON skill_activations(conversation_id);
CREATE INDEX idx_skill_activations_skill ON skill_activations(skill_id);
```

---

## SkillRegistry

### Interface

```typescript
class SkillRegistry {
  constructor(deps: { logger: Logger });

  // Registration
  register(skill: SkillDefinition): void;
  unregister(skillId: string): void;

  // Queries
  get(skillId: string): SkillDefinition | null;
  getAll(): SkillDefinition[];
  getActivationTools(): ToolDefinition[];

  // State (for a conversation)
  isActive(skillId: string, state: OrchestratorState): boolean;
  getActiveSkills(state: OrchestratorState): SkillDefinition[];
  getAvailableTools(state: OrchestratorState): ToolDefinition[];
}
```

### Tool Aggregation

The registry provides all available tools for a conversation state:

```typescript
getAvailableTools(state: OrchestratorState): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  // Always available: activation tools for all skills
  tools.push(...this.getActivationTools());

  // Always available: deactivate_skill, list_skills
  tools.push(deactivateSkillTool, listSkillsTool);

  // Add tools from active skills
  for (const activeSkill of state.activeSkills) {
    const skill = this.get(activeSkill.id);
    if (skill) {
      tools.push(...skill.tools);
    }
  }

  return tools;
}
```

---

## Adding a New Skill

### 1. Create Skill Directory

```
src/skills/<skill-name>/
├── index.ts              # Barrel export
├── <skill-name>.ts       # Skill definition
├── <skill-name>.tools.ts # Skill-specific tools
└── <skill-name>.test.ts  # Tests
```

### 2. Define the Skill

```typescript
// src/skills/my-skill/my-skill.ts
import { z } from 'zod';
import type { SkillDefinition } from '../skills.schemas.ts';
import { myQueryTool, myActionTool } from './my-skill.tools.ts';

export const mySkill: SkillDefinition = {
  id: 'my-skill',
  name: 'My Skill',
  description: 'Description of what this skill does',

  activationRisk: 'high', // or 'none', 'low', 'medium', 'critical'
  activationReason: 'Why this risk level',

  activationSchema: z.object({
    someParam: z.string().optional(),
  }),

  tools: [myQueryTool, myActionTool],

  domainKnowledge: `
# My Skill

Instructions for how to use this skill effectively...
`,

  onActivate: async (params, context) => {
    // Optional: Load data, validate prerequisites, etc.
    return { success: true };
  },

  tags: ['category'],
  relatedSkills: [],
};
```

### 3. Register the Skill

```typescript
// src/skills/skills.ts
import { mySkill } from './my-skill/my-skill.ts';

export const registerBuiltinSkills = (registry: SkillRegistry) => {
  registry.register(mySkill);
  // ... other skills
};
```

---

## Configuration

```typescript
type SkillsConfig = {
  // Risk threshold for requiring approval
  approvalThreshold: ActivationRisk;      // Default: 'high'

  // Whether to log activations
  logActivations: boolean;                 // Default: true

  // Maximum concurrent active skills
  maxActiveSkills: number;                 // Default: 10
};
```

---

## Testing Strategy

### Unit Tests

- Skill definition validation
- Activation risk checks
- Tool aggregation logic
- Context injection

### Integration Tests

- Skill activation flow (with and without approval)
- Interrupt creation and resolution
- Tool availability after activation
- Skill deactivation and tool removal

### Flow Tests

- End-to-end skill activation with user approval
- Skill-provided tools executing correctly
- Domain knowledge influencing agent behavior
- Multiple skills active simultaneously

---

## Implementation Phases

### Phase 1: Core Infrastructure

- [x] Skill schemas and types
- [x] SkillRegistry class
- [x] Basic activation/deactivation tools
- [x] Database migration

### Phase 2: Orchestrator Integration

- [x] Skill activation node
- [x] Interrupt flow for high-risk skills
- [x] Context injection for active skills
- [x] Tool aggregation

### Phase 3: Built-in Skills

- [ ] Tool Builder skill
- [ ] System Configuration skill
- [ ] Data Analysis skill

### Phase 4: Testing & Documentation

- [x] Comprehensive test suite
- [x] Update CLAUDE.md
- [x] Usage documentation

---

## Future Considerations

1. **Skill Dependencies**: Skills that require other skills to be active first (e.g., "Advanced Data Analysis" requires "Data Analysis")

2. **Skill Persistence**: Option to persist active skills across conversations for long-running workflows

3. **Skill Marketplace**: User-installable skills from external sources

4. **Conditional Activation**: Skills that activate automatically based on context (with appropriate risk gates)

5. **Skill Budgets**: Limit the resources (tokens, time, API calls) a skill's tools can consume

6. **Skill Versioning**: Track skill versions, handle upgrades gracefully
