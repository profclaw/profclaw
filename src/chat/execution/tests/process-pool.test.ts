import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { ProcessPool } from '../process-pool.js';

describe('ProcessPool', () => {
  let pool: ProcessPool;

  beforeEach(() => {
    pool = new ProcessPool({
      maxConcurrent: 3,
      maxQueueSize: 5,
      defaultTimeout: 5000,
    });
  });

  // ===========================================================================
  // Basic execution
  // ===========================================================================

  describe('submit', () => {
    it('executes immediately when pool has capacity', async () => {
      const result = await pool.submit('e1', 'exec', 'c1', async () => 'done');
      expect(result).toBe('done');
    });

    it('tracks active executions', async () => {
      let insideExecute: (() => void) | undefined;
      const executing = pool.submit('e1', 'exec', 'c1', () =>
        new Promise<string>((resolve) => {
          insideExecute = () => resolve('done');
        }),
      );

      // Give microtask a chance to start
      await new Promise((r) => setTimeout(r, 10));

      const status = pool.getStatus();
      expect(status.active.length).toBe(1);
      expect(status.active[0].id).toBe('e1');

      insideExecute!();
      await executing;
    });

    it('tracks metrics on completion', async () => {
      await pool.submit('e1', 'exec', 'c1', async () => 'ok');

      const metrics = pool.getMetrics();
      expect(metrics.totalExecuted).toBe(1);
      expect(metrics.totalFailed).toBe(0);
      expect(metrics.peakConcurrent).toBe(1);
    });

    it('tracks failed executions', async () => {
      await expect(
        pool.submit('e1', 'exec', 'c1', async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      const metrics = pool.getMetrics();
      expect(metrics.totalFailed).toBe(1);
    });
  });

  // ===========================================================================
  // Queue behavior
  // ===========================================================================

  describe('queue', () => {
    it('queues when pool is full', async () => {
      const resolvers: (() => void)[] = [];

      // Fill the pool (maxConcurrent = 3)
      for (let i = 0; i < 3; i++) {
        pool.submit(`e${i}`, 'exec', 'c1', () =>
          new Promise((resolve) => {
            resolvers.push(() => resolve('done'));
          }),
        );
      }

      await new Promise((r) => setTimeout(r, 10));
      expect(pool.getStatus().active.length).toBe(3);

      // This should be queued
      const queuedPromise = pool.submit('e3', 'exec', 'c1', async () => 'queued-result');
      expect(pool.getStatus().queuedCount).toBe(1);

      // Complete one active execution
      resolvers[0]();
      const result = await queuedPromise;
      expect(result).toBe('queued-result');

      // Clean up remaining
      for (const r of resolvers.slice(1)) r();
    });

    it('rejects when queue is full', async () => {
      const resolvers: (() => void)[] = [];

      // Fill pool + queue (3 active + 5 queued = 8)
      for (let i = 0; i < 8; i++) {
        pool.submit(`e${i}`, 'exec', 'c1', () =>
          new Promise((resolve) => {
            resolvers.push(() => resolve('done'));
          }),
        );
      }

      await new Promise((r) => setTimeout(r, 10));

      // 9th should be rejected
      await expect(
        pool.submit('e8', 'exec', 'c1', async () => 'fail'),
      ).rejects.toThrow(/queue full/i);

      const metrics = pool.getMetrics();
      expect(metrics.totalRejected).toBe(1);

      // Clean up
      for (const r of resolvers) r();
    });
  });

  // ===========================================================================
  // Cancel
  // ===========================================================================

  describe('cancel', () => {
    it('cancels queued execution', async () => {
      const resolvers: (() => void)[] = [];

      // Fill pool
      for (let i = 0; i < 3; i++) {
        pool.submit(`e${i}`, 'exec', 'c1', () =>
          new Promise((resolve) => {
            resolvers.push(() => resolve('done'));
          }),
        );
      }

      await new Promise((r) => setTimeout(r, 10));

      // Queue one more
      const queued = pool.submit('e3', 'exec', 'c1', async () => 'queued');

      const cancelled = pool.cancel('e3');
      expect(cancelled).toBe(true);
      expect(pool.getStatus().queuedCount).toBe(0);

      await expect(queued).rejects.toThrow('cancelled');

      // Clean up
      for (const r of resolvers) r();
    });

    it('returns false for active execution', async () => {
      let resolveExec: (() => void) | undefined;
      const p = pool.submit('e1', 'exec', 'c1', () =>
        new Promise((resolve) => {
          resolveExec = () => resolve('done');
        }),
      );

      await new Promise((r) => setTimeout(r, 10));

      const cancelled = pool.cancel('e1');
      expect(cancelled).toBe(false);

      resolveExec!();
      await p;
    });

    it('returns false for unknown id', () => {
      expect(pool.cancel('nonexistent')).toBe(false);
    });
  });

  // ===========================================================================
  // Capacity
  // ===========================================================================

  describe('capacity', () => {
    it('hasCapacity returns true when pool has room', () => {
      expect(pool.hasCapacity()).toBe(true);
    });

    it('getLoad returns percentage', async () => {
      let resolveExec: (() => void) | undefined;
      const p = pool.submit('e1', 'exec', 'c1', () =>
        new Promise((resolve) => {
          resolveExec = () => resolve('done');
        }),
      );

      await new Promise((r) => setTimeout(r, 10));

      // 1/3 = ~33.3%
      const load = pool.getLoad();
      expect(load).toBeCloseTo(33.33, 0);

      resolveExec!();
      await p;
    });
  });

  // ===========================================================================
  // clearQueue
  // ===========================================================================

  describe('clearQueue', () => {
    it('rejects all queued items', async () => {
      const resolvers: (() => void)[] = [];
      const queuedPromises: Promise<unknown>[] = [];

      // Fill pool
      for (let i = 0; i < 3; i++) {
        pool.submit(`e${i}`, 'exec', 'c1', () =>
          new Promise((resolve) => {
            resolvers.push(() => resolve('done'));
          }),
        );
      }

      await new Promise((r) => setTimeout(r, 10));

      // Queue 2 more
      queuedPromises.push(pool.submit('e3', 'exec', 'c1', async () => 'q1'));
      queuedPromises.push(pool.submit('e4', 'exec', 'c1', async () => 'q2'));

      const cleared = pool.clearQueue();
      expect(cleared).toBe(2);

      for (const p of queuedPromises) {
        await expect(p).rejects.toThrow('cleared');
      }

      // Clean up
      for (const r of resolvers) r();
    });
  });

  // ===========================================================================
  // Events
  // ===========================================================================

  describe('events', () => {
    it('emits execution:start and execution:complete', async () => {
      const events: string[] = [];
      pool.on('execution:start', () => events.push('start'));
      pool.on('execution:complete', () => events.push('complete'));

      await pool.submit('e1', 'exec', 'c1', async () => 'done');

      expect(events).toEqual(['start', 'complete']);
    });
  });

  // ===========================================================================
  // updateConfig
  // ===========================================================================

  describe('updateConfig', () => {
    it('updates pool config', () => {
      pool.updateConfig({ maxConcurrent: 10 });

      const status = pool.getStatus();
      expect(status.config.maxConcurrent).toBe(10);
    });
  });
});
