import { describe, it, expect, vi } from 'vitest';
import { getModelPricing, calculateCost } from '../pricing.js';

vi.mock('../../utils/config-loader.js', () => ({
  loadConfig: vi.fn(() => ({
    pricing: {
      'gpt-4': { provider: 'openai', inputRate: 30, outputRate: 60 },
      'claude-3': { provider: 'anthropic', inputRate: 15, outputRate: 75 }
    },
    defaultPricing: { provider: 'other', inputRate: 10, outputRate: 30 }
  }))
}));

describe('Pricing Service', () => {
  it('should return exact match pricing', () => {
    const pricing = getModelPricing('gpt-4');
    expect(pricing.provider).toBe('openai');
    expect(pricing.inputRate).toBe(30);
  });

  it('should return partial match pricing', () => {
    const pricing = getModelPricing('claude-3-opus');
    expect(pricing.model).toBe('claude-3');
    expect(pricing.provider).toBe('anthropic');
  });

  it('should return default pricing if no match', () => {
    const pricing = getModelPricing('unknown-model');
    expect(pricing.model).toBe('default');
    expect(pricing.inputRate).toBe(10);
  });

  it('should calculate cost correctly', () => {
    // gpt-4: $30/1M input, $60/1M output
    // 100k input = $3.0, 50k output = $3.0. Total = $6.0
    const cost = calculateCost('gpt-4', 100000, 50000);
    expect(cost).toBe(6.0);
  });

  it('should round cost to 6 decimal places', () => {
    // 1 token input for gpt-4 = 30 / 1,000,000 = 0.00003
    const cost = calculateCost('gpt-4', 1, 0);
    expect(cost).toBe(0.00003);
  });
});
