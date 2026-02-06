/**
 * Browser Automation Tests
 *
 * Tests for the Playwright-based browser automation module.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getBrowserService, resetBrowserService } from './service.js';

describe('Browser Service', () => {
  beforeAll(async () => {
    // Ensure clean state
    await resetBrowserService();
  });

  afterAll(async () => {
    // Clean up browser
    await resetBrowserService();
  });

  it('should navigate to a URL and capture snapshot', async () => {
    const browser = getBrowserService();

    // Navigate to example.com
    const result = await browser.navigate('https://example.com');

    expect(result.url).toContain('example.com');
    expect(result.pageId).toBeDefined();
    expect(result.title).toBeDefined();

    // Capture snapshot
    const snapshot = await browser.snapshot({ pageId: result.pageId });

    expect(snapshot.url).toContain('example.com');
    expect(snapshot.snapshot).toBeDefined();
    expect(snapshot.refs.size).toBeGreaterThan(0);

    console.log('Snapshot preview:');
    console.log(snapshot.snapshot.slice(0, 500));
  }, 30000);

  it('should search for content in snapshot', async () => {
    const browser = getBrowserService();

    // Search for "Example" text
    const results = await browser.search({
      pattern: 'Example',
      ignoreCase: true,
    });

    expect(results.matchCount).toBeGreaterThan(0);
    expect(results.results.length).toBeGreaterThan(0);

    console.log('Search results:');
    console.log(results.results.map(r => `${r.ref}: ${r.name}`).join('\n'));
  }, 10000);

  it('should list open pages', async () => {
    const browser = getBrowserService();

    const pages = await browser.listPages();

    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0].url).toContain('example.com');

    console.log('Open pages:');
    console.log(pages.map(p => `${p.id}: ${p.url}`).join('\n'));
  }, 10000);

  it('should take a screenshot', async () => {
    const browser = getBrowserService();
    const pages = await browser.listPages();

    const screenshot = await browser.screenshot({
      pageId: pages[0].id,
    });

    expect(screenshot.base64).toBeDefined();
    expect(screenshot.mimeType).toBe('image/png');
    expect(screenshot.base64.length).toBeGreaterThan(1000);

    console.log(`Screenshot captured: ${screenshot.base64.length} bytes`);
  }, 10000);

  it('should close page', async () => {
    const browser = getBrowserService();
    const pages = await browser.listPages();

    await browser.closePage(pages[0].id);

    const remainingPages = await browser.listPages();
    expect(remainingPages.length).toBe(pages.length - 1);
  }, 10000);

  it('should click elements and type text', async () => {
    const browser = getBrowserService();

    // Navigate to DuckDuckGo
    const nav = await browser.navigate('https://duckduckgo.com');
    expect(nav.title).toContain('DuckDuckGo');

    // Get snapshot to find search box
    const snapshot = await browser.snapshot({ pageId: nav.pageId });
    expect(snapshot.refs.size).toBeGreaterThan(0);

    console.log('Snapshot preview:', snapshot.snapshot.slice(0, 1000));

    // Search for DuckDuckGo search elements
    const search = await browser.search({
      pattern: 'DuckDuckGo',
      pageId: nav.pageId,
    });

    console.log(
      'Search results:',
      search.results.map((r) => `${r.ref}: ${r.role} - ${r.name}`)
    );

    // Find the combobox (search input)
    const combobox = search.results.find((r) => r.role === 'combobox');
    expect(combobox).toBeDefined();

    if (combobox) {
      // Type into search box
      const typeResult = await browser.type({
        ref: combobox.ref,
        text: 'playwright test',
        pageId: nav.pageId,
      });

      expect(typeResult.text).toBe('playwright test');
      expect(typeResult.executed).toBeDefined();

      console.log('Typed into:', combobox.ref, '-', combobox.name);
      console.log('Executed:', typeResult.executed);

      // Click the search button
      const buttonSearch = await browser.search({
        pattern: 'button',
        pageId: nav.pageId,
      });

      const searchButton = buttonSearch.results.find(
        (r) => r.role === 'button' && r.name?.toLowerCase().includes('search')
      );

      if (searchButton) {
        const clickResult = await browser.click({
          ref: searchButton.ref,
          pageId: nav.pageId,
        });

        expect(clickResult.executed).toBeDefined();
        console.log('Clicked:', searchButton.ref, '-', searchButton.name);
      }
    }

    // Clean up
    await browser.close();
  }, 30000);
});
