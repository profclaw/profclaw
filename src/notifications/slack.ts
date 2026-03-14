/**
 * Slack Notifications
 *
 * Sends notifications to Slack via incoming webhooks.
 */

import type { Task } from '../types/task.js';
import { createContextualLogger } from '../utils/logger.js';

const log = createContextualLogger('SlackNotify');

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';
const SLACK_CHANNEL = process.env.SLACK_CHANNEL || '';
const NOTIFY_ON_START = process.env.SLACK_NOTIFY_ON_START === 'true';
const NOTIFY_ON_SUCCESS = process.env.SLACK_NOTIFY_ON_SUCCESS !== 'false'; // Default true
const NOTIFY_ON_FAILURE = process.env.SLACK_NOTIFY_ON_FAILURE !== 'false'; // Default true

interface SlackNotification {
  type: 'task_started' | 'task_completed' | 'task_failed' | 'task_retry' | 'agent_unhealthy' | 'agent_recovered';
  title: string;
  message: string;
  task?: Task;
  agent?: string;
  severity?: 'info' | 'warning' | 'error' | 'success';
}

/**
 * Send a notification to Slack
 */
export async function sendSlackNotification(notification: SlackNotification): Promise<void> {
  if (!SLACK_WEBHOOK_URL) {
    return; // Slack not configured
  }

  // Check if we should send this type of notification
  if (notification.type === 'task_started' && !NOTIFY_ON_START) return;
  if (notification.type === 'task_completed' && !NOTIFY_ON_SUCCESS) return;
  if (notification.type === 'task_failed' && !NOTIFY_ON_FAILURE) return;

  const color = getColorForSeverity(notification.severity || 'info');

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: notification.title,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: notification.message,
      },
    },
  ];

  // Add task details if present
  if (notification.task) {
    const task = notification.task;
    const fields: Array<{ type: string; text: string }> = [
      { type: 'mrkdwn', text: `*Task ID:*\n\`${task.id.substring(0, 8)}...\`` },
      { type: 'mrkdwn', text: `*Priority:*\n${getPriorityLabel(task.priority)}` },
    ];

    if (task.repository) {
      fields.push({ type: 'mrkdwn', text: `*Repository:*\n${task.repository}` });
    }

    if (task.sourceUrl) {
      fields.push({ type: 'mrkdwn', text: `*Source:*\n<${task.sourceUrl}|View Issue>` });
    }

    blocks.push({
      type: 'section',
      fields,
    });
  }

  // Add timestamp
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `<!date^${Math.floor(Date.now() / 1000)}^{date_short_pretty} at {time}|${new Date().toISOString()}>`,
      },
    ],
  });

  const payload = {
    channel: SLACK_CHANNEL || undefined,
    attachments: [
      {
        color,
        blocks,
      },
    ],
  };

  try {
    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      log.error('Failed to send notification', new Error(`HTTP ${response.status}`));
    }
  } catch (error) {
    log.error('Error sending notification', error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Send task started notification
 */
export async function notifyTaskStarted(task: Task): Promise<void> {
  await sendSlackNotification({
    type: 'task_started',
    title: `🚀 Task Started: ${task.title}`,
    message: `AI agent is now working on this task.`,
    task,
    severity: 'info',
  });
}

/**
 * Send task completed notification
 */
export async function notifyTaskCompleted(task: Task, prUrl?: string): Promise<void> {
  let message = `Task completed successfully.`;
  if (prUrl) {
    message += `\n\n<${prUrl}|View Pull Request>`;
  }

  await sendSlackNotification({
    type: 'task_completed',
    title: `✅ Task Completed: ${task.title}`,
    message,
    task,
    severity: 'success',
  });
}

/**
 * Send task failed notification
 */
export async function notifyTaskFailed(task: Task, error: string): Promise<void> {
  await sendSlackNotification({
    type: 'task_failed',
    title: `❌ Task Failed: ${task.title}`,
    message: `Task failed with error:\n\`\`\`${error}\`\`\``,
    task,
    severity: 'error',
  });
}

/**
 * Get color for severity level
 */
function getColorForSeverity(severity: string): string {
  switch (severity) {
    case 'success': return '#36a64f'; // Green
    case 'warning': return '#f2c744'; // Yellow
    case 'error': return '#dc3545'; // Red
    default: return '#2196f3'; // Blue
  }
}

/**
 * Get human-readable priority label
 */
function getPriorityLabel(priority: number): string {
  switch (priority) {
    case 1: return '🔴 Critical';
    case 2: return '🟠 High';
    case 3: return '🟡 Medium';
    case 4: return '🟢 Low';
    default: return '⚪ Unknown';
  }
}

// Slack Block Kit types (simplified)
interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  fields?: Array<{ type: string; text: string }>;
  elements?: Array<{ type: string; text: string }>;
}
