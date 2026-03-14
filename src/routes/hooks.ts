import { Hono } from 'hono';
import { createContextualLogger } from '../utils/logger.js';

const log = createContextualLogger('Hooks');
import {
  handlePostToolUse,
  handleSessionEnd,
  handlePromptSubmit,
  handleOpenClawWebhook,
  handleGenericAgentWebhook,
  getSessionEvents,
  getSessionSummary,
  getRecentSessions,
  getRecentReports,
  getTaskReports,
} from '../hooks/index.js';

const hooks = new Hono();

// PostToolUse hook - receives tool usage events from Claude Code
hooks.post('/tool-use', async (c) => {
  try {
    const result = await handlePostToolUse(c);

    if (!result.success) {
      return c.json(
        {
          error: 'Hook processing failed',
          message: result.error,
        },
        400
      );
    }

    return c.json({
      message: 'Hook processed',
      eventId: result.eventId,
      inference: result.inference,
    });
  } catch (error) {
    log.error('PostToolUse error', error instanceof Error ? error : new Error(String(error)));
    return c.json(
      {
        error: 'Hook processing failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// Session end hook - receives session completion events
hooks.post('/session-end', async (c) => {
  try {
    const result = await handleSessionEnd(c);

    if (!result.success) {
      return c.json(
        {
          error: 'Hook processing failed',
          message: result.error,
        },
        400
      );
    }

    return c.json({
      message: 'Session recorded',
      eventId: result.eventId,
      inference: result.inference,
    });
  } catch (error) {
    log.error('Session end error', error instanceof Error ? error : new Error(String(error)));
    return c.json(
      {
        error: 'Hook processing failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// User prompt submit hook - receives user prompts for context
hooks.post('/prompt-submit', async (c) => {
  try {
    const result = await handlePromptSubmit(c);

    if (!result.success) {
      return c.json(
        {
          error: 'Hook processing failed',
          message: result.error,
        },
        400
      );
    }

    return c.json({
      message: 'Prompt recorded',
      eventId: result.eventId,
    });
  } catch (error) {
    log.error('Prompt submit error', error instanceof Error ? error : new Error(String(error)));
    return c.json(
      {
        error: 'Hook processing failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// Get session events
hooks.get('/sessions/:sessionId/events', (c) => {
  const sessionId = c.req.param('sessionId');
  const events = getSessionEvents(sessionId);

  return c.json({
    sessionId,
    events,
    count: events.length,
  });
});

// Get session summary
hooks.get('/sessions/:sessionId/summary', (c) => {
  const sessionId = c.req.param('sessionId');
  const summary = getSessionSummary(sessionId);

  return c.json({
    sessionId,
    ...summary,
  });
});

// List recent sessions
hooks.get('/sessions', (c) => {
  const limit = parseInt(c.req.query('limit') || '50');
  const sessions = getRecentSessions(limit);

  return c.json({
    sessions,
    count: sessions.length,
  });
});

// === Agent Webhook Endpoints ===

// OpenClaw completion webhook
hooks.post('/webhook/openclaw', async (c) => {
  try {
    const report = await handleOpenClawWebhook(c);

    if (!report) {
      return c.json({ message: 'Webhook received, no action taken' });
    }

    return c.json({
      message: 'Agent completion recorded',
      reportId: report.id,
      status: report.status,
    });
  } catch (error) {
    log.error('OpenClaw webhook error', error instanceof Error ? error : new Error(String(error)));
    return c.json(
      {
        error: 'Webhook processing failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      error instanceof Error && error.message.includes('signature') ? 401 : 500
    );
  }
});

// Generic agent completion webhook
hooks.post('/webhook/agent', async (c) => {
  try {
    const report = await handleGenericAgentWebhook(c);

    if (!report) {
      return c.json({ message: 'Webhook received, no action taken' });
    }

    return c.json({
      message: 'Agent completion recorded',
      reportId: report.id,
      agent: report.agent,
      status: report.status,
    });
  } catch (error) {
    log.error('Agent webhook error', error instanceof Error ? error : new Error(String(error)));
    return c.json(
      {
        error: 'Webhook processing failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      error instanceof Error && error.message.includes('signature') ? 401 : 500
    );
  }
});

// List recent agent reports
hooks.get('/webhook/reports', (c) => {
  const limit = parseInt(c.req.query('limit') || '50');
  const agent = c.req.query('agent');

  const reports = agent
    ? getRecentReports(limit).filter(r => r.agent === agent)
    : getRecentReports(limit);

  return c.json({
    reports,
    count: reports.length,
  });
});

// Get reports for a specific task
hooks.get('/webhook/tasks/:taskId/reports', (c) => {
  const taskId = c.req.param('taskId');
  const reports = getTaskReports(taskId);

  return c.json({
    taskId,
    reports,
    count: reports.length,
  });
});

export { hooks as hooksRoutes };
