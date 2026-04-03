/**
 * Built-in Hook: Cost Warning
 *
 * Fires on `onBudgetWarning` at 50%, 80%, and 100% of budget usage.
 * At 100%, sets proceed: false to stop execution.
 */

import { createContextualLogger } from '../../utils/logger.js';
import type { Hook, HookContext, HookResult } from '../registry.js';

const log = createContextualLogger('CostWarningHook');

const WARNING_THRESHOLDS = [0.5, 0.8, 1.0] as const;
type WarningThreshold = (typeof WARNING_THRESHOLDS)[number];

function getThresholdLabel(t: WarningThreshold): string {
  return `${Math.round(t * 100)}%`;
}

function crossedThreshold(
  previousRatio: number,
  currentRatio: number,
  threshold: WarningThreshold,
): boolean {
  return previousRatio < threshold && currentRatio >= threshold;
}

export const costWarningHook: Hook = {
  name: 'built-in:cost-warning',
  point: 'onBudgetWarning',
  priority: 10,
  handler: async (context: HookContext): Promise<HookResult> => {
    const { budgetUsed, budgetMax, metadata } = context;

    if (budgetUsed === undefined || budgetMax === undefined || budgetMax <= 0) {
      return { proceed: true };
    }

    const currentRatio = budgetUsed / budgetMax;
    const previousRatio =
      typeof metadata.previousBudgetRatio === 'number' ? metadata.previousBudgetRatio : 0;

    // Hard stop at 100%
    if (currentRatio >= 1.0) {
      log.warn('Budget exhausted — stopping execution', {
        budgetUsed,
        budgetMax,
        percentUsed: '100%',
        sessionId: context.sessionId,
      });
      return {
        proceed: false,
        metadata: { previousBudgetRatio: currentRatio, budgetExhausted: true },
      };
    }

    // Warn at soft thresholds (50%, 80%)
    for (const threshold of WARNING_THRESHOLDS) {
      if (crossedThreshold(previousRatio, currentRatio, threshold)) {
        log.warn(`Budget warning: ${getThresholdLabel(threshold)} of limit used`, {
          budgetUsed,
          budgetMax,
          threshold: getThresholdLabel(threshold),
          sessionId: context.sessionId,
        });
        break;
      }
    }

    return {
      proceed: true,
      metadata: { previousBudgetRatio: currentRatio },
    };
  },
};

export default costWarningHook;
