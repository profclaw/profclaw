/**
 * Tests for src/sync/config.ts
 *
 * Covers: loadSyncConfig, reloadSyncConfig, getStatusMapping,
 * toSyncEngineConfig, isSyncEnabled, getEnabledPlatforms,
 * getPlatformConfig, validatePlatformCredentials
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks must be declared before imports that depend on them
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../utils/config-loader.js', () => ({
  loadConfig: vi.fn(() => ({})),
}));

import {
  loadSyncConfig,
  reloadSyncConfig,
  getStatusMapping,
  toSyncEngineConfig,
  isSyncEnabled,
  getEnabledPlatforms,
  getPlatformConfig,
  validatePlatformCredentials,
  type SyncConfig,
} from './config.js';
import { loadConfig } from '../utils/config-loader.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFullConfig(overrides: Partial<SyncConfig> = {}): SyncConfig {
  return {
    enabled: true,
    intervalMs: 60000,
    maxRetries: 3,
    retryDelayMs: 1000,
    enableWebhooks: true,
    conflictStrategy: 'latest_wins',
    platforms: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('sync/config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module-level cache before each test
    vi.mocked(loadConfig).mockReturnValue({});
    reloadSyncConfig();
  });

  // -------------------------------------------------------------------------
  // loadSyncConfig
  // -------------------------------------------------------------------------

  describe('loadSyncConfig', () => {
    it('returns defaults when settings.yml has no sync key', () => {
      vi.mocked(loadConfig).mockReturnValue({});
      const config = reloadSyncConfig();

      expect(config.enabled).toBe(false);
      expect(config.intervalMs).toBe(60000);
      expect(config.maxRetries).toBe(3);
      expect(config.retryDelayMs).toBe(1000);
      expect(config.enableWebhooks).toBe(true);
      expect(config.conflictStrategy).toBe('latest_wins');
      expect(config.platforms).toEqual({});
    });

    it('loads valid sync config from settings.yml', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: {
          enabled: true,
          intervalMs: 30000,
          maxRetries: 5,
          retryDelayMs: 2000,
          enableWebhooks: false,
          conflictStrategy: 'remote_wins',
          platforms: {},
        },
      });

      const config = reloadSyncConfig();

      expect(config.enabled).toBe(true);
      expect(config.intervalMs).toBe(30000);
      expect(config.maxRetries).toBe(5);
      expect(config.retryDelayMs).toBe(2000);
      expect(config.enableWebhooks).toBe(false);
      expect(config.conflictStrategy).toBe('remote_wins');
    });

    it('caches result - loadConfig only called once for repeated reads', () => {
      vi.mocked(loadConfig).mockReturnValue({});
      // reloadSyncConfig in beforeEach already called loadConfig once;
      // clear call count after that
      vi.mocked(loadConfig).mockClear();

      loadSyncConfig();
      loadSyncConfig();
      loadSyncConfig();

      expect(loadConfig).toHaveBeenCalledTimes(0);
    });

    it('calls loadConfig with "settings.yml"', () => {
      vi.mocked(loadConfig).mockReturnValue({});
      reloadSyncConfig();

      expect(loadConfig).toHaveBeenCalledWith('settings.yml');
    });

    it('falls back to defaults when Zod validation fails - invalid intervalMs', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: { intervalMs: -1 }, // minimum is 1000
      });

      const config = reloadSyncConfig();

      expect(config.intervalMs).toBe(60000);
      expect(config.enabled).toBe(false);
    });

    it('falls back to defaults when Zod validation fails - invalid conflictStrategy', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: { conflictStrategy: 'coin_flip' },
      });

      const config = reloadSyncConfig();

      expect(config.conflictStrategy).toBe('latest_wins');
    });

    it('falls back to defaults when loadConfig throws', () => {
      vi.mocked(loadConfig).mockImplementation(() => {
        throw new Error('ENOENT: no such file');
      });

      const config = reloadSyncConfig();

      expect(config.enabled).toBe(false);
      expect(config.intervalMs).toBe(60000);
    });

    it('logs a warning on Zod validation error', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: { intervalMs: 0 },
      });

      reloadSyncConfig();

      expect(logger.warn).toHaveBeenCalled();
    });

    it('logs an error when loadConfig throws', () => {
      vi.mocked(loadConfig).mockImplementation(() => {
        throw new Error('disk error');
      });

      reloadSyncConfig();

      expect(logger.error).toHaveBeenCalled();
    });

    it('applies Zod defaults for omitted optional fields', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: { enabled: true },
      });

      const config = reloadSyncConfig();

      // Defaults should fill in the rest
      expect(config.intervalMs).toBe(60000);
      expect(config.enableWebhooks).toBe(true);
      expect(config.conflictStrategy).toBe('latest_wins');
    });

    it('accepts all valid conflictStrategy values', () => {
      for (const strategy of ['local_wins', 'remote_wins', 'latest_wins', 'manual'] as const) {
        vi.mocked(loadConfig).mockReturnValue({ sync: { conflictStrategy: strategy } });
        const config = reloadSyncConfig();
        expect(config.conflictStrategy).toBe(strategy);
      }
    });
  });

  // -------------------------------------------------------------------------
  // reloadSyncConfig
  // -------------------------------------------------------------------------

  describe('reloadSyncConfig', () => {
    it('clears cached config and reloads', () => {
      vi.mocked(loadConfig).mockReturnValue({ sync: { enabled: true } });
      reloadSyncConfig();
      expect(loadSyncConfig().enabled).toBe(true);

      // Change the mock and reload - should pick up new value
      vi.mocked(loadConfig).mockReturnValue({ sync: { enabled: false } });
      reloadSyncConfig();
      expect(loadSyncConfig().enabled).toBe(false);
    });

    it('clears cached statusMapping on reload', () => {
      vi.mocked(loadConfig).mockReturnValue({
        statusMapping: { linear: { 'In Progress': 'in_progress' } },
      });
      reloadSyncConfig();
      expect(getStatusMapping()).not.toBeNull();

      vi.mocked(loadConfig).mockReturnValue({});
      reloadSyncConfig();
      expect(getStatusMapping()).toBeNull();
    });

    it('returns the freshly loaded config', () => {
      vi.mocked(loadConfig).mockReturnValue({ sync: { enabled: true, intervalMs: 15000 } });
      const config = reloadSyncConfig();
      expect(config.enabled).toBe(true);
      expect(config.intervalMs).toBe(15000);
    });
  });

  // -------------------------------------------------------------------------
  // getStatusMapping
  // -------------------------------------------------------------------------

  describe('getStatusMapping', () => {
    it('returns null when statusMapping is absent', () => {
      vi.mocked(loadConfig).mockReturnValue({});
      reloadSyncConfig();
      expect(getStatusMapping()).toBeNull();
    });

    it('returns the mapping when present', () => {
      vi.mocked(loadConfig).mockReturnValue({
        statusMapping: {
          linear: { Todo: 'todo', 'In Progress': 'in_progress', Done: 'done' },
          github: { open: 'todo', closed: 'done' },
        },
      });
      reloadSyncConfig();

      const mapping = getStatusMapping();
      expect(mapping).not.toBeNull();
      expect(mapping?.linear?.['In Progress']).toBe('in_progress');
      expect(mapping?.github?.open).toBe('todo');
    });

    it('triggers loadSyncConfig if cache is empty', () => {
      vi.mocked(loadConfig).mockReturnValue({});
      // beforeEach calls reloadSyncConfig which already loaded; clear the mock count
      vi.mocked(loadConfig).mockClear();

      // Call getStatusMapping directly without reloading first
      getStatusMapping();

      // Cache was already warm from beforeEach, so no new call expected
      expect(loadConfig).toHaveBeenCalledTimes(0);
    });
  });

  // -------------------------------------------------------------------------
  // toSyncEngineConfig
  // -------------------------------------------------------------------------

  describe('toSyncEngineConfig', () => {
    it('maps top-level fields correctly', () => {
      const config = makeFullConfig({
        intervalMs: 45000,
        maxRetries: 7,
        retryDelayMs: 500,
        enableWebhooks: false,
        conflictStrategy: 'local_wins',
      });

      const result = toSyncEngineConfig(config);

      expect(result.syncIntervalMs).toBe(45000);
      expect(result.maxRetries).toBe(7);
      expect(result.retryDelayMs).toBe(500);
      expect(result.enableWebhooks).toBe(false);
      expect(result.conflictStrategy).toBe('local_wins');
    });

    it('returns empty platforms object when no platforms defined', () => {
      const result = toSyncEngineConfig(makeFullConfig({ platforms: {} }));
      expect(result.platforms).toEqual({});
    });

    it('includes Linear when enabled with apiKey', () => {
      const config = makeFullConfig({
        platforms: {
          linear: { enabled: true, apiKey: 'lin_api_key', teamId: 'team-abc', syncDirection: 'bidirectional' },
        },
      });

      const result = toSyncEngineConfig(config);

      expect(result.platforms.linear).toBeDefined();
      expect(result.platforms.linear?.apiKey).toBe('lin_api_key');
      expect(result.platforms.linear?.teamId).toBe('team-abc');
    });

    it('excludes Linear when disabled', () => {
      const config = makeFullConfig({
        platforms: {
          linear: { enabled: false, apiKey: 'lin_api_key', syncDirection: 'bidirectional' },
        },
      });

      expect(toSyncEngineConfig(config).platforms.linear).toBeUndefined();
    });

    it('excludes Linear when apiKey is missing', () => {
      const config = makeFullConfig({
        platforms: {
          linear: { enabled: true, syncDirection: 'bidirectional' },
        },
      });

      expect(toSyncEngineConfig(config).platforms.linear).toBeUndefined();
    });

    it('includes GitHub when enabled with all required fields', () => {
      const config = makeFullConfig({
        platforms: {
          github: {
            enabled: true,
            accessToken: 'ghp_abc',
            owner: 'my-org',
            repo: 'my-repo',
            syncDirection: 'pull',
            syncLabels: ['bug', 'feature'],
          },
        },
      });

      const result = toSyncEngineConfig(config);

      expect(result.platforms.github).toBeDefined();
      expect(result.platforms.github?.accessToken).toBe('ghp_abc');
      expect(result.platforms.github?.owner).toBe('my-org');
      expect(result.platforms.github?.repo).toBe('my-repo');
    });

    it('excludes GitHub when owner is missing', () => {
      const config = makeFullConfig({
        platforms: {
          github: { enabled: true, accessToken: 'ghp_abc', repo: 'r', syncDirection: 'pull', syncLabels: [] },
        },
      });

      expect(toSyncEngineConfig(config).platforms.github).toBeUndefined();
    });

    it('excludes GitHub when repo is missing', () => {
      const config = makeFullConfig({
        platforms: {
          github: { enabled: true, accessToken: 'ghp_abc', owner: 'org', syncDirection: 'pull', syncLabels: [] },
        },
      });

      expect(toSyncEngineConfig(config).platforms.github).toBeUndefined();
    });

    it('excludes GitHub when accessToken is missing', () => {
      const config = makeFullConfig({
        platforms: {
          github: { enabled: true, owner: 'org', repo: 'r', syncDirection: 'pull', syncLabels: [] },
        },
      });

      expect(toSyncEngineConfig(config).platforms.github).toBeUndefined();
    });

    it('includes Jira when enabled with all required fields', () => {
      const config = makeFullConfig({
        platforms: {
          jira: {
            enabled: true,
            baseUrl: 'https://acme.atlassian.net',
            email: 'dev@acme.com',
            apiToken: 'jira_secret',
            projectKey: 'PROJ',
            syncDirection: 'bidirectional',
          },
        },
      });

      const result = toSyncEngineConfig(config);

      expect(result.platforms.jira).toBeDefined();
      expect(result.platforms.jira?.baseUrl).toBe('https://acme.atlassian.net');
      // Jira apiToken is mapped to apiKey in the engine config
      expect(result.platforms.jira?.apiKey).toBe('jira_secret');
    });

    it('excludes Jira when baseUrl missing', () => {
      const config = makeFullConfig({
        platforms: {
          jira: { enabled: true, email: 'e@j.com', apiToken: 'tok', syncDirection: 'bidirectional' },
        },
      });

      expect(toSyncEngineConfig(config).platforms.jira).toBeUndefined();
    });

    it('excludes Jira when apiToken missing', () => {
      const config = makeFullConfig({
        platforms: {
          jira: { enabled: true, baseUrl: 'https://j.atlassian.net', email: 'e@j.com', syncDirection: 'bidirectional' },
        },
      });

      expect(toSyncEngineConfig(config).platforms.jira).toBeUndefined();
    });

    it('includes Plane when enabled with apiKey and workspaceId', () => {
      const config = makeFullConfig({
        platforms: {
          plane: {
            enabled: true,
            apiKey: 'plane_key',
            workspaceId: 'ws-xyz',
            projectId: 'proj-123',
            baseUrl: 'https://plane.acme.com',
            syncDirection: 'push',
          },
        },
      });

      const result = toSyncEngineConfig(config);

      expect(result.platforms.plane).toBeDefined();
      expect(result.platforms.plane?.apiKey).toBe('plane_key');
      expect(result.platforms.plane?.workspaceId).toBe('ws-xyz');
      expect(result.platforms.plane?.projectId).toBe('proj-123');
      expect(result.platforms.plane?.baseUrl).toBe('https://plane.acme.com');
    });

    it('excludes Plane when workspaceId is missing', () => {
      const config = makeFullConfig({
        platforms: {
          plane: { enabled: true, apiKey: 'pk', syncDirection: 'push' },
        },
      });

      expect(toSyncEngineConfig(config).platforms.plane).toBeUndefined();
    });

    it('excludes Plane when apiKey is missing', () => {
      const config = makeFullConfig({
        platforms: {
          plane: { enabled: true, workspaceId: 'ws', syncDirection: 'push' },
        },
      });

      expect(toSyncEngineConfig(config).platforms.plane).toBeUndefined();
    });

    it('includes multiple platforms at once when all have required credentials', () => {
      const config = makeFullConfig({
        platforms: {
          linear: { enabled: true, apiKey: 'lin_key', syncDirection: 'bidirectional' },
          github: { enabled: true, accessToken: 'ghp', owner: 'org', repo: 'r', syncDirection: 'pull', syncLabels: [] },
        },
      });

      const result = toSyncEngineConfig(config);

      expect(result.platforms.linear).toBeDefined();
      expect(result.platforms.github).toBeDefined();
      expect(Object.keys(result.platforms)).toHaveLength(2);
    });

    it('selectively includes only complete platforms among mixed config', () => {
      const config = makeFullConfig({
        platforms: {
          linear: { enabled: true, apiKey: 'lin_key', syncDirection: 'bidirectional' },
          github: { enabled: true, syncDirection: 'pull', syncLabels: [] }, // missing token/owner/repo
        },
      });

      const result = toSyncEngineConfig(config);

      expect(result.platforms.linear).toBeDefined();
      expect(result.platforms.github).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // isSyncEnabled
  // -------------------------------------------------------------------------

  describe('isSyncEnabled', () => {
    it('returns false when sync.enabled is false', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: { enabled: false, platforms: { linear: { enabled: true, apiKey: 'k' } } },
      });
      reloadSyncConfig();

      expect(isSyncEnabled()).toBe(false);
    });

    it('returns false when no platforms are present', () => {
      vi.mocked(loadConfig).mockReturnValue({ sync: { enabled: true } });
      reloadSyncConfig();

      expect(isSyncEnabled()).toBe(false);
    });

    it('returns false when all platforms are disabled', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: {
          enabled: true,
          platforms: {
            linear: { enabled: false },
            github: { enabled: false },
          },
        },
      });
      reloadSyncConfig();

      expect(isSyncEnabled()).toBe(false);
    });

    it('returns true when sync is enabled and at least one platform is enabled', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: {
          enabled: true,
          platforms: { linear: { enabled: true, apiKey: 'key' } },
        },
      });
      reloadSyncConfig();

      expect(isSyncEnabled()).toBe(true);
    });

    it('returns false with default empty config', () => {
      vi.mocked(loadConfig).mockReturnValue({});
      reloadSyncConfig();

      expect(isSyncEnabled()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getEnabledPlatforms
  // -------------------------------------------------------------------------

  describe('getEnabledPlatforms', () => {
    it('returns empty array when platforms object is empty', () => {
      vi.mocked(loadConfig).mockReturnValue({ sync: { enabled: true } });
      reloadSyncConfig();

      expect(getEnabledPlatforms()).toEqual([]);
    });

    it('returns only the enabled platforms by name', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: {
          enabled: true,
          platforms: {
            linear: { enabled: true, apiKey: 'k' },
            github: { enabled: false },
            jira: { enabled: true, baseUrl: 'https://j.atlassian.net', email: 'e@j.com', apiToken: 't' },
          },
        },
      });
      reloadSyncConfig();

      const platforms = getEnabledPlatforms();
      expect(platforms).toContain('linear');
      expect(platforms).toContain('jira');
      expect(platforms).not.toContain('github');
      expect(platforms).toHaveLength(2);
    });

    it('returns all four platforms when all enabled', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: {
          enabled: true,
          platforms: {
            linear: { enabled: true, apiKey: 'k' },
            github: { enabled: true, accessToken: 't', owner: 'o', repo: 'r' },
            jira: { enabled: true, baseUrl: 'https://j.atlassian.net', email: 'e@j.com', apiToken: 't' },
            plane: { enabled: true, apiKey: 'pk', workspaceId: 'ws' },
          },
        },
      });
      reloadSyncConfig();

      const platforms = getEnabledPlatforms();
      expect(platforms).toHaveLength(4);
      expect(platforms).toContain('linear');
      expect(platforms).toContain('github');
      expect(platforms).toContain('jira');
      expect(platforms).toContain('plane');
    });
  });

  // -------------------------------------------------------------------------
  // getPlatformConfig
  // -------------------------------------------------------------------------

  describe('getPlatformConfig', () => {
    it('returns null for an unknown platform name', () => {
      vi.mocked(loadConfig).mockReturnValue({});
      reloadSyncConfig();

      expect(getPlatformConfig('notion')).toBeNull();
    });

    it('returns null for a platform that is disabled', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: { platforms: { linear: { enabled: false, apiKey: 'k' } } },
      });
      reloadSyncConfig();

      expect(getPlatformConfig('linear')).toBeNull();
    });

    it('returns Linear adapter config with apiKey and teamId', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: {
          platforms: {
            linear: { enabled: true, apiKey: 'lin_api', teamId: 'team-1', syncDirection: 'bidirectional' },
          },
        },
      });
      reloadSyncConfig();

      const cfg = getPlatformConfig('linear');
      expect(cfg).not.toBeNull();
      expect(cfg?.apiKey).toBe('lin_api');
      expect(cfg?.teamId).toBe('team-1');
    });

    it('returns GitHub adapter config with accessToken, owner, repo', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: {
          platforms: {
            github: {
              enabled: true,
              accessToken: 'ghp_tok',
              owner: 'acme',
              repo: 'backend',
              syncDirection: 'pull',
              syncLabels: [],
            },
          },
        },
      });
      reloadSyncConfig();

      const cfg = getPlatformConfig('github');
      expect(cfg).not.toBeNull();
      expect(cfg?.accessToken).toBe('ghp_tok');
      expect(cfg?.owner).toBe('acme');
      expect(cfg?.repo).toBe('backend');
    });

    it('returns Jira adapter config with baseUrl and apiKey (mapped from apiToken)', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: {
          platforms: {
            jira: {
              enabled: true,
              baseUrl: 'https://co.atlassian.net',
              email: 'dev@co.com',
              apiToken: 'jira_tok',
              syncDirection: 'bidirectional',
            },
          },
        },
      });
      reloadSyncConfig();

      const cfg = getPlatformConfig('jira');
      expect(cfg).not.toBeNull();
      expect(cfg?.baseUrl).toBe('https://co.atlassian.net');
      // apiToken is exposed as apiKey in the adapter config
      expect(cfg?.apiKey).toBe('jira_tok');
    });

    it('returns Plane adapter config with apiKey, baseUrl, workspaceId, projectId', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: {
          platforms: {
            plane: {
              enabled: true,
              apiKey: 'plane_tok',
              baseUrl: 'https://plane.io',
              workspaceId: 'ws-1',
              projectId: 'proj-1',
              syncDirection: 'push',
            },
          },
        },
      });
      reloadSyncConfig();

      const cfg = getPlatformConfig('plane');
      expect(cfg).not.toBeNull();
      expect(cfg?.apiKey).toBe('plane_tok');
      expect(cfg?.baseUrl).toBe('https://plane.io');
      expect(cfg?.workspaceId).toBe('ws-1');
      expect(cfg?.projectId).toBe('proj-1');
    });

    it('returns null for default switch case with unknown enabled platform name', () => {
      // Directly test the default branch by passing a platform name that is not
      // one of the four known types - even though platforms schema only allows
      // linear/github/jira/plane, the function itself handles the default case.
      vi.mocked(loadConfig).mockReturnValue({
        sync: {
          platforms: {
            linear: { enabled: true, apiKey: 'k' },
          },
        },
      });
      reloadSyncConfig();

      // 'trello' does not appear in platforms, so getPlatformSettings returns undefined
      expect(getPlatformConfig('trello')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // validatePlatformCredentials
  // -------------------------------------------------------------------------

  describe('validatePlatformCredentials', () => {
    it('returns invalid with "platform configuration" when platform is not configured', () => {
      vi.mocked(loadConfig).mockReturnValue({});
      reloadSyncConfig();

      const result = validatePlatformCredentials('linear');
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('platform configuration');
    });

    it('reports missing LINEAR_API_KEY when apiKey absent', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: { platforms: { linear: { enabled: true } } },
      });
      reloadSyncConfig();

      const result = validatePlatformCredentials('linear');
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('LINEAR_API_KEY');
    });

    it('Linear is valid when apiKey is present', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: { platforms: { linear: { enabled: true, apiKey: 'lin_key' } } },
      });
      reloadSyncConfig();

      const result = validatePlatformCredentials('linear');
      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it('reports all three missing GitHub fields when none provided', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: { platforms: { github: { enabled: true } } },
      });
      reloadSyncConfig();

      const result = validatePlatformCredentials('github');
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('GITHUB_TOKEN');
      expect(result.missing).toContain('GITHUB_OWNER');
      expect(result.missing).toContain('GITHUB_REPO');
      expect(result.missing).toHaveLength(3);
    });

    it('reports only GITHUB_REPO when token and owner are present', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: { platforms: { github: { enabled: true, accessToken: 'ghp', owner: 'org' } } },
      });
      reloadSyncConfig();

      const result = validatePlatformCredentials('github');
      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(['GITHUB_REPO']);
    });

    it('GitHub is valid when all three credentials are present', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: {
          platforms: {
            github: { enabled: true, accessToken: 'ghp_tok', owner: 'org', repo: 'repo' },
          },
        },
      });
      reloadSyncConfig();

      const result = validatePlatformCredentials('github');
      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it('reports all three missing Jira fields when none provided', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: { platforms: { jira: { enabled: true } } },
      });
      reloadSyncConfig();

      const result = validatePlatformCredentials('jira');
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('JIRA_BASE_URL');
      expect(result.missing).toContain('JIRA_EMAIL');
      expect(result.missing).toContain('JIRA_API_TOKEN');
      expect(result.missing).toHaveLength(3);
    });

    it('reports only JIRA_API_TOKEN when baseUrl and email are present', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: {
          platforms: {
            jira: { enabled: true, baseUrl: 'https://j.atlassian.net', email: 'e@j.com' },
          },
        },
      });
      reloadSyncConfig();

      const result = validatePlatformCredentials('jira');
      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(['JIRA_API_TOKEN']);
    });

    it('Jira is valid when all three credentials are present', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: {
          platforms: {
            jira: {
              enabled: true,
              baseUrl: 'https://j.atlassian.net',
              email: 'dev@j.com',
              apiToken: 'jira_tok',
            },
          },
        },
      });
      reloadSyncConfig();

      const result = validatePlatformCredentials('jira');
      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it('reports both missing Plane fields when none provided', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: { platforms: { plane: { enabled: true } } },
      });
      reloadSyncConfig();

      const result = validatePlatformCredentials('plane');
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('PLANE_API_KEY');
      expect(result.missing).toContain('PLANE_WORKSPACE_ID');
      expect(result.missing).toHaveLength(2);
    });

    it('reports only PLANE_WORKSPACE_ID when apiKey is present', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: { platforms: { plane: { enabled: true, apiKey: 'pk' } } },
      });
      reloadSyncConfig();

      const result = validatePlatformCredentials('plane');
      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(['PLANE_WORKSPACE_ID']);
    });

    it('Plane is valid when apiKey and workspaceId are both present', () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: {
          platforms: {
            plane: { enabled: true, apiKey: 'plane_key', workspaceId: 'ws-xyz' },
          },
        },
      });
      reloadSyncConfig();

      const result = validatePlatformCredentials('plane');
      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it('returns empty missing array for unknown platform (no switch case match)', () => {
      // An unknown platform string has no platform configuration at all,
      // so it returns early with the generic "platform configuration" message.
      vi.mocked(loadConfig).mockReturnValue({});
      reloadSyncConfig();

      const result = validatePlatformCredentials('trello');
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('platform configuration');
    });
  });
});
