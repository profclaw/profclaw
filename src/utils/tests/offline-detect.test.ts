import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OfflineDetector, getOfflineDetector } from '../offline-detect.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeFetchOk(): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({ ok: true } as Response);
}

function makeFetchFail(): ReturnType<typeof vi.fn> {
  return vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
}

function makeFetchStatus(status: number): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status } as Response);
}

/**
 * Tick the event loop enough times for a single pending micro-task/promise
 * chain to resolve while keeping fake timers active.
 */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  await Promise.resolve();
  await Promise.resolve();
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('OfflineDetector', () => {
  let detector: OfflineDetector;

  beforeEach(() => {
    vi.useFakeTimers();
    detector = new OfflineDetector();
  });

  afterEach(() => {
    detector.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Initial state ────────────────────────────────────────────────────────────

  it('starts online by default', () => {
    expect(detector.getStatus()).toBe(true);
  });

  // ── getStatus via initial ping ───────────────────────────────────────────────

  it('reports online when health endpoint returns 200', async () => {
    vi.stubGlobal('fetch', makeFetchOk());
    // Use a very long interval so only the immediate check runs
    detector.start('http://localhost:1234', 60_000);

    // Advance past the ping timeout and let promises settle
    await vi.advanceTimersByTimeAsync(6_000);

    expect(detector.getStatus()).toBe(true);
  });

  it('reports offline when health endpoint throws', async () => {
    vi.stubGlobal('fetch', makeFetchFail());
    detector.start('http://localhost:1234', 60_000);

    await vi.advanceTimersByTimeAsync(6_000);

    expect(detector.getStatus()).toBe(false);
  });

  it('reports offline when health endpoint returns non-2xx', async () => {
    vi.stubGlobal('fetch', makeFetchStatus(503));
    detector.start('http://localhost:1234', 60_000);

    await vi.advanceTimersByTimeAsync(6_000);

    expect(detector.getStatus()).toBe(false);
  });

  // ── onStatusChange ───────────────────────────────────────────────────────────

  it('calls listener when status transitions from online to offline', async () => {
    // Server starts healthy
    let fetchImpl = makeFetchOk();
    vi.stubGlobal('fetch', (...args: Parameters<typeof fetch>) =>
      fetchImpl(...args),
    );

    const INTERVAL = 500;
    detector.start('http://localhost:1234', INTERVAL);

    const changes: boolean[] = [];
    detector.onStatusChange(online => changes.push(online));

    // Wait for initial check (online → no change emitted)
    await vi.advanceTimersByTimeAsync(6_000);
    expect(changes).toHaveLength(0);

    // Server goes offline, trigger the next interval tick
    fetchImpl = makeFetchFail();
    await vi.advanceTimersByTimeAsync(INTERVAL + 6_000);

    expect(changes).toContain(false);
  });

  it('calls listener when status transitions from offline to online', async () => {
    vi.stubGlobal('fetch', makeFetchFail());
    const INTERVAL = 500;
    detector.start('http://localhost:1234', INTERVAL);

    await vi.advanceTimersByTimeAsync(6_000);
    expect(detector.getStatus()).toBe(false);

    const changes: boolean[] = [];
    detector.onStatusChange(online => changes.push(online));

    // Server comes back
    vi.stubGlobal('fetch', makeFetchOk());
    await vi.advanceTimersByTimeAsync(INTERVAL + 6_000);

    expect(changes).toContain(true);
  });

  it('does NOT call listener when status stays the same', async () => {
    vi.stubGlobal('fetch', makeFetchOk());
    const INTERVAL = 500;
    detector.start('http://localhost:1234', INTERVAL);

    const changes: boolean[] = [];
    detector.onStatusChange(online => changes.push(online));

    // Multiple ticks, server stays up — no transition events
    await vi.advanceTimersByTimeAsync(INTERVAL * 3 + 6_000);

    expect(changes).toHaveLength(0);
  });

  // ── unsubscribe ──────────────────────────────────────────────────────────────

  it('unsubscribes listener via returned function', async () => {
    let fetchImpl = makeFetchOk();
    vi.stubGlobal('fetch', (...args: Parameters<typeof fetch>) =>
      fetchImpl(...args),
    );
    const INTERVAL = 300;
    detector.start('http://localhost:1234', INTERVAL);
    await vi.advanceTimersByTimeAsync(6_000);

    const calls: boolean[] = [];
    const unsub = detector.onStatusChange(v => calls.push(v));
    unsub();

    fetchImpl = makeFetchFail();
    await vi.advanceTimersByTimeAsync(INTERVAL + 6_000);

    expect(calls).toHaveLength(0);
  });

  // ── stop ─────────────────────────────────────────────────────────────────────

  it('stop() halts further polling', async () => {
    const mockFetch = makeFetchOk();
    vi.stubGlobal('fetch', mockFetch);
    const INTERVAL = 300;
    detector.start('http://localhost:1234', INTERVAL);

    // Let the initial check run
    await vi.advanceTimersByTimeAsync(6_000);
    const callCount = mockFetch.mock.calls.length;

    detector.stop();
    // Advance well past several interval cycles
    await vi.advanceTimersByTimeAsync(INTERVAL * 5 + 6_000);

    // No additional calls after stop()
    expect(mockFetch.mock.calls.length).toBe(callCount);
  });

  // ── command queue ────────────────────────────────────────────────────────────

  it('queueCommand stores payloads', () => {
    detector.queueCommand({ message: 'hello' });
    detector.queueCommand({ message: 'world' });

    expect(detector.queueLength()).toBe(2);
  });

  it('drainQueue returns all commands and clears the queue', () => {
    detector.queueCommand({ message: 'first' });
    detector.queueCommand({ message: 'second' });

    const drained = detector.drainQueue();
    expect(drained).toHaveLength(2);
    expect(drained[0]?.payload).toEqual({ message: 'first' });
    expect(drained[1]?.payload).toEqual({ message: 'second' });

    // Queue is now empty
    expect(detector.queueLength()).toBe(0);
    expect(detector.drainQueue()).toHaveLength(0);
  });

  it('drainQueue returns empty array when queue is empty', () => {
    expect(detector.drainQueue()).toEqual([]);
  });

  it('queueCommand returns a unique id', () => {
    const id1 = detector.queueCommand('a');
    const id2 = detector.queueCommand('b');
    expect(id1).not.toBe(id2);
    expect(typeof id1).toBe('string');
  });

  // ── getOfflineDetector (singleton) ───────────────────────────────────────────

  it('getOfflineDetector returns the same instance each time', () => {
    const a = getOfflineDetector();
    const b = getOfflineDetector();
    expect(a).toBe(b);
  });

  // ── ping uses correct URL ────────────────────────────────────────────────────

  it('pings serverUrl + /health', async () => {
    const mockFetch = makeFetchOk();
    vi.stubGlobal('fetch', mockFetch);
    detector.start('http://example.com:9000', 60_000);

    await vi.advanceTimersByTimeAsync(6_000);

    expect(mockFetch.mock.calls.length).toBeGreaterThan(0);
    const firstCallUrl = (mockFetch.mock.calls[0] as [string, RequestInit])[0];
    expect(firstCallUrl).toBe('http://example.com:9000/health');
  });

  // ── listener error isolation ─────────────────────────────────────────────────

  it('swallows errors thrown by listeners', async () => {
    vi.stubGlobal('fetch', makeFetchFail());
    detector.start('http://localhost:1234', 60_000);

    detector.onStatusChange(() => { throw new Error('listener boom'); });

    // Should not throw during advancement
    let threw = false;
    try {
      await vi.advanceTimersByTimeAsync(6_000);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});
