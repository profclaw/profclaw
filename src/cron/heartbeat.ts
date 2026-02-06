/**
 * Heartbeat Monitor
 *
 * Monitors the health of all registered agents and pauses/resumes
 * task processing based on agent availability.
 * Configurable via POLL_INTERVAL_HEARTBEAT env var (default: 30s).
 */

import { getAgentRegistry } from '../adapters/registry.js';
import { sendSlackNotification } from '../notifications/slack.js';
import { createContextualLogger } from '../utils/logger.js';

const log = createContextualLogger('Heartbeat');

// Configurable interval (default: 30 seconds)
const HEARTBEAT_INTERVAL = parseInt(process.env.POLL_INTERVAL_HEARTBEAT || '30000', 10);
const UNHEALTHY_THRESHOLD = 3; // Consecutive failures before alerting

let heartbeatInterval: NodeJS.Timeout | null = null;
const unhealthyCounts = new Map<string, number>();
const alertedAgents = new Set<string>();

/**
 * Check health of all agents
 */
async function checkAgentHealth(): Promise<void> {
  const registry = getAgentRegistry();
  const adapters = registry.getActiveAdapters();

  for (const adapter of adapters) {
    try {
      const health = await adapter.healthCheck();

      if (health.healthy) {
        // Reset unhealthy count
        const prevCount = unhealthyCounts.get(adapter.type) || 0;
        unhealthyCounts.set(adapter.type, 0);

        // If was alerted, send recovery notification
        if (alertedAgents.has(adapter.type)) {
          alertedAgents.delete(adapter.type);
          log.info(`${adapter.name} recovered`, { latencyMs: health.latencyMs });

          await sendSlackNotification({
            type: 'agent_recovered',
            title: `✅ Agent Recovered: ${adapter.name}`,
            message: `${adapter.name} is healthy again. Latency: ${health.latencyMs}ms`,
            agent: adapter.type,
          }).catch((e) => log.error('Slack notification failed', e instanceof Error ? e : undefined));
        } else if (prevCount > 0) {
          log.debug(`${adapter.name} healthy again after ${prevCount} failures`);
        }
      } else {
        // Increment unhealthy count
        const count = (unhealthyCounts.get(adapter.type) || 0) + 1;
        unhealthyCounts.set(adapter.type, count);

        log.warn(`${adapter.name} unhealthy`, { count, threshold: UNHEALTHY_THRESHOLD, message: health.message });

        // Alert after threshold
        if (count >= UNHEALTHY_THRESHOLD && !alertedAgents.has(adapter.type)) {
          alertedAgents.add(adapter.type);

          await sendSlackNotification({
            type: 'agent_unhealthy',
            title: `⚠️ Agent Unhealthy: ${adapter.name}`,
            message: `${adapter.name} has been unhealthy for ${count} consecutive checks.\nLast error: ${health.message}`,
            agent: adapter.type,
            severity: 'warning',
          }).catch((e) => log.error('Slack notification failed', e instanceof Error ? e : undefined));
        }
      }
    } catch (error) {
      const count = (unhealthyCounts.get(adapter.type) || 0) + 1;
      unhealthyCounts.set(adapter.type, count);
      log.error(`Error checking ${adapter.name}`, error instanceof Error ? error : undefined);
    }
  }
}

/**
 * Start the heartbeat monitor
 */
export function startHeartbeat(): void {
  if (heartbeatInterval) {
    return; // Already running
  }

  log.info('Starting agent health monitor', { intervalMs: HEARTBEAT_INTERVAL });

  // Run immediately
  checkAgentHealth().catch((e) => log.error('Health check failed', e instanceof Error ? e : undefined));

  // Then run at configured interval
  heartbeatInterval = setInterval(() => {
    checkAgentHealth().catch((e) => log.error('Health check failed', e instanceof Error ? e : undefined));
  }, HEARTBEAT_INTERVAL);
}

/**
 * Stop the heartbeat monitor
 */
export function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    log.debug('Stopped');
  }
}

/**
 * Get current health status of all agents
 */
export function getHealthStatus(): Record<string, { healthy: boolean; failureCount: number }> {
  const status: Record<string, { healthy: boolean; failureCount: number }> = {};

  for (const [agent, count] of unhealthyCounts) {
    status[agent] = {
      healthy: count === 0,
      failureCount: count,
    };
  }

  return status;
}
