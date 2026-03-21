/**
 * Plugin SDK
 *
 * Public types and interfaces for building profClaw plugins.
 * Third-party plugins implement ProfClawPlugin to extend the system.
 */

import type { ToolDefinition } from '../chat/execution/types.js';

// =============================================================================
// Plugin Metadata
// =============================================================================

export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
}

// =============================================================================
// Plugin Manifest (package.json extension)
// =============================================================================

export interface PluginManifest {
  name?: string;
  version?: string;
  profclaw?: {
    main?: string;
    capabilities?: string[];
  };
}

// =============================================================================
// Plugin Interface
// =============================================================================

export interface ProfClawPlugin {
  metadata: PluginMetadata;
  tools?: ToolDefinition[];
  skills?: Array<{ id: string; name: string; description?: string }>;
  searchProvider?: unknown;
  activate?(): Promise<void>;
  deactivate?(): Promise<void>;

  /** Middleware hooks for intercepting tool execution */
  hooks?: {
    beforeToolExec?: (toolName: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
    afterToolExec?: (toolName: string, result: unknown) => Promise<unknown>;
    beforePrompt?: (prompt: string) => Promise<string>;
  };
}

/**
 * Helper for plugin authors to define a plugin with type safety.
 *
 * @example
 * ```ts
 * import { definePlugin } from '@profclaw/sdk';
 *
 * export default definePlugin({
 *   metadata: { id: 'my-plugin', name: 'My Plugin', version: '1.0.0' },
 *   tools: [myCustomTool],
 *   activate: async () => console.log('Plugin loaded!'),
 * });
 * ```
 */
export function definePlugin(plugin: ProfClawPlugin): ProfClawPlugin {
  return plugin;
}
