/**
 * Model Capability Detection
 *
 * Maps AI model IDs to capability levels for adaptive tool selection
 * and prompt generation. Enables profClaw to work well with any model,
 * not just expensive frontier models.
 */

import type { ModelCapabilityLevel, ToolTier } from './types.js';

/**
 * Ordered pattern list: more-specific patterns first.
 * Each entry maps a regex to a capability level.
 * Using regex instead of substring matching avoids ambiguity
 * (e.g. 'gpt-4o' matching 'gpt-4o-mini').
 */
const MODEL_CAPABILITY_PATTERNS: Array<{ pattern: RegExp; capability: ModelCapabilityLevel }> = [
  // --- Instruction models (check specific variants before broad families) ---
  { pattern: /gpt-4o-mini/i, capability: 'instruction' },
  { pattern: /claude-haiku|claude-3-haiku/i, capability: 'instruction' },
  { pattern: /gemini-[\d.]+-flash(?!-thinking)|gemini-flash/i, capability: 'instruction' },
  { pattern: /llama-?3\.1-8b|llama-?3\.2|llama3\.2/i, capability: 'instruction' },
  { pattern: /mixtral-8x(7|22)b/i, capability: 'instruction' },
  { pattern: /mistral-medium/i, capability: 'instruction' },
  { pattern: /command-r(?!-plus)/i, capability: 'instruction' },
  { pattern: /qwen-plus|qwen-turbo|qwen2\.5[:\-]14b|qwen2\.5[:\-]7b/i, capability: 'instruction' },
  { pattern: /glm-4-air|glm-4-flashx|glm-4\.7-flash/i, capability: 'instruction' },
  { pattern: /moonshot-v1-(32|8)k/i, capability: 'instruction' },
  { pattern: /doubao-pro|ernie-bot-4/i, capability: 'instruction' },
  { pattern: /phi-?[34]/i, capability: 'instruction' },
  { pattern: /granite/i, capability: 'instruction' },

  // --- Reasoning models ---
  { pattern: /claude-opus|claude-sonnet|claude-3\.5|claude-4/i, capability: 'reasoning' },
  { pattern: /gpt-4o|gpt-4-turbo|gpt-4\.5/i, capability: 'reasoning' },
  { pattern: /\bo[13]-/i, capability: 'reasoning' },
  { pattern: /gemini-[\d.]+-pro/i, capability: 'reasoning' },
  { pattern: /grok-[23]/i, capability: 'reasoning' },
  { pattern: /mistral-large|codestral/i, capability: 'reasoning' },
  { pattern: /command-r-plus/i, capability: 'reasoning' },
  { pattern: /deepseek-chat|deepseek-reasoner|deepseek-r1/i, capability: 'reasoning' },
  { pattern: /llama-?3\.3-70b|llama-?3\.1-405b/i, capability: 'reasoning' },
  { pattern: /qwen-max|qwen2\.5[:\-]72b/i, capability: 'reasoning' },
  { pattern: /glm-(4-plus|5|4\.7\b)/i, capability: 'reasoning' },
  { pattern: /moonshot-v1-128k/i, capability: 'reasoning' },
];

/**
 * Detect model capability level from model ID string.
 * Matches against known model family patterns (ordered most-specific first).
 */
export function detectModelCapability(modelId: string): ModelCapabilityLevel {
  for (const entry of MODEL_CAPABILITY_PATTERNS) {
    if (entry.pattern.test(modelId)) {
      return entry.capability;
    }
  }

  return 'basic';
}

/**
 * Get the recommended tool tier for a model capability level.
 * - basic models get essential tools only (prevents confusion)
 * - instruction models get standard tools
 * - reasoning models get full tool access
 */
export function getRecommendedTier(capability: ModelCapabilityLevel): ToolTier {
  switch (capability) {
    case 'basic':
      return 'essential';
    case 'instruction':
      return 'standard';
    case 'reasoning':
      return 'full';
  }
}

/**
 * Get the recommended max tool schema tokens for a capability level.
 * Small models have smaller context windows - don't waste tokens on tool schemas.
 */
export function getMaxSchemaTokens(capability: ModelCapabilityLevel): number {
  switch (capability) {
    case 'basic':
      return 2000;   // ~8 essential tools
    case 'instruction':
      return 6000;   // ~25-30 standard tools
    case 'reasoning':
      return 20000;  // All tools
  }
}

/**
 * Convenience: detect capability and return full routing recommendation.
 */
export function getModelRouting(modelId: string): {
  capability: ModelCapabilityLevel;
  tier: ToolTier;
  maxSchemaTokens: number;
} {
  const capability = detectModelCapability(modelId);
  return {
    capability,
    tier: getRecommendedTier(capability),
    maxSchemaTokens: getMaxSchemaTokens(capability),
  };
}
