/**
 * Accessibility Tree Snapshot
 *
 * Captures accessibility tree from Playwright pages and converts
 * to a structured format with element refs for AI interaction.
 *
 * Uses Playwright's ariaSnapshot() API for accessibility tree capture.
 */

import type { Page, Locator } from 'playwright-core';
import type { SnapshotNode, PageSnapshot, SnapshotOptions } from './types.js';
import { getRefTracker } from './refs.js';
import { compressTree, treeToYaml, getCompressionStats } from './compression.js';

/**
 * Parse ARIA snapshot YAML string into structured tree
 *
 * Playwright's ariaSnapshot() returns YAML like:
 *   - heading "Title" [level=1]
 *   - navigation:
 *     - link "Home"
 *     - link "About"
 */
function parseAriaSnapshot(snapshot: string, pageId: string): SnapshotNode {
  const refTracker = getRefTracker(pageId);
  const lines = snapshot.split('\n').filter(line => line.trim());

  // Build tree from indented YAML structure
  const root: SnapshotNode = {
    role: 'document',
    ref: refTracker.generateRef('document', '', 'body'),
    children: [],
  };

  const stack: { node: SnapshotNode; indent: number }[] = [{ node: root, indent: -2 }];

  for (const line of lines) {
    const match = line.match(/^(\s*)-\s*(.+)$/);
    if (!match) continue;

    const indent = match[1].length;
    const content = match[2].trim();

    // Parse role and attributes from line like: heading "Title" [level=1]
    const parsed = parseNodeLine(content);
    if (!parsed) continue;

    const { role, name, attributes, hasChildren } = parsed;
    const ref = refTracker.generateRef(role, name || '', `[role="${role}"]`);

    const node: SnapshotNode = {
      role,
      ref,
      ...(name && { name }),
      ...parseAttributes(attributes),
    };

    if (hasChildren) {
      node.children = [];
    }

    // Find parent based on indentation
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].node;
    if (!parent.children) {
      parent.children = [];
    }
    parent.children.push(node);

    if (hasChildren) {
      stack.push({ node, indent });
    }
  }

  return root;
}

/**
 * Parse a single node line like: heading "Title" [level=1]
 */
function parseNodeLine(content: string): {
  role: string;
  name?: string;
  attributes?: string;
  hasChildren: boolean;
} | null {
  // Check if line ends with colon (has children)
  const hasChildren = content.endsWith(':');
  const cleanContent = hasChildren ? content.slice(0, -1) : content;

  // Match patterns:
  // 1. role "name" [attributes]
  // 2. role "name"
  // 3. role [attributes]
  // 4. just role
  const patterns = [
    /^(\w+)\s+"([^"]*)"(?:\s+\[([^\]]+)\])?$/,  // role "name" [attrs]
    /^(\w+)(?:\s+\[([^\]]+)\])?$/,               // role [attrs]
  ];

  for (const pattern of patterns) {
    const match = cleanContent.match(pattern);
    if (match) {
      if (match.length === 4) {
        // role "name" [attrs]
        return {
          role: match[1].toLowerCase(),
          name: match[2],
          attributes: match[3],
          hasChildren,
        };
      } else {
        // role [attrs]
        return {
          role: match[1].toLowerCase(),
          attributes: match[2],
          hasChildren,
        };
      }
    }
  }

  // Fallback: treat whole thing as role
  const simpleRole = cleanContent.split(/[\s\["]/)[0];
  if (simpleRole) {
    return {
      role: simpleRole.toLowerCase(),
      hasChildren,
    };
  }

  return null;
}

/**
 * Parse attribute string like "level=1, checked, disabled"
 */
function parseAttributes(attrString?: string): Partial<SnapshotNode> {
  if (!attrString) return {};

  const result: Partial<SnapshotNode> = {};
  const attrs = attrString.split(',').map(a => a.trim());

  for (const attr of attrs) {
    if (attr === 'checked') result.checked = true;
    else if (attr === 'selected') result.selected = true;
    else if (attr === 'disabled') result.disabled = true;
    else if (attr === 'required') result.required = true;
    else if (attr === 'expanded') result.expanded = true;
    else if (attr === 'collapsed') result.expanded = false;
    else if (attr.startsWith('level=')) {
      result.level = parseInt(attr.split('=')[1], 10);
    }
  }

  return result;
}

/**
 * Create fallback snapshot when ariaSnapshot is not available
 * Uses Playwright's locator API to gather elements
 */
async function createFallbackSnapshot(page: Page, pageId: string): Promise<SnapshotNode> {
  const refTracker = getRefTracker(pageId);

  const root: SnapshotNode = {
    role: 'document',
    ref: refTracker.generateRef('document', '', 'body'),
    children: [],
  };

  // Helper to safely get text content from a locator
  async function getElementInfo(
    locator: Locator,
    role: string,
    attrs?: string
  ): Promise<void> {
    const count = await locator.count();
    const limit = Math.min(count, 10);

    for (let i = 0; i < limit; i++) {
      try {
        const el = locator.nth(i);
        const text = await el.textContent({ timeout: 1000 });
        const trimmed = text?.slice(0, 50).trim() || '';

        if (trimmed) {
          const ref = refTracker.generateRef(role, trimmed, `[role="${role}"]`);
          const node: SnapshotNode = {
            role,
            ref,
            name: trimmed,
            ...parseAttributes(attrs),
          };
          root.children!.push(node);
        }
      } catch {
        // Skip elements that can't be read
      }
    }
  }

  // Collect elements using Playwright locators
  await getElementInfo(page.locator('h1'), 'heading', 'level=1');
  await getElementInfo(page.locator('h2'), 'heading', 'level=2');
  await getElementInfo(page.locator('h3'), 'heading', 'level=3');
  await getElementInfo(page.getByRole('button'), 'button');
  await getElementInfo(page.getByRole('link'), 'link');
  await getElementInfo(page.getByRole('textbox'), 'textbox');
  await getElementInfo(page.getByRole('checkbox'), 'checkbox');

  return root;
}

/**
 * Capture accessibility tree snapshot of a page
 */
export async function captureSnapshot(
  page: Page,
  pageId: string,
  options: SnapshotOptions = {}
): Promise<PageSnapshot> {
  const { compress = true, interactive = false, selector, maxChars } = options;

  // Reset ref tracker for this page
  const refTracker = getRefTracker(pageId);
  refTracker.reset();

  // Get the locator to snapshot
  const locator: Locator = selector ? page.locator(selector) : page.locator('body');

  let tree: SnapshotNode;

  try {
    // Use new Playwright ariaSnapshot() API
    const ariaSnapshot = await locator.ariaSnapshot();
    tree = parseAriaSnapshot(ariaSnapshot, pageId);
  } catch {
    // Fallback: create basic snapshot from page content
    tree = await createFallbackSnapshot(page, pageId);
  }

  // Apply compression
  const originalTree = tree;
  if (compress) {
    tree = compressTree(tree, {
      interactive,
      maxTextLength: maxChars,
    });
  }

  // Generate YAML representation
  const snapshot = treeToYaml(tree);

  // Get compression stats
  const stats = getCompressionStats(originalTree, tree);

  return {
    pageId,
    url: page.url(),
    title: await page.title(),
    snapshot,
    tree,
    refs: refTracker.getAllRefs(),
    compressed: compress,
    totalElements: stats.original,
    compressedElements: stats.compressed,
  };
}

/**
 * Format snapshot for MCP response
 */
export function formatSnapshotResponse(snapshot: PageSnapshot): string {
  const lines = [
    '### Page state',
    `- Page URL: ${snapshot.url}`,
    `- Page Title: ${snapshot.title}`,
  ];

  if (snapshot.compressed && snapshot.totalElements > 0) {
    const reduction = Math.round((1 - snapshot.compressedElements / snapshot.totalElements) * 100);
    lines.push(`- Elements: ${snapshot.compressedElements}/${snapshot.totalElements} (${reduction}% compressed)`);
  }

  lines.push('- Snapshot:');
  lines.push('```yaml');
  lines.push(snapshot.snapshot);
  lines.push('```');

  return lines.join('\n');
}
