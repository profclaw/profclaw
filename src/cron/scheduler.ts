/**
 * Scheduled Jobs Scheduler
 *
 * Manages cron jobs and scheduled tasks using BullMQ.
 * Provides a database-backed scheduler that AI agents can use
 * to schedule recurring tasks.
 *
 * Supports:
 * - Cron expressions (standard 5-field syntax)
 * - Fixed intervals
 * - HTTP callbacks
 * - Tool execution
 * - Script execution
 * - Message sending
 */

import { Queue, Worker, Job } from 'bullmq';
import { getDb } from '../storage/index.js';
import { scheduledJobs, jobRunHistory } from '../storage/schema.js';
import { eq, and, isNull, lte } from 'drizzle-orm';
import { createContextualLogger } from '../utils/logger.js';

const log = createContextualLogger('Scheduler');

// =============================================================================
// Types
// =============================================================================

export type JobType = 'http' | 'tool' | 'script' | 'message';
export type JobStatus = 'active' | 'paused' | 'completed' | 'failed' | 'archived';
export type RunStatus = 'running' | 'success' | 'error' | 'timeout' | 'cancelled';
export type EventTriggerType = 'webhook' | 'ticket' | 'file' | 'github';
export type DeliveryChannelType = 'slack' | 'webhook' | 'email';

/** Event trigger configuration */
export interface EventTrigger {
  type: EventTriggerType;
  config: Record<string, any>;
}

/** Delivery channel for job output */
export interface DeliveryChannel {
  type: DeliveryChannelType;
  target: string; // channel ID, URL, or email
  onSuccess?: boolean;
  onFailure?: boolean;
}

/** Delivery configuration */
export interface DeliveryConfig {
  channels: DeliveryChannel[];
}

/** Retry policy configuration */
export interface RetryPolicy {
  enabled: boolean;
  initialDelayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;
  maxRetries: number;
}

export interface ScheduledJob {
  id: string;
  name: string;
  description?: string;
  // Schedule types (pick one)
  cronExpression?: string;
  intervalMs?: number;
  runAt?: Date; // One-shot: run at this specific datetime
  timezone: string;
  // Event-driven trigger
  eventTrigger?: EventTrigger;
  // Execution
  jobType: JobType;
  payload: Record<string, any>;
  templateId?: string;
  // Labels for organization
  labels: string[];
  // Output delivery
  delivery?: DeliveryConfig;
  // Status
  status: JobStatus;
  userId?: string;
  projectId?: string;
  createdBy: 'human' | 'ai';
  // Execution tracking
  lastRunAt?: Date;
  lastRunStatus?: string;
  lastRunError?: string;
  nextRunAt?: Date;
  // Stats
  runCount: number;
  successCount: number;
  failureCount: number;
  // Limits
  maxRuns?: number;
  maxFailures?: number;
  // Retry policy
  retryOnFailure: boolean;
  retryDelayMs: number;
  retryBackoffMultiplier: number;
  retryMaxDelayMs: number;
  currentRetryCount: number;
  // One-shot options
  deleteOnComplete: boolean;
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
  archivedAt?: Date;
}

export interface CreateJobParams {
  name: string;
  description?: string;
  // Schedule types
  cronExpression?: string;
  intervalMs?: number;
  runAt?: Date; // One-shot scheduling
  timezone?: string;
  // Event trigger
  eventTrigger?: EventTrigger;
  // Execution
  jobType: JobType;
  payload: Record<string, any>;
  templateId?: string;
  // Labels for organization
  labels?: string[];
  // Delivery
  delivery?: DeliveryConfig;
  // Ownership
  userId?: string;
  projectId?: string;
  createdBy?: 'human' | 'ai';
  // Limits
  maxRuns?: number;
  maxFailures?: number;
  // Retry policy
  retryPolicy?: Partial<RetryPolicy>;
  // One-shot options
  deleteOnComplete?: boolean;
  expiresAt?: Date;
}

export interface JobRunResult {
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
}

export interface HttpJobPayload {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
}

export interface ToolJobPayload {
  tool: string;
  params: Record<string, any>;
  conversationId?: string;
}

export interface ScriptJobPayload {
  command: string;
  args?: string[];
  workdir?: string;
  timeout?: number;
}

export interface MessageJobPayload {
  conversationId: string;
  content: string;
}

// =============================================================================
// Singleton Scheduler
// =============================================================================

let schedulerInstance: JobScheduler | null = null;

export function getScheduler(): JobScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new JobScheduler();
  }
  return schedulerInstance;
}

// =============================================================================
// JobScheduler Class
// =============================================================================

export class JobScheduler {
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private isRunning = false;
  private redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  };

  /**
   * Start the scheduler
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn('Scheduler already running');
      return;
    }

    try {
      // Initialize BullMQ queue
      this.queue = new Queue('scheduled-jobs', {
        connection: this.redisConfig,
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      });

      // Initialize worker
      this.worker = new Worker(
        'scheduled-jobs',
        async (job: Job) => this.processJob(job),
        {
          connection: this.redisConfig,
          concurrency: 5,
        }
      );

      this.worker.on('completed', (job) => {
        log.debug(`Job ${job.id} completed`);
      });

      this.worker.on('failed', (job, err) => {
        log.error(`Job ${job?.id} failed:`, err instanceof Error ? err : new Error(String(err)));
      });

      // Load existing active jobs from database
      await this.loadActiveJobs();

      this.isRunning = true;
      log.info('Scheduler started');
    } catch (error) {
      log.error('Failed to start scheduler:', error instanceof Error ? error : new Error(String(error)));
      // Scheduler can work without Redis for basic features
      this.isRunning = false;
    }
  }

  /**
   * Stop the scheduler
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    try {
      if (this.worker) {
        await this.worker.close();
        this.worker = null;
      }
      if (this.queue) {
        await this.queue.close();
        this.queue = null;
      }
      this.isRunning = false;
      log.info('Scheduler stopped');
    } catch (error) {
      log.error('Error stopping scheduler:', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Load active jobs from database and schedule them
   */
  private async loadActiveJobs(): Promise<void> {
    const db = await getDb();
    const jobs = await db
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.status, 'active'));

    log.info(`Loading ${jobs.length} active scheduled jobs`);

    for (const job of jobs) {
      try {
        await this.scheduleJob(job.id, job.cronExpression || undefined, job.intervalMs || undefined);
      } catch (error) {
        log.error(`Failed to schedule job ${job.id}:`, error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  /**
   * Create a new scheduled job
   * Supports: cron expressions, fixed intervals, one-shot (runAt), event triggers
   */
  async createJob(params: CreateJobParams): Promise<ScheduledJob> {
    const db = await getDb();
    const id = crypto.randomUUID();
    const now = new Date();

    // Calculate next run time based on schedule type
    let nextRunAt: Date | null = null;
    if (params.runAt) {
      // One-shot job: run at specific datetime
      nextRunAt = params.runAt;
    } else if (params.eventTrigger) {
      // Event-driven: no scheduled next run, triggered by events
      nextRunAt = null;
    } else {
      // Cron or interval
      nextRunAt = this.calculateNextRun(params.cronExpression, params.intervalMs);
    }

    // Apply retry policy defaults
    const retryPolicy = {
      enabled: params.retryPolicy?.enabled ?? true,
      initialDelayMs: params.retryPolicy?.initialDelayMs ?? 60000,
      backoffMultiplier: params.retryPolicy?.backoffMultiplier ?? 2,
      maxDelayMs: params.retryPolicy?.maxDelayMs ?? 3600000,
      maxRetries: params.retryPolicy?.maxRetries ?? 3,
    };

    const jobData = {
      id,
      name: params.name,
      description: params.description ?? null,
      // Schedule
      cronExpression: params.cronExpression ?? null,
      intervalMs: params.intervalMs ?? null,
      runAt: params.runAt ?? null,
      timezone: params.timezone ?? 'UTC',
      // Event trigger
      eventTrigger: params.eventTrigger ?? null,
      // Execution
      jobType: params.jobType,
      payload: params.payload,
      templateId: params.templateId ?? null,
      // Labels
      labels: params.labels ?? [],
      // Delivery
      delivery: params.delivery ?? null,
      // Status
      status: 'active' as const,
      userId: params.userId ?? null,
      projectId: params.projectId ?? null,
      createdBy: params.createdBy ?? 'human',
      nextRunAt: nextRunAt,
      runCount: 0,
      successCount: 0,
      failureCount: 0,
      // Limits
      maxRuns: params.maxRuns ?? (params.runAt ? 1 : null), // One-shot defaults to maxRuns=1
      maxFailures: params.maxFailures ?? null,
      // Retry policy
      retryOnFailure: retryPolicy.enabled,
      retryDelayMs: retryPolicy.initialDelayMs,
      retryBackoffMultiplier: retryPolicy.backoffMultiplier,
      retryMaxDelayMs: retryPolicy.maxDelayMs,
      currentRetryCount: 0,
      // One-shot options
      deleteOnComplete: params.deleteOnComplete ?? false,
      // Timestamps
      createdAt: now,
      updatedAt: now,
      expiresAt: params.expiresAt ?? null,
    };

    await db.insert(scheduledJobs).values(jobData);

    // Schedule in BullMQ based on type
    if (params.runAt) {
      // One-shot: schedule delayed job
      await this.scheduleOneShotJob(id, params.runAt);
    } else if (!params.eventTrigger) {
      // Cron or interval: schedule repeating job
      await this.scheduleJob(id, params.cronExpression, params.intervalMs);
    }
    // Event-triggered jobs don't need BullMQ scheduling

    const scheduleType = params.runAt ? 'one-shot' : params.eventTrigger ? 'event-triggered' : 'scheduled';
    log.info(`Created ${scheduleType} job: ${params.name} (${id})`);

    return this.mapToScheduledJob(jobData);
  }

  /**
   * Schedule a one-shot job to run at a specific time
   */
  private async scheduleOneShotJob(id: string, runAt: Date): Promise<void> {
    if (!this.queue) return;

    const delay = Math.max(0, runAt.getTime() - Date.now());

    await this.queue.add(
      'one-shot-run',
      { jobId: id, triggeredBy: 'one-shot' },
      {
        jobId: `oneshot-${id}`,
        delay,
      }
    );
  }

  /**
   * Get a job by ID
   */
  async getJob(id: string): Promise<ScheduledJob | null> {
    const db = await getDb();
    const [job] = await db
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.id, id));

    return job ? this.mapToScheduledJob(job) : null;
  }

  /**
   * List all jobs with optional filters
   */
  async listJobs(filters?: {
    status?: JobStatus;
    projectId?: string;
    userId?: string;
    jobType?: JobType;
    limit?: number;
  }): Promise<ScheduledJob[]> {
    const db = await getDb();
    let query = db.select().from(scheduledJobs);

    // Apply filters
    const conditions: any[] = [];
    if (filters?.status) {
      conditions.push(eq(scheduledJobs.status, filters.status));
    }
    if (filters?.projectId) {
      conditions.push(eq(scheduledJobs.projectId, filters.projectId));
    }
    if (filters?.userId) {
      conditions.push(eq(scheduledJobs.userId, filters.userId));
    }
    if (filters?.jobType) {
      conditions.push(eq(scheduledJobs.jobType, filters.jobType));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    const jobs = await query.limit(filters?.limit ?? 100);

    return jobs.map((j: typeof scheduledJobs.$inferSelect) => this.mapToScheduledJob(j));
  }

  /**
   * Update a job
   */
  async updateJob(
    id: string,
    updates: Partial<Pick<CreateJobParams, 'name' | 'description' | 'cronExpression' | 'intervalMs' | 'payload' | 'maxRuns' | 'maxFailures' | 'labels'>> & { status?: 'active' | 'paused' }
  ): Promise<ScheduledJob | null> {
    const db = await getDb();

    const [existing] = await db
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.id, id));

    if (!existing) return null;

    // Calculate new next run if schedule changed
    let nextRunAt = existing.nextRunAt;
    if (updates.cronExpression !== undefined || updates.intervalMs !== undefined) {
      const cron = updates.cronExpression ?? existing.cronExpression;
      const interval = updates.intervalMs ?? existing.intervalMs;
      nextRunAt = this.calculateNextRun(cron || undefined, interval || undefined);

      // Reschedule in BullMQ
      await this.removeFromQueue(id);
      await this.scheduleJob(id, cron || undefined, interval || undefined);
    }

    await db
      .update(scheduledJobs)
      .set({
        ...updates,
        nextRunAt,
        updatedAt: new Date(),
      })
      .where(eq(scheduledJobs.id, id));

    return this.getJob(id);
  }

  /**
   * Pause a job
   */
  async pauseJob(id: string): Promise<boolean> {
    const db = await getDb();
    const result = await db
      .update(scheduledJobs)
      .set({ status: 'paused', updatedAt: new Date() })
      .where(eq(scheduledJobs.id, id));

    await this.removeFromQueue(id);

    return result.rowsAffected > 0;
  }

  /**
   * Resume a paused job
   */
  async resumeJob(id: string): Promise<boolean> {
    const db = await getDb();
    const [job] = await db
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.id, id));

    if (!job) return false;

    await db
      .update(scheduledJobs)
      .set({
        status: 'active',
        nextRunAt: this.calculateNextRun(job.cronExpression || undefined, job.intervalMs || undefined),
        updatedAt: new Date(),
      })
      .where(eq(scheduledJobs.id, id));

    await this.scheduleJob(id, job.cronExpression || undefined, job.intervalMs || undefined);

    return true;
  }

  /**
   * Delete a job
   */
  async deleteJob(id: string): Promise<boolean> {
    const db = await getDb();

    await this.removeFromQueue(id);

    const result = await db
      .delete(scheduledJobs)
      .where(eq(scheduledJobs.id, id));

    return result.rowsAffected > 0;
  }

  /**
   * Archive a job (soft delete)
   */
  async archiveJob(id: string): Promise<boolean> {
    const db = await getDb();

    await this.removeFromQueue(id);

    const result = await db
      .update(scheduledJobs)
      .set({
        status: 'archived',
        archivedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(scheduledJobs.id, id));

    return result.rowsAffected > 0;
  }

  /**
   * Restore an archived job
   */
  async restoreJob(id: string): Promise<boolean> {
    const db = await getDb();
    const [job] = await db
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.id, id));

    if (!job || job.status !== 'archived') return false;

    const nextRunAt = this.calculateNextRun(job.cronExpression || undefined, job.intervalMs || undefined);

    await db
      .update(scheduledJobs)
      .set({
        status: 'paused', // Restore to paused state for safety
        archivedAt: null,
        nextRunAt,
        updatedAt: new Date(),
      })
      .where(eq(scheduledJobs.id, id));

    return true;
  }

  /**
   * Trigger a job immediately (manual run)
   */
  async triggerJob(id: string): Promise<{ runId: string } | null> {
    const job = await this.getJob(id);
    if (!job) return null;

    // Queue immediate execution
    if (this.queue) {
      await this.queue.add(
        'manual-run',
        { jobId: id, triggeredBy: 'manual' },
        { jobId: `manual-${id}-${Date.now()}` }
      );
    } else {
      // Fallback: execute directly
      await this.executeJob(id, 'manual');
    }

    return { runId: `manual-${id}-${Date.now()}` };
  }

  /**
   * Get job run history
   */
  async getJobHistory(
    jobId: string,
    limit = 20
  ): Promise<Array<{
    id: string;
    startedAt: Date;
    completedAt?: Date;
    durationMs?: number;
    status: RunStatus;
    output?: string;
    error?: string;
    triggeredBy: string;
  }>> {
    const db = await getDb();
    const history = await db
      .select()
      .from(jobRunHistory)
      .where(eq(jobRunHistory.jobId, jobId))
      .orderBy(jobRunHistory.startedAt)
      .limit(limit);

    return history.map((h: typeof jobRunHistory.$inferSelect) => ({
      id: h.id,
      startedAt: h.startedAt as Date,
      completedAt: h.completedAt as Date | undefined,
      durationMs: h.durationMs || undefined,
      status: h.status as RunStatus,
      output: h.output || undefined,
      error: h.error || undefined,
      triggeredBy: h.triggeredBy,
    }));
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  /**
   * Schedule a job in BullMQ
   */
  private async scheduleJob(
    id: string,
    cronExpression?: string,
    intervalMs?: number
  ): Promise<void> {
    if (!this.queue) return;

    const repeatOpts: any = {};

    if (cronExpression) {
      repeatOpts.pattern = cronExpression;
    } else if (intervalMs) {
      repeatOpts.every = intervalMs;
    } else {
      log.warn(`Job ${id} has no schedule defined`);
      return;
    }

    await this.queue.add(
      'scheduled-run',
      { jobId: id, triggeredBy: 'schedule' },
      {
        repeat: repeatOpts,
        jobId: `scheduled-${id}`,
      }
    );
  }

  /**
   * Remove a job from BullMQ queue
   */
  private async removeFromQueue(id: string): Promise<void> {
    if (!this.queue) return;

    try {
      await this.queue.removeRepeatableByKey(`scheduled-${id}`);
    } catch {
      // Job might not exist in queue
    }
  }

  /**
   * Process a job from the queue
   */
  private async processJob(bullJob: Job): Promise<void> {
    const { jobId, triggeredBy } = bullJob.data;

    try {
      await this.executeJob(jobId, triggeredBy);
    } catch (error) {
      log.error(`Error processing job ${jobId}:`, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Execute a scheduled job
   */
  private async executeJob(jobId: string, triggeredBy: string): Promise<void> {
    const db = await getDb();
    const startTime = Date.now();
    const runId = crypto.randomUUID();

    // Get job details
    const [job] = await db
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.id, jobId));

    if (!job || job.status !== 'active') {
      return;
    }

    // Record run start
    await db.insert(jobRunHistory).values({
      id: runId,
      jobId,
      startedAt: new Date(),
      status: 'running',
      triggeredBy,
    });

    let result: JobRunResult;

    try {
      // Execute based on job type
      switch (job.jobType) {
        case 'http':
          result = await this.executeHttpJob(job.payload as HttpJobPayload);
          break;
        case 'tool':
          result = await this.executeToolJob(job.payload as ToolJobPayload);
          break;
        case 'script':
          result = await this.executeScriptJob(job.payload as ScriptJobPayload);
          break;
        case 'message':
          result = await this.executeMessageJob(job.payload as MessageJobPayload);
          break;
        default:
          result = { success: false, error: `Unknown job type: ${job.jobType}`, durationMs: 0 };
      }
    } catch (error) {
      result = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      };
    }

    const durationMs = Date.now() - startTime;

    // Update run history
    await db
      .update(jobRunHistory)
      .set({
        completedAt: new Date(),
        durationMs,
        status: result.success ? 'success' : 'error',
        output: result.output?.slice(0, 10000), // Truncate output
        error: result.error,
      })
      .where(eq(jobRunHistory.id, runId));

    // Update job stats
    const newRunCount = job.runCount + 1;
    const newSuccessCount = result.success ? job.successCount + 1 : job.successCount;
    const newFailureCount = result.success ? 0 : job.failureCount + 1; // Reset on success
    const newRetryCount = result.success ? 0 : (job.currentRetryCount || 0) + 1;

    // Determine job status and next run
    let newStatus: JobStatus = 'active';
    let nextRunAt: Date | null = null;
    let shouldDelete = false;

    // Check completion conditions
    const isOneShot = !!job.runAt && !job.cronExpression && !job.intervalMs;
    const isEventTriggered = !!job.eventTrigger;

    if (job.maxRuns && newRunCount >= job.maxRuns) {
      // Max runs reached
      newStatus = 'completed';
      if (job.deleteOnComplete && result.success) {
        shouldDelete = true;
      }
    } else if (job.maxFailures && newFailureCount >= job.maxFailures) {
      // Max failures reached
      newStatus = 'failed';
    } else if (isOneShot && result.success) {
      // One-shot job completed successfully
      newStatus = 'completed';
      if (job.deleteOnComplete) {
        shouldDelete = true;
      }
    } else if (!result.success && job.retryOnFailure) {
      // Schedule retry with exponential backoff
      const maxRetries = job.maxFailures || 3;
      if (newRetryCount <= maxRetries) {
        const backoffDelay = this.calculateRetryDelay(
          newRetryCount,
          job.retryDelayMs || 60000,
          job.retryBackoffMultiplier || 2,
          job.retryMaxDelayMs || 3600000
        );
        nextRunAt = new Date(Date.now() + backoffDelay);
        log.info(`Scheduling retry ${newRetryCount}/${maxRetries} for job ${job.name} in ${backoffDelay}ms`);

        // Queue retry in BullMQ
        if (this.queue) {
          await this.queue.add(
            'retry-run',
            { jobId, triggeredBy: 'retry' },
            { jobId: `retry-${jobId}-${Date.now()}`, delay: backoffDelay }
          );
        }
      } else {
        newStatus = 'failed';
      }
    } else if (newStatus === 'active' && !isEventTriggered) {
      // Calculate next scheduled run
      if (isOneShot && !result.success) {
        // Failed one-shot with no retry
        nextRunAt = null;
      } else {
        nextRunAt = this.calculateNextRun(job.cronExpression || undefined, job.intervalMs || undefined);
      }
    }

    // Update job record
    await db
      .update(scheduledJobs)
      .set({
        lastRunAt: new Date(),
        lastRunStatus: result.success ? 'success' : 'error',
        lastRunError: result.error || null,
        lastRunDurationMs: durationMs,
        nextRunAt,
        runCount: newRunCount,
        successCount: newSuccessCount,
        failureCount: newFailureCount,
        currentRetryCount: newRetryCount,
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(scheduledJobs.id, jobId));

    // Deliver output to channels
    if (job.delivery) {
      await this.deliverOutput(job, result);
    }

    // Delete if configured
    if (shouldDelete) {
      log.info(`Auto-deleting completed job: ${job.name} (${jobId})`);
      await this.deleteJob(jobId);
    }

    log.info(`Job ${job.name} (${jobId}) ${result.success ? 'succeeded' : 'failed'} in ${durationMs}ms`);
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(
    retryCount: number,
    initialDelay: number,
    multiplier: number,
    maxDelay: number
  ): number {
    const delay = initialDelay * Math.pow(multiplier, retryCount - 1);
    // Add jitter (±10%) to prevent thundering herd
    const jitter = delay * (0.9 + Math.random() * 0.2);
    return Math.min(jitter, maxDelay);
  }

  /**
   * Deliver job output to configured channels
   */
  private async deliverOutput(
    job: typeof scheduledJobs.$inferSelect,
    result: JobRunResult
  ): Promise<void> {
    const delivery = job.delivery as DeliveryConfig | null;
    if (!delivery?.channels?.length) return;

    for (const channel of delivery.channels) {
      // Check if we should deliver based on result
      const shouldDeliver =
        (result.success && channel.onSuccess !== false) ||
        (!result.success && channel.onFailure !== false);

      if (!shouldDeliver) continue;

      try {
        switch (channel.type) {
          case 'slack':
            await this.deliverToSlack(channel.target, job, result);
            break;
          case 'webhook':
            await this.deliverToWebhook(channel.target, job, result);
            break;
          case 'email':
            await this.deliverToEmail(channel.target, job, result);
            break;
        }
      } catch (error) {
        log.error(`Failed to deliver to ${channel.type}:${channel.target}:`, error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  /**
   * Deliver output to Slack channel
   */
  private async deliverToSlack(
    target: string,
    job: typeof scheduledJobs.$inferSelect,
    result: JobRunResult
  ): Promise<void> {
    // TODO: Implement Slack webhook integration
    // For now, log the delivery attempt
    log.info(`[Slack Delivery] Job: ${job.name}, Channel: ${target}, Success: ${result.success}`);

    // This will be implemented when Slack OAuth is integrated
    // Will use the Slack API to post to the channel
  }

  /**
   * Deliver output to a webhook URL
   */
  private async deliverToWebhook(
    url: string,
    job: typeof scheduledJobs.$inferSelect,
    result: JobRunResult
  ): Promise<void> {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId: job.id,
        jobName: job.name,
        success: result.success,
        output: result.output,
        error: result.error,
        durationMs: result.durationMs,
        timestamp: new Date().toISOString(),
      }),
    });
  }

  /**
   * Deliver output via email
   */
  private async deliverToEmail(
    email: string,
    job: typeof scheduledJobs.$inferSelect,
    result: JobRunResult
  ): Promise<void> {
    // TODO: Implement email delivery
    log.info(`[Email Delivery] Job: ${job.name}, To: ${email}, Success: ${result.success}`);
  }

  /**
   * Execute an HTTP job
   */
  private async executeHttpJob(payload: HttpJobPayload): Promise<JobRunResult> {
    const startTime = Date.now();

    try {
      const response = await fetch(payload.url, {
        method: payload.method || 'GET',
        headers: payload.headers,
        body: payload.body ? JSON.stringify(payload.body) : undefined,
        signal: AbortSignal.timeout(payload.timeout || 30000),
      });

      const text = await response.text();

      return {
        success: response.ok,
        output: `${response.status} ${response.statusText}\n${text.slice(0, 1000)}`,
        error: response.ok ? undefined : `HTTP ${response.status}`,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute a tool job
   */
  private async executeToolJob(payload: ToolJobPayload): Promise<JobRunResult> {
    const startTime = Date.now();

    try {
      // Import tool registry dynamically to avoid circular deps
      const { getToolRegistry } = await import('../chat/execution/registry.js');
      const registry = getToolRegistry();
      const tool = registry.get(payload.tool);

      if (!tool) {
        return {
          success: false,
          error: `Tool not found: ${payload.tool}`,
          durationMs: Date.now() - startTime,
        };
      }

      // Create minimal execution context
      const context = {
        toolCallId: crypto.randomUUID(),
        conversationId: payload.conversationId || 'scheduled-job',
        workdir: process.cwd(),
        env: process.env as Record<string, string>,
        securityPolicy: { mode: 'full' as const },
        sessionManager: {
          create: () => ({} as any),
          get: () => undefined,
          update: () => {},
          list: () => [],
          kill: async () => {},
          cleanup: () => {},
        },
      };

      const result = await tool.execute(context, payload.params);

      return {
        success: result.success,
        output: result.output || JSON.stringify(result.data),
        error: result.error?.message,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute a script job
   * Security: Commands are validated against an allowlist and shell execution is disabled
   */
  private async executeScriptJob(payload: ScriptJobPayload): Promise<JobRunResult> {
    const startTime = Date.now();

    try {
      // Import security validation
      const { validateCommand } = await import('../utils/security.js');
      const { spawn } = await import('child_process');

      // Validate command against allowlist and check for injection
      const validation = validateCommand(payload.command, payload.args);
      if (!validation.valid) {
        return {
          success: false,
          error: `Command validation failed: ${validation.error}`,
          durationMs: Date.now() - startTime,
        };
      }

      return new Promise((resolve) => {
        const args = validation.sanitizedArgs || [];
        
        // SECURITY: shell: false prevents shell injection attacks
        const proc = spawn(validation.sanitizedCommand!, args, {
          cwd: payload.workdir || process.cwd(),
          timeout: payload.timeout || 60000,
          shell: false, // Explicitly disable shell to prevent injection
        });

        let stdout = '';
        let stderr = '';

        proc.stdout?.on('data', (data) => {
          stdout += data.toString();
        });

        proc.stderr?.on('data', (data) => {
          stderr += data.toString();
        });

        proc.on('close', (code) => {
          resolve({
            success: code === 0,
            output: stdout.slice(0, 10000),
            error: code !== 0 ? (stderr || `Exit code: ${code}`) : undefined,
            durationMs: Date.now() - startTime,
          });
        });

        proc.on('error', (err) => {
          resolve({
            success: false,
            error: err.message,
            durationMs: Date.now() - startTime,
          });
        });
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute a message job
   */
  private async executeMessageJob(payload: MessageJobPayload): Promise<JobRunResult> {
    const startTime = Date.now();

    try {
      // This would integrate with the chat system to send a message
      // For now, just log it
      log.info(`Message job: Would send to ${payload.conversationId}: ${payload.content.slice(0, 100)}`);

      return {
        success: true,
        output: `Message queued for conversation ${payload.conversationId}`,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Calculate next run time from cron or interval
   */
  private calculateNextRun(cronExpression?: string, intervalMs?: number): Date | null {
    const now = Date.now();

    if (intervalMs) {
      return new Date(now + intervalMs);
    }

    if (cronExpression) {
      // Simple cron parsing for common patterns
      // BullMQ handles the actual scheduling
      return new Date(now + 60000); // Default: 1 minute from now
    }

    return null;
  }

  /**
   * Map database row to ScheduledJob type
   */
  private mapToScheduledJob(row: any): ScheduledJob {
    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      // Schedule
      cronExpression: row.cronExpression || undefined,
      intervalMs: row.intervalMs || undefined,
      runAt: row.runAt ? new Date(row.runAt) : undefined,
      timezone: row.timezone || 'UTC',
      // Event trigger
      eventTrigger: row.eventTrigger || undefined,
      // Execution
      jobType: row.jobType as JobType,
      payload: row.payload as Record<string, any>,
      templateId: row.templateId || undefined,
      // Labels
      labels: row.labels || [],
      // Delivery
      delivery: row.delivery || undefined,
      // Status
      status: row.status as JobStatus,
      userId: row.userId || undefined,
      projectId: row.projectId || undefined,
      createdBy: row.createdBy as 'human' | 'ai',
      // Execution tracking
      lastRunAt: row.lastRunAt ? new Date(row.lastRunAt) : undefined,
      lastRunStatus: row.lastRunStatus || undefined,
      lastRunError: row.lastRunError || undefined,
      nextRunAt: row.nextRunAt ? new Date(row.nextRunAt) : undefined,
      // Stats
      runCount: row.runCount,
      successCount: row.successCount,
      failureCount: row.failureCount,
      // Limits
      maxRuns: row.maxRuns || undefined,
      maxFailures: row.maxFailures || undefined,
      // Retry policy
      retryOnFailure: row.retryOnFailure ?? true,
      retryDelayMs: row.retryDelayMs ?? 60000,
      retryBackoffMultiplier: row.retryBackoffMultiplier ?? 2,
      retryMaxDelayMs: row.retryMaxDelayMs ?? 3600000,
      currentRetryCount: row.currentRetryCount ?? 0,
      // One-shot options
      deleteOnComplete: row.deleteOnComplete ?? false,
      // Timestamps
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
      expiresAt: row.expiresAt ? new Date(row.expiresAt) : undefined,
      archivedAt: row.archivedAt ? new Date(row.archivedAt) : undefined,
    };
  }

  /**
   * Trigger a job by event (for event-driven jobs)
   */
  async triggerByEvent(
    eventType: EventTriggerType,
    eventData: Record<string, any>
  ): Promise<{ triggered: string[] }> {
    const db = await getDb();
    const triggered: string[] = [];

    // Find jobs listening for this event type
    const jobs = await db
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.status, 'active'));

    for (const job of jobs) {
      const trigger = job.eventTrigger as EventTrigger | null;
      if (!trigger || trigger.type !== eventType) continue;

      // Check if event matches trigger config
      if (this.matchesEventTrigger(trigger, eventData)) {
        // Queue execution
        if (this.queue) {
          await this.queue.add(
            'event-triggered-run',
            { jobId: job.id, triggeredBy: `event:${eventType}`, eventData },
            { jobId: `event-${job.id}-${Date.now()}` }
          );
        } else {
          await this.executeJob(job.id, `event:${eventType}`);
        }
        triggered.push(job.id);
        log.info(`Triggered job ${job.name} by event: ${eventType}`);
      }
    }

    return { triggered };
  }

  /**
   * Check if event data matches a trigger config
   */
  private matchesEventTrigger(trigger: EventTrigger, eventData: Record<string, any>): boolean {
    const config = trigger.config;

    switch (trigger.type) {
      case 'webhook':
        // Match by webhook secret or source
        return !config.source || config.source === eventData.source;

      case 'ticket':
        // Match by ticket event type (created, updated, status_changed)
        return !config.eventType || config.eventType === eventData.eventType;

      case 'file':
        // Match by file path pattern
        if (config.pathPattern && eventData.path) {
          const regex = new RegExp(config.pathPattern);
          return regex.test(eventData.path);
        }
        return true;

      case 'github':
        // Match by GitHub event type (push, pull_request, issue)
        return !config.eventType || config.eventType === eventData.eventType;

      default:
        return true;
    }
  }
}

// Export singleton functions
export const createScheduledJob = (params: CreateJobParams) => getScheduler().createJob(params);
export const getScheduledJob = (id: string) => getScheduler().getJob(id);
export const listScheduledJobs = (filters?: Parameters<JobScheduler['listJobs']>[0]) =>
  getScheduler().listJobs(filters);
export const updateScheduledJob = (id: string, updates: Parameters<JobScheduler['updateJob']>[1]) =>
  getScheduler().updateJob(id, updates);
export const pauseScheduledJob = (id: string) => getScheduler().pauseJob(id);
export const resumeScheduledJob = (id: string) => getScheduler().resumeJob(id);
export const deleteScheduledJob = (id: string) => getScheduler().deleteJob(id);
export const archiveScheduledJob = (id: string) => getScheduler().archiveJob(id);
export const restoreScheduledJob = (id: string) => getScheduler().restoreJob(id);
export const triggerScheduledJob = (id: string) => getScheduler().triggerJob(id);
export const getJobRunHistory = (jobId: string, limit?: number) =>
  getScheduler().getJobHistory(jobId, limit);
export const startScheduler = () => getScheduler().start();
export const stopScheduler = () => getScheduler().stop();
