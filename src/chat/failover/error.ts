/**
 * Failover Error System
 *
 * Error classification and FailoverError class for provider failover.
 * Based on OpenClaw's sophisticated error handling patterns.
 */

import type { FailoverReason } from './types.js';

// =============================================================================
// Error Detection Patterns
// =============================================================================

const TIMEOUT_HINT_RE = /timeout|timed out|deadline exceeded|context deadline exceeded/i;
const ABORT_TIMEOUT_RE = /request was aborted|request aborted/i;

/**
 * Error patterns for classifying errors by type.
 * These patterns are used to determine if an error is recoverable via fallback.
 */
const ERROR_PATTERNS = {
  rateLimit: [
    /rate[_ ]limit/i,
    /too many requests/i,
    /429/,
    /exceeded your current quota/i,
    /resource has been exhausted/i,
    /quota exceeded/i,
    /resource_exhausted/i,
    /usage limit/i,
    /overloaded/i,
    /overloaded_error/i,
    /capacity/i,
  ],
  timeout: [
    /timeout/i,
    /timed out/i,
    /deadline exceeded/i,
    /context deadline exceeded/i,
    /ETIMEDOUT/,
    /ESOCKETTIMEDOUT/,
    /ECONNRESET/,
    /ECONNABORTED/,
  ],
  billing: [
    /402/,
    /payment required/i,
    /insufficient credits/i,
    /credit balance/i,
    /plans & billing/i,
    /billing/i,
    /upgrade.*plan/i,
  ],
  auth: [
    /invalid[_ ]?api[_ ]?key/i,
    /incorrect api key/i,
    /invalid token/i,
    /authentication/i,
    /re-authenticate/i,
    /oauth token refresh failed/i,
    /unauthorized/i,
    /forbidden/i,
    /access denied/i,
    /expired/i,
    /token has expired/i,
    /401/,
    /403/,
    /no credentials found/i,
    /no api key found/i,
    /api.*key.*invalid/i,
  ],
  format: [
    /string should match pattern/i,
    /tool_use\.id/i,
    /tool_use_id/i,
    /invalid request format/i,
    /invalid_request_error/i,
    /malformed/i,
  ],
  deployment: [
    /deployment.*does not exist/i,
    /deployment.*not found/i,
    /model.*not found/i,
    /model.*does not exist/i,
    /resource.*not found/i,
    /endpoint.*not found/i,
  ],
  connection: [
    /ECONNREFUSED/,
    /ENOTFOUND/,
    /EHOSTUNREACH/,
    /endpoint.*not.*reachable/i,
    /503.*service.*unavailable/i,
    /502.*bad.*gateway/i,
    /504.*gateway.*timeout/i,
    /network.*error/i,
    /fetch failed/i,
  ],
} as const;

// =============================================================================
// FailoverError Class
// =============================================================================

/**
 * Error class that includes failover metadata.
 * Used to track and propagate error context through the fallback chain.
 */
export class FailoverError extends Error {
  readonly reason: FailoverReason;
  readonly provider?: string;
  readonly model?: string;
  readonly status?: number;
  readonly code?: string;

  constructor(
    message: string,
    params: {
      reason: FailoverReason;
      provider?: string;
      model?: string;
      status?: number;
      code?: string;
      cause?: unknown;
    }
  ) {
    super(message, { cause: params.cause });
    this.name = 'FailoverError';
    this.reason = params.reason;
    this.provider = params.provider;
    this.model = params.model;
    this.status = params.status;
    this.code = params.code;
  }
}

// =============================================================================
// Error Classification Functions
// =============================================================================

/**
 * Check if an error is a FailoverError
 */
export function isFailoverError(err: unknown): err is FailoverError {
  return err instanceof FailoverError;
}

/**
 * Resolve HTTP status code from failover reason
 */
export function resolveFailoverStatus(reason: FailoverReason): number | undefined {
  switch (reason) {
    case 'billing':
      return 402;
    case 'rate_limit':
      return 429;
    case 'auth':
      return 401;
    case 'timeout':
      return 408;
    case 'format':
      return 400;
    default:
      return undefined;
  }
}

/**
 * Extract status code from an error object
 */
function getStatusCode(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') {
    return undefined;
  }
  const candidate =
    (err as { status?: unknown; statusCode?: unknown }).status ??
    (err as { statusCode?: unknown }).statusCode;
  if (typeof candidate === 'number') {
    return candidate;
  }
  if (typeof candidate === 'string' && /^\d+$/.test(candidate)) {
    return Number(candidate);
  }
  return undefined;
}

/**
 * Extract error name from an error object
 */
function getErrorName(err: unknown): string {
  if (!err || typeof err !== 'object') {
    return '';
  }
  return 'name' in err ? String(err.name) : '';
}

/**
 * Extract error code from an error object
 */
function getErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') {
    return undefined;
  }
  const candidate = (err as { code?: unknown }).code;
  if (typeof candidate !== 'string') {
    return undefined;
  }
  const trimmed = candidate.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Extract error message from any value
 */
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  if (typeof err === 'number' || typeof err === 'boolean' || typeof err === 'bigint') {
    return String(err);
  }
  if (typeof err === 'symbol') {
    return err.description ?? '';
  }
  if (err && typeof err === 'object') {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }
  return '';
}

/**
 * Check if an error has timeout indicators
 */
function hasTimeoutHint(err: unknown): boolean {
  if (!err) {
    return false;
  }
  if (getErrorName(err) === 'TimeoutError') {
    return true;
  }
  const message = getErrorMessage(err);
  return Boolean(message && TIMEOUT_HINT_RE.test(message));
}

/**
 * Check if an error is a timeout error
 */
export function isTimeoutError(err: unknown): boolean {
  if (hasTimeoutHint(err)) {
    return true;
  }
  if (!err || typeof err !== 'object') {
    return false;
  }
  if (getErrorName(err) !== 'AbortError') {
    return false;
  }
  const message = getErrorMessage(err);
  if (message && ABORT_TIMEOUT_RE.test(message)) {
    return true;
  }
  const cause = 'cause' in err ? (err as { cause?: unknown }).cause : undefined;
  const reason = 'reason' in err ? (err as { reason?: unknown }).reason : undefined;
  return hasTimeoutHint(cause) || hasTimeoutHint(reason);
}

/**
 * Check if an error matches any patterns in a list
 */
function matchesPatterns(message: string, patterns: readonly RegExp[]): boolean {
  if (!message) return false;
  return patterns.some((pattern) => pattern.test(message));
}

/**
 * Classify an error message into a failover reason
 */
export function classifyFailoverReason(raw: string): FailoverReason | null {
  if (!raw) return null;

  // Check patterns in order of specificity
  if (matchesPatterns(raw, ERROR_PATTERNS.rateLimit)) {
    return 'rate_limit';
  }
  if (matchesPatterns(raw, ERROR_PATTERNS.format)) {
    return 'format';
  }
  if (matchesPatterns(raw, ERROR_PATTERNS.billing)) {
    return 'billing';
  }
  if (matchesPatterns(raw, ERROR_PATTERNS.timeout)) {
    return 'timeout';
  }
  if (matchesPatterns(raw, ERROR_PATTERNS.auth)) {
    return 'auth';
  }
  // Deployment and connection errors warrant fallback but don't have a specific reason
  if (matchesPatterns(raw, ERROR_PATTERNS.deployment)) {
    return 'unknown';
  }
  if (matchesPatterns(raw, ERROR_PATTERNS.connection)) {
    return 'unknown';
  }

  return null;
}

/**
 * Resolve failover reason from an error object
 */
export function resolveFailoverReasonFromError(err: unknown): FailoverReason | null {
  if (isFailoverError(err)) {
    return err.reason;
  }

  // Check status code first
  const status = getStatusCode(err);
  if (status === 402) {
    return 'billing';
  }
  if (status === 429) {
    return 'rate_limit';
  }
  if (status === 401 || status === 403) {
    return 'auth';
  }
  if (status === 408) {
    return 'timeout';
  }

  // Check error code
  const code = (getErrorCode(err) ?? '').toUpperCase();
  if (['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNRESET', 'ECONNABORTED'].includes(code)) {
    return 'timeout';
  }
  if (['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH'].includes(code)) {
    return 'unknown';
  }

  // Check for timeout patterns
  if (isTimeoutError(err)) {
    return 'timeout';
  }

  // Finally, classify by message content
  const message = getErrorMessage(err);
  if (!message) {
    return null;
  }
  return classifyFailoverReason(message);
}

/**
 * Describe a failover error for logging/display
 */
export function describeFailoverError(err: unknown): {
  message: string;
  reason?: FailoverReason;
  status?: number;
  code?: string;
} {
  if (isFailoverError(err)) {
    return {
      message: err.message,
      reason: err.reason,
      status: err.status,
      code: err.code,
    };
  }
  const message = getErrorMessage(err) || String(err);
  return {
    message,
    reason: resolveFailoverReasonFromError(err) ?? undefined,
    status: getStatusCode(err),
    code: getErrorCode(err),
  };
}

/**
 * Convert any error into a FailoverError if it matches failover criteria.
 * Returns null if the error doesn't warrant a failover attempt.
 */
export function coerceToFailoverError(
  err: unknown,
  context?: {
    provider?: string;
    model?: string;
  }
): FailoverError | null {
  if (isFailoverError(err)) {
    return err;
  }

  const reason = resolveFailoverReasonFromError(err);
  if (!reason) {
    return null;
  }

  const message = getErrorMessage(err) || String(err);
  const status = getStatusCode(err) ?? resolveFailoverStatus(reason);
  const code = getErrorCode(err);

  return new FailoverError(message, {
    reason,
    provider: context?.provider,
    model: context?.model,
    status,
    code,
    cause: err instanceof Error ? err : undefined,
  });
}

/**
 * Check if an error is an AbortError (user cancellation, not timeout)
 */
function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  if (isFailoverError(err)) {
    return false;
  }
  const name = 'name' in err ? String(err.name) : '';
  return name === 'AbortError';
}

/**
 * Check if an error should be rethrown without attempting fallback.
 * User-initiated aborts should not trigger fallback.
 */
export function shouldRethrowWithoutFallback(err: unknown): boolean {
  return isAbortError(err) && !isTimeoutError(err);
}

/**
 * Get a user-friendly error message based on the error and provider
 */
export function getUserFriendlyErrorMessage(err: unknown, provider: string): string {
  const reason = resolveFailoverReasonFromError(err);
  const message = getErrorMessage(err) || 'Unknown error';

  switch (reason) {
    case 'auth':
      return `Invalid API key for ${provider}. Please update your API key in Settings > Integrations.`;

    case 'rate_limit':
      return `Rate limit exceeded for ${provider}. Please try again later or switch providers.`;

    case 'billing':
      return `Billing issue with ${provider}. Please check your account balance or upgrade your plan.`;

    case 'timeout':
      return `Request to ${provider} timed out. The server may be overloaded. Try again or switch providers.`;

    case 'format':
      return `Request format error with ${provider}. This may be a compatibility issue.`;

    case 'unknown':
      // Check for specific deployment/connection patterns
      if (matchesPatterns(message, ERROR_PATTERNS.deployment)) {
        return `Model or deployment not found on ${provider}. Please check your configuration in Settings > Integrations.`;
      }
      if (matchesPatterns(message, ERROR_PATTERNS.connection)) {
        return `Cannot connect to ${provider}. Check your network or the provider's status.`;
      }
      return `Connection issue with ${provider}: ${message.substring(0, 100)}`;

    default:
      // Return truncated original message
      return message.length > 150 ? `${message.substring(0, 150)}...` : message;
  }
}
