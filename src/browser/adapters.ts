/**
 * Browser Tools Adapters
 *
 * Uses unified adapter system from src/tools/adapters.ts
 * This file provides browser-specific exports for backwards compatibility.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolDefinition as ChatToolDefinition } from '../chat/execution/types.js';
import {
  toMCPSchema,
  toChatTools,
  createMCPHandler,
} from '../tools/adapters.js';
import { BROWSER_TOOLS } from './tools.js';
import type { ToolDefinition } from '../tools/types.js';

// =============================================================================
// MCP Adapter (browser-specific)
// =============================================================================

const MCP_PREFIX = 'profclaw__';

/**
 * MCP tool definitions for browser tools (with profclaw__ prefix)
 */
export const MCP_BROWSER_TOOLS = (BROWSER_TOOLS as unknown as ToolDefinition[]).map(
  (t) => toMCPSchema(t, MCP_PREFIX)
);

/**
 * Handle MCP browser tool call
 */
export const handleMCPBrowserTool = createMCPHandler(
  BROWSER_TOOLS as unknown as ToolDefinition[],
  MCP_PREFIX
);

// =============================================================================
// Chat Execution Adapter (browser-specific)
// =============================================================================

/**
 * Chat execution tool definitions for browser tools
 */
export const CHAT_BROWSER_TOOLS: ChatToolDefinition[] = toChatTools(
  BROWSER_TOOLS as unknown as ToolDefinition[]
);

/**
 * Get chat browser tool by name
 */
export function getChatBrowserTool(name: string): ChatToolDefinition | undefined {
  return CHAT_BROWSER_TOOLS.find((t) => t.name === name);
}

// =============================================================================
// Re-exports for backwards compatibility
// =============================================================================

export { BROWSER_TOOLS, SAFE_BROWSER_TOOL_NAMES } from './tools.js';
