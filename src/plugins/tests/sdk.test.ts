/**
 * Tests for Plugin SDK
 */

import { describe, it, expect } from 'vitest';
import { definePlugin } from '../sdk.js';
import type { ProfClawPlugin, PluginToolDefinition, PluginManifest } from '../sdk.js';

describe('Plugin SDK', () => {
  describe('definePlugin()', () => {
    it('returns the plugin object unchanged', () => {
      const plugin: ProfClawPlugin = {
        metadata: {
          id: 'test-plugin',
          name: 'Test Plugin',
          description: 'A test plugin',
          category: 'tool',
          version: '1.0.0',
        },
      };
      const result = definePlugin(plugin);
      expect(result).toBe(plugin);
    });

    it('preserves tools array', () => {
      const tool: PluginToolDefinition = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: {
          input: {
            type: 'string',
            description: 'Input text',
            required: true,
          },
        },
        async execute(params) {
          return { success: true, data: { echo: params.input } };
        },
      };

      const plugin = definePlugin({
        metadata: {
          id: 'tools-plugin',
          name: 'Tools Plugin',
          description: 'Plugin with tools',
          category: 'tool',
          version: '0.1.0',
        },
        tools: [tool],
      });

      expect(plugin.tools).toHaveLength(1);
      expect(plugin.tools![0].name).toBe('test_tool');
    });

    it('preserves lifecycle hooks', async () => {
      let loaded = false;
      let unloaded = false;

      const plugin = definePlugin({
        metadata: {
          id: 'lifecycle-plugin',
          name: 'Lifecycle Plugin',
          description: 'Plugin with lifecycle hooks',
          category: 'tool',
          version: '0.1.0',
        },
        async onLoad() {
          loaded = true;
        },
        async onUnload() {
          unloaded = true;
        },
        async healthCheck() {
          return { healthy: true, lastCheck: new Date() };
        },
      });

      await plugin.onLoad!({});
      expect(loaded).toBe(true);

      await plugin.onUnload!();
      expect(unloaded).toBe(true);

      const health = await plugin.healthCheck!();
      expect(health.healthy).toBe(true);
    });

    it('preserves skills array', () => {
      const plugin = definePlugin({
        metadata: {
          id: 'skills-plugin',
          name: 'Skills Plugin',
          description: 'Plugin with skills',
          category: 'tool',
          version: '0.1.0',
        },
        skills: [
          {
            name: 'custom-skill',
            description: 'A custom skill',
            content: '# Custom Skill\n\nDo something useful.',
          },
        ],
      });

      expect(plugin.skills).toHaveLength(1);
      expect(plugin.skills![0].name).toBe('custom-skill');
    });

    it('tool execute returns proper ToolResult', async () => {
      const plugin = definePlugin({
        metadata: {
          id: 'exec-plugin',
          name: 'Exec Plugin',
          description: 'Test execution',
          category: 'tool',
          version: '0.1.0',
        },
        tools: [
          {
            name: 'greet',
            description: 'Greets someone',
            parameters: {
              name: { type: 'string', description: 'Name', required: true },
            },
            async execute(params) {
              return {
                success: true,
                data: { message: `Hello, ${params.name}!` },
              };
            },
          },
        ],
      });

      const result = await plugin.tools![0].execute({ name: 'World' });
      expect(result.success).toBe(true);
      expect(result.data?.message).toBe('Hello, World!');
    });

    it('supports search provider factory', () => {
      const plugin = definePlugin({
        metadata: {
          id: 'search-plugin',
          name: 'Search Plugin',
          description: 'Plugin with search',
          category: 'search',
          version: '0.1.0',
        },
        searchProvider: (_config) => ({
          id: 'custom-search',
          name: 'Custom Search',
          search: async (_query) => [],
        }),
      });

      expect(plugin.searchProvider).toBeDefined();
      const provider = plugin.searchProvider!({});
      expect(provider.id).toBe('custom-search');
    });
  });

  describe('PluginManifest interface', () => {
    it('validates manifest structure', () => {
      const manifest: PluginManifest = {
        name: 'profclaw-plugin-test',
        version: '1.0.0',
        description: 'A test plugin',
        profclaw: {
          main: 'src/index.js',
          category: 'tool',
          minVersion: '2.0.0',
          capabilities: ['tools'],
        },
      };

      expect(manifest.name).toBe('profclaw-plugin-test');
      expect(manifest.profclaw?.category).toBe('tool');
      expect(manifest.profclaw?.minVersion).toBe('2.0.0');
    });
  });
});
