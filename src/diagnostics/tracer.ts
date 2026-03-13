/**
 * Lightweight Tracing / Diagnostics
 *
 * OpenTelemetry-compatible trace context without the full SDK.
 * Provides:
 * - Span creation and nesting
 * - Trace context propagation (W3C traceparent)
 * - Performance metrics collection
 * - Export interface for future OTEL integration
 */

import { randomBytes } from 'crypto';
import { logger } from '../utils/logger.js';

// --- Types ---

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: SpanKind;
  startTime: number;
  endTime?: number;
  status: SpanStatus;
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, string | number | boolean>;
}

export type SpanKind = 'internal' | 'server' | 'client' | 'producer' | 'consumer';
export type SpanStatus = 'unset' | 'ok' | 'error';

export interface TraceContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
}

export interface MetricPoint {
  name: string;
  value: number;
  labels: Record<string, string>;
  timestamp: number;
}

export interface SpanExporter {
  export: (spans: Span[]) => Promise<void>;
}

export interface DiagnosticsConfig {
  enabled: boolean;
  sampleRate: number;       // 0.0 - 1.0
  maxSpans: number;         // Buffer size before eviction
  exportIntervalMs: number;
  exporter?: SpanExporter;
}

// --- State ---

const DEFAULT_CONFIG: DiagnosticsConfig = {
  enabled: true,
  sampleRate: 1.0,
  maxSpans: 1000,
  exportIntervalMs: 30_000,
};

let config: DiagnosticsConfig = { ...DEFAULT_CONFIG };
const activeSpans = new Map<string, Span>();
const completedSpans: Span[] = [];
const metrics: MetricPoint[] = [];
let exportInterval: ReturnType<typeof setInterval> | null = null;

/** Null trace ID sentinel for unsampled spans */
const NULL_TRACE_ID = '0'.repeat(32);

// --- Trace Context (W3C traceparent) ---

/**
 * Generate a new trace ID (32 hex chars)
 */
function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Generate a new span ID (16 hex chars)
 */
function generateSpanId(): string {
  return randomBytes(8).toString('hex');
}

/**
 * Parse W3C traceparent header.
 * Format: version-traceId-parentId-traceFlags
 * Example: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
 */
export function parseTraceparent(header: string): TraceContext | null {
  const parts = header.split('-');
  if (parts.length !== 4) return null;
  if (parts[0] !== '00') return null; // Only version 00
  if (parts[1].length !== 32 || parts[2].length !== 16) return null;

  return {
    traceId: parts[1],
    spanId: parts[2],
    traceFlags: parseInt(parts[3], 16),
  };
}

/**
 * Format W3C traceparent header
 */
export function formatTraceparent(ctx: TraceContext): string {
  return `00-${ctx.traceId}-${ctx.spanId}-${ctx.traceFlags.toString(16).padStart(2, '0')}`;
}

// --- Span Operations ---

/**
 * Start a new span
 */
export function startSpan(
  name: string,
  options: {
    kind?: SpanKind;
    parentSpanId?: string;
    traceId?: string;
    attributes?: Record<string, string | number | boolean>;
  } = {},
): Span {
  // Return a no-op span when disabled or not sampled
  if (!config.enabled || Math.random() > config.sampleRate) {
    return {
      traceId: NULL_TRACE_ID,
      spanId: '0'.repeat(16),
      name,
      kind: 'internal',
      startTime: Date.now(),
      status: 'unset',
      attributes: {},
      events: [],
    };
  }

  const span: Span = {
    traceId: options.traceId ?? generateTraceId(),
    spanId: generateSpanId(),
    parentSpanId: options.parentSpanId,
    name,
    kind: options.kind ?? 'internal',
    startTime: Date.now(),
    status: 'unset',
    attributes: options.attributes ?? {},
    events: [],
  };

  activeSpans.set(span.spanId, span);
  return span;
}

/**
 * End a span and record its duration
 */
export function endSpan(span: Span, status?: SpanStatus): void {
  span.endTime = Date.now();
  span.status = status ?? 'ok';

  activeSpans.delete(span.spanId);

  // Only store sampled spans
  if (span.traceId !== NULL_TRACE_ID) {
    completedSpans.push(span);

    // Evict oldest if buffer full
    while (completedSpans.length > config.maxSpans) {
      completedSpans.shift();
    }

    // Record duration metric
    recordMetric('span.duration_ms', span.endTime - span.startTime, {
      name: span.name,
      kind: span.kind,
      status: span.status,
    });
  }
}

/**
 * Add an event to a span
 */
export function addSpanEvent(
  span: Span,
  name: string,
  attributes?: Record<string, string | number | boolean>,
): void {
  span.events.push({ name, timestamp: Date.now(), attributes });
}

/**
 * Set a span attribute
 */
export function setSpanAttribute(
  span: Span,
  key: string,
  value: string | number | boolean,
): void {
  span.attributes[key] = value;
}

/**
 * Convenience: trace an async function execution as a span
 */
export async function trace<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  options?: {
    kind?: SpanKind;
    attributes?: Record<string, string | number | boolean>;
  },
): Promise<T> {
  const span = startSpan(name, options);
  try {
    const result = await fn(span);
    endSpan(span, 'ok');
    return result;
  } catch (error) {
    span.attributes['error.message'] = error instanceof Error ? error.message : String(error);
    span.attributes['error.type'] = error instanceof Error ? error.constructor.name : 'unknown';
    endSpan(span, 'error');
    throw error;
  }
}

// --- Metrics ---

/**
 * Record a metric point
 */
export function recordMetric(
  name: string,
  value: number,
  labels: Record<string, string> = {},
): void {
  if (!config.enabled) return;

  metrics.push({ name, value, labels, timestamp: Date.now() });

  // Evict old metrics (keep last 5000)
  while (metrics.length > 5000) {
    metrics.shift();
  }
}

/**
 * Increment a counter metric by 1
 */
export function incrementCounter(name: string, labels: Record<string, string> = {}): void {
  recordMetric(name, 1, labels);
}

// --- Diagnostics API ---

export interface MetricSummary {
  count: number;
  avg: number;
  min: number;
  max: number;
}

export interface DiagnosticsSnapshot {
  activeSpans: number;
  completedSpans: number;
  metricsCount: number;
  config: Omit<DiagnosticsConfig, 'exporter'>;
  recentSpans: Array<{
    name: string;
    durationMs: number;
    status: SpanStatus;
    traceId: string;
  }>;
  metricsSummary: Record<string, MetricSummary>;
}

/**
 * Get a snapshot of current diagnostics state
 */
export function getDiagnostics(): DiagnosticsSnapshot {
  // Summarize the 20 most recent completed spans
  const recentSpans = completedSpans.slice(-20).map(s => ({
    name: s.name,
    durationMs: (s.endTime ?? Date.now()) - s.startTime,
    status: s.status,
    traceId: s.traceId,
  }));

  // Aggregate metrics by name
  const metricsSummary: Record<string, MetricSummary> = {};
  for (const m of metrics) {
    if (!metricsSummary[m.name]) {
      metricsSummary[m.name] = { count: 0, avg: 0, min: Infinity, max: -Infinity };
    }
    const s = metricsSummary[m.name];
    s.avg = (s.avg * s.count + m.value) / (s.count + 1);
    s.count += 1;
    s.min = Math.min(s.min, m.value);
    s.max = Math.max(s.max, m.value);
  }

  // Omit exporter (not serialisable) from config snapshot
  const { exporter: _exporter, ...configWithoutExporter } = config;

  return {
    activeSpans: activeSpans.size,
    completedSpans: completedSpans.length,
    metricsCount: metrics.length,
    config: configWithoutExporter,
    recentSpans,
    metricsSummary,
  };
}

/**
 * Get all completed spans belonging to a specific trace
 */
export function getTraceSpans(traceId: string): Span[] {
  return completedSpans.filter(s => s.traceId === traceId);
}

// --- Configuration ---

/**
 * Configure the diagnostics system.
 * Restarts the export interval if the interval or exporter changed.
 */
export function configureDiagnostics(newConfig: Partial<DiagnosticsConfig>): void {
  config = { ...config, ...newConfig };

  // Restart export interval
  if (exportInterval) {
    clearInterval(exportInterval);
    exportInterval = null;
  }

  if (config.enabled && config.exporter) {
    exportInterval = setInterval(() => {
      exportSpans().catch((err: unknown) => {
        logger.warn('[Diagnostics] Export failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, config.exportIntervalMs);
  }

  logger.info('[Diagnostics] Configuration updated', {
    enabled: config.enabled,
    sampleRate: config.sampleRate,
    maxSpans: config.maxSpans,
  });
}

/**
 * Flush and export all completed spans via the configured exporter
 */
async function exportSpans(): Promise<void> {
  if (!config.exporter || completedSpans.length === 0) return;

  const toExport = completedSpans.splice(0, completedSpans.length);
  await config.exporter.export(toExport);
  logger.debug('[Diagnostics] Exported spans', { count: toExport.length });
}

/**
 * Stop the diagnostics system and clear all buffers
 */
export function stopDiagnostics(): void {
  if (exportInterval) {
    clearInterval(exportInterval);
    exportInterval = null;
  }
  activeSpans.clear();
  completedSpans.length = 0;
  metrics.length = 0;
  logger.info('[Diagnostics] Stopped');
}
