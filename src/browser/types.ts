/**
 * Browser Automation Types
 *
 * TypeScript types for profClaw's Playwright-based browser automation.
 */

export interface BrowserPage {
  id: string;
  url: string;
  title: string;
  createdAt: Date;
}

export interface ElementRef {
  ref: string;        // e.g., "e1", "e2"
  role: string;       // ARIA role
  name: string;       // Accessible name
  selector: string;   // CSS selector or locator
  attributes?: Record<string, string>;
}

export interface SnapshotNode {
  role: string;
  name?: string;
  ref: string;
  children?: SnapshotNode[];
  value?: string;
  checked?: boolean;
  selected?: boolean;
  disabled?: boolean;
  required?: boolean;
  focused?: boolean;
  expanded?: boolean;
  level?: number;
  // For compression tracking
  similarCount?: number;
  similarRefs?: string[];
}

export interface PageSnapshot {
  pageId: string;
  url: string;
  title: string;
  snapshot: string;     // YAML representation
  tree: SnapshotNode;   // Parsed tree
  refs: Map<string, ElementRef>;
  compressed: boolean;
  totalElements: number;
  compressedElements: number;
}

export interface SearchResult {
  ref: string;
  role: string;
  name: string;
  text: string;
  lineNumber: number;
}

export interface SearchResponse {
  pattern: string;
  results: SearchResult[];
  matchCount: number;
  truncated: boolean;
}

// Navigation options
export interface NavigateOptions {
  pageId?: string;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  timeout?: number;
}

export interface NavigateResult {
  pageId: string;
  url: string;
  title: string;
  created: boolean;
}

// Snapshot options
export interface SnapshotOptions {
  pageId?: string;
  compress?: boolean;
  interactive?: boolean;
  selector?: string;
  maxChars?: number;
}

// Click options
export interface ClickOptions {
  pageId?: string;
  ref: string;
  element?: string;
  button?: 'left' | 'right' | 'middle';
  doubleClick?: boolean;
  modifiers?: ('Alt' | 'Control' | 'Meta' | 'Shift')[];
}

export interface ClickResult {
  ref: string;
  element?: string;
  executed: string;  // Playwright code executed
}

// Type options
export interface TypeOptions {
  pageId?: string;
  ref: string;
  text: string;
  clear?: boolean;
  submit?: boolean;
  delay?: number;
}

export interface TypeResult {
  ref: string;
  text: string;
  executed: string;
}

// Search options
export interface ContentSearchOptions {
  pageId?: string;
  pattern: string;
  ignoreCase?: boolean;
  limit?: number;
}

// Screenshot options
export interface ScreenshotOptions {
  pageId?: string;
  fullPage?: boolean;
  ref?: string;
  type?: 'png' | 'jpeg';
  quality?: number;
}

export interface ScreenshotResult {
  pageId: string;
  path?: string;
  base64: string;
  mimeType: string;
}

// Browser configuration
export interface BrowserConfig {
  headless: boolean;
  timeout: number;
  maxPages: number;
  executablePath?: string;
  userDataDir?: string;
}

// Error types
export class BrowserError extends Error {
  constructor(
    message: string,
    public code: 'NOT_STARTED' | 'PAGE_NOT_FOUND' | 'ELEMENT_NOT_FOUND' | 'TIMEOUT' | 'NAVIGATION_FAILED' | 'UNKNOWN',
    public details?: unknown
  ) {
    super(message);
    this.name = 'BrowserError';
  }
}
