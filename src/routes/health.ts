/**
 * Detailed Health Check Endpoint
 * 
 * Provides comprehensive system health information including:
 * - Service status
 * - Queue health and metrics
 * - Adapter health
 * - Circuit breaker states
 * - System metrics
 * - Recent errors
 */

import type { Context } from 'hono';
import { getTasks } from '../queue/task-queue.js';
import { getAgentRegistry } from '../adapters/registry.js';
import { circuitBreakers } from '../utils/circuit-breaker.js';
import { getMetricsSummary, metrics } from '../utils/metrics.js';
import { getDeadLetterQueueStats } from '../queue/failure-handler.js';

/**
 * Health status enum
 */
export enum HealthStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
}

/**
 * Component health check
 */
interface ComponentHealth {
  status: HealthStatus;
  message?: string;
  details?: Record<string, unknown>;
  lastChecked: string;
}

/**
 * Detailed health response
 */
interface DetailedHealthResponse {
  status: HealthStatus;
  version: string;
  timestamp: string;
  uptime: number;
  components: {
    queue: ComponentHealth;
    adapters: ComponentHealth & { adapters?: any[] };
    circuitBreakers: ComponentHealth & { breakers?: any[] };
    deadLetterQueue: ComponentHealth;
  };
  metrics?: {
    tasks: any;
    queue: any;
    http: any;
  };
  system?: {
    platform: string;
    nodeVersion: string;
    memory: {
      used: number;
      total: number;
      percentage: number;
    };
    cpu: {
      loadAverage: number[];
    };
  };
}

/**
 * Start time for uptime calculation
 */
const startTime = Date.now();

/**
 * Detailed health check handler
 */
export async function handleDetailedHealthCheck(c: Context): Promise<Response> {
  const detailedResponse: DetailedHealthResponse = {
    status: HealthStatus.HEALTHY,
    version: '0.2.0',
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    components: {
      queue: await checkQueueHealth(),
      adapters: await checkAdaptersHealth(),
      circuitBreakers: checkCircuitBreakersHealth(),
      deadLetterQueue: await checkDLQHealth(),
    },
    metrics: getMetricsSummary(),
    system: getSystemInfo(),
  };

  // Determine overall status
  const componentStatuses = Object.values(detailedResponse.components).map((c) => c.status);
  
  if (componentStatuses.some((s) => s === HealthStatus.UNHEALTHY)) {
    detailedResponse.status = HealthStatus.UNHEALTHY;
  } else if (componentStatuses.some((s) => s === HealthStatus.DEGRADED)) {
    detailedResponse.status = HealthStatus.DEGRADED;
  }

  // Set appropriate HTTP status code
  const httpStatus = 
    detailedResponse.status === HealthStatus.HEALTHY ? 200 :
    detailedResponse.status === HealthStatus.DEGRADED ? 200 :
    503;

  return c.json(detailedResponse, httpStatus);
}

/**
 * Check queue health
 */
async function checkQueueHealth(): Promise<ComponentHealth> {
  try {
    // Get task counts by status
    const pendingTasks = getTasks({ status: 'pending' });
    const queuedTasks = getTasks({ status: 'queued' });
    const inProgressTasks = getTasks({ status: 'in_progress' });
    const failedTasks = getTasks({ status: 'failed' });

    const totalActive = pendingTasks.length + queuedTasks.length + inProgressTasks.length;

    // Determine health based on queue depth
    let status = HealthStatus.HEALTHY;
    let message = 'Queue operating normally';

    if (totalActive > 100) {
      status = HealthStatus.DEGRADED;
      message = 'High queue depth detected';
    }

    if (totalActive > 500) {
      status = HealthStatus.UNHEALTHY;
      message = 'Critical queue depth';
    }

    return {
      status,
      message,
      details: {
        pending: pendingTasks.length,
        queued: queuedTasks.length,
        inProgress: inProgressTasks.length,
        failed: failedTasks.length,
        totalActive,
      },
      lastChecked: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: HealthStatus.UNHEALTHY,
      message: 'Queue health check failed',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      lastChecked: new Date().toISOString(),
    };
  }
}

/**
 * Check adapters health
 */
async function checkAdaptersHealth(): Promise<ComponentHealth & { adapters?: any[] }> {
  try {
    const registry = getAgentRegistry();
    const activeAdapters = registry.getActiveAdapters();

    if (activeAdapters.length === 0) {
      return {
        status: HealthStatus.UNHEALTHY,
        message: 'No active adapters configured',
        lastChecked: new Date().toISOString(),
      };
    }

    // Check health of each adapter
    const adapterHealthChecks = await Promise.all(
      activeAdapters.map(async (adapter) => {
        try {
          const health = await adapter.healthCheck();
          return {
            type: adapter.type,
            name: adapter.name,
            healthy: health.healthy,
            latencyMs: health.latencyMs,
            message: health.message,
          };
        } catch (error) {
          return {
            type: adapter.type,
            name: adapter.name,
            healthy: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      })
    );

    const unhealthyAdapters = adapterHealthChecks.filter((a) => !a.healthy);

    let status = HealthStatus.HEALTHY;
    let message = `All ${activeAdapters.length} adapters healthy`;

    if (unhealthyAdapters.length > 0 && unhealthyAdapters.length < activeAdapters.length) {
      status = HealthStatus.DEGRADED;
      message = `${unhealthyAdapters.length} of ${activeAdapters.length} adapters unhealthy`;
    } else if (unhealthyAdapters.length === activeAdapters.length) {
      status = HealthStatus.UNHEALTHY;
      message = 'All adapters unhealthy';
    }

    return {
      status,
      message,
      adapters: adapterHealthChecks,
      lastChecked: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: HealthStatus.UNHEALTHY,
      message: 'Adapter health check failed',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      lastChecked: new Date().toISOString(),
    };
  }
}

/**
 * Check circuit breakers health
 */
function checkCircuitBreakersHealth(): ComponentHealth & { breakers?: any[] } {
  try {
    const allBreakers = circuitBreakers.getAll();
    const breakerStats = circuitBreakers.getAllStats();

    if (allBreakers.size === 0) {
      return {
        status: HealthStatus.HEALTHY,
        message: 'No circuit breakers configured',
        lastChecked: new Date().toISOString(),
      };
    }

    const openBreakers = Object.values(breakerStats).filter((s) => s.state === 'OPEN');
    const halfOpenBreakers = Object.values(breakerStats).filter((s) => s.state === 'HALF_OPEN');

    let status = HealthStatus.HEALTHY;
    let message = 'All circuit breakers closed';

    if (halfOpenBreakers.length > 0) {
      status = HealthStatus.DEGRADED;
      message = `${halfOpenBreakers.length} circuit breaker(s) in half-open state`;
    }

    if (openBreakers.length > 0) {
      status = HealthStatus.DEGRADED;
      message = `${openBreakers.length} circuit breaker(s) open`;
    }

    return {
      status,
      message,
      breakers: Object.entries(breakerStats).map(([name, stats]) => ({
        name,
        state: stats.state,
        failures: stats.failureCount,
        successes: stats.successCount,
        lastFailure: stats.lastFailureTime,
      })),
      lastChecked: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: HealthStatus.UNHEALTHY,
      message: 'Circuit breaker check failed',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      lastChecked: new Date().toISOString(),
    };
  }
}

/**
 * Check dead letter queue health
 */
async function checkDLQHealth(): Promise<ComponentHealth> {
  try {
    const stats = await getDeadLetterQueueStats();
    const pendingCount = stats.pending;

    let status = HealthStatus.HEALTHY;
    let message = 'DLQ empty';

    if (pendingCount > 0 && pendingCount < 10) {
      status = HealthStatus.HEALTHY;
      message = `${pendingCount} task(s) in DLQ`;
    } else if (pendingCount >= 10 && pendingCount < 50) {
      status = HealthStatus.DEGRADED;
      message = `${pendingCount} tasks in DLQ - review recommended`;
    } else if (pendingCount >= 50) {
      status = HealthStatus.UNHEALTHY;
      message = `${pendingCount} tasks in DLQ - immediate attention required`;
    }

    return {
      status,
      message,
      details: {
        pending: stats.pending,
        resolved: stats.resolved,
        discarded: stats.discarded,
        total: stats.total,
      },
      lastChecked: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: HealthStatus.UNHEALTHY,
      message: 'DLQ check failed',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      lastChecked: new Date().toISOString(),
    };
  }
}

/**
 * Get system information
 */
function getSystemInfo() {
  const memUsage = process.memoryUsage();
  const totalMem = memUsage.heapTotal;
  const usedMem = memUsage.heapUsed;

  return {
    platform: process.platform,
    nodeVersion: process.version,
    memory: {
      used: Math.round(usedMem / 1024 / 1024), // MB
      total: Math.round(totalMem / 1024 / 1024), // MB
      percentage: Math.round((usedMem / totalMem) * 100),
    },
    cpu: {
      loadAverage: process.platform !== 'win32' ? require('os').loadavg() : [0, 0, 0],
    },
  };
}

/**
 * Simple health check (for load balancers)
 */
export async function handleSimpleHealthCheck(c: Context): Promise<Response> {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
}
