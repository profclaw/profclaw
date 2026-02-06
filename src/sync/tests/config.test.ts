/**
 * Tests for Sync Config
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock config-loader
vi.mock('../../utils/config-loader.js', () => ({
  loadConfig: vi.fn(() => ({})),
}));

import {
  loadSyncConfig,
  reloadSyncConfig,
  toSyncEngineConfig,
  isSyncEnabled,
  getEnabledPlatforms,
  getPlatformConfig,
  validatePlatformCredentials,
  getStatusMapping,
  type SyncConfig,
} from '../config.js';
import { loadConfig } from '../../utils/config-loader.js';

describe('Sync Config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Force cache clear by reloading
    vi.mocked(loadConfig).mockReturnValue({});
    reloadSyncConfig();
  });

  describe('loadSyncConfig', () => {
    it('returns default config when no settings', () => {
      vi.mocked(loadConfig).mockReturnValue({});
      const config = reloadSyncConfig();
      expect(config.enabled).toBe(false);
      expect(config.intervalMs).toBe(60000);
      expect(config.maxRetries).toBe(3);
      expect(config.conflictStrategy).toBe('latest_wins');
    });

    it('loads config from settings.yml', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: {
          enabled: true,
          intervalMs: 30000,
          conflictStrategy: 'local_wins',
          platforms: {
            linear: { enabled: true, apiKey: 'lin_key' },
          },
        },
      });

      const config = reloadSyncConfig();
      expect(config.enabled).toBe(true);
      expect(config.intervalMs).toBe(30000);
      expect(config.conflictStrategy).toBe('local_wins');
    });

    it('returns defaults on validation error', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: {
          intervalMs: -1, // Invalid
        },
      });

      const config = reloadSyncConfig();
      expect(config.enabled).toBe(false);
      expect(config.intervalMs).toBe(60000);
    });

    it('returns defaults on load error', () => {
      vi.mocked(loadConfig).mockImplementation(() => {
        throw new Error('File not found');
      });

      const config = reloadSyncConfig();
      expect(config.enabled).toBe(false);
    });

    it('caches config on second call', () => {
      vi.mocked(loadConfig).mockReturnValue({});
      reloadSyncConfig(); // clears cache + loads (1 call)
      vi.mocked(loadConfig).mockClear();
      loadSyncConfig(); // should use cache (0 calls)
      loadSyncConfig(); // should use cache (0 calls)
      expect(loadConfig).toHaveBeenCalledTimes(0);
    });
  });

  describe('getStatusMapping', () => {
    it('returns null when no mapping configured', () => {
      vi.mocked(loadConfig).mockReturnValue({});
      reloadSyncConfig();
      expect(getStatusMapping()).toBeNull();
    });

    it('returns mapping when configured', () => {
      vi.mocked(loadConfig).mockReturnValue({
        statusMapping: {
          linear: { 'In Progress': 'in_progress' },
        },
      });
      reloadSyncConfig();
      const mapping = getStatusMapping();
      expect(mapping).toBeDefined();
      expect(mapping?.linear?.['In Progress']).toBe('in_progress');
    });
  });

  describe('toSyncEngineConfig', () => {
    it('converts empty platforms', () => {
      const config: SyncConfig = {
        enabled: true,
        intervalMs: 30000,
        maxRetries: 3,
        retryDelayMs: 1000,
        enableWebhooks: true,
        conflictStrategy: 'latest_wins',
        platforms: {},
      };

      const result = toSyncEngineConfig(config);
      expect(result.conflictStrategy).toBe('latest_wins');
      expect(result.syncIntervalMs).toBe(30000);
      expect(result.maxRetries).toBe(3);
      expect(Object.keys(result.platforms)).toHaveLength(0);
    });

    it('converts Linear config', () => {
      const config: SyncConfig = {
        enabled: true,
        intervalMs: 60000,
        maxRetries: 3,
        retryDelayMs: 1000,
        enableWebhooks: true,
        conflictStrategy: 'latest_wins',
        platforms: {
          linear: { enabled: true, apiKey: 'lin_key', teamId: 'team-1', syncDirection: 'bidirectional' },
        },
      };

      const result = toSyncEngineConfig(config);
      expect(result.platforms.linear).toBeDefined();
      expect(result.platforms.linear?.apiKey).toBe('lin_key');
      expect(result.platforms.linear?.teamId).toBe('team-1');
    });

    it('converts GitHub config', () => {
      const config: SyncConfig = {
        enabled: true,
        intervalMs: 60000,
        maxRetries: 3,
        retryDelayMs: 1000,
        enableWebhooks: true,
        conflictStrategy: 'latest_wins',
        platforms: {
          github: { enabled: true, accessToken: 'ghp_xxx', owner: 'org', repo: 'repo', syncDirection: 'pull', syncLabels: [] },
        },
      };

      const result = toSyncEngineConfig(config);
      expect(result.platforms.github).toBeDefined();
      expect(result.platforms.github?.accessToken).toBe('ghp_xxx');
      expect(result.platforms.github?.owner).toBe('org');
      expect(result.platforms.github?.repo).toBe('repo');
    });

    it('skips disabled platforms', () => {
      const config: SyncConfig = {
        enabled: true,
        intervalMs: 60000,
        maxRetries: 3,
        retryDelayMs: 1000,
        enableWebhooks: true,
        conflictStrategy: 'latest_wins',
        platforms: {
          linear: { enabled: false, apiKey: 'key', syncDirection: 'bidirectional' },
        },
      };

      const result = toSyncEngineConfig(config);
      expect(result.platforms.linear).toBeUndefined();
    });

    it('skips platforms missing required credentials', () => {
      const config: SyncConfig = {
        enabled: true,
        intervalMs: 60000,
        maxRetries: 3,
        retryDelayMs: 1000,
        enableWebhooks: true,
        conflictStrategy: 'latest_wins',
        platforms: {
          github: { enabled: true, syncDirection: 'bidirectional', syncLabels: [] }, // missing token, owner, repo
        },
      };

      const result = toSyncEngineConfig(config);
      expect(result.platforms.github).toBeUndefined();
    });

    it('converts Jira config', () => {
      const config: SyncConfig = {
        enabled: true,
        intervalMs: 60000,
        maxRetries: 3,
        retryDelayMs: 1000,
        enableWebhooks: true,
        conflictStrategy: 'latest_wins',
        platforms: {
          jira: {
            enabled: true,
            baseUrl: 'https://company.atlassian.net',
            email: 'user@co.com',
            apiToken: 'jira_token',
            syncDirection: 'bidirectional',
          },
        },
      };

      const result = toSyncEngineConfig(config);
      expect(result.platforms.jira).toBeDefined();
      expect(result.platforms.jira?.baseUrl).toBe('https://company.atlassian.net');
    });

    it('converts Plane config', () => {
      const config: SyncConfig = {
        enabled: true,
        intervalMs: 60000,
        maxRetries: 3,
        retryDelayMs: 1000,
        enableWebhooks: true,
        conflictStrategy: 'latest_wins',
        platforms: {
          plane: {
            enabled: true,
            apiKey: 'plane_key',
            workspaceId: 'ws-1',
            projectId: 'proj-1',
            syncDirection: 'push',
          },
        },
      };

      const result = toSyncEngineConfig(config);
      expect(result.platforms.plane).toBeDefined();
      expect(result.platforms.plane?.apiKey).toBe('plane_key');
      expect(result.platforms.plane?.workspaceId).toBe('ws-1');
    });
  });

  describe('isSyncEnabled', () => {
    it('returns false when sync disabled globally', () => {
      vi.mocked(loadConfig).mockReturnValue({ sync: { enabled: false, platforms: { linear: { enabled: true } } } });
      reloadSyncConfig();
      expect(isSyncEnabled()).toBe(false);
    });

    it('returns false when no platforms enabled', () => {
      vi.mocked(loadConfig).mockReturnValue({ sync: { enabled: true, platforms: {} } });
      reloadSyncConfig();
      expect(isSyncEnabled()).toBe(false);
    });

    it('returns true when sync and a platform enabled', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: { enabled: true, platforms: { linear: { enabled: true, apiKey: 'k' } } },
      });
      reloadSyncConfig();
      expect(isSyncEnabled()).toBe(true);
    });
  });

  describe('getEnabledPlatforms', () => {
    it('returns empty array when none enabled', () => {
      vi.mocked(loadConfig).mockReturnValue({});
      reloadSyncConfig();
      expect(getEnabledPlatforms()).toEqual([]);
    });

    it('returns enabled platform names', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: {
          enabled: true,
          platforms: {
            linear: { enabled: true, apiKey: 'k' },
            github: { enabled: false },
          },
        },
      });
      reloadSyncConfig();
      const platforms = getEnabledPlatforms();
      expect(platforms).toContain('linear');
      expect(platforms).not.toContain('github');
    });
  });

  describe('getPlatformConfig', () => {
    it('returns null for disabled platform', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: { platforms: { linear: { enabled: false } } },
      });
      reloadSyncConfig();
      expect(getPlatformConfig('linear')).toBeNull();
    });

    it('returns null for unknown platform', () => {
      vi.mocked(loadConfig).mockReturnValue({});
      reloadSyncConfig();
      expect(getPlatformConfig('unknown')).toBeNull();
    });

    it('returns Linear config', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: { platforms: { linear: { enabled: true, apiKey: 'key', teamId: 'team' } } },
      });
      reloadSyncConfig();
      const config = getPlatformConfig('linear');
      expect(config?.apiKey).toBe('key');
      expect(config?.teamId).toBe('team');
    });

    it('returns GitHub config', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: { platforms: { github: { enabled: true, accessToken: 'tok', owner: 'org', repo: 'r' } } },
      });
      reloadSyncConfig();
      const config = getPlatformConfig('github');
      expect(config?.accessToken).toBe('tok');
    });

    it('returns Jira config', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: { platforms: { jira: { enabled: true, baseUrl: 'https://j.com', email: 'e@j.com', apiToken: 'tok' } } },
      });
      reloadSyncConfig();
      const config = getPlatformConfig('jira');
      expect(config?.baseUrl).toBe('https://j.com');
    });

    it('returns Plane config', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: { platforms: { plane: { enabled: true, apiKey: 'pk', workspaceId: 'w1' } } },
      });
      reloadSyncConfig();
      const config = getPlatformConfig('plane');
      expect(config?.apiKey).toBe('pk');
    });
  });

  describe('validatePlatformCredentials', () => {
    it('returns invalid for missing platform', () => {
      vi.mocked(loadConfig).mockReturnValue({});
      reloadSyncConfig();
      const result = validatePlatformCredentials('linear');
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('platform configuration');
    });

    it('validates Linear credentials', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: { platforms: { linear: { enabled: true } } },
      });
      reloadSyncConfig();
      const result = validatePlatformCredentials('linear');
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('LINEAR_API_KEY');
    });

    it('validates GitHub credentials', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: { platforms: { github: { enabled: true } } },
      });
      reloadSyncConfig();
      const result = validatePlatformCredentials('github');
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('GITHUB_TOKEN');
      expect(result.missing).toContain('GITHUB_OWNER');
      expect(result.missing).toContain('GITHUB_REPO');
    });

    it('validates Jira credentials', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: { platforms: { jira: { enabled: true } } },
      });
      reloadSyncConfig();
      const result = validatePlatformCredentials('jira');
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('JIRA_BASE_URL');
      expect(result.missing).toContain('JIRA_EMAIL');
      expect(result.missing).toContain('JIRA_API_TOKEN');
    });

    it('validates Plane credentials', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: { platforms: { plane: { enabled: true } } },
      });
      reloadSyncConfig();
      const result = validatePlatformCredentials('plane');
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('PLANE_API_KEY');
      expect(result.missing).toContain('PLANE_WORKSPACE_ID');
    });

    it('returns valid when all credentials present', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: { platforms: { linear: { enabled: true, apiKey: 'key123' } } },
      });
      reloadSyncConfig();
      const result = validatePlatformCredentials('linear');
      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });
  });
});
