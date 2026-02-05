import { z } from 'zod';

/**
 * MIME types supported for artifacts.
 */
const artifactMimeTypeSchema = z.enum([
  'application/json',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/csv',
  'text/plain',
]);

type ArtifactMimeType = z.infer<typeof artifactMimeTypeSchema>;

/**
 * Artifact schema - represents a stored artifact.
 */
const artifactSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  messageId: z.string(),
  type: z.string(),
  mimeType: artifactMimeTypeSchema,

  // Data storage
  data: z.unknown(),

  // Metadata
  sizeBytes: z.number(),
  summaryProvided: z.boolean(),

  // Lifecycle
  ttlMinutes: z.number(),
  createdAt: z.string(),
  expiresAt: z.string(),
  accessedAt: z.string(),
});

type Artifact = z.infer<typeof artifactSchema>;

/**
 * Artifact metadata (without data) for list operations.
 */
const artifactMetaSchema = artifactSchema.omit({ data: true });

type ArtifactMeta = z.infer<typeof artifactMetaSchema>;

/**
 * Input for creating an artifact.
 */
const createArtifactInputSchema = z.object({
  conversationId: z.string(),
  messageId: z.string(),
  type: z.string(),
  data: z.unknown(),
  mimeType: artifactMimeTypeSchema.optional().default('application/json'),
  ttlMinutes: z.number().optional().default(60),
  summaryProvided: z.boolean().optional().default(false),
});

type CreateArtifactInput = z.input<typeof createArtifactInputSchema>;

/**
 * Result from creating an artifact.
 */
const createArtifactResultSchema = z.object({
  id: z.string(),
  expiresAt: z.string(),
});

type CreateArtifactResult = z.infer<typeof createArtifactResultSchema>;

/**
 * Database row schema for artifacts.
 */
const artifactRowSchema = z.object({
  id: z.string(),
  conversation_id: z.string(),
  message_id: z.string(),
  type: z.string(),
  mime_type: z.string(),
  data: z.string().nullable(),
  size_bytes: z.number(),
  summary_provided: z.number(), // SQLite boolean (0 or 1)
  ttl_minutes: z.number(),
  created_at: z.string(),
  expires_at: z.string(),
  accessed_at: z.string(),
});

type ArtifactRow = z.infer<typeof artifactRowSchema>;

/**
 * Converts a database row to an Artifact.
 */
const rowToArtifact = (row: ArtifactRow): Artifact => {
  let data: unknown = null;
  if (row.data) {
    // For JSON, parse the data; for other types, keep as-is (base64 string)
    if (row.mime_type === 'application/json') {
      try {
        data = JSON.parse(row.data);
      } catch {
        data = row.data;
      }
    } else {
      data = row.data;
    }
  }

  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    type: row.type,
    mimeType: row.mime_type as ArtifactMimeType,
    data,
    sizeBytes: row.size_bytes,
    summaryProvided: row.summary_provided === 1,
    ttlMinutes: row.ttl_minutes,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    accessedAt: row.accessed_at,
  };
};

/**
 * Converts a database row to ArtifactMeta (without data).
 */
const rowToArtifactMeta = (row: ArtifactRow): ArtifactMeta => {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    type: row.type,
    mimeType: row.mime_type as ArtifactMimeType,
    sizeBytes: row.size_bytes,
    summaryProvided: row.summary_provided === 1,
    ttlMinutes: row.ttl_minutes,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    accessedAt: row.accessed_at,
  };
};

export type { ArtifactMimeType, Artifact, ArtifactMeta, CreateArtifactInput, CreateArtifactResult, ArtifactRow };

export {
  artifactMimeTypeSchema,
  artifactSchema,
  artifactMetaSchema,
  createArtifactInputSchema,
  createArtifactResultSchema,
  artifactRowSchema,
  rowToArtifact,
  rowToArtifactMeta,
};
