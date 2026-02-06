import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../queue/index.js', () => ({
  getTasks: vi.fn(() => []),
}));

vi.mock('../../adapters/registry.js', () => ({
  getAgentRegistry: vi.fn(() => ({
    getActiveAdapters: vi.fn(() => []),
  })),
}));

vi.mock('../../utils/circuit-breaker.js', () => ({
  circuitBreakers: {
    getAll: vi.fn(() => new Map()),
    getAllStats: vi.fn(() => ({})),
  },
}));

vi.mock('../../utils/metrics.js', () => ({
  getMetricsSummary: vi.fn(() => ({
    tasks: { total: 1, success: 1, failure: 0, successRate: 100 },
    queue: { depth: {} },
    http: { total: 1, errors: 0, errorRate: 0 },
  })),
}));

vi.mock('../../queue/failure-handler.js', () => ({
  getDeadLetterQueueStats: vi.fn(() => Promise.resolve({
    pending: 0,
    resolved: 0,
    discarded: 0,
    total: 0,
  })),
}));

import { Hono } from 'hono';
import { getAgentRegistry } from '../../adapters/registry.js';
import { getDeadLetterQueueStats } from '../../queue/failure-handler.js';
import { getTasks } from '../../queue/index.js';
import { circuitBreakers } from '../../utils/circuit-breaker.js';
import { getMetricsSummary } from '../../utils/metrics.js';
import {
  handleDetailedHealthCheck,
  handleSimpleHealthCheck,
  HealthStatus,
} from '../health.js';

function makeApp() {
  const app = new Hono();
  app.get('/health', handleSimpleHealthCheck);
  app.get('/health/detailed', handleDetailedHealthCheck);
  return app;
}

describe('health handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTasks).mockReturnValue([]);
    vi.mocked(getMetricsSummary).mockReturnValue({
      tasks: { total: 1, success: 1, failure: 0, successRate: 100 },
      queue: { depth: {} },
      http: { total: 1, errors: 0, errorRate: 0 },
    });
    vi.mocked(getDeadLetterQueueStats).mockResolvedValue({
      pending: 0,
      resolved: 0,
      discarded: 0,
      total: 0,
    });
    vi.mocked(circuitBreakers.getAll).mockReturnValue(new Map());
    vi.mocked(circuitBreakers.getAllStats).mockReturnValue({});
    vi.mocked(getAgentRegistry).mockReturnValue({
      getActiveAdapters: vi.fn(() => [
        {
          type: 'claude-code',
          name: 'Claude Code',
          healthCheck: vi.fn().mockResolvedValue({
            healthy: true,
            latencyMs: 25,
            message: 'ready',
          }),
        },
      ]),
    } as never);
  });

  it('returns healthy detailed status with system metrics', async () => {
    const app = makeApp();
    const res = await app.fetch(new Request('http://localhost/health/detailed'));

    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.status).toBe(HealthStatus.HEALTHY);
    expect(json.system.platform).toBe(process.platform);
    expect(Array.isArray(json.system.cpu.loadAverage)).toBe(true);
    expect(json.system.cpu.loadAverage).toHaveLength(3);
    expect(json.components.adapters.adapters[0]).toMatchObject({
      type: 'claude-code',
      name: 'Claude Code',
      healthy: true,
    });
  });

  it('returns degraded status when some adapters are unhealthy', async () => {
    vi.mocked(getAgentRegistry).mockReturnValue({
      getActiveAdapters: vi.fn(() => [
        {
          type: 'claude-code',
          name: 'Claude Code',
          healthCheck: vi.fn().mockResolvedValue({
            healthy: true,
            latencyMs: 25,
            message: 'ready',
          }),
        },
        {
          type: 'openhands',
          name: 'OpenHands',
          healthCheck: vi.fn().mockResolvedValue({
            healthy: false,
            latencyMs: 90,
            message: 'degraded',
          }),
        },
      ]),
    } as never);

    const app = makeApp();
    const res = await app.fetch(new Request('http://localhost/health/detailed'));

    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.status).toBe(HealthStatus.DEGRADED);
    expect(json.components.adapters.message).toContain('1 of 2 adapters unhealthy');
  });

  it('returns simple health payload for load balancers', async () => {
    const app = makeApp();
    const res = await app.fetch(new Request('http://localhost/health'));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('ok');
    expect(typeof json.timestamp).toBe('string');
  });
});
