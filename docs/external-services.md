# External Services Guide

This document describes how to integrate external services (Home Assistant, Notion, Linear, etc.) into GLaDOS. External services provide capabilities that the agent can use to interact with third-party systems.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          External Services System                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Environment Variables                                                  │
│   ┌───────────────────────────────────────────────────────────────────┐ │
│   │  GLADOS_HOMEASSISTANT_URL=http://homeassistant.local:8123         │ │
│   │  GLADOS_HOMEASSISTANT_TOKEN=eyJhbG...                             │ │
│   └───────────────────────────────────────────────────────────────────┘ │
│                              │                                           │
│                              ▼                                           │
│   ┌───────────────────────────────────────────────────────────────────┐ │
│   │  ExternalServiceRegistry                                          │ │
│   │  - register(definition)     - Register service definition         │ │
│   │  - isConfigured(id)         - Check if env vars are set           │ │
│   │  - getClient(id)            - Get initialized client (cached)     │ │
│   │  - areServicesMet(ids)      - Check multiple services             │ │
│   └───────────────────────────────────────────────────────────────────┘ │
│                              │                                           │
│                              ▼                                           │
│   ┌───────────────────────────────────────────────────────────────────┐ │
│   │  Tool Filtering                                                    │ │
│   │  - Tools with requiredServices only available when configured     │ │
│   │  - Filtering happens at LLM tool binding time                     │ │
│   └───────────────────────────────────────────────────────────────────┘ │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Key Concepts

- **External Service**: A third-party system (Home Assistant, Notion, etc.) that GLaDOS can interact with
- **Service Definition**: Configuration for how to check if a service is configured and how to create clients
- **Service Client**: An initialized connection to the external service
- **Required Services**: Tools/skills can declare which services they need to function

## Configuration

External services are configured via environment variables, following the same pattern as LLM and Telegram configuration.

### Home Assistant

```bash
# Required for Home Assistant integration
GLADOS_HOMEASSISTANT_URL=http://homeassistant.local:8123
GLADOS_HOMEASSISTANT_TOKEN=<your-long-lived-access-token>
```

To get a long-lived access token:
1. Open Home Assistant
2. Go to your profile (click your name in the sidebar)
3. Scroll to "Long-lived access tokens"
4. Click "Create Token"
5. Give it a name (e.g., "GLaDOS")
6. Copy the token

### Oura Ring

```bash
# Required for Oura Ring health tracking
GLADOS_OURA_CLIENT_ID=<your-client-id>
GLADOS_OURA_CLIENT_SECRET=<your-client-secret-or-personal-access-token>
GLADOS_OURA_WEBHOOK_SECRET=<your-webhook-secret>

# Required for webhook callbacks
GLADOS_API_PUBLIC_URL=https://your-server.example.com
```

To set up Oura integration:
1. Go to the [Oura Developer Portal](https://cloud.ouraring.com/oauth/applications)
2. Create a new application
3. Note the Client ID and Client Secret
4. For personal use, you can also generate a Personal Access Token
5. Set a webhook secret (any secure random string you choose)

The webhook subscriptions are automatically created when the server starts.

## Available Tools

### ha_call_service

Call a Home Assistant service to control smart home devices.

**Input:**
```typescript
{
  domain: string;     // Service domain (e.g., "light", "switch", "climate")
  service: string;    // Service name (e.g., "turn_on", "turn_off", "toggle")
  target?: {
    entity_id: string | string[];  // Entity ID(s) to target
  };
  data?: Record<string, unknown>;  // Service-specific data
}
```

**Examples:**

Turn on a light:
```typescript
{
  domain: "light",
  service: "turn_on",
  target: { entity_id: "light.living_room" }
}
```

Dim a light to 50%:
```typescript
{
  domain: "light",
  service: "turn_on",
  target: { entity_id: "light.bedroom" },
  data: { brightness_pct: 50 }
}
```

Set thermostat temperature:
```typescript
{
  domain: "climate",
  service: "set_temperature",
  target: { entity_id: "climate.main_floor" },
  data: { temperature: 72 }
}
```

Toggle a switch:
```typescript
{
  domain: "switch",
  service: "toggle",
  target: { entity_id: "switch.office_fan" }
}
```

**Common Domains and Services:**

| Domain | Services | Data Fields |
|--------|----------|-------------|
| `light` | `turn_on`, `turn_off`, `toggle` | `brightness_pct`, `color_name`, `rgb_color` |
| `switch` | `turn_on`, `turn_off`, `toggle` | - |
| `climate` | `set_temperature`, `set_hvac_mode` | `temperature`, `hvac_mode` |
| `cover` | `open_cover`, `close_cover`, `stop_cover` | `position` |
| `media_player` | `turn_on`, `turn_off`, `volume_set` | `volume_level` |
| `scene` | `turn_on` | - |
| `script` | `turn_on` | script-specific |

### health.get_data

Retrieve health and wellness data from connected wearables (Oura Ring).

**Input:**
```typescript
{
  type?: 'sleep' | 'activity' | 'readiness' | 'stress' | 'spo2' | 'workout';
  startDate?: string;  // YYYY-MM-DD, defaults to 7 days ago
  endDate?: string;    // YYYY-MM-DD, defaults to today
  limit?: number;      // Max records to return (default: 7, max: 30)
}
```

**Output:**
```typescript
{
  records: Array<{
    type: string;
    date: string;
    score: number | null;
    provider: string;
    data: Record<string, unknown>;
  }>;
}
```

**Examples:**

Get last night's sleep:
```typescript
{ type: 'sleep', limit: 1 }
```

Get readiness scores for the past week:
```typescript
{ type: 'readiness' }
```

Get activity data for a specific range:
```typescript
{ type: 'activity', startDate: '2026-02-01', endDate: '2026-02-06' }
```

### health.get_sleep_summary

Get a summary of sleep patterns over a date range.

**Input:**
```typescript
{
  startDate?: string;  // YYYY-MM-DD, defaults to 7 days ago
  endDate?: string;    // YYYY-MM-DD, defaults to today
}
```

**Output:**
```typescript
{
  summary: {
    averageDurationMinutes: number;
    averageScore: number | null;
    averageEfficiency: number | null;
    totalNights: number;
    trend: 'improving' | 'declining' | 'stable';
  };
  nights: Array<{
    date: string;
    durationMinutes: number;
    score: number | null;
  }>;
}
```

**Examples:**

Get sleep summary for the past week:
```typescript
{}
```

Get sleep summary for January:
```typescript
{ startDate: '2026-01-01', endDate: '2026-01-31' }
```

## Adding a New External Service

### 1. Add Configuration

Add the service configuration to `src/config/config.ts`:

```typescript
// In the convict schema
myservice: {
  apiKey: {
    doc: 'MyService API key',
    format: String,
    default: '',
    env: 'GLADOS_MYSERVICE_API_KEY',
    sensitive: true,
  },
  baseUrl: {
    doc: 'MyService API base URL',
    format: String,
    default: 'https://api.myservice.com',
    env: 'GLADOS_MYSERVICE_URL',
  },
},

// In the Config type
myservice: {
  apiKey: string;
  baseUrl: string;
};

// Add a configuration check function
const isMyServiceConfigured = (): boolean => {
  const config = getConfig();
  return config.myservice.apiKey.length > 0;
};
```

### 2. Create Service Definition

Create the service definition in `src/external/myservice/myservice.ts`:

```typescript
import { getConfig, isMyServiceConfigured } from '../../config/config.ts';
import type { ExternalServiceDefinition, ServiceClient } from '../external.schemas.ts';

type MyServiceClient = ServiceClient & {
  // Add service-specific methods
  doSomething: (input: string) => Promise<string>;
};

const myserviceDefinition: ExternalServiceDefinition = {
  id: 'myservice',
  name: 'My Service',
  description: 'Description of what this service provides',

  isConfigured: isMyServiceConfigured,

  createClient: async (): Promise<MyServiceClient> => {
    const config = getConfig();

    // Initialize your client library
    const client = new MyServiceSDK({
      apiKey: config.myservice.apiKey,
      baseUrl: config.myservice.baseUrl,
    });

    return {
      doSomething: async (input: string) => {
        return await client.someMethod(input);
      },

      disconnect: async () => {
        // Clean up resources if needed
        await client.close();
      },
    };
  },
};

export type { MyServiceClient };
export { myserviceDefinition };
```

### 3. Create Tools

Create tools in `src/external/myservice/myservice.tools.ts`:

```typescript
import { z } from 'zod';

import type { ToolDefinition } from '../../tools/tools.types.ts';
import { ExternalServiceRegistry } from '../external.ts';

import type { MyServiceClient } from './myservice.ts';

const myserviceDoSomethingTool: ToolDefinition = {
  id: 'myservice_do_something',
  name: 'Do Something with MyService',
  description: 'Description of what this tool does',

  category: 'external',

  // This tool requires myservice to be configured
  requiredServices: ['myservice'],

  inputSchema: z.object({
    input: z.string().describe('The input to process'),
  }),

  outputSchema: z.object({
    result: z.string(),
  }),

  risk: {
    level: 'low',  // or 'medium', 'high', 'critical'
    reason: 'Explanation of why this risk level',
    potentialImpact: 'What could happen',
    reversible: true,
    categories: [],
  },

  tags: ['myservice'],
  examples: [],

  execute: async (input, context) => {
    const registry = context.services.get(ExternalServiceRegistry);
    const client = await registry.getClient<MyServiceClient>('myservice');

    const result = await client.doSomething(input.input);

    return { result };
  },
};

export { myserviceDoSomethingTool };
```

### 4. Register the Service and Tools

Update `src/external/external.tools.ts`:

```typescript
import { myserviceDefinition, myserviceDoSomethingTool } from './myservice/index.ts';

const registerExternalServices = (registry: ExternalServiceRegistry): void => {
  registry.register(homeassistantDefinition);
  registry.register(myserviceDefinition);  // Add this
};

const registerExternalServiceTools = (toolRegistry: ToolRegistry): void => {
  toolRegistry.register(haCallServiceTool);
  toolRegistry.register(myserviceDoSomethingTool);  // Add this
};
```

### 5. Create Index File

Create `src/external/myservice/index.ts`:

```typescript
export type { MyServiceClient } from './myservice.ts';
export { myserviceDefinition } from './myservice.ts';
export { myserviceDoSomethingTool } from './myservice.tools.ts';
```

## Tool Filtering

Tools with `requiredServices` are automatically filtered based on service availability:

```typescript
// This tool is only available when Home Assistant is configured
const haCallServiceTool: ToolDefinition = {
  id: 'ha_call_service',
  requiredServices: ['homeassistant'],
  // ...
};

// This tool requires multiple services
const syncCalendarTool: ToolDefinition = {
  id: 'sync_calendar',
  requiredServices: ['homeassistant', 'google_calendar'],
  // ...
};
```

The filtering happens in the orchestrator before tools are passed to the LLM:

```typescript
// In orchestrator.ts
const tools = toLangChainToolsFiltered(
  this.#toolRegistry,
  toolContext,
  createServiceFilter(this.#externalServiceRegistry),
);
```

## Skills with Service Dependencies

Skills can also declare service dependencies:

```typescript
const mySkill: SkillDefinition = {
  id: 'smart-home',
  name: 'Smart Home Control',
  description: 'Control smart home devices',

  requiredServices: ['homeassistant'],

  activationRisk: 'medium',
  // ...
};
```

The skill's activation tool will only be available when the required services are configured.

## Testing

### Unit Tests

Test service definitions and tools without actual external connections:

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('MyService', () => {
  it('checks configuration correctly', () => {
    // Mock the config
    vi.mock('../../config/config.ts', () => ({
      getConfig: () => ({
        myservice: { apiKey: 'test-key', baseUrl: 'https://api.test.com' },
      }),
      isMyServiceConfigured: () => true,
    }));

    expect(myserviceDefinition.isConfigured()).toBe(true);
  });
});
```

### Integration Tests

For integration tests, use mocks or a test instance of the external service:

```typescript
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

const handlers = [
  http.post('https://api.myservice.com/action', () => {
    return HttpResponse.json({ result: 'success' });
  }),
];

const server = setupServer(...handlers);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

## Best Practices

1. **Keep clients stateless when possible**: Prefer creating fresh connections over maintaining persistent connections.

2. **Use lazy initialization**: Clients are created on first use and cached, avoiding connection overhead until needed.

3. **Handle disconnection gracefully**: Implement the `disconnect()` method to clean up resources.

4. **Use appropriate risk levels**:
   - `low`: Read-only operations
   - `medium`: Reversible modifications
   - `high`: Security-sensitive operations (locks, alarms)
   - `critical`: Irreversible or dangerous operations

5. **Provide good tool descriptions**: The LLM uses descriptions to decide when to use tools.

6. **Include examples**: Help users understand how to use the service.

## Troubleshooting

### Service Not Available

If a tool isn't available, check:
1. Environment variables are set correctly
2. The service is registered in `registerExternalServices()`
3. The tool is registered in `registerExternalServiceTools()`
4. The tool has correct `requiredServices` array

### Connection Errors

If connections fail:
1. Verify credentials are correct
2. Check network connectivity to the service
3. Review service-specific error messages in logs

### Client Caching Issues

Clients are cached for the lifetime of the service registry. To force reconnection:
1. Call `registry.disconnectClient(serviceId)`
2. The next `getClient()` call will create a fresh connection
