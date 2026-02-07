import { z } from 'zod';

import type { ToolRegistry } from '../tools.ts';
import type { ToolDefinition } from '../tools.types.ts';
import { ArtifactService } from '../../../features/artifacts/artifacts.ts';

// ============================================================================
// get_artifact Tool
// ============================================================================

const getArtifactInputSchema = z.object({
  artifactId: z.string().describe('The artifact ID (starts with art_)'),
  metaOnly: z.boolean().default(false).describe('Return only metadata, not data'),
});

type GetArtifactInput = z.input<typeof getArtifactInputSchema>;

const getArtifactOutputSchema = z.object({
  artifact: z.object({
    id: z.string(),
    messageId: z.string(),
    type: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number(),
    expiresAt: z.string(),
  }),
  data: z.unknown().optional(),
  error: z.string().optional(),
});

type GetArtifactOutput = z.infer<typeof getArtifactOutputSchema>;

const getArtifactTool: ToolDefinition<z.infer<typeof getArtifactInputSchema>, GetArtifactOutput, GetArtifactInput> = {
  id: 'get_artifact',
  name: 'Get Artifact',
  description: `Retrieve an artifact's metadata or full data.

Artifacts store large data responses. Use this tool to:
- Get artifact metadata (type, size, expiration) with metaOnly=true
- Get the full artifact data with metaOnly=false (default)

For querying specific sections of artifact data, use domain-specific tools.`,

  category: 'utility',

  inputSchema: getArtifactInputSchema,
  outputSchema: getArtifactOutputSchema,

  risk: {
    level: 'low',
    reason: 'Read-only artifact access',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },

  tags: ['artifact', 'utility'],
  examples: [
    {
      input: { artifactId: 'art_123', metaOnly: true },
      description: 'Get artifact metadata only',
    },
    {
      input: { artifactId: 'art_123' },
      description: 'Get full artifact data',
    },
  ],

  execute: async (input, context) => {
    const artifactService = context.services.get(ArtifactService);

    const artifact = input.metaOnly
      ? await artifactService.getMeta(input.artifactId)
      : await artifactService.get(input.artifactId);

    if (!artifact) {
      return {
        artifact: {
          id: input.artifactId,
          messageId: '',
          type: '',
          mimeType: '',
          sizeBytes: 0,
          expiresAt: '',
        },
        error: 'Artifact not found or expired',
      };
    }

    // Update access time
    await artifactService.touch(input.artifactId);

    const result: GetArtifactOutput = {
      artifact: {
        id: artifact.id,
        messageId: artifact.messageId,
        type: artifact.type,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes,
        expiresAt: artifact.expiresAt,
      },
    };

    if (!input.metaOnly && 'data' in artifact && artifact.data !== null) {
      result.data = artifact.data;
    }

    return result;
  },
};

// ============================================================================
// list_artifacts Tool
// ============================================================================

const listArtifactsInputSchema = z.object({
  type: z.string().nullish().describe('Filter by artifact type'),
  messageId: z.string().nullish().describe('Filter by message ID'),
});

type ListArtifactsInput = z.input<typeof listArtifactsInputSchema>;

const listArtifactsOutputSchema = z.object({
  artifacts: z.array(
    z.object({
      id: z.string(),
      messageId: z.string(),
      type: z.string(),
      mimeType: z.string(),
      sizeBytes: z.number(),
      createdAt: z.string(),
      expiresAt: z.string(),
    }),
  ),
});

type ListArtifactsOutput = z.infer<typeof listArtifactsOutputSchema>;

const listArtifactsTool: ToolDefinition<
  z.infer<typeof listArtifactsInputSchema>,
  ListArtifactsOutput,
  ListArtifactsInput
> = {
  id: 'list_artifacts',
  name: 'List Artifacts',
  description: `List artifacts stored in the current conversation.

Use this to see what artifacts are available for exploration or reference.`,

  category: 'utility',

  inputSchema: listArtifactsInputSchema,
  outputSchema: listArtifactsOutputSchema,

  risk: {
    level: 'low',
    reason: 'Read-only list operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },

  tags: ['artifact', 'utility'],
  examples: [
    {
      input: {},
      description: 'List all artifacts in current conversation',
    },
    {
      input: { type: 'route_optimization' },
      description: 'List artifacts filtered by type',
    },
  ],

  execute: async (input, context) => {
    const artifactService = context.services.get(ArtifactService);
    const conversationId = context.conversationId;

    let artifacts = input.messageId
      ? await artifactService.getByMessage(input.messageId)
      : await artifactService.getMetaByConversation(conversationId);

    if (input.type) {
      artifacts = artifacts.filter((a) => a.type === input.type);
    }

    return {
      artifacts: artifacts.map((a) => ({
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

// ============================================================================
// Registration
// ============================================================================

/**
 * Registers artifact tools with the registry.
 */
const registerArtifactTools = (registry: ToolRegistry): void => {
  registry.register(getArtifactTool);
  registry.register(listArtifactsTool);
};

export type { GetArtifactInput, GetArtifactOutput, ListArtifactsInput, ListArtifactsOutput };
export { getArtifactTool, listArtifactsTool, registerArtifactTools };
