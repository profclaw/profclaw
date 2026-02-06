/**
 * In-App Notification Service
 *
 * Creates DB notifications from task events so the bell dropdown populates.
 */

import { randomUUID } from 'node:crypto';
import { getClient } from '../storage/index.js';
import { getSettingsRaw } from '../settings/index.js';
import { logger } from '../utils/logger.js';

interface TaskNotificationEvent {
  type: string;
  taskId: string;
  task: {
    id: string;
    title: string;
    status: string;
  };
  result?: {
    success: boolean;
    error?: { message?: string };
  };
}

/**
 * Write a notification row for a task event.
 * Checks server-side notification prefs before writing.
 * Returns the notification ID, or null if skipped.
 */
export async function createTaskNotification(
  event: TaskNotificationEvent,
): Promise<string | null> {
  try {
    const settings = await getSettingsRaw();
    const prefs = settings.notifications;

    // Respect user prefs
    if (event.type === 'completed' && !prefs.taskComplete) return null;
    if (event.type === 'failed' && !prefs.taskFailed) return null;

    const id = randomUUID();
    const client = getClient();

    const isSuccess = event.type === 'completed';
    const title = isSuccess
      ? `Task completed: ${event.task.title}`
      : `Task failed: ${event.task.title}`;
    const description = isSuccess
      ? null
      : (event.result?.error?.message ?? 'Unknown error');

    await client.execute({
      sql: `INSERT INTO notifications (id, user_id, title, description, type, category, entity_type, entity_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        null,
        title,
        description,
        isSuccess ? 'success' : 'error',
        'task',
        'task',
        event.taskId,
      ],
    });

    return id;
  } catch (error) {
    logger.error('[Notifications] Failed to create task notification:', error instanceof Error ? error : undefined);
    return null;
  }
}
