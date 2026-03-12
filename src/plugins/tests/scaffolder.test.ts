/**
 * Plugin Scaffolder Tests
 *
 * Tests for the scaffoldPlugin() function in src/plugins/scaffolder.ts.
 * All file system calls are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock node:fs before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import mocks and module under test
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { scaffoldPlugin } from '../scaffolder.js';
import type { ScaffoldOptions } from '../scaffolder.js';

const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockMkdirSync = mkdirSync as ReturnType<typeof vi.fn>;
const mockWriteFileSync = writeFileSync as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Capture all writeFileSync calls and return a map of filename -> content */
function capturedFiles(): Map<string, string> {
  const result = new Map<string, string>();
  for (const call of mockWriteFileSync.mock.calls as [string, string][]) {
    const [path, content] = call;
    // Use the last path segment as the key for easy lookup
    const key = path.split('/').pop() ?? path;
    result.set(key, content);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scaffoldPlugin()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: target directory does NOT exist yet
    mockExistsSync.mockReturnValue(false);
    mockMkdirSync.mockReturnValue(undefined);
    mockWriteFileSync.mockReturnValue(undefined);
  });

  // -------------------------------------------------------------------------
  // Directory structure
  // -------------------------------------------------------------------------

  describe('creates correct directory structure', () => {
    it('creates plugin root directory and src/ subdirectory', () => {
      const opts: ScaffoldOptions = {
        name: 'my-tool',
        type: 'tool',
        outputDir: '/tmp/plugins/profclaw-plugin-my-tool',
      };

      scaffoldPlugin(opts);

      const dirs = mockMkdirSync.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(dirs).toContain('/tmp/plugins/profclaw-plugin-my-tool');
      expect(dirs.some((d) => d.endsWith('/src'))).toBe(true);
    });

    it('returns success: true with files list when directory is new', () => {
      const result = scaffoldPlugin({
        name: 'test-plugin',
        type: 'tool',
        outputDir: '/tmp/plugins/profclaw-plugin-test-plugin',
      });

      expect(result.success).toBe(true);
      expect(result.files.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // package.json
  // -------------------------------------------------------------------------

  describe('package.json content', () => {
    it('has correct package name', () => {
      scaffoldPlugin({
        name: 'my-tool',
        type: 'tool',
        outputDir: '/tmp/x',
      });

      const files = capturedFiles();
      const pkg = JSON.parse(files.get('package.json') ?? '{}') as { name: string };
      expect(pkg.name).toBe('profclaw-plugin-my-tool');
    });

    it('includes profclaw.category matching the plugin type', () => {
      for (const type of ['tool', 'channel', 'integration', 'skill'] as const) {
        vi.clearAllMocks();
        mockExistsSync.mockReturnValue(false);

        scaffoldPlugin({ name: 'x', type, outputDir: `/tmp/${type}` });

        const files = capturedFiles();
        const pkg = JSON.parse(files.get('package.json') ?? '{}') as {
          profclaw: { category: string };
        };
        expect(pkg.profclaw.category).toBe(type);
      }
    });

    it('uses provided description', () => {
      scaffoldPlugin({
        name: 'described',
        type: 'tool',
        description: 'My awesome plugin',
        outputDir: '/tmp/described',
      });

      const files = capturedFiles();
      const pkg = JSON.parse(files.get('package.json') ?? '{}') as { description: string };
      expect(pkg.description).toBe('My awesome plugin');
    });

    it('sets author when provided', () => {
      scaffoldPlugin({
        name: 'authored',
        type: 'integration',
        author: 'Jane Doe',
        outputDir: '/tmp/authored',
      });

      const files = capturedFiles();
      const pkg = JSON.parse(files.get('package.json') ?? '{}') as { author: string };
      expect(pkg.author).toBe('Jane Doe');
    });
  });

  // -------------------------------------------------------------------------
  // Source templates by type
  // -------------------------------------------------------------------------

  describe('generated index.ts has correct template', () => {
    it('tool template contains the tool name and execute function', () => {
      scaffoldPlugin({ name: 'my-tool', type: 'tool', outputDir: '/tmp/tool' });

      const files = capturedFiles();
      const src = files.get('index.ts') ?? '';
      expect(src).toContain('my_tool');
      expect(src).toContain('execute');
    });

    it('channel template contains sendMessage and handleIncoming', () => {
      scaffoldPlugin({ name: 'my-channel', type: 'channel', outputDir: '/tmp/channel' });

      const files = capturedFiles();
      const src = files.get('index.ts') ?? '';
      expect(src).toContain('sendMessage');
      expect(src).toContain('handleIncoming');
    });

    it('integration template contains settingsSchema and healthCheck', () => {
      scaffoldPlugin({ name: 'my-integration', type: 'integration', outputDir: '/tmp/integration' });

      const files = capturedFiles();
      const src = files.get('index.ts') ?? '';
      expect(src).toContain('settingsSchema');
      expect(src).toContain('healthCheck');
    });

    it('skill type creates SKILL.md', () => {
      scaffoldPlugin({ name: 'my-skill', type: 'skill', outputDir: '/tmp/skill' });

      const files = capturedFiles();
      const skillMd = files.get('SKILL.md') ?? '';
      expect(skillMd).toContain('my-skill');
    });

    it('skill type also creates src/index.ts with metadata', () => {
      scaffoldPlugin({ name: 'my-skill', type: 'skill', outputDir: '/tmp/skill-src' });

      const allPaths = (mockWriteFileSync.mock.calls as [string, string][]).map(([p]) => p);
      const hasSrcIndex = allPaths.some((p) => p.endsWith('src/index.ts'));
      expect(hasSrcIndex).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Boilerplate files
  // -------------------------------------------------------------------------

  describe('always creates README and .gitignore', () => {
    it('writes README.md', () => {
      scaffoldPlugin({ name: 'readme-test', type: 'tool', outputDir: '/tmp/readme' });

      const files = capturedFiles();
      expect(files.has('README.md')).toBe(true);
      expect(files.get('README.md')).toContain('readme-test');
    });

    it('writes .gitignore including node_modules and dist', () => {
      scaffoldPlugin({ name: 'gitignore-test', type: 'tool', outputDir: '/tmp/gi' });

      const files = capturedFiles();
      const gitignore = files.get('.gitignore') ?? '';
      expect(gitignore).toContain('node_modules');
      expect(gitignore).toContain('dist');
    });
  });

  // -------------------------------------------------------------------------
  // Existing directory handling
  // -------------------------------------------------------------------------

  describe('handles existing directory gracefully', () => {
    it('returns success: false with an error message when directory exists', () => {
      mockExistsSync.mockReturnValue(true);

      const result = scaffoldPlugin({
        name: 'exists',
        type: 'tool',
        outputDir: '/tmp/already-exists',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
      expect(mockMkdirSync).not.toHaveBeenCalled();
    });

    it('does not write any files when directory exists', () => {
      mockExistsSync.mockReturnValue(true);

      scaffoldPlugin({
        name: 'exists2',
        type: 'channel',
        outputDir: '/tmp/already-exists2',
      });

      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // files list in result
  // -------------------------------------------------------------------------

  describe('result.files', () => {
    it('lists all created files for a tool plugin', () => {
      const result = scaffoldPlugin({
        name: 'list-test',
        type: 'tool',
        outputDir: '/tmp/list-test',
      });

      expect(result.files).toContain('package.json');
      expect(result.files).toContain('tsconfig.json');
      expect(result.files).toContain('src/index.ts');
      expect(result.files).toContain('README.md');
      expect(result.files).toContain('.gitignore');
    });

    it('lists SKILL.md (not src/index.ts as main) for skill plugin', () => {
      const result = scaffoldPlugin({
        name: 'skill-files',
        type: 'skill',
        outputDir: '/tmp/skill-files',
      });

      expect(result.files).toContain('SKILL.md');
      // Skills ALSO get src/index.ts as a secondary file
      expect(result.files).toContain('src/index.ts');
    });
  });
});
