/**
 * Span Exporters
 *
 * Pluggable export targets for collected spans.
 * Ready for OTEL collector integration.
 */

import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import type { Span, SpanExporter } from './tracer.js';

/**
 * Console exporter - writes spans to the structured logger at debug level
 */
export function createConsoleExporter(): SpanExporter {
  return {
    export: async (spans: Span[]): Promise<void> => {
      for (const span of spans) {
        logger.debug('[Trace]', {
          traceId: span.traceId,
          spanId: span.spanId,
          name: span.name,
          durationMs: span.endTime !== undefined ? span.endTime - span.startTime : undefined,
          status: span.status,
        });
      }
    },
  };
}

/**
 * File exporter - appends spans as JSONL to a date-stamped file
 */
export function createFileExporter(outputDir?: string): SpanExporter {
  const dir = outputDir ?? path.resolve(process.cwd(), 'data', 'traces');

  return {
    export: async (spans: Span[]): Promise<void> => {
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }

      const date = new Date().toISOString().split('T')[0];
      const filePath = path.join(dir, `traces-${date}.jsonl`);

      const lines = spans.map(s => JSON.stringify(s)).join('\n') + '\n';
      await writeFile(filePath, lines, { flag: 'a' });

      logger.debug('[Trace] Exported to file', { file: filePath, count: spans.length });
    },
  };
}

// OTLP attribute value shape
type OTLPAttributeValue =
  | { stringValue: string }
  | { intValue: string }
  | { boolValue: boolean };

function toOTLPValue(v: string | number | boolean): OTLPAttributeValue {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'number') return { intValue: String(v) };
  return { boolValue: v };
}

function spanKindToOTLP(kind: string): number {
  const map: Record<string, number> = {
    server: 2,
    client: 3,
    producer: 4,
    consumer: 5,
    internal: 1,
  };
  return map[kind] ?? 1;
}

function spanStatusToOTLP(status: string): number {
  if (status === 'error') return 2;
  if (status === 'ok') return 1;
  return 0;
}

/**
 * OTLP HTTP exporter - sends spans to an OpenTelemetry collector endpoint.
 * Uses a 5-second abort timeout so export failures do not block the process.
 */
export function createOTLPExporter(endpoint: string): SpanExporter {
  return {
    export: async (spans: Span[]): Promise<void> => {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resourceSpans: [
              {
                resource: {
                  attributes: [
                    { key: 'service.name', value: { stringValue: 'profclaw' } },
                    { key: 'service.version', value: { stringValue: '2.0.0' } },
                  ],
                },
                scopeSpans: [
                  {
                    spans: spans.map(s => ({
                      traceId: s.traceId,
                      spanId: s.spanId,
                      parentSpanId: s.parentSpanId,
                      name: s.name,
                      kind: spanKindToOTLP(s.kind),
                      startTimeUnixNano: BigInt(s.startTime * 1_000_000).toString(),
                      endTimeUnixNano:
                        s.endTime !== undefined
                          ? BigInt(s.endTime * 1_000_000).toString()
                          : undefined,
                      status: { code: spanStatusToOTLP(s.status) },
                      attributes: Object.entries(s.attributes).map(([k, v]) => ({
                        key: k,
                        value: toOTLPValue(v),
                      })),
                      events: s.events.map(e => ({
                        name: e.name,
                        timeUnixNano: BigInt(e.timestamp * 1_000_000).toString(),
                        attributes: e.attributes
                          ? Object.entries(e.attributes).map(([k, v]) => ({
                              key: k,
                              value: toOTLPValue(v),
                            }))
                          : [],
                      })),
                    })),
                  },
                ],
              },
            ],
          }),
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
          logger.warn('[OTLP] Export failed', { status: response.status });
        }
      } catch (err) {
        logger.warn('[OTLP] Export error', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
