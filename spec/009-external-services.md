# External Services Specification

> Integration with external services through environment-based configuration

**Version**: 1.0
**Status**: Implemented
**Dependencies**: Configuration (Phase 1), Tools (Phase 2)

## Overview

External Services provides a pattern for integrating third-party services (Home Assistant, Notion, Linear, etc.) into GLaDOS. Unlike built-in services, external services require user-provided credentials and may not be available in all installations.

### Goals

1. **Environment-Based Configuration**: Services configured via environment variables (like Telegram)
2. **Automatic Tool Availability**: When a service is configured, its tools are automatically available
3. **Graceful Degradation**: Missing or misconfigured services don't crash the system
4. **Future Skill Support**: Architecture supports optional skill-based gating for sensitive operations

### Non-Goals (for v1)

- Agent-assisted configuration (future consideration)
- Encrypted credential storage (future consideration)
- OAuth flows (most home-centric services use tokens)
- Multi-user service sharing (single-user system)
- Service-to-service communication (each service is independent)

### Key Design Decisions

1. **Environment Variables for Credentials**: Same pattern as LLM and Telegram configuration
2. **Tools Available When Configured**: Service tools automatically available—no activation required
3. **Optional Skill Gating**: High-risk operations can optionally be wrapped in skills (future)
4. **Services Container**: External services use the same DI pattern as built-in services

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          External Services System                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                      Environment Variables                           │   │
│   │                                                                      │   │
│   │  GLADOS_HOMEASSISTANT_URL=http://homeassistant.local:8123           │   │
│   │  GLADOS_HOMEASSISTANT_TOKEN=eyJhbG...                               │   │
│   │                                                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    │ loadConfig()                            │
│                                    ▼                                         │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    ExternalServiceRegistry                           │   │
│   │                                                                      │   │
│   │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │   │
│   │  │ homeassistant│  │    notion    │  │    linear    │  ...          │   │
│   │  │  definition  │  │  definition  │  │  definition  │               │   │
│   │  └──────────────┘  └──────────────┘  └──────────────┘               │   │
│   │                                                                      │   │
│   │  Methods:                                                            │   │
│   │  - register(definition)    - Register a service definition          │   │
│   │  - isConfigured(id)        - Check if env vars are set              │   │
│   │  - getClient(id)           - Get initialized client                 │   │
│   │  - areServicesMet(ids)     - Check if multiple services configured  │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    │ getClient()                             │
│                                    ▼                                         │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                     Service Client Instance                          │   │
│   │                                                                      │   │
│   │  - Initialized with credentials from config                         │   │
│   │  - Provides typed API for service interaction                       │   │
│   │  - Cached per service (lazy initialization)                         │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Tool/Skill Availability Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    Startup → Tool Availability                            │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  1. loadConfig() reads environment variables                              │
│                    │                                                      │
│                    ▼                                                      │
│  2. Tools/Skills declare their requiredServices                          │
│     - ha_call_service requires: ['homeassistant']                        │
│     - notion_query requires: ['notion']                                  │
│                    │                                                      │
│                    ▼                                                      │
│  3. ToolRegistry filters tools by service availability                   │
│     - Is homeassistant configured? (URL + token present)                 │
│     - If yes → ha_call_service available to agent                        │
│     - If no → tool hidden from agent                                     │
│                    │                                                      │
│                    ▼                                                      │
│  4. Agent can use available tools directly (no activation required)      │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘
```

### Future: Skill-Based Gating

For sensitive operations, skills can optionally require service configuration:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    Future: Optional Skill Gating                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Skill defines:                                                           │
│  - requiredServices: ['homeassistant']                                   │
│  - activationRisk: 'high'                                                │
│                                                                           │
│  Example: homeassistant-security skill                                   │
│  - requiredServices: ['homeassistant']                                   │
│  - Tools: [unlock_door, disarm_alarm, open_garage]                       │
│  - Requires user approval before activation                              │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Configuration

External services are configured via environment variables, following the same pattern as the LLM and Telegram configuration.

### Environment Variable Pattern

Each service defines its required configuration:

```bash
# Home Assistant
GLADOS_HOMEASSISTANT_URL=http://homeassistant.local:8123
GLADOS_HOMEASSISTANT_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Future services follow the same pattern
# GLADOS_NOTION_TOKEN=secret_abc123...
# GLADOS_LINEAR_API_KEY=lin_api_...
```

### Convict Schema Addition

```typescript
// Add to src/config/config.ts

homeassistant: {
  url: {
    doc: 'Home Assistant URL',
    format: String,
    default: '',
    env: 'GLADOS_HOMEASSISTANT_URL',
  },
  token: {
    doc: 'Home Assistant long-lived access token',
    format: String,
    default: '',
    env: 'GLADOS_HOMEASSISTANT_TOKEN',
    sensitive: true,
  },
},
```

### Configuration Check

Services are considered "configured" when all required environment variables are present and non-empty:

```typescript
const isHomeAssistantConfigured = (): boolean => {
  const config = getConfig();
  return (
    config.homeassistant.url.length > 0 &&
    config.homeassistant.token.length > 0
  );
};
```

---

## Data Model

### External Service Definition

```typescript
type ExternalServiceDefinition = {
  id: string;                           // e.g., 'homeassistant'
  name: string;                         // e.g., 'Home Assistant'
  description: string;                  // What this service provides

  // Configuration check
  isConfigured: () => boolean;          // Check if env vars are set

  // Client factory
  createClient: () => Promise<ServiceClient>;
};

type ServiceClient = {
  // Service-specific client interface
  // Each service defines its own methods
  disconnect: () => Promise<void>;
};
```

### Service Dependencies on Tools and Skills

Tools and skills can declare dependencies on external services. They are only available when all required services are configured:

```typescript
// Extended ToolDefinition
type ToolDefinition = {
  // ... existing fields

  // Service dependencies - tool only available when these services are configured
  requiredServices?: string[];          // e.g., ['homeassistant']
};

// Extended SkillDefinition
type SkillDefinition = {
  // ... existing fields

  // Service dependencies - skill only available when these services are configured
  requiredServices?: string[];          // e.g., ['homeassistant', 'notion']
};
```

### Service Status

```typescript
type ExternalServiceStatus = {
  serviceId: string;
  serviceName: string;
  configured: boolean;
  connectionStatus: 'unknown' | 'connected' | 'error';
  errorMessage?: string;
};
```

---

## Database Schema

No database tables required for v1. Configuration is read from environment variables.

Future versions with agent-managed configuration may add credential storage.

---

## ExternalServiceRegistry

### Interface

```typescript
class ExternalServiceRegistry {
  constructor(deps: { logger: Logger });

  // Registration
  register(definition: ExternalServiceDefinition): void;

  // Status
  isConfigured(serviceId: string): boolean;
  getStatus(serviceId: string): ExternalServiceStatus;
  listAll(): ExternalServiceDefinition[];

  // Client access (lazy initialization, cached)
  getClient<T extends ServiceClient>(serviceId: string): Promise<T>;

  // Check if service dependencies are met
  areServicesMet(serviceIds: string[]): boolean;
}
```

### Implementation

```typescript
class ExternalServiceRegistry {
  #definitions = new Map<string, ExternalServiceDefinition>();
  #clients = new Map<string, ServiceClient>();  // Active clients cache
  #logger: Logger;

  register(definition: ExternalServiceDefinition): void {
    this.#definitions.set(definition.id, definition);
    this.#logger.debug(`Registered external service: ${definition.id}`);
  }

  isConfigured(serviceId: string): boolean {
    const definition = this.#definitions.get(serviceId);
    if (!definition) {
      return false;
    }
    return definition.isConfigured();
  }

  areServicesMet(serviceIds: string[]): boolean {
    return serviceIds.every(id => this.isConfigured(id));
  }

  async getClient<T extends ServiceClient>(serviceId: string): Promise<T> {
    // Check cache first
    const cached = this.#clients.get(serviceId);
    if (cached) {
      return cached as T;
    }

    const definition = this.#definitions.get(serviceId);
    if (!definition) {
      throw new ExternalServiceError(`Unknown service: ${serviceId}`);
    }

    if (!definition.isConfigured()) {
      throw new ExternalServiceError(`Service not configured: ${serviceId}`);
    }

    // Create and cache client
    const client = await definition.createClient();
    this.#clients.set(serviceId, client);

    return client as T;
  }
}
```

---

## Tool Registration Integration

### Filtering Tools by Service Dependencies

The tool registry filters tools based on their service dependencies:

```typescript
// In ToolRegistry or during tool registration

const getAvailableTools = (
  allTools: ToolDefinition[],
  serviceRegistry: ExternalServiceRegistry,
): ToolDefinition[] => {
  return allTools.filter(tool => {
    // Tools without service dependencies are always available
    if (!tool.requiredServices || tool.requiredServices.length === 0) {
      return true;
    }

    // Check if all required services are configured
    return serviceRegistry.areServicesMet(tool.requiredServices);
  });
};
```

### Filtering Skills by Service Dependencies

Similarly for skills:

```typescript
// In SkillRegistry

const getAvailableSkills = (
  allSkills: SkillDefinition[],
  serviceRegistry: ExternalServiceRegistry,
): SkillDefinition[] => {
  return allSkills.filter(skill => {
    if (!skill.requiredServices || skill.requiredServices.length === 0) {
      return true;
    }
    return serviceRegistry.areServicesMet(skill.requiredServices);
  });
};
```

---

## Home Assistant Integration

### Service Definition

```typescript
// src/external/homeassistant/homeassistant.ts

import { createConnection, createLongLivedTokenAuth } from 'home-assistant-js-websocket';
import { getConfig } from '../../config/config.ts';
import type { ExternalServiceDefinition } from '../external.schemas.ts';

export const homeassistantDefinition: ExternalServiceDefinition = {
  id: 'homeassistant',
  name: 'Home Assistant',
  description: 'Smart home control and automation via Home Assistant',

  isConfigured: () => {
    const config = getConfig();
    return (
      config.homeassistant.url.length > 0 &&
      config.homeassistant.token.length > 0
    );
  },

  createClient: async () => {
    const config = getConfig();
    const auth = createLongLivedTokenAuth(
      config.homeassistant.url,
      config.homeassistant.token,
    );
    const connection = await createConnection({ auth });

    return {
      connection,
      async disconnect() {
        await connection.close();
      },
    };
  },
};
```

### Home Assistant Tool: call_service

For v1, a single tool for testing the integration:

```typescript
// src/external/homeassistant/homeassistant.tools.ts

import { z } from 'zod';
import type { ToolDefinition } from '../../tools/tools.schemas.ts';

export const haCallServiceTool: ToolDefinition = {
  id: 'ha_call_service',
  name: 'Call Home Assistant Service',
  description: `Call a Home Assistant service to control devices.

Examples:
- Turn on a light: domain="light", service="turn_on", target={ entity_id: "light.living_room" }
- Set thermostat: domain="climate", service="set_temperature", target={ entity_id: "climate.main" }, data={ temperature: 72 }
- Toggle switch: domain="switch", service="toggle", target={ entity_id: "switch.fan" }`,

  category: 'external',

  // This tool requires homeassistant to be configured
  requiredServices: ['homeassistant'],

  inputSchema: z.object({
    domain: z.string().describe('Service domain (e.g., "light", "switch", "climate", "cover")'),
    service: z.string().describe('Service name (e.g., "turn_on", "turn_off", "toggle", "set_temperature")'),
    target: z.object({
      entity_id: z.union([z.string(), z.array(z.string())])
        .describe('Entity ID(s) to target'),
    }).optional(),
    data: z.record(z.unknown()).optional()
      .describe('Service data (e.g., { brightness_pct: 80, color_name: "blue" })'),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),

  risk: {
    level: 'medium',
    reason: 'Modifies smart home device state',
    potentialImpact: 'Changes to lights, switches, climate, and other devices',
    reversible: true,
    categories: ['smart-home'],
  },

  tags: ['homeassistant', 'smart-home', 'iot'],

  examples: [
    {
      description: 'Turn on living room lights at 80% brightness',
      input: {
        domain: 'light',
        service: 'turn_on',
        target: { entity_id: 'light.living_room' },
        data: { brightness_pct: 80 },
      },
    },
    {
      description: 'Set thermostat to 72°F',
      input: {
        domain: 'climate',
        service: 'set_temperature',
        target: { entity_id: 'climate.main_floor' },
        data: { temperature: 72 },
      },
    },
  ],

  execute: async (input, context) => {
    const registry = context.services.get(ExternalServiceRegistry);
    const client = await registry.getClient<HomeAssistantClient>('homeassistant');

    await client.connection.sendMessagePromise({
      type: 'call_service',
      domain: input.domain,
      service: input.service,
      target: input.target,
      service_data: input.data,
    });

    const targetStr = input.target?.entity_id
      ? ` on ${Array.isArray(input.target.entity_id) ? input.target.entity_id.join(', ') : input.target.entity_id}`
      : '';

    return {
      success: true,
      message: `Called ${input.domain}.${input.service}${targetStr}`,
    };
  },
};
```

---

## File Structure

```
src/external/
├── external.ts                 # Main ExternalServiceRegistry
├── external.schemas.ts         # Zod schemas
├── external.errors.ts          # Custom errors
├── external.test.ts            # Unit tests
└── homeassistant/
    ├── homeassistant.ts        # Service definition
    ├── homeassistant.tools.ts  # HA tools (call_service)
    └── homeassistant.test.ts   # HA tests
```

---

## Testing Strategy

### Unit Tests

- Service definition validation
- Configuration checks
- Client caching behavior
- Tool filtering by service availability

### Integration Tests

- End-to-end tool execution with mocked Home Assistant
- Connection error handling
- Service not configured error paths

### Mock Server

For testing without a real Home Assistant instance:

```typescript
// test/mocks/homeassistant.mock.ts

import { setupServer } from 'msw/node';
import { ws } from 'msw';

export const homeassistantHandlers = [
  ws.link('ws://homeassistant.local:8123/api/websocket').addEventListener('connection', ({ client }) => {
    client.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);

      if (message.type === 'auth') {
        client.send(JSON.stringify({ type: 'auth_ok' }));
      }

      if (message.type === 'call_service') {
        client.send(JSON.stringify({
          id: message.id,
          type: 'result',
          success: true,
          result: null,
        }));
      }
    });
  }),
];
```

---

## Implementation Phases

### Phase 1: Core Infrastructure

- [x] Add homeassistant config to convict schema
- [x] ExternalServiceRegistry class
- [x] Service definition pattern
- [x] `requiredServices` field on ToolDefinition

### Phase 2: Home Assistant

- [x] Service definition
- [x] `ha_call_service` tool
- [x] Tool filtering integration in ToolRegistry
- [x] Basic tests

### Phase 3: Testing & Documentation

- [x] Unit test suite
- [x] Integration tests with mock WebSocket
- [x] Update CLAUDE.md

---

## Future Considerations

1. **Agent-Assisted Configuration**: Implement secure credential configuration through the agent using asymmetric encryption.

2. **Encrypted Credential Storage**: Store credentials in encrypted database instead of environment variables.

3. **Additional Home Assistant Tools**: Add `ha_list_entities`, `ha_get_state`, `ha_list_automations` etc. as needed.

4. **OAuth Flows**: For services that require OAuth (Google, Microsoft), add browser-based authorization flow.

5. **Service Health Monitoring**: Background checks on configured services, proactive notifications on connection issues.

6. **Additional Services**:
   - **Notion**: Notes, databases, pages
   - **Linear**: Issues, projects
   - **Todoist**: Tasks, projects
   - **Calendar APIs**: Google Calendar, Outlook
   - **Music**: Spotify, Apple Music

7. **Skill-Gated Operations**: High-risk operations (unlock doors, disarm alarms) wrapped in skills requiring approval.
