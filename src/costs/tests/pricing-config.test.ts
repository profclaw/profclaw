import { describe, it, expect } from 'vitest';
import { getModelPricing, calculateCost } from '../pricing.js';

// Uses the real config/pricing.yml (no mock).
describe('pricing.yml current Anthropic and local models', () => {
  it.each([
    ['claude-fable-5-1', 10, 50],
    ['claude-opus-5-5', 4, 20],
    ['claude-sonnet-5', 2, 10],
    ['claude-haiku-4-5-20251001', 1, 5],
  ])('%s has verified rates', (model, input, output) => {
    const p = getModelPricing(model);
    expect(p.provider).toBe('anthropic');
    expect(p.inputRate).toBe(input);
    expect(p.outputRate).toBe(output);
  });

  it('prices Gemma 4 via Ollama at zero', () => {
    expect(calculateCost('gemma4:e4b', 1_000_000, 1_000_000)).toBe(0);
  });
});
