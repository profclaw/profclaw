/**
 * Failover Types
 *
 * Type definitions for the provider failover system.
 * Based on OpenClaw's sophisticated error handling patterns.
 */

/**
 * Reasons why a provider request might fail that warrant trying a fallback.
 * - auth: Invalid API key, expired token, authentication failure
 * - format: Invalid request format, malformed parameters
 * - rate_limit: Rate limited or quota exceeded (includes overloaded)
 * - billing: Payment required, insufficient credits
 * - timeout: Request timeout, connection timeout
 * - unknown: Unknown error that still warrants fallback
 */
export type FailoverReason = 'auth' | 'format' | 'rate_limit' | 'billing' | 'timeout' | 'unknown';

/**
 * Record of a fallback attempt
 */
export interface FallbackAttempt {
  provider: string;
  model: string;
  error: string;
  reason?: FailoverReason;
  status?: number;
  code?: string;
  skippedDueToCooldown?: boolean;
}

/**
 * Result of running with model fallback
 */
export interface ModelFallbackResult<T> {
  result: T;
  provider: string;
  model: string;
  attempts: FallbackAttempt[];
}

/**
 * Provider cooldown entry
 */
export interface ProviderCooldown {
  provider: string;
  reason: FailoverReason;
  cooldownUntil: number;
  lastError: string;
}
