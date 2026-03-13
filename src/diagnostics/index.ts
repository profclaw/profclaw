/**
 * Diagnostics Module
 *
 * Lightweight OpenTelemetry-compatible tracing and metrics.
 */

export {
  startSpan,
  endSpan,
  addSpanEvent,
  setSpanAttribute,
  trace,
  recordMetric,
  incrementCounter,
  getDiagnostics,
  getTraceSpans,
  configureDiagnostics,
  stopDiagnostics,
  parseTraceparent,
  formatTraceparent,
} from './tracer.js';

export type {
  Span,
  SpanEvent,
  SpanKind,
  SpanStatus,
  TraceContext,
  MetricPoint,
  SpanExporter,
  DiagnosticsConfig,
  MetricSummary,
  DiagnosticsSnapshot,
} from './tracer.js';

export { tracingMiddleware } from './middleware.js';

export {
  createConsoleExporter,
  createFileExporter,
  createOTLPExporter,
} from './exporters.js';
