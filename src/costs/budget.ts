import { getUsageSummary } from './token-tracker.js';
import { logger } from '../utils/logger.js';
import { loadConfig } from '../utils/config-loader.js';

export interface BudgetConfig {
  dailyLimit: number;
  monthlyLimit: number;
  alerts: number[]; // Percentages to alert at (e.g., [50, 80, 90, 100])
}

interface BudgetYaml {
  budget: {
    dailyLimit: number;
    monthlyLimit: number;
  };
  alerts: {
    thresholds: number[];
  };
}

// Load dynamic config
const budgetYaml = loadConfig<BudgetYaml>('budget.yml');

let currentBudget: BudgetConfig = {
  dailyLimit: parseFloat(process.env.DAILY_BUDGET_LIMIT || '') || budgetYaml.budget?.dailyLimit || 50.00,
  monthlyLimit: parseFloat(process.env.MONTHLY_BUDGET_LIMIT || '') || budgetYaml.budget?.monthlyLimit || 500.00,
  alerts: budgetYaml.alerts?.thresholds || [50, 80, 90, 100],
};

const triggeredAlerts = new Set<string>();

/**
 * Check if the budget has been exceeded or alert thresholds hit
 */
export function checkBudget(): {
  exceeded: boolean;
  thresholds: number[];
} {
  const summary = getUsageSummary();
  const dailyPercent = (summary.totalCost / currentBudget.dailyLimit) * 100;
  
  const hitThresholds: number[] = [];
  
  for (const threshold of currentBudget.alerts) {
    const alertKey = `daily-${threshold}`;
    if (dailyPercent >= threshold && !triggeredAlerts.has(alertKey)) {
      hitThresholds.push(threshold);
      triggeredAlerts.add(alertKey);
      
      logger.warn(`Budget alert: Daily limit hit ${threshold}%`, {
        currentCost: summary.totalCost.toFixed(6),
        limit: currentBudget.dailyLimit,
        percentage: dailyPercent.toFixed(2),
      });
    }
  }

  return {
    exceeded: summary.totalCost >= currentBudget.dailyLimit,
    thresholds: hitThresholds,
  };
}

/**
 * Set a new budget configuration
 */
export function setBudget(config: Partial<BudgetConfig>): void {
  currentBudget = { ...currentBudget, ...config };
  triggeredAlerts.clear(); // Reset alerts when budget changes
}

/**
 * Get current budget configuration and status
 */
export function getBudgetStatus() {
  const summary = getUsageSummary();
  return {
    config: currentBudget,
    currentUsage: {
      daily: summary.totalCost,
      dailyPercent: ((summary.totalCost / currentBudget.dailyLimit) * 100).toFixed(2),
    },
    isExceeded: summary.totalCost >= currentBudget.dailyLimit,
  };
}
