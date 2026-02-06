/**
 * Browser Automation Tools (Chat Execution)
 *
 * Browser tools for chat agents.
 * Uses centralized definitions from src/browser/tools.ts
 */

import { CHAT_BROWSER_TOOLS, SAFE_BROWSER_TOOL_NAMES } from '../../../browser/index.js';

// Re-export chat tool definitions for registry
export const browserTools = CHAT_BROWSER_TOOLS;

// Individual tool exports for direct imports
export const [
  browserNavigateTool,
  browserSnapshotTool,
  browserClickTool,
  browserTypeTool,
  browserSearchTool,
  browserScreenshotTool,
  browserPagesTool,
  browserCloseTool,
] = CHAT_BROWSER_TOOLS;

// Re-export safe tool names for default chat tools
export { SAFE_BROWSER_TOOL_NAMES };

// Re-export result types from canonical source
export type {
  NavigateResult as BrowserNavigateResult,
  SnapshotResult as BrowserSnapshotResult,
  ClickResult as BrowserClickResult,
  TypeResult as BrowserTypeResult,
  SearchResult as BrowserSearchResult,
  ScreenshotResult as BrowserScreenshotResult,
  PagesResult as BrowserPagesResult,
  CloseResult as BrowserCloseResult,
} from '../../../browser/tools.js';
