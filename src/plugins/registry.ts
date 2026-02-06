/**
 * GLINR Plugin Registry
 *
 * Manages plugin registration, instantiation, and health monitoring.
 */

import type {
  PluginConfig,
  PluginHealth,
  PluginMetadata,
  SearchProvider,
  SearchProviderFactory,
  SearchPluginDefinition,
  ToolProvider,
  ToolProviderFactory,
  ToolPluginDefinition,
  PluginSettingsSchema,
} from './types.js';

// ============================================================================
// Search Provider Registry
// ============================================================================

class SearchProviderRegistry {
  private definitions = new Map<string, SearchPluginDefinition>();
  private instances = new Map<string, SearchProvider>();
  private configs = new Map<string, PluginConfig>();
  private healthCache = new Map<string, { health: PluginHealth; timestamp: number }>();
  private readonly HEALTH_CACHE_TTL = 60_000; // 1 minute

  /**
   * Register a search provider plugin
   */
  register(definition: SearchPluginDefinition): void {
    this.definitions.set(definition.metadata.id, definition);
    console.log(`[Plugins] Registered search provider: ${definition.metadata.name}`);
  }

  /**
   * Unregister a search provider
   */
  unregister(pluginId: string): void {
    this.definitions.delete(pluginId);
    // Remove any instances using this plugin
    for (const [configId, config] of this.configs) {
      if (config.pluginId === pluginId) {
        this.instances.delete(configId);
        this.configs.delete(configId);
      }
    }
  }

  /**
   * Create a provider instance from config
   */
  create(config: PluginConfig): SearchProvider {
    const definition = this.definitions.get(config.pluginId);
    if (!definition) {
      throw new Error(`Unknown search provider plugin: ${config.pluginId}`);
    }

    const instance = definition.factory(config);
    this.instances.set(config.id, instance);
    this.configs.set(config.id, config);

    return instance;
  }

  /**
   * Get provider by config ID
   */
  get(configId: string): SearchProvider | undefined {
    return this.instances.get(configId);
  }

  /**
   * Get all active (enabled) providers
   */
  getActive(): SearchProvider[] {
    const active: SearchProvider[] = [];
    for (const [configId, config] of this.configs) {
      if (config.enabled) {
        const instance = this.instances.get(configId);
        if (instance) active.push(instance);
      }
    }
    // Sort by priority (higher first)
    return active.sort((a, b) => {
      const configA = this.getConfigByInstance(a);
      const configB = this.getConfigByInstance(b);
      return (configB?.priority || 0) - (configA?.priority || 0);
    });
  }

  /**
   * Get primary (highest priority enabled) provider
   */
  getPrimary(): SearchProvider | undefined {
    const active = this.getActive();
    return active[0];
  }

  /**
   * List all registered plugin IDs
   */
  listRegistered(): string[] {
    return Array.from(this.definitions.keys());
  }

  /**
   * Get plugin metadata
   */
  getMetadata(pluginId: string): PluginMetadata | undefined {
    return this.definitions.get(pluginId)?.metadata;
  }

  /**
   * Get all plugin metadata
   */
  getAllMetadata(): PluginMetadata[] {
    return Array.from(this.definitions.values()).map((d) => d.metadata);
  }

  /**
   * Get settings schema for a plugin
   */
  getSettingsSchema(pluginId: string): PluginSettingsSchema | undefined {
    return this.definitions.get(pluginId)?.settingsSchema;
  }

  /**
   * Get config by instance
   */
  private getConfigByInstance(instance: SearchProvider): PluginConfig | undefined {
    for (const [configId, inst] of this.instances) {
      if (inst === instance) {
        return this.configs.get(configId);
      }
    }
    return undefined;
  }

  /**
   * Get all configs
   */
  getAllConfigs(): PluginConfig[] {
    return Array.from(this.configs.values());
  }

  /**
   * Update config
   */
  updateConfig(configId: string, updates: Partial<PluginConfig>): void {
    const config = this.configs.get(configId);
    if (config) {
      const newConfig = { ...config, ...updates };
      this.configs.set(configId, newConfig);

      // Recreate instance with new config
      const definition = this.definitions.get(config.pluginId);
      if (definition) {
        const instance = definition.factory(newConfig);
        this.instances.set(configId, instance);
      }
    }
  }

  /**
   * Delete config and instance
   */
  deleteConfig(configId: string): void {
    this.instances.delete(configId);
    this.configs.delete(configId);
    this.healthCache.delete(configId);
  }

  /**
   * Get health status (cached)
   */
  async getHealth(configId: string): Promise<PluginHealth> {
    const cached = this.healthCache.get(configId);
    const now = Date.now();

    if (cached && now - cached.timestamp < this.HEALTH_CACHE_TTL) {
      return cached.health;
    }

    const instance = this.instances.get(configId);
    if (!instance) {
      return {
        healthy: false,
        lastCheck: new Date(),
        errorMessage: 'Provider not initialized',
      };
    }

    try {
      const health = await instance.healthCheck();
      this.healthCache.set(configId, { health, timestamp: now });
      return health;
    } catch (error) {
      const health: PluginHealth = {
        healthy: false,
        lastCheck: new Date(),
        errorMessage: error instanceof Error ? error.message : 'Health check failed',
      };
      this.healthCache.set(configId, { health, timestamp: now });
      return health;
    }
  }

  /**
   * Search with automatic fallback
   */
  async search(
    query: string,
    options?: Parameters<SearchProvider['search']>[1],
    preferredProvider?: string
  ): Promise<ReturnType<SearchProvider['search']>> {
    const providers = this.getActive();

    if (providers.length === 0) {
      throw new Error('No search providers available');
    }

    // Try preferred provider first
    if (preferredProvider) {
      const preferred = this.get(preferredProvider);
      if (preferred) {
        try {
          return await preferred.search(query, options);
        } catch (error) {
          console.warn(
            `[Plugins] Preferred provider ${preferredProvider} failed, falling back:`,
            error
          );
        }
      }
    }

    // Try providers in priority order
    for (const provider of providers) {
      try {
        const isAvailable = await provider.isAvailable();
        if (!isAvailable) continue;

        return await provider.search(query, options);
      } catch (error) {
        console.warn(
          `[Plugins] Provider ${provider.metadata.id} failed:`,
          error
        );
        continue;
      }
    }

    throw new Error('All search providers failed');
  }
}

// ============================================================================
// Tool Provider Registry
// ============================================================================

class ToolProviderRegistry {
  private definitions = new Map<string, ToolPluginDefinition>();
  private instances = new Map<string, ToolProvider>();
  private configs = new Map<string, PluginConfig>();

  register(definition: ToolPluginDefinition): void {
    this.definitions.set(definition.metadata.id, definition);
    console.log(`[Plugins] Registered tool provider: ${definition.metadata.name}`);
  }

  unregister(pluginId: string): void {
    this.definitions.delete(pluginId);
    for (const [configId, config] of this.configs) {
      if (config.pluginId === pluginId) {
        this.instances.delete(configId);
        this.configs.delete(configId);
      }
    }
  }

  create(config: PluginConfig): ToolProvider {
    const definition = this.definitions.get(config.pluginId);
    if (!definition) {
      throw new Error(`Unknown tool provider plugin: ${config.pluginId}`);
    }

    const instance = definition.factory(config);
    this.instances.set(config.id, instance);
    this.configs.set(config.id, config);

    return instance;
  }

  get(configId: string): ToolProvider | undefined {
    return this.instances.get(configId);
  }

  getActive(): ToolProvider[] {
    const active: ToolProvider[] = [];
    for (const [configId, config] of this.configs) {
      if (config.enabled) {
        const instance = this.instances.get(configId);
        if (instance) active.push(instance);
      }
    }
    return active;
  }

  listRegistered(): string[] {
    return Array.from(this.definitions.keys());
  }

  getMetadata(pluginId: string): PluginMetadata | undefined {
    return this.definitions.get(pluginId)?.metadata;
  }

  getAllMetadata(): PluginMetadata[] {
    return Array.from(this.definitions.values()).map((d) => d.metadata);
  }

  getSettingsSchema(pluginId: string): PluginSettingsSchema | undefined {
    return this.definitions.get(pluginId)?.settingsSchema;
  }

  getAllConfigs(): PluginConfig[] {
    return Array.from(this.configs.values());
  }

  updateConfig(configId: string, updates: Partial<PluginConfig>): void {
    const config = this.configs.get(configId);
    if (config) {
      const newConfig = { ...config, ...updates };
      this.configs.set(configId, newConfig);

      const definition = this.definitions.get(config.pluginId);
      if (definition) {
        const instance = definition.factory(newConfig);
        this.instances.set(configId, instance);
      }
    }
  }

  deleteConfig(configId: string): void {
    this.instances.delete(configId);
    this.configs.delete(configId);
  }

  /**
   * Get all available tools across all providers
   */
  getAllTools(): Array<{
    provider: string;
    tool: ToolProvider['tools'][0];
  }> {
    const tools: Array<{ provider: string; tool: ToolProvider['tools'][0] }> = [];
    for (const provider of this.getActive()) {
      for (const tool of provider.tools) {
        tools.push({ provider: provider.metadata.id, tool });
      }
    }
    return tools;
  }

  /**
   * Execute a tool by name
   */
  async execute(
    toolName: string,
    params: Record<string, unknown>
  ): Promise<ReturnType<ToolProvider['execute']>> {
    for (const provider of this.getActive()) {
      const tool = provider.tools.find((t) => t.name === toolName);
      if (tool) {
        return provider.execute(toolName, params);
      }
    }
    throw new Error(`Tool not found: ${toolName}`);
  }
}

// ============================================================================
// Global Plugin Manager
// ============================================================================

class PluginManager {
  readonly search = new SearchProviderRegistry();
  readonly tools = new ToolProviderRegistry();

  /**
   * Initialize built-in plugins
   */
  async initialize(): Promise<void> {
    // Built-in plugins will be registered here
    // Import and register each plugin definition
    console.log('[Plugins] Plugin manager initialized');
  }

  /**
   * Get all plugin metadata across categories
   */
  getAllPlugins(): Array<PluginMetadata & { category: 'search' | 'tool' }> {
    const plugins: Array<PluginMetadata & { category: 'search' | 'tool' }> = [];

    for (const meta of this.search.getAllMetadata()) {
      plugins.push({ ...meta, category: 'search' });
    }

    for (const meta of this.tools.getAllMetadata()) {
      plugins.push({ ...meta, category: 'tool' });
    }

    return plugins;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let manager: PluginManager | null = null;

export function getPluginManager(): PluginManager {
  if (!manager) {
    manager = new PluginManager();
  }
  return manager;
}

export { SearchProviderRegistry, ToolProviderRegistry, PluginManager };
