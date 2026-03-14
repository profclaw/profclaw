/**
 * Metrics Tracking System
 *
 * Tracks and aggregates metrics for:
 * - Task processing (duration, success rate, throughput)
 * - Queue depth and wait times
 * - Adapter performance
 * - Circuit breaker states
 * - Error rates by category
 */

import type { TaskStatusType } from "../types/task.js";
import type { ErrorCategory } from "../types/errors.js";
import type { CircuitState } from "./circuit-breaker.js";

/**
 * Metric types
 */
export enum MetricType {
  COUNTER = "COUNTER", // Cumulative count
  GAUGE = "GAUGE", // Current value
  HISTOGRAM = "HISTOGRAM", // Distribution of values
  SUMMARY = "SUMMARY", // Statistical summary
}

/**
 * Metric data structure
 */
interface Metric {
  type: MetricType;
  name: string;
  value: number;
  labels?: Record<string, string>;
  timestamp: Date;
}

/**
 * Histogram bucket for distribution tracking
 */
interface HistogramBucket {
  le: number; // Less than or equal to
  count: number;
}

/**
 * Histogram metric data
 */
interface HistogramData {
  count: number;
  sum: number;
  buckets: HistogramBucket[];
}

/**
 * Summary metric data (percentiles)
 */
interface SummaryData {
  count: number;
  sum: number;
  percentiles: Map<number, number>; // p50, p95, p99, etc.
}

/**
 * Metrics collector
 */
class MetricsCollector {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<string, HistogramData>();
  private summaries = new Map<string, number[]>(); // Store raw values for percentiles

  /**
   * Increment a counter
   */
  incrementCounter(
    name: string,
    labels?: Record<string, string>,
    value: number = 1,
  ): void {
    const key = this.getKey(name, labels);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + value);
  }

  /**
   * Set a gauge value
   */
  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.getKey(name, labels);
    this.gauges.set(key, value);
  }

  /**
   * Observe a value in histogram
   */
  observeHistogram(
    name: string,
    value: number,
    labels?: Record<string, string>,
  ): void {
    const key = this.getKey(name, labels);
    let histogram = this.histograms.get(key);

    if (!histogram) {
      histogram = {
        count: 0,
        sum: 0,
        buckets: this.createBuckets([
          0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300,
        ]),
      };
      this.histograms.set(key, histogram);
    }

    histogram.count++;
    histogram.sum += value;

    // Update buckets
    for (const bucket of histogram.buckets) {
      if (value <= bucket.le) {
        bucket.count++;
      }
    }
  }

  /**
   * Observe a value in summary
   */
  observeSummary(
    name: string,
    value: number,
    labels?: Record<string, string>,
  ): void {
    const key = this.getKey(name, labels);
    let values = this.summaries.get(key);

    if (!values) {
      values = [];
      this.summaries.set(key, values);
    }

    values.push(value);

    // Keep only last 1000 values for memory efficiency
    if (values.length > 1000) {
      values.shift();
    }
  }

  /**
   * Get all metrics
   */
  getMetrics(): Metric[] {
    const metrics: Metric[] = [];
    const now = new Date();

    // Counters
    for (const [key, value] of this.counters) {
      const { name, labels } = this.parseKey(key);
      metrics.push({
        type: MetricType.COUNTER,
        name,
        value,
        labels,
        timestamp: now,
      });
    }

    // Gauges
    for (const [key, value] of this.gauges) {
      const { name, labels } = this.parseKey(key);
      metrics.push({
        type: MetricType.GAUGE,
        name,
        value,
        labels,
        timestamp: now,
      });
    }

    return metrics;
  }

  /**
   * Get histogram metrics
   */
  getHistogramMetrics(): Record<string, HistogramData> {
    const result: Record<string, HistogramData> = {};
    for (const [key, histogram] of this.histograms) {
      result[key] = histogram;
    }
    return result;
  }

  /**
   * Get summary metrics with percentiles
   */
  getSummaryMetrics(): Record<string, SummaryData> {
    const result: Record<string, SummaryData> = {};

    for (const [key, values] of this.summaries) {
      const sorted = [...values].sort((a, b) => a - b);
      const sum = sorted.reduce((acc, val) => acc + val, 0);

      result[key] = {
        count: values.length,
        sum,
        percentiles: new Map([
          [50, this.percentile(sorted, 50)],
          [95, this.percentile(sorted, 95)],
          [99, this.percentile(sorted, 99)],
        ]),
      };
    }

    return result;
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.summaries.clear();
  }

  /**
   * Create histogram buckets
   */
  private createBuckets(boundaries: number[]): HistogramBucket[] {
    return boundaries.map((le) => ({ le, count: 0 }));
  }

  /**
   * Calculate percentile
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Generate key from name and labels
   */
  private getKey(name: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return name;
    }
    const labelPairs = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(",");
    return `${name}{${labelPairs}}`;
  }

  /**
   * Parse key back to name and labels
   */
  private parseKey(key: string): {
    name: string;
    labels?: Record<string, string>;
  } {
    const match = key.match(/^([^{]+)(?:\{(.+)\})?$/);
    if (!match) return { name: key };

    const name = match[1];
    const labelsStr = match[2];

    if (!labelsStr) return { name };

    const labels: Record<string, string> = {};
    const pairs = labelsStr.split(",");
    for (const pair of pairs) {
      const [k, v] = pair.split("=");
      labels[k] = v.replace(/"/g, "");
    }

    return { name, labels };
  }
}

/**
 * Global metrics collector instance
 */
export const metrics = new MetricsCollector();

/**
 * Task-specific metrics tracker
 */
export class TaskMetrics {
  /**
   * Track task started
   */
  static taskStarted(status: TaskStatusType, source: string): void {
    metrics.incrementCounter("tasks_started_total", { status, source });
  }

  /**
   * Track task completed
   */
  static taskCompleted(
    success: boolean,
    duration: number,
    adapter: string,
    source: string,
  ): void {
    const status = success ? "success" : "failure";

    metrics.incrementCounter("tasks_completed_total", {
      status,
      adapter,
      source,
    });
    metrics.observeHistogram("task_duration_seconds", duration / 1000, {
      adapter,
    });
    metrics.observeSummary("task_duration_ms", duration, { adapter });
  }

  /**
   * Track task failed
   */
  static taskFailed(errorCategory: ErrorCategory, adapter: string): void {
    metrics.incrementCounter("tasks_failed_total", {
      error_category: errorCategory,
      adapter,
    });
  }

  /**
   * Track queue depth
   */
  static setQueueDepth(depth: number, status: TaskStatusType): void {
    metrics.setGauge("queue_depth", depth, { status });
  }

  /**
   * Track adapter health
   */
  static setAdapterHealth(adapter: string, healthy: boolean): void {
    metrics.setGauge("adapter_healthy", healthy ? 1 : 0, { adapter });
  }

  /**
   * Track circuit breaker state
   */
  static setCircuitBreakerState(name: string, state: CircuitState): void {
    const stateValue = state === "CLOSED" ? 0 : state === "HALF_OPEN" ? 1 : 2;
    metrics.setGauge("circuit_breaker_state", stateValue, { circuit: name });
  }
}

/**
 * HTTP metrics tracker
 */
export class HTTPMetrics {
  /**
   * Track HTTP request
   */
  static requestReceived(method: string, path: string): void {
    metrics.incrementCounter("http_requests_total", { method, path });
  }

  /**
   * Track HTTP response
   */
  static responseSent(
    method: string,
    path: string,
    status: number,
    duration: number,
  ): void {
    const statusClass = `${Math.floor(status / 100)}xx`;

    metrics.incrementCounter("http_responses_total", {
      method,
      path,
      status: status.toString(),
      status_class: statusClass,
    });

    metrics.observeHistogram("http_request_duration_seconds", duration / 1000, {
      method,
      path,
    });
  }

  /**
   * Track HTTP errors
   */
  static error(method: string, path: string, errorType: string): void {
    metrics.incrementCounter("http_errors_total", {
      method,
      path,
      error_type: errorType,
    });
  }
}

/**
 * Get metrics summary for health check
 */
export function getMetricsSummary(): {
  tasks: {
    total: number;
    success: number;
    failure: number;
    successRate: number;
  };
  queue: {
    depth: Record<string, number>;
  };
  http: {
    total: number;
    errors: number;
    errorRate: number;
  };
} {
  const allMetrics = metrics.getMetrics();

  // Calculate task metrics
  const tasksCompleted = allMetrics
    .filter((m) => m.name === "tasks_completed_total")
    .reduce((sum, m) => sum + m.value, 0);

  const tasksSuccess = allMetrics
    .filter(
      (m) =>
        m.name === "tasks_completed_total" && m.labels?.status === "success",
    )
    .reduce((sum, m) => sum + m.value, 0);

  const tasksFailure = allMetrics
    .filter(
      (m) =>
        m.name === "tasks_completed_total" && m.labels?.status === "failure",
    )
    .reduce((sum, m) => sum + m.value, 0);

  // Calculate queue depth
  const queueDepth: Record<string, number> = {};
  allMetrics
    .filter((m) => m.name === "queue_depth")
    .forEach((m) => {
      if (m.labels?.status) {
        queueDepth[m.labels.status] = m.value;
      }
    });

  // Calculate HTTP metrics
  const httpTotal = allMetrics
    .filter((m) => m.name === "http_requests_total")
    .reduce((sum, m) => sum + m.value, 0);

  const httpErrors = allMetrics
    .filter((m) => m.name === "http_errors_total")
    .reduce((sum, m) => sum + m.value, 0);

  return {
    tasks: {
      total: tasksCompleted,
      success: tasksSuccess,
      failure: tasksFailure,
      successRate:
        tasksCompleted > 0 ? (tasksSuccess / tasksCompleted) * 100 : 0,
    },
    queue: {
      depth: queueDepth,
    },
    http: {
      total: httpTotal,
      errors: httpErrors,
      errorRate: httpTotal > 0 ? (httpErrors / httpTotal) * 100 : 0,
    },
  };
}
