/**
 * Job Templates System
 *
 * Pre-built job configurations that users can quickly deploy.
 * Templates provide sensible defaults for common automation patterns.
 */

import { getDb } from '../storage/index.js';
import { jobTemplates } from '../storage/schema.js';
import { eq } from 'drizzle-orm';
import type { JobType, RetryPolicy, DeliveryConfig, DeliveryChannelType } from './scheduler.js';

// Types

export interface JobTemplate {
  id: string;
  name: string;
  description?: string;
  icon: string;
  category: TemplateCategory;
  jobType: JobType;
  payloadTemplate: Record<string, TemplateValue>;
  suggestedCron?: string;
  suggestedIntervalMs?: number;
  defaultRetryPolicy?: RetryPolicy;
  defaultDelivery?: DeliveryConfig;
  isBuiltIn: boolean;
  userId?: string;
  projectId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type TemplateCategory = 'sync' | 'report' | 'cleanup' | 'notification' | 'monitoring' | 'automation' | 'custom';

export interface CreateTemplateParams {
  name: string;
  description?: string;
  icon?: string;
  category?: TemplateCategory;
  jobType: JobType;
  payloadTemplate: Record<string, TemplateValue>;
  suggestedCron?: string;
  suggestedIntervalMs?: number;
  defaultRetryPolicy?: RetryPolicy;
  defaultDelivery?: DeliveryConfig;
  userId?: string;
  projectId?: string;
}

type TemplateValue =
  | string
  | number
  | boolean
  | null
  | TemplateValue[]
  | { [key: string]: TemplateValue };

// Built-in Templates

export const BUILT_IN_TEMPLATES: Omit<JobTemplate, 'id' | 'createdAt' | 'updatedAt'>[] = [
  // --- Sync Templates ---
  {
    name: 'GitHub Issue Sync',
    description: 'Sync open GitHub issues to profClaw tickets periodically',
    icon: '🔄',
    category: 'sync',
    jobType: 'tool',
    payloadTemplate: {
      tool: 'github_sync',
      params: {
        owner: '{{owner}}',
        repo: '{{repo}}',
        state: 'open',
        labels: [],
      },
    },
    suggestedCron: '0 */6 * * *', // Every 6 hours
    defaultRetryPolicy: {
      enabled: true,
      initialDelayMs: 300000, // 5 min
      backoffMultiplier: 2,
      maxDelayMs: 3600000,
      maxRetries: 3,
    },
    isBuiltIn: true,
  },
  {
    name: 'Linear Sync',
    description: 'Sync Linear issues to profClaw tickets',
    icon: '📐',
    category: 'sync',
    jobType: 'tool',
    payloadTemplate: {
      tool: 'linear_sync',
      params: {
        teamId: '{{teamId}}',
        states: ['todo', 'in_progress'],
      },
    },
    suggestedCron: '0 */4 * * *', // Every 4 hours
    isBuiltIn: true,
  },

  // --- Report Templates ---
  {
    name: 'Daily Status Report',
    description: 'Generate a daily summary of ticket activity and send via Slack',
    icon: '📊',
    category: 'report',
    jobType: 'tool',
    payloadTemplate: {
      tool: 'generate_report',
      params: {
        type: 'daily_status',
        includeMetrics: true,
        format: 'markdown',
      },
    },
    suggestedCron: '0 9 * * 1-5', // 9 AM weekdays
    defaultDelivery: {
      channels: [
        { type: 'slack', target: '#team-updates', onSuccess: true, onFailure: false },
      ],
    },
    isBuiltIn: true,
  },
  {
    name: 'Weekly Sprint Summary',
    description: 'Generate end-of-week sprint progress report',
    icon: '📈',
    category: 'report',
    jobType: 'tool',
    payloadTemplate: {
      tool: 'generate_report',
      params: {
        type: 'sprint_summary',
        includeVelocity: true,
        includeBlockers: true,
      },
    },
    suggestedCron: '0 17 * * 5', // Friday 5 PM
    isBuiltIn: true,
  },

  // --- Cleanup Templates ---
  {
    name: 'Archive Old Tickets',
    description: 'Archive tickets that have been completed for 30+ days',
    icon: '🗄️',
    category: 'cleanup',
    jobType: 'tool',
    payloadTemplate: {
      tool: 'archive_tickets',
      params: {
        olderThanDays: 30,
        status: ['done', 'cancelled'],
        dryRun: false,
      },
    },
    suggestedCron: '0 3 * * 0', // Sunday 3 AM
    isBuiltIn: true,
  },
  {
    name: 'Cleanup Stale Sessions',
    description: 'Clean up chat sessions inactive for 7+ days',
    icon: '🧹',
    category: 'cleanup',
    jobType: 'tool',
    payloadTemplate: {
      tool: 'cleanup_sessions',
      params: {
        inactiveDays: 7,
        preserveWithHistory: true,
      },
    },
    suggestedCron: '0 4 * * *', // Daily 4 AM
    isBuiltIn: true,
  },

  // --- Notification Templates ---
  {
    name: 'Standup Reminder',
    description: 'Send daily standup reminder to team channel',
    icon: '⏰',
    category: 'notification',
    jobType: 'message',
    payloadTemplate: {
      conversationId: '{{conversationId}}',
      content: "🌅 Good morning! Time for standup. What did you work on yesterday? What are you working on today? Any blockers?",
    },
    suggestedCron: '0 9 * * 1-5', // 9 AM weekdays
    defaultDelivery: {
      channels: [
        { type: 'slack', target: '#standup', onSuccess: true },
      ],
    },
    isBuiltIn: true,
  },
  {
    name: 'Due Date Alert',
    description: 'Alert about tickets due within 24 hours',
    icon: '⚠️',
    category: 'notification',
    jobType: 'tool',
    payloadTemplate: {
      tool: 'check_due_dates',
      params: {
        withinHours: 24,
        notifyAssignees: true,
      },
    },
    suggestedCron: '0 8 * * *', // Daily 8 AM
    isBuiltIn: true,
  },

  // --- Monitoring Templates ---
  {
    name: 'Health Check',
    description: 'Ping an endpoint to verify service health',
    icon: '💓',
    category: 'monitoring',
    jobType: 'http',
    payloadTemplate: {
      url: '{{healthCheckUrl}}',
      method: 'GET',
      timeout: 10000,
    },
    suggestedIntervalMs: 60000, // Every minute
    defaultRetryPolicy: {
      enabled: true,
      initialDelayMs: 5000,
      backoffMultiplier: 1.5,
      maxDelayMs: 30000,
      maxRetries: 5,
    },
    defaultDelivery: {
      channels: [
        { type: 'slack', target: '#alerts', onSuccess: false, onFailure: true },
      ],
    },
    isBuiltIn: true,
  },
  {
    name: 'API Metrics Collection',
    description: 'Collect API metrics and store for analysis',
    icon: '📉',
    category: 'monitoring',
    jobType: 'script',
    payloadTemplate: {
      command: 'curl',
      args: ['-s', '{{metricsUrl}}', '-o', '/tmp/metrics-$(date +%Y%m%d).json'],
      timeout: 30000,
    },
    suggestedIntervalMs: 300000, // Every 5 minutes
    isBuiltIn: true,
  },
  {
    name: 'Database Maintenance',
    description: 'Optimize database performance and migrate legacy data formats',
    icon: '⚙️',
    category: 'cleanup',
    jobType: 'tool',
    payloadTemplate: {
      tool: 'db_maintenance',
      params: {
        optimize: true,
        migrateSummaries: true,
        cleanupLogs: false,
      },
    },
    suggestedCron: '0 2 * * *', // Daily at 2 AM
    isBuiltIn: true,
  },

  // --- Feed Polling ---
  {
    name: 'Feed Poller',
    description: 'Poll all enabled RSS/Atom feeds for new articles. Runs hourly by default.',
    icon: '📡',
    category: 'sync',
    jobType: 'tool',
    payloadTemplate: {
      tool: 'poll_all_feeds',
      params: {},
    },
    suggestedCron: '0 * * * *', // Every hour
    isBuiltIn: true,
  },

  // --- Automation Templates (agent_session) ---
  {
    name: 'Morning AI News Digest',
    description: 'Search for the latest AI and tech news, summarize the top stories, and deliver to your preferred channel',
    icon: '📰',
    category: 'automation',
    jobType: 'agent_session' as JobType,
    payloadTemplate: {
      prompt: 'Search for the latest AI and technology news from today. Find the top 5 most important stories. For each story provide: 1) A one-line headline, 2) A 2-3 sentence summary, 3) Why it matters. Format the output cleanly for a messaging app. No markdown headers, use plain text with line breaks.',
      effort: 'medium',
    },
    suggestedCron: '0 7 * * 1-5', // 7 AM weekdays
    defaultDelivery: {
      channels: [
        { type: 'telegram' as DeliveryChannelType, target: '{{telegramChatId}}', onSuccess: true, onFailure: true },
      ],
    },
    defaultRetryPolicy: {
      enabled: true,
      initialDelayMs: 300000,
      backoffMultiplier: 2,
      maxDelayMs: 1800000,
      maxRetries: 2,
    },
    isBuiltIn: true,
  },
  {
    name: 'Daily Standup Prep',
    description: 'Scan GitHub activity and Linear/Jira tickets to generate a standup-ready summary of what happened yesterday',
    icon: '🧑‍💻',
    category: 'automation',
    jobType: 'agent_session' as JobType,
    payloadTemplate: {
      prompt: 'Prepare a daily standup summary. Check recent GitHub commits, pull requests, and issue activity. Summarize: 1) What was completed yesterday, 2) What is in progress, 3) Any blockers or items needing attention. Keep it brief and actionable.',
      effort: 'medium',
    },
    suggestedCron: '30 8 * * 1-5', // 8:30 AM weekdays
    defaultDelivery: {
      channels: [
        { type: 'slack' as DeliveryChannelType, target: '#standup', onSuccess: true },
      ],
    },
    isBuiltIn: true,
  },
  {
    name: 'Weekly Repo Digest',
    description: 'Generate a weekly summary of repository activity including PRs merged, issues closed, and key changes',
    icon: '📊',
    category: 'automation',
    jobType: 'agent_session' as JobType,
    payloadTemplate: {
      prompt: 'Generate a weekly repository digest. Summarize: 1) Pull requests merged this week, 2) Issues opened and closed, 3) Notable code changes or patterns, 4) Contributors active this week. Format as a clean summary suitable for a team channel.',
      effort: 'medium',
    },
    suggestedCron: '0 17 * * 5', // Friday 5 PM
    defaultDelivery: {
      channels: [
        { type: 'slack' as DeliveryChannelType, target: '#engineering', onSuccess: true },
      ],
    },
    isBuiltIn: true,
  },
  {
    name: 'Security Advisory Check',
    description: 'Scan for new security advisories and CVEs relevant to your project dependencies',
    icon: '🔒',
    category: 'automation',
    jobType: 'agent_session' as JobType,
    payloadTemplate: {
      prompt: 'Search for the latest security advisories and CVEs published in the last 24 hours that are relevant to Node.js, TypeScript, and common web dependencies. Focus on critical and high severity issues. For each finding: 1) CVE ID and severity, 2) Affected package/version, 3) One-line description, 4) Recommended action. If nothing critical found, say so briefly.',
      effort: 'medium',
    },
    suggestedCron: '0 9 * * *', // Daily 9 AM
    defaultDelivery: {
      channels: [
        { type: 'slack' as DeliveryChannelType, target: '#security', onSuccess: true, onFailure: true },
      ],
    },
    isBuiltIn: true,
  },
  {
    name: 'Feed-Powered News Digest',
    description: 'Poll RSS feeds and summarize new articles. Cheaper and more reliable than web search for recurring news digests.',
    icon: '📡',
    category: 'automation',
    jobType: 'agent_session' as JobType,
    payloadTemplate: {
      prompt: 'Check the RSS feed engine for new articles from the last 24 hours. Summarize the top {{count}} most interesting stories. For each: a one-line headline and a 2-sentence summary. Focus on {{category}} feeds. Format for a messaging app - plain text, no markdown headers.',
      effort: 'low',
    },
    suggestedCron: '0 7 * * *', // Daily 7 AM
    defaultDelivery: {
      channels: [
        { type: 'telegram' as DeliveryChannelType, target: '{{telegramChatId}}', onSuccess: true },
      ],
    },
    isBuiltIn: true,
  },
  {
    name: 'Custom AI Agent Task',
    description: 'Run any prompt on a schedule with full tool access. The agent can search the web, read files, run commands, and more.',
    icon: '🤖',
    category: 'automation',
    jobType: 'agent_session' as JobType,
    payloadTemplate: {
      prompt: '{{prompt}}',
      systemPrompt: '{{systemPrompt}}',
      effort: 'medium',
    },
    suggestedCron: '0 9 * * *', // Daily 9 AM
    isBuiltIn: true,
  },
  {
    name: 'Competitor Watch',
    description: 'Monitor competitor activity by searching for recent news, product launches, and announcements',
    icon: '👁️',
    category: 'automation',
    jobType: 'agent_session' as JobType,
    payloadTemplate: {
      prompt: 'Search for the latest news and announcements from {{competitors}}. Focus on: product launches, pricing changes, major partnerships, and funding rounds from the past week. Summarize the top 3-5 developments with links where possible.',
      effort: 'medium',
    },
    suggestedCron: '0 8 * * 1', // Monday 8 AM
    defaultDelivery: {
      channels: [
        { type: 'telegram' as DeliveryChannelType, target: '{{telegramChatId}}', onSuccess: true },
      ],
    },
    isBuiltIn: true,
  },

  // --- Feed Digest Templates ---
  {
    name: 'Morning AI News Digest',
    description: 'Poll AI/tech RSS feeds and send a curated digest with summaries',
    icon: '📰',
    category: 'automation',
    jobType: 'tool' as JobType,
    payloadTemplate: {
      tool: 'feed_digest',
      params: {
        category: 'ai',
        hours: 24,
        limit: 15,
      },
    },
    suggestedCron: '0 7 * * 1-5', // Weekdays 7 AM
    defaultDelivery: {
      channels: [
        { type: 'telegram' as DeliveryChannelType, target: '{{channel}}', onSuccess: true },
      ],
    },
    isBuiltIn: true,
  },
  {
    name: 'Dev News Digest',
    description: 'Daily developer news from RSS feeds - frameworks, tools, releases',
    icon: '💻',
    category: 'automation',
    jobType: 'tool' as JobType,
    payloadTemplate: {
      tool: 'feed_digest',
      params: {
        category: 'dev',
        hours: 24,
        limit: 20,
      },
    },
    suggestedCron: '0 8 * * 1-5', // Weekdays 8 AM
    isBuiltIn: true,
  },
  {
    name: 'Security Alert Digest',
    description: 'Security news and vulnerability alerts from RSS feeds',
    icon: '🔒',
    category: 'automation',
    jobType: 'tool' as JobType,
    payloadTemplate: {
      tool: 'feed_digest',
      params: {
        category: 'security',
        hours: 12,
        limit: 10,
      },
    },
    suggestedCron: '0 9,17 * * *', // Twice daily 9 AM and 5 PM
    isBuiltIn: true,
  },
  {
    name: 'Feed Poll + Digest Pipeline',
    description: 'Poll all feeds for new articles, then generate and deliver a digest',
    icon: '🔄📰',
    category: 'automation',
    jobType: 'agent_session' as JobType,
    payloadTemplate: {
      prompt: 'First, poll all RSS feeds for new articles using the feed_poll tool. Then use feed_digest to get the latest articles from the last {{hours}} hours. Summarize the top {{limit}} articles into a brief, scannable digest with titles, one-line summaries, and links. Group by category if multiple categories exist.',
      effort: 'low',
    },
    suggestedCron: '0 7 * * *', // Daily 7 AM
    defaultDelivery: {
      channels: [
        { type: 'slack' as DeliveryChannelType, target: '#news', onSuccess: true },
      ],
    },
    isBuiltIn: true,
  },
];

// Template Service

export class TemplateService {
  /**
   * Initialize built-in templates in database
   */
  async initBuiltInTemplates(): Promise<void> {
    const db = await getDb();

    for (const template of BUILT_IN_TEMPLATES) {
      const id = `builtin-${template.name.toLowerCase().replace(/\s+/g, '-')}`;

      // Check if already exists
      const [existing] = await db
        .select()
        .from(jobTemplates)
        .where(eq(jobTemplates.id, id));

      if (!existing) {
        await db.insert(jobTemplates).values({
          id,
          ...template,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }
  }

  /**
   * List all templates
   */
  async listTemplates(filters?: {
    category?: TemplateCategory;
    jobType?: JobType;
    includeBuiltIn?: boolean;
    userId?: string;
    projectId?: string;
  }): Promise<JobTemplate[]> {
    const db = await getDb();
    const templates = await db.select().from(jobTemplates);

    return templates
      .filter((t: typeof templates[number]) => {
        if (filters?.category && t.category !== filters.category) return false;
        if (filters?.jobType && t.jobType !== filters.jobType) return false;
        if (filters?.includeBuiltIn === false && t.isBuiltIn) return false;
        if (filters?.userId && t.userId !== filters.userId && !t.isBuiltIn) return false;
        if (filters?.projectId && t.projectId !== filters.projectId && !t.isBuiltIn) return false;
        return true;
      })
      .map(this.mapToTemplate);
  }

  /**
   * Get a template by ID
   */
  async getTemplate(id: string): Promise<JobTemplate | null> {
    const db = await getDb();
    const [template] = await db
      .select()
      .from(jobTemplates)
      .where(eq(jobTemplates.id, id));

    return template ? this.mapToTemplate(template) : null;
  }

  /**
   * Create a custom template
   */
  async createTemplate(params: CreateTemplateParams): Promise<JobTemplate> {
    const db = await getDb();
    const id = crypto.randomUUID();
    const now = new Date();

    const templateData = {
      id,
      name: params.name,
      description: params.description ?? null,
      icon: params.icon ?? '⚡',
      category: params.category ?? 'custom',
      jobType: params.jobType,
      payloadTemplate: params.payloadTemplate,
      suggestedCron: params.suggestedCron ?? null,
      suggestedIntervalMs: params.suggestedIntervalMs ?? null,
      defaultRetryPolicy: params.defaultRetryPolicy ?? null,
      defaultDelivery: params.defaultDelivery ?? null,
      isBuiltIn: false,
      userId: params.userId ?? null,
      projectId: params.projectId ?? null,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(jobTemplates).values(templateData);

    return this.mapToTemplate(templateData);
  }

  /**
   * Delete a template (only non-built-in)
   */
  async deleteTemplate(id: string): Promise<boolean> {
    const db = await getDb();

    const [template] = await db
      .select()
      .from(jobTemplates)
      .where(eq(jobTemplates.id, id));

    if (!template || template.isBuiltIn) {
      return false;
    }

    const result = await db.delete(jobTemplates).where(eq(jobTemplates.id, id));
    return result.rowsAffected > 0;
  }

  /**
   * Apply template to create job params
   */
  applyTemplate(
    template: JobTemplate,
    variables: Record<string, string>
  ): {
    jobType: JobType;
    payload: Record<string, TemplateValue>;
    cronExpression?: string;
    intervalMs?: number;
    retryPolicy?: RetryPolicy;
    delivery?: DeliveryConfig;
  } {
    // Replace {{variable}} placeholders in payload
    const payload = this.replaceVariables(
      template.payloadTemplate,
      variables,
    ) as Record<string, TemplateValue>;

    return {
      jobType: template.jobType,
      payload,
      cronExpression: template.suggestedCron,
      intervalMs: template.suggestedIntervalMs,
      retryPolicy: template.defaultRetryPolicy,
      delivery: template.defaultDelivery,
    };
  }

  /**
   * Replace {{variable}} placeholders with actual values
   */
  private replaceVariables(
    obj: TemplateValue,
    variables: Record<string, string>,
  ): TemplateValue {
    if (typeof obj === 'string') {
      return obj.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? `{{${key}}}`);
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.replaceVariables(item, variables));
    }
    if (typeof obj === 'object' && obj !== null) {
      const result: Record<string, TemplateValue> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.replaceVariables(value as TemplateValue, variables);
      }
      return result;
    }
    return obj;
  }

  /**
   * Map database row to JobTemplate
   */
  private mapToTemplate(row: typeof jobTemplates.$inferSelect): JobTemplate {
    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      icon: row.icon || '⚡',
      category: row.category as TemplateCategory,
      jobType: row.jobType as JobType,
      payloadTemplate: row.payloadTemplate as Record<string, TemplateValue>,
      suggestedCron: row.suggestedCron || undefined,
      suggestedIntervalMs: row.suggestedIntervalMs || undefined,
      defaultRetryPolicy: row.defaultRetryPolicy as RetryPolicy | undefined,
      defaultDelivery: row.defaultDelivery as DeliveryConfig | undefined,
      isBuiltIn: row.isBuiltIn ?? false,
      userId: row.userId || undefined,
      projectId: row.projectId || undefined,
      createdAt: new Date(row.createdAt!),
      updatedAt: new Date(row.updatedAt!),
    };
  }
}

// Singleton instance
let templateServiceInstance: TemplateService | null = null;

export function getTemplateService(): TemplateService {
  if (!templateServiceInstance) {
    templateServiceInstance = new TemplateService();
  }
  return templateServiceInstance;
}

// Export convenience functions
export const listJobTemplates = (filters?: Parameters<TemplateService['listTemplates']>[0]) =>
  getTemplateService().listTemplates(filters);
export const getJobTemplate = (id: string) => getTemplateService().getTemplate(id);
export const createJobTemplate = (params: CreateTemplateParams) =>
  getTemplateService().createTemplate(params);
export const deleteJobTemplate = (id: string) => getTemplateService().deleteTemplate(id);
export const applyJobTemplate = (template: JobTemplate, variables: Record<string, string>) =>
  getTemplateService().applyTemplate(template, variables);
export const initBuiltInTemplates = () => getTemplateService().initBuiltInTemplates();
