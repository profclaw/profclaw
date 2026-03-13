/**
 * Job Templates System
 *
 * Pre-built job configurations that users can quickly deploy.
 * Templates provide sensible defaults for common automation patterns.
 */

import { getDb } from '../storage/index.js';
import { jobTemplates } from '../storage/schema.js';
import { eq } from 'drizzle-orm';
import type { JobType, RetryPolicy, DeliveryConfig } from './scheduler.js';

// =============================================================================
// Types
// =============================================================================

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

export type TemplateCategory = 'sync' | 'report' | 'cleanup' | 'notification' | 'monitoring' | 'custom';

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

// =============================================================================
// Built-in Templates
// =============================================================================

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
];

// =============================================================================
// Template Service
// =============================================================================

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
