/**
 * Auto-Reply System
 *
 * Template-based automatic responses for chat messages.
 * Supports:
 * - Out-of-office / away mode
 * - Busy/DND mode with queue position
 * - Keyword-triggered quick replies
 * - Rate-limited to prevent spam
 * - Per-channel configuration
 */

import { logger } from '../utils/logger.js';

// --- Types ---

export interface AutoReplyTemplate {
  id: string;
  name: string;
  trigger: AutoReplyTrigger;
  message: string;
  enabled: boolean;
  channels?: string[];        // Empty = all channels
  cooldownMs: number;         // Min time between replies to same user
  maxPerHour?: number;        // Rate limit per user
  priority: number;           // Higher = checked first
  variables?: Record<string, string>; // Template variable defaults
}

export type AutoReplyTrigger =
  | { type: 'always' }                    // Fires on every message (e.g., away mode)
  | { type: 'keyword'; keywords: string[] } // Fires on keyword match
  | { type: 'regex'; pattern: string }      // Fires on regex match
  | { type: 'no_agent' }                   // Fires when no agent available
  | { type: 'after_hours'; schedule: WeeklySchedule }; // Fires outside business hours

export interface WeeklySchedule {
  timezone: string;
  hours: { start: number; end: number };    // 24h format, e.g., { start: 9, end: 17 }
  days: number[];                           // 0=Sun, 1=Mon, ... 6=Sat
}

export interface AutoReplyConfig {
  enabled: boolean;
  templates: AutoReplyTemplate[];
  globalCooldownMs: number;
  maxRepliesPerHour: number;
}

export interface AutoReplyResult {
  shouldReply: boolean;
  templateId?: string;
  message?: string;
  reason?: string;
}

// --- Internal tracking type ---

interface UserReplyState {
  time: number;
  count: number;
  hourStart: number;
}

// --- State ---

const DEFAULT_CONFIG: AutoReplyConfig = {
  enabled: false,
  templates: [],
  globalCooldownMs: 30_000,     // 30 seconds between replies to same user
  maxRepliesPerHour: 10,
};

let config: AutoReplyConfig = { ...DEFAULT_CONFIG };

// Track last reply time per user to enforce cooldowns
const lastReplyMap = new Map<string, UserReplyState>();

// --- Core Functions ---

/**
 * Load auto-reply configuration
 */
export function configureAutoReply(newConfig: Partial<AutoReplyConfig>): void {
  config = { ...config, ...newConfig };
  if (newConfig.templates) {
    // Sort by priority descending
    config.templates.sort((a, b) => b.priority - a.priority);
  }
  logger.info('[AutoReply] Configuration updated', {
    enabled: config.enabled,
    templates: config.templates.length,
  });
}

/**
 * Get current auto-reply configuration
 */
export function getAutoReplyConfig(): AutoReplyConfig {
  return { ...config };
}

/**
 * Check if a message should trigger an auto-reply
 */
export function checkAutoReply(
  message: string,
  userId: string,
  channelId?: string,
): AutoReplyResult {
  if (!config.enabled || config.templates.length === 0) {
    return { shouldReply: false, reason: 'disabled' };
  }

  // Check global cooldown
  const userState = lastReplyMap.get(userId);
  const now = Date.now();

  if (userState) {
    // Reset hourly counter if hour has passed
    if (now - userState.hourStart > 3_600_000) {
      userState.count = 0;
      userState.hourStart = now;
    }

    // Check cooldown
    if (now - userState.time < config.globalCooldownMs) {
      return { shouldReply: false, reason: 'cooldown' };
    }

    // Check rate limit
    if (userState.count >= config.maxRepliesPerHour) {
      return { shouldReply: false, reason: 'rate_limited' };
    }
  }

  // Find matching template (sorted by priority)
  for (const template of config.templates) {
    if (!template.enabled) continue;

    // Check channel filter
    if (template.channels && template.channels.length > 0 && channelId) {
      if (!template.channels.includes(channelId)) continue;
    }

    // Check per-template cooldown
    const templateKey = `${userId}:${template.id}`;
    const templateState = lastReplyMap.get(templateKey);
    if (templateState && now - templateState.time < template.cooldownMs) {
      continue;
    }

    // Check trigger
    if (matchesTrigger(template.trigger, message)) {
      // Update global user state
      const existing = lastReplyMap.get(userId);
      const updatedState: UserReplyState = existing
        ? { ...existing, time: now, count: existing.count + 1 }
        : { time: now, count: 1, hourStart: now };
      lastReplyMap.set(userId, updatedState);

      // Update per-template state
      lastReplyMap.set(templateKey, { time: now, count: 1, hourStart: now });

      // Render message with variables
      const rendered = renderTemplate(template.message, {
        ...template.variables,
        user: userId,
        channel: channelId ?? 'unknown',
        time: new Date().toLocaleTimeString(),
        date: new Date().toLocaleDateString(),
      });

      logger.debug('[AutoReply] Triggered', { templateId: template.id, userId, channelId });

      return {
        shouldReply: true,
        templateId: template.id,
        message: rendered,
      };
    }
  }

  return { shouldReply: false, reason: 'no_match' };
}

/**
 * Check if a trigger matches the message
 */
function matchesTrigger(trigger: AutoReplyTrigger, message: string): boolean {
  switch (trigger.type) {
    case 'always':
      return true;

    case 'keyword': {
      const lower = message.toLowerCase();
      return trigger.keywords.some(kw => lower.includes(kw.toLowerCase()));
    }

    case 'regex': {
      try {
        const re = new RegExp(trigger.pattern, 'i');
        return re.test(message);
      } catch {
        return false;
      }
    }

    case 'no_agent':
      // This is checked externally - always matches when the trigger is selected
      return true;

    case 'after_hours':
      return isAfterHours(trigger.schedule);

    default:
      return false;
  }
}

/**
 * Check if current time is outside business hours
 */
function isAfterHours(schedule: WeeklySchedule): boolean {
  try {
    const now = new Date();
    // Use Intl to get time in the specified timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: schedule.timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
      weekday: 'short',
    });

    const parts = formatter.formatToParts(now);
    const hour = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
    const weekday = parts.find(p => p.type === 'weekday')?.value ?? '';

    // Map weekday names to numbers
    const dayMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const dayNum = dayMap[weekday] ?? -1;

    // Check if today is a business day
    if (!schedule.days.includes(dayNum)) return true;

    // Check if current hour is outside business hours
    return hour < schedule.hours.start || hour >= schedule.hours.end;
  } catch {
    return false;
  }
}

/**
 * Render template variables: {{variable}} -> value
 */
function renderTemplate(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return vars[key] ?? `{{${key}}}`;
  });
}

/**
 * Add or replace a template by ID
 */
export function addTemplate(template: AutoReplyTemplate): void {
  // Remove existing with same ID
  config.templates = config.templates.filter(t => t.id !== template.id);
  config.templates.push(template);
  config.templates.sort((a, b) => b.priority - a.priority);
}

/**
 * Remove a template by ID
 */
export function removeTemplate(id: string): boolean {
  const before = config.templates.length;
  config.templates = config.templates.filter(t => t.id !== id);
  return config.templates.length < before;
}

/**
 * Get built-in template presets
 */
export function getTemplatePresets(): AutoReplyTemplate[] {
  return [
    {
      id: 'away',
      name: 'Away / Out of Office',
      trigger: { type: 'always' },
      message: "I'm currently away and will respond when I return. For urgent matters, please contact the team directly.",
      enabled: false,
      cooldownMs: 300_000, // 5 min
      maxPerHour: 5,
      priority: 100,
    },
    {
      id: 'after-hours',
      name: 'After Hours',
      trigger: {
        type: 'after_hours',
        schedule: {
          timezone: 'America/New_York',
          hours: { start: 9, end: 17 },
          days: [1, 2, 3, 4, 5], // Mon-Fri
        },
      },
      message: "Thanks for your message! I'm currently outside business hours (Mon-Fri 9AM-5PM ET). I'll respond during the next business day.",
      enabled: false,
      cooldownMs: 600_000, // 10 min
      maxPerHour: 3,
      priority: 90,
    },
    {
      id: 'help',
      name: 'Help / FAQ',
      trigger: { type: 'keyword', keywords: ['help', 'faq', 'how to', 'getting started'] },
      message: "Need help? Here are some commands:\n- `/help` - Show all commands\n- `/status` - System status\n- `/skills` - Available skills\n\nOr just ask me anything!",
      enabled: false,
      cooldownMs: 60_000,
      maxPerHour: 10,
      priority: 50,
    },
    {
      id: 'no-agent',
      name: 'No Agent Available',
      trigger: { type: 'no_agent' },
      message: "All agents are currently busy. Your message has been queued and will be processed shortly. Current wait time: approximately {{waitTime}}.",
      enabled: false,
      cooldownMs: 120_000,
      maxPerHour: 5,
      priority: 80,
      variables: { waitTime: '1-2 minutes' },
    },
  ];
}

/**
 * Cleanup stale tracking entries (call periodically)
 */
export function cleanupAutoReplyState(): void {
  const now = Date.now();
  const staleThreshold = 3_600_000; // 1 hour

  for (const [key, state] of lastReplyMap) {
    if (now - state.time > staleThreshold) {
      lastReplyMap.delete(key);
    }
  }
}

/**
 * Reset all state (for testing)
 */
export function resetAutoReply(): void {
  config = { ...DEFAULT_CONFIG };
  lastReplyMap.clear();
}
