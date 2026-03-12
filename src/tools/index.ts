/**
 * Unified Tool System
 *
 * Single source of truth for all profClaw tools.
 *
 * Usage:
 * ```typescript
 * import { getAllTools, getMCPTools, getChatTools } from './tools/index.js';
 *
 * // Get all tools
 * const tools = getAllTools();
 *
 * // Get MCP schemas (with profclaw__ prefix)
 * const mcpTools = getMCPTools();
 *
 * // Get chat execution tools
 * const chatTools = getChatTools();
 *
 * // Handle MCP tool call
 * const result = await handleMCPToolCall('profclaw__browser_navigate', { url: '...' });
 * ```
 */

// Types
export type {
  ToolDefinition,
  ToolResult,
  ToolExample,
  ToolCategory,
  SecurityLevel,
  ToolCollection,
  MCPToolSchema,
  AIToolSchema,
} from './types.js';

export { createToolCollection } from './types.js';

// Adapters
export {
  toMCPSchema,
  toMCPResult,
  createMCPHandler,
  toChatTool,
  toChatTools,
  toAISchema,
  toAISchemas,
  filterSafeTools,
  filterByCategory,
  getToolNames,
  findTool,
} from './adapters.js';

// =============================================================================
// Tool Imports (add new tool categories here)
// =============================================================================

import { BROWSER_TOOLS } from '../browser/tools.js';
import type { ToolDefinition, MCPToolSchema } from './types.js';
import type { ToolDefinition as ChatToolDefinition } from '../chat/execution/types.js';
import {
  toMCPSchema,
  toChatTools,
  createMCPHandler,
  filterSafeTools,
  getToolNames,
} from './adapters.js';

// =============================================================================
// Tool Registry
// =============================================================================

/**
 * All registered tools (single source of truth)
 */
const ALL_TOOLS: ToolDefinition[] = [
  // Browser automation tools
  ...(BROWSER_TOOLS as unknown as ToolDefinition[]),

  // TODO: Add more tool categories here as they're migrated:
  // ...FILESYSTEM_TOOLS,
  // ...GIT_TOOLS,
  // ...SYSTEM_TOOLS,
  // ...WEB_TOOLS,
];

// =============================================================================
// Getters
// =============================================================================

/**
 * Get all registered tools
 */
export function getAllTools(): ToolDefinition[] {
  return ALL_TOOLS;
}

/**
 * Get safe tools only (for default chat)
 */
export function getSafeTools(): ToolDefinition[] {
  return filterSafeTools(ALL_TOOLS);
}

/**
 * Get all tool names
 */
export function getAllToolNames(): string[] {
  return getToolNames(ALL_TOOLS);
}

/**
 * Get safe tool names
 */
export function getSafeToolNames(): string[] {
  return getToolNames(filterSafeTools(ALL_TOOLS));
}

// =============================================================================
// MCP Integration
// =============================================================================

const MCP_PREFIX = 'profclaw__';

/**
 * Get MCP tool schemas (with profclaw__ prefix)
 */
export function getMCPTools(): MCPToolSchema[] {
  return ALL_TOOLS.map((t) => toMCPSchema(t, MCP_PREFIX));
}

/**
 * Handle MCP tool call
 */
export const handleMCPToolCall = createMCPHandler(ALL_TOOLS, MCP_PREFIX);

/**
 * Check if a name is an MCP tool
 */
export function isMCPTool(name: string): boolean {
  if (!name.startsWith(MCP_PREFIX)) return false;
  const toolName = name.slice(MCP_PREFIX.length);
  return ALL_TOOLS.some((t) => t.name === toolName);
}

// =============================================================================
// Chat Execution Integration
// =============================================================================

/**
 * Get chat execution tools
 */
export function getChatTools(): ChatToolDefinition[] {
  return toChatTools(ALL_TOOLS);
}

/**
 * Get safe chat tools (for default mode)
 */
export function getSafeChatTools(): ChatToolDefinition[] {
  return toChatTools(filterSafeTools(ALL_TOOLS));
}

// =============================================================================
// Category-specific exports (for targeted imports)
// =============================================================================

export { BROWSER_TOOLS } from '../browser/tools.js';

// Re-export browser-specific items for backwards compatibility
export {
  BROWSER_TOOL_NAMES,
  SAFE_BROWSER_TOOL_NAMES,
} from '../browser/tools.js';
