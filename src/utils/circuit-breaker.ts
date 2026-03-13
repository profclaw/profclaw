/**
 * Circuit Breaker Implementation
 * 
 * Protects against cascading failures by "opening" the circuit
 * when error rates exceed thresholds, preventing further requests
 * until the service has time to recover.
 */

import { AppError, ErrorCategory, ErrorSeverity } from '../types/errors.js';

/**
 * Circuit breaker states
 */
export enum CircuitState {
  /** Circuit is closed, requests flow normally */
  CLOSED = 'CLOSED',
  
  /** Circuit is open, requests are blocked */
  OPEN = 'OPEN',
  
  /** Circuit is testing if service recovered */
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Name for logging/debugging */
  name: string;
  
  /** Number of failures before opening circuit */
  failureThreshold: number;
  
  /** Time window for counting failures (ms) */
  failureWindow: number;
  
  /** Time to wait before attempting recovery (ms) */
  resetTimeout: number;
  
  /** Number of successful requests in half-open before closing */
  successThreshold: number;
  
  /** Request timeout (ms) */
  timeout?: number;
}

/**
 * Circuit breaker statistics
 */
export interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  totalRequests: number;
  lastFailureTime?: Date;
  lastSuccessTime?: Date;
  stateChangedAt: Date;
}

/**
 * Circuit breaker error
 */
export class CircuitBreakerError extends AppError {
  constructor(name: string, state: CircuitState) {
    super(`Circuit breaker '${name}' is ${state}`, {
      category: ErrorCategory.EXTERNAL_API,
      severity: ErrorSeverity.MEDIUM,
      retryable: state === CircuitState.HALF_OPEN,
      statusCode: 503,
      metadata: { circuitName: name, circuitState: state },
    });
  }
}

/**
 * Circuit Breaker implementation
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private totalRequests: number = 0;
  private lastFailureTime?: Date;
  private lastSuccessTime?: Date;
  private stateChangedAt: Date = new Date();
  private failures: Date[] = [];
  private resetTimer?: NodeJS.Timeout;

  constructor(private config: CircuitBreakerConfig) {}

  /**
   * Execute a function through the circuit breaker
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalRequests++;

    // Check circuit state
    if (this.state === CircuitState.OPEN) {
      // Check if we should attempt recovery
      const timeSinceOpen = Date.now() - this.stateChangedAt.getTime();
      if (timeSinceOpen >= this.config.resetTimeout) {
        this.transitionTo(CircuitState.HALF_OPEN);
      } else {
        throw new CircuitBreakerError(this.config.name, this.state);
      }
    }

    try {
      // Apply timeout if configured
      const result = this.config.timeout
        ? await this.withTimeout(fn, this.config.timeout)
        : await fn();

      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  /**
   * Execute function with timeout
   */
  private async withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new AppError(`Operation timed out after ${timeoutMs}ms`, {
                category: ErrorCategory.TIMEOUT,
                retryable: true,
                statusCode: 504,
              })
            ),
          timeoutMs
        )
      ),
    ]);
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    this.lastSuccessTime = new Date();

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      
      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Reset failure count on success in closed state
      this.failureCount = 0;
      this.failures = [];
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(error: unknown): void {
    this.lastFailureTime = new Date();
    this.failureCount++;
    this.failures.push(new Date());

    // Clean up old failures outside the window
    const cutoff = Date.now() - this.config.failureWindow;
    this.failures = this.failures.filter((f) => f.getTime() > cutoff);

    // Check if we should open the circuit
    if (this.state === CircuitState.HALF_OPEN) {
      // Any failure in half-open state reopens the circuit
      this.transitionTo(CircuitState.OPEN);
    } else if (this.state === CircuitState.CLOSED) {
      // Check if failures exceed threshold within window
      if (this.failures.length >= this.config.failureThreshold) {
        this.transitionTo(CircuitState.OPEN);
      }
    }

    console.error(
      `[CircuitBreaker:${this.config.name}] Failure recorded. ` +
        `Count: ${this.failures.length}/${this.config.failureThreshold} ` +
        `State: ${this.state}`,
      error
    );
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.stateChangedAt = new Date();

    if (newState === CircuitState.CLOSED) {
      // Reset counters when closing
      this.failureCount = 0;
      this.successCount = 0;
      this.failures = [];
    } else if (newState === CircuitState.HALF_OPEN) {
      // Reset success counter when entering half-open
      this.successCount = 0;
    } else if (newState === CircuitState.OPEN) {
      // Schedule automatic transition to half-open
      if (this.resetTimer) {
        clearTimeout(this.resetTimer);
      }
      this.resetTimer = setTimeout(() => {
        if (this.state === CircuitState.OPEN) {
          this.transitionTo(CircuitState.HALF_OPEN);
        }
      }, this.config.resetTimeout);
    }

    console.log(
      `[CircuitBreaker:${this.config.name}] State changed: ${oldState} → ${newState}`
    );
  }

  /**
   * Get current statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      totalRequests: this.totalRequests,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      stateChangedAt: this.stateChangedAt,
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.failures = [];
    this.stateChangedAt = new Date();
    console.log(`[CircuitBreaker:${this.config.name}] Manually reset`);
  }

  /**
   * Manually open the circuit breaker
   */
  open(): void {
    this.transitionTo(CircuitState.OPEN);
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }
}

/**
 * Circuit breaker registry for managing multiple breakers
 */
class CircuitBreakerRegistry {
  private breakers = new Map<string, CircuitBreaker>();

  /**
   * Get or create a circuit breaker
   */
  getOrCreate(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    let breaker = this.breakers.get(name);

    if (!breaker) {
      const defaultConfig: CircuitBreakerConfig = {
        name,
        failureThreshold: 5,
        failureWindow: 60000, // 1 minute
        resetTimeout: 30000, // 30 seconds
        successThreshold: 2,
        timeout: 10000, // 10 seconds
        ...config,
      };

      breaker = new CircuitBreaker(defaultConfig);
      this.breakers.set(name, breaker);
    }

    return breaker;
  }

  /**
   * Get all circuit breakers
   */
  getAll(): Map<string, CircuitBreaker> {
    return new Map(this.breakers);
  }

  /**
   * Get stats for all breakers
   */
  getAllStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};
    for (const [name, breaker] of this.breakers) {
      stats[name] = breaker.getStats();
    }
    return stats;
  }

  /**
   * Reset a specific breaker
   */
  reset(name: string): void {
    this.breakers.get(name)?.reset();
  }

  /**
   * Reset all breakers
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }
}

// Singleton registry
export const circuitBreakers = new CircuitBreakerRegistry();

/**
 * Decorator to wrap a function with a circuit breaker
 */
export function withCircuitBreaker<TArgs extends unknown[], TResult>(
  name: string,
  config?: Partial<CircuitBreakerConfig>
) {
  return function (
    _target: object,
    _propertyKey: string,
    descriptor: TypedPropertyDescriptor<(...args: TArgs) => Promise<TResult>>
  ): TypedPropertyDescriptor<(...args: TArgs) => Promise<TResult>> {
    const original = descriptor.value;
    if (!original) {
      return descriptor;
    }

    descriptor.value = async function (...args: TArgs): Promise<TResult> {
      const breaker = circuitBreakers.getOrCreate(name, config);
      return breaker.execute(() => original.apply(this, args));
    };

    return descriptor;
  };
}
