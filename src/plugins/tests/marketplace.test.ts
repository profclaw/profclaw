/**
 * Plugin Marketplace Tests
 *
 * Tests for the PluginMarketplace class and getMarketplace() singleton.
 * All file I/O and child_process calls are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock external I/O before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/tmp/testhome'),
}));

// ---------------------------------------------------------------------------
// Import mocks and module under test AFTER vi.mock calls
// ---------------------------------------------------------------------------

import { execFile } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { PluginMarketplace } from '../marketplace.js';

const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;
const mockMkdirSync = mkdirSync as ReturnType<typeof vi.fn>;
const mockWriteFileSync = writeFileSync as ReturnType<typeof vi.fn>;

// Helper: make execFile return a resolved promise with given stdout
function mockExec(stdout: string): void {
  mockExecFile.mockImplementation(
    (_cmd: unknown, _args: unknown, _opts: unknown, cb: (err: null, res: { stdout: string }) => void) => {
      cb(null, { stdout });
    },
  );
}

// npm search JSON fixture
const NPM_SEARCH_RESULT = JSON.stringify([
  {
    name: 'profclaw-plugin-hello',
    version: '1.0.0',
    description: 'Hello plugin',
    author: { name: 'Alice' },
    date: '2024-01-01',
    keywords: ['profclaw', 'tool'],
    links: { homepage: 'https://example.com', repository: 'https://github.com/x/y' },
  },
  {
    name: '@profclaw/plugin-world',
    version: '2.0.0',
    description: 'World plugin',
    author: 'Bob',
    date: '2024-06-01',
    keywords: ['profclaw', 'channel', 'chat'],
    links: {},
  },
  {
    name: 'not-a-profclaw-plugin',
    version: '0.1.0',
    description: 'Should be filtered out',
    author: 'Unknown',
    date: '',
    keywords: [],
    links: {},
  },
]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PluginMarketplace', () => {
  let marketplace: PluginMarketplace;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: no state file exists, plugins dir does not exist
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue('{}');
    mockMkdirSync.mockReturnValue(undefined);
    mockWriteFileSync.mockReturnValue(undefined);

    marketplace = new PluginMarketplace();
  });

  // -------------------------------------------------------------------------
  // search()
  // -------------------------------------------------------------------------

  describe('search()', () => {
    it('returns an array of profclaw plugins from npm output', async () => {
      mockExec(NPM_SEARCH_RESULT);

      const results = await marketplace.search();

      expect(results.length).toBe(2);
      expect(results[0].name).toBe('profclaw-plugin-hello');
      expect(results[1].name).toBe('@profclaw/plugin-world');
    });

    it('filters out non-profclaw packages', async () => {
      mockExec(NPM_SEARCH_RESULT);

      const results = await marketplace.search();

      const nonProfclaw = results.find((r) => r.name === 'not-a-profclaw-plugin');
      expect(nonProfclaw).toBeUndefined();
    });

    it('filters by category', async () => {
      mockExec(NPM_SEARCH_RESULT);

      const results = await marketplace.search(undefined, 'channel');
      expect(results.every((r) => r.category === 'channel')).toBe(true);
    });

    it('returns cached results when npm fails and cache is populated', async () => {
      // First search to populate cache
      mockExec(NPM_SEARCH_RESULT);
      await marketplace.search();

      // Now make npm fail
      mockExecFile.mockImplementation(
        (_cmd: unknown, _args: unknown, _opts: unknown, cb: (err: Error) => void) => {
          cb(new Error('npm not found'));
        },
      );

      const results = await marketplace.search();
      expect(results.length).toBe(2);
    });

    it('throws when npm fails and cache is empty', async () => {
      mockExecFile.mockImplementation(
        (_cmd: unknown, _args: unknown, _opts: unknown, cb: (err: Error) => void) => {
          cb(new Error('npm not found'));
        },
      );

      await expect(marketplace.search()).rejects.toThrow('npm search failed');
    });
  });

  // -------------------------------------------------------------------------
  // install()
  // -------------------------------------------------------------------------

  describe('install()', () => {
    it('adds plugin to installed list and returns InstalledPlugin', async () => {
      // Sequence:
      //   1. PLUGINS_DIR existsSync -> false (mkdirSync it)
      //   2. pluginDir existsSync   -> false (mkdirSync it)
      //   3. pkgJsonPath existsSync -> false (writeFileSync bootstrap)
      //   4. After npm install, installedPkgPath existsSync -> true
      mockExistsSync
        .mockReturnValueOnce(false) // PLUGINS_DIR
        .mockReturnValueOnce(false) // pluginDir
        .mockReturnValueOnce(false) // pkgJsonPath (bootstrap)
        .mockReturnValue(true);     // installedPkgPath and any subsequent checks

      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.2.3' }));
      mockExec('');

      const plugin = await marketplace.install('profclaw-plugin-hello');

      expect(plugin.name).toBe('profclaw-plugin-hello');
      expect(plugin.version).toBe('1.2.3');
      expect(plugin.source).toBe('npm');
      expect(plugin.enabled).toBe(true);
    });

    it('rejects non-profclaw package names', async () => {
      await expect(marketplace.install('some-random-package')).rejects.toThrow(
        'Plugin must be named profclaw-plugin-* or @profclaw/*',
      );
    });

    it('throws when plugin is already installed', async () => {
      mockExec('');
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      // Install once
      await marketplace.install('profclaw-plugin-hello').catch(() => {
        // ignore version detection errors
      });

      // Manually add the plugin to state to simulate already-installed
      const state = (marketplace as unknown as { state: { installed: Array<{ name: string; path: string }> } }).state;
      state.installed.push({ name: 'profclaw-plugin-hello', path: '/tmp', version: '1.0.0', source: 'npm', installedAt: '', enabled: true });

      await expect(marketplace.install('profclaw-plugin-hello')).rejects.toThrow(
        'already installed',
      );
    });
  });

  // -------------------------------------------------------------------------
  // uninstall()
  // -------------------------------------------------------------------------

  describe('uninstall()', () => {
    it('removes plugin from installed list', async () => {
      // Seed installed state directly
      const state = (marketplace as unknown as { state: { installed: Array<Record<string, unknown>> } }).state;
      state.installed.push({
        name: 'profclaw-plugin-bye',
        version: '1.0.0',
        source: 'npm',
        path: '/tmp/plugins/bye',
        installedAt: '',
        enabled: true,
      });

      mockExec('');

      await marketplace.uninstall('profclaw-plugin-bye');

      expect(marketplace.listInstalled().find((p) => p.name === 'profclaw-plugin-bye')).toBeUndefined();
    });

    it('throws when plugin is not installed', async () => {
      await expect(marketplace.uninstall('profclaw-plugin-nope')).rejects.toThrow(
        'not installed',
      );
    });
  });

  // -------------------------------------------------------------------------
  // setEnabled() (toggle)
  // -------------------------------------------------------------------------

  describe('setEnabled()', () => {
    it('disables an installed plugin', () => {
      const state = (marketplace as unknown as { state: { installed: Array<Record<string, unknown>> } }).state;
      state.installed.push({
        name: 'profclaw-plugin-toggle',
        version: '1.0.0',
        source: 'npm',
        path: '/tmp',
        installedAt: '',
        enabled: true,
      });

      marketplace.setEnabled('profclaw-plugin-toggle', false);

      const plugin = marketplace.listInstalled().find((p) => p.name === 'profclaw-plugin-toggle');
      expect(plugin!.enabled).toBe(false);
    });

    it('enables a disabled plugin', () => {
      const state = (marketplace as unknown as { state: { installed: Array<Record<string, unknown>> } }).state;
      state.installed.push({
        name: 'profclaw-plugin-toggle2',
        version: '1.0.0',
        source: 'npm',
        path: '/tmp',
        installedAt: '',
        enabled: false,
      });

      marketplace.setEnabled('profclaw-plugin-toggle2', true);

      const plugin = marketplace.listInstalled().find((p) => p.name === 'profclaw-plugin-toggle2');
      expect(plugin!.enabled).toBe(true);
    });

    it('throws when plugin is not installed', () => {
      expect(() => marketplace.setEnabled('profclaw-plugin-ghost', true)).toThrow('not installed');
    });
  });

  // -------------------------------------------------------------------------
  // listInstalled()
  // -------------------------------------------------------------------------

  describe('listInstalled()', () => {
    it('returns empty array when nothing is installed', () => {
      expect(marketplace.listInstalled()).toEqual([]);
    });

    it('returns a copy of installed plugins', () => {
      const state = (marketplace as unknown as { state: { installed: Array<Record<string, unknown>> } }).state;
      state.installed.push({
        name: 'profclaw-plugin-test',
        version: '1.0.0',
        source: 'npm',
        path: '/tmp',
        installedAt: '',
        enabled: true,
      });

      const list = marketplace.listInstalled();
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('profclaw-plugin-test');
    });
  });
});
