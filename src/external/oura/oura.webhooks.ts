import type { HealthService } from '../../health/health.ts';

import type { OuraClient, OuraSubscription, OuraDataType } from './index.ts';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Data types to subscribe to for health tracking.
 */
const SUBSCRIBED_DATA_TYPES: OuraDataType[] = [
  'daily_sleep',
  'sleep',
  'daily_activity',
  'daily_readiness',
  'daily_stress',
  'daily_spo2',
  'workout',
];

/**
 * Event types to subscribe to.
 */
const EVENT_TYPES = ['create', 'update', 'delete'] as const;

// ============================================================================
// Types
// ============================================================================

type OuraWebhookManagerDeps = {
  client: OuraClient;
  healthService: HealthService;
  apiPublicUrl: string;
};

type SubscriptionSetupResult = {
  created: number;
  skipped: number;
  failed: number;
  errors: string[];
};

// ============================================================================
// OuraWebhookManager
// ============================================================================

/**
 * Manages Oura webhook subscriptions.
 *
 * On startup, checks if subscriptions exist and creates them if needed.
 * Also handles subscription renewal since Oura webhooks expire.
 */
class OuraWebhookManager {
  #client: OuraClient;
  #healthService: HealthService;
  #callbackUrl: string;

  constructor(deps: OuraWebhookManagerDeps) {
    this.#client = deps.client;
    this.#healthService = deps.healthService;
    this.#callbackUrl = `${deps.apiPublicUrl}/api/v1/webhooks/oura`;
  }

  /**
   * Ensures webhook subscriptions are set up.
   * Called on startup to verify/create subscriptions.
   */
  ensureSubscriptions = async (): Promise<SubscriptionSetupResult> => {
    const result: SubscriptionSetupResult = {
      created: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    try {
      // Get current subscription state from database
      const state = await this.#healthService.getWebhookState('oura');

      // List existing subscriptions from Oura API
      const existingSubscriptions = await this.#client.listSubscriptions();

      // Find subscriptions that match our callback URL
      const ourSubscriptions = existingSubscriptions.filter((sub) => sub.callback_url === this.#callbackUrl);

      // Build a set of existing type+event combinations
      const existingSet = new Set(ourSubscriptions.map((sub) => `${sub.data_type}:${sub.event_type}`));

      // Create missing subscriptions
      for (const dataType of SUBSCRIBED_DATA_TYPES) {
        for (const eventType of EVENT_TYPES) {
          const key = `${dataType}:${eventType}`;

          if (existingSet.has(key)) {
            result.skipped++;
            continue;
          }

          try {
            await this.#client.createSubscription({
              callback_url: this.#callbackUrl,
              data_type: dataType,
              event_type: eventType,
            });
            result.created++;
          } catch (error) {
            result.failed++;
            result.errors.push(
              `Failed to create ${dataType}/${eventType}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }

      // Update webhook state in database
      const subscribedTypes = SUBSCRIBED_DATA_TYPES;
      const now = new Date().toISOString();

      // Find the earliest expiration among our subscriptions
      let earliestExpiration: string | null = null;
      for (const sub of ourSubscriptions) {
        if (sub.expiration_time) {
          if (!earliestExpiration || sub.expiration_time < earliestExpiration) {
            earliestExpiration = sub.expiration_time;
          }
        }
      }

      await this.#healthService.updateWebhookState({
        id: 'oura',
        subscriptionId: ourSubscriptions[0]?.id ?? null,
        subscribedTypes,
        callbackUrl: this.#callbackUrl,
        expiresAt: earliestExpiration,
        lastEventAt: state?.lastEventAt ?? null,
        status: result.failed === 0 ? 'active' : 'error',
        errorMessage: result.errors.length > 0 ? result.errors.join('; ') : null,
        createdAt: state?.createdAt ?? now,
        updatedAt: now,
      });

      return result;
    } catch (error) {
      result.failed++;
      result.errors.push(`Failed to ensure subscriptions: ${error instanceof Error ? error.message : String(error)}`);

      // Mark state as error
      await this.#healthService.updateWebhookState({
        id: 'oura',
        subscriptionId: null,
        subscribedTypes: [],
        callbackUrl: this.#callbackUrl,
        expiresAt: null,
        lastEventAt: null,
        status: 'error',
        errorMessage: result.errors.join('; '),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      return result;
    }
  };

  /**
   * Renews all subscriptions that are about to expire.
   * Should be called periodically (e.g., daily).
   */
  renewExpiringSubscriptions = async (): Promise<number> => {
    const subscriptions = await this.#client.listSubscriptions();
    const now = new Date();
    const renewalThreshold = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

    let renewed = 0;

    for (const sub of subscriptions) {
      if (sub.callback_url !== this.#callbackUrl) continue;
      if (!sub.expiration_time) continue;

      const expiresAt = new Date(sub.expiration_time);
      if (expiresAt <= renewalThreshold) {
        try {
          await this.#client.renewSubscription(sub.id);
          renewed++;
        } catch (error) {
          console.error(`Failed to renew subscription ${sub.id}:`, error);
        }
      }
    }

    return renewed;
  };

  /**
   * Lists all current subscriptions.
   */
  listSubscriptions = async (): Promise<OuraSubscription[]> => {
    return this.#client.listSubscriptions();
  };

  /**
   * Gets the callback URL for webhooks.
   */
  get callbackUrl(): string {
    return this.#callbackUrl;
  }
}

// ============================================================================
// Exports
// ============================================================================

export type { SubscriptionSetupResult };
export { OuraWebhookManager, SUBSCRIBED_DATA_TYPES, EVENT_TYPES };
