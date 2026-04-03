import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolCircuitBreaker } from '../circuit-breaker.js';

describe('ToolCircuitBreaker', () => {
  let cb: ToolCircuitBreaker;

  beforeEach(() => {
    vi.useFakeTimers();
    cb = new ToolCircuitBreaker(3, 120_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('closed state allows execution', () => {
    const result = cb.canExecute('myTool');
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('3 failures within the window trip the breaker to open', () => {
    cb.recordFailure('myTool');
    expect(cb.canExecute('myTool').allowed).toBe(true); // still closed after 1

    cb.recordFailure('myTool');
    expect(cb.canExecute('myTool').allowed).toBe(true); // still closed after 2

    cb.recordFailure('myTool');
    // Third failure hits the threshold → open
    const result = cb.canExecute('myTool');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Circuit breaker open for myTool/);
  });

  it('open state blocks execution with a descriptive reason', () => {
    cb.recordFailure('bash');
    cb.recordFailure('bash');
    cb.recordFailure('bash');

    const result = cb.canExecute('bash');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('bash');
    expect(result.reason).toContain('Retry in');
  });

  it('cooldown expiry transitions open → half-open and allows execution', () => {
    cb.recordFailure('readFile');
    cb.recordFailure('readFile');
    cb.recordFailure('readFile');

    // Still blocked immediately
    expect(cb.canExecute('readFile').allowed).toBe(false);

    // Advance time past the 5 s initial cooldown
    vi.advanceTimersByTime(6_000);

    const result = cb.canExecute('readFile');
    expect(result.allowed).toBe(true);

    // State should now be half-open
    const status = cb.getStatus().get('readFile');
    expect(status?.state).toBe('half-open');
  });

  it('success in half-open closes the circuit', () => {
    cb.recordFailure('grep');
    cb.recordFailure('grep');
    cb.recordFailure('grep');

    vi.advanceTimersByTime(6_000); // move to half-open
    cb.canExecute('grep'); // probe triggers transition

    cb.recordSuccess('grep');

    const status = cb.getStatus().get('grep');
    expect(status?.state).toBe('closed');
    expect(status?.failureCount).toBe(0);
    expect(status?.cooldownMs).toBe(5_000); // reset to initial
  });

  it('failure in half-open re-opens with doubled cooldown', () => {
    cb.recordFailure('writeFile');
    cb.recordFailure('writeFile');
    cb.recordFailure('writeFile');

    // Initial cooldown is 5 000 ms
    const statusBefore = cb.getStatus().get('writeFile');
    expect(statusBefore?.cooldownMs).toBe(5_000);

    vi.advanceTimersByTime(6_000); // move to half-open
    cb.canExecute('writeFile'); // triggers half-open transition

    cb.recordFailure('writeFile'); // probe fails

    const status = cb.getStatus().get('writeFile');
    expect(status?.state).toBe('open');
    expect(status?.cooldownMs).toBe(10_000); // doubled
  });

  it('failures outside the window do not accumulate toward the threshold', () => {
    cb.recordFailure('search');
    cb.recordFailure('search');

    // Advance past the 2-minute window so these failures are stale
    vi.advanceTimersByTime(121_000);

    // This new failure restarts the count from 1 — still under threshold
    cb.recordFailure('search');
    expect(cb.canExecute('search').allowed).toBe(true);
  });

  it('reset clears a single tool breaker', () => {
    cb.recordFailure('tool1');
    cb.recordFailure('tool1');
    cb.recordFailure('tool1');
    expect(cb.canExecute('tool1').allowed).toBe(false);

    cb.reset('tool1');
    expect(cb.canExecute('tool1').allowed).toBe(true);
  });

  it('reset with no argument clears all breakers', () => {
    cb.recordFailure('a');
    cb.recordFailure('a');
    cb.recordFailure('a');
    cb.recordFailure('b');
    cb.recordFailure('b');
    cb.recordFailure('b');

    cb.reset();

    expect(cb.canExecute('a').allowed).toBe(true);
    expect(cb.canExecute('b').allowed).toBe(true);
  });

  it('getStatus returns a snapshot and not the live map', () => {
    cb.recordFailure('snap');
    const snapshot = cb.getStatus();

    cb.recordFailure('snap');
    cb.recordFailure('snap');

    // Snapshot should still show failure count from when it was taken
    expect(snapshot.get('snap')?.failureCount).toBe(1);
  });
});
