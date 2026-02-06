import { Hono } from 'hono';
import { handleGitHubWebhook } from '../integrations/github.js';
import { handleJiraWebhook } from '../integrations/jira.js';
import { handleLinearWebhook } from '../integrations/linear.js';
import { addTask } from '../queue/task-queue.js';

const webhooks = new Hono();

// GitHub webhook
webhooks.post('/github', async (c) => {
  try {
    const taskInput = await handleGitHubWebhook(c);

    if (!taskInput) {
      return c.json({ message: 'Webhook received, no task created' });
    }

    const task = await addTask(taskInput);

    return c.json({
      message: 'Task created from GitHub webhook',
      task,
    });
  } catch (error) {
    console.error('[Webhook] GitHub error:', error);
    return c.json(
      {
        error: 'Webhook processing failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      error instanceof Error && error.message.includes('signature') ? 401 : 500
    );
  }
});

// Jira webhook
webhooks.post('/jira', async (c) => {
  try {
    const taskInput = await handleJiraWebhook(c);

    if (!taskInput) {
      return c.json({ message: 'Webhook received, no task created' });
    }

    const task = await addTask(taskInput);

    return c.json({
      message: 'Task created from Jira webhook',
      task,
    });
  } catch (error) {
    console.error('[Webhook] Jira error:', error);
    return c.json(
      {
        error: 'Webhook processing failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      error instanceof Error && error.message.includes('token') ? 401 : 500
    );
  }
});

// Linear webhook
webhooks.post('/linear', async (c) => {
  try {
    const taskInput = await handleLinearWebhook(c);

    if (!taskInput) {
      return c.json({ message: 'Webhook received, no task created' });
    }

    const task = await addTask(taskInput);

    return c.json({
      message: 'Task created from Linear webhook',
      task,
    });
  } catch (error) {
    console.error('[Webhook] Linear error:', error);
    return c.json(
      {
        error: 'Webhook processing failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      error instanceof Error && error.message.includes('signature') ? 401 : 500
    );
  }
});

export { webhooks as webhooksRoutes };
