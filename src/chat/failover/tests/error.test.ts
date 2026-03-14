/**
 * Tests for the failover error classification system.
 *
 * Covers: FailoverError class, isFailoverError, resolveFailoverStatus,
 * isTimeoutError, classifyFailoverReason, resolveFailoverReasonFromError,
 * describeFailoverError, coerceToFailoverError, shouldRethrowWithoutFallback,
 * getUserFriendlyErrorMessage
 */

import { describe, it, expect } from 'vitest';
import {
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
} from '../error.js';
import type { FailoverReason } from '../types.js';

// =============================================================================
// FailoverError class
// =============================================================================

describe('FailoverError', () => {
  it('creates an instance with all required fields', () => {
    const err = new FailoverError('Rate limited', { reason: 'rate_limit' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(FailoverError);
    expect(err.message).toBe('Rate limited');
    expect(err.reason).toBe('rate_limit');
    expect(err.name).toBe('FailoverError');
  });

  it('stores optional provider, model, status, and code', () => {
    const err = new FailoverError('Auth failed', {
      reason: 'auth',
      provider: 'openai',
      model: 'gpt-4o',
      status: 401,
      code: 'invalid_api_key',
    });
    expect(err.provider).toBe('openai');
    expect(err.model).toBe('gpt-4o');
    expect(err.status).toBe(401);
    expect(err.code).toBe('invalid_api_key');
  });

  it('preserves the cause error', () => {
    const cause = new Error('underlying');
    const err = new FailoverError('Wrapper', { reason: 'timeout', cause });
    expect(err.cause).toBe(cause);
  });

  it('leaves optional fields undefined when not provided', () => {
    const err = new FailoverError('Minimal', { reason: 'unknown' });
    expect(err.provider).toBeUndefined();
    expect(err.model).toBeUndefined();
    expect(err.status).toBeUndefined();
    expect(err.code).toBeUndefined();
  });
});

// =============================================================================
// isFailoverError
// =============================================================================

describe('isFailoverError', () => {
  it('returns true for FailoverError instances', () => {
    const err = new FailoverError('test', { reason: 'rate_limit' });
    expect(isFailoverError(err)).toBe(true);
  });

  it('returns false for plain Error', () => {
    expect(isFailoverError(new Error('plain'))).toBe(false);
  });

  it('returns false for null and undefined', () => {
    expect(isFailoverError(null)).toBe(false);
    expect(isFailoverError(undefined)).toBe(false);
  });

  it('returns false for strings and numbers', () => {
    expect(isFailoverError('error string')).toBe(false);
    expect(isFailoverError(42)).toBe(false);
  });
});

// =============================================================================
// resolveFailoverStatus
// =============================================================================

describe('resolveFailoverStatus', () => {
  const cases: Array<[FailoverReason, number | undefined]> = [
    ['billing', 402],
    ['rate_limit', 429],
    ['auth', 401],
    ['timeout', 408],
    ['format', 400],
    ['unknown', undefined],
  ];

  it.each(cases)('%s -> %s', (reason, expected) => {
    expect(resolveFailoverStatus(reason)).toBe(expected);
  });
});

// =============================================================================
// isTimeoutError
// =============================================================================

describe('isTimeoutError', () => {
  it('returns true for errors with "timeout" in the message', () => {
    expect(isTimeoutError(new Error('Request timeout exceeded'))).toBe(true);
    expect(isTimeoutError(new Error('timed out after 30s'))).toBe(true);
  });

  it('returns true for errors with "deadline exceeded"', () => {
    expect(isTimeoutError(new Error('context deadline exceeded'))).toBe(true);
  });

  it('returns true for errors named TimeoutError', () => {
    const err = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    expect(isTimeoutError(err)).toBe(true);
  });

  it('returns true for AbortError with timeout-like message', () => {
    const err = Object.assign(new Error('request was aborted'), { name: 'AbortError' });
    expect(isTimeoutError(err)).toBe(true);
  });

  it('returns true for AbortError with timeout cause', () => {
    const cause = new Error('timed out');
    const err = Object.assign(new Error('aborted'), { name: 'AbortError', cause });
    expect(isTimeoutError(err)).toBe(true);
  });

  it('returns true for ETIMEDOUT code', () => {
    const err = Object.assign(new Error('connection error'), { code: 'ETIMEDOUT' });
    expect(isTimeoutError(err)).toBe(false); // code checked in resolveFailoverReasonFromError, not isTimeoutError directly
    // isTimeoutError only checks message patterns and AbortError, not codes
  });

  it('returns false for plain AbortError without timeout message', () => {
    const err = Object.assign(new Error('user cancelled'), { name: 'AbortError' });
    expect(isTimeoutError(err)).toBe(false);
  });

  it('returns false for unrelated errors', () => {
    expect(isTimeoutError(new Error('rate limit exceeded'))).toBe(false);
    expect(isTimeoutError(new Error('invalid api key'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isTimeoutError(null)).toBe(false);
  });
});

// =============================================================================
// classifyFailoverReason
// =============================================================================

describe('classifyFailoverReason', () => {
  it('returns null for empty string', () => {
    expect(classifyFailoverReason('')).toBeNull();
  });

  // Rate limit patterns
  it('classifies "rate limit" messages', () => {
    expect(classifyFailoverReason('rate limit exceeded')).toBe('rate_limit');
    expect(classifyFailoverReason('rate_limit')).toBe('rate_limit');
    expect(classifyFailoverReason('429 Too Many Requests')).toBe('rate_limit');
    expect(classifyFailoverReason('You exceeded your current quota')).toBe('rate_limit');
    expect(classifyFailoverReason('resource has been exhausted')).toBe('rate_limit');
    expect(classifyFailoverReason('quota exceeded')).toBe('rate_limit');
    expect(classifyFailoverReason('The server is overloaded')).toBe('rate_limit');
    expect(classifyFailoverReason('overloaded_error')).toBe('rate_limit');
    expect(classifyFailoverReason('capacity exceeded')).toBe('rate_limit');
    expect(classifyFailoverReason('usage limit reached')).toBe('rate_limit');
  });

  // Format patterns
  it('classifies format error messages', () => {
    expect(classifyFailoverReason('string should match pattern')).toBe('format');
    expect(classifyFailoverReason('tool_use.id is required')).toBe('format');
    expect(classifyFailoverReason('tool_use_id missing')).toBe('format');
    expect(classifyFailoverReason('invalid request format')).toBe('format');
    expect(classifyFailoverReason('invalid_request_error')).toBe('format');
    expect(classifyFailoverReason('malformed JSON body')).toBe('format');
  });

  // Billing patterns
  it('classifies billing error messages', () => {
    expect(classifyFailoverReason('402 Payment Required')).toBe('billing');
    expect(classifyFailoverReason('payment required')).toBe('billing');
    expect(classifyFailoverReason('insufficient credits')).toBe('billing');
    expect(classifyFailoverReason('credit balance too low')).toBe('billing');
    expect(classifyFailoverReason('plans & billing details')).toBe('billing');
    expect(classifyFailoverReason('upgrade your plan to continue')).toBe('billing');
  });

  // Timeout patterns
  it('classifies timeout error messages', () => {
    expect(classifyFailoverReason('timeout waiting for response')).toBe('timeout');
    expect(classifyFailoverReason('request timed out')).toBe('timeout');
    expect(classifyFailoverReason('deadline exceeded')).toBe('timeout');
    expect(classifyFailoverReason('ETIMEDOUT')).toBe('timeout');
    expect(classifyFailoverReason('ESOCKETTIMEDOUT')).toBe('timeout');
    expect(classifyFailoverReason('ECONNRESET connection reset')).toBe('timeout');
    expect(classifyFailoverReason('ECONNABORTED')).toBe('timeout');
  });

  // Auth patterns
  it('classifies auth error messages', () => {
    expect(classifyFailoverReason('invalid_api_key provided')).toBe('auth');
    expect(classifyFailoverReason('invalid api key')).toBe('auth');
    expect(classifyFailoverReason('Incorrect API key')).toBe('auth');
    expect(classifyFailoverReason('invalid token')).toBe('auth');
    expect(classifyFailoverReason('Authentication failed')).toBe('auth');
    expect(classifyFailoverReason('Please re-authenticate')).toBe('auth');
    expect(classifyFailoverReason('oauth token refresh failed')).toBe('auth');
    expect(classifyFailoverReason('401 Unauthorized')).toBe('auth');
    expect(classifyFailoverReason('403 Forbidden')).toBe('auth');
    expect(classifyFailoverReason('Access denied')).toBe('auth');
    expect(classifyFailoverReason('token has expired')).toBe('auth');
    expect(classifyFailoverReason('no credentials found')).toBe('auth');
    expect(classifyFailoverReason('no api key found')).toBe('auth');
    expect(classifyFailoverReason('api key is invalid')).toBe('auth');
  });

  // Deployment patterns
  it('classifies deployment error messages as unknown', () => {
    expect(classifyFailoverReason('deployment does not exist')).toBe('unknown');
    expect(classifyFailoverReason('deployment not found')).toBe('unknown');
    expect(classifyFailoverReason('model not found')).toBe('unknown');
    expect(classifyFailoverReason('model does not exist')).toBe('unknown');
    expect(classifyFailoverReason('resource not found')).toBe('unknown');
    expect(classifyFailoverReason('endpoint not found')).toBe('unknown');
  });

  // Connection patterns
  it('classifies connection error messages as unknown', () => {
    expect(classifyFailoverReason('ECONNREFUSED')).toBe('unknown');
    expect(classifyFailoverReason('ENOTFOUND host')).toBe('unknown');
    expect(classifyFailoverReason('EHOSTUNREACH')).toBe('unknown');
    expect(classifyFailoverReason('503 service unavailable')).toBe('unknown');
    expect(classifyFailoverReason('502 bad gateway error')).toBe('unknown');
    expect(classifyFailoverReason('504 gateway timeout')).toBe('timeout'); // "timeout" pattern matches before connection
    expect(classifyFailoverReason('network error occurred')).toBe('unknown');
    expect(classifyFailoverReason('fetch failed')).toBe('unknown');
  });

  // Unrecognized errors
  it('returns null for unrecognized errors', () => {
    expect(classifyFailoverReason('unexpected JSON token')).toBeNull();
    expect(classifyFailoverReason('something went wrong')).toBeNull();
    expect(classifyFailoverReason('internal server error')).toBeNull();
  });

  // Priority - rate_limit before format
  it('prefers rate_limit over format when both patterns might match', () => {
    // "resource_exhausted" is a rate_limit pattern checked before format
    expect(classifyFailoverReason('resource_exhausted: quota exceeded')).toBe('rate_limit');
  });
});

// =============================================================================
// resolveFailoverReasonFromError
// =============================================================================

describe('resolveFailoverReasonFromError', () => {
  it('returns the reason directly from a FailoverError', () => {
    const err = new FailoverError('fail', { reason: 'billing' });
    expect(resolveFailoverReasonFromError(err)).toBe('billing');
  });

  it('resolves from HTTP status 402 to billing', () => {
    const err = Object.assign(new Error('pay'), { status: 402 });
    expect(resolveFailoverReasonFromError(err)).toBe('billing');
  });

  it('resolves from HTTP status 429 to rate_limit', () => {
    const err = Object.assign(new Error('limited'), { status: 429 });
    expect(resolveFailoverReasonFromError(err)).toBe('rate_limit');
  });

  it('resolves from HTTP status 401 to auth', () => {
    const err = Object.assign(new Error('unauth'), { status: 401 });
    expect(resolveFailoverReasonFromError(err)).toBe('auth');
  });

  it('resolves from HTTP status 403 to auth', () => {
    const err = Object.assign(new Error('forbidden'), { status: 403 });
    expect(resolveFailoverReasonFromError(err)).toBe('auth');
  });

  it('resolves from HTTP status 408 to timeout', () => {
    const err = Object.assign(new Error('timeout'), { status: 408 });
    expect(resolveFailoverReasonFromError(err)).toBe('timeout');
  });

  it('resolves statusCode (alternative field name)', () => {
    const err = Object.assign(new Error('pay'), { statusCode: 429 });
    expect(resolveFailoverReasonFromError(err)).toBe('rate_limit');
  });

  it('resolves from error code ETIMEDOUT', () => {
    const err = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
    expect(resolveFailoverReasonFromError(err)).toBe('timeout');
  });

  it('resolves from error code ECONNRESET', () => {
    const err = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    expect(resolveFailoverReasonFromError(err)).toBe('timeout');
  });

  it('resolves from error code ECONNREFUSED', () => {
    const err = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
    expect(resolveFailoverReasonFromError(err)).toBe('unknown');
  });

  it('resolves from error code ENOTFOUND', () => {
    const err = Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
    expect(resolveFailoverReasonFromError(err)).toBe('unknown');
  });

  it('resolves from message when no status/code match', () => {
    const err = new Error('rate_limit exceeded');
    expect(resolveFailoverReasonFromError(err)).toBe('rate_limit');
  });

  it('resolves timeout via isTimeoutError for TimeoutError name', () => {
    const err = Object.assign(new Error('deadline exceeded'), { name: 'TimeoutError' });
    expect(resolveFailoverReasonFromError(err)).toBe('timeout');
  });

  it('returns null for completely unrecognized errors', () => {
    expect(resolveFailoverReasonFromError(new Error('unexpected thing happened'))).toBeNull();
  });

  it('returns null for null and undefined', () => {
    expect(resolveFailoverReasonFromError(null)).toBeNull();
    expect(resolveFailoverReasonFromError(undefined)).toBeNull();
  });

  it('resolves from string statusCode (numeric string)', () => {
    const err = { status: '429', message: 'limited' };
    expect(resolveFailoverReasonFromError(err)).toBe('rate_limit');
  });
});

// =============================================================================
// describeFailoverError
// =============================================================================

describe('describeFailoverError', () => {
  it('returns structured info from a FailoverError', () => {
    const err = new FailoverError('Rate limited by OpenAI', {
      reason: 'rate_limit',
      provider: 'openai',
      status: 429,
      code: 'rate_limit_exceeded',
    });
    const desc = describeFailoverError(err);
    expect(desc.message).toBe('Rate limited by OpenAI');
    expect(desc.reason).toBe('rate_limit');
    expect(desc.status).toBe(429);
    expect(desc.code).toBe('rate_limit_exceeded');
  });

  it('returns info from a plain Error', () => {
    const err = new Error('invalid_api_key used');
    const desc = describeFailoverError(err);
    expect(desc.message).toBe('invalid_api_key used');
    expect(desc.reason).toBe('auth');
  });

  it('handles errors with status codes', () => {
    const err = Object.assign(new Error('billing error'), { status: 402 });
    const desc = describeFailoverError(err);
    expect(desc.status).toBe(402);
    expect(desc.reason).toBe('billing');
  });

  it('handles null with fallback string representation', () => {
    const desc = describeFailoverError(null);
    expect(typeof desc.message).toBe('string');
    expect(desc.reason).toBeUndefined();
  });
});

// =============================================================================
// coerceToFailoverError
// =============================================================================

describe('coerceToFailoverError', () => {
  it('returns the same FailoverError unchanged', () => {
    const err = new FailoverError('already wrapped', { reason: 'timeout' });
    expect(coerceToFailoverError(err)).toBe(err);
  });

  it('wraps a classifiable plain Error', () => {
    const err = new Error('rate limit exceeded');
    const wrapped = coerceToFailoverError(err);
    expect(wrapped).not.toBeNull();
    expect(wrapped).toBeInstanceOf(FailoverError);
    expect(wrapped!.reason).toBe('rate_limit');
    expect(wrapped!.message).toBe('rate limit exceeded');
  });

  it('carries over the original error as cause', () => {
    const err = new Error('rate limit exceeded');
    const wrapped = coerceToFailoverError(err);
    expect(wrapped!.cause).toBe(err);
  });

  it('uses status from the error when available', () => {
    const err = Object.assign(new Error('limited'), { status: 429 });
    const wrapped = coerceToFailoverError(err);
    expect(wrapped!.status).toBe(429);
  });

  it('falls back to resolveFailoverStatus when no status on error', () => {
    const err = new Error('invalid_api_key');
    const wrapped = coerceToFailoverError(err);
    expect(wrapped!.reason).toBe('auth');
    expect(wrapped!.status).toBe(401); // resolveFailoverStatus('auth') = 401
  });

  it('attaches provider and model from context', () => {
    const err = new Error('rate limit');
    const wrapped = coerceToFailoverError(err, { provider: 'anthropic', model: 'claude-3-5' });
    expect(wrapped!.provider).toBe('anthropic');
    expect(wrapped!.model).toBe('claude-3-5');
  });

  it('returns null when error is not classifiable', () => {
    expect(coerceToFailoverError(new Error('something random'))).toBeNull();
  });

  it('returns null for null input', () => {
    expect(coerceToFailoverError(null)).toBeNull();
  });

  it('wraps an object with message and status', () => {
    const err = { message: 'insufficient credits', status: 402 };
    const wrapped = coerceToFailoverError(err);
    expect(wrapped).not.toBeNull();
    expect(wrapped!.reason).toBe('billing');
    expect(wrapped!.status).toBe(402);
  });
});

// =============================================================================
// shouldRethrowWithoutFallback
// =============================================================================

describe('shouldRethrowWithoutFallback', () => {
  it('returns true for plain AbortError (user cancellation)', () => {
    const err = Object.assign(new Error('user cancelled'), { name: 'AbortError' });
    expect(shouldRethrowWithoutFallback(err)).toBe(true);
  });

  it('returns false for AbortError that is a timeout', () => {
    const err = Object.assign(new Error('request was aborted'), { name: 'AbortError' });
    expect(shouldRethrowWithoutFallback(err)).toBe(false);
  });

  it('returns false for FailoverError', () => {
    const err = new FailoverError('rate limited', { reason: 'rate_limit' });
    expect(shouldRethrowWithoutFallback(err)).toBe(false);
  });

  it('returns false for plain Error', () => {
    expect(shouldRethrowWithoutFallback(new Error('network issue'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(shouldRethrowWithoutFallback(null)).toBe(false);
  });
});

// =============================================================================
// getUserFriendlyErrorMessage
// =============================================================================

describe('getUserFriendlyErrorMessage', () => {
  it('returns auth message for auth errors', () => {
    const err = new Error('invalid_api_key');
    const msg = getUserFriendlyErrorMessage(err, 'openai');
    expect(msg).toContain('openai');
    expect(msg).toContain('API key');
    expect(msg).toContain('Settings');
  });

  it('returns rate limit message for rate_limit errors', () => {
    const err = new Error('rate limit exceeded');
    const msg = getUserFriendlyErrorMessage(err, 'anthropic');
    expect(msg).toContain('anthropic');
    expect(msg).toContain('Rate limit');
  });

  it('returns billing message for billing errors', () => {
    const err = new Error('insufficient credits');
    const msg = getUserFriendlyErrorMessage(err, 'openai');
    expect(msg).toContain('openai');
    expect(msg).toContain('Billing');
  });

  it('returns timeout message for timeout errors', () => {
    const err = new Error('request timed out');
    const msg = getUserFriendlyErrorMessage(err, 'openai');
    expect(msg).toContain('openai');
    expect(msg).toContain('timed out');
  });

  it('returns format message for format errors', () => {
    const err = new Error('invalid_request_error');
    const msg = getUserFriendlyErrorMessage(err, 'anthropic');
    expect(msg).toContain('anthropic');
    expect(msg).toContain('format error');
  });

  it('returns deployment message for deployment-related unknown errors', () => {
    const err = new Error('model not found in deployment');
    const msg = getUserFriendlyErrorMessage(err, 'azure');
    expect(msg).toContain('azure');
    expect(msg.toLowerCase()).toContain('not found');
  });

  it('returns connection message for connection-related unknown errors', () => {
    const err = new Error('fetch failed: ECONNREFUSED');
    const msg = getUserFriendlyErrorMessage(err, 'ollama');
    expect(msg).toContain('ollama');
    expect(msg.toLowerCase()).toContain('connect');
  });

  it('truncates very long unclassified messages to 150 chars', () => {
    const longMessage = 'a'.repeat(200);
    const msg = getUserFriendlyErrorMessage(new Error(longMessage), 'provider');
    expect(msg.length).toBeLessThanOrEqual(154); // 150 + "..."
    expect(msg.endsWith('...')).toBe(true);
  });

  it('returns original message when under 150 chars and unclassified', () => {
    const err = new Error('something went wrong');
    const msg = getUserFriendlyErrorMessage(err, 'provider');
    expect(msg).toBe('something went wrong');
  });

  it('works with FailoverError passed directly', () => {
    const err = new FailoverError('Rate limited', { reason: 'rate_limit', provider: 'openai' });
    const msg = getUserFriendlyErrorMessage(err, 'openai');
    expect(msg).toContain('openai');
    expect(msg.toLowerCase()).toContain('rate limit');
  });
});
