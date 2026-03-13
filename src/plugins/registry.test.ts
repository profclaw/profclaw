/**
 * Tests for Plugin Registry
 *
 * Covers SearchProviderRegistry, ToolProviderRegistry, PluginManager, and
 * the getPluginManager() singleton.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SearchProviderRegistry, ToolProviderRegistry, PluginManager, getPluginManager } from './registry.js';
import type {
  PluginMetadata,
  PluginConfig,
  PluginHealth,
  SearchProvider,
  SearchPluginDefinition,
  ToolProvider,
  ToolPluginDefinition,
  PluginSettingsSchema,
  SearchResponse,
  ToolResult,
} from './types.js';

// ============================================================================
// Shared test helpers
// ============================================================================

function makeMetadata(overrides: Partial<PluginMetadata> = {}): PluginMetadata {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    description: 'A test plugin',
    category: 'search',
    version: '1.0.0',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<PluginConfig> = {}): PluginConfig {
  return {
    id: 'config-1',
    pluginId: 'test-plugin',
    enabled: true,
    priority: 5,
    settings: {},
    ...overrides,
  };
}

function makeSettingsSchema(): PluginSettingsSchema {
  return {
    credentials: [
      { key: 'apiKey', type: 'password', label: 'API Key', required: true },
    ],
    settings: [
      { key: 'maxResults', type: 'number', label: 'Max Results', default: 10 },
    ],
  };
}

function makeSearchProvider(
  meta: PluginMetadata,
  overrides: Partial<SearchProvider> = {}
): SearchProvider {
  return {
    metadata: meta,
    search: vi.fn().mockResolvedValue({
      results: [{ title: 'Result', url: 'https://example.com', snippet: 'snippet' }],
      query: 'test',
      provider: meta.id,
    } satisfies SearchResponse),
    isAvailable: vi.fn().mockResolvedValue(true),
    healthCheck: vi.fn().mockResolvedValue({
      healthy: true,
      lastCheck: new Date(),
    } satisfies PluginHealth),
    ...overrides,
  };
}

function makeSearchDefinition(
  meta: PluginMetadata,
  providerOverrides: Partial<SearchProvider> = {}
): SearchPluginDefinition {
  return {
    metadata: meta,
    settingsSchema: makeSettingsSchema(),
    factory: vi.fn((config: PluginConfig) => makeSearchProvider(meta, providerOverrides)),
  };
}

function makeToolProvider(meta: PluginMetadata, toolNames: string[] = ['tool_a']): ToolProvider {
  return {
    metadata: meta,
    tools: toolNames.map((name) => ({
      name,
      description: `${name} description`,
      parameters: [],
    })),
    execute: vi.fn().mockResolvedValue({ success: true, data: { result: 'ok' } } satisfies ToolResult),
    isAvailable: vi.fn().mockResolvedValue(true),
    healthCheck: vi.fn().mockResolvedValue({
      healthy: true,
      lastCheck: new Date(),
    } satisfies PluginHealth),
  };
}

function makeToolDefinition(
  meta: PluginMetadata,
  toolNames: string[] = ['tool_a']
): ToolPluginDefinition {
  return {
    metadata: meta,
    settingsSchema: makeSettingsSchema(),
    factory: vi.fn((config: PluginConfig) => makeToolProvider(meta, toolNames)),
  };
}

// ============================================================================
// SearchProviderRegistry
// ============================================================================

describe('SearchProviderRegistry', () => {
  let registry: SearchProviderRegistry;

  beforeEach(() => {
    registry = new SearchProviderRegistry();
  });

  // --- Registration ---

  describe('register()', () => {
    it('adds the plugin id to listRegistered()', () => {
      const def = makeSearchDefinition(makeMetadata({ id: 'brave' }));
      registry.register(def);
      expect(registry.listRegistered()).toContain('brave');
    });

    it('overwrites an existing registration with the same id', () => {
      const def1 = makeSearchDefinition(makeMetadata({ id: 'brave', name: 'Brave v1' }));
      const def2 = makeSearchDefinition(makeMetadata({ id: 'brave', name: 'Brave v2' }));
      registry.register(def1);
      registry.register(def2);
      expect(registry.listRegistered()).toHaveLength(1);
      expect(registry.getMetadata('brave')?.name).toBe('Brave v2');
    });

    it('makes metadata retrievable immediately after registration', () => {
      const meta = makeMetadata({ id: 'serper', name: 'Serper' });
      registry.register(makeSearchDefinition(meta));
      const retrieved = registry.getMetadata('serper');
      expect(retrieved).toEqual(meta);
    });
  });

  describe('unregister()', () => {
    it('removes the definition from listRegistered()', () => {
      registry.register(makeSearchDefinition(makeMetadata({ id: 'brave' })));
      registry.unregister('brave');
      expect(registry.listRegistered()).not.toContain('brave');
    });

    it('removes instances created from that plugin', () => {
      const meta = makeMetadata({ id: 'brave' });
      registry.register(makeSearchDefinition(meta));
      registry.create(makeConfig({ pluginId: 'brave' }));
      registry.unregister('brave');
      expect(registry.get('config-1')).toBeUndefined();
    });

    it('removes all configs associated with the plugin', () => {
      const meta = makeMetadata({ id: 'brave' });
      registry.register(makeSearchDefinition(meta));
      registry.create(makeConfig({ id: 'c1', pluginId: 'brave' }));
      registry.create(makeConfig({ id: 'c2', pluginId: 'brave' }));
      registry.unregister('brave');
      expect(registry.getAllConfigs()).toHaveLength(0);
    });

    it('is a no-op for unknown plugin ids', () => {
      expect(() => registry.unregister('does-not-exist')).not.toThrow();
    });
  });

  // --- Instance creation ---

  describe('create()', () => {
    it('returns a SearchProvider instance', () => {
      const meta = makeMetadata({ id: 'brave' });
      registry.register(makeSearchDefinition(meta));
      const instance = registry.create(makeConfig({ pluginId: 'brave' }));
      expect(instance).toBeDefined();
      expect(typeof instance.search).toBe('function');
    });

    it('stores the instance and config so get() works', () => {
      const meta = makeMetadata({ id: 'brave' });
      registry.register(makeSearchDefinition(meta));
      const instance = registry.create(makeConfig({ id: 'my-config', pluginId: 'brave' }));
      expect(registry.get('my-config')).toBe(instance);
    });

    it('throws for an unknown pluginId', () => {
      expect(() =>
        registry.create(makeConfig({ pluginId: 'not-registered' }))
      ).toThrow('Unknown search provider plugin: not-registered');
    });

    it('calls the definition factory with the config', () => {
      const meta = makeMetadata({ id: 'brave' });
      const def = makeSearchDefinition(meta);
      registry.register(def);
      const cfg = makeConfig({ pluginId: 'brave' });
      registry.create(cfg);
      expect(def.factory).toHaveBeenCalledWith(cfg);
    });
  });

  describe('get()', () => {
    it('returns undefined for a config id that was never created', () => {
      expect(registry.get('ghost')).toBeUndefined();
    });
  });

  // --- Active filtering and priority sorting ---

  describe('getActive()', () => {
    it('returns only enabled instances', () => {
      const meta = makeMetadata({ id: 'brave' });
      registry.register(makeSearchDefinition(meta));
      registry.create(makeConfig({ id: 'c-enabled', pluginId: 'brave', enabled: true }));
      registry.create(makeConfig({ id: 'c-disabled', pluginId: 'brave', enabled: false }));
      const active = registry.getActive();
      expect(active).toHaveLength(1);
      expect(active[0]).toBe(registry.get('c-enabled'));
    });

    it('returns empty array when there are no enabled instances', () => {
      const meta = makeMetadata({ id: 'brave' });
      registry.register(makeSearchDefinition(meta));
      registry.create(makeConfig({ pluginId: 'brave', enabled: false }));
      expect(registry.getActive()).toHaveLength(0);
    });

    it('sorts active providers by priority descending', () => {
      const meta = makeMetadata({ id: 'brave' });
      registry.register(makeSearchDefinition(meta));
      registry.create(makeConfig({ id: 'low', pluginId: 'brave', priority: 1 }));
      registry.create(makeConfig({ id: 'high', pluginId: 'brave', priority: 10 }));
      registry.create(makeConfig({ id: 'mid', pluginId: 'brave', priority: 5 }));
      const active = registry.getActive();
      expect(active[0]).toBe(registry.get('high'));
      expect(active[1]).toBe(registry.get('mid'));
      expect(active[2]).toBe(registry.get('low'));
    });
  });

  describe('getPrimary()', () => {
    it('returns the highest-priority enabled provider', () => {
      const meta = makeMetadata({ id: 'brave' });
      registry.register(makeSearchDefinition(meta));
      registry.create(makeConfig({ id: 'low', pluginId: 'brave', priority: 1 }));
      registry.create(makeConfig({ id: 'high', pluginId: 'brave', priority: 99 }));
      expect(registry.getPrimary()).toBe(registry.get('high'));
    });

    it('returns undefined when no providers are active', () => {
      expect(registry.getPrimary()).toBeUndefined();
    });
  });

  // --- Metadata ---

  describe('getAllMetadata()', () => {
    it('returns metadata for every registered definition', () => {
      registry.register(makeSearchDefinition(makeMetadata({ id: 'p1' })));
      registry.register(makeSearchDefinition(makeMetadata({ id: 'p2' })));
      const all = registry.getAllMetadata();
      expect(all).toHaveLength(2);
      expect(all.map((m) => m.id)).toEqual(expect.arrayContaining(['p1', 'p2']));
    });

    it('returns empty array when nothing is registered', () => {
      expect(registry.getAllMetadata()).toHaveLength(0);
    });
  });

  describe('getMetadata()', () => {
    it('returns undefined for an unregistered plugin', () => {
      expect(registry.getMetadata('ghost')).toBeUndefined();
    });
  });

  describe('getSettingsSchema()', () => {
    it('returns the schema for a registered plugin', () => {
      const meta = makeMetadata({ id: 'brave' });
      const def = makeSearchDefinition(meta);
      registry.register(def);
      expect(registry.getSettingsSchema('brave')).toEqual(def.settingsSchema);
    });

    it('returns undefined for an unregistered plugin', () => {
      expect(registry.getSettingsSchema('ghost')).toBeUndefined();
    });
  });

  // --- Config management ---

  describe('getAllConfigs()', () => {
    it('returns all stored configs', () => {
      const meta = makeMetadata({ id: 'brave' });
      registry.register(makeSearchDefinition(meta));
      registry.create(makeConfig({ id: 'c1', pluginId: 'brave' }));
      registry.create(makeConfig({ id: 'c2', pluginId: 'brave' }));
      expect(registry.getAllConfigs()).toHaveLength(2);
    });
  });

  describe('updateConfig()', () => {
    it('merges the provided updates into the existing config', () => {
      const meta = makeMetadata({ id: 'brave' });
      registry.register(makeSearchDefinition(meta));
      registry.create(makeConfig({ id: 'c1', pluginId: 'brave', priority: 5 }));
      registry.updateConfig('c1', { priority: 20 });
      const configs = registry.getAllConfigs();
      const updated = configs.find((c) => c.id === 'c1');
      expect(updated?.priority).toBe(20);
    });

    it('recreates the instance with the updated config', () => {
      const meta = makeMetadata({ id: 'brave' });
      const def = makeSearchDefinition(meta);
      registry.register(def);
      const cfg = makeConfig({ id: 'c1', pluginId: 'brave' });
      const originalInstance = registry.create(cfg);
      registry.updateConfig('c1', { priority: 99 });
      const newInstance = registry.get('c1');
      // factory is called again on update, so instance reference changes
      expect(def.factory).toHaveBeenCalledTimes(2);
      expect(newInstance).not.toBe(originalInstance);
    });

    it('is a no-op for an unknown config id', () => {
      expect(() => registry.updateConfig('ghost', { priority: 1 })).not.toThrow();
    });
  });

  describe('deleteConfig()', () => {
    it('removes the instance and config', () => {
      const meta = makeMetadata({ id: 'brave' });
      registry.register(makeSearchDefinition(meta));
      registry.create(makeConfig({ id: 'c1', pluginId: 'brave' }));
      registry.deleteConfig('c1');
      expect(registry.get('c1')).toBeUndefined();
      expect(registry.getAllConfigs()).toHaveLength(0);
    });

    it('clears the health cache for that config', async () => {
      const meta = makeMetadata({ id: 'brave' });
      registry.register(makeSearchDefinition(meta));
      registry.create(makeConfig({ id: 'c1', pluginId: 'brave' }));
      // Prime the cache
      await registry.getHealth('c1');
      registry.deleteConfig('c1');
      // After deletion the instance is gone - should return unhealthy
      const health = await registry.getHealth('c1');
      expect(health.healthy).toBe(false);
      expect(health.errorMessage).toBe('Provider not initialized');
    });
  });

  // --- Health check caching ---

  describe('getHealth()', () => {
    it('returns unhealthy when no instance exists for configId', async () => {
      const health = await registry.getHealth('ghost');
      expect(health.healthy).toBe(false);
      expect(health.errorMessage).toBe('Provider not initialized');
    });

    it('delegates to the instance healthCheck() method', async () => {
      const meta = makeMetadata({ id: 'brave' });
      const provider = makeSearchProvider(meta);
      const def: SearchPluginDefinition = {
        metadata: meta,
        settingsSchema: makeSettingsSchema(),
        factory: vi.fn().mockReturnValue(provider),
      };
      registry.register(def);
      registry.create(makeConfig({ id: 'c1', pluginId: 'brave' }));
      const health = await registry.getHealth('c1');
      expect(provider.healthCheck).toHaveBeenCalledTimes(1);
      expect(health.healthy).toBe(true);
    });

    it('caches results within the 60 s TTL', async () => {
      const meta = makeMetadata({ id: 'brave' });
      const provider = makeSearchProvider(meta);
      const def: SearchPluginDefinition = {
        metadata: meta,
        settingsSchema: makeSettingsSchema(),
        factory: vi.fn().mockReturnValue(provider),
      };
      registry.register(def);
      registry.create(makeConfig({ id: 'c1', pluginId: 'brave' }));
      await registry.getHealth('c1');
      await registry.getHealth('c1');
      // healthCheck should only have been called once due to caching
      expect(provider.healthCheck).toHaveBeenCalledTimes(1);
    });

    it('stores an unhealthy result when healthCheck() throws', async () => {
      const meta = makeMetadata({ id: 'brave' });
      const provider = makeSearchProvider(meta, {
        healthCheck: vi.fn().mockRejectedValue(new Error('network down')),
      });
      const def: SearchPluginDefinition = {
        metadata: meta,
        settingsSchema: makeSettingsSchema(),
        factory: vi.fn().mockReturnValue(provider),
      };
      registry.register(def);
      registry.create(makeConfig({ id: 'c1', pluginId: 'brave' }));
      const health = await registry.getHealth('c1');
      expect(health.healthy).toBe(false);
      expect(health.errorMessage).toBe('network down');
    });

    it('re-fetches after the cache TTL expires', async () => {
      vi.useFakeTimers();
      const meta = makeMetadata({ id: 'brave' });
      const provider = makeSearchProvider(meta);
      const def: SearchPluginDefinition = {
        metadata: meta,
        settingsSchema: makeSettingsSchema(),
        factory: vi.fn().mockReturnValue(provider),
      };
      registry.register(def);
      registry.create(makeConfig({ id: 'c1', pluginId: 'brave' }));

      await registry.getHealth('c1');
      // Advance past the 60 s TTL
      vi.advanceTimersByTime(61_000);
      await registry.getHealth('c1');

      expect(provider.healthCheck).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });
  });

  // --- Search with fallback ---

  describe('search()', () => {
    it('throws when no providers are active', async () => {
      await expect(registry.search('hello')).rejects.toThrow('No search providers available');
    });

    it('uses the preferred provider when specified and available', async () => {
      const meta = makeMetadata({ id: 'brave' });
      const provider = makeSearchProvider(meta);
      const def: SearchPluginDefinition = {
        metadata: meta,
        settingsSchema: makeSettingsSchema(),
        factory: vi.fn().mockReturnValue(provider),
      };
      registry.register(def);
      registry.create(makeConfig({ id: 'c1', pluginId: 'brave' }));
      await registry.search('test', undefined, 'c1');
      expect(provider.search).toHaveBeenCalledWith('test', undefined);
    });

    it('falls back to priority order when preferred provider fails', async () => {
      const metaA = makeMetadata({ id: 'provider-a' });
      const metaB = makeMetadata({ id: 'provider-b' });

      const failingProvider = makeSearchProvider(metaA, {
        search: vi.fn().mockRejectedValue(new Error('timeout')),
      });
      const workingProvider = makeSearchProvider(metaB);

      registry.register({
        metadata: metaA,
        settingsSchema: makeSettingsSchema(),
        factory: vi.fn().mockReturnValue(failingProvider),
      });
      registry.register({
        metadata: metaB,
        settingsSchema: makeSettingsSchema(),
        factory: vi.fn().mockReturnValue(workingProvider),
      });

      registry.create(makeConfig({ id: 'ca', pluginId: 'provider-a', priority: 10 }));
      registry.create(makeConfig({ id: 'cb', pluginId: 'provider-b', priority: 5 }));

      // Preferred provider 'ca' is requested but will fail - fallback runs in priority order
      // provider-a is highest priority but throws, provider-b should succeed
      const result = await registry.search('test', undefined, 'ca');
      expect(workingProvider.search).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('skips providers that report isAvailable() = false', async () => {
      const metaA = makeMetadata({ id: 'provider-a' });
      const metaB = makeMetadata({ id: 'provider-b' });

      const unavailableProvider = makeSearchProvider(metaA, {
        isAvailable: vi.fn().mockResolvedValue(false),
      });
      const availableProvider = makeSearchProvider(metaB);

      registry.register({
        metadata: metaA,
        settingsSchema: makeSettingsSchema(),
        factory: vi.fn().mockReturnValue(unavailableProvider),
      });
      registry.register({
        metadata: metaB,
        settingsSchema: makeSettingsSchema(),
        factory: vi.fn().mockReturnValue(availableProvider),
      });

      registry.create(makeConfig({ id: 'ca', pluginId: 'provider-a', priority: 10 }));
      registry.create(makeConfig({ id: 'cb', pluginId: 'provider-b', priority: 5 }));

      await registry.search('test');
      expect(unavailableProvider.search).not.toHaveBeenCalled();
      expect(availableProvider.search).toHaveBeenCalled();
    });

    it('throws when all providers fail', async () => {
      const meta = makeMetadata({ id: 'brave' });
      const failingProvider = makeSearchProvider(meta, {
        isAvailable: vi.fn().mockResolvedValue(true),
        search: vi.fn().mockRejectedValue(new Error('all broken')),
      });
      registry.register({
        metadata: meta,
        settingsSchema: makeSettingsSchema(),
        factory: vi.fn().mockReturnValue(failingProvider),
      });
      registry.create(makeConfig({ id: 'c1', pluginId: 'brave' }));
      await expect(registry.search('test')).rejects.toThrow('All search providers failed');
    });

    it('ignores the preferred configId if it does not exist', async () => {
      const meta = makeMetadata({ id: 'brave' });
      const provider = makeSearchProvider(meta);
      registry.register({
        metadata: meta,
        settingsSchema: makeSettingsSchema(),
        factory: vi.fn().mockReturnValue(provider),
      });
      registry.create(makeConfig({ id: 'c1', pluginId: 'brave' }));
      // 'ghost' does not exist - should fall through to the active providers
      const result = await registry.search('test', undefined, 'ghost');
      expect(provider.search).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });
});

// ============================================================================
// ToolProviderRegistry
// ============================================================================

describe('ToolProviderRegistry', () => {
  let registry: ToolProviderRegistry;

  beforeEach(() => {
    registry = new ToolProviderRegistry();
  });

  // --- Registration ---

  describe('register()', () => {
    it('adds the plugin id to listRegistered()', () => {
      registry.register(makeToolDefinition(makeMetadata({ id: 'fs-tools', category: 'tool' })));
      expect(registry.listRegistered()).toContain('fs-tools');
    });

    it('overwrites an existing registration with the same id', () => {
      const def1 = makeToolDefinition(makeMetadata({ id: 'fs', name: 'FS v1', category: 'tool' }));
      const def2 = makeToolDefinition(makeMetadata({ id: 'fs', name: 'FS v2', category: 'tool' }));
      registry.register(def1);
      registry.register(def2);
      expect(registry.getMetadata('fs')?.name).toBe('FS v2');
      expect(registry.listRegistered()).toHaveLength(1);
    });
  });

  describe('unregister()', () => {
    it('removes the plugin definition and all associated instances', () => {
      const meta = makeMetadata({ id: 'fs', category: 'tool' });
      registry.register(makeToolDefinition(meta));
      registry.create(makeConfig({ id: 'c1', pluginId: 'fs' }));
      registry.unregister('fs');
      expect(registry.listRegistered()).not.toContain('fs');
      expect(registry.get('c1')).toBeUndefined();
      expect(registry.getAllConfigs()).toHaveLength(0);
    });
  });

  // --- Instance creation ---

  describe('create()', () => {
    it('returns a ToolProvider and stores it', () => {
      const meta = makeMetadata({ id: 'fs', category: 'tool' });
      registry.register(makeToolDefinition(meta));
      const instance = registry.create(makeConfig({ id: 'c1', pluginId: 'fs' }));
      expect(instance).toBeDefined();
      expect(registry.get('c1')).toBe(instance);
    });

    it('throws for an unknown pluginId', () => {
      expect(() =>
        registry.create(makeConfig({ pluginId: 'ghost' }))
      ).toThrow('Unknown tool provider plugin: ghost');
    });
  });

  describe('getActive()', () => {
    it('returns only enabled instances', () => {
      const meta = makeMetadata({ id: 'fs', category: 'tool' });
      registry.register(makeToolDefinition(meta));
      registry.create(makeConfig({ id: 'enabled', pluginId: 'fs', enabled: true }));
      registry.create(makeConfig({ id: 'disabled', pluginId: 'fs', enabled: false }));
      const active = registry.getActive();
      expect(active).toHaveLength(1);
      expect(active[0]).toBe(registry.get('enabled'));
    });
  });

  // --- getAllTools() ---

  describe('getAllTools()', () => {
    it('aggregates tools from all active providers', () => {
      const metaA = makeMetadata({ id: 'pA', category: 'tool' });
      const metaB = makeMetadata({ id: 'pB', category: 'tool' });
      registry.register(makeToolDefinition(metaA, ['tool_a', 'tool_b']));
      registry.register(makeToolDefinition(metaB, ['tool_c']));
      registry.create(makeConfig({ id: 'cA', pluginId: 'pA' }));
      registry.create(makeConfig({ id: 'cB', pluginId: 'pB' }));
      const tools = registry.getAllTools();
      expect(tools).toHaveLength(3);
      const names = tools.map((t) => t.tool.name);
      expect(names).toEqual(expect.arrayContaining(['tool_a', 'tool_b', 'tool_c']));
    });

    it('includes the provider id alongside each tool', () => {
      const meta = makeMetadata({ id: 'pA', category: 'tool' });
      registry.register(makeToolDefinition(meta, ['my_tool']));
      registry.create(makeConfig({ id: 'cA', pluginId: 'pA' }));
      const [entry] = registry.getAllTools();
      expect(entry.provider).toBe('pA');
    });

    it('excludes tools from disabled providers', () => {
      const meta = makeMetadata({ id: 'pA', category: 'tool' });
      registry.register(makeToolDefinition(meta, ['tool_a']));
      registry.create(makeConfig({ id: 'cA', pluginId: 'pA', enabled: false }));
      expect(registry.getAllTools()).toHaveLength(0);
    });
  });

  // --- execute() ---

  describe('execute()', () => {
    it('dispatches to the correct provider by tool name', async () => {
      const meta = makeMetadata({ id: 'pA', category: 'tool' });
      const provider = makeToolProvider(meta, ['run_query']);
      registry.register({
        metadata: meta,
        settingsSchema: makeSettingsSchema(),
        factory: vi.fn().mockReturnValue(provider),
      });
      registry.create(makeConfig({ id: 'cA', pluginId: 'pA' }));
      await registry.execute('run_query', { sql: 'SELECT 1' });
      expect(provider.execute).toHaveBeenCalledWith('run_query', { sql: 'SELECT 1' });
    });

    it('throws when the tool name is not found in any provider', async () => {
      const meta = makeMetadata({ id: 'pA', category: 'tool' });
      registry.register(makeToolDefinition(meta, ['known_tool']));
      registry.create(makeConfig({ id: 'cA', pluginId: 'pA' }));
      await expect(registry.execute('unknown_tool', {})).rejects.toThrow('Tool not found: unknown_tool');
    });

    it('uses the first active provider that owns the tool', async () => {
      const metaA = makeMetadata({ id: 'pA', category: 'tool' });
      const metaB = makeMetadata({ id: 'pB', category: 'tool' });
      const provA = makeToolProvider(metaA, ['shared_tool']);
      const provB = makeToolProvider(metaB, ['shared_tool']);
      registry.register({
        metadata: metaA,
        settingsSchema: makeSettingsSchema(),
        factory: vi.fn().mockReturnValue(provA),
      });
      registry.register({
        metadata: metaB,
        settingsSchema: makeSettingsSchema(),
        factory: vi.fn().mockReturnValue(provB),
      });
      registry.create(makeConfig({ id: 'cA', pluginId: 'pA' }));
      registry.create(makeConfig({ id: 'cB', pluginId: 'pB' }));
      await registry.execute('shared_tool', {});
      // Only one provider should have been called
      const totalCalls =
        (provA.execute as ReturnType<typeof vi.fn>).mock.calls.length +
        (provB.execute as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(totalCalls).toBe(1);
    });
  });

  // --- Config management ---

  describe('updateConfig()', () => {
    it('updates the config and recreates the instance', () => {
      const meta = makeMetadata({ id: 'pA', category: 'tool' });
      const def = makeToolDefinition(meta);
      registry.register(def);
      registry.create(makeConfig({ id: 'cA', pluginId: 'pA' }));
      registry.updateConfig('cA', { enabled: false });
      const updatedConfig = registry.getAllConfigs().find((c) => c.id === 'cA');
      expect(updatedConfig?.enabled).toBe(false);
      expect(def.factory).toHaveBeenCalledTimes(2);
    });
  });

  describe('deleteConfig()', () => {
    it('removes the instance and config', () => {
      const meta = makeMetadata({ id: 'pA', category: 'tool' });
      registry.register(makeToolDefinition(meta));
      registry.create(makeConfig({ id: 'cA', pluginId: 'pA' }));
      registry.deleteConfig('cA');
      expect(registry.get('cA')).toBeUndefined();
      expect(registry.getAllConfigs()).toHaveLength(0);
    });
  });

  // --- Metadata ---

  describe('getAllMetadata()', () => {
    it('returns metadata for all registered definitions', () => {
      registry.register(makeToolDefinition(makeMetadata({ id: 't1', category: 'tool' })));
      registry.register(makeToolDefinition(makeMetadata({ id: 't2', category: 'tool' })));
      expect(registry.getAllMetadata()).toHaveLength(2);
    });
  });

  describe('getSettingsSchema()', () => {
    it('returns the settings schema for a registered plugin', () => {
      const meta = makeMetadata({ id: 'pA', category: 'tool' });
      const def = makeToolDefinition(meta);
      registry.register(def);
      expect(registry.getSettingsSchema('pA')).toEqual(def.settingsSchema);
    });

    it('returns undefined for an unregistered plugin', () => {
      expect(registry.getSettingsSchema('ghost')).toBeUndefined();
    });
  });
});

// ============================================================================
// PluginManager
// ============================================================================

describe('PluginManager', () => {
  let manager: PluginManager;

  beforeEach(() => {
    manager = new PluginManager();
  });

  it('exposes a search registry', () => {
    expect(manager.search).toBeInstanceOf(SearchProviderRegistry);
  });

  it('exposes a tools registry', () => {
    expect(manager.tools).toBeInstanceOf(ToolProviderRegistry);
  });

  it('getAllPlugins() returns search plugins with category=search', () => {
    manager.search.register(makeSearchDefinition(makeMetadata({ id: 'brave', category: 'search' })));
    const all = manager.getAllPlugins();
    const searchPlugin = all.find((p) => p.id === 'brave');
    expect(searchPlugin?.category).toBe('search');
  });

  it('getAllPlugins() returns tool plugins with category=tool', () => {
    manager.tools.register(makeToolDefinition(makeMetadata({ id: 'fs', category: 'tool' })));
    const all = manager.getAllPlugins();
    const toolPlugin = all.find((p) => p.id === 'fs');
    expect(toolPlugin?.category).toBe('tool');
  });

  it('getAllPlugins() aggregates both registries', () => {
    manager.search.register(makeSearchDefinition(makeMetadata({ id: 's1', category: 'search' })));
    manager.search.register(makeSearchDefinition(makeMetadata({ id: 's2', category: 'search' })));
    manager.tools.register(makeToolDefinition(makeMetadata({ id: 't1', category: 'tool' })));
    const all = manager.getAllPlugins();
    expect(all).toHaveLength(3);
  });

  it('getAllPlugins() returns empty array when nothing is registered', () => {
    expect(manager.getAllPlugins()).toHaveLength(0);
  });

  it('initialize() resolves without throwing', async () => {
    await expect(manager.initialize()).resolves.toBeUndefined();
  });
});

// ============================================================================
// getPluginManager() singleton
// ============================================================================

describe('getPluginManager()', () => {
  // We reset the module-level singleton between tests by re-importing the module
  // under test. Since vitest caches modules, we rely on the documented singleton
  // behavior: the first call creates, subsequent calls return the same object.

  it('returns a PluginManager instance', () => {
    const pm = getPluginManager();
    expect(pm).toBeInstanceOf(PluginManager);
  });

  it('returns the same instance on repeated calls', () => {
    const pm1 = getPluginManager();
    const pm2 = getPluginManager();
    expect(pm1).toBe(pm2);
  });

  it('exposes search and tools registries', () => {
    const pm = getPluginManager();
    expect(pm.search).toBeInstanceOf(SearchProviderRegistry);
    expect(pm.tools).toBeInstanceOf(ToolProviderRegistry);
  });
});
