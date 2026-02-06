import { loadConfig } from '../utils/config-loader.js';

export interface ModelPricing {
  model: string;
  provider: 'anthropic' | 'openai' | 'google' | 'meta' | 'other';
  inputRate: number;  // Price per 1M tokens
  outputRate: number; // Price per 1M tokens
}

interface PricingYaml {
  pricing: Record<string, Omit<ModelPricing, 'model'>>;
  defaultPricing: Omit<ModelPricing, 'model'>;
}

// Load dynamic config
const pricingConfig = loadConfig<PricingYaml>('pricing.yml');

/**
 * Get pricing for a given model
 * Fallback to a default if not found
 */
export function getModelPricing(model: string): ModelPricing {
  const models = pricingConfig.pricing || {};
  
  // Try exact match
  if (models[model]) {
    return { ...models[model], model };
  }

  // Try partial match (e.g., if model has version suffix)
  const key = Object.keys(models).find(k => model.startsWith(k));
  if (key) {
    return { ...models[key], model: key };
  }

  // Fallback
  return {
    ...(pricingConfig.defaultPricing || {
      provider: 'other',
      inputRate: 5.00,
      outputRate: 15.00,
    }),
    model: 'default',
  };
}

/**
 * Calculate cost for token usage
 */
export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = getModelPricing(model);
  const inputCost = (inputTokens / 1_000_000) * pricing.inputRate;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputRate;
  
  // Return rounded to 6 decimal places
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}
