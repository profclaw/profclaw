/**
 * Provider Failover System
 *
 * Exports for the comprehensive provider failover system.
 * Based on OpenClaw's sophisticated error handling and fallback patterns.
 */

// Types
export type { FailoverReason, FallbackAttempt, ModelFallbackResult, ProviderCooldown } from './types.js';

// Error utilities
export {
  FailoverError,
  isFailoverError,
  resolveFailoverStatus,
  isTimeoutError,
  classifyFailoverReason,
  resolveFailoverReasonFromError,
  describeFailoverError,
  coerceToFailoverError,
  shouldRethrowWithoutFallback,
  getUserFriendlyErrorMessage,
} from './error.js';

// Model fallback
export {
  runWithModelFallback,
  runWithFallback,
  buildFallbackCandidates,
  isProviderInCooldown,
  getProviderCooldownRemaining,
  setProviderCooldown,
  clearProviderCooldown,
  getProvidersInCooldown,
  type ModelResolver,
} from './model-fallback.js';
