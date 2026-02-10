# API Server Specification

> RESTful API with OpenAPI documentation for agent invocation and tool execution.

**Version**: 1.0
**Status**: Implemented
**Dependencies**: 001-agent.md, 017-orchestrator-rewrite.md

## Overview

GLaDOS currently provides a CLI and Telegram interface for interacting with the agent. This specification defines a RESTful HTTP API that enables:

1. **Agent Invocation** - Send messages and receive responses (streaming and non-streaming)
2. **Tool Execution** - Execute tools directly via API endpoints
3. **API Documentation** - Interactive OpenAPI documentation using Scalar

The API reuses existing infrastructure (tools, orchestrator, Zod schemas) to maintain consistency between agent capabilities and API endpoints.

### Goals

1. Provide streaming (SSE) and non-streaming endpoints for agent chat
2. Expose tools as REST endpoints using an adapter pattern
3. Generate OpenAPI documentation from Zod schemas
4. Maintain consistency with agent behavior (same tools, same validation)
5. Support programmatic access for external integrations

### Non-Goals (for v1)

- Authentication and authorization (deferred - internal use only initially)
- Rate limiting
- Multi-user support
- WebSocket transport (SSE is sufficient)
- GraphQL API
- Tool execution approval flows via API (tools execute directly)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API Server                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        Fastify Instance                              │   │
│  │                                                                       │   │
│  │  ┌──────────────┐  ┌──────────────────┐  ┌─────────────────────┐   │   │
│  │  │ Zod Provider │  │  Scalar Plugin   │  │   SSE Plugin        │   │   │
│  │  │ (validation) │  │  (documentation) │  │   (streaming)       │   │   │
│  │  └──────────────┘  └──────────────────┘  └─────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│  ┌─────────────────────────────────┴─────────────────────────────────────┐ │
│  │                           Route Handlers                               │ │
│  ├───────────────────────────────────────────────────────────────────────┤ │
│  │                                                                        │ │
│  │  /api/v1/conversations                                                │ │
│  │    POST   /              → Create conversation                        │ │
│  │    GET    /:id           → Get conversation                           │ │
│  │    DELETE /:id           → Delete conversation                        │ │
│  │    GET    /:id/messages  → Get message history                        │ │
│  │                                                                        │ │
│  │  /api/v1/chat                                                         │ │
│  │    POST   /:conversationId         → Chat (non-streaming)             │ │
│  │    POST   /:conversationId/stream  → Chat (SSE streaming)             │ │
│  │                                                                        │ │
│  │  /api/v1/tools                                                        │ │
│  │    GET    /              → List all tools                             │ │
│  │    GET    /:toolId       → Get tool details                           │ │
│  │    POST   /:toolId       → Execute tool                               │ │
│  │                                                                        │ │
│  │  /api/v1/interrupts                                                   │ │
│  │    GET    /:conversationId  → Get pending interrupt                   │ │
│  │    POST   /:interruptId     → Respond to interrupt                    │ │
│  │                                                                        │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                    │                                        │
│  ┌─────────────────────────────────┴─────────────────────────────────────┐ │
│  │                        Tool Adapter Layer                              │ │
│  │                                                                        │ │
│  │   ToolDefinition → REST Endpoint                                      │ │
│  │   ├─ inputSchema  → Request body validation + OpenAPI schema          │ │
│  │   ├─ outputSchema → Response validation + OpenAPI schema              │ │
│  │   ├─ execute()    → Handler implementation                            │ │
│  │   └─ description  → OpenAPI description                               │ │
│  │                                                                        │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                    │                                        │
└────────────────────────────────────┼────────────────────────────────────────┘
                                     │
┌────────────────────────────────────┼────────────────────────────────────────┐
│                     Existing Infrastructure                                  │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │ OrchestratorSvc  │  │   ToolRegistry   │  │   Services (DI)  │          │
│  │                  │  │                  │  │                  │          │
│  │ - chat()         │  │ - getAll()       │  │ - DatabaseSvc    │          │
│  │ - respondTo...() │  │ - get()          │  │ - MemorySvc      │          │
│  │ - invokeBack..() │  │ - execute()      │  │ - CalendarSvc    │          │
│  │                  │  │                  │  │ - etc.           │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Dependencies

### NPM Packages

| Package | Purpose |
|---------|---------|
| `@fastify/type-provider-zod` | Zod schema integration for request/response validation |
| `@scalar/fastify-api-reference` | Interactive API documentation UI |
| `zod-to-json-schema` | Convert Zod schemas to JSON Schema for OpenAPI |

---

## Data Model

### Request/Response Schemas

```typescript
// Chat request (non-streaming)
const chatRequestSchema = z.object({
  message: z.string().min(1).describe('The message to send to the agent'),
});

// Chat response (non-streaming)
const chatResponseSchema = z.object({
  conversationId: z.string(),
  response: z.string(),
  interrupt: interruptSchema.optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
});

// SSE event types for streaming
const sseEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('token'), content: z.string() }),
  z.object({ type: z.literal('interrupt'), interrupt: interruptSchema }),
  z.object({
    type: z.literal('interrupt_resolved'),
    approved: z.boolean(),
    interruptId: z.string(),
  }),
  z.object({
    type: z.literal('done'),
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
  }),
  z.object({ type: z.literal('error'), error: z.string() }),
]);

// Tool execution request
const toolExecuteRequestSchema = z.object({
  input: z.record(z.unknown()).describe('Tool input parameters'),
  conversationId: z.string().optional().describe('Optional conversation context'),
});

// Tool execution response
const toolExecuteResponseSchema = z.object({
  toolId: z.string(),
  output: z.unknown(),
  durationMs: z.number(),
});

// Tool listing response
const toolListResponseSchema = z.object({
  tools: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    category: z.string(),
    tags: z.array(z.string()),
    inputSchema: z.record(z.unknown()), // JSON Schema
    outputSchema: z.record(z.unknown()), // JSON Schema
    risk: toolRiskProfileSchema,
    examples: z.array(z.object({
      input: z.record(z.unknown()),
      description: z.string(),
    })),
  })),
});

// Interrupt response request
const interruptResponseRequestSchema = z.object({
  approved: z.boolean().optional(),
  selectedOptionId: z.string().optional(),
  freeformResponse: z.string().optional(),
});

// Conversation creation request
const createConversationRequestSchema = z.object({
  title: z.string().optional().describe('Optional title for the conversation'),
});

// Conversation response
const conversationResponseSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// Error response
const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  statusCode: z.number(),
});
```

---

## API Endpoints

### Conversations

#### Create Conversation

```
POST /api/v1/conversations
```

Creates a new conversation session.

**Request Body:**
```json
{
  "title": "Optional title"
}
```

**Response (201):**
```json
{
  "id": "conv_abc123",
  "title": "Optional title",
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:30:00Z"
}
```

#### Get Conversation

```
GET /api/v1/conversations/:id
```

**Response (200):**
```json
{
  "id": "conv_abc123",
  "title": "My conversation",
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:35:00Z"
}
```

#### Delete Conversation

```
DELETE /api/v1/conversations/:id
```

**Response (204):** No content

#### Get Message History

```
GET /api/v1/conversations/:id/messages
```

**Response (200):**
```json
{
  "messages": [
    {
      "id": "msg_1",
      "role": "user",
      "content": "What time is it?",
      "createdAt": "2024-01-15T10:30:00Z"
    },
    {
      "id": "msg_2",
      "role": "assistant",
      "content": "It's currently 10:30 AM.",
      "createdAt": "2024-01-15T10:30:01Z"
    }
  ]
}
```

---

### Chat

#### Chat (Non-Streaming)

```
POST /api/v1/chat/:conversationId
```

Sends a message and waits for the complete response.

**Request Body:**
```json
{
  "message": "What's on my calendar today?"
}
```

**Response (200):**
```json
{
  "conversationId": "conv_abc123",
  "response": "You have 3 meetings today...",
  "inputTokens": 150,
  "outputTokens": 89
}
```

**Response (200 with interrupt):**
```json
{
  "conversationId": "conv_abc123",
  "response": "",
  "interrupt": {
    "id": "int_xyz",
    "type": "tool_approval",
    "prompt": "The agent wants to send an email. Allow?",
    "toolCall": {
      "toolId": "email.send",
      "toolName": "SendEmail",
      "args": { "to": "alice@example.com", "subject": "Hello" }
    }
  }
}
```

#### Chat (Streaming)

```
POST /api/v1/chat/:conversationId/stream
Content-Type: application/json
Accept: text/event-stream
```

Sends a message and streams the response via Server-Sent Events.

**Request Body:**
```json
{
  "message": "Write me a short story"
}
```

**Response (200):**
```
Content-Type: text/event-stream

event: token
data: {"type":"token","content":"Once upon a time"}

event: token
data: {"type":"token","content":" there was a brave knight"}

event: done
data: {"type":"done","inputTokens":50,"outputTokens":200}
```

**SSE Event Types:**

| Event | Description |
|-------|-------------|
| `token` | A chunk of the response text |
| `interrupt` | Agent requires user input (approval, question) |
| `interrupt_resolved` | User responded to an interrupt |
| `done` | Response complete with token usage |
| `error` | An error occurred |

---

### Tools

#### List Tools

```
GET /api/v1/tools
```

Returns all available tools with their schemas.

**Query Parameters:**
- `category` (optional): Filter by category
- `tag` (optional): Filter by tag

**Response (200):**
```json
{
  "tools": [
    {
      "id": "calendar.get_events",
      "name": "GetCalendarEvents",
      "description": "Retrieves calendar events for a date range",
      "category": "calendar",
      "tags": ["calendar", "read"],
      "inputSchema": {
        "type": "object",
        "properties": {
          "startDate": { "type": "string", "format": "date-time" },
          "endDate": { "type": "string", "format": "date-time" }
        },
        "required": ["startDate", "endDate"]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "events": { "type": "array", "items": { "$ref": "#/..." } }
        }
      },
      "risk": {
        "level": "low",
        "reason": "Read-only calendar access",
        "reversible": true,
        "categories": ["data_access"]
      },
      "examples": [
        {
          "input": { "startDate": "2024-01-15", "endDate": "2024-01-16" },
          "description": "Get events for a single day"
        }
      ]
    }
  ]
}
```

#### Get Tool Details

```
GET /api/v1/tools/:toolId
```

**Response (200):** Same shape as individual tool in list response.

#### Execute Tool

```
POST /api/v1/tools/:toolId
```

Executes a tool directly with the provided input.

**Request Body:**
```json
{
  "input": {
    "startDate": "2024-01-15T00:00:00Z",
    "endDate": "2024-01-16T00:00:00Z"
  },
  "conversationId": "conv_abc123"
}
```

**Response (200):**
```json
{
  "toolId": "calendar.get_events",
  "output": {
    "events": [
      { "title": "Team standup", "start": "2024-01-15T09:00:00Z" }
    ]
  },
  "durationMs": 45
}
```

**Response (400 - Validation Error):**
```json
{
  "error": "ValidationError",
  "message": "Invalid input: startDate is required",
  "statusCode": 400
}
```

**Response (404 - Tool Not Found):**
```json
{
  "error": "NotFound",
  "message": "Tool not found: calendar.invalid_tool",
  "statusCode": 404
}
```

---

### Interrupts

#### Get Pending Interrupt

```
GET /api/v1/interrupts/:conversationId
```

Returns the pending interrupt for a conversation, if any.

**Response (200):**
```json
{
  "id": "int_xyz",
  "conversationId": "conv_abc123",
  "type": "tool_approval",
  "status": "pending",
  "prompt": "The agent wants to delete a file. Allow?",
  "toolCall": {
    "toolId": "file.delete",
    "toolName": "DeleteFile",
    "args": { "path": "/tmp/test.txt" }
  },
  "createdAt": "2024-01-15T10:30:00Z"
}
```

**Response (204):** No pending interrupt.

#### Respond to Interrupt

```
POST /api/v1/interrupts/:interruptId
```

Responds to a pending interrupt.

**Request Body (approval):**
```json
{
  "approved": true
}
```

**Request Body (option selection):**
```json
{
  "selectedOptionId": "option_1"
}
```

**Request Body (freeform):**
```json
{
  "freeformResponse": "Actually, use a different file path"
}
```

**Response (200):**
```json
{
  "conversationId": "conv_abc123",
  "response": "File deleted successfully.",
  "inputTokens": 80,
  "outputTokens": 15
}
```

---

## Tool Adapter

The tool adapter bridges `ToolDefinition` to REST endpoints.

### Adapter Interface

```typescript
type ToolEndpointConfig = {
  /** Whether to expose this tool via API (default: true for low/medium risk) */
  exposeViaApi?: boolean;
  /** Custom path override (default: tool.id with dots replaced by slashes) */
  pathOverride?: string;
  /** Additional OpenAPI metadata */
  openApiOverrides?: {
    summary?: string;
    tags?: string[];
    deprecated?: boolean;
  };
};

/**
 * Converts a ToolDefinition to a Fastify route handler.
 */
const createToolEndpoint = (
  tool: RegisteredTool,
  services: Services,
  config?: ToolEndpointConfig,
): FastifyRouteOptions => {
  return {
    method: 'POST',
    url: `/api/v1/tools/${tool.id}`,
    schema: {
      body: zodToJsonSchema(toolExecuteRequestSchema),
      response: {
        200: zodToJsonSchema(toolExecuteResponseSchema),
        400: zodToJsonSchema(errorResponseSchema),
        404: zodToJsonSchema(errorResponseSchema),
      },
    },
    handler: async (request, reply) => {
      const { input, conversationId } = request.body;

      // Validate input against tool schema
      const validatedInput = tool.inputSchema.parse(input);

      // Create tool context
      const context: ToolContext = {
        userId: 'api',
        conversationId: conversationId ?? `api-${Date.now()}`,
        services,
      };

      // Execute tool
      const startTime = Date.now();
      const output = await tool.execute(validatedInput, context);
      const durationMs = Date.now() - startTime;

      // Validate output
      tool.outputSchema.parse(output);

      return { toolId: tool.id, output, durationMs };
    },
  };
};

/**
 * Registers all tools as API endpoints.
 */
const registerToolRoutes = (
  fastify: FastifyInstance,
  toolRegistry: ToolRegistry,
  services: Services,
): void => {
  // Register tool listing endpoint
  fastify.get('/api/v1/tools', toolListHandler);

  // Register individual tool endpoints
  for (const tool of toolRegistry.getAll()) {
    // Skip high/critical risk tools by default
    if (tool.risk.level === 'high' || tool.risk.level === 'critical') {
      continue;
    }

    const route = createToolEndpoint(tool, services);
    fastify.route(route);
  }
};
```

### Schema Conversion

```typescript
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Converts tool schemas to OpenAPI-compatible JSON Schema.
 */
const toolToOpenApiSchema = (tool: RegisteredTool): {
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
} => {
  return {
    inputSchema: zodToJsonSchema(tool.inputSchema, {
      name: `${tool.name}Input`,
      $refStrategy: 'none',
    }),
    outputSchema: zodToJsonSchema(tool.outputSchema, {
      name: `${tool.name}Output`,
      $refStrategy: 'none',
    }),
  };
};
```

---

## OpenAPI Documentation

### Scalar Integration

```typescript
import scalarFastify from '@scalar/fastify-api-reference';

const registerApiDocumentation = async (fastify: FastifyInstance): Promise<void> => {
  // Register Scalar for API documentation
  await fastify.register(scalarFastify, {
    routePrefix: '/docs',
    configuration: {
      theme: 'purple',
      spec: {
        url: '/api/v1/openapi.json',
      },
      metaData: {
        title: 'GLaDOS API',
        description: 'AI Assistant API',
      },
    },
  });

  // Serve OpenAPI spec
  fastify.get('/api/v1/openapi.json', async () => {
    return fastify.swagger();
  });
};
```

### OpenAPI Specification Generation

The OpenAPI spec is generated from:
1. Route schemas defined with `fastify-type-provider-zod`
2. Tool schemas converted via `zod-to-json-schema`

```typescript
import fastifySwagger from '@fastify/swagger';

const registerSwagger = async (fastify: FastifyInstance): Promise<void> => {
  await fastify.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'GLaDOS API',
        description: 'AI Personal Assistant API',
        version: '1.0.0',
      },
      servers: [
        { url: 'http://localhost:3000', description: 'Development' },
      ],
      tags: [
        { name: 'conversations', description: 'Conversation management' },
        { name: 'chat', description: 'Agent interaction' },
        { name: 'tools', description: 'Tool execution' },
        { name: 'interrupts', description: 'Interrupt handling' },
      ],
    },
  });
};
```

---

## Streaming Implementation

### SSE Response Handler

```typescript
import { FastifyReply } from 'fastify';

/**
 * Streams chat chunks as Server-Sent Events.
 */
const streamChatResponse = async (
  reply: FastifyReply,
  chatGenerator: AsyncGenerator<ChatChunk>,
): Promise<void> => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  try {
    for await (const chunk of chatGenerator) {
      const eventName = chunk.type;
      const data = JSON.stringify(chunk);
      reply.raw.write(`event: ${eventName}\ndata: ${data}\n\n`);
    }
  } catch (error) {
    const errorChunk = {
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
    reply.raw.write(`event: error\ndata: ${JSON.stringify(errorChunk)}\n\n`);
  } finally {
    reply.raw.end();
  }
};
```

### Stream Route Handler

```typescript
fastify.post<{
  Params: { conversationId: string };
  Body: z.infer<typeof chatRequestSchema>;
}>('/api/v1/chat/:conversationId/stream', {
  schema: {
    params: z.object({ conversationId: z.string() }),
    body: chatRequestSchema,
  },
  handler: async (request, reply) => {
    const { conversationId } = request.params;
    const { message } = request.body;

    const orchestrator = services.get(OrchestratorService);
    const chatGenerator = orchestrator.chat(conversationId, message);

    await streamChatResponse(reply, chatGenerator);
  },
});
```

---

## Configuration

### Environment Variables

```bash
# Existing
GLADOS_API_HOST=0.0.0.0
GLADOS_API_PORT=3000
GLADOS_API_PUBLIC_URL=http://localhost:3000
GLADOS_API_TRUST_PROXY=true

# New
GLADOS_API_DOCS_ENABLED=true        # Enable Scalar documentation
GLADOS_API_TOOLS_ENABLED=true       # Enable tool execution endpoints
GLADOS_API_CORS_ORIGINS=*           # CORS allowed origins (comma-separated)
```

### Config Schema Extension

```typescript
const apiConfigSchema = {
  api: {
    host: { ... },
    port: { ... },
    publicUrl: { ... },
    trustProxy: { ... },
    // New fields
    docsEnabled: {
      doc: 'Enable API documentation endpoint',
      format: Boolean,
      default: true,
      env: 'GLADOS_API_DOCS_ENABLED',
    },
    toolsEnabled: {
      doc: 'Enable tool execution endpoints',
      format: Boolean,
      default: true,
      env: 'GLADOS_API_TOOLS_ENABLED',
    },
    corsOrigins: {
      doc: 'CORS allowed origins',
      format: String,
      default: '*',
      env: 'GLADOS_API_CORS_ORIGINS',
    },
  },
};
```

---

## Implementation Phases

### Phase 1: Core Infrastructure ✅ IMPLEMENTED

- [x] Add npm dependencies (`fastify-type-provider-zod`, `@scalar/fastify-api-reference`, `@fastify/swagger`, `zod-to-json-schema`, `@fastify/cors`)
- [x] Create `src/integrations/api/api.schemas.ts` with request/response schemas
- [x] Create `src/integrations/api/api.errors.ts` with API-specific errors
- [x] Update `src/integrations/api/api.ts` with CORS, Swagger, Scalar
- [x] Add configuration options (`docsEnabled`, `toolsEnabled`, `corsOrigins`)

### Phase 2: Conversation & Chat Endpoints ✅ IMPLEMENTED

- [x] Create `src/integrations/api/routes/conversations.ts`
  - [x] POST `/conversations` - create
  - [x] GET `/conversations` - list
  - [x] GET `/conversations/:id` - get
  - [x] DELETE `/conversations/:id` - delete
  - [x] GET `/conversations/:id/messages` - history
- [x] Create `src/integrations/api/routes/chat.ts`
  - [x] POST `/chat/:conversationId` - non-streaming
  - [x] POST `/chat/:conversationId/stream` - SSE streaming
- [ ] Add tests for conversation routes
- [ ] Add tests for chat routes

### Phase 3: Interrupt Endpoints ✅ IMPLEMENTED

- [x] Create `src/integrations/api/routes/interrupts.ts`
  - [x] GET `/interrupts/:conversationId` - get pending
  - [x] POST `/interrupts/:interruptId` - respond
- [ ] Add tests for interrupt routes

### Phase 4: Tool Adapter & Endpoints ✅ IMPLEMENTED

- [x] Create `src/integrations/api/tool-adapter.ts`
  - [x] `zodSchemaToJsonSchema()` function
  - [x] `toolToApiInfo()` function
  - [x] `isToolExposedViaApi()` function
- [x] Create `src/integrations/api/routes/tools.ts`
  - [x] GET `/tools` - list all (with category/tag filtering)
  - [x] GET `/tools/:toolId` - get details
  - [x] POST `/tools/:toolId` - execute
- [ ] Add tests for tool adapter
- [ ] Add tests for tool routes

### Phase 5: API Documentation ✅ IMPLEMENTED

- [x] Integrate `@fastify/swagger` for OpenAPI generation
- [x] Integrate `@scalar/fastify-api-reference` for documentation UI
- [x] Add `/api/v1/openapi.json` endpoint
- [x] Add `/docs` endpoint for Scalar UI
- [ ] Verify all schemas render correctly in documentation

### Phase 6: Testing & Polish

- [ ] Add integration tests for full chat flows
- [ ] Add integration tests for tool execution
- [ ] Update `docs/external-clients.md` with API client examples
- [ ] Performance testing for streaming endpoints

---

## Module Structure

```
src/integrations/api/
├── api.ts                    # Main entry, server factory
├── api.schemas.ts            # Request/response Zod schemas
├── api.types.ts              # Type definitions
├── api.errors.ts             # API-specific errors
├── tool-adapter.ts           # Tool → REST endpoint adapter
├── routes/
│   ├── health.ts             # Health check (existing)
│   ├── conversations.ts      # Conversation CRUD
│   ├── chat.ts               # Chat endpoints (streaming/non-streaming)
│   ├── interrupts.ts         # Interrupt handling
│   ├── tools.ts              # Tool listing and execution
│   └── webhooks/
│       └── oura.ts           # Oura webhook (existing)
└── __tests__/
    ├── conversations.test.ts
    ├── chat.test.ts
    ├── interrupts.test.ts
    ├── tools.test.ts
    └── tool-adapter.test.ts
```

---

## Security Considerations

### Risk-Based Tool Exposure

Tools are exposed based on their risk level:

| Risk Level | Default Exposure | Rationale |
|------------|-----------------|-----------|
| `low` | Exposed | Read-only, safe operations |
| `medium` | Exposed | Modifications with limited impact |
| `high` | **Not exposed** | Significant impact, requires human approval |
| `critical` | **Not exposed** | Dangerous operations, never via API |

High-risk tools can only be executed via the agent with human-in-the-loop approval.

### Future Security Considerations (out of scope for v1)

- API key authentication
- Rate limiting per client
- Request signing
- Audit logging
- IP allowlisting

---

## Example Usage

### cURL - Non-Streaming Chat

```bash
# Create conversation
CONV=$(curl -s -X POST http://localhost:3000/api/v1/conversations | jq -r '.id')

# Send message
curl -X POST http://localhost:3000/api/v1/chat/$CONV \
  -H "Content-Type: application/json" \
  -d '{"message": "What time is it?"}'
```

### cURL - Streaming Chat

```bash
curl -X POST http://localhost:3000/api/v1/chat/$CONV/stream \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"message": "Tell me a joke"}' \
  --no-buffer
```

### cURL - Tool Execution

```bash
# List tools
curl http://localhost:3000/api/v1/tools

# Execute tool
curl -X POST http://localhost:3000/api/v1/tools/calendar.get_events \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "startDate": "2024-01-15T00:00:00Z",
      "endDate": "2024-01-16T00:00:00Z"
    }
  }'
```

### TypeScript Client

```typescript
// Non-streaming
const response = await fetch(`${API_URL}/api/v1/chat/${conversationId}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: 'Hello!' }),
});
const result = await response.json();

// Streaming
const response = await fetch(`${API_URL}/api/v1/chat/${conversationId}/stream`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
  },
  body: JSON.stringify({ message: 'Tell me a story' }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const text = decoder.decode(value);
  // Parse SSE events...
}
```

---

## Future Considerations

- **Authentication**: API keys, OAuth2, or JWT-based auth
- **Rate Limiting**: Per-client request limits
- **WebSocket Support**: Bidirectional streaming for more interactive use cases
- **Batch Operations**: Execute multiple tools in a single request
- **Async Tool Execution**: Queue long-running tools and poll for results
- **Webhook Callbacks**: Notify external systems of conversation events
- **Multi-Tenant Support**: User isolation and per-user tool access
