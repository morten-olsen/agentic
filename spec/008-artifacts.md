# Artifact System Specification

> Server-side storage for large data with context-efficient summaries

**Version**: 1.0
**Status**: Draft
**Dependencies**: Core Orchestrator, Tools (Phase 2)

## Overview

The Artifact System provides a mechanism for tools to store large data responses server-side while returning only concise summaries to the agent. This keeps the agent's context small while enabling full data access when needed through exploration tools or client fetch commands.

### Goals

1. **Context Efficiency**: Tools return ~2KB summaries instead of ~320KB full responses
2. **Full Data Access**: Artifacts can be fetched by clients or queried by exploration tools
3. **Multi-Format Support**: JSON, PDF, images, CSV, and other MIME types
4. **Automatic Cleanup**: TTL-based expiration prevents storage bloat
5. **Agent Exploration**: Tools can query specific sections of artifacts without loading full data

### Non-Goals (for v1)

- Cross-conversation artifact sharing (artifacts scoped to conversation)
- Persistent artifact storage beyond TTL
- Artifact streaming for very large files
- Artifact encryption at rest
- Remote artifact storage (S3, etc.)

### Use Cases

1. **API Integration Results**: Weather routing returns 320KB route optimization; store full data, return summary
2. **Data Analysis**: Large dataset analysis returns full statistics; store results, return key insights
3. **Document Generation**: Generate multi-page reports; store PDF, return overview
4. **Search Results**: Search returns many results; store full list, return top matches with artifact ID

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Tool Execution                               │
├─────────────────────────────────────────────────────────────────────┤
│  1. Tool calls external API or performs analysis                     │
│  2. Gets large response (e.g., 320KB)                                │
│  3. Stores full response as artifact → gets artifact ID              │
│  4. Returns summary (~2KB) + artifact ID to agent                    │
└─────────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────────────┐   ┌─────────────────────────────────┐
│   Agent Exploration Tools        │   │   Client Commands                │
├─────────────────────────────────┤   ├─────────────────────────────────┤
│ get_artifact_section({           │   │ CLI:                             │
│   artifact: "art_123",           │   │   /artifact art_123              │
│   path: "routes[0].waypoints"    │   │   /artifact art_123 --path x     │
│ })                               │   │                                  │
│                                  │   │ Telegram:                        │
│ query_artifact({                 │   │   /artifact art_123              │
│   artifact: "art_123",           │   │   (shows summary + inline btns)  │
│   query: "filter routes by cost" │   │                                  │
│ })                               │   │                                  │
└─────────────────────────────────┘   └─────────────────────────────────┘
```

### Key Design Decisions

1. **Database Storage**: Artifacts stored in SQLite using the existing Knex infrastructure. Simple and consistent with other data storage in the system.

2. **Conversation-Scoped**: Artifacts belong to a conversation. When the conversation expires or is deleted, its artifacts are cleaned up.

3. **Domain Types**: Artifacts have a semantic type (e.g., `route_optimization`, `data_analysis`) that helps exploration tools understand the data structure.

4. **Summary + ID Pattern**: All artifact-producing tools return a standard format: `{ artifact: "art_123", summary: {...} }`.

---

## Data Model

### Artifact Schema

```typescript
type ArtifactMimeType =
  | 'application/json'
  | 'application/pdf'
  | 'image/png'
  | 'image/jpeg'
  | 'text/csv'
  | 'text/plain';

type Artifact = {
  id: string;                        // Prefixed with 'art_'
  conversationId: string;            // Owning conversation
  messageId: string;                 // Message that created this artifact
  type: string;                      // Domain type (e.g., 'route_optimization')
  mimeType: ArtifactMimeType;

  // Data storage
  data: unknown;                     // For JSON types
  binaryData?: string;               // Base64 for binary types

  // Metadata
  sizeBytes: number;                 // Original data size
  summaryProvided: boolean;          // Whether tool provided a summary

  // Lifecycle
  ttlMinutes: number;                // Time to live
  createdAt: string;                 // ISO8601
  expiresAt: string;                 // ISO8601
  accessedAt: string;                // ISO8601, updated on access
};
```

### Create Artifact Input

```typescript
type CreateArtifactInput = {
  conversationId: string;            // Owning conversation
  messageId: string;                 // Message creating this artifact
  type: string;                      // Domain type
  data: unknown;                     // JSON data or base64 string for binary
  mimeType?: ArtifactMimeType;       // Default: 'application/json'
  ttlMinutes?: number;               // Default: 60
};

type CreateArtifactResult = {
  id: string;
  expiresAt: string;
};
```

### Artifact Reference (returned by tools)

```typescript
// Standard format for tool responses that use artifacts
type ArtifactToolResponse<TSummary> = {
  artifact: string;                  // Artifact ID
  summary: TSummary;                 // Domain-specific summary
};
```

---

## Database Schema

### Migration: `0xx_artifacts.ts`

```sql
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  type TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/json',

  -- Data (JSON stored as text, binary as base64)
  data TEXT,

  -- Metadata
  size_bytes INTEGER NOT NULL,
  summary_provided INTEGER NOT NULL DEFAULT 0,

  -- Lifecycle
  ttl_minutes INTEGER NOT NULL DEFAULT 60,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accessed_at TEXT NOT NULL
);

CREATE INDEX idx_artifacts_conversation ON artifacts(conversation_id);
CREATE INDEX idx_artifacts_message ON artifacts(message_id);
CREATE INDEX idx_artifacts_expires ON artifacts(expires_at);
CREATE INDEX idx_artifacts_type ON artifacts(type);
```

---

## ArtifactStore

### Interface

```typescript
class ArtifactStore {
  constructor(deps: { db: Knex; logger: Logger });

  // Core operations
  store(
    conversationId: string,
    messageId: string,
    type: string,
    data: unknown,
    options?: {
      mimeType?: ArtifactMimeType;
      ttlMinutes?: number;
    }
  ): Promise<string>;  // Returns artifact ID

  get(id: string): Promise<Artifact | null>;
  getMeta(id: string): Promise<Omit<Artifact, 'data' | 'binaryData'> | null>;
  delete(id: string): Promise<void>;

  // Queries
  getByConversation(conversationId: string): Promise<Artifact[]>;
  getByMessage(messageId: string): Promise<Artifact[]>;
  getByType(type: string, conversationId?: string): Promise<Artifact[]>;

  // Lifecycle
  deleteExpired(): Promise<number>;  // Returns count deleted
  deleteByConversation(conversationId: string): Promise<number>;

  // Access tracking
  touch(id: string): Promise<void>;  // Update accessedAt
}
```

### Storage Strategy

Artifacts are stored directly in SQLite:

```typescript
store(conversationId: string, messageId: string, type: string, data: unknown, options = {}): Promise<string> {
  const id = `art_${generateId()}`;
  const mimeType = options.mimeType ?? 'application/json';
  const ttlMinutes = options.ttlMinutes ?? 60;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

  // Serialize data
  const serialized = mimeType === 'application/json'
    ? JSON.stringify(data)
    : data as string;  // Binary types already base64

  const sizeBytes = Buffer.byteLength(serialized, 'utf8');

  await this.db('artifacts').insert({
    id,
    conversation_id: conversationId,
    message_id: messageId,
    type,
    mime_type: mimeType,
    data: serialized,
    size_bytes: sizeBytes,
    ttl_minutes: ttlMinutes,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    accessed_at: now.toISOString(),
  });

  return id;
}
```

### Expiration Cleanup

A periodic task cleans up expired artifacts:

```typescript
// Called periodically (e.g., every 5 minutes)
async deleteExpired(): Promise<number> {
  const now = new Date().toISOString();
  const count = await this.db('artifacts')
    .where('expires_at', '<', now)
    .delete();
  return count;
}
```

---

## Agent Tools

### get_artifact

Retrieves artifact metadata or a specific section of artifact data.

```typescript
const getArtifactTool: ToolDefinition = {
  id: 'get_artifact',
  name: 'Get Artifact',
  description: `Retrieve metadata or a specific section from an artifact.

    Artifacts store large data responses. Use this tool to:
    - Get artifact metadata (type, size, expiration)
    - Extract specific sections using JSON path (for JSON artifacts)

    For JSON artifacts, use the 'path' parameter to extract specific data:
    - "routes[0]" - first route
    - "routes[0].waypoints" - waypoints of first route
    - "metadata.summary" - nested property`,

  category: 'utility',

  inputSchema: z.object({
    artifactId: z.string().describe('The artifact ID (starts with art_)'),
    path: z.string().optional().describe('JSON path to extract (e.g., "routes[0].waypoints")'),
    metaOnly: z.boolean().default(false).describe('Return only metadata, not data'),
  }),

  outputSchema: z.object({
    artifact: z.object({
      id: z.string(),
      messageId: z.string(),
      type: z.string(),
      mimeType: z.string(),
      sizeBytes: z.number(),
      expiresAt: z.string(),
    }),
    data: z.unknown().optional(),
    path: z.string().optional(),
  }),

  risk: {
    level: 'low',
    reason: 'Read-only artifact access',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },

  tags: ['artifact', 'utility'],
  examples: [],

  execute: async (input, context) => {
    const artifact = input.metaOnly
      ? await artifactStore.getMeta(input.artifactId)
      : await artifactStore.get(input.artifactId);

    if (!artifact) {
      return { error: 'Artifact not found or expired' };
    }

    // Update access time
    await artifactStore.touch(input.artifactId);

    const result: Record<string, unknown> = {
      artifact: {
        id: artifact.id,
        messageId: artifact.messageId,
        type: artifact.type,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes,
        expiresAt: artifact.expiresAt,
      },
    };

    if (!input.metaOnly && artifact.data) {
      if (input.path) {
        // Extract specific path from JSON data
        result.data = extractPath(artifact.data, input.path);
        result.path = input.path;
      } else {
        result.data = artifact.data;
      }
    }

    return result;
  },
};
```

### list_artifacts

Lists artifacts for the current conversation.

```typescript
const listArtifactsTool: ToolDefinition = {
  id: 'list_artifacts',
  name: 'List Artifacts',
  description: `List artifacts stored in the current conversation.

    Use this to see what artifacts are available for exploration or reference.`,

  category: 'utility',

  inputSchema: z.object({
    type: z.string().optional().describe('Filter by artifact type'),
    messageId: z.string().optional().describe('Filter by message ID'),
  }),

  outputSchema: z.object({
    artifacts: z.array(z.object({
      id: z.string(),
      messageId: z.string(),
      type: z.string(),
      mimeType: z.string(),
      sizeBytes: z.number(),
      createdAt: z.string(),
      expiresAt: z.string(),
    })),
  }),

  risk: {
    level: 'low',
    reason: 'Read-only list operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },

  tags: ['artifact', 'utility'],
  examples: [],

  execute: async (input, context) => {
    const conversationId = context.configurable.conversationId;

    let artifacts = input.messageId
      ? await artifactStore.getByMessage(input.messageId)
      : await artifactStore.getByConversation(conversationId);

    if (input.type) {
      artifacts = artifacts.filter(a => a.type === input.type);
    }

    return {
      artifacts: artifacts.map(a => ({
        id: a.id,
        messageId: a.messageId,
        type: a.type,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        createdAt: a.createdAt,
        expiresAt: a.expiresAt,
      })),
    };
  },
};
```

---

## Tool Integration Pattern

### Storing Artifacts in Tools

Tools that produce large data should follow this pattern. The `messageId` is available in the tool context and identifies the assistant message containing this tool call:

```typescript
const runAnalysisTool = tool(
  async (input, context) => {
    // Perform analysis - potentially large result
    const result = await analyzeData(input);

    // Store full result as artifact (messageId from context)
    const artifactId = await artifactStore.store(
      context.configurable.conversationId,
      context.configurable.messageId,  // Links artifact to this message
      'data_analysis',  // Domain type
      result,
      { ttlMinutes: 60 }
    );

    // Return summary + artifact reference
    return JSON.stringify({
      artifact: artifactId,
      summary: {
        recordCount: result.records.length,
        keyMetrics: {
          mean: result.statistics.mean,
          median: result.statistics.median,
          outliers: result.outliers.length,
        },
        topInsights: result.insights.slice(0, 3),
      },
    });
  },
  {
    name: 'run_analysis',
    schema: z.object({ /* ... */ }),
  }
);
```

### Domain-Specific Exploration Tools

For complex artifacts, create domain-specific exploration tools:

```typescript
const getAnalysisRecordsTool = tool(
  async ({ artifact, filter, limit }) => {
    const data = await artifactStore.get(artifact);
    if (!data || data.type !== 'data_analysis') {
      return 'Artifact not found or wrong type';
    }

    let records = data.data.records;

    if (filter) {
      records = records.filter(r => matchesFilter(r, filter));
    }

    return JSON.stringify({
      count: records.length,
      records: records.slice(0, limit ?? 20),
      hasMore: records.length > (limit ?? 20),
    });
  },
  {
    name: 'get_analysis_records',
    schema: z.object({
      artifact: z.string(),
      filter: z.record(z.unknown()).optional(),
      limit: z.number().default(20),
    }),
  }
);
```

---

## Client Integration

Clients access artifacts through the ArtifactStore service (injected via service container), not via HTTP API.

### CLI Commands

```bash
# List artifacts in current conversation
/artifacts

# View artifact summary
/artifact art_123

# View full artifact (paginated for large data)
/artifact art_123 --full

# Extract specific path
/artifact art_123 --path "routes[0].waypoints"

# Export artifact to file
/artifact art_123 --export route.json
```

### CLI Implementation

```typescript
// In src/cli/commands/artifact.ts
export const artifactCommand = async (
  args: string[],
  services: ServiceContainer,
  conversationId: string
): Promise<string> => {
  const { artifactStore } = services;
  const [artifactId, ...flags] = args;

  if (!artifactId) {
    // List all artifacts
    const artifacts = await artifactStore.getByConversation(conversationId);
    return formatArtifactList(artifacts);
  }

  const artifact = await artifactStore.get(artifactId);
  if (!artifact) {
    return 'Artifact not found or expired';
  }

  if (flags.includes('--full')) {
    return formatFullArtifact(artifact);
  }

  const pathFlag = flags.findIndex(f => f === '--path');
  if (pathFlag >= 0 && flags[pathFlag + 1]) {
    const data = extractPath(artifact.data, flags[pathFlag + 1]);
    return formatJson(data);
  }

  const exportFlag = flags.findIndex(f => f === '--export');
  if (exportFlag >= 0 && flags[exportFlag + 1]) {
    await exportArtifact(artifact, flags[exportFlag + 1]);
    return `Exported to ${flags[exportFlag + 1]}`;
  }

  return formatArtifactSummary(artifact);
};
```

### Telegram Integration

```typescript
// In src/clients/telegram/telegram.handlers.ts
export const handleArtifactCommand = async (
  bot: TelegramBot,
  chatId: number,
  artifactId: string,
  services: ServiceContainer
): Promise<void> => {
  const { artifactStore } = services;

  const artifact = await artifactStore.get(artifactId);
  if (!artifact) {
    await bot.sendMessage(chatId, 'Artifact not found or expired');
    return;
  }

  const summary = formatArtifactForTelegram(artifact);

  // For JSON artifacts, offer inline keyboard to explore
  if (artifact.mimeType === 'application/json') {
    await bot.sendMessage(chatId, summary, {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'View Full', callback_data: `art_full_${artifactId}` }],
          [{ text: 'Export', callback_data: `art_export_${artifactId}` }],
        ],
      },
    });
  } else if (artifact.mimeType === 'application/pdf') {
    // Send as document
    const buffer = Buffer.from(artifact.binaryData!, 'base64');
    await bot.sendDocument(chatId, buffer, {
      filename: `${artifact.type}.pdf`,
    });
  }
};
```

---

## Orchestrator Integration

### Artifact Context

The orchestrator tracks active artifacts for context:

```typescript
// Added to conversation metadata
type ConversationMetadata = {
  // ... existing fields

  artifacts?: {
    count: number;
    types: string[];
    totalSizeBytes: number;
  };
};
```

### Cleanup on Conversation End

When a conversation ends or is deleted, its artifacts are cleaned up:

```typescript
// In OrchestratorService or ConversationService
const endConversation = async (conversationId: string) => {
  // ... existing cleanup

  // Clean up artifacts
  const deletedCount = await artifactStore.deleteByConversation(conversationId);
  this.logger.debug(`Deleted ${deletedCount} artifacts for conversation ${conversationId}`);
};
```

---

## Configuration

```typescript
type ArtifactConfig = {
  // Storage limits
  maxArtifactSizeBytes: number;      // Default: 10MB
  maxArtifactsPerConversation: number; // Default: 50

  // TTL
  defaultTtlMinutes: number;         // Default: 60
  maxTtlMinutes: number;             // Default: 1440 (24 hours)

  // Cleanup
  cleanupIntervalMinutes: number;    // Default: 5
};
```

---

## Example: Route Optimization Skill

A complete example of using artifacts with the route optimization domain:

### Tool: Run Route Optimization

```typescript
const runRouteOptimization = tool(
  async ({ origin, destination, constraints }, context) => {
    // Call external weather routing API
    const result = await weatherRoutingClient.optimize({
      origin,
      destination,
      constraints,
    });

    // Store full result (~320KB), linked to this message
    const artifactId = await artifactStore.store(
      context.configurable.conversationId,
      context.configurable.messageId,
      'route_optimization',
      result,
      { ttlMinutes: 120 }  // 2 hours for route data
    );

    // Return summary (~2KB)
    const bestRoute = result.routes[0];
    return JSON.stringify({
      artifact: artifactId,
      summary: {
        origin: origin.name,
        destination: destination.name,
        bestRoute: {
          name: bestRoute.name,
          distanceNm: bestRoute.totalDistance,
          durationDays: (bestRoute.totalDuration / 24).toFixed(1),
          estimatedCostUsd: bestRoute.totalCost,
          weatherRating: bestRoute.weatherScore,
        },
        alternativeCount: result.routes.length - 1,
        optimizedAt: new Date().toISOString(),
      },
    });
  },
  {
    name: 'run_route_optimization',
    description: 'Optimize shipping route between two ports',
    schema: z.object({
      origin: portSchema,
      destination: portSchema,
      constraints: routeConstraintsSchema.optional(),
    }),
  }
);
```

### Tool: Get Route Waypoints

```typescript
const getRouteWaypoints = tool(
  async ({ artifact, routeIndex, limit }) => {
    const data = await artifactStore.get(artifact);
    if (!data || data.type !== 'route_optimization') {
      return 'Route optimization artifact not found';
    }

    const route = data.data.routes[routeIndex ?? 0];
    if (!route) {
      return `Route index ${routeIndex} not found`;
    }

    const waypoints = route.intervals.flatMap(i => i.waypoints);

    return JSON.stringify({
      routeName: route.name,
      waypointCount: waypoints.length,
      waypoints: waypoints.slice(0, limit ?? 30).map(w => ({
        lat: w.lat,
        lon: w.lon,
        eta: w.eta,
        weather: w.conditions?.summary,
      })),
      hasMore: waypoints.length > (limit ?? 30),
    });
  },
  {
    name: 'get_route_waypoints',
    description: 'Get waypoints for a specific route from optimization results',
    schema: z.object({
      artifact: z.string(),
      routeIndex: z.number().default(0),
      limit: z.number().default(30),
    }),
  }
);
```

### Tool: Compare Routes

```typescript
const compareRoutes = tool(
  async ({ artifact, routeIndices }) => {
    const data = await artifactStore.get(artifact);
    if (!data || data.type !== 'route_optimization') {
      return 'Route optimization artifact not found';
    }

    const routes = (routeIndices ?? [0, 1]).map(i => data.data.routes[i]).filter(Boolean);

    return JSON.stringify({
      comparison: routes.map(r => ({
        name: r.name,
        distance: r.totalDistance,
        duration: r.totalDuration,
        cost: r.totalCost,
        weatherScore: r.weatherScore,
        riskLevel: r.riskAssessment?.level,
      })),
      recommendation: routes[0]?.name,
      reasonForRecommendation: data.data.analysis?.recommendation,
    });
  },
  {
    name: 'compare_routes',
    description: 'Compare multiple routes from optimization results',
    schema: z.object({
      artifact: z.string(),
      routeIndices: z.array(z.number()).optional(),
    }),
  }
);
```

---

## Testing Strategy

### Unit Tests

- Artifact creation with various MIME types
- TTL calculation and expiration
- Path extraction from JSON artifacts
- Size calculation
- Conversation scoping

### Integration Tests

- Tool stores artifact and returns summary
- Exploration tool queries artifact sections
- Artifact cleanup on conversation end
- Expired artifact cleanup
- CLI artifact commands
- Telegram artifact handling

### Flow Tests

- End-to-end: tool creates artifact, agent uses exploration tool, client fetches full data
- Artifact expiration during conversation
- Multiple artifacts from same tool
- Cross-type artifact queries (should fail gracefully)

---

## Implementation Phases

### Phase 1: Core Infrastructure

- [ ] Artifact schemas and types
- [ ] Database migration
- [ ] ArtifactStore class (CRUD operations)
- [ ] Expiration cleanup task

### Phase 2: Agent Tools

- [ ] get_artifact tool
- [ ] list_artifacts tool
- [ ] Path extraction utility for JSON artifacts

### Phase 3: Tool Integration

- [ ] Helper utilities for storing artifacts in tools
- [ ] Standard response format helpers
- [ ] Documentation for tool authors

### Phase 4: Client Integration

- [ ] CLI artifact commands
- [ ] Telegram artifact handling
- [ ] Export functionality

### Phase 5: Testing & Documentation

- [ ] Comprehensive test suite
- [ ] Update CLAUDE.md
- [ ] Usage documentation in docs/

---

## Future Considerations

1. **Artifact Sharing**: Allow artifacts to be referenced across conversations (with explicit sharing)

2. **Persistent Artifacts**: Some artifacts (like generated reports) could persist beyond TTL

3. **Artifact Versioning**: Track versions when artifacts are updated

4. **Remote Storage**: For very large artifacts, store in S3/GCS with signed URL access

5. **Streaming**: For artifacts too large to load into memory, support streaming access

6. **Artifact Templates**: Pre-defined schemas for common artifact types with automatic exploration tools

7. **Artifact Reactions**: Allow users to "save" or "star" artifacts to prevent expiration
