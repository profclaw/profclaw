/**
 * MCP Browser Tools
 *
 * Browser automation tools for the profClaw MCP server.
 * Uses centralized definitions from src/browser/tools.ts
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { MCP_BROWSER_TOOLS, handleMCPBrowserTool } from '../browser/index.js';

// Re-export MCP tool definitions for server registration
export const BROWSER_TOOLS = MCP_BROWSER_TOOLS;

// Re-export handler for tool execution
export const handleBrowserTool = handleMCPBrowserTool;

// Type guard to check if a tool name is a browser tool
export function isBrowserTool(name: string): boolean {
  return name.startsWith('profclaw__browser_');
}
