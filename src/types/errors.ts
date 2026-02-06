/**
 * Structured Error Types for profClaw
 *
 * Provides a type-safe error hierarchy for better error handling,
 * categorization, and retry logic.
 */

/**
 * Error categories for classification and handling
 */
export enum ErrorCategory {
  /** Configuration or setup issues */
  CONFIGURATION = 'CONFIGURATION',
  
  /** Authentication/authorization failures */
  AUTHENTICATION = 'AUTHENTICATION',
  
  /** Network connectivity issues (retryable) */
  NETWORK = 'NETWORK',
  
  /** External API errors (rate limits, service unavailable) */
  EXTERNAL_API = 'EXTERNAL_API',
  
  /** Data validation errors */
  VALIDATION = 'VALIDATION',
  
  /** Resource not found */
  NOT_FOUND = 'NOT_FOUND',
  
  /** Operation timeout */
  TIMEOUT = 'TIMEOUT',
  
  /** Rate limit exceeded */
  RATE_LIMIT = 'RATE_LIMIT',
  
  /** Task execution failures */
  EXECUTION = 'EXECUTION',
  
  /** Unknown/unexpected errors */
  UNKNOWN = 'UNKNOWN',
}

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  /** Critical - requires immediate attention */
  CRITICAL = 'CRITICAL',
  
  /** High - should be investigated soon */
  HIGH = 'HIGH',
  
  /** Medium - can be handled in normal workflow */
  MEDIUM = 'MEDIUM',
  
  /** Low - informational, may not need action */
  LOW = 'LOW',
}

/**
 * Base application error with enhanced metadata
 */
export class AppError extends Error {
  public readonly category: ErrorCategory;
  public readonly severity: ErrorSeverity;
  public readonly retryable: boolean;
  public readonly statusCode?: number;
  public readonly metadata?: Record<string, unknown>;
  public readonly timestamp: Date;
  public readonly correlationId?: string;

  constructor(
    message: string,
    options: {
      category: ErrorCategory;
      severity?: ErrorSeverity;
      retryable?: boolean;
      statusCode?: number;
      metadata?: Record<string, unknown>;
      correlationId?: string;
      cause?: Error;
    }
  ) {
    super(message);
    this.name = this.constructor.name;
    this.category = options.category;
    this.severity = options.severity || ErrorSeverity.MEDIUM;
    this.retryable = options.retryable ?? false;
    this.statusCode = options.statusCode;
    this.metadata = options.metadata;
    this.timestamp = new Date();
    this.correlationId = options.correlationId;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    // Store cause if provided
    if (options.cause) {
      this.cause = options.cause;
    }
  }

  /**
   * Convert error to JSON for logging/transmission
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      category: this.category,
      severity: this.severity,
      retryable: this.retryable,
      statusCode: this.statusCode,
      metadata: this.metadata,
      timestamp: this.timestamp.toISOString(),
      correlationId: this.correlationId,
      stack: this.stack,
    };
  }
}

/**
 * Configuration error (non-retryable)
 */
export class ConfigurationError extends AppError {
  constructor(message: string, metadata?: Record<string, unknown>) {
    super(message, {
      category: ErrorCategory.CONFIGURATION,
      severity: ErrorSeverity.CRITICAL,
      retryable: false,
      statusCode: 500,
      metadata,
    });
  }
}

/**
 * Authentication error (non-retryable)
 */
export class AuthenticationError extends AppError {
  constructor(message: string, metadata?: Record<string, unknown>) {
    super(message, {
      category: ErrorCategory.AUTHENTICATION,
      severity: ErrorSeverity.HIGH,
      retryable: false,
      statusCode: 401,
      metadata,
    });
  }
}

/**
 * Network error (retryable)
 */
export class NetworkError extends AppError {
  constructor(message: string, cause?: Error, metadata?: Record<string, unknown>) {
    super(message, {
      category: ErrorCategory.NETWORK,
      severity: ErrorSeverity.MEDIUM,
      retryable: true,
      statusCode: 503,
      metadata,
      cause,
    });
  }
}

/**
 * External API error (conditionally retryable)
 */
export class ExternalAPIError extends AppError {
  constructor(
    message: string,
    statusCode: number,
    retryable: boolean = false,
    metadata?: Record<string, unknown>
  ) {
    super(message, {
      category: ErrorCategory.EXTERNAL_API,
      severity: statusCode >= 500 ? ErrorSeverity.HIGH : ErrorSeverity.MEDIUM,
      retryable,
      statusCode,
      metadata,
    });
  }
}

/**
 * Validation error (non-retryable)
 */
export class ValidationError extends AppError {
  constructor(message: string, metadata?: Record<string, unknown>) {
    super(message, {
      category: ErrorCategory.VALIDATION,
      severity: ErrorSeverity.LOW,
      retryable: false,
      statusCode: 400,
      metadata,
    });
  }
}

/**
 * Not found error (non-retryable)
 */
export class NotFoundError extends AppError {
  constructor(resource: string, id: string, metadata?: Record<string, unknown>) {
    super(`${resource} not found: ${id}`, {
      category: ErrorCategory.NOT_FOUND,
      severity: ErrorSeverity.LOW,
      retryable: false,
      statusCode: 404,
      metadata: { ...metadata, resource, id },
    });
  }
}

/**
 * Timeout error (retryable)
 */
export class TimeoutError extends AppError {
  constructor(operation: string, timeoutMs: number, metadata?: Record<string, unknown>) {
    super(`Operation timed out after ${timeoutMs}ms: ${operation}`, {
      category: ErrorCategory.TIMEOUT,
      severity: ErrorSeverity.MEDIUM,
      retryable: true,
      statusCode: 504,
      metadata: { ...metadata, operation, timeoutMs },
    });
  }
}

/**
 * Rate limit error (retryable with backoff)
 */
export class RateLimitError extends AppError {
  public readonly retryAfter?: number;

  constructor(
    message: string,
    retryAfter?: number,
    metadata?: Record<string, unknown>
  ) {
    super(message, {
      category: ErrorCategory.RATE_LIMIT,
      severity: ErrorSeverity.MEDIUM,
      retryable: true,
      statusCode: 429,
      metadata: { ...metadata, retryAfter },
    });
    this.retryAfter = retryAfter;
  }
}

/**
 * Task execution error
 */
export class TaskExecutionError extends AppError {
  constructor(
    taskId: string,
    message: string,
    retryable: boolean = false,
    metadata?: Record<string, unknown>
  ) {
    super(message, {
      category: ErrorCategory.EXECUTION,
      severity: ErrorSeverity.HIGH,
      retryable,
      statusCode: 500,
      metadata: { ...metadata, taskId },
    });
  }
}

/**
 * Type guard to check if error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Type guard to check if error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (isAppError(error)) {
    return error.retryable;
  }
  
  // Network errors are generally retryable
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('enotfound') ||
      message.includes('etimedout')
    );
  }
  
  return false;
}

/**
 * Convert unknown error to AppError
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof Error) {
    // Try to infer category from error message
    const message = error.message.toLowerCase();
    
    if (message.includes('timeout') || message.includes('etimedout')) {
      return new TimeoutError('Operation', 0, { originalError: error.message });
    }
    
    if (message.includes('network') || message.includes('econnreset')) {
      return new NetworkError(error.message, error);
    }
    
    if (message.includes('unauthorized') || message.includes('forbidden')) {
      return new AuthenticationError(error.message);
    }
    
    if (message.includes('not found')) {
      return new AppError(error.message, {
        category: ErrorCategory.NOT_FOUND,
        statusCode: 404,
      });
    }
    
    // Default: unknown error
    return new AppError(error.message, {
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.MEDIUM,
      cause: error,
    });
  }

  // Non-Error objects
  return new AppError(String(error), {
    category: ErrorCategory.UNKNOWN,
    severity: ErrorSeverity.MEDIUM,
    metadata: { originalError: error },
  });
}

/**
 * Retry configuration based on error type
 */
export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

/**
 * Get retry configuration for an error
 */
export function getRetryConfig(error: AppError): RetryConfig | null {
  if (!error.retryable) {
    return null;
  }

  // Rate limit errors - respect retry-after
  if (error instanceof RateLimitError && error.retryAfter) {
    return {
      maxAttempts: 3,
      initialDelayMs: error.retryAfter * 1000,
      maxDelayMs: error.retryAfter * 1000,
      backoffMultiplier: 1,
    };
  }

  // Network errors - aggressive retry
  if (error.category === ErrorCategory.NETWORK) {
    return {
      maxAttempts: 5,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
    };
  }

  // Timeout errors - moderate retry
  if (error.category === ErrorCategory.TIMEOUT) {
    return {
      maxAttempts: 3,
      initialDelayMs: 2000,
      maxDelayMs: 60000,
      backoffMultiplier: 2,
    };
  }

  // External API errors - conservative retry
  if (error.category === ErrorCategory.EXTERNAL_API) {
    return {
      maxAttempts: 3,
      initialDelayMs: 5000,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
    };
  }

  // Default retry config
  return {
    maxAttempts: 3,
    initialDelayMs: 2000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
  };
}
