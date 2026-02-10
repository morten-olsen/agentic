# Adding Tools

This guide explains how to add new tools to GLaDOS. Tools are capabilities that the agent can use to perform actions on behalf of the user.

## Tool Overview

Tools in GLaDOS are:

- **Registered** with the ToolRegistry
- **Validated** with Zod schemas for input/output
- **Risk-assessed** with profiles that determine approval requirements
- **Adapted** to LangChain format for the LLM

## Tool Structure

Every tool definition includes:

```typescript
type ToolDefinition<TInput, TOutput> = {
  id: string;           // Unique identifier (e.g., 'contacts.create')
  name: string;         // Display name (e.g., 'CreateContact')
  description: string;  // What the tool does (shown to LLM)
  category: string;     // Grouping (e.g., 'contacts', 'calendar')
  inputSchema: ZodSchema<TInput>;   // Input validation
  outputSchema: ZodSchema<TOutput>; // Output validation
  risk: RiskProfile;    // Risk assessment
  tags: string[];       // Searchable tags
  examples: Example[];  // Usage examples (optional)
  execute: (input: TInput, context: ToolContext) => Promise<TOutput>;
};
```

## Step-by-Step Guide

### 1. Choose the Right Location

Tools are organized by category in `src/tools/builtin/`:

```
src/tools/builtin/
├── builtin.ts          # Registration function
├── echo.ts             # Simple example tool
├── ask-user.ts         # User interaction tool
├── user-model.ts       # User model tools
├── contacts.ts         # Contact management tools
├── calendar.ts         # Calendar tools
├── location.ts         # Location tools
├── memory.ts           # Memory tools
└── tasks.ts            # Task management tools
```

Add your tool to an existing category file, or create a new file for a new category.

### 2. Define Input/Output Schemas

Use Zod to define what the tool accepts and returns:

```typescript
import { z } from 'zod';

// Input schema - what the LLM will provide
const myToolInputSchema = z.object({
  name: z.string().min(1).describe('The name to process'),
  count: z.number().int().positive().optional().describe('Number of items'),
});

// Output schema - what the tool returns
const myToolOutputSchema = z.object({
  success: z.boolean(),
  result: z.string(),
  processedAt: z.string(),
});

type MyToolInput = z.infer<typeof myToolInputSchema>;
type MyToolOutput = z.infer<typeof myToolOutputSchema>;
```

**Important**: Use `.describe()` on schema fields - these descriptions are shown to the LLM.

### 3. Define the Risk Profile

Every tool needs a risk assessment. Risk can be either **static** (fixed) or **dynamic** (evaluated at runtime based on input).

#### Static Risk (Default)

For most tools, use a static risk profile:

```typescript
risk: {
  level: 'low',          // 'low' | 'medium' | 'high' | 'critical'
  reason: 'Read-only operation',
  potentialImpact: 'None - does not modify any data',
  reversible: true,
  categories: [],        // Risk categories (see below)
}
```

#### Dynamic Risk

For tools where risk depends on input (e.g., different URLs, different operations), use a dynamic risk profile with an async evaluator function:

```typescript
import type { RiskProfile, DynamicRiskProfile } from '../tools.schemas.ts';
import type { Services } from '../../core/services/services.ts';

// Default risk if evaluation fails or conditions aren't met
const defaultRisk: RiskProfile = {
  level: 'medium',
  reason: 'Makes external HTTP requests',
  potentialImpact: 'May access sensitive URLs',
  reversible: true,
  categories: ['external_api'],
};

// Dynamic evaluator receives input and services
const myToolRiskEvaluator = async (
  input: MyToolInput,
  services: Services,
): Promise<RiskProfile> => {
  // Example: check if URL is in a trusted whitelist
  const whitelistService = services.get(DomainWhitelistService);
  const isWhitelisted = await whitelistService.isWhitelisted(input.url);

  if (isWhitelisted) {
    return {
      level: 'low',
      reason: 'URL is in trusted whitelist',
      potentialImpact: 'None - trusted source',
      reversible: true,
      categories: [],
    };
  }

  return defaultRisk;
};

// Use dynamic risk profile in tool definition
const myTool: ToolDefinition<MyToolInput, MyToolOutput> = {
  // ... other fields ...
  risk: {
    evaluator: myToolRiskEvaluator,
    defaultProfile: defaultRisk,  // Fallback if evaluation fails
  } as DynamicRiskProfile<MyToolInput>,
};
```

**When to use dynamic risk:**

- External API calls where some domains are trusted
- File operations where some paths are safe
- Operations with different modes (read vs write)
- Any case where the risk depends on the specific input values

**Dynamic risk profile structure:**

```typescript
type DynamicRiskProfile<TInput> = {
  evaluator: (input: TInput, services: Services) => Promise<RiskProfile>;
  defaultProfile: RiskProfile;  // Used if evaluator throws or services unavailable
};
```

**Risk Levels:**

| Level | Approval | Examples |
|-------|----------|----------|
| `low` | Automatic | Reading data, calculations, queries |
| `medium` | User approval | Creating/updating records, sending messages |
| `high` | Explicit approval | Deleting data, financial transactions |
| `critical` | Double confirmation | Irreversible actions, security-sensitive |

**Risk Categories:**

```typescript
type RiskCategory =
  | 'data_modification'  // Changes stored data
  | 'external_api'       // Calls external services
  | 'financial'          // Involves money/payments
  | 'communication'      // Sends messages/emails
  | 'system'             // System-level operations
  | 'destructive';       // Permanently deletes data
```

### 4. Implement the Execute Function

The execute function receives validated input and a context object:

```typescript
import type { ToolContext } from '../tools.ts';
import { MyService } from '../../my-module/my-module.ts';

const myTool: ToolDefinition<MyToolInput, MyToolOutput> = {
  // ... other fields ...

  execute: async (input: MyToolInput, context: ToolContext): Promise<MyToolOutput> => {
    // Access services through context
    const myService = context.services.get(MyService);

    // Perform the action
    const result = await myService.doSomething(input.name);

    // Return validated output
    return {
      success: true,
      result: result.value,
      processedAt: new Date().toISOString(),
    };
  },
};
```

**The `ToolContext` provides:**

```typescript
type ToolContext = {
  services: Services;           // Service container
  conversationId?: string;      // Current conversation
  toolCallId?: string;          // LangChain tool call ID
};
```

### 5. Add Examples

Examples help the LLM understand how to use the tool:

```typescript
examples: [
  {
    input: { name: 'Alice', count: 3 },
    description: 'Process with specific count',
  },
  {
    input: { name: 'Bob' },
    description: 'Process with default count',
  },
],
```

### 6. Register the Tool

Add your tool to the registration function in your category file:

```typescript
// src/tools/builtin/my-category.ts

const registerMyCategoryTools = (registry: ToolRegistry): void => {
  registry.register(myFirstTool);
  registry.register(mySecondTool);
};

export { myFirstTool, mySecondTool, registerMyCategoryTools };
```

Then call the registration in `src/tools/builtin/builtin.ts`:

```typescript
import { registerMyCategoryTools } from './my-category.ts';

const registerBuiltinTools = (registry: ToolRegistry): void => {
  // ... existing registrations ...
  registerMyCategoryTools(registry);
};
```

## Complete Example

Here's a complete tool implementation:

```typescript
// src/tools/builtin/notes.ts

import { z } from 'zod';

import type { ToolDefinition, ToolContext, ToolRegistry } from '../tools.ts';
import { NotesService } from '../../notes/notes.ts';

// ============================================================================
// Create Note
// ============================================================================

const createNoteInputSchema = z.object({
  title: z.string().min(1).describe('Title of the note'),
  content: z.string().min(1).describe('Content of the note'),
  tags: z.array(z.string()).optional().describe('Tags for categorization'),
});

const createNoteOutputSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  tags: z.array(z.string()),
  createdAt: z.string(),
});

type CreateNoteInput = z.infer<typeof createNoteInputSchema>;
type CreateNoteOutput = z.infer<typeof createNoteOutputSchema>;

const createNoteTool: ToolDefinition<CreateNoteInput, CreateNoteOutput> = {
  id: 'notes.create',
  name: 'CreateNote',
  description: 'Create a new note with a title and content.',
  category: 'notes',
  inputSchema: createNoteInputSchema,
  outputSchema: createNoteOutputSchema,
  risk: {
    level: 'low',
    reason: 'Creates a new note',
    potentialImpact: 'Adds to notes storage',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['notes', 'write', 'create'],
  examples: [
    {
      input: { title: 'Meeting Notes', content: 'Discussed Q4 planning...' },
      description: 'Create a simple note',
    },
    {
      input: {
        title: 'Shopping List',
        content: '- Milk\n- Eggs\n- Bread',
        tags: ['personal', 'shopping'],
      },
      description: 'Create a note with tags',
    },
  ],
  execute: async (input: CreateNoteInput, context: ToolContext): Promise<CreateNoteOutput> => {
    const notesService = context.services.get(NotesService);
    const note = await notesService.create({
      title: input.title,
      content: input.content,
      tags: input.tags,
    });
    return note;
  },
};

// ============================================================================
// List Notes
// ============================================================================

const listNotesInputSchema = z.object({
  tag: z.string().optional().describe('Filter by tag'),
  limit: z.number().int().positive().optional().describe('Max notes to return'),
});

const listNotesOutputSchema = z.object({
  notes: z.array(createNoteOutputSchema),
  count: z.number(),
});

type ListNotesInput = z.infer<typeof listNotesInputSchema>;
type ListNotesOutput = z.infer<typeof listNotesOutputSchema>;

const listNotesTool: ToolDefinition<ListNotesInput, ListNotesOutput> = {
  id: 'notes.list',
  name: 'ListNotes',
  description: 'List all notes, optionally filtered by tag.',
  category: 'notes',
  inputSchema: listNotesInputSchema,
  outputSchema: listNotesOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['notes', 'read', 'list'],
  examples: [
    { input: {}, description: 'List all notes' },
    { input: { tag: 'work', limit: 5 }, description: 'List work notes' },
  ],
  execute: async (input: ListNotesInput, context: ToolContext): Promise<ListNotesOutput> => {
    const notesService = context.services.get(NotesService);
    const notes = await notesService.list({
      tag: input.tag,
      limit: input.limit,
    });
    return { notes, count: notes.length };
  },
};

// ============================================================================
// Delete Note (Medium Risk)
// ============================================================================

const deleteNoteInputSchema = z.object({
  id: z.string().describe('ID of the note to delete'),
});

const deleteNoteOutputSchema = z.object({
  success: z.boolean(),
  deletedId: z.string(),
});

type DeleteNoteInput = z.infer<typeof deleteNoteInputSchema>;
type DeleteNoteOutput = z.infer<typeof deleteNoteOutputSchema>;

const deleteNoteTool: ToolDefinition<DeleteNoteInput, DeleteNoteOutput> = {
  id: 'notes.delete',
  name: 'DeleteNote',
  description: 'Delete a note by ID. This action requires approval.',
  category: 'notes',
  inputSchema: deleteNoteInputSchema,
  outputSchema: deleteNoteOutputSchema,
  risk: {
    level: 'medium',  // Requires user approval
    reason: 'Permanently deletes a note',
    potentialImpact: 'Note will be permanently removed',
    reversible: false,
    categories: ['data_modification', 'destructive'],
  },
  tags: ['notes', 'write', 'delete'],
  examples: [
    { input: { id: 'note-123' }, description: 'Delete a note' },
  ],
  execute: async (input: DeleteNoteInput, context: ToolContext): Promise<DeleteNoteOutput> => {
    const notesService = context.services.get(NotesService);
    const success = await notesService.delete(input.id);
    return { success, deletedId: input.id };
  },
};

// ============================================================================
// Registration
// ============================================================================

const registerNotesTools = (registry: ToolRegistry): void => {
  registry.register(createNoteTool);
  registry.register(listNotesTool);
  registry.register(deleteNoteTool);
};

export {
  createNoteTool,
  listNotesTool,
  deleteNoteTool,
  registerNotesTools,
};
```

## Testing Tools

Test tools using the standard unit test pattern:

```typescript
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { Services } from '../../services/services.ts';
import { DatabaseService, createDatabaseService } from '../../database/database.ts';
import { ToolRegistry } from '../tools.ts';
import { registerNotesTools, createNoteTool } from './notes.ts';

describe('Notes Tools', () => {
  let services: Services;
  let registry: ToolRegistry;

  beforeEach(async () => {
    services = new Services();
    const db = createDatabaseService(services, { path: ':memory:' });
    services.set(DatabaseService, db);
    await db.migrate();

    registry = new ToolRegistry(services);
    registerNotesTools(registry);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('createNoteTool', () => {
    it('creates a note', async () => {
      const result = await registry.execute('notes.create', {
        title: 'Test Note',
        content: 'Test content',
      });

      expect(result.title).toBe('Test Note');
      expect(result.id).toBeDefined();
    });
  });
});
```

## Best Practices

### 1. Keep Tools Focused

Each tool should do one thing well. Prefer multiple simple tools over one complex tool.

```typescript
// Good: Separate tools
'contacts.create'
'contacts.update'
'contacts.delete'

// Bad: One tool that does everything
'contacts.manage' // with mode: 'create' | 'update' | 'delete'
```

### 2. Provide Clear Descriptions

The LLM uses descriptions to decide when to use tools:

```typescript
// Good: Clear and specific
description: 'Create a new calendar event with a title, start time, and optional attendees.'

// Bad: Vague
description: 'Create an event.'
```

### 3. Use Appropriate Risk Levels

Don't over- or under-estimate risk:

- `low`: Safe operations (reads, calculations)
- `medium`: Data changes that are recoverable
- `high`: Significant changes or external effects
- `critical`: Irreversible or security-sensitive

### 4. Handle Errors Gracefully

Throw meaningful errors that help the LLM understand what went wrong:

```typescript
execute: async (input, context) => {
  const service = context.services.get(MyService);
  const item = await service.get(input.id);

  if (!item) {
    throw new Error(`Item not found: ${input.id}`);
  }

  return item;
};
```

### 5. Validate Schema Outputs

Your output schema should match what you actually return:

```typescript
// Schema says:
outputSchema: z.object({
  items: z.array(itemSchema),
  count: z.number(),
});

// Return must match:
return {
  items: results,
  count: results.length,  // Include all declared fields
};
```

## Tool Categories

Current built-in categories:

| Category | Purpose | Examples |
|----------|---------|----------|
| `core` | Basic utilities | echo, ask_user |
| `user_model` | User data management | projects, goals, routines |
| `contacts` | Contact management | create, update, delete contacts |
| `calendar` | Calendar operations | events, scheduling |
| `location` | Location services | places, location tracking |
| `memory` | Memory operations | remember, recall, forget |
| `tasks` | Task management | create tasks, advance steps |

## Related Documentation

- [Development Guide](./development.md) - Overall architecture
- [Coding Standards](./coding-standards.md) - TypeScript conventions
- [Testing Strategy](./testing-strategy.md) - Test patterns
