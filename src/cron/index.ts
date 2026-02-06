/**
 * Cron Jobs Index
 *
 * Starts and stops all background cron jobs.
 *
 * Configurable intervals via environment variables:
 * - POLL_INTERVAL_HEARTBEAT: Agent health check (default: 30s)
 * - POLL_INTERVAL_ISSUES: GitHub issue polling (default: 2m)
 * - POLL_INTERVAL_STALE: Stale task check (default: 1m)
 */

import { startIssuePoller, stopIssuePoller } from './issue-poller.js';
import { startHeartbeat, stopHeartbeat } from './heartbeat.js';
import { startStaleChecker, stopStaleChecker } from './stale-checker.js';
import { createContextualLogger } from '../utils/logger.js';

const log = createContextualLogger('Cron');

/**
 * Start all cron jobs
 */
export function startAllCronJobs(): void {
  log.info('Starting background jobs');

  startHeartbeat();
  startIssuePoller();
  startStaleChecker();
}

/**
 * Stop all cron jobs
 */
export function stopAllCronJobs(): void {
  log.info('Stopping background jobs');

  stopHeartbeat();
  stopIssuePoller();
  stopStaleChecker();
}

export { startIssuePoller, stopIssuePoller } from './issue-poller.js';
export { startHeartbeat, stopHeartbeat, getHealthStatus } from './heartbeat.js';
export { startStaleChecker, stopStaleChecker } from './stale-checker.js';
