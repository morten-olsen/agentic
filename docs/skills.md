# Skills System

The Skills System provides domain-specific capabilities with gated activation. Skills bundle tools and domain knowledge that the agent can acquire dynamically when needed, without bloating the base context.

## Overview

### What is a Skill?

A skill is a package of:

- **Tools**: Capabilities the agent can use after activation
- **Domain Knowledge**: Instructions injected into the agent's context
- **Activation Risk**: Determines if user approval is required

### Why Skills?

1. **Context Efficiency**: Keep the base agent context minimal; load specialized knowledge only when needed
2. **Gated Activation**: High-capability skills require user approval before activation
3. **Post-Activation Freedom**: Once approved, the agent can freely use skill tools
4. **Self-Management**: Skills can be deactivated when no longer needed

## Using Skills

### Listing Available Skills

The agent can list all available and active skills:

```
User: What skills do you have available?
Agent: [Calls list_skills tool]
```

### Activating a Skill

The agent recognizes when it needs a skill and calls the activation tool:

```
User: Can you analyze this CSV file?
Agent: [Recognizes need for data-analysis skill]
Agent: [Calls activate_data_analysis]
→ Skill activates immediately (low risk)
Agent: [Now has access to data analysis tools]
```

For high-risk skills, an approval interrupt is created:

```
User: Can you create a custom monitoring tool?
Agent: [Calls activate_tool_builder]
→ Interrupt sent to user for approval
User: [Approves]
Agent: [Now has access to tool builder tools]
```

### Deactivating a Skill

When a skill is no longer needed:

```
Agent: [Calls deactivate_skill with skillId: "data-analysis"]
→ Skill tools removed from available tools
```

## Activation Risk Levels

| Risk Level | Behavior |
|------------|----------|
| `none` | Activates immediately |
| `low` | Activates immediately, logged |
| `medium` | Activates immediately, logged |
| `high` | **Requires user approval** |
| `critical` | **Requires user approval + confirmation** |

The activation risk represents the danger of _having access_ to a skill's tools. Individual tools within an activated skill still respect their own risk profiles.

## Creating Custom Skills

### File Structure

```
src/skills/my-skill/
├── index.ts              # Barrel export
├── my-skill.ts           # Skill definition
├── my-skill.tools.ts     # Skill-specific tools
└── my-skill.test.ts      # Tests
```

### Skill Definition

```typescript
import { z } from 'zod';
import type { SkillDefinition } from '../skills.schemas.ts';
import { myQueryTool, myActionTool } from './my-skill.tools.ts';

export const mySkill: SkillDefinition = {
  id: 'my-skill',
  name: 'My Skill',
  description: 'Description of what this skill does',

  // Activation gating
  activationRisk: 'high', // or 'none', 'low', 'medium', 'critical'
  activationReason: 'Why this risk level',

  // Optional: parameters for activation
  activationSchema: z.object({
    someParam: z.string().optional(),
  }),

  // Tools available after activation
  tools: [myQueryTool, myActionTool],

  // Instructions injected into agent context
  domainKnowledge: `
# My Skill

Instructions for how to use this skill effectively...
`,

  // Optional: lifecycle hooks
  onActivate: async (params, context) => {
    // Load data, validate prerequisites, etc.
    return { success: true };
  },

  onDeactivate: async (context) => {
    // Cleanup resources
  },

  // Metadata
  tags: ['category'],
  relatedSkills: [],
};
```

### Registering a Skill

Register your skill in the orchestrator setup:

```typescript
import { mySkill } from './skills/my-skill/my-skill.ts';

// In orchestrator initialization
skillRegistry.register(mySkill);
```

## Agent Tools

The Skills System provides these tools to the agent:

### `activate_<skillId>`

One activation tool is generated for each registered skill. Calling it activates the skill (subject to risk approval).

**Input**: Depends on skill's `activationSchema` (empty by default)

**Output**:
```typescript
{
  activated: boolean;
  message: string;
  skillId: string;
}
```

### `DeactivateSkill`

Deactivates an active skill.

**Input**:
```typescript
{
  skillId: string;  // ID of the skill to deactivate
}
```

**Output**:
```typescript
{
  deactivated: boolean;
  message: string;
  skillId: string;
}
```

### `ListSkills`

Lists all available and active skills.

**Input**:
```typescript
{
  includeInactive?: boolean;  // Default: true
}
```

**Output**:
```typescript
{
  activeSkills: Array<{
    id: string;
    name: string;
    description: string;
    activationRisk: ActivationRisk;
    activatedAt: string;
    isActive: boolean;
  }>;
  availableSkills: Array<{
    id: string;
    name: string;
    description: string;
    activationRisk: ActivationRisk;
    isActive: boolean;
  }>;
}
```

## Orchestrator Integration

### State

The orchestrator state includes:

```typescript
{
  activeSkills: ActiveSkill[];           // Currently active skills
  pendingSkillActivation: {              // Skill awaiting approval
    skillId: string;
    activationParams: unknown;
    toolCallId: string;
  } | null;
}
```

### Graph Flow

```
risk_gate → skill_activation → [interrupt | tools]
                   ↓
         (if high risk skill)
                   ↓
             interrupt → (user approves) → tools
```

### Context Injection

When a skill is active, its domain knowledge is injected into the system prompt:

```
## Active Skills

### Data Analysis

You can now analyze data files (CSV, JSON, Excel, etc.)...

[skill's domainKnowledge content]
```

## Database Schema

Skill activations are tracked in `skill_activations`:

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | Primary key |
| `conversation_id` | TEXT | FK to conversations |
| `skill_id` | TEXT | Skill identifier |
| `activated_at` | TEXT | ISO8601 timestamp |
| `deactivated_at` | TEXT | When deactivated (nullable) |
| `activation_params` | TEXT | JSON parameters |
| `activation_risk` | TEXT | Risk level at activation |
| `required_approval` | INTEGER | 0 or 1 |
| `approved_at` | TEXT | When approved (if required) |

## Configuration

Skills configuration is available through the services:

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

## Best Practices

### Designing Skills

1. **Single Responsibility**: Each skill should focus on one domain
2. **Clear Risk Assessment**: Be honest about the activation risk
3. **Comprehensive Domain Knowledge**: Provide enough context for effective tool use
4. **Appropriate Tool Risk**: Individual tools should have their own risk profiles

### Activation Risk Guidelines

| Use Case | Suggested Risk |
|----------|----------------|
| Read-only data analysis | `none` or `low` |
| File modification | `medium` |
| Script execution | `high` |
| System configuration changes | `high` or `critical` |
| Network access to external services | `medium` to `high` |

### Domain Knowledge Tips

- Include clear workflow guidance
- Document available tools and their purposes
- Provide safety warnings where appropriate
- Include examples for complex operations

## Future Considerations

- **Skill Dependencies**: Skills that require other skills
- **Skill Persistence**: Option to persist across conversations
- **Skill Marketplace**: User-installable external skills
- **Conditional Activation**: Context-based automatic activation
