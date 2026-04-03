import { describe, it, expect } from 'vitest';
import {
  parseNaturalLanguage,
  isValidCron,
  cronToHuman,
} from '../natural-language.js';

describe('Natural Language Cron Parser', () => {
  describe('parseNaturalLanguage', () => {
    // Schedule parsing

    it('parses "every morning at 8am"', () => {
      const result = parseNaturalLanguage('every morning at 8am summarize GitHub');
      expect(result.success).toBe(true);
      expect(result.schedule?.cronExpression).toBe('0 8 * * *');
      expect(result.schedule?.humanReadable).toContain('8');
    });

    it('parses "every 30 minutes"', () => {
      const result = parseNaturalLanguage('every 30 minutes check server health');
      expect(result.success).toBe(true);
      expect(result.schedule?.cronExpression).toBe('*/30 * * * *');
    });

    it('parses "every hour"', () => {
      const result = parseNaturalLanguage('every hour check health');
      expect(result.success).toBe(true);
      expect(result.schedule?.cronExpression).toBe('0 * * * *');
    });

    it('parses "daily at 9am"', () => {
      const result = parseNaturalLanguage('daily at 9am send status report');
      expect(result.success).toBe(true);
      expect(result.schedule?.cronExpression).toBe('0 9 * * *');
    });

    it('parses "every weekday at 9am"', () => {
      const result = parseNaturalLanguage('every weekday at 9am send standup report');
      expect(result.success).toBe(true);
      expect(result.schedule?.cronExpression).toBe('0 9 * * 1-5');
    });

    it('parses "every friday at 5pm"', () => {
      const result = parseNaturalLanguage('every friday at 5pm send sprint report');
      expect(result.success).toBe(true);
      expect(result.schedule?.cronExpression).toBe('0 17 * * 5');
    });

    it('parses "twice a day"', () => {
      const result = parseNaturalLanguage('twice a day check health');
      expect(result.success).toBe(true);
      expect(result.schedule?.cronExpression).toBe('0 8,20 * * *');
    });

    it('parses "nightly"', () => {
      const result = parseNaturalLanguage('nightly clean up old logs');
      expect(result.success).toBe(true);
      expect(result.schedule?.cronExpression).toBe('0 23 * * *');
    });

    it('parses "in 30 minutes" as one-shot', () => {
      const result = parseNaturalLanguage('in 30 minutes check the deploy');
      expect(result.success).toBe(true);
      expect(result.schedule?.runAt).toBeInstanceOf(Date);
      expect(result.jobParams?.runAt).toBeInstanceOf(Date);
    });

    it('parses "at 3pm" (implicit daily)', () => {
      const result = parseNaturalLanguage('at 3pm send news digest to telegram');
      expect(result.success).toBe(true);
      expect(result.schedule?.cronExpression).toBe('0 15 * * *');
    });

    it('parses "every 2 hours"', () => {
      const result = parseNaturalLanguage('every 2 hours poll feeds');
      expect(result.success).toBe(true);
      expect(result.schedule?.cronExpression).toBe('0 */2 * * *');
    });

    // Intent parsing

    it('detects GitHub notification intent', () => {
      const result = parseNaturalLanguage('every morning at 8am summarize my GitHub notifications');
      expect(result.success).toBe(true);
      expect(result.intent?.action).toBe('github_summary');
    });

    it('detects feed digest intent', () => {
      const result = parseNaturalLanguage('daily at 7am pull RSS feeds and send digest');
      expect(result.success).toBe(true);
      expect(result.intent?.action).toBe('feed_digest');
    });

    it('detects health check intent', () => {
      const result = parseNaturalLanguage('every 5 minutes check server health');
      expect(result.success).toBe(true);
      expect(result.intent?.action).toBe('health_check');
    });

    it('detects daily report intent', () => {
      const result = parseNaturalLanguage('every weekday at 9am send status report');
      expect(result.success).toBe(true);
      expect(result.intent?.action).toBe('daily_report');
    });

    it('detects cleanup intent', () => {
      const result = parseNaturalLanguage('nightly at 2am clean up old logs');
      expect(result.success).toBe(true);
      expect(result.intent?.action).toBe('cleanup');
    });

    it('falls back to custom prompt for unknown intents', () => {
      const result = parseNaturalLanguage('every day at noon do something special');
      expect(result.success).toBe(true);
      expect(result.intent?.action).toBe('custom_prompt');
    });

    // Delivery parsing

    it('detects Slack delivery', () => {
      const result = parseNaturalLanguage('every morning at 8am send report to slack');
      expect(result.success).toBe(true);
      expect(result.delivery?.channel).toBe('slack');
    });

    it('detects Telegram delivery', () => {
      const result = parseNaturalLanguage('daily at 8am send digest to telegram');
      expect(result.success).toBe(true);
      expect(result.delivery?.channel).toBe('telegram');
    });

    it('detects Discord delivery', () => {
      const result = parseNaturalLanguage('every friday at 5pm send summary to discord');
      expect(result.success).toBe(true);
      expect(result.delivery?.channel).toBe('discord');
    });

    // Full end-to-end

    it('parses complete automation request', () => {
      const result = parseNaturalLanguage(
        'every weekday at 9am summarize my GitHub notifications and send to slack #dev-updates',
      );
      expect(result.success).toBe(true);
      expect(result.schedule?.cronExpression).toBe('0 9 * * 1-5');
      expect(result.intent?.action).toBe('github_summary');
      expect(result.delivery?.channel).toBe('slack');
      expect(result.delivery?.target).toBe('#dev-updates');
      expect(result.jobParams?.name).toContain('github');
      expect(result.jobParams?.delivery?.channels[0].type).toBe('slack');
    });

    // Error cases

    it('rejects too-short input', () => {
      const result = parseNaturalLanguage('hi');
      expect(result.success).toBe(false);
    });

    it('handles input with no recognizable pattern gracefully', () => {
      const result = parseNaturalLanguage('do something interesting sometime');
      // Should still succeed with fallback intent + default schedule
      expect(result.success).toBe(true);
      expect(result.intent?.action).toBe('custom_prompt');
    });

    // Job params generation

    it('generates valid CreateJobParams', () => {
      const result = parseNaturalLanguage('every morning at 8am summarize GitHub notifications');
      expect(result.jobParams).toBeDefined();
      expect(result.jobParams?.name).toBeTruthy();
      expect(result.jobParams?.cronExpression).toBe('0 8 * * *');
      expect(result.jobParams?.jobType).toBeTruthy();
      expect(result.jobParams?.payload).toBeDefined();
      expect(result.jobParams?.labels).toContain('natural-language');
    });

    it('sets timezone from system', () => {
      const result = parseNaturalLanguage('daily at 9am check health');
      expect(result.jobParams?.timezone).toBeTruthy();
    });
  });

  describe('isValidCron', () => {
    it('validates standard cron', () => {
      expect(isValidCron('0 8 * * *')).toBe(true);
      expect(isValidCron('*/5 * * * *')).toBe(true);
      expect(isValidCron('0 9 * * 1-5')).toBe(true);
      expect(isValidCron('0 8,20 * * *')).toBe(true);
    });

    it('rejects invalid cron', () => {
      expect(isValidCron('not a cron')).toBe(false);
      expect(isValidCron('* * *')).toBe(false);
      expect(isValidCron('60 25 * * *')).toBe(false);
    });
  });

  describe('cronToHuman', () => {
    it('converts common patterns', () => {
      expect(cronToHuman('0 8 * * *')).toContain('8');
      expect(cronToHuman('*/5 * * * *')).toContain('5 minutes');
      expect(cronToHuman('0 * * * *')).toBe('every hour');
      expect(cronToHuman('0 9 * * 1-5')).toContain('weekday');
    });
  });
});
