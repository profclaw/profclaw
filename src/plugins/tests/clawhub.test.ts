/**
 * ClawHub Client Tests
 *
 * Tests for the ClawHubClient class and getClawHubClient() singleton.
 * Mocks global fetch and all node:fs operations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock node:fs and node:os before importing module under test
// ---------------------------------------------------------------------------

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  rmSync: vi.fn(),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/tmp/testhome'),
}));

// ---------------------------------------------------------------------------
// Import mocks and module under test
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { ClawHubClient } from '../clawhub.js';
import type { ClawHubSkill } from '../clawhub.js';

const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockMkdirSync = mkdirSync as ReturnType<typeof vi.fn>;
const mockWriteFileSync = writeFileSync as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;
const mockRmSync = rmSync as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

function mockFetchResponse(body: unknown, ok = true): void {
  const response = {
    ok,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

function mockFetchFail(): void {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GITHUB_SEARCH_RESPONSE = {
  items: [
    {
      name: 'SKILL.md',
      path: 'skills/code-review/SKILL.md',
      repository: {
        full_name: 'alice/awesome-skills',
        description: 'Code review skill',
        stargazers_count: 42,
        updated_at: '2024-06-01T00:00:00Z',
        owner: { login: 'alice' },
      },
      html_url: 'https://github.com/alice/awesome-skills/blob/main/skills/code-review/SKILL.md',
    },
  ],
};

const SKILL_FIXTURE: ClawHubSkill = {
  name: 'code-review',
  description: 'Code review skill',
  author: 'alice',
  repo: 'alice/awesome-skills',
  path: 'skills/code-review/SKILL.md',
  stars: 42,
  lastUpdated: '2024-06-01T00:00:00Z',
  tags: [],
  source: 'github',
  installUrl: 'https://raw.githubusercontent.com/alice/awesome-skills/main/skills/code-review/SKILL.md',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClawHubClient', () => {
  let client: ClawHubClient;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();

    // Default: no state file
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue('{}');
    mockMkdirSync.mockReturnValue(undefined);
    mockWriteFileSync.mockReturnValue(undefined);
    mockRmSync.mockReturnValue(undefined);

    client = new ClawHubClient();
  });

  // -------------------------------------------------------------------------
  // search()
  // -------------------------------------------------------------------------

  describe('search()', () => {
    it('calls GitHub API and returns parsed skills', async () => {
      // GitHub search returns skills; awesome list fails (returns empty)
      const ghSearchRes = {
        ok: true,
        json: vi.fn().mockResolvedValue(GITHUB_SEARCH_RESPONSE),
        text: vi.fn(),
      };
      const awesomeListRes = {
        ok: false,
        json: vi.fn(),
        text: vi.fn(),
      };

      vi.stubGlobal(
        'fetch',
        vi.fn()
          .mockResolvedValueOnce(ghSearchRes)   // GitHub code search
          .mockResolvedValueOnce(awesomeListRes), // awesome-list repo metadata
      );

      const results = await client.search();

      expect(results.length).toBeGreaterThanOrEqual(1);
      const codeReview = results.find((s) => s.name === 'code-review');
      expect(codeReview).toBeDefined();
      expect(codeReview!.author).toBe('alice');
      expect(codeReview!.stars).toBe(42);
      expect(codeReview!.source).toBe('github');
    });

    it('returns empty array when GitHub rate-limits (non-ok response)', async () => {
      const rateLimitRes = {
        ok: false,
        json: vi.fn().mockResolvedValue({}),
        text: vi.fn(),
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rateLimitRes));

      const results = await client.search();
      expect(Array.isArray(results)).toBe(true);
    });

    it('deduplicates skills by author/name', async () => {
      // Two sources return the same skill
      const dupResponse = {
        items: [GITHUB_SEARCH_RESPONSE.items[0], GITHUB_SEARCH_RESPONSE.items[0]],
      };
      const res = {
        ok: true,
        json: vi.fn().mockResolvedValue(dupResponse),
        text: vi.fn(),
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res));

      const results = await client.search();
      const names = results.map((s) => `${s.author}/${s.name}`);
      const unique = new Set(names);
      expect(unique.size).toBe(names.length);
    });

    it('uses cache when cacheExpiry is in the future and no query given', async () => {
      // Manually inject a non-expired cache
      const state = (client as unknown as {
        state: {
          cache: ClawHubSkill[];
          cacheExpiry: string | null;
          lastSearch: string | null;
          installed: unknown[];
        };
      }).state;
      state.cache = [SKILL_FIXTURE];
      state.cacheExpiry = new Date(Date.now() + 60_000).toISOString();

      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const results = await client.search();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('code-review');
    });
  });

  // -------------------------------------------------------------------------
  // getFeatured()
  // -------------------------------------------------------------------------

  describe('getFeatured()', () => {
    it('returns skills sorted by stars, limited to 20', async () => {
      const manySkills: ClawHubSkill[] = Array.from({ length: 25 }, (_, i) => ({
        ...SKILL_FIXTURE,
        name: `skill-${i}`,
        stars: i,
      }));

      const state = (client as unknown as {
        state: { cache: ClawHubSkill[]; cacheExpiry: string | null; installed: unknown[]; lastSearch: string | null };
      }).state;
      state.cache = manySkills;
      state.cacheExpiry = new Date(Date.now() + 60_000).toISOString();

      // search() will use cache
      const featured = await client.getFeatured();
      expect(featured.length).toBe(20);
      // Sorted desc by stars - first should have the highest star count
      expect(featured[0].stars).toBeGreaterThan(featured[1].stars);
    });
  });

  // -------------------------------------------------------------------------
  // install()
  // -------------------------------------------------------------------------

  describe('install()', () => {
    it('downloads SKILL.md and saves to disk', async () => {
      const skillMdContent = '---\nname: code-review\n---\n# Code Review';

      const downloadRes = {
        ok: true,
        text: vi.fn().mockResolvedValue(skillMdContent),
        json: vi.fn(),
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(downloadRes));

      const result = await client.install(SKILL_FIXTURE);

      expect(result.name).toBe('code-review');
      expect(result.repo).toBe('alice/awesome-skills');
      expect(result.localPath).toContain('code-review');

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('SKILL.md'),
        skillMdContent,
      );
    });

    it('throws when skill is already installed', async () => {
      const state = (client as unknown as {
        state: { installed: Array<{ name: string; repo: string; localPath: string; installedAt: string }> };
      }).state;
      state.installed.push({
        name: 'code-review',
        repo: 'alice/awesome-skills',
        localPath: '/tmp/testhome/.profclaw/skills/code-review',
        installedAt: '',
      });

      await expect(client.install(SKILL_FIXTURE)).rejects.toThrow('already installed');
    });

    it('throws when download fails all URL attempts', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, text: vi.fn(), json: vi.fn() }));

      await expect(client.install(SKILL_FIXTURE)).rejects.toThrow('Failed to download SKILL.md');
    });
  });

  // -------------------------------------------------------------------------
  // uninstall()
  // -------------------------------------------------------------------------

  describe('uninstall()', () => {
    it('removes the skill directory and clears from state', () => {
      const state = (client as unknown as {
        state: { installed: Array<{ name: string; repo: string; localPath: string; installedAt: string }> };
      }).state;
      state.installed.push({
        name: 'code-review',
        repo: 'alice/awesome-skills',
        localPath: '/tmp/testhome/.profclaw/skills/code-review',
        installedAt: '',
      });

      // Make the skill dir appear to exist
      mockExistsSync.mockReturnValue(true);

      client.uninstall('code-review');

      expect(mockRmSync).toHaveBeenCalledWith(
        '/tmp/testhome/.profclaw/skills/code-review',
        { recursive: true, force: true },
      );
      expect(client.listInstalled().find((s) => s.name === 'code-review')).toBeUndefined();
    });

    it('throws when skill is not installed', () => {
      expect(() => client.uninstall('nonexistent-skill')).toThrow('not installed from ClawHub');
    });
  });

  // -------------------------------------------------------------------------
  // listInstalled()
  // -------------------------------------------------------------------------

  describe('listInstalled()', () => {
    it('returns empty array initially', () => {
      expect(client.listInstalled()).toEqual([]);
    });

    it('returns a copy of installed skills after install', async () => {
      const skillMdContent = '---\nname: code-review\n---';
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue(skillMdContent), json: vi.fn() }),
      );

      await client.install(SKILL_FIXTURE);

      const list = client.listInstalled();
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('code-review');
    });
  });
});
