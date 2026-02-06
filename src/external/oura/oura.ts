import { getConfig, isOuraConfigured } from '../../config/config.ts';
import type { ExternalServiceDefinition, ServiceClient } from '../external.schemas.ts';

import type {
  OuraSubscription,
  CreateSubscriptionInput,
  OuraSleepData,
  OuraDailyActivityData,
  OuraDailyReadinessData,
} from './oura.schemas.ts';

// ============================================================================
// Types
// ============================================================================

/**
 * Oura API client interface.
 */
type OuraClient = ServiceClient & {
  /**
   * Lists all webhook subscriptions.
   */
  listSubscriptions: () => Promise<OuraSubscription[]>;

  /**
   * Creates a new webhook subscription.
   */
  createSubscription: (input: CreateSubscriptionInput) => Promise<OuraSubscription>;

  /**
   * Deletes a webhook subscription.
   */
  deleteSubscription: (id: string) => Promise<void>;

  /**
   * Renews a webhook subscription.
   */
  renewSubscription: (id: string) => Promise<OuraSubscription>;

  /**
   * Gets daily sleep data for a date range.
   */
  getDailySleep: (startDate: string, endDate: string) => Promise<OuraSleepData[]>;

  /**
   * Gets daily activity data for a date range.
   */
  getDailyActivity: (startDate: string, endDate: string) => Promise<OuraDailyActivityData[]>;

  /**
   * Gets daily readiness data for a date range.
   */
  getDailyReadiness: (startDate: string, endDate: string) => Promise<OuraDailyReadinessData[]>;
};

// ============================================================================
// API Helpers
// ============================================================================

const OURA_API_BASE = 'https://api.ouraring.com/v2';

/**
 * Makes an authenticated request to the Oura API.
 */
const ouraFetch = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const config = getConfig();

  // Use personal access token for API requests
  // Note: For webhook management, you may need OAuth2 client credentials
  const response = await fetch(`${OURA_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.oura.clientSecret}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Oura API error: ${response.status} ${error}`);
  }

  return response.json() as Promise<T>;
};

// ============================================================================
// Service Definition
// ============================================================================

/**
 * Oura Ring external service definition.
 */
const ouraDefinition: ExternalServiceDefinition = {
  id: 'oura',
  name: 'Oura Ring',
  description: 'Health and wellness data from Oura Ring',

  isConfigured: isOuraConfigured,

  createClient: async (): Promise<OuraClient> => {
    return {
      listSubscriptions: async (): Promise<OuraSubscription[]> => {
        const response = await ouraFetch<{ data: OuraSubscription[] }>('/webhook/subscription');
        return response.data ?? [];
      },

      createSubscription: async (input: CreateSubscriptionInput): Promise<OuraSubscription> => {
        const response = await ouraFetch<OuraSubscription>('/webhook/subscription', {
          method: 'POST',
          body: JSON.stringify(input),
        });
        return response;
      },

      deleteSubscription: async (id: string): Promise<void> => {
        await ouraFetch(`/webhook/subscription/${id}`, { method: 'DELETE' });
      },

      renewSubscription: async (id: string): Promise<OuraSubscription> => {
        const response = await ouraFetch<OuraSubscription>(`/webhook/subscription/renew/${id}`, {
          method: 'PUT',
        });
        return response;
      },

      getDailySleep: async (startDate: string, endDate: string): Promise<OuraSleepData[]> => {
        const response = await ouraFetch<{ data: OuraSleepData[] }>(
          `/usercollection/sleep?start_date=${startDate}&end_date=${endDate}`,
        );
        return response.data ?? [];
      },

      getDailyActivity: async (startDate: string, endDate: string): Promise<OuraDailyActivityData[]> => {
        const response = await ouraFetch<{ data: OuraDailyActivityData[] }>(
          `/usercollection/daily_activity?start_date=${startDate}&end_date=${endDate}`,
        );
        return response.data ?? [];
      },

      getDailyReadiness: async (startDate: string, endDate: string): Promise<OuraDailyReadinessData[]> => {
        const response = await ouraFetch<{ data: OuraDailyReadinessData[] }>(
          `/usercollection/daily_readiness?start_date=${startDate}&end_date=${endDate}`,
        );
        return response.data ?? [];
      },

      disconnect: async (): Promise<void> => {
        // No persistent connection to clean up
      },
    };
  },
};

// ============================================================================
// Exports
// ============================================================================

export type { OuraClient };
export { ouraDefinition };
