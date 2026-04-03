/**
 * Tool Circuit Breaker
 *
 * Prevents tools from being called repeatedly when they are failing.
 * Implements the standard circuit breaker pattern:
 *   closed → (3 failures in 2 min) → open → (cooldown expires) → half-open
 *   half-open → (1 success) → closed
 *   half-open → (1 failure) → open (doubled cooldown)
 */

import { logger } from '../utils/logger.js';

// Types

export type CircuitBreakerStateValue = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerState {
  state: CircuitBreakerStateValue;
  failureCount: number;
  lastFailureAt: number;
  cooldownMs: number;
}

export interface CanExecuteResult {
  allowed: boolean;
  reason?: string;
}

// Constants

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_WINDOW_MS = 120_000; // 2 minutes
const INITIAL_COOLDOWN_MS = 5_000;
const MAX_COOLDOWN_MS = 60_000;

function defaultBreakerState(): CircuitBreakerState {
  return {
    state: 'closed',
    failureCount: 0,
    lastFailureAt: 0,
    cooldownMs: INITIAL_COOLDOWN_MS,
  };
}

// Circuit Breaker

export class ToolCircuitBreaker {
  private breakers: Map<string, CircuitBreakerState>;
  private readonly failureThreshold: number;
  private readonly windowMs: number;

  constructor(
    failureThreshold: number = DEFAULT_FAILURE_THRESHOLD,
    windowMs: number = DEFAULT_WINDOW_MS,
  ) {
    this.breakers = new Map();
    this.failureThreshold = failureThreshold;
    this.windowMs = windowMs;
  }

  /**
   * Check whether a tool is allowed to execute.
   * Transitions open → half-open when the cooldown has expired.
   */
  canExecute(toolName: string): CanExecuteResult {
    const breaker = this.getOrCreate(toolName);
    const now = Date.now();

    if (breaker.state === 'closed') {
      return { allowed: true };
    }

    if (breaker.state === 'open') {
      const elapsed = now - breaker.lastFailureAt;

      if (elapsed >= breaker.cooldownMs) {
        // Transition to half-open to allow a probe call
        breaker.state = 'half-open';
        logger.debug('[CircuitBreaker] Transitioning to half-open', {
          tool: toolName,
          elapsed,
          cooldownMs: breaker.cooldownMs,
        });
        return { allowed: true };
      }

      const remainingMs = breaker.cooldownMs - elapsed;
      return {
        allowed: false,
        reason: `Circuit breaker open for ${toolName}: too many recent failures. Retry in ${Math.ceil(remainingMs / 1000)}s.`,
      };
    }

    // half-open: allow one probe through
    return { allowed: true };
  }

  /**
   * Record a successful tool execution.
   * In half-open state this closes the circuit.
   */
  recordSuccess(toolName: string): void {
    const breaker = this.getOrCreate(toolName);

    if (breaker.state === 'half-open') {
      logger.info('[CircuitBreaker] Probe succeeded, closing circuit', { tool: toolName });
      breaker.state = 'closed';
      breaker.failureCount = 0;
      breaker.cooldownMs = INITIAL_COOLDOWN_MS;
    } else if (breaker.state === 'closed') {
      // Reset failure count on success within the window
      breaker.failureCount = 0;
    }
  }

  /**
   * Record a failed tool execution.
   * Counts failures within the time window and trips the breaker when the
   * threshold is reached. In half-open state it immediately re-opens with
   * a doubled cooldown.
   */
  recordFailure(toolName: string): void {
    const breaker = this.getOrCreate(toolName);
    const now = Date.now();

    if (breaker.state === 'half-open') {
      // Probe failed — re-open with doubled cooldown
      breaker.cooldownMs = Math.min(breaker.cooldownMs * 2, MAX_COOLDOWN_MS);
      breaker.state = 'open';
      breaker.lastFailureAt = now;
      logger.warn('[CircuitBreaker] Probe failed, re-opening circuit', {
        tool: toolName,
        cooldownMs: breaker.cooldownMs,
      });
      return;
    }

    // In closed state, check if previous failures are still within the window
    const withinWindow =
      breaker.lastFailureAt > 0 && now - breaker.lastFailureAt <= this.windowMs;

    if (withinWindow) {
      breaker.failureCount++;
    } else {
      // Failures outside the window don't count; start a fresh count
      breaker.failureCount = 1;
    }

    breaker.lastFailureAt = now;

    if (breaker.failureCount >= this.failureThreshold) {
      breaker.state = 'open';
      logger.warn('[CircuitBreaker] Threshold reached, opening circuit', {
        tool: toolName,
        failureCount: breaker.failureCount,
        cooldownMs: breaker.cooldownMs,
      });
    }
  }

  /**
   * Reset the circuit breaker for a specific tool, or all tools if no name is given.
   */
  reset(toolName?: string): void {
    if (toolName !== undefined) {
      this.breakers.set(toolName, defaultBreakerState());
    } else {
      this.breakers.clear();
    }
  }

  /**
   * Return a deep snapshot of all breaker states.
   * Mutations to the live breakers do not affect the returned map.
   */
  getStatus(): Map<string, CircuitBreakerState> {
    const snapshot = new Map<string, CircuitBreakerState>();
    for (const [key, value] of this.breakers) {
      snapshot.set(key, { ...value });
    }
    return snapshot;
  }

  // Private helpers

  private getOrCreate(toolName: string): CircuitBreakerState {
    let breaker = this.breakers.get(toolName);
    if (!breaker) {
      breaker = defaultBreakerState();
      this.breakers.set(toolName, breaker);
    }
    return breaker;
  }
}
