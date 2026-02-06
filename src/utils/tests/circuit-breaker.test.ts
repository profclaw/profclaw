import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CircuitBreaker,
  CircuitState,
  CircuitBreakerError,
} from "../circuit-breaker.js";

function createBreaker() {
  return new CircuitBreaker({
    name: "test",
    failureThreshold: 2,
    failureWindow: 50,
    resetTimeout: 20,
    successThreshold: 1,
    timeout: 10,
  });
}

describe("CircuitBreaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows successful calls when closed", async () => {
    const breaker = createBreaker();
    const result = await breaker.execute(async () => "ok");

    expect(result).toBe("ok");
    expect(breaker.getStats().state).toBe(CircuitState.CLOSED);
  });

  it("opens after threshold failures and blocks calls", async () => {
    const breaker = createBreaker();

    await expect(
      breaker.execute(async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");

    await expect(
      breaker.execute(async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");

    expect(breaker.getStats().state).toBe(CircuitState.OPEN);

    await expect(breaker.execute(async () => "blocked")).rejects.toBeInstanceOf(
      CircuitBreakerError,
    );
  });

  it("transitions to half-open after reset timeout", async () => {
    const breaker = createBreaker();

    await expect(
      breaker.execute(async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");
    await expect(
      breaker.execute(async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");

    expect(breaker.getStats().state).toBe(CircuitState.OPEN);

    vi.advanceTimersByTime(25);

    await expect(breaker.execute(async () => "ok")).resolves.toBe("ok");

    expect(breaker.getStats().state).toBe(CircuitState.CLOSED);
  });

  it("reopens on failure during half-open", async () => {
    const breaker = createBreaker();

    await expect(
      breaker.execute(async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");
    await expect(
      breaker.execute(async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");

    vi.advanceTimersByTime(25);

    await expect(
      breaker.execute(async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");

    expect(breaker.getStats().state).toBe(CircuitState.OPEN);
  });

  it("times out operations when configured", async () => {
    const breaker = createBreaker();

    const task = breaker.execute(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return "late";
    });

    vi.advanceTimersByTime(20);

    await expect(task).rejects.toThrow("Operation timed out");
  });

  it("resets manually", () => {
    const breaker = createBreaker();

    breaker.reset();

    const stats = breaker.getStats();
    expect(stats.state).toBe(CircuitState.CLOSED);
    expect(stats.failureCount).toBe(0);
  });

  it("can be opened manually and reset", () => {
    const breaker = createBreaker();

    breaker.open();
    expect(breaker.getStats().state).toBe(CircuitState.OPEN);

    breaker.reset();
    expect(breaker.getStats().state).toBe(CircuitState.CLOSED);
  });
});
