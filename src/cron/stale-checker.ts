/**
 * Stale Task Checker
 *
 * Finds tasks that have been in_progress for too long and marks them
 * as failed or retries them.
 * Configurable via POLL_INTERVAL_STALE env var (default: 60s).
 */

import { getTasks } from '../queue/index.js';
import { handleTaskFailure } from '../queue/failure-handler.js';
import { createContextualLogger } from '../utils/logger.js';

const log = createContextualLogger('StaleChecker');

// Configurable interval (default: 60 seconds)
const CHECK_INTERVAL = parseInt(process.env.POLL_INTERVAL_STALE || '60000', 10);
const STALE_THRESHOLD = 30 * 60 * 1000; // 30 minutes - task considered stale

let checkerInterval: NodeJS.Timeout | null = null;

/**
 * Check for stale tasks
 */
async function checkStaleTasks(): Promise<void> {
  const inProgressTasks = getTasks({ status: 'in_progress' });
  const now = Date.now();

  for (const task of inProgressTasks) {
    if (!task.startedAt) continue;

    // Handle both Date and string formats
    const startTime = task.startedAt instanceof Date
      ? task.startedAt.getTime()
      : new Date(task.startedAt).getTime();
    const elapsed = now - startTime;

    if (elapsed > STALE_THRESHOLD) {
      const minutes = Math.round(elapsed / 60000);
      log.warn(`Task stale`, { taskId: task.id, elapsedMinutes: minutes });

      // Mark as failed and let failure handler deal with it
      await handleTaskFailure(
        task,
        new Error(`Task stale: running for ${minutes} minutes without completion`)
      );
    }
  }
}

/**
 * Start the stale task checker
 */
export function startStaleChecker(): void {
  if (checkerInterval) {
    return; // Already running
  }

  log.info('Starting stale task checker', { intervalMs: CHECK_INTERVAL });

  // Run at configured interval
  checkerInterval = setInterval(() => {
    checkStaleTasks().catch((e) => log.error('Stale check failed', e instanceof Error ? e : undefined));
  }, CHECK_INTERVAL);
}

/**
 * Stop the stale task checker
 */
export function stopStaleChecker(): void {
  if (checkerInterval) {
    clearInterval(checkerInterval);
    checkerInterval = null;
    log.debug('Stopped');
  }
}
