import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkBudget, setBudget, getBudgetStatus } from '../budget.js';
import { getUsageSummary } from '../token-tracker.js';

vi.mock('../../utils/config-loader.js', () => ({
  loadConfig: vi.fn(() => ({
    budget: { dailyLimit: 10, monthlyLimit: 100 },
    alerts: { thresholds: [50, 80, 100] }
  }))
}));

vi.mock('../token-tracker.js', () => ({
  getUsageSummary: vi.fn(),
}));

describe('Budget Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default mock for usage summary
    (getUsageSummary as any).mockReturnValue({ totalCost: 0 });
    setBudget({}); // Reset alerts
  });

  it('should report not exceeded when under limit', () => {
    (getUsageSummary as any).mockReturnValue({ totalCost: 5 });
    const status = checkBudget();
    expect(status.exceeded).toBe(false);
    expect(status.thresholds).toContain(50);
  });

  it('should report exceeded when over limit', () => {
    (getUsageSummary as any).mockReturnValue({ totalCost: 11 });
    const status = checkBudget();
    expect(status.exceeded).toBe(true);
    expect(status.thresholds).toContain(100);
  });

  it('should only trigger alerts once', () => {
    (getUsageSummary as any).mockReturnValue({ totalCost: 5.1 });
    const firstCheck = checkBudget();
    expect(firstCheck.thresholds).toContain(50);
    
    const secondCheck = checkBudget();
    expect(secondCheck.thresholds).not.toContain(50);
  });

  it('should allow updating budget config', () => {
    setBudget({ dailyLimit: 20 });
    (getUsageSummary as any).mockReturnValue({ totalCost: 15 });
    
    const status = getBudgetStatus();
    expect(status.isExceeded).toBe(false);
    expect(status.config.dailyLimit).toBe(20);
  });

  it('should reset triggered alerts when budget is set', () => {
    (getUsageSummary as any).mockReturnValue({ totalCost: 5.1 });
    checkBudget(); // Triggers 50% alert
    
    setBudget({ dailyLimit: 10 }); // Resets triggeredAlerts
    
    const checkAfterReset = checkBudget();
    expect(checkAfterReset.thresholds).toContain(50); // Should trigger again
  });
});
