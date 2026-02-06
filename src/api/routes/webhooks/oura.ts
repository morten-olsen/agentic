import * as crypto from 'node:crypto';

import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';

import type { HealthService } from '../../../health/health.ts';
import type { OuraWebhookPayload } from '../../../external/oura/index.ts';
import { ouraWebhookPayloadSchema } from '../../../external/oura/index.ts';
import { normalizeOuraWebhook } from '../../../external/oura/oura.normalizer.ts';
import type { WebhookResponse } from '../../api.schemas.ts';

// ============================================================================
// Types
// ============================================================================

type OuraWebhookRouteOptions = {
  healthService: HealthService;
  webhookSecret: string;
};

// ============================================================================
// Errors
// ============================================================================

class WebhookSignatureError extends Error {
  statusCode = 401;

  constructor(message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

// ============================================================================
// Signature Verification
// ============================================================================

/**
 * Verifies the Oura webhook signature.
 */
const verifyOuraSignature = (body: string, signature: string | undefined, secret: string): boolean => {
  if (!signature) {
    return false;
  }

  // Oura sends signature as "sha256=<hex>"
  const providedSignature = signature.replace('sha256=', '');

  const expectedSignature = crypto.createHmac('sha256', secret).update(body).digest('hex');

  // Use timing-safe comparison
  try {
    return crypto.timingSafeEqual(Buffer.from(expectedSignature, 'hex'), Buffer.from(providedSignature, 'hex'));
  } catch {
    // Buffer lengths don't match
    return false;
  }
};

// ============================================================================
// Routes
// ============================================================================

/**
 * Registers Oura webhook routes.
 */
const registerOuraWebhookRoutes: FastifyPluginCallback<OuraWebhookRouteOptions> = (
  fastify: FastifyInstance,
  opts,
  done,
): void => {
  const { healthService, webhookSecret } = opts;

  // Add raw body parser for signature verification
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  // POST /api/v1/webhooks/oura - Receive Oura webhook
  fastify.post('/oura', async (request: FastifyRequest, reply: FastifyReply): Promise<WebhookResponse> => {
    const rawBody = request.body as string;
    const signature = request.headers['x-oura-signature'] as string | undefined;

    // Verify signature
    if (!verifyOuraSignature(rawBody, signature, webhookSecret)) {
      throw new WebhookSignatureError('Invalid webhook signature');
    }

    // Parse the body
    let payload: OuraWebhookPayload;
    try {
      const parsed = JSON.parse(rawBody);
      payload = ouraWebhookPayloadSchema.parse(parsed);
    } catch {
      reply.status(400);
      return { received: false };
    }

    // Respond quickly (Oura expects fast responses)
    // Process asynchronously after sending response
    setImmediate(async () => {
      try {
        // Normalize Oura data to generic health record
        const normalizedRecord = normalizeOuraWebhook(payload);

        if (!normalizedRecord) {
          console.log(`Unsupported Oura data type: ${payload.data_type}`);
          return;
        }

        // Handle based on event type
        switch (payload.event_type) {
          case 'create':
            await healthService.ingestRecord(normalizedRecord);
            console.log(`Health record ingested: ${normalizedRecord.type} for ${normalizedRecord.date}`);
            break;
          case 'update':
            await healthService.updateRecord(normalizedRecord);
            console.log(`Health record updated: ${normalizedRecord.type} for ${normalizedRecord.date}`);
            break;
          case 'delete':
            await healthService.deleteRecordByExternalId('oura', normalizedRecord.externalId, normalizedRecord.type);
            console.log(`Health record deleted: ${normalizedRecord.type} - ${normalizedRecord.externalId}`);
            break;
        }
      } catch (err) {
        console.error('Failed to process Oura webhook:', err);
      }
    });

    return { received: true };
  });

  done();
};

// ============================================================================
// Exports
// ============================================================================

export { registerOuraWebhookRoutes, verifyOuraSignature, WebhookSignatureError };
