/**
 * profClaw Plugin SDK
 *
 * Unified plugin interface for third-party developers.
 * Plugins can provide: tools, search providers, chat channels, skills.
 *
 * Usage:
 *   import { definePlugin } from 'profclaw/plugins/sdk';
 *
 *   export default definePlugin({
 *     id: 'my-plugin',
 *     name: 'My Plugin',
 *     version: '1.0.0',
 *     tools: [...],
 *   });
 */

import type {
  PluginMetadata,
  ToolDefinition,
  ToolResult,
  SearchProvider,
  PluginConfig,
  PluginHealth,
  PluginSettingsSchema,
} from './types.js';

// =============================================================================
// PLUGIN INTERFACE
// =============================================================================

export interface ProfClawPlugin {
  /** Plugin metadata */
  metadata: PluginMetadata;

  /** Settings schema for UI generation */
  settingsSchema?: PluginSettingsSchema;

  /** Tool definitions (for AI function calling) */
  tools?: PluginToolDefinition[];

  /** Search provider factory */
  searchProvider?: (config: PluginConfig) => SearchProvider;

  /** Skill definitions (SKILL.md content as strings) */
  skills?: PluginSkillDefinition[];

  /** Lifecycle hooks */
  onLoad?(config: PluginConfig): Promise<void>;
  onUnload?(): Promise<void>;
  healthCheck?(): Promise<PluginHealth>;
}

export interface PluginToolDefinition {
  name: string;
  description: string;
  category?: string;
  parameters: Record<string, {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    description: string;
    required?: boolean;
    enum?: string[];
    default?: unknown;
  }>;
  execute(params: Record<string, unknown>): Promise<ToolResult>;
}

export interface PluginSkillDefinition {
  name: string;
  description: string;
  content: string; // SKILL.md content
}

// =============================================================================
// PLUGIN MANIFEST
// =============================================================================

/** package.json fields for profClaw plugins */
export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  profclaw?: {
    /** Plugin entry point (default: index.js) */
    main?: string;
    /** Plugin category */
    category?: 'tool' | 'search' | 'integration' | 'model';
    /** Minimum profClaw version */
    minVersion?: string;
    /** Required capabilities */
    capabilities?: string[];
  };
}

// =============================================================================
// HELPER: definePlugin
// =============================================================================

/**
 * Type-safe plugin definition helper.
 * Third-party devs use this to create plugins:
 *
 * ```ts
 * export default definePlugin({
 *   metadata: { id: 'my-plugin', name: 'My Plugin', ... },
 *   tools: [{ name: 'my-tool', ... }],
 * });
 * ```
 */
export function definePlugin(plugin: ProfClawPlugin): ProfClawPlugin {
  return plugin;
}
