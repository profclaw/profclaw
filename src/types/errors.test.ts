import { describe, it, expect } from 'vitest';
import {
  AppError,
  ConfigurationError,
  AuthenticationError,
  NetworkError,
  ExternalAPIError,
  ValidationError,
  NotFoundError,
  TimeoutError,
  RateLimitError,
  TaskExecutionError,
  ErrorCategory,
  ErrorSeverity,
  isAppError,
  isRetryableError,
  toAppError,
  getRetryConfig,
} from './errors.js';

describe('Error Types', () => {
  describe('AppError', () => {
    it('should create error with all properties', () => {
      const error = new AppError('Test error', {
        category: ErrorCategory.EXECUTION,
        severity: ErrorSeverity.HIGH,
        retryable: true,
        statusCode: 500,
        metadata: { foo: 'bar' },
        correlationId: 'test-123',
      });

      expect(error.message).toBe('Test error');
      expect(error.category).toBe(ErrorCategory.EXECUTION);
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.retryable).toBe(true);
      expect(error.statusCode).toBe(500);
      expect(error.metadata).toEqual({ foo: 'bar' });
      expect(error.correlationId).toBe('test-123');
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    it('should use default severity if not provided', () => {
      const error = new AppError('Test', {
        category: ErrorCategory.UNKNOWN,
      });

      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
    });

    it('should default retryable to false if not specified', () => {
      const error = new AppError('Test', {
        category: ErrorCategory.VALIDATION,
      });

      expect(error.retryable).toBe(false);
    });

    it('should convert to JSON correctly', () => {
      const error = new AppError('Test error', {
        category: ErrorCategory.NETWORK,
        severity: ErrorSeverity.LOW,
        retryable: true,
        statusCode: 503,
        metadata: { key: 'value' },
      });

      const json = error.toJSON();

      expect(json.name).toBe('AppError');
      expect(json.message).toBe('Test error');
      expect(json.category).toBe(ErrorCategory.NETWORK);
      expect(json.severity).toBe(ErrorSeverity.LOW);
      expect(json.retryable).toBe(true);
      expect(json.statusCode).toBe(503);
      expect(json.metadata).toEqual({ key: 'value' });
      expect(json.timestamp).toBeDefined();
      expect(json.stack).toBeDefined();
    });

    it('should preserve error cause', () => {
      const cause = new Error('Original error');
      const error = new AppError('Wrapped error', {
        category: ErrorCategory.UNKNOWN,
        cause,
      });

      expect(error.cause).toBe(cause);
    });
  });

  describe('ConfigurationError', () => {
    it('should create non-retryable critical error', () => {
      const error = new ConfigurationError('Missing API key', { key: 'API_KEY' });

      expect(error.message).toBe('Missing API key');
      expect(error.category).toBe(ErrorCategory.CONFIGURATION);
      expect(error.severity).toBe(ErrorSeverity.CRITICAL);
      expect(error.retryable).toBe(false);
      expect(error.statusCode).toBe(500);
      expect(error.metadata).toEqual({ key: 'API_KEY' });
    });
  });

  describe('AuthenticationError', () => {
    it('should create non-retryable auth error', () => {
      const error = new AuthenticationError('Invalid token', { userId: '123' });

      expect(error.message).toBe('Invalid token');
      expect(error.category).toBe(ErrorCategory.AUTHENTICATION);
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.retryable).toBe(false);
      expect(error.statusCode).toBe(401);
    });
  });

  describe('NetworkError', () => {
    it('should create retryable network error', () => {
      const cause = new Error('ECONNRESET');
      const error = new NetworkError('Connection reset', cause, { host: 'api.example.com' });

      expect(error.message).toBe('Connection reset');
      expect(error.category).toBe(ErrorCategory.NETWORK);
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
      expect(error.retryable).toBe(true);
      expect(error.statusCode).toBe(503);
      expect(error.cause).toBe(cause);
    });
  });

  describe('ExternalAPIError', () => {
    it('should create API error with custom retryable flag', () => {
      const error = new ExternalAPIError('API rate limit', 429, true, { endpoint: '/api/tasks' });

      expect(error.message).toBe('API rate limit');
      expect(error.category).toBe(ErrorCategory.EXTERNAL_API);
      expect(error.retryable).toBe(true);
      expect(error.statusCode).toBe(429);
    });

    it('should set high severity for 5xx errors', () => {
      const error = new ExternalAPIError('Server error', 500, false);

      expect(error.severity).toBe(ErrorSeverity.HIGH);
    });

    it('should set medium severity for 4xx errors', () => {
      const error = new ExternalAPIError('Bad request', 400, false);

      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
    });
  });

  describe('ValidationError', () => {
    it('should create non-retryable validation error', () => {
      const error = new ValidationError('Invalid email format', { field: 'email' });

      expect(error.message).toBe('Invalid email format');
      expect(error.category).toBe(ErrorCategory.VALIDATION);
      expect(error.severity).toBe(ErrorSeverity.LOW);
      expect(error.retryable).toBe(false);
      expect(error.statusCode).toBe(400);
    });
  });

  describe('NotFoundError', () => {
    it('should create not found error with resource details', () => {
      const error = new NotFoundError('Task', 'task-123', { userId: 'user-456' });

      expect(error.message).toBe('Task not found: task-123');
      expect(error.category).toBe(ErrorCategory.NOT_FOUND);
      expect(error.severity).toBe(ErrorSeverity.LOW);
      expect(error.retryable).toBe(false);
      expect(error.statusCode).toBe(404);
      expect(error.metadata).toEqual({
        resource: 'Task',
        id: 'task-123',
        userId: 'user-456',
      });
    });
  });

  describe('TimeoutError', () => {
    it('should create retryable timeout error', () => {
      const error = new TimeoutError('API call', 5000, { endpoint: '/api/health' });

      expect(error.message).toBe('Operation timed out after 5000ms: API call');
      expect(error.category).toBe(ErrorCategory.TIMEOUT);
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
      expect(error.retryable).toBe(true);
      expect(error.statusCode).toBe(504);
      expect(error.metadata).toEqual({
        operation: 'API call',
        timeoutMs: 5000,
        endpoint: '/api/health',
      });
    });
  });

  describe('RateLimitError', () => {
    it('should create retryable rate limit error with retry-after', () => {
      const error = new RateLimitError('Rate limit exceeded', 60, { limit: 100 });

      expect(error.message).toBe('Rate limit exceeded');
      expect(error.category).toBe(ErrorCategory.RATE_LIMIT);
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
      expect(error.retryable).toBe(true);
      expect(error.statusCode).toBe(429);
      expect(error.retryAfter).toBe(60);
      expect(error.metadata).toEqual({ retryAfter: 60, limit: 100 });
    });

    it('should work without retry-after', () => {
      const error = new RateLimitError('Rate limit exceeded');

      expect(error.retryAfter).toBeUndefined();
    });
  });

  describe('TaskExecutionError', () => {
    it('should create task execution error', () => {
      const error = new TaskExecutionError('task-789', 'Agent failed', true, { agent: 'openclaw' });

      expect(error.message).toBe('Agent failed');
      expect(error.category).toBe(ErrorCategory.EXECUTION);
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.retryable).toBe(true);
      expect(error.metadata).toEqual({
        taskId: 'task-789',
        agent: 'openclaw',
      });
    });
  });

  describe('isAppError', () => {
    it('should return true for AppError instances', () => {
      const error = new AppError('Test', { category: ErrorCategory.UNKNOWN });
      expect(isAppError(error)).toBe(true);
    });

    it('should return true for AppError subclasses', () => {
      const error = new NetworkError('Test');
      expect(isAppError(error)).toBe(true);
    });

    it('should return false for regular Error', () => {
      const error = new Error('Test');
      expect(isAppError(error)).toBe(false);
    });

    it('should return false for non-errors', () => {
      expect(isAppError('string')).toBe(false);
      expect(isAppError(null)).toBe(false);
      expect(isAppError(undefined)).toBe(false);
      expect(isAppError({})).toBe(false);
    });
  });

  describe('isRetryableError', () => {
    it('should return true for retryable AppErrors', () => {
      const error = new NetworkError('Test');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return false for non-retryable AppErrors', () => {
      const error = new ValidationError('Test');
      expect(isRetryableError(error)).toBe(false);
    });

    it('should detect network errors from message', () => {
      expect(isRetryableError(new Error('network timeout'))).toBe(true);
      expect(isRetryableError(new Error('ECONNRESET'))).toBe(true);
      expect(isRetryableError(new Error('ENOTFOUND'))).toBe(true);
      expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true);
    });

    it('should return false for non-network errors', () => {
      expect(isRetryableError(new Error('Invalid input'))).toBe(false);
    });

    it('should return false for non-errors', () => {
      expect(isRetryableError('string')).toBe(false);
      expect(isRetryableError(null)).toBe(false);
    });
  });

  describe('toAppError', () => {
    it('should return AppError as-is', () => {
      const error = new NetworkError('Test');
      expect(toAppError(error)).toBe(error);
    });

    it('should convert timeout error', () => {
      const error = new Error('Operation timeout');
      const appError = toAppError(error);

      expect(appError).toBeInstanceOf(TimeoutError);
      expect(appError.category).toBe(ErrorCategory.TIMEOUT);
    });

    it('should convert network error', () => {
      const error = new Error('Network connection failed');
      const appError = toAppError(error);

      expect(appError).toBeInstanceOf(NetworkError);
      expect(appError.category).toBe(ErrorCategory.NETWORK);
    });

    it('should convert auth error', () => {
      const error = new Error('Unauthorized access');
      const appError = toAppError(error);

      expect(appError).toBeInstanceOf(AuthenticationError);
      expect(appError.category).toBe(ErrorCategory.AUTHENTICATION);
    });

    it('should convert not found error', () => {
      const error = new Error('Resource not found');
      const appError = toAppError(error);

      expect(appError.category).toBe(ErrorCategory.NOT_FOUND);
      expect(appError.statusCode).toBe(404);
    });

    it('should convert unknown errors', () => {
      const error = new Error('Something went wrong');
      const appError = toAppError(error);

      expect(appError.category).toBe(ErrorCategory.UNKNOWN);
      expect(appError.message).toBe('Something went wrong');
    });

    it('should convert non-Error objects', () => {
      const appError = toAppError('String error');

      expect(appError.category).toBe(ErrorCategory.UNKNOWN);
      expect(appError.message).toBe('String error');
    });

    it('should handle null/undefined', () => {
      expect(toAppError(null).message).toBe('null');
      expect(toAppError(undefined).message).toBe('undefined');
    });
  });

  describe('getRetryConfig', () => {
    it('should return null for non-retryable errors', () => {
      const error = new ValidationError('Test');
      expect(getRetryConfig(error)).toBeNull();
    });

    it('should provide rate limit config with retry-after', () => {
      const error = new RateLimitError('Test', 30);
      const config = getRetryConfig(error);

      expect(config).toBeDefined();
      expect(config!.maxAttempts).toBe(3);
      expect(config!.initialDelayMs).toBe(30000);
      expect(config!.maxDelayMs).toBe(30000);
      expect(config!.backoffMultiplier).toBe(1);
    });

    it('should provide aggressive retry for network errors', () => {
      const error = new NetworkError('Test');
      const config = getRetryConfig(error);

      expect(config).toBeDefined();
      expect(config!.maxAttempts).toBe(5);
      expect(config!.initialDelayMs).toBe(1000);
      expect(config!.maxDelayMs).toBe(30000);
      expect(config!.backoffMultiplier).toBe(2);
    });

    it('should provide moderate retry for timeout errors', () => {
      const error = new TimeoutError('Test', 5000);
      const config = getRetryConfig(error);

      expect(config).toBeDefined();
      expect(config!.maxAttempts).toBe(3);
      expect(config!.initialDelayMs).toBe(2000);
      expect(config!.maxDelayMs).toBe(60000);
      expect(config!.backoffMultiplier).toBe(2);
    });

    it('should provide conservative retry for external API errors', () => {
      const error = new ExternalAPIError('Test', 502, true);
      const config = getRetryConfig(error);

      expect(config).toBeDefined();
      expect(config!.maxAttempts).toBe(3);
      expect(config!.initialDelayMs).toBe(5000);
      expect(config!.maxDelayMs).toBe(30000);
    });

    it('should provide default config for other retryable errors', () => {
      const error = new TaskExecutionError('task-1', 'Test', true);
      const config = getRetryConfig(error);

      expect(config).toBeDefined();
      expect(config!.maxAttempts).toBe(3);
      expect(config!.initialDelayMs).toBe(2000);
    });
  });
});
