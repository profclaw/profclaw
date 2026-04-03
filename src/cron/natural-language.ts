/**
 * Natural Language Cron Parser
 *
 * Converts human-readable scheduling descriptions into cron expressions
 * and structured job parameters. This is the "just tell me what you want"
 * layer that makes profClaw feel autonomous.
 *
 * Examples:
 *   "every morning at 8am summarize GitHub notifications"
 *   "every friday at 5pm send sprint report to slack"
 *   "check server health every 30 minutes"
 *   "once a day at midnight clean up old logs"
 *   "every weekday at 9am pull RSS feeds and send digest to telegram"
 */

import { createContextualLogger } from '../utils/logger.js';
import type { CreateJobParams, DeliveryChannelType, JobType } from './scheduler.js';

const log = createContextualLogger('NLCron');

// Types

export interface ParsedSchedule {
  cronExpression?: string;
  intervalMs?: number;
  runAt?: Date;
  timezone: string;
  confidence: number;
  humanReadable: string;
}

export interface ParsedIntent {
  action: string;
  target?: string;
  details: Record<string, string>;
}

export interface ParsedDelivery {
  channel: DeliveryChannelType;
  target: string;
}

export interface NaturalLanguageResult {
  success: boolean;
  schedule?: ParsedSchedule;
  intent?: ParsedIntent;
  delivery?: ParsedDelivery;
  jobParams?: CreateJobParams;
  rawInput: string;
  error?: string;
}

// Schedule Patterns

interface SchedulePattern {
  pattern: RegExp;
  extract: (match: RegExpMatchArray) => Partial<ParsedSchedule>;
}

const SCHEDULE_PATTERNS: SchedulePattern[] = [
  // MOST SPECIFIC FIRST - order matters since first match wins

  // "every weekday at N" / "weekdays at N" (must be before generic "every...at")
  {
    pattern: /(?:every\s+)?weekday(?:s)?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
    extract: (m) => {
      const hour = parseHour(m[1], m[3]);
      const min = m[2] ? parseInt(m[2], 10) : 0;
      return {
        cronExpression: `${min} ${hour} * * 1-5`,
        humanReadable: `weekdays at ${formatTime(hour, min)}`,
      };
    },
  },
  // "every monday/tuesday/etc at N" (must be before generic "every...at")
  {
    pattern: /every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:s)?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
    extract: (m) => {
      const day = DAY_MAP[m[1].toLowerCase()];
      const hour = parseHour(m[2], m[4]);
      const min = m[3] ? parseInt(m[3], 10) : 0;
      return {
        cronExpression: `${min} ${hour} * * ${day}`,
        humanReadable: `every ${m[1]} at ${formatTime(hour, min)}`,
      };
    },
  },
  // "every fri/mon/etc at N" (shorthand, must be before generic)
  {
    pattern: /every\s+(mon|tue|wed|thu|fri|sat|sun)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
    extract: (m) => {
      const dayShort = m[1].toLowerCase();
      const dayFull = Object.keys(DAY_MAP).find(d => d.startsWith(dayShort)) ?? dayShort;
      const day = DAY_MAP[dayFull] ?? 1;
      const hour = parseHour(m[2], m[4]);
      const min = m[3] ? parseInt(m[3], 10) : 0;
      return {
        cronExpression: `${min} ${hour} * * ${day}`,
        humanReadable: `every ${dayFull} at ${formatTime(hour, min)}`,
      };
    },
  },
  // "every N minutes/hours"
  {
    pattern: /every\s+(\d+)\s*(min(?:ute)?s?|hrs?|hours?)/i,
    extract: (m) => {
      const n = parseInt(m[1], 10);
      const unit = m[2].toLowerCase();
      if (unit.startsWith('min')) {
        return {
          cronExpression: n < 60 ? `*/${n} * * * *` : undefined,
          intervalMs: n < 60 ? undefined : n * 60 * 1000,
          humanReadable: `every ${n} minute${n > 1 ? 's' : ''}`,
        };
      }
      return {
        cronExpression: `0 */${n} * * *`,
        humanReadable: `every ${n} hour${n > 1 ? 's' : ''}`,
      };
    },
  },
  // "every hour"
  {
    pattern: /every\s+hour\b/i,
    extract: () => ({
      cronExpression: '0 * * * *',
      humanReadable: 'every hour',
    }),
  },
  // "every N seconds" (use interval, not cron)
  {
    pattern: /every\s+(\d+)\s*(?:sec(?:ond)?s?)/i,
    extract: (m) => ({
      intervalMs: parseInt(m[1], 10) * 1000,
      humanReadable: `every ${m[1]} seconds`,
    }),
  },
  // "every morning at N" / "every day at N"
  {
    pattern: /every\s+(?:morning|day)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
    extract: (m) => {
      const hour = parseHour(m[1], m[3]);
      const min = m[2] ? parseInt(m[2], 10) : 0;
      return {
        cronExpression: `${min} ${hour} * * *`,
        humanReadable: `every day at ${formatTime(hour, min)}`,
      };
    },
  },
  // "daily at N"
  {
    pattern: /daily\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
    extract: (m) => {
      const hour = parseHour(m[1], m[3]);
      const min = m[2] ? parseInt(m[2], 10) : 0;
      return {
        cronExpression: `${min} ${hour} * * *`,
        humanReadable: `daily at ${formatTime(hour, min)}`,
      };
    },
  },
  // "at N am/pm" (implicit daily)
  {
    pattern: /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
    extract: (m) => {
      const hour = parseHour(m[1], m[3]);
      const min = m[2] ? parseInt(m[2], 10) : 0;
      return {
        cronExpression: `${min} ${hour} * * *`,
        humanReadable: `daily at ${formatTime(hour, min)}`,
      };
    },
  },
  // "once a day at midnight"
  {
    pattern: /once\s+a\s+day\s+(?:at\s+)?midnight/i,
    extract: () => ({
      cronExpression: '0 0 * * *',
      humanReadable: 'daily at midnight',
    }),
  },
  // "once a day at noon"
  {
    pattern: /once\s+a\s+day\s+(?:at\s+)?noon/i,
    extract: () => ({
      cronExpression: '0 12 * * *',
      humanReadable: 'daily at noon',
    }),
  },
  // "every night" / "nightly"
  {
    pattern: /(?:every\s+night|nightly)\s*(?:at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i,
    extract: (m) => {
      const hour = m[1] ? parseHour(m[1], m[3]) : 23;
      const min = m[2] ? parseInt(m[2], 10) : 0;
      return {
        cronExpression: `${min} ${hour} * * *`,
        humanReadable: `nightly at ${formatTime(hour, min)}`,
      };
    },
  },
  // "twice a day" / "every 12 hours"
  {
    pattern: /twice\s+a\s+day/i,
    extract: () => ({
      cronExpression: '0 8,20 * * *',
      humanReadable: 'twice a day (8am & 8pm)',
    }),
  },
  // "weekly" / "every week"
  {
    pattern: /(?:every\s+week|weekly)\b/i,
    extract: () => ({
      cronExpression: '0 9 * * 1',
      humanReadable: 'weekly on Monday at 9am',
    }),
  },
  // "monthly" / "every month"
  {
    pattern: /(?:every\s+month|monthly)\b/i,
    extract: () => ({
      cronExpression: '0 9 1 * *',
      humanReadable: 'monthly on the 1st at 9am',
    }),
  },
  // "in N minutes/hours" (one-shot)
  {
    pattern: /\bin\s+(\d+)\s*(min(?:ute)?s?|hrs?|hours?)\b/i,
    extract: (m) => {
      const n = parseInt(m[1], 10);
      const unit = m[2].toLowerCase();
      const ms = unit.startsWith('min') ? n * 60 * 1000 : n * 3600 * 1000;
      return {
        runAt: new Date(Date.now() + ms),
        humanReadable: `in ${n} ${unit.startsWith('min') ? 'minute' : 'hour'}${n > 1 ? 's' : ''}`,
      };
    },
  },
  // "tomorrow at N"
  {
    pattern: /tomorrow\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
    extract: (m) => {
      const hour = parseHour(m[1], m[3]);
      const min = m[2] ? parseInt(m[2], 10) : 0;
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(hour, min, 0, 0);
      return {
        runAt: tomorrow,
        humanReadable: `tomorrow at ${formatTime(hour, min)}`,
      };
    },
  },
];

const DAY_MAP: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

// Intent Patterns - what the user wants to DO

interface IntentPattern {
  pattern: RegExp;
  action: string;
  jobType: JobType;
  extractPayload: (match: RegExpMatchArray, input: string) => Record<string, unknown>;
}

const INTENT_PATTERNS: IntentPattern[] = [
  // GitHub-related
  {
    pattern: /summarize\s+(?:my\s+)?(?:github|gh)\s+(notifications?|issues?|prs?|pull\s*requests?)/i,
    action: 'github_summary',
    jobType: 'agent_session',
    extractPayload: (m) => ({
      prompt: `Summarize my recent GitHub ${m[1]}. Give a brief overview of what needs my attention.`,
      tool: 'github_pr',
    }),
  },
  {
    pattern: /(?:check|poll|sync)\s+(?:github|gh)\s+(issues?|prs?|notifications?)/i,
    action: 'github_sync',
    jobType: 'tool',
    extractPayload: (m) => ({
      tool: 'github_sync',
      params: { type: m[1].replace(/s$/, '') },
    }),
  },
  // Feed/news digest
  {
    pattern: /(?:pull|fetch|get|check)\s+(?:rss|feeds?|news)\s*(?:and\s+)?(?:send|create)?\s*(?:a?\s*)?(?:digest)?/i,
    action: 'feed_digest',
    jobType: 'tool',
    extractPayload: () => ({
      tool: 'feed_digest',
      params: { hours: 24, limit: 20 },
    }),
  },
  {
    pattern: /(?:news|feed)\s+digest/i,
    action: 'feed_digest',
    jobType: 'tool',
    extractPayload: () => ({
      tool: 'feed_digest',
      params: { hours: 24, limit: 20 },
    }),
  },
  // Reports
  {
    pattern: /(?:send|generate|create)\s+(?:a\s+)?(?:daily\s+)?(?:status|standup|report|summary)\s*(?:report)?/i,
    action: 'daily_report',
    jobType: 'tool',
    extractPayload: () => ({
      tool: 'generate_report',
      params: { type: 'daily_status', includeMetrics: true, format: 'markdown' },
    }),
  },
  {
    pattern: /(?:sprint|weekly)\s+(?:report|summary|review)/i,
    action: 'sprint_report',
    jobType: 'tool',
    extractPayload: () => ({
      tool: 'generate_report',
      params: { type: 'sprint_summary', includeVelocity: true },
    }),
  },
  // Health/monitoring
  {
    pattern: /(?:check|monitor)\s+(?:server|system|health|service|api)\s*(?:health|status)?/i,
    action: 'health_check',
    jobType: 'tool',
    extractPayload: () => ({
      tool: 'healthcheck',
      params: {},
    }),
  },
  // Cleanup/maintenance
  {
    pattern: /(?:clean\s*up|archive|prune|delete)\s+(?:old\s+)?(?:logs?|tickets?|data|files?|history)/i,
    action: 'cleanup',
    jobType: 'tool',
    extractPayload: (m) => ({
      tool: 'db_maintenance',
      params: { action: 'prune', target: m[0] },
    }),
  },
  // Backup
  {
    pattern: /(?:backup|export|snapshot)\s+(?:the\s+)?(?:database|db|data|config)/i,
    action: 'backup',
    jobType: 'tool',
    extractPayload: () => ({
      tool: 'db_maintenance',
      params: { action: 'backup' },
    }),
  },
  // Generic "run this prompt" (catch-all for agent_session)
  {
    pattern: /(?:run|execute|do|perform)\s+"([^"]+)"/i,
    action: 'custom_prompt',
    jobType: 'agent_session',
    extractPayload: (m) => ({
      prompt: m[1],
    }),
  },
];

// Delivery Channel Patterns

interface DeliveryPattern {
  pattern: RegExp;
  channel: DeliveryChannelType;
  extractTarget: (match: RegExpMatchArray) => string;
}

const DELIVERY_PATTERNS: DeliveryPattern[] = [
  // "to slack #channel" or "to slack channel-name"
  {
    pattern: /(?:to|via|on)\s+slack\s+(?:#)?(\S+)/i,
    channel: 'slack',
    extractTarget: (m) => `#${m[1].replace(/^#/, '')}`,
  },
  // "to #channel on slack"
  {
    pattern: /(?:to|via|on)\s+#(\S+)\s+(?:on\s+)?slack/i,
    channel: 'slack',
    extractTarget: (m) => `#${m[1]}`,
  },
  // "to slack" (no channel)
  {
    pattern: /(?:to|via|on)\s+slack\b/i,
    channel: 'slack',
    extractTarget: () => '#general',
  },
  {
    pattern: /(?:to|via|on)\s+telegram/i,
    channel: 'telegram',
    extractTarget: () => 'default',
  },
  {
    pattern: /(?:to|via|on)\s+discord(?:\s+(?:#)?(\S+))?/i,
    channel: 'discord',
    extractTarget: (m) => m[1] ?? 'general',
  },
  {
    pattern: /(?:email|mail)\s+(?:to\s+)?(\S+@\S+)/i,
    channel: 'email',
    extractTarget: (m) => m[1],
  },
  {
    pattern: /(?:to|via)\s+(?:webhook|hook)\s+(\S+)/i,
    channel: 'webhook',
    extractTarget: (m) => m[1],
  },
];

// Core Parser

/**
 * Parse a natural language automation request into structured job params.
 */
export function parseNaturalLanguage(input: string): NaturalLanguageResult {
  const trimmed = input.trim();

  if (trimmed.length < 5) {
    return { success: false, rawInput: input, error: 'Input too short to parse' };
  }

  // 1. Extract schedule
  const schedule = parseSchedule(trimmed);

  // 2. Extract intent (what to do)
  const intent = parseIntent(trimmed);

  // 3. Extract delivery channel
  const delivery = parseDelivery(trimmed);

  // Need at least a schedule or intent
  if (!schedule && !intent) {
    return {
      success: false,
      rawInput: input,
      error: 'Could not understand the schedule or action. Try something like: "every morning at 8am summarize GitHub notifications"',
    };
  }

  // Build job params
  const jobName = intent
    ? `${intent.action.replace(/_/g, ' ')}${schedule ? ` (${schedule.humanReadable})` : ''}`
    : `Scheduled task (${schedule?.humanReadable ?? 'custom'})`;

  const jobParams: CreateJobParams = {
    name: jobName,
    description: `Auto-created from: "${trimmed.length > 100 ? trimmed.slice(0, 97) + '...' : trimmed}"`,
    cronExpression: schedule?.cronExpression,
    intervalMs: schedule?.intervalMs,
    runAt: schedule?.runAt,
    timezone: schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    jobType: intent?.details['jobType'] as JobType ?? 'agent_session',
    payload: intent?.details ?? { prompt: trimmed },
    labels: ['natural-language', intent?.action ?? 'custom'],
    createdBy: 'human',
  };

  // Add delivery if detected
  if (delivery) {
    jobParams.delivery = {
      channels: [{
        type: delivery.channel,
        target: delivery.target,
        onSuccess: true,
        onFailure: true,
      }],
    };
  }

  // If no explicit schedule but has intent, default to daily 9am
  if (!schedule && intent) {
    jobParams.cronExpression = '0 9 * * *';
  }

  log.info('Parsed natural language automation', {
    input: trimmed.slice(0, 80),
    schedule: schedule?.humanReadable,
    intent: intent?.action,
    delivery: delivery?.channel,
    confidence: schedule?.confidence,
  });

  return {
    success: true,
    schedule: schedule ?? undefined,
    intent: intent ?? undefined,
    delivery: delivery ?? undefined,
    jobParams,
    rawInput: input,
  };
}

/**
 * Parse schedule from natural language.
 */
function parseSchedule(input: string): ParsedSchedule | null {
  for (const sp of SCHEDULE_PATTERNS) {
    const match = input.match(sp.pattern);
    if (match) {
      const extracted = sp.extract(match);
      return {
        cronExpression: extracted.cronExpression,
        intervalMs: extracted.intervalMs,
        runAt: extracted.runAt,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        confidence: 0.85,
        humanReadable: extracted.humanReadable ?? 'custom schedule',
      };
    }
  }
  return null;
}

/**
 * Parse action intent from natural language.
 */
function parseIntent(input: string): ParsedIntent | null {
  for (const ip of INTENT_PATTERNS) {
    const match = input.match(ip.pattern);
    if (match) {
      const payload = ip.extractPayload(match, input);
      return {
        action: ip.action,
        target: match[1],
        details: {
          jobType: ip.jobType,
          ...Object.fromEntries(
            Object.entries(payload).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]),
          ),
        },
      };
    }
  }

  // Fallback: treat entire input as a prompt for agent_session
  return {
    action: 'custom_prompt',
    details: {
      jobType: 'agent_session',
      prompt: input
        .replace(/\b(every|daily|weekly|monthly|at\s+\d+(?::\d+)?\s*(?:am|pm)?|in\s+\d+\s*\w+)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim(),
    },
  };
}

/**
 * Parse delivery channel from natural language.
 */
function parseDelivery(input: string): ParsedDelivery | null {
  for (const dp of DELIVERY_PATTERNS) {
    const match = input.match(dp.pattern);
    if (match) {
      return {
        channel: dp.channel,
        target: dp.extractTarget(match),
      };
    }
  }
  return null;
}

// Helpers

function parseHour(hourStr: string, ampm?: string): number {
  let hour = parseInt(hourStr, 10);
  if (ampm) {
    const isPm = ampm.toLowerCase() === 'pm';
    if (isPm && hour !== 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
  }
  return Math.max(0, Math.min(23, hour));
}

function formatTime(hour: number, minute: number): string {
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? 'am' : 'pm';
  const m = minute > 0 ? `:${String(minute).padStart(2, '0')}` : '';
  return `${h}${m}${ampm}`;
}

/**
 * Validate a cron expression (basic check).
 */
export function isValidCron(expression: string): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const ranges = [
    [0, 59],  // minute
    [0, 23],  // hour
    [1, 31],  // day of month
    [1, 12],  // month
    [0, 7],   // day of week (0 and 7 = Sunday)
  ];

  return parts.every((part, i) => {
    if (part === '*') return true;
    if (/^\*\/\d+$/.test(part)) return true;
    if (/^\d+-\d+$/.test(part)) return true;
    if (/^[\d,]+$/.test(part)) {
      return part.split(',').every(n => {
        const num = parseInt(n, 10);
        return num >= ranges[i][0] && num <= ranges[i][1];
      });
    }
    return false;
  });
}

/**
 * Convert a cron expression to a human-readable string.
 */
export function cronToHuman(expression: string): string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return expression;

  const [min, hour, dom, month, dow] = parts;

  // Common patterns
  if (min === '*' && hour === '*') return 'every minute';
  if (min.startsWith('*/') && hour === '*') return `every ${min.slice(2)} minutes`;
  if (min === '0' && hour.startsWith('*/')) return `every ${hour.slice(2)} hours`;
  if (min === '0' && hour === '*') return 'every hour';

  const timeStr = hour !== '*' && min !== '*'
    ? formatTime(parseInt(hour, 10), parseInt(min, 10))
    : '';

  if (dow === '1-5' && timeStr) return `weekdays at ${timeStr}`;
  if (dow !== '*' && timeStr) {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const days = dow.split(',').map(d => dayNames[parseInt(d, 10)] ?? d).join(', ');
    return `${days} at ${timeStr}`;
  }
  if (dom === '1' && month === '*' && timeStr) return `monthly on the 1st at ${timeStr}`;
  if (timeStr) return `daily at ${timeStr}`;

  return expression;
}
