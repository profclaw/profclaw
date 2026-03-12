/**
 * Browser Service
 *
 * Core Playwright browser management for profClaw.
 * Handles browser lifecycle, page management, and element interaction.
 */

import { chromium, type Browser, type Page, type BrowserContext } from 'playwright-core';
import type {
  BrowserPage,
  BrowserConfig,
  BrowserError,
  NavigateOptions,
  NavigateResult,
  SnapshotOptions,
  PageSnapshot,
  ClickOptions,
  ClickResult,
  TypeOptions,
  TypeResult,
  ContentSearchOptions,
  SearchResponse,
  ScreenshotOptions,
  ScreenshotResult,
} from './types.js';
import { captureSnapshot, formatSnapshotResponse } from './snapshot.js';
import { searchSnapshot, formatSearchResponse } from './search.js';
import { getRefTracker, resetRefTracker, clearAllTrackers } from './refs.js';

// Default configuration
const DEFAULT_CONFIG: BrowserConfig = {
  headless: process.env.BROWSER_HEADLESS !== 'false',
  timeout: parseInt(process.env.BROWSER_TIMEOUT_MS || '30000', 10),
  maxPages: parseInt(process.env.BROWSER_MAX_PAGES || '5', 10),
  executablePath: process.env.BROWSER_EXECUTABLE || undefined,
};

/**
 * Browser Service singleton
 */
class BrowserService {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pages: Map<string, Page> = new Map();
  private pageInfo: Map<string, BrowserPage> = new Map();
  private config: BrowserConfig;
  private snapshotCache: Map<string, PageSnapshot> = new Map();
  private pageCounter = 0;

  constructor(config: Partial<BrowserConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Launch browser if not already running
   */
  async ensureBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      console.log('[Browser] Launching browser...');

      this.browser = await chromium.launch({
        headless: this.config.headless,
        executablePath: this.config.executablePath,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--no-sandbox',
        ],
      });

      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });

      console.log('[Browser] Browser launched');
    }

    return this.browser;
  }

  /**
   * Get or create a page
   */
  async getPage(pageId?: string): Promise<{ page: Page; pageId: string; created: boolean }> {
    await this.ensureBrowser();

    // If pageId provided, try to get existing page
    if (pageId) {
      const existingPage = this.pages.get(pageId);
      if (existingPage && !existingPage.isClosed()) {
        return { page: existingPage, pageId, created: false };
      }
    }

    // Check max pages limit
    if (this.pages.size >= this.config.maxPages) {
      // Close oldest page
      const oldestId = Array.from(this.pageInfo.entries())
        .sort((a, b) => a[1].createdAt.getTime() - b[1].createdAt.getTime())[0][0];
      await this.closePage(oldestId);
    }

    // Create new page
    const newPageId = pageId || `page-${++this.pageCounter}`;
    const page = await this.context!.newPage();

    this.pages.set(newPageId, page);
    this.pageInfo.set(newPageId, {
      id: newPageId,
      url: 'about:blank',
      title: '',
      createdAt: new Date(),
    });

    // Set up page event handlers
    page.on('close', () => {
      this.pages.delete(newPageId);
      this.pageInfo.delete(newPageId);
      this.snapshotCache.delete(newPageId);
      resetRefTracker(newPageId);
    });

    return { page, pageId: newPageId, created: true };
  }

  /**
   * Navigate to a URL
   */
  async navigate(url: string, options: NavigateOptions = {}): Promise<NavigateResult> {
    const { page, pageId, created } = await this.getPage(options.pageId);

    await page.goto(url, {
      waitUntil: options.waitUntil || 'domcontentloaded',
      timeout: options.timeout || this.config.timeout,
    });

    // Update page info
    const title = await page.title();
    this.pageInfo.set(pageId, {
      id: pageId,
      url: page.url(),
      title,
      createdAt: this.pageInfo.get(pageId)?.createdAt || new Date(),
    });

    // Clear snapshot cache
    this.snapshotCache.delete(pageId);

    return {
      pageId,
      url: page.url(),
      title,
      created,
    };
  }

  /**
   * Capture page snapshot
   */
  async snapshot(options: SnapshotOptions = {}): Promise<PageSnapshot> {
    const { page, pageId } = await this.getPage(options.pageId);

    // Capture snapshot
    const snapshot = await captureSnapshot(page, pageId, options);

    // Cache for ref lookups
    this.snapshotCache.set(pageId, snapshot);

    return snapshot;
  }

  /**
   * Click an element by ref
   */
  async click(options: ClickOptions): Promise<ClickResult> {
    const { page, pageId } = await this.getPage(options.pageId);
    const refTracker = getRefTracker(pageId);
    const element = refTracker.getRef(options.ref);

    if (!element) {
      const error = new Error(`Element ref not found: ${options.ref}`) as BrowserError;
      error.code = 'ELEMENT_NOT_FOUND';
      throw error;
    }

    // Build locator
    const locatorCode = refTracker.buildLocatorCode(options.ref);
    if (!locatorCode) {
      const error = new Error(`Could not build locator for ref: ${options.ref}`) as BrowserError;
      error.code = 'ELEMENT_NOT_FOUND';
      throw error;
    }

    // Get locator based on role and name
    const locator = page.getByRole(element.role as Parameters<typeof page.getByRole>[0], {
      name: element.name,
    });

    // Execute click
    const clickOptions: Parameters<typeof locator.click>[0] = {};
    if (options.button) clickOptions.button = options.button;
    if (options.modifiers) clickOptions.modifiers = options.modifiers;

    if (options.doubleClick) {
      await locator.dblclick(clickOptions);
    } else {
      await locator.click(clickOptions);
    }

    // Clear snapshot cache (page state changed)
    this.snapshotCache.delete(pageId);

    return {
      ref: options.ref,
      element: options.element,
      executed: options.doubleClick
        ? `await ${locatorCode}.dblclick()`
        : `await ${locatorCode}.click()`,
    };
  }

  /**
   * Type text into an element
   */
  async type(options: TypeOptions): Promise<TypeResult> {
    const { page, pageId } = await this.getPage(options.pageId);
    const refTracker = getRefTracker(pageId);
    const element = refTracker.getRef(options.ref);

    if (!element) {
      const error = new Error(`Element ref not found: ${options.ref}`) as BrowserError;
      error.code = 'ELEMENT_NOT_FOUND';
      throw error;
    }

    const locatorCode = refTracker.buildLocatorCode(options.ref);
    if (!locatorCode) {
      const error = new Error(`Could not build locator for ref: ${options.ref}`) as BrowserError;
      error.code = 'ELEMENT_NOT_FOUND';
      throw error;
    }

    // Get locator
    const locator = page.getByRole(element.role as Parameters<typeof page.getByRole>[0], {
      name: element.name,
    });

    // Clear if requested
    if (options.clear) {
      await locator.clear();
    }

    // Type text
    await locator.fill(options.text);

    // Submit if requested
    if (options.submit) {
      await locator.press('Enter');
    }

    // Clear snapshot cache
    this.snapshotCache.delete(pageId);

    let executed = `await ${locatorCode}.fill('${options.text.replace(/'/g, "\\'")}')`;
    if (options.submit) {
      executed += `\nawait ${locatorCode}.press('Enter')`;
    }

    return {
      ref: options.ref,
      text: options.text,
      executed,
    };
  }

  /**
   * Search page content
   */
  async search(options: ContentSearchOptions): Promise<SearchResponse> {
    const pageId = options.pageId || 'page-1';

    // Get cached snapshot or capture new one
    let snapshot = this.snapshotCache.get(pageId);
    if (!snapshot) {
      snapshot = await this.snapshot({ pageId });
    }

    return searchSnapshot(snapshot.tree, options);
  }

  /**
   * Take screenshot
   */
  async screenshot(options: ScreenshotOptions = {}): Promise<ScreenshotResult> {
    const { page, pageId } = await this.getPage(options.pageId);

    const screenshotOptions: Parameters<typeof page.screenshot>[0] = {
      type: options.type || 'png',
      fullPage: options.fullPage || false,
    };

    // Screenshot specific element if ref provided
    if (options.ref) {
      const refTracker = getRefTracker(pageId);
      const element = refTracker.getRef(options.ref);

      if (!element) {
        const error = new Error(`Element ref not found: ${options.ref}`) as BrowserError;
        error.code = 'ELEMENT_NOT_FOUND';
        throw error;
      }

      const locator = page.getByRole(element.role as Parameters<typeof page.getByRole>[0], {
        name: element.name,
      });

      const buffer = await locator.screenshot(screenshotOptions);
      const base64 = buffer.toString('base64');

      return {
        pageId,
        base64,
        mimeType: options.type === 'jpeg' ? 'image/jpeg' : 'image/png',
      };
    }

    // Full page screenshot
    const buffer = await page.screenshot(screenshotOptions);
    const base64 = buffer.toString('base64');

    return {
      pageId,
      base64,
      mimeType: options.type === 'jpeg' ? 'image/jpeg' : 'image/png',
    };
  }

  /**
   * List all open pages
   */
  async listPages(): Promise<BrowserPage[]> {
    const pages: BrowserPage[] = [];

    for (const [id, info] of this.pageInfo) {
      const page = this.pages.get(id);
      if (page && !page.isClosed()) {
        pages.push({
          ...info,
          url: page.url(),
          title: await page.title(),
        });
      }
    }

    return pages;
  }

  /**
   * Close a page
   */
  async closePage(pageId: string): Promise<void> {
    const page = this.pages.get(pageId);
    if (page && !page.isClosed()) {
      await page.close();
    }

    this.pages.delete(pageId);
    this.pageInfo.delete(pageId);
    this.snapshotCache.delete(pageId);
    resetRefTracker(pageId);
  }

  /**
   * Close all pages and browser
   */
  async close(): Promise<void> {
    for (const pageId of this.pages.keys()) {
      await this.closePage(pageId);
    }

    if (this.context) {
      await this.context.close();
      this.context = null;
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    clearAllTrackers();
    console.log('[Browser] Browser closed');
  }

  /**
   * Check if browser is running
   */
  isRunning(): boolean {
    return this.browser !== null && this.browser.isConnected();
  }

  /**
   * Get browser status
   */
  getStatus(): { running: boolean; pages: number; config: BrowserConfig } {
    return {
      running: this.isRunning(),
      pages: this.pages.size,
      config: this.config,
    };
  }
}

// Singleton instance
let browserService: BrowserService | null = null;

/**
 * Get the browser service singleton
 */
export function getBrowserService(): BrowserService {
  if (!browserService) {
    browserService = new BrowserService();
  }
  return browserService;
}

/**
 * Reset browser service (for testing)
 */
export async function resetBrowserService(): Promise<void> {
  if (browserService) {
    await browserService.close();
    browserService = null;
  }
}

// Export the class for direct instantiation if needed
export { BrowserService };

// Re-export formatting functions
export { formatSnapshotResponse, formatSearchResponse };
