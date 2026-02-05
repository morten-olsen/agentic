# Artifacts System

The Artifacts System provides server-side storage for large data with context-efficient summaries. Tools can store large responses as artifacts and return only concise summaries to the agent, keeping context small while enabling full data access when needed.

## Overview

### The Problem

When tools return large responses (API results, data analysis, route optimization), they consume significant context window space. A weather routing API might return 320KB of route data, but the agent only needs a 2KB summary for most decisions.

### The Solution

Artifacts solve this by:

1. **Storing large data server-side**: Full response stored in the database with a unique ID
2. **Returning summaries**: Tool returns summary + artifact ID to the agent
3. **On-demand access**: Agent can query specific sections; clients can fetch full data

### When to Use Artifacts

- API responses > 5KB
- Data analysis results with many records
- Generated documents (PDFs, reports)
- Search results with many matches
- Any tool output where a summary suffices for most interactions

## How It Works

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
│   Agent Exploration              │   │   Client Access                  │
│   get_artifact with path query   │   │   /artifact art_123              │
│   list_artifacts                 │   │   /artifact art_123 --full       │
└─────────────────────────────────┘   └─────────────────────────────────┘
```

## Agent Tools

### get_artifact

Retrieves artifact metadata or a specific section of artifact data.

**Input:**
```typescript
{
  artifactId: string;           // The artifact ID (starts with art_)
  path?: string;                // JSON path to extract (e.g., "routes[0].waypoints")
  metaOnly?: boolean;           // Return only metadata, not data (default: false)
}
```

**Output:**
```typescript
{
  artifact: {
    id: string;
    messageId: string;
    type: string;
    mimeType: string;
    sizeBytes: number;
    expiresAt: string;
  };
  data?: unknown;               // Extracted data (if not metaOnly)
  path?: string;                // Path that was extracted (if provided)
}
```

**Examples:**

Get full artifact:
```
get_artifact({ artifactId: "art_abc123" })
```

Extract specific section:
```
get_artifact({ artifactId: "art_abc123", path: "routes[0].waypoints" })
```

Get metadata only:
```
get_artifact({ artifactId: "art_abc123", metaOnly: true })
```

### list_artifacts

Lists artifacts stored in the current conversation.

**Input:**
```typescript
{
  type?: string;                // Filter by artifact type
  messageId?: string;           // Filter by message ID
}
```

**Output:**
```typescript
{
  artifacts: Array<{
    id: string;
    messageId: string;
    type: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: string;
    expiresAt: string;
  }>;
}
```

## Client Commands

### CLI

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

### Telegram

```
/artifact art_123
```

Returns a summary with inline buttons to view full data or export.

## For Tool Authors

### Storing Artifacts

Tools that produce large data should store it as an artifact and return a summary:

```typescript
const runAnalysisTool: ToolDefinition = {
  id: 'run_analysis',
  // ... other fields

  execute: async (input, context) => {
    // Perform analysis - potentially large result
    const result = await analyzeData(input);

    // Store full result as artifact
    const artifactId = await context.services.artifactStore.store(
      context.configurable.conversationId,
      context.configurable.messageId,
      'data_analysis',  // Domain type
      result,
      { ttlMinutes: 60 }
    );

    // Return summary + artifact reference
    return {
      artifact: artifactId,
      summary: {
        recordCount: result.records.length,
        keyMetrics: {
          mean: result.statistics.mean,
          median: result.statistics.median,
        },
        topInsights: result.insights.slice(0, 3),
      },
    };
  },
};
```

### Standard Response Format

All artifact-producing tools should return:

```typescript
{
  artifact: string;           // Artifact ID (art_xxx)
  summary: {                  // Domain-specific summary
    // Key metrics and insights
    // Enough context for the agent to decide if more detail is needed
  };
}
```

### Domain-Specific Exploration Tools

For complex artifacts, create specialized tools to explore them:

```typescript
const getAnalysisRecordsTool: ToolDefinition = {
  id: 'get_analysis_records',
  description: 'Get records from a data analysis artifact',

  inputSchema: z.object({
    artifact: z.string(),
    filter: z.record(z.unknown()).optional(),
    limit: z.number().default(20),
  }),

  execute: async ({ artifact, filter, limit }, context) => {
    const data = await context.services.artifactStore.get(artifact);
    if (!data || data.type !== 'data_analysis') {
      return { error: 'Artifact not found or wrong type' };
    }

    let records = data.data.records;
    if (filter) {
      records = records.filter(r => matchesFilter(r, filter));
    }

    return {
      count: records.length,
      records: records.slice(0, limit),
      hasMore: records.length > limit,
    };
  },
};
```

## Configuration

```typescript
type ArtifactConfig = {
  maxArtifactSizeBytes: number;         // Default: 10MB
  maxArtifactsPerConversation: number;  // Default: 50
  defaultTtlMinutes: number;            // Default: 60
  maxTtlMinutes: number;                // Default: 1440 (24 hours)
  cleanupIntervalMinutes: number;       // Default: 5
};
```

## Supported MIME Types

| MIME Type | Description | Storage |
|-----------|-------------|---------|
| `application/json` | JSON data (default) | Stored as text |
| `application/pdf` | PDF documents | Stored as base64 |
| `image/png` | PNG images | Stored as base64 |
| `image/jpeg` | JPEG images | Stored as base64 |
| `text/csv` | CSV data | Stored as text |
| `text/plain` | Plain text | Stored as text |

## Lifecycle

### Creation

Artifacts are created by tools during execution. Each artifact:
- Has a unique ID prefixed with `art_`
- Belongs to a conversation (deleted when conversation ends)
- Has a TTL (time-to-live) for automatic expiration

### Access

Each access updates the `accessedAt` timestamp. This can be used for analytics but doesn't extend the TTL.

### Expiration

Artifacts expire after their TTL. A background task runs periodically to clean up expired artifacts.

### Cascade Deletion

When a conversation is deleted, all its artifacts are automatically deleted via foreign key cascade.

## Best Practices

### Summary Design

1. **Include key metrics**: The most important numbers/results
2. **Provide counts**: How many records/items/routes
3. **Top N items**: First few most relevant results
4. **Decision points**: Information the agent needs to decide on next steps

### TTL Selection

| Use Case | Suggested TTL |
|----------|---------------|
| Short-lived analysis | 30-60 minutes |
| Route optimization | 2-4 hours |
| Generated reports | 4-24 hours |
| Reference data | 24 hours |

### When NOT to Use Artifacts

- Small responses (< 5KB)
- Data that will always need full access
- Ephemeral data not worth storing

## Database Schema

Artifacts are stored in the `artifacts` table:

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | Primary key (art_xxx) |
| `conversation_id` | TEXT | FK to conversations |
| `message_id` | TEXT | Message that created this |
| `type` | TEXT | Domain type |
| `mime_type` | TEXT | MIME type |
| `data` | TEXT | Serialized data |
| `size_bytes` | INTEGER | Original size |
| `ttl_minutes` | INTEGER | Time to live |
| `created_at` | TEXT | Creation timestamp |
| `expires_at` | TEXT | Expiration timestamp |
| `accessed_at` | TEXT | Last access timestamp |
