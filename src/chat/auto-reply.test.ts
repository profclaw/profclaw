import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  configureAutoReply,
  getAutoReplyConfig,
  checkAutoReply,
  addTemplate,
  removeTemplate,
  getTemplatePresets,
  cleanupAutoReplyState,
  resetAutoReply,
} from './auto-reply.js';
import type { AutoReplyTemplate } from './auto-reply.js';

// --- Helpers ---

function makeTemplate(overrides: Partial<AutoReplyTemplate> = {}): AutoReplyTemplate {
  return {
    id: 'test-template',
    name: 'Test Template',
    trigger: { type: 'always' },
    message: 'Hello from test',
    enabled: true,
    cooldownMs: 0,
    priority: 10,
    ...overrides,
  };
}

// --- Tests ---

describe('auto-reply', () => {
  beforeEach(() => {
    resetAutoReply();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // configureAutoReply
  // -------------------------------------------------------------------------

  describe('configureAutoReply', () => {
    it('merges partial config into existing config', () => {
      configureAutoReply({ enabled: true, globalCooldownMs: 5000 });
      const cfg = getAutoReplyConfig();
      expect(cfg.enabled).toBe(true);
      expect(cfg.globalCooldownMs).toBe(5000);
      // untouched defaults stay
      expect(cfg.maxRepliesPerHour).toBe(10);
    });

    it('sorts templates by priority descending when templates are provided', () => {
      const low = makeTemplate({ id: 'low', priority: 1 });
      const high = makeTemplate({ id: 'high', priority: 99 });
      const mid = makeTemplate({ id: 'mid', priority: 50 });
      configureAutoReply({ templates: [low, high, mid] });
      const { templates } = getAutoReplyConfig();
      expect(templates[0].id).toBe('high');
      expect(templates[1].id).toBe('mid');
      expect(templates[2].id).toBe('low');
    });

    it('does not re-sort when templates key is not provided', () => {
      configureAutoReply({
        templates: [
          makeTemplate({ id: 'a', priority: 5 }),
          makeTemplate({ id: 'b', priority: 50 }),
        ],
      });
      // Now update only enabled flag
      configureAutoReply({ enabled: true });
      const { templates } = getAutoReplyConfig();
      // Order already sorted from first configure call
      expect(templates[0].id).toBe('b');
      expect(templates[1].id).toBe('a');
    });

    it('replaces templates completely when provided', () => {
      configureAutoReply({ templates: [makeTemplate({ id: 'first' })] });
      configureAutoReply({ templates: [makeTemplate({ id: 'second' })] });
      const { templates } = getAutoReplyConfig();
      expect(templates).toHaveLength(1);
      expect(templates[0].id).toBe('second');
    });
  });

  // -------------------------------------------------------------------------
  // getAutoReplyConfig
  // -------------------------------------------------------------------------

  describe('getAutoReplyConfig', () => {
    it('returns default config after reset', () => {
      const cfg = getAutoReplyConfig();
      expect(cfg.enabled).toBe(false);
      expect(cfg.templates).toHaveLength(0);
      expect(cfg.globalCooldownMs).toBe(30_000);
      expect(cfg.maxRepliesPerHour).toBe(10);
    });

    it('returns a shallow copy - mutation does not affect internal state', () => {
      const cfg = getAutoReplyConfig();
      cfg.enabled = true;
      cfg.maxRepliesPerHour = 999;
      expect(getAutoReplyConfig().enabled).toBe(false);
      expect(getAutoReplyConfig().maxRepliesPerHour).toBe(10);
    });
  });

  // -------------------------------------------------------------------------
  // checkAutoReply - disabled / empty
  // -------------------------------------------------------------------------

  describe('checkAutoReply - disabled', () => {
    it('returns shouldReply:false with reason "disabled" when config is disabled', () => {
      configureAutoReply({
        enabled: false,
        templates: [makeTemplate()],
      });
      const result = checkAutoReply('hello', 'user1');
      expect(result.shouldReply).toBe(false);
      expect(result.reason).toBe('disabled');
    });

    it('returns shouldReply:false with reason "disabled" when enabled but no templates', () => {
      configureAutoReply({ enabled: true, templates: [] });
      const result = checkAutoReply('hello', 'user1');
      expect(result.shouldReply).toBe(false);
      expect(result.reason).toBe('disabled');
    });

    it('returns shouldReply:false when all templates are disabled', () => {
      configureAutoReply({
        enabled: true,
        templates: [makeTemplate({ enabled: false })],
      });
      const result = checkAutoReply('hello', 'user1');
      expect(result.shouldReply).toBe(false);
      expect(result.reason).toBe('no_match');
    });
  });

  // -------------------------------------------------------------------------
  // checkAutoReply - trigger: always
  // -------------------------------------------------------------------------

  describe('checkAutoReply - trigger: always', () => {
    it('matches any message with always trigger', () => {
      configureAutoReply({
        enabled: true,
        templates: [makeTemplate({ trigger: { type: 'always' }, message: 'pong' })],
      });
      const result = checkAutoReply('anything at all', 'user1');
      expect(result.shouldReply).toBe(true);
      expect(result.message).toBe('pong');
    });
  });

  // -------------------------------------------------------------------------
  // checkAutoReply - trigger: keyword
  // -------------------------------------------------------------------------

  describe('checkAutoReply - trigger: keyword', () => {
    const template = makeTemplate({
      trigger: { type: 'keyword', keywords: ['help', 'support'] },
      message: 'Keyword matched',
    });

    beforeEach(() => {
      configureAutoReply({ enabled: true, templates: [template] });
    });

    it('matches a keyword (case-insensitive, exact word in sentence)', () => {
      expect(checkAutoReply('I need HELP please', 'user1').shouldReply).toBe(true);
    });

    it('matches keyword in mixed case', () => {
      expect(checkAutoReply('SuPpOrT request', 'user1').shouldReply).toBe(true);
    });

    it('matches keyword as substring', () => {
      expect(checkAutoReply('unsupported feature', 'user1').shouldReply).toBe(true);
    });

    it('does not match when message contains none of the keywords', () => {
      const result = checkAutoReply('Just saying hi', 'user1');
      expect(result.shouldReply).toBe(false);
      expect(result.reason).toBe('no_match');
    });
  });

  // -------------------------------------------------------------------------
  // checkAutoReply - trigger: regex
  // -------------------------------------------------------------------------

  describe('checkAutoReply - trigger: regex', () => {
    it('matches message with regex pattern (case-insensitive flag applied)', () => {
      configureAutoReply({
        enabled: true,
        templates: [makeTemplate({ trigger: { type: 'regex', pattern: '^ticket-\\d+' } })],
      });
      expect(checkAutoReply('TICKET-123 opened', 'user1').shouldReply).toBe(true);
    });

    it('does not match message that fails regex', () => {
      configureAutoReply({
        enabled: true,
        templates: [makeTemplate({ trigger: { type: 'regex', pattern: '^ticket-\\d+' } })],
      });
      expect(checkAutoReply('random message', 'user1').shouldReply).toBe(false);
    });

    it('returns no match (not throws) for invalid regex pattern', () => {
      configureAutoReply({
        enabled: true,
        templates: [makeTemplate({ trigger: { type: 'regex', pattern: '[invalid(' } })],
      });
      const result = checkAutoReply('anything', 'user1');
      expect(result.shouldReply).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // checkAutoReply - trigger: no_agent
  // -------------------------------------------------------------------------

  describe('checkAutoReply - trigger: no_agent', () => {
    it('always matches when trigger type is no_agent', () => {
      configureAutoReply({
        enabled: true,
        templates: [makeTemplate({ trigger: { type: 'no_agent' } })],
      });
      expect(checkAutoReply('any message', 'user1').shouldReply).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // checkAutoReply - channel filtering
  // -------------------------------------------------------------------------

  describe('checkAutoReply - channel filtering', () => {
    it('matches when channelId is in the template channels list', () => {
      configureAutoReply({
        enabled: true,
        templates: [makeTemplate({ channels: ['chan-A', 'chan-B'] })],
      });
      expect(checkAutoReply('hello', 'user1', 'chan-A').shouldReply).toBe(true);
    });

    it('does not match when channelId is not in the template channels list', () => {
      configureAutoReply({
        enabled: true,
        templates: [makeTemplate({ channels: ['chan-A'] })],
      });
      const result = checkAutoReply('hello', 'user1', 'chan-Z');
      expect(result.shouldReply).toBe(false);
      expect(result.reason).toBe('no_match');
    });

    it('matches any channel when channels list is empty', () => {
      configureAutoReply({
        enabled: true,
        templates: [makeTemplate({ channels: [] })],
      });
      expect(checkAutoReply('hello', 'user1', 'any-channel').shouldReply).toBe(true);
    });

    it('matches any channel when channels property is absent', () => {
      const t = makeTemplate();
      delete (t as Partial<AutoReplyTemplate>).channels;
      configureAutoReply({ enabled: true, templates: [t] });
      expect(checkAutoReply('hello', 'user1', 'some-channel').shouldReply).toBe(true);
    });

    it('matches when no channelId is provided even if channels list is set', () => {
      // When channelId is undefined, the channel filter is skipped
      configureAutoReply({
        enabled: true,
        templates: [makeTemplate({ channels: ['chan-A'] })],
      });
      expect(checkAutoReply('hello', 'user1').shouldReply).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // checkAutoReply - global cooldown
  // -------------------------------------------------------------------------

  describe('checkAutoReply - global cooldown', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('returns shouldReply:false with reason "cooldown" within global cooldown window', () => {
      configureAutoReply({
        enabled: true,
        globalCooldownMs: 10_000,
        templates: [makeTemplate({ cooldownMs: 0 })],
      });

      const first = checkAutoReply('hello', 'user1');
      expect(first.shouldReply).toBe(true);

      // Advance less than cooldown
      vi.advanceTimersByTime(5_000);
      const second = checkAutoReply('hello', 'user1');
      expect(second.shouldReply).toBe(false);
      expect(second.reason).toBe('cooldown');
    });

    it('allows reply after global cooldown has elapsed', () => {
      configureAutoReply({
        enabled: true,
        globalCooldownMs: 10_000,
        templates: [makeTemplate({ cooldownMs: 0 })],
      });

      checkAutoReply('hello', 'user1');
      vi.advanceTimersByTime(10_001);

      const result = checkAutoReply('hello', 'user1');
      expect(result.shouldReply).toBe(true);
    });

    it('different users are not affected by each other cooldowns', () => {
      configureAutoReply({
        enabled: true,
        globalCooldownMs: 60_000,
        templates: [makeTemplate({ cooldownMs: 0 })],
      });

      checkAutoReply('hello', 'user1');
      const result = checkAutoReply('hello', 'user2');
      expect(result.shouldReply).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // checkAutoReply - per-template cooldown
  // -------------------------------------------------------------------------

  describe('checkAutoReply - per-template cooldown', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('skips template still in per-template cooldown and falls through to next', () => {
      const slow = makeTemplate({
        id: 'slow',
        priority: 20,
        cooldownMs: 60_000,
        message: 'slow reply',
      });
      const fast = makeTemplate({
        id: 'fast',
        priority: 10,
        cooldownMs: 0,
        message: 'fast reply',
      });

      configureAutoReply({
        enabled: true,
        globalCooldownMs: 0,
        templates: [slow, fast],
      });

      const first = checkAutoReply('hello', 'user1');
      expect(first.templateId).toBe('slow');

      // Second call within slow template cooldown - should use fast template
      const second = checkAutoReply('hello', 'user1');
      expect(second.shouldReply).toBe(true);
      expect(second.templateId).toBe('fast');
    });

    it('allows template after its cooldown has elapsed', () => {
      configureAutoReply({
        enabled: true,
        globalCooldownMs: 0,
        templates: [makeTemplate({ cooldownMs: 5_000 })],
      });

      checkAutoReply('hello', 'user1');
      vi.advanceTimersByTime(5_001);

      const result = checkAutoReply('hello', 'user1');
      expect(result.shouldReply).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // checkAutoReply - rate limiting
  // -------------------------------------------------------------------------

  describe('checkAutoReply - rate limiting', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('returns shouldReply:false with reason "rate_limited" when maxRepliesPerHour exceeded', () => {
      configureAutoReply({
        enabled: true,
        globalCooldownMs: 0,
        maxRepliesPerHour: 3,
        templates: [makeTemplate({ cooldownMs: 0 })],
      });

      checkAutoReply('m1', 'user1');
      checkAutoReply('m2', 'user1');
      checkAutoReply('m3', 'user1');

      const result = checkAutoReply('m4', 'user1');
      expect(result.shouldReply).toBe(false);
      expect(result.reason).toBe('rate_limited');
    });

    it('resets hourly counter after one hour has passed', () => {
      configureAutoReply({
        enabled: true,
        globalCooldownMs: 0,
        maxRepliesPerHour: 2,
        templates: [makeTemplate({ cooldownMs: 0 })],
      });

      checkAutoReply('m1', 'user1');
      checkAutoReply('m2', 'user1');

      // Exceeded limit
      expect(checkAutoReply('m3', 'user1').reason).toBe('rate_limited');

      // Advance past one hour
      vi.advanceTimersByTime(3_600_001);

      const result = checkAutoReply('m4', 'user1');
      expect(result.shouldReply).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // checkAutoReply - template variable rendering
  // -------------------------------------------------------------------------

  describe('checkAutoReply - template variable rendering', () => {
    it('renders {{user}} with userId', () => {
      configureAutoReply({
        enabled: true,
        templates: [makeTemplate({ message: 'Hello {{user}}!' })],
      });
      const result = checkAutoReply('hi', 'alice');
      expect(result.message).toBe('Hello alice!');
    });

    it('renders {{channel}} with channelId', () => {
      configureAutoReply({
        enabled: true,
        templates: [makeTemplate({ message: 'You are in {{channel}}' })],
      });
      const result = checkAutoReply('hi', 'user1', 'general');
      expect(result.message).toBe('You are in general');
    });

    it('renders {{channel}} as "unknown" when no channelId provided', () => {
      configureAutoReply({
        enabled: true,
        templates: [makeTemplate({ message: 'Channel: {{channel}}' })],
      });
      const result = checkAutoReply('hi', 'user1');
      expect(result.message).toBe('Channel: unknown');
    });

    it('renders {{time}} and {{date}} as non-empty strings', () => {
      configureAutoReply({
        enabled: true,
        templates: [makeTemplate({ message: 'At {{time}} on {{date}}' })],
      });
      const result = checkAutoReply('hi', 'user1');
      expect(result.message).not.toContain('{{time}}');
      expect(result.message).not.toContain('{{date}}');
      expect(result.message?.length).toBeGreaterThan(0);
    });

    it('renders custom variables defined on the template', () => {
      configureAutoReply({
        enabled: true,
        templates: [
          makeTemplate({
            message: 'Wait time: {{waitTime}}',
            variables: { waitTime: '5 minutes' },
          }),
        ],
      });
      const result = checkAutoReply('hi', 'user1');
      expect(result.message).toBe('Wait time: 5 minutes');
    });

    it('leaves unknown variables unreplaced using original placeholder', () => {
      configureAutoReply({
        enabled: true,
        templates: [makeTemplate({ message: 'Value: {{unknown}}' })],
      });
      const result = checkAutoReply('hi', 'user1');
      expect(result.message).toBe('Value: {{unknown}}');
    });
  });

  // -------------------------------------------------------------------------
  // checkAutoReply - priority ordering
  // -------------------------------------------------------------------------

  describe('checkAutoReply - priority ordering', () => {
    it('returns first match by priority descending', () => {
      configureAutoReply({
        enabled: true,
        templates: [
          makeTemplate({ id: 'low-prio', priority: 1, message: 'low' }),
          makeTemplate({ id: 'high-prio', priority: 100, message: 'high' }),
        ],
      });
      const result = checkAutoReply('hello', 'user1');
      expect(result.templateId).toBe('high-prio');
      expect(result.message).toBe('high');
    });
  });

  // -------------------------------------------------------------------------
  // addTemplate
  // -------------------------------------------------------------------------

  describe('addTemplate', () => {
    it('adds a new template to the config', () => {
      const t = makeTemplate({ id: 'new-one' });
      addTemplate(t);
      const { templates } = getAutoReplyConfig();
      expect(templates.some(tmpl => tmpl.id === 'new-one')).toBe(true);
    });

    it('replaces an existing template with the same ID', () => {
      addTemplate(makeTemplate({ id: 'dup', message: 'original' }));
      addTemplate(makeTemplate({ id: 'dup', message: 'replaced' }));
      const { templates } = getAutoReplyConfig();
      const matches = templates.filter(t => t.id === 'dup');
      expect(matches).toHaveLength(1);
      expect(matches[0].message).toBe('replaced');
    });

    it('re-sorts templates by priority descending after add', () => {
      addTemplate(makeTemplate({ id: 'a', priority: 10 }));
      addTemplate(makeTemplate({ id: 'b', priority: 50 }));
      addTemplate(makeTemplate({ id: 'c', priority: 30 }));
      const { templates } = getAutoReplyConfig();
      expect(templates[0].id).toBe('b');
      expect(templates[1].id).toBe('c');
      expect(templates[2].id).toBe('a');
    });
  });

  // -------------------------------------------------------------------------
  // removeTemplate
  // -------------------------------------------------------------------------

  describe('removeTemplate', () => {
    it('removes an existing template by ID and returns true', () => {
      addTemplate(makeTemplate({ id: 'removable' }));
      const result = removeTemplate('removable');
      expect(result).toBe(true);
      const { templates } = getAutoReplyConfig();
      expect(templates.some(t => t.id === 'removable')).toBe(false);
    });

    it('returns false when ID does not exist', () => {
      const result = removeTemplate('does-not-exist');
      expect(result).toBe(false);
    });

    it('only removes the template with the matching ID', () => {
      addTemplate(makeTemplate({ id: 'keep-1' }));
      addTemplate(makeTemplate({ id: 'remove-me' }));
      addTemplate(makeTemplate({ id: 'keep-2' }));
      removeTemplate('remove-me');
      const { templates } = getAutoReplyConfig();
      expect(templates).toHaveLength(2);
      expect(templates.map(t => t.id).sort()).toEqual(['keep-1', 'keep-2']);
    });
  });

  // -------------------------------------------------------------------------
  // getTemplatePresets
  // -------------------------------------------------------------------------

  describe('getTemplatePresets', () => {
    it('returns exactly 4 presets', () => {
      expect(getTemplatePresets()).toHaveLength(4);
    });

    it('includes the "away" preset with always trigger', () => {
      const away = getTemplatePresets().find(p => p.id === 'away');
      expect(away).toBeDefined();
      expect(away?.trigger.type).toBe('always');
    });

    it('includes the "after-hours" preset with after_hours trigger', () => {
      const ah = getTemplatePresets().find(p => p.id === 'after-hours');
      expect(ah).toBeDefined();
      expect(ah?.trigger.type).toBe('after_hours');
    });

    it('includes the "help" preset with keyword trigger', () => {
      const help = getTemplatePresets().find(p => p.id === 'help');
      expect(help).toBeDefined();
      expect(help?.trigger.type).toBe('keyword');
    });

    it('includes the "no-agent" preset with no_agent trigger', () => {
      const noAgent = getTemplatePresets().find(p => p.id === 'no-agent');
      expect(noAgent).toBeDefined();
      expect(noAgent?.trigger.type).toBe('no_agent');
    });

    it('all presets are disabled by default', () => {
      for (const preset of getTemplatePresets()) {
        expect(preset.enabled).toBe(false);
      }
    });

    it('returns a fresh array each call (mutations do not persist)', () => {
      const first = getTemplatePresets();
      first.push(makeTemplate({ id: 'injected' }));
      const second = getTemplatePresets();
      expect(second).toHaveLength(4);
    });

    it('no-agent preset has waitTime variable defined', () => {
      const noAgent = getTemplatePresets().find(p => p.id === 'no-agent');
      expect(noAgent?.variables?.waitTime).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // cleanupAutoReplyState
  // -------------------------------------------------------------------------

  describe('cleanupAutoReplyState', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('removes tracking entries older than 1 hour', () => {
      configureAutoReply({
        enabled: true,
        globalCooldownMs: 0,
        templates: [makeTemplate({ cooldownMs: 0 })],
      });

      // Trigger a reply so userState is stored
      checkAutoReply('hello', 'stale-user');

      // Advance more than 1 hour
      vi.advanceTimersByTime(3_600_001);
      cleanupAutoReplyState();

      // After cleanup, the user should not be in cooldown anymore
      // (state was cleared, so next check is a fresh slate)
      const result = checkAutoReply('hello', 'stale-user');
      expect(result.shouldReply).toBe(true);
    });

    it('keeps tracking entries newer than 1 hour', () => {
      // Use a cooldown longer than the time we will advance (30 minutes < 1 hour)
      // so the user remains blocked after cleanup runs
      configureAutoReply({
        enabled: true,
        globalCooldownMs: 3_600_000, // 1 hour cooldown
        templates: [makeTemplate({ cooldownMs: 0 })],
      });

      checkAutoReply('hello', 'fresh-user');

      // Advance 30 minutes - entry is newer than 1 hour so cleanup keeps it
      vi.advanceTimersByTime(1_800_000);
      cleanupAutoReplyState();

      // Global cooldown is 1 hour, only 30 min passed - should still be blocked
      const result = checkAutoReply('hello', 'fresh-user');
      expect(result.shouldReply).toBe(false);
      expect(result.reason).toBe('cooldown');
    });
  });

  // -------------------------------------------------------------------------
  // resetAutoReply
  // -------------------------------------------------------------------------

  describe('resetAutoReply', () => {
    it('resets enabled to false', () => {
      configureAutoReply({ enabled: true });
      resetAutoReply();
      expect(getAutoReplyConfig().enabled).toBe(false);
    });

    it('clears all templates', () => {
      configureAutoReply({ templates: [makeTemplate()] });
      resetAutoReply();
      expect(getAutoReplyConfig().templates).toHaveLength(0);
    });

    it('resets globalCooldownMs to default 30000', () => {
      configureAutoReply({ globalCooldownMs: 1 });
      resetAutoReply();
      expect(getAutoReplyConfig().globalCooldownMs).toBe(30_000);
    });

    it('clears reply state so previously rate-limited users are no longer blocked', () => {
      vi.useFakeTimers();
      configureAutoReply({
        enabled: true,
        globalCooldownMs: 0,
        maxRepliesPerHour: 1,
        templates: [makeTemplate({ cooldownMs: 0 })],
      });

      checkAutoReply('m1', 'user1');
      expect(checkAutoReply('m2', 'user1').reason).toBe('rate_limited');

      resetAutoReply();

      configureAutoReply({
        enabled: true,
        globalCooldownMs: 0,
        maxRepliesPerHour: 1,
        templates: [makeTemplate({ cooldownMs: 0 })],
      });

      expect(checkAutoReply('m3', 'user1').shouldReply).toBe(true);
    });
  });
});
