/**
 * Browser Automation Module
 *
 * Playwright-based browser automation for profClaw AI agents.
 *
 * @example
 * ```typescript
 * import { getBrowserService } from './browser/index.js';
 *
 * const browser = getBrowserService();
 *
 * // Navigate to a page
 * const { pageId } = await browser.navigate('https://example.com');
 *
 * // Get accessibility snapshot
 * const snapshot = await browser.snapshot({ pageId });
 *
 * // Click an element
 * await browser.click({ ref: 'e3', pageId });
 *
 * // Type into an input
 * await browser.type({ ref: 'e5', text: 'Hello', pageId });
 *
 * // Search for elements
 * const results = await browser.search({ pattern: 'Submit', pageId });
 * ```
 */

// Types
export type {
  BrowserPage,
  ElementRef,
  SnapshotNode,
  PageSnapshot,
  SearchResult,
  SearchResponse,
  NavigateOptions,
  NavigateResult,
  SnapshotOptions,
  ClickOptions,
  ClickResult,
  TypeOptions,
  TypeResult,
  ContentSearchOptions,
  ScreenshotOptions,
  ScreenshotResult,
  BrowserConfig,
} from './types.js';

export { BrowserError } from './types.js';

// Service
export {
  BrowserService,
  getBrowserService,
  resetBrowserService,
  formatSnapshotResponse,
  formatSearchResponse,
} from './service.js';

// Ref tracking
export {
  RefTracker,
  getRefTracker,
  resetRefTracker,
  clearAllTrackers,
} from './refs.js';

// Snapshot
export { captureSnapshot } from './snapshot.js';

// Search
export {
  searchSnapshot,
  searchByRole,
  findInteractiveElements,
  commonPatterns,
} from './search.js';

// Compression
export {
  compressTree,
  treeToYaml,
  getCompressionStats,
} from './compression.js';

// Tools (Single Source of Truth)
export {
  BROWSER_TOOLS,
  BROWSER_TOOL_NAMES,
  SAFE_BROWSER_TOOLS,
  SAFE_BROWSER_TOOL_NAMES,
  type BrowserToolDefinition,
  type BrowserToolResult,
} from './tools.js';

// Adapters (MCP + Chat Execution)
export {
  MCP_BROWSER_TOOLS,
  handleMCPBrowserTool,
  CHAT_BROWSER_TOOLS,
  getChatBrowserTool,
} from './adapters.js';
