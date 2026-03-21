/**
 * Cron Routes
 *
 * REST API for managing scheduled jobs.
 * Supports: cron, intervals, one-shot (at), event triggers, templates, retry policies, delivery.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  createScheduledJob,
  getScheduledJob,
  listScheduledJobs,
  updateScheduledJob,
  pauseScheduledJob,
  resumeScheduledJob,
  deleteScheduledJob,
  archiveScheduledJob,
  restoreScheduledJob,
  triggerScheduledJob,
  getJobRunHistory,
  getScheduler,
  type JobType,
  type JobStatus,
  type DeliveryConfig,
  type EventTriggerType,
  type RetryPolicy,
} from '../cron/scheduler.js';
import {
  listJobTemplates,
  getJobTemplate,
  createJobTemplate,
  deleteJobTemplate,
  applyJobTemplate,
  initBuiltInTemplates,
  type TemplateCategory,
} from '../cron/templates.js';
import { parseNaturalLanguage, cronToHuman } from '../cron/natural-language.js';
import { createContextualLogger } from '../utils/logger.js';

const log = createContextualLogger('CronRoutes');

const app = new Hono();

// Lazy template initialization - runs once on first request
let templatesInitialized = false;
async function ensureTemplatesInitialized(): Promise<void> {
  if (templatesInitialized) return;
  templatesInitialized = true;
  try {
    await initBuiltInTemplates();
  } catch (err) {
    templatesInitialized = false;
    log.warn('Failed to initialize built-in templates:', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

app.use('*', async (_c, next) => {
  await ensureTemplatesInitialized();
  await next();
});

// Schemas

const deliveryChannelSchema = z.object({
  type: z.enum(['slack', 'webhook', 'email', 'telegram', 'discord']),
  target: z.string(),
  onSuccess: z.boolean().optional(),
  onFailure: z.boolean().optional(),
});

const deliveryConfigSchema = z.object({
  channels: z.array(deliveryChannelSchema),
});

const eventTriggerSchema = z.object({
  type: z.enum(['webhook', 'ticket', 'file', 'github']),
  config: z.record(z.any()),
});

const retryPolicySchema = z.object({
  enabled: z.boolean().optional(),
  initialDelayMs: z.number().min(1000).optional(),
  backoffMultiplier: z.number().min(1).max(10).optional(),
  maxDelayMs: z.number().min(1000).optional(),
  maxRetries: z.number().min(1).max(20).optional(),
});

const createJobSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  // Schedule options (at least one required unless event trigger)
  cronExpression: z.string().optional(),
  intervalMs: z.number().min(1000).optional(),
  runAt: z.string().datetime().optional(), // One-shot: ISO datetime
  timezone: z.string().optional().default('UTC'),
  // Event trigger (alternative to schedule)
  eventTrigger: eventTriggerSchema.optional(),
  // Execution
  jobType: z.enum(['http', 'tool', 'script', 'message', 'agent_session']),
  payload: z.record(z.any()),
  templateId: z.string().optional(),
  // Delivery
  delivery: deliveryConfigSchema.optional(),
  // Ownership
  userId: z.string().optional(),
  projectId: z.string().optional(),
  // Limits
  maxRuns: z.number().min(1).optional(),
  maxFailures: z.number().min(1).optional(),
  // Retry policy
  retryPolicy: retryPolicySchema.optional(),
  // One-shot options
  deleteOnComplete: z.boolean().optional(),
  expiresAt: z.string().datetime().optional(),
});

const updateJobSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  cronExpression: z.string().optional(),
  intervalMs: z.number().min(1000).optional(),
  runAt: z.string().datetime().optional(),
  payload: z.record(z.any()).optional(),
  labels: z.array(z.string()).optional(),
  status: z.enum(['active', 'paused']).optional(),
  delivery: deliveryConfigSchema.optional(),
  maxRuns: z.number().min(1).optional(),
  maxFailures: z.number().min(1).optional(),
  retryPolicy: retryPolicySchema.optional(),
  deleteOnComplete: z.boolean().optional(),
});

const listQuerySchema = z.object({
  status: z.enum(['active', 'paused', 'completed', 'failed', 'archived']).optional(),
  jobType: z.enum(['http', 'tool', 'script', 'message', 'agent_session']).optional(),
  projectId: z.string().optional(),
  userId: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
});

const createTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  icon: z.string().max(10).optional(),
  category: z.enum(['sync', 'report', 'cleanup', 'notification', 'monitoring', 'automation', 'custom']).optional(),
  jobType: z.enum(['http', 'tool', 'script', 'message', 'agent_session']),
  payloadTemplate: z.record(z.any()),
  suggestedCron: z.string().optional(),
  suggestedIntervalMs: z.number().min(1000).optional(),
  defaultRetryPolicy: retryPolicySchema.optional(),
  defaultDelivery: deliveryConfigSchema.optional(),
  userId: z.string().optional(),
  projectId: z.string().optional(),
});

const triggerEventSchema = z.object({
  eventType: z.enum(['webhook', 'ticket', 'file', 'github']),
  eventData: z.record(z.any()),
});

const createFromTemplateSchema = z.object({
  templateId: z.string(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  variables: z.record(z.string()).optional(),
  cronExpression: z.string().optional(),
  intervalMs: z.number().min(1000).optional(),
  runAt: z.string().datetime().optional(),
  delivery: deliveryConfigSchema.optional(),
  userId: z.string().optional(),
  projectId: z.string().optional(),
});

// Routes

// Ensure templates are initialized on first request to any cron endpoint
app.use('*', async (_c, next) => {
  await ensureTemplatesInitialized();
  await next();
});

/**
 * GET /api/cron/jobs - List scheduled jobs
 */
app.get('/jobs', zValidator('query', listQuerySchema), async (c) => {
  try {
    const query = c.req.valid('query');

    const jobs = await listScheduledJobs({
      status: query.status as JobStatus | undefined,
      jobType: query.jobType as JobType | undefined,
      projectId: query.projectId,
      userId: query.userId,
      limit: query.limit,
    });

    return c.json({
      success: true,
      jobs,
      total: jobs.length,
    });
  } catch (error) {
    log.error('Failed to list jobs:', error instanceof Error ? error : new Error(String(error)));
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list jobs',
      },
      500
    );
  }
});

/**
 * POST /api/cron/automate - Create a job from natural language
 *
 * Example: { "input": "every morning at 8am summarize my GitHub notifications and send to telegram" }
 *
 * Returns the parsed schedule, intent, and delivery - then creates the job.
 * Use ?dryRun=true to preview without creating.
 */
app.post('/automate', zValidator('json', z.object({
  input: z.string().min(5).max(500),
})), async (c) => {
  try {
    const { input } = c.req.valid('json');
    const dryRun = c.req.query('dryRun') === 'true';

    const result = parseNaturalLanguage(input);

    if (!result.success || !result.jobParams) {
      return c.json({
        success: false,
        error: result.error ?? 'Could not understand the request',
        parsed: {
          schedule: result.schedule,
          intent: result.intent,
          delivery: result.delivery,
        },
        hint: 'Try: "every morning at 8am summarize GitHub notifications and send to telegram"',
      }, 400);
    }

    // Dry run: return what would be created
    if (dryRun) {
      return c.json({
        success: true,
        dryRun: true,
        parsed: {
          schedule: result.schedule,
          intent: result.intent,
          delivery: result.delivery,
          humanReadable: result.schedule?.humanReadable,
          cronExpression: result.jobParams.cronExpression,
          cronExplained: result.jobParams.cronExpression
            ? cronToHuman(result.jobParams.cronExpression)
            : undefined,
        },
        jobParams: result.jobParams,
        message: `Would create: "${result.jobParams.name}" running ${result.schedule?.humanReadable ?? 'on schedule'}`,
      });
    }

    // Create the job
    const job = await createScheduledJob(result.jobParams);

    log.info(`Created job from natural language: ${job.name} (${job.id})`, {
      input: input.slice(0, 80),
      cron: result.jobParams.cronExpression,
      schedule: result.schedule?.humanReadable,
    });

    return c.json({
      success: true,
      job,
      parsed: {
        schedule: result.schedule?.humanReadable,
        cronExpression: result.jobParams.cronExpression,
        intent: result.intent?.action,
        delivery: result.delivery?.channel,
      },
      message: `Created "${job.name}" - ${result.schedule?.humanReadable ?? 'scheduled'}`,
    }, 201);
  } catch (error) {
    log.error('Failed to create job from natural language:', error instanceof Error ? error : new Error(String(error)));
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create automation',
    }, 500);
  }
});

/**
 * POST /api/cron/jobs - Create a scheduled job
 * Supports: cron, interval, one-shot (runAt), or event-triggered
 */
app.post('/jobs', zValidator('json', createJobSchema), async (c) => {
  try {
    const body = c.req.valid('json');

    // Validate schedule - need at least one: cron, interval, runAt, or eventTrigger
    const hasSchedule = body.cronExpression || body.intervalMs || body.runAt || body.eventTrigger;
    if (!hasSchedule) {
      return c.json(
        {
          success: false,
          error: 'At least one schedule type is required: cronExpression, intervalMs, runAt, or eventTrigger',
        },
        400
      );
    }

    const job = await createScheduledJob({
      name: body.name,
      description: body.description,
      // Schedule
      cronExpression: body.cronExpression,
      intervalMs: body.intervalMs,
      runAt: body.runAt ? new Date(body.runAt) : undefined,
      timezone: body.timezone,
      // Event trigger
      eventTrigger: body.eventTrigger,
      // Execution
      jobType: body.jobType,
      payload: body.payload,
      templateId: body.templateId,
      // Delivery
      delivery: body.delivery,
      // Ownership
      userId: body.userId,
      projectId: body.projectId,
      // Limits
      maxRuns: body.maxRuns,
      maxFailures: body.maxFailures,
      // Retry policy
      retryPolicy: body.retryPolicy,
      // One-shot options
      deleteOnComplete: body.deleteOnComplete,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    });

    const scheduleType = body.runAt ? 'one-shot' : body.eventTrigger ? 'event-triggered' : 'scheduled';
    log.info(`Created ${scheduleType} job: ${job.name} (${job.id})`);

    return c.json(
      {
        success: true,
        job,
        scheduleType,
      },
      201
    );
  } catch (error) {
    log.error('Failed to create job:', error instanceof Error ? error : new Error(String(error)));
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create job',
      },
      500
    );
  }
});

/**
 * POST /api/cron/jobs/from-template - Create a job from a template
 */
app.post('/jobs/from-template', zValidator('json', createFromTemplateSchema), async (c) => {
  try {
    const body = c.req.valid('json');

    // Get template
    const template = await getJobTemplate(body.templateId);
    if (!template) {
      return c.json({ success: false, error: 'Template not found' }, 404);
    }

    // Apply template with variables
    const applied = applyJobTemplate(template, body.variables || {});

    // Create job from template
    const job = await createScheduledJob({
      name: body.name,
      description: body.description || template.description,
      cronExpression: body.cronExpression || applied.cronExpression,
      intervalMs: body.intervalMs || applied.intervalMs,
      runAt: body.runAt ? new Date(body.runAt) : undefined,
      jobType: applied.jobType,
      payload: applied.payload,
      templateId: template.id,
      delivery: body.delivery || applied.delivery,
      userId: body.userId,
      projectId: body.projectId,
      retryPolicy: applied.retryPolicy,
    });

    log.info(`Created job from template ${template.name}: ${job.name} (${job.id})`);

    return c.json({ success: true, job, templateUsed: template.name }, 201);
  } catch (error) {
    log.error('Failed to create job from template:', error instanceof Error ? error : new Error(String(error)));
    return c.json({ success: false, error: error instanceof Error ? error.message : 'Failed to create job' }, 500);
  }
});

/**
 * GET /api/cron/jobs/:id - Get a specific job
 */
app.get('/jobs/:id', async (c) => {
  try {
    const { id } = c.req.param();

    const job = await getScheduledJob(id);

    if (!job) {
      return c.json(
        {
          success: false,
          error: 'Job not found',
        },
        404
      );
    }

    return c.json({
      success: true,
      job,
    });
  } catch (error) {
    log.error('Failed to get job:', error instanceof Error ? error : new Error(String(error)));
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get job',
      },
      500
    );
  }
});

/**
 * PATCH /api/cron/jobs/:id - Update a job
 */
app.patch('/jobs/:id', zValidator('json', updateJobSchema), async (c) => {
  try {
    const { id } = c.req.param();
    const body = c.req.valid('json');

    const job = await updateScheduledJob(id, body);

    if (!job) {
      return c.json(
        {
          success: false,
          error: 'Job not found',
        },
        404
      );
    }

    log.info(`Updated scheduled job: ${job.name} (${job.id})`);

    return c.json({
      success: true,
      job,
    });
  } catch (error) {
    log.error('Failed to update job:', error instanceof Error ? error : new Error(String(error)));
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update job',
      },
      500
    );
  }
});

/**
 * DELETE /api/cron/jobs/:id - Delete a job
 */
app.delete('/jobs/:id', async (c) => {
  try {
    const { id } = c.req.param();

    const deleted = await deleteScheduledJob(id);

    if (!deleted) {
      return c.json(
        {
          success: false,
          error: 'Job not found',
        },
        404
      );
    }

    log.info(`Deleted scheduled job: ${id}`);

    return c.json({
      success: true,
      deleted: true,
    });
  } catch (error) {
    log.error('Failed to delete job:', error instanceof Error ? error : new Error(String(error)));
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete job',
      },
      500
    );
  }
});

/**
 * POST /api/cron/jobs/:id/trigger - Trigger a job immediately
 */
app.post('/jobs/:id/trigger', async (c) => {
  try {
    const { id } = c.req.param();

    const result = await triggerScheduledJob(id);

    if (!result) {
      return c.json(
        {
          success: false,
          error: 'Job not found or failed to trigger',
        },
        404
      );
    }

    log.info(`Triggered scheduled job: ${id}`);

    return c.json({
      success: true,
      runId: result.runId,
    });
  } catch (error) {
    log.error('Failed to trigger job:', error instanceof Error ? error : new Error(String(error)));
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to trigger job',
      },
      500
    );
  }
});

/**
 * POST /api/cron/jobs/:id/pause - Pause a job
 */
app.post('/jobs/:id/pause', async (c) => {
  try {
    const { id } = c.req.param();

    const paused = await pauseScheduledJob(id);

    if (!paused) {
      return c.json(
        {
          success: false,
          error: 'Job not found',
        },
        404
      );
    }

    log.info(`Paused scheduled job: ${id}`);

    return c.json({
      success: true,
      status: 'paused',
    });
  } catch (error) {
    log.error('Failed to pause job:', error instanceof Error ? error : new Error(String(error)));
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to pause job',
      },
      500
    );
  }
});

/**
 * POST /api/cron/jobs/:id/resume - Resume a paused job
 */
app.post('/jobs/:id/resume', async (c) => {
  try {
    const { id } = c.req.param();

    const resumed = await resumeScheduledJob(id);

    if (!resumed) {
      return c.json(
        {
          success: false,
          error: 'Job not found',
        },
        404
      );
    }

    log.info(`Resumed scheduled job: ${id}`);

    return c.json({
      success: true,
      status: 'active',
    });
  } catch (error) {
    log.error('Failed to resume job:', error instanceof Error ? error : new Error(String(error)));
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to resume job',
      },
      500
    );
  }
});

/**
 * POST /api/cron/jobs/:id/archive - Archive a job (soft delete)
 */
app.post('/jobs/:id/archive', async (c) => {
  try {
    const { id } = c.req.param();

    const archived = await archiveScheduledJob(id);

    if (!archived) {
      return c.json(
        {
          success: false,
          error: 'Job not found',
        },
        404
      );
    }

    log.info(`Archived scheduled job: ${id}`);

    return c.json({
      success: true,
      status: 'archived',
    });
  } catch (error) {
    log.error('Failed to archive job:', error instanceof Error ? error : new Error(String(error)));
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to archive job',
      },
      500
    );
  }
});

/**
 * POST /api/cron/jobs/:id/restore - Restore an archived job
 */
app.post('/jobs/:id/restore', async (c) => {
  try {
    const { id } = c.req.param();

    const restored = await restoreScheduledJob(id);

    if (!restored) {
      return c.json(
        {
          success: false,
          error: 'Job not found or not archived',
        },
        404
      );
    }

    log.info(`Restored scheduled job: ${id}`);

    return c.json({
      success: true,
      status: 'paused',
    });
  } catch (error) {
    log.error('Failed to restore job:', error instanceof Error ? error : new Error(String(error)));
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to restore job',
      },
      500
    );
  }
});

/**
 * GET /api/cron/jobs/:id/history - Get job run history
 */
app.get('/jobs/:id/history', async (c) => {
  try {
    const { id } = c.req.param();
    const limit = parseInt(c.req.query('limit') || '20', 10);

    const job = await getScheduledJob(id);

    if (!job) {
      return c.json(
        {
          success: false,
          error: 'Job not found',
        },
        404
      );
    }

    const history = await getJobRunHistory(id, limit);

    return c.json({
      success: true,
      job: {
        id: job.id,
        name: job.name,
        runCount: job.runCount,
        successCount: job.successCount,
        failureCount: job.failureCount,
      },
      history,
      total: history.length,
    });
  } catch (error) {
    log.error('Failed to get job history:', error instanceof Error ? error : new Error(String(error)));
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get job history',
      },
      500
    );
  }
});

/**
 * GET /api/cron/stats - Get scheduler stats
 */
app.get('/stats', async (c) => {
  try {
    const jobs = await listScheduledJobs({ limit: 1000 });

    // Filter out archived jobs from the main count
    const activeJobs = jobs.filter((j) => j.status !== 'archived');
    const archivedJobs = jobs.filter((j) => j.status === 'archived');

    const stats = {
      total: activeJobs.length,
      active: activeJobs.filter((j) => j.status === 'active').length,
      paused: activeJobs.filter((j) => j.status === 'paused').length,
      completed: activeJobs.filter((j) => j.status === 'completed').length,
      failed: activeJobs.filter((j) => j.status === 'failed').length,
      archived: archivedJobs.length,
      byType: {
        http: activeJobs.filter((j) => j.jobType === 'http').length,
        tool: activeJobs.filter((j) => j.jobType === 'tool').length,
        script: activeJobs.filter((j) => j.jobType === 'script').length,
        message: activeJobs.filter((j) => j.jobType === 'message').length,
        agent_session: activeJobs.filter((j) => j.jobType === 'agent_session').length,
      },
      byScheduleType: {
        cron: activeJobs.filter((j) => j.cronExpression).length,
        interval: activeJobs.filter((j) => j.intervalMs && !j.cronExpression).length,
        oneShot: activeJobs.filter((j) => j.runAt).length,
        eventTriggered: activeJobs.filter((j) => j.eventTrigger).length,
      },
      totalRuns: jobs.reduce((sum, j) => sum + j.runCount, 0),
      totalSuccesses: jobs.reduce((sum, j) => sum + j.successCount, 0),
      totalFailures: jobs.reduce((sum, j) => sum + j.failureCount, 0),
    };

    return c.json({
      success: true,
      stats,
    });
  } catch (error) {
    log.error('Failed to get scheduler stats:', error instanceof Error ? error : new Error(String(error)));
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get stats',
      },
      500
    );
  }
});

// Template Routes

/**
 * GET /api/cron/templates - List job templates
 */
app.get('/templates', async (c) => {
  try {
    const category = c.req.query('category') as TemplateCategory | undefined;
    const jobType = c.req.query('jobType') as JobType | undefined;
    const includeBuiltIn = c.req.query('includeBuiltIn') !== 'false';
    const userId = c.req.query('userId');
    const projectId = c.req.query('projectId');

    const templates = await listJobTemplates({
      category,
      jobType,
      includeBuiltIn,
      userId: userId || undefined,
      projectId: projectId || undefined,
    });

    return c.json({
      success: true,
      templates,
      total: templates.length,
    });
  } catch (error) {
    log.error('Failed to list templates:', error instanceof Error ? error : new Error(String(error)));
    return c.json({ success: false, error: 'Failed to list templates' }, 500);
  }
});

/**
 * GET /api/cron/templates/:id - Get a specific template
 */
app.get('/templates/:id', async (c) => {
  try {
    const { id } = c.req.param();
    const template = await getJobTemplate(id);

    if (!template) {
      return c.json({ success: false, error: 'Template not found' }, 404);
    }

    return c.json({ success: true, template });
  } catch (error) {
    log.error('Failed to get template:', error instanceof Error ? error : new Error(String(error)));
    return c.json({ success: false, error: 'Failed to get template' }, 500);
  }
});

/**
 * POST /api/cron/templates - Create a custom template
 */
app.post('/templates', zValidator('json', createTemplateSchema), async (c) => {
  try {
    const body = c.req.valid('json');

    const template = await createJobTemplate({
      name: body.name,
      description: body.description,
      icon: body.icon,
      category: body.category,
      jobType: body.jobType,
      payloadTemplate: body.payloadTemplate,
      suggestedCron: body.suggestedCron,
      suggestedIntervalMs: body.suggestedIntervalMs,
      defaultRetryPolicy: body.defaultRetryPolicy as RetryPolicy | undefined,
      defaultDelivery: body.defaultDelivery as DeliveryConfig | undefined,
      userId: body.userId,
      projectId: body.projectId,
    });

    log.info(`Created job template: ${template.name} (${template.id})`);

    return c.json({ success: true, template }, 201);
  } catch (error) {
    log.error('Failed to create template:', error instanceof Error ? error : new Error(String(error)));
    return c.json({ success: false, error: 'Failed to create template' }, 500);
  }
});

/**
 * DELETE /api/cron/templates/:id - Delete a custom template
 */
app.delete('/templates/:id', async (c) => {
  try {
    const { id } = c.req.param();
    const deleted = await deleteJobTemplate(id);

    if (!deleted) {
      return c.json({ success: false, error: 'Template not found or is built-in' }, 404);
    }

    log.info(`Deleted job template: ${id}`);

    return c.json({ success: true, deleted: true });
  } catch (error) {
    log.error('Failed to delete template:', error instanceof Error ? error : new Error(String(error)));
    return c.json({ success: false, error: 'Failed to delete template' }, 500);
  }
});

// Event Trigger Routes

/**
 * POST /api/cron/events - Trigger jobs by event
 * Used by webhooks, ticket events, file watchers, etc.
 */
app.post('/events', zValidator('json', triggerEventSchema), async (c) => {
  try {
    const body = c.req.valid('json');

    const scheduler = getScheduler();
    const result = await scheduler.triggerByEvent(
      body.eventType as EventTriggerType,
      body.eventData
    );

    log.info(`Event ${body.eventType} triggered ${result.triggered.length} jobs`);

    return c.json({
      success: true,
      eventType: body.eventType,
      triggered: result.triggered,
      count: result.triggered.length,
    });
  } catch (error) {
    log.error('Failed to process event:', error instanceof Error ? error : new Error(String(error)));
    return c.json({ success: false, error: 'Failed to process event' }, 500);
  }
});

/**
 * POST /api/cron/webhook/:secret - Webhook endpoint for external triggers
 * Secret acts as both authentication and job filter
 */
app.post('/webhook/:secret', async (c) => {
  try {
    const { secret } = c.req.param();
    let eventData: Record<string, unknown> = {};

    try {
      eventData = await c.req.json();
    } catch {
      // No JSON body is fine
    }

    const scheduler = getScheduler();
    const result = await scheduler.triggerByEvent('webhook', {
      source: secret,
      ...eventData,
    });

    log.info(`Webhook ${secret} triggered ${result.triggered.length} jobs`);

    return c.json({
      success: true,
      triggered: result.triggered.length,
    });
  } catch (error) {
    log.error('Webhook error:', error instanceof Error ? error : new Error(String(error)));
    return c.json({ success: false, error: 'Webhook processing failed' }, 500);
  }
});

export const cronRoutes = app;
export default app;
