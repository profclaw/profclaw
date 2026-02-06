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
  skills?: Array<{ id: string; name: string }>;
  searchProvider?: unknown;
  activate?(): Promise<void>;
  deactivate?(): Promise<void>;
}
