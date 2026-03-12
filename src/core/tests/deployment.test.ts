/**
 * Tests for Deployment Mode System
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getMode,
  hasCapability,
  getCapabilities,
  getChannelLimit,
  getConcurrency,
  shouldUseRedis,
  getModeLabel,
  resetMode,
} from '../deployment.js';
import type { DeploymentMode, Capability } from '../deployment.js';

describe('Deployment Mode System', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetMode();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetMode();
  });

  describe('getMode()', () => {
    it('defaults to mini when PROFCLAW_MODE is not set', () => {
      delete process.env.PROFCLAW_MODE;
      expect(getMode()).toBe('mini');
    });

    it('returns pico when set', () => {
      process.env.PROFCLAW_MODE = 'pico';
      expect(getMode()).toBe('pico');
    });

    it('returns mini when set', () => {
      process.env.PROFCLAW_MODE = 'mini';
      expect(getMode()).toBe('mini');
    });

    it('returns pro when set', () => {
      process.env.PROFCLAW_MODE = 'pro';
      expect(getMode()).toBe('pro');
    });

    it('handles case insensitivity', () => {
      process.env.PROFCLAW_MODE = 'PRO';
      expect(getMode()).toBe('pro');
    });

    it('handles whitespace trimming', () => {
      process.env.PROFCLAW_MODE = '  mini  ';
      expect(getMode()).toBe('mini');
    });

    it('defaults to mini for invalid values', () => {
      process.env.PROFCLAW_MODE = 'invalid';
      expect(getMode()).toBe('mini');
    });

    it('caches the result', () => {
      process.env.PROFCLAW_MODE = 'pro';
      expect(getMode()).toBe('pro');

      // Change env after caching — should still return cached value
      process.env.PROFCLAW_MODE = 'pico';
      expect(getMode()).toBe('pro');
    });
  });

  describe('hasCapability()', () => {
    it('pico has agent, tools, chat_cli', () => {
      process.env.PROFCLAW_MODE = 'pico';
      expect(hasCapability('agent')).toBe(true);
      expect(hasCapability('tools')).toBe(true);
      expect(hasCapability('chat_cli')).toBe(true);
    });

    it('pico lacks web_ui, redis, plugins', () => {
      process.env.PROFCLAW_MODE = 'pico';
      expect(hasCapability('web_ui')).toBe(false);
      expect(hasCapability('redis')).toBe(false);
      expect(hasCapability('plugins')).toBe(false);
      expect(hasCapability('browser_tools')).toBe(false);
    });

    it('mini has web_ui, chat_channels, cron', () => {
      process.env.PROFCLAW_MODE = 'mini';
      expect(hasCapability('web_ui')).toBe(true);
      expect(hasCapability('chat_channels')).toBe(true);
      expect(hasCapability('cron')).toBe(true);
      expect(hasCapability('sandbox')).toBe(true);
    });

    it('mini lacks redis, plugins, browser_tools', () => {
      process.env.PROFCLAW_MODE = 'mini';
      expect(hasCapability('redis')).toBe(false);
      expect(hasCapability('plugins')).toBe(false);
      expect(hasCapability('browser_tools')).toBe(false);
      expect(hasCapability('sync_engine')).toBe(false);
    });

    it('pro has everything', () => {
      process.env.PROFCLAW_MODE = 'pro';
      const allCaps: Capability[] = [
        'agent', 'tools', 'chat_cli', 'chat_channels', 'web_ui',
        'redis', 'bullmq', 'cron', 'cron_full', 'integrations',
        'integrations_full', 'browser_tools', 'plugins', 'sandbox',
        'sandbox_full', 'sync_engine', 'webhook_queue', 'notifications',
      ];
      for (const cap of allCaps) {
        expect(hasCapability(cap)).toBe(true);
      }
    });
  });

  describe('getCapabilities()', () => {
    it('returns array of capabilities for pico', () => {
      process.env.PROFCLAW_MODE = 'pico';
      const caps = getCapabilities();
      expect(caps).toContain('agent');
      expect(caps).toContain('tools');
      expect(caps).toContain('chat_cli');
      expect(caps.length).toBe(3);
    });

    it('returns array of capabilities for mini', () => {
      process.env.PROFCLAW_MODE = 'mini';
      const caps = getCapabilities();
      expect(caps.length).toBeGreaterThan(3);
      expect(caps).toContain('web_ui');
    });
  });

  describe('getChannelLimit()', () => {
    it('pico allows 1 channel', () => {
      process.env.PROFCLAW_MODE = 'pico';
      expect(getChannelLimit()).toBe(1);
    });

    it('mini allows 3 channels', () => {
      process.env.PROFCLAW_MODE = 'mini';
      expect(getChannelLimit()).toBe(3);
    });

    it('pro allows unlimited channels', () => {
      process.env.PROFCLAW_MODE = 'pro';
      expect(getChannelLimit()).toBe(Infinity);
    });
  });

  describe('getConcurrency()', () => {
    it('pico allows 1 concurrent task', () => {
      process.env.PROFCLAW_MODE = 'pico';
      expect(getConcurrency()).toBe(1);
    });

    it('mini allows 3 concurrent tasks', () => {
      process.env.PROFCLAW_MODE = 'mini';
      expect(getConcurrency()).toBe(3);
    });

    it('pro uses POOL_MAX_CONCURRENT or 50', () => {
      process.env.PROFCLAW_MODE = 'pro';
      delete process.env.POOL_MAX_CONCURRENT;
      expect(getConcurrency()).toBe(50);
    });
  });

  describe('shouldUseRedis()', () => {
    it('returns false for pico without REDIS_URL', () => {
      process.env.PROFCLAW_MODE = 'pico';
      delete process.env.REDIS_URL;
      expect(shouldUseRedis()).toBe(false);
    });

    it('returns true when REDIS_URL is set regardless of mode', () => {
      process.env.PROFCLAW_MODE = 'pico';
      process.env.REDIS_URL = 'redis://localhost:6379';
      expect(shouldUseRedis()).toBe(true);
    });

    it('returns true for pro mode', () => {
      process.env.PROFCLAW_MODE = 'pro';
      delete process.env.REDIS_URL;
      expect(shouldUseRedis()).toBe(true);
    });
  });

  describe('getModeLabel()', () => {
    it('returns human-readable labels', () => {
      const modes: DeploymentMode[] = ['pico', 'mini', 'pro'];
      for (const mode of modes) {
        process.env.PROFCLAW_MODE = mode;
        resetMode();
        const label = getModeLabel();
        expect(label).toContain(mode.charAt(0).toUpperCase() + mode.slice(1));
      }
    });
  });

  describe('resetMode()', () => {
    it('clears the cache so getMode re-reads env', () => {
      process.env.PROFCLAW_MODE = 'pro';
      expect(getMode()).toBe('pro');

      process.env.PROFCLAW_MODE = 'pico';
      resetMode();
      expect(getMode()).toBe('pico');
    });
  });
});
