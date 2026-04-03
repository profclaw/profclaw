/**
 * Cron Tool
 *
 * AI agent tool for managing scheduled jobs.
 * Allows agents to create, list, update, pause, and trigger cron jobs.
 *
 * Inspired by OpenClaw's cron command patterns.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import {
  createScheduledJob,
  getScheduledJob,
  listScheduledJobs,
  pauseScheduledJob,
  resumeScheduledJob,
  deleteScheduledJob,
  archiveScheduledJob,
  restoreScheduledJob,
  triggerScheduledJob,
  getJobRunHistory,
  type ScheduledJob,
  type JobType,
} from '../../../cron/scheduler.js';

// Cron Create Tool

const CronCreateParamsSchema = z.object({
  name: z.string().min(1).max(100)
    .describe('Name for the scheduled job'),
  description: z.string().max(500).optional()
    .describe('Optional description of what this job does'),
  cron: z.string().optional()
    .describe('Cron expression (e.g., "*/5 * * * *" for every 5 minutes, "0 9 * * 1-5" for 9am weekdays)'),
  interval: z.number().min(1000).optional()
    .describe('Alternative: interval in milliseconds (minimum 1000ms = 1 second)'),
  type: z.enum(['http', 'tool', 'script', 'agent_session']).default('http')
    .describe('Job type: http (webhook), tool (execute a tool), script (run command), agent_session (run AI agent with prompt)'),
  url: z.string().url().optional()
    .describe('For HTTP jobs: URL to call'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional()
    .describe('For HTTP jobs: HTTP method (default: GET)'),
  headers: z.record(z.string()).optional()
    .describe('For HTTP jobs: Headers to include'),
  body: z.unknown().optional()
    .describe('For HTTP jobs: Request body (will be JSON-encoded)'),
  tool: z.string().optional()
    .describe('For tool jobs: Name of the tool to execute'),
  toolParams: z.record(z.unknown()).optional()
    .describe('For tool jobs: Parameters to pass to the tool'),
  command: z.string().optional()
    .describe('For script jobs: Shell command to run'),
  args: z.array(z.string()).optional()
    .describe('For script jobs: Command arguments'),
  workdir: z.string().optional()
    .describe('For script/agent_session jobs: Working directory'),
  // Agent session params
  prompt: z.string().optional()
    .describe('For agent_session jobs: The prompt/instruction for the AI agent to execute'),
  model: z.string().optional()
    .describe('For agent_session jobs: AI model to use (e.g., sonnet, opus)'),
  effort: z.enum(['low', 'medium', 'high']).optional()
    .describe('For agent_session jobs: Thinking effort level'),
  // Delivery
  deliverTo: z.string().optional()
    .describe('Deliver results to this target (e.g., "telegram:<chat_id>" or "slack:#channel")'),
  maxRuns: z.number().min(1).optional()
    .describe('Stop job after this many runs'),
  maxFailures: z.number().min(1).optional()
    .describe('Pause job after this many consecutive failures'),
});

export type CronCreateParams = z.infer<typeof CronCreateParamsSchema>;

export interface CronCreateResult {
  job: ScheduledJob;
  message: string;
}

export const cronCreateTool: ToolDefinition<CronCreateParams, CronCreateResult> = {
  name: 'cron_create',
  description: `Create a scheduled/cron job that runs automatically.

Supports three job types:
- **http**: Call a webhook URL on schedule
- **tool**: Execute a profClaw tool on schedule
- **script**: Run a shell command on schedule

Cron expressions use standard 5-field format:
- \`*/5 * * * *\` = Every 5 minutes
- \`0 9 * * 1-5\` = 9 AM on weekdays
- \`0 0 * * *\` = Daily at midnight
- \`0 */2 * * *\` = Every 2 hours

Or use \`interval\` for fixed millisecond intervals.`,
  category: 'system',
  securityLevel: 'moderate',
  requiresApproval: true,
  allowedHosts: ['gateway', 'local'],
  parameters: CronCreateParamsSchema,
  examples: [
    {
      description: 'Create hourly health check',
      params: {
        name: 'Health Check',
        cron: '0 * * * *',
        type: 'http',
        url: 'https://api.example.com/health',
      },
    },
    {
      description: 'Run git status every 30 minutes',
      params: {
        name: 'Git Status Check',
        interval: 1800000,
        type: 'tool',
        tool: 'git_status',
        toolParams: {},
      },
    },
  ],

  async execute(context: ToolExecutionContext, params: CronCreateParams): Promise<ToolResult<CronCreateResult>> {
    try {
      // Validate schedule
      if (!params.cron && !params.interval) {
        return {
          success: false,
          error: {
            code: 'INVALID_SCHEDULE',
            message: 'Either cron or interval must be provided',
          },
        };
      }

      // Build payload based on type
      let payload: Record<string, unknown> = {};

      switch (params.type) {
        case 'http':
          if (!params.url) {
            return {
              success: false,
              error: {
                code: 'MISSING_URL',
                message: 'HTTP jobs require a url parameter',
              },
            };
          }
          payload = {
            url: params.url,
            method: params.method || 'GET',
            headers: params.headers,
            body: params.body,
          };
          break;

        case 'tool':
          if (!params.tool) {
            return {
              success: false,
              error: {
                code: 'MISSING_TOOL',
                message: 'Tool jobs require a tool parameter',
              },
            };
          }
          payload = {
            tool: params.tool,
            params: params.toolParams || {},
            conversationId: context.conversationId,
          };
          break;

        case 'script':
          if (!params.command) {
            return {
              success: false,
              error: {
                code: 'MISSING_COMMAND',
                message: 'Script jobs require a command parameter',
              },
            };
          }
          payload = {
            command: params.command,
            args: params.args,
            workdir: params.workdir || context.workdir,
          };
          break;

        case 'agent_session':
          if (!params.prompt) {
            return {
              success: false,
              error: {
                code: 'MISSING_PROMPT',
                message: 'Agent session jobs require a prompt parameter',
              },
            };
          }
          payload = {
            prompt: params.prompt,
            model: params.model,
            effort: params.effort || 'medium',
            workdir: params.workdir || context.workdir,
          };
          break;
      }

      // Parse delivery target (format: "telegram:chatId" or "slack:#channel")
      let delivery: import('../../../cron/scheduler.js').DeliveryConfig | undefined;
      if (params.deliverTo) {
        const [channelType, ...targetParts] = params.deliverTo.split(':');
        const target = targetParts.join(':');
        const validTypes = ['slack', 'webhook', 'email', 'telegram', 'discord'] as const;
        type ValidType = typeof validTypes[number];
        if (channelType && target && validTypes.includes(channelType as ValidType)) {
          delivery = {
            channels: [{
              type: channelType as ValidType,
              target,
              onSuccess: true,
              onFailure: true,
            }],
          };
        }
      }

      const job = await createScheduledJob({
        name: params.name,
        description: params.description,
        cronExpression: params.cron,
        intervalMs: params.interval,
        jobType: params.type as JobType,
        payload,
        delivery,
        createdBy: 'ai',
        maxRuns: params.maxRuns,
        maxFailures: params.maxFailures,
        userId: context.userId,
      });

      const scheduleDesc = params.cron
        ? `cron: ${params.cron}`
        : `every ${Math.round((params.interval || 0) / 1000)}s`;

      const output = [
        '## Scheduled Job Created',
        '',
        `**Name**: ${job.name}`,
        `**ID**: \`${job.id}\``,
        `**Type**: ${job.jobType}`,
        `**Schedule**: ${scheduleDesc}`,
        `**Status**: ${job.status}`,
        job.nextRunAt ? `**Next Run**: ${job.nextRunAt.toISOString()}` : '',
        '',
        '### Payload',
        '```json',
        JSON.stringify(payload, null, 2),
        '```',
        '',
        '*Use `cron_list` to view all jobs, `cron_trigger` to run immediately.*',
      ].filter(Boolean).join('\n');

      return {
        success: true,
        data: {
          job,
          message: `Created scheduled job: ${job.name}`,
        },
        output,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'CRON_CREATE_ERROR',
          message: `Failed to create scheduled job: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  },
};

// Cron List Tool

const CronListParamsSchema = z.object({
  status: z.enum(['active', 'paused', 'completed', 'failed', 'archived']).optional()
    .describe('Filter by status (including archived)'),
  type: z.enum(['http', 'tool', 'script', 'message']).optional()
    .describe('Filter by job type'),
  limit: z.number().min(1).max(100).optional().default(20)
    .describe('Maximum number of jobs to return'),
});

export type CronListParams = z.infer<typeof CronListParamsSchema>;

export interface CronListResult {
  jobs: ScheduledJob[];
  total: number;
}

export const cronListTool: ToolDefinition<CronListParams, CronListResult> = {
  name: 'cron_list',
  description: `List scheduled/cron jobs.

Shows all scheduled jobs with their status, schedule, and last run info.
Filter by status (active, paused, completed, failed) or type (http, tool, script).`,
  category: 'system',
  securityLevel: 'safe',
  allowedHosts: ['gateway', 'local'],
  parameters: CronListParamsSchema,
  examples: [
    { description: 'List all active jobs', params: { status: 'active' } },
    { description: 'List HTTP webhook jobs', params: { type: 'http' } },
  ],

  async execute(_context: ToolExecutionContext, params: CronListParams): Promise<ToolResult<CronListResult>> {
    try {
      const jobs = await listScheduledJobs({
        status: params.status,
        jobType: params.type as JobType | undefined,
        limit: params.limit,
      });

      if (jobs.length === 0) {
        return {
          success: true,
          data: { jobs: [], total: 0 },
          output: '## Scheduled Jobs\n\nNo scheduled jobs found.\n\n*Use `cron_create` to create a new job.*',
        };
      }

      const lines = [
        '## Scheduled Jobs',
        '',
        `Found **${jobs.length}** job(s):`,
        '',
        '| Name | Type | Schedule | Status | Last Run | Next Run |',
        '|------|------|----------|--------|----------|----------|',
      ];

      for (const job of jobs) {
        const schedule = job.cronExpression || `${Math.round((job.intervalMs || 0) / 1000)}s`;
        const lastRun = job.lastRunAt
          ? `${job.lastRunStatus === 'success' ? '✅' : '❌'} ${formatTimeAgo(job.lastRunAt)}`
          : '-';
        const nextRun = job.nextRunAt ? formatTimeAgo(job.nextRunAt) : '-';
        const status = formatStatus(job.status);

        lines.push(
          `| ${job.name.slice(0, 20)} | ${job.jobType} | \`${schedule}\` | ${status} | ${lastRun} | ${nextRun} |`
        );
      }

      lines.push('');
      lines.push('*Commands: `cron_trigger <id>`, `cron_pause <id>`, `cron_delete <id>`*');

      return {
        success: true,
        data: { jobs, total: jobs.length },
        output: lines.join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'CRON_LIST_ERROR',
          message: `Failed to list jobs: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  },
};

// Cron Trigger Tool

const CronTriggerParamsSchema = z.object({
  id: z.string().uuid()
    .describe('Job ID to trigger'),
});

export type CronTriggerParams = z.infer<typeof CronTriggerParamsSchema>;

export interface CronTriggerResult {
  triggered: boolean;
  runId?: string;
}

export const cronTriggerTool: ToolDefinition<CronTriggerParams, CronTriggerResult> = {
  name: 'cron_trigger',
  description: `Manually trigger a scheduled job to run immediately.

The job will run once immediately, outside of its regular schedule.
This does not affect the regular schedule.`,
  category: 'system',
  securityLevel: 'moderate',
  allowedHosts: ['gateway', 'local'],
  parameters: CronTriggerParamsSchema,
  examples: [
    { description: 'Trigger a job', params: { id: '123e4567-e89b-12d3-a456-426614174000' } },
  ],

  async execute(_context: ToolExecutionContext, params: CronTriggerParams): Promise<ToolResult<CronTriggerResult>> {
    try {
      const job = await getScheduledJob(params.id);
      if (!job) {
        return {
          success: false,
          error: {
            code: 'JOB_NOT_FOUND',
            message: `No job found with ID: ${params.id}`,
          },
        };
      }

      const result = await triggerScheduledJob(params.id);

      if (!result) {
        return {
          success: false,
          error: {
            code: 'TRIGGER_FAILED',
            message: 'Failed to trigger job',
          },
        };
      }

      return {
        success: true,
        data: { triggered: true, runId: result.runId },
        output: `## Job Triggered\n\n**${job.name}** has been triggered for immediate execution.\n\nRun ID: \`${result.runId}\``,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'CRON_TRIGGER_ERROR',
          message: `Failed to trigger job: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  },
};

// Cron Pause Tool

const CronPauseParamsSchema = z.object({
  id: z.string().uuid()
    .describe('Job ID to pause or resume'),
  action: z.enum(['pause', 'resume']).default('pause')
    .describe('Action: pause or resume the job'),
});

export type CronPauseParams = z.infer<typeof CronPauseParamsSchema>;

export interface CronPauseResult {
  success: boolean;
  status: string;
}

export const cronPauseTool: ToolDefinition<CronPauseParams, CronPauseResult> = {
  name: 'cron_pause',
  description: `Pause or resume a scheduled job.

Paused jobs will not run on their schedule until resumed.
Use this to temporarily disable a job without deleting it.`,
  category: 'system',
  securityLevel: 'safe',
  allowedHosts: ['gateway', 'local'],
  parameters: CronPauseParamsSchema,
  examples: [
    { description: 'Pause a job', params: { id: '123e4567-e89b-12d3-a456-426614174000', action: 'pause' } },
    { description: 'Resume a job', params: { id: '123e4567-e89b-12d3-a456-426614174000', action: 'resume' } },
  ],

  async execute(_context: ToolExecutionContext, params: CronPauseParams): Promise<ToolResult<CronPauseResult>> {
    try {
      const job = await getScheduledJob(params.id);
      if (!job) {
        return {
          success: false,
          error: {
            code: 'JOB_NOT_FOUND',
            message: `No job found with ID: ${params.id}`,
          },
        };
      }

      let success: boolean;
      let newStatus: string;

      if (params.action === 'pause') {
        success = await pauseScheduledJob(params.id);
        newStatus = 'paused';
      } else {
        success = await resumeScheduledJob(params.id);
        newStatus = 'active';
      }

      if (!success) {
        return {
          success: false,
          error: {
            code: 'UPDATE_FAILED',
            message: `Failed to ${params.action} job`,
          },
        };
      }

      const emoji = params.action === 'pause' ? '⏸️' : '▶️';
      return {
        success: true,
        data: { success: true, status: newStatus },
        output: `## Job ${params.action === 'pause' ? 'Paused' : 'Resumed'}\n\n${emoji} **${job.name}** is now **${newStatus}**.`,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'CRON_PAUSE_ERROR',
          message: `Failed to ${params.action} job: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  },
};

// Cron Delete Tool

const CronDeleteParamsSchema = z.object({
  id: z.string().uuid()
    .describe('Job ID to delete'),
});

export type CronDeleteParams = z.infer<typeof CronDeleteParamsSchema>;

export interface CronDeleteResult {
  deleted: boolean;
}

export const cronDeleteTool: ToolDefinition<CronDeleteParams, CronDeleteResult> = {
  name: 'cron_delete',
  description: `Delete a scheduled job permanently.

This will stop all future runs and remove the job from the system.
Run history is preserved for audit purposes.`,
  category: 'system',
  securityLevel: 'moderate',
  requiresApproval: true,
  allowedHosts: ['gateway', 'local'],
  parameters: CronDeleteParamsSchema,
  examples: [
    { description: 'Delete a job', params: { id: '123e4567-e89b-12d3-a456-426614174000' } },
  ],

  async execute(_context: ToolExecutionContext, params: CronDeleteParams): Promise<ToolResult<CronDeleteResult>> {
    try {
      const job = await getScheduledJob(params.id);
      if (!job) {
        return {
          success: false,
          error: {
            code: 'JOB_NOT_FOUND',
            message: `No job found with ID: ${params.id}`,
          },
        };
      }

      const deleted = await deleteScheduledJob(params.id);

      if (!deleted) {
        return {
          success: false,
          error: {
            code: 'DELETE_FAILED',
            message: 'Failed to delete job',
          },
        };
      }

      return {
        success: true,
        data: { deleted: true },
        output: `## Job Deleted\n\n🗑️ **${job.name}** has been deleted.\n\nTotal runs: ${job.runCount} (${job.successCount} successful)`,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'CRON_DELETE_ERROR',
          message: `Failed to delete job: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  },
};

// Cron Archive Tool

const CronArchiveParamsSchema = z.object({
  id: z.string().uuid()
    .describe('Job ID to archive or restore'),
  action: z.enum(['archive', 'restore']).default('archive')
    .describe('Action: archive (soft delete) or restore from archive'),
});

export type CronArchiveParams = z.infer<typeof CronArchiveParamsSchema>;

export interface CronArchiveResult {
  success: boolean;
  status: string;
}

export const cronArchiveTool: ToolDefinition<CronArchiveParams, CronArchiveResult> = {
  name: 'cron_archive',
  description: `Archive or restore a scheduled job.

Archived jobs are soft-deleted and won't run, but can be restored later.
Use this instead of delete when you might want to restore the job.`,
  category: 'system',
  securityLevel: 'safe',
  allowedHosts: ['gateway', 'local'],
  parameters: CronArchiveParamsSchema,
  examples: [
    { description: 'Archive a job', params: { id: '123e4567-e89b-12d3-a456-426614174000', action: 'archive' } },
    { description: 'Restore archived job', params: { id: '123e4567-e89b-12d3-a456-426614174000', action: 'restore' } },
  ],

  async execute(_context: ToolExecutionContext, params: CronArchiveParams): Promise<ToolResult<CronArchiveResult>> {
    try {
      const job = await getScheduledJob(params.id);
      if (!job) {
        return {
          success: false,
          error: {
            code: 'JOB_NOT_FOUND',
            message: `No job found with ID: ${params.id}`,
          },
        };
      }

      let success: boolean;
      let newStatus: string;

      if (params.action === 'archive') {
        if (job.status === 'archived') {
          return {
            success: false,
            error: {
              code: 'ALREADY_ARCHIVED',
              message: 'Job is already archived',
            },
          };
        }
        success = await archiveScheduledJob(params.id);
        newStatus = 'archived';
      } else {
        if (job.status !== 'archived') {
          return {
            success: false,
            error: {
              code: 'NOT_ARCHIVED',
              message: 'Job is not archived',
            },
          };
        }
        success = await restoreScheduledJob(params.id);
        newStatus = 'paused';
      }

      if (!success) {
        return {
          success: false,
          error: {
            code: 'UPDATE_FAILED',
            message: `Failed to ${params.action} job`,
          },
        };
      }

      const emoji = params.action === 'archive' ? '📦' : '📤';
      return {
        success: true,
        data: { success: true, status: newStatus },
        output: `## Job ${params.action === 'archive' ? 'Archived' : 'Restored'}\n\n${emoji} **${job.name}** is now **${newStatus}**.\n\n${params.action === 'restore' ? '*Restored jobs are paused by default. Use `cron_pause` with `resume` to activate.*' : '*Use `cron_archive` with `restore` to restore later.*'}`,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'CRON_ARCHIVE_ERROR',
          message: `Failed to ${params.action} job: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  },
};

// Cron History Tool

const CronHistoryParamsSchema = z.object({
  id: z.string().uuid()
    .describe('Job ID to get history for'),
  limit: z.number().min(1).max(50).optional().default(10)
    .describe('Number of runs to show'),
});

export type CronHistoryParams = z.infer<typeof CronHistoryParamsSchema>;

export interface CronHistoryResult {
  jobName: string;
  runs: Array<{
    id: string;
    startedAt: Date;
    status: string;
    durationMs?: number;
    error?: string;
  }>;
}

export const cronHistoryTool: ToolDefinition<CronHistoryParams, CronHistoryResult> = {
  name: 'cron_history',
  description: `View run history for a scheduled job.

Shows recent executions with their status, duration, and any errors.`,
  category: 'system',
  securityLevel: 'safe',
  allowedHosts: ['gateway', 'local'],
  parameters: CronHistoryParamsSchema,
  examples: [
    { description: 'Get last 10 runs', params: { id: '123e4567-e89b-12d3-a456-426614174000' } },
  ],

  async execute(_context: ToolExecutionContext, params: CronHistoryParams): Promise<ToolResult<CronHistoryResult>> {
    try {
      const job = await getScheduledJob(params.id);
      if (!job) {
        return {
          success: false,
          error: {
            code: 'JOB_NOT_FOUND',
            message: `No job found with ID: ${params.id}`,
          },
        };
      }

      const history = await getJobRunHistory(params.id, params.limit);

      if (history.length === 0) {
        return {
          success: true,
          data: { jobName: job.name, runs: [] },
          output: `## Run History: ${job.name}\n\nNo runs yet.`,
        };
      }

      const lines = [
        `## Run History: ${job.name}`,
        '',
        `Showing last **${history.length}** run(s):`,
        '',
        '| Time | Status | Duration | Triggered By |',
        '|------|--------|----------|--------------|',
      ];

      for (const run of history.reverse()) {
        const status = run.status === 'success' ? '✅' : run.status === 'error' ? '❌' : '⏳';
        const duration = run.durationMs ? `${run.durationMs}ms` : '-';
        const time = formatTimeAgo(run.startedAt);

        lines.push(`| ${time} | ${status} ${run.status} | ${duration} | ${run.triggeredBy} |`);
      }

      return {
        success: true,
        data: {
          jobName: job.name,
          runs: history.map((r) => ({
            id: r.id,
            startedAt: r.startedAt,
            status: r.status,
            durationMs: r.durationMs,
            error: r.error,
          })),
        },
        output: lines.join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'CRON_HISTORY_ERROR',
          message: `Failed to get history: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  },
};

// Export All Cron Tools

export const cronTools = [
  cronCreateTool,
  cronListTool,
  cronTriggerTool,
  cronPauseTool,
  cronArchiveTool,
  cronDeleteTool,
  cronHistoryTool,
];

// Helpers

function formatStatus(status: string): string {
  switch (status) {
    case 'active':
      return '🟢 active';
    case 'paused':
      return '⏸️ paused';
    case 'completed':
      return '✅ done';
    case 'failed':
      return '❌ failed';
    case 'archived':
      return '📦 archived';
    default:
      return status;
  }
}

function formatTimeAgo(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();

  if (diff < 0) {
    // Future
    const absDiff = Math.abs(diff);
    if (absDiff < 60000) return `in ${Math.round(absDiff / 1000)}s`;
    if (absDiff < 3600000) return `in ${Math.round(absDiff / 60000)}m`;
    if (absDiff < 86400000) return `in ${Math.round(absDiff / 3600000)}h`;
    return `in ${Math.round(absDiff / 86400000)}d`;
  }

  // Past
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}
