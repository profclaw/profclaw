import { Hono } from 'hono';
import {
  getDeadLetterQueue,
  getDeadLetterQueueStats,
  retryDeadLetterTask,
  removeFromDeadLetterQueue,
  discardFromDeadLetterQueue,
} from '../queue/failure-handler.js';

const dlq = new Hono();

// List dead letter queue tasks
dlq.get('/', async (c) => {
  const status = c.req.query('status') as 'pending' | 'resolved' | 'discarded' | undefined;
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  const { tasks, total } = await getDeadLetterQueue({ status, limit, offset });

  return c.json({
    tasks,
    total,
    limit,
    offset,
    hasMore: offset + tasks.length < total,
  });
});

// Get DLQ stats
dlq.get('/stats', async (c) => {
  const stats = await getDeadLetterQueueStats();
  return c.json(stats);
});

// Retry a task from DLQ
dlq.post('/:id/retry', async (c) => {
  const id = c.req.param('id');
  const success = await retryDeadLetterTask(id);

  if (!success) {
    return c.json({ error: 'Task not found in dead letter queue or not pending' }, 404);
  }

  return c.json({ message: 'Task moved back to queue for retry' });
});

// Resolve a task from DLQ (manual resolution - e.g., fixed manually)
dlq.post('/:id/resolve', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const { resolvedBy, resolutionNote } = body as { resolvedBy?: string; resolutionNote?: string };

  const success = await removeFromDeadLetterQueue(id, resolvedBy, resolutionNote);

  if (!success) {
    return c.json({ error: 'Task not found in dead letter queue' }, 404);
  }

  return c.json({ message: 'Task marked as resolved' });
});

// Discard a task from DLQ (won't be retried)
dlq.post('/:id/discard', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const { resolvedBy, resolutionNote } = body as { resolvedBy?: string; resolutionNote?: string };

  const success = await discardFromDeadLetterQueue(id, resolvedBy, resolutionNote);

  if (!success) {
    return c.json({ error: 'Task not found in dead letter queue' }, 404);
  }

  return c.json({ message: 'Task discarded from dead letter queue' });
});

// Remove task from DLQ (alias for resolve - backward compatibility)
dlq.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const success = await removeFromDeadLetterQueue(id);

  if (!success) {
    return c.json({ error: 'Task not found in dead letter queue' }, 404);
  }

  return c.json({ message: 'Task removed from dead letter queue' });
});

export { dlq as dlqRoutes };
