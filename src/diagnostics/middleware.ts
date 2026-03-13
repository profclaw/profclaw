/**
 * Diagnostics Middleware for Hono
 *
 * Automatically traces HTTP requests and propagates W3C traceparent context.
 */

import type { Context, Next } from 'hono';
import {
  startSpan,
  endSpan,
  setSpanAttribute,
  parseTraceparent,
  formatTraceparent,
  incrementCounter,
  recordMetric,
} from './tracer.js';
import type { SpanKind } from './tracer.js';

/**
 * Request tracing middleware.
 * Adds a server span to every request and propagates W3C traceparent.
 */
export async function tracingMiddleware(c: Context, next: Next): Promise<void> {
  // Parse incoming traceparent to continue an existing trace
  const traceparentHeader = c.req.header('traceparent');
  const parentContext = traceparentHeader ? parseTraceparent(traceparentHeader) : null;

  const spanKind: SpanKind = 'server';
  const span = startSpan(`${c.req.method} ${c.req.routePath || c.req.path}`, {
    kind: spanKind,
    traceId: parentContext?.traceId,
    parentSpanId: parentContext?.spanId,
    attributes: {
      'http.method': c.req.method,
      'http.url': c.req.path,
      'http.user_agent': c.req.header('User-Agent') ?? 'unknown',
    },
  });

  // Propagate trace context to the response so callers can correlate
  c.header('traceparent', formatTraceparent({
    traceId: span.traceId,
    spanId: span.spanId,
    traceFlags: 1,
  }));

  // Store span in Hono context variables for downstream handlers
  c.set('span', span);

  incrementCounter('http.requests', {
    method: c.req.method,
    path: c.req.routePath || c.req.path,
  });

  const startTime = Date.now();

  try {
    await next();

    const status = c.res.status;
    setSpanAttribute(span, 'http.status_code', status);

    const durationMs = Date.now() - startTime;
    recordMetric('http.response_time_ms', durationMs, {
      method: c.req.method,
      path: c.req.routePath || c.req.path,
      status: String(status),
    });

    endSpan(span, status >= 400 ? 'error' : 'ok');
  } catch (error) {
    setSpanAttribute(span, 'error', true);
    setSpanAttribute(
      span,
      'error.message',
      error instanceof Error ? error.message : String(error),
    );
    endSpan(span, 'error');
    throw error;
  }
}
