import { describe, it, expect, beforeEach } from "vitest";
import {
  metrics,
  TaskMetrics,
  HTTPMetrics,
  getMetricsSummary,
} from "../metrics.js";
import { CircuitState } from "../circuit-breaker.js";

describe("metrics", () => {
  beforeEach(() => {
    metrics.reset();
  });

  it("tracks task metrics and summaries", () => {
    TaskMetrics.taskStarted("pending", "api");
    TaskMetrics.taskCompleted(true, 1200, "adapter", "api");
    TaskMetrics.taskCompleted(false, 800, "adapter", "api");
    TaskMetrics.taskFailed("validation", "adapter");
    TaskMetrics.setQueueDepth(4, "pending");
    TaskMetrics.setAdapterHealth("adapter", true);
    TaskMetrics.setCircuitBreakerState("cb", CircuitState.CLOSED);

    const summary = getMetricsSummary();

    expect(summary.tasks.total).toBe(2);
    expect(summary.tasks.success).toBe(1);
    expect(summary.tasks.failure).toBe(1);
    expect(summary.queue.depth.pending).toBe(4);
  });

  it("tracks HTTP metrics", () => {
    HTTPMetrics.requestReceived("GET", "/api/test");
    HTTPMetrics.responseSent("GET", "/api/test", 200, 500);
    HTTPMetrics.error("GET", "/api/test", "timeout");

    const summary = getMetricsSummary();

    expect(summary.http.total).toBe(1);
    expect(summary.http.errors).toBe(1);
  });
});
