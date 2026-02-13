import type { Services } from '../../core/services/services.ts';

import { BehavioralMemoryService } from './behavioral.ts';

type MaintenanceResult = {
  decayedTemplates: number;
  expiredPendingOutcomes: number;
  retiredTemplates: number;
};

/**
 * Runs behavioral memory maintenance tasks:
 * 1. Apply activation decay to all active templates
 * 2. Expire stale pending outcomes (record as neutral)
 * 3. Retire consistently poor templates
 */
const runBehavioralMaintenance = async (services: Services): Promise<MaintenanceResult> => {
  const behavioralService = services.get(BehavioralMemoryService);

  // 1. Decay activation on unmatched templates
  const decayedTemplates = await behavioralService.applyActivationDecay();

  // 2. Expire stale pending outcomes (no feedback within window)
  const expired = await behavioralService.expireAndRecordPendingOutcomes();

  // 3. Retire consistently poor templates
  const retired = await behavioralService.retirePoorTemplates();

  return {
    decayedTemplates,
    expiredPendingOutcomes: expired.length,
    retiredTemplates: retired.length,
  };
};

export type { MaintenanceResult };
export { runBehavioralMaintenance };
