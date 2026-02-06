/**
 * Request/Response Logging Middleware for Hono
 * 
 * Logs all HTTP requests and responses with:
 * - Correlation IDs for request tracing
 * - Request details (method, path, headers)
 * - Response details (status, duration)
 * - Error tracking
 */

import type { Context, Next } from 'hono';
import { 
  logger, 
  generateCorrelationId, 
  withCorrelation,
  type LogContext 
} from '../utils/logger.js';

/**
 * Request logging middleware
 */
export async function requestLogger(c: Context, next: Next): Promise<void> {
  // Generate or extract correlation ID
  const correlationId = 
    c.req.header('X-Correlation-ID') || 
    c.req.header('X-Request-ID') ||
    generateCorrelationId();

  // Add correlation ID to response headers
  c.header('X-Correlation-ID', correlationId);

  const startTime = Date.now();
  const method = c.req.method;
  const path = c.req.path;
  const userAgent = c.req.header('User-Agent');
  const ip = c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP') || 'unknown';

  // Create request context
  const requestContext: LogContext = {
    correlationId,
    method,
    path,
    ip,
    userAgent,
  };

  // Log incoming request
  logger.info('→ Incoming request', requestContext);

  // Run the request handler within correlation context
  try {
    await withCorrelation(correlationId, async () => {
      await next();
    });

    // Log successful response
    const duration = Date.now() - startTime;
    const status = c.res.status;

    logger.info('← Response sent', {
      ...requestContext,
      status,
      duration,
    });
  } catch (error) {
    // Log error response
    const duration = Date.now() - startTime;
    
    logger.error('← Error response', error as Error, {
      ...requestContext,
      duration,
    });

    // Re-throw to let error handler deal with it
    throw error;
  }
}

/**
 * Request body logging middleware (use with caution)
 * Only logs for non-GET requests and respects content type
 */
export async function requestBodyLogger(c: Context, next: Next): Promise<void> {
  const correlationId = c.req.header('X-Correlation-ID') || generateCorrelationId();

  // Only log non-GET requests
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const contentType = c.req.header('Content-Type') || '';

    // Only log JSON payloads
    if (contentType.includes('application/json')) {
      try {
        const body = await c.req.json();
        
        logger.debug('Request body', {
          correlationId,
          body: sanitizeBody(body),
        });

        // Re-create request with body (since we consumed it)
        c.req.raw = new Request(c.req.url, {
          method: c.req.method,
          headers: c.req.raw.headers,
          body: JSON.stringify(body),
        });
      } catch (error) {
        logger.warn('Failed to parse request body as JSON', {
          correlationId,
        });
      }
    }
  }

  await next();
}

/**
 * Sanitize request/response bodies
 * Removes sensitive data like passwords, tokens, etc.
 */
function sanitizeBody(body: any): any {
  if (!body || typeof body !== 'object') {
    return body;
  }

  const sensitiveFields = [
    'password',
    'token',
    'secret',
    'apiKey',
    'api_key',
    'accessToken',
    'access_token',
    'refreshToken',
    'refresh_token',
    'privateKey',
    'private_key',
  ];

  const sanitized = Array.isArray(body) ? [...body] : { ...body };

  for (const key of Object.keys(sanitized)) {
    const lowerKey = key.toLowerCase();
    
    // Check if key contains sensitive field name
    if (sensitiveFields.some((field) => lowerKey.includes(field.toLowerCase()))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      // Recursively sanitize nested objects
      sanitized[key] = sanitizeBody(sanitized[key]);
    }
  }

  return sanitized;
}

/**
 * Response time header middleware
 */
export async function responseTimeHeader(c: Context, next: Next): Promise<void> {
  const startTime = Date.now();
  
  await next();
  
  const duration = Date.now() - startTime;
  c.header('X-Response-Time', `${duration}ms`);
}

/**
 * Error logging middleware
 * Should be added early in middleware chain
 */
export async function errorLogger(c: Context, next: Next): Promise<Response | void> {
  try {
    await next();
  } catch (error) {
    const correlationId = c.req.header('X-Correlation-ID') || 'unknown';
    
    logger.error('Unhandled error in request', error as Error, {
      correlationId,
      method: c.req.method,
      path: c.req.path,
    });

    // Return error response
    return c.json(
      {
        error: 'Internal Server Error',
        correlationId,
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
}

/**
 * Slow request logger
 * Logs warning for requests exceeding threshold
 */
export function slowRequestLogger(thresholdMs: number = 1000) {
  return async function (c: Context, next: Next): Promise<void> {
    const startTime = Date.now();
    const correlationId = c.req.header('X-Correlation-ID') || 'unknown';

    await next();

    const duration = Date.now() - startTime;
    
    if (duration > thresholdMs) {
      logger.warn('Slow request detected', {
        correlationId,
        method: c.req.method,
        path: c.req.path,
        duration,
        threshold: thresholdMs,
      });
    }
  };
}
