import { describe, it, expect, beforeEach } from 'vitest';
import { ToolLoader } from '../tool-loader.js';
import type { ToolCategory } from '../tool-loader.js';
import type { ToolDefinition } from '../../chat/execution/types.js';
import { z } from 'zod';

// Helpers

function makeTool(name: string): ToolDefinition {
  return {
    name,
    description: `Mock tool: ${name}`,
    category: 'custom',
    securityLevel: 'safe',
    parameters: z.object({}),
    execute: async () => ({ success: true }),
  };
}

function makeToolMap(names: string[]): Map<string, ToolDefinition> {
  const map = new Map<string, ToolDefinition>();
  for (const name of names) {
    map.set(name, makeTool(name));
  }
  return map;
}

// Tests

describe('ToolLoader', () => {
  const coreToolNames = [
    'read_file',
    'write_file',
    'search_files',
    'exec',
    'git_status',
    'git_commit',
    'complete_task',
    'search_available_tools',
  ];

  const extraToolNames = [
    'git_diff',
    'git_log',
    'git_branch',
    'memory_search',
    'memory_get',
    'browser_navigate',
    'browser_click',
  ];

  let allToolNames: string[];
  let toolMap: Map<string, ToolDefinition>;
  let loader: ToolLoader;

  beforeEach(() => {
    allToolNames = [...coreToolNames, ...extraToolNames];
    toolMap = makeToolMap(allToolNames);
    loader = new ToolLoader(toolMap);
  });

  // ─── getCoreTools ────────────────────────────────────────────────────────────

  describe('getCoreTools', () => {
    it('returns all always_loaded tools that exist in the tool map', () => {
      const core = loader.getCoreTools();
      const coreNames = core.map((t) => t.name);

      for (const name of coreToolNames) {
        expect(coreNames).toContain(name);
      }
    });

    it('does not include tools outside the always_loaded category', () => {
      const core = loader.getCoreTools();
      const coreNames = core.map((t) => t.name);

      for (const name of extraToolNames) {
        expect(coreNames).not.toContain(name);
      }
    });

    it('returns an empty array when no always_loaded tools are registered', () => {
      const emptyLoader = new ToolLoader(new Map());
      // always_loaded category exists but none of its tools are in the map
      const core = emptyLoader.getCoreTools();
      expect(core).toHaveLength(0);
    });
  });

  // ─── getSessionTools ─────────────────────────────────────────────────────────

  describe('getSessionTools', () => {
    it('initially returns only the always_loaded (core) tools', () => {
      const session = loader.getSessionTools();
      const sessionNames = session.map((t) => t.name);

      for (const name of coreToolNames) {
        expect(sessionNames).toContain(name);
      }
      for (const name of extraToolNames) {
        expect(sessionNames).not.toContain(name);
      }
    });

    it('includes dynamically loaded tools after loadCategory is called', () => {
      loader.loadCategory('git_advanced');
      const session = loader.getSessionTools();
      const sessionNames = session.map((t) => t.name);

      // git_diff and git_log are in git_advanced and present in our tool map
      expect(sessionNames).toContain('git_diff');
      expect(sessionNames).toContain('git_log');
    });

    it('includes a single dynamically loaded tool after loadTool is called', () => {
      loader.loadTool('memory_search');
      const session = loader.getSessionTools();
      expect(session.map((t) => t.name)).toContain('memory_search');
    });

    it('does not add a tool that is not in the tool map', () => {
      const beforeCount = loader.getSessionTools().length;
      loader.loadTool('nonexistent_tool');
      expect(loader.getSessionTools().length).toBe(beforeCount);
    });
  });

  // ─── search ──────────────────────────────────────────────────────────────────

  describe('search', () => {
    it('returns relevant categories for a keyword query', () => {
      const results = loader.search('browser');
      const names = results.map((c) => c.name);
      expect(names).toContain('browser');
    });

    it('returns all categories for an empty query', () => {
      const all = loader.getCategories();
      const searched = loader.search('');
      expect(searched.length).toBe(all.length);
    });

    it('returns categories ranked by relevance — exact keyword beats partial match', () => {
      // "memory" exactly matches a keyword in the memory category
      const results = loader.search('memory');
      expect(results[0].name).toBe('memory');
    });

    it('returns an empty array for a query that matches nothing', () => {
      const results = loader.search('zzzzunlikelytomatch9999');
      expect(results).toHaveLength(0);
    });

    it('is case-insensitive', () => {
      const lower = loader.search('git');
      const upper = loader.search('GIT');
      expect(lower.map((c) => c.name)).toEqual(upper.map((c) => c.name));
    });

    it('matches multi-word queries', () => {
      const results = loader.search('git advanced');
      expect(results.map((c) => c.name)).toContain('git_advanced');
    });
  });

  // ─── loadCategory ────────────────────────────────────────────────────────────

  describe('loadCategory', () => {
    it('loads tools from a known category', () => {
      expect(loader.isLoaded('memory_search')).toBe(false);
      loader.loadCategory('memory');
      expect(loader.isLoaded('memory_search')).toBe(true);
    });

    it('silently ignores an unknown category name', () => {
      expect(() => loader.loadCategory('no_such_category')).not.toThrow();
    });

    it('does not load a tool that is missing from the tool map', () => {
      // canvas_render is in the canvas category but not in our tool map
      loader.loadCategory('canvas');
      expect(loader.isLoaded('canvas_render')).toBe(false);
    });
  });

  // ─── loadTool ────────────────────────────────────────────────────────────────

  describe('loadTool', () => {
    it('marks the tool as loaded', () => {
      loader.loadTool('git_diff');
      expect(loader.isLoaded('git_diff')).toBe(true);
    });

    it('silently ignores a tool that is not in the tool map', () => {
      expect(() => loader.loadTool('unknown_tool')).not.toThrow();
      expect(loader.isLoaded('unknown_tool')).toBe(false);
    });

    it('loading the same tool twice is idempotent', () => {
      loader.loadTool('git_diff');
      loader.loadTool('git_diff');
      const names = loader.getSessionTools().map((t) => t.name);
      const count = names.filter((n) => n === 'git_diff').length;
      expect(count).toBe(1);
    });
  });

  // ─── getCategories ───────────────────────────────────────────────────────────

  describe('getCategories', () => {
    it('returns at least the built-in categories', () => {
      const categories = loader.getCategories();
      const names = categories.map((c) => c.name);

      const expectedNames = [
        'always_loaded',
        'file_ops',
        'browser',
        'integration',
        'git_advanced',
        'canvas',
        'voice',
        'memory',
        'system',
      ];

      for (const name of expectedNames) {
        expect(names).toContain(name);
      }
    });
  });

  // ─── registerCategory ────────────────────────────────────────────────────────

  describe('registerCategory (custom categories)', () => {
    it('registers and returns a custom category', () => {
      const custom: ToolCategory = {
        name: 'custom_test',
        description: 'Test custom category',
        keywords: ['test', 'custom'],
        tools: ['read_file'],
        alwaysLoaded: false,
      };

      loader.registerCategory(custom);
      const found = loader.getCategories().find((c) => c.name === 'custom_test');
      expect(found).toBeDefined();
      expect(found?.description).toBe('Test custom category');
    });

    it('auto-loads tools when alwaysLoaded is true', () => {
      // git_diff is in the tool map but not yet loaded
      expect(loader.isLoaded('git_diff')).toBe(false);

      const autoCategory: ToolCategory = {
        name: 'auto_test',
        description: 'Auto-loaded category',
        keywords: ['auto'],
        tools: ['git_diff'],
        alwaysLoaded: true,
      };

      loader.registerCategory(autoCategory);
      expect(loader.isLoaded('git_diff')).toBe(true);
    });

    it('overwrites an existing category with the same name', () => {
      const original: ToolCategory = {
        name: 'overwrite_test',
        description: 'Original',
        keywords: [],
        tools: [],
        alwaysLoaded: false,
      };
      const updated: ToolCategory = {
        ...original,
        description: 'Updated',
      };

      loader.registerCategory(original);
      loader.registerCategory(updated);

      const found = loader.getCategories().find((c) => c.name === 'overwrite_test');
      expect(found?.description).toBe('Updated');
    });
  });

  // ─── isLoaded ────────────────────────────────────────────────────────────────

  describe('isLoaded', () => {
    it('returns true for a core tool from the start', () => {
      expect(loader.isLoaded('read_file')).toBe(true);
    });

    it('returns false for a tool that has not been loaded', () => {
      expect(loader.isLoaded('browser_navigate')).toBe(false);
    });
  });
});
