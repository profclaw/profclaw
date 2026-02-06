/**
 * Tests for Plugin Loader
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPluginsDir } from '../loader.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Mock deployment capability check
vi.mock('../../core/deployment.js', () => ({
  hasCapability: vi.fn((cap: string) => cap === 'plugins'),
}));

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Plugin Loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPluginsDir()', () => {
    it('returns ~/.profclaw/plugins/', () => {
      const expected = join(homedir(), '.profclaw', 'plugins');
      expect(getPluginsDir()).toBe(expected);
    });
  });

  describe('loadPlugins()', () => {
    it('returns empty array when plugins capability is disabled', async () => {
      const { hasCapability } = await import('../../core/deployment.js');
      vi.mocked(hasCapability).mockReturnValue(false);

      const { loadPlugins } = await import('../loader.js');
      const plugins = await loadPlugins();
      expect(plugins).toEqual([]);
    });
  });
});
