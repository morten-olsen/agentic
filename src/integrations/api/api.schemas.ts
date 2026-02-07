import { z } from 'zod';

// ============================================================================
// Health Check Response
// ============================================================================

const healthCheckResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  timestamp: z.string().datetime(),
  version: z.string().optional(),
});

type HealthCheckResponse = z.infer<typeof healthCheckResponseSchema>;

// ============================================================================
// Webhook Response
// ============================================================================

const webhookResponseSchema = z.object({
  received: z.boolean(),
  id: z.string().optional(),
});

type WebhookResponse = z.infer<typeof webhookResponseSchema>;

// ============================================================================
// Error Response
// ============================================================================

const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  statusCode: z.number(),
});

type ErrorResponse = z.infer<typeof errorResponseSchema>;

// ============================================================================
// Exports
// ============================================================================

export type { HealthCheckResponse, WebhookResponse, ErrorResponse };

export { healthCheckResponseSchema, webhookResponseSchema, errorResponseSchema };
