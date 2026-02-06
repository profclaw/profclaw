/**
 * Content Search
 *
 * Search page snapshots for text/patterns using regex.
 * Returns matching elements with their refs for interaction.
 */

import type { SnapshotNode, SearchResult, SearchResponse, ContentSearchOptions } from './types.js';

const DEFAULT_LIMIT = 20;

/**
 * Search a snapshot tree for matching content
 */
export function searchSnapshot(
  tree: SnapshotNode,
  options: ContentSearchOptions
): SearchResponse {
  const { pattern, ignoreCase = true, limit = DEFAULT_LIMIT } = options;

  // Build regex from pattern
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, ignoreCase ? 'gi' : 'g');
  } catch {
    // If invalid regex, treat as literal string
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    regex = new RegExp(escaped, ignoreCase ? 'gi' : 'g');
  }

  const results: SearchResult[] = [];
  let lineNumber = 0;

  function searchNode(node: SnapshotNode): void {
    lineNumber++;

    // Search in name
    if (node.name && regex.test(node.name)) {
      results.push({
        ref: node.ref,
        role: node.role,
        name: node.name,
        text: node.name,
        lineNumber,
      });

      // Reset regex lastIndex for next test
      regex.lastIndex = 0;

      // Stop if we've hit the limit
      if (results.length >= limit) return;
    }

    // Search in value
    if (node.value && regex.test(node.value)) {
      results.push({
        ref: node.ref,
        role: node.role,
        name: node.name || '',
        text: node.value,
        lineNumber,
      });

      regex.lastIndex = 0;

      if (results.length >= limit) return;
    }

    // Search in similar refs
    if (node.similarRefs && node.similarCount) {
      // Include the folded refs indicator
      lineNumber++;
    }

    // Search children
    if (node.children && results.length < limit) {
      for (const child of node.children) {
        searchNode(child);
        if (results.length >= limit) break;
      }
    }
  }

  searchNode(tree);

  return {
    pattern,
    results,
    matchCount: results.length,
    truncated: results.length >= limit,
  };
}

/**
 * Format search results for MCP response
 */
export function formatSearchResponse(response: SearchResponse): string {
  const lines = [
    `### Search results for "${response.pattern}"`,
    `Found ${response.matchCount} match${response.matchCount === 1 ? '' : 'es'}${response.truncated ? ' (truncated)' : ''}`,
    '',
  ];

  if (response.results.length === 0) {
    lines.push('No matches found.');
    return lines.join('\n');
  }

  lines.push('```yaml');
  for (const result of response.results) {
    const attrs: string[] = [`ref=${result.ref}`];
    let line = `- ${result.role}`;
    if (result.name) {
      line += ` "${result.name}"`;
    }
    line += ` [${attrs.join(', ')}]`;
    lines.push(line);
  }
  lines.push('```');

  return lines.join('\n');
}

/**
 * Search by role
 */
export function searchByRole(
  tree: SnapshotNode,
  role: string
): SearchResult[] {
  const results: SearchResult[] = [];

  function searchNode(node: SnapshotNode, lineNumber: number): number {
    if (node.role === role) {
      results.push({
        ref: node.ref,
        role: node.role,
        name: node.name || '',
        text: node.name || node.value || '',
        lineNumber,
      });
    }

    let currentLine = lineNumber + 1;

    if (node.children) {
      for (const child of node.children) {
        currentLine = searchNode(child, currentLine);
      }
    }

    return currentLine;
  }

  searchNode(tree, 1);
  return results;
}

/**
 * Find interactive elements
 */
export function findInteractiveElements(
  tree: SnapshotNode
): SearchResult[] {
  const interactiveRoles = new Set([
    'button',
    'link',
    'textbox',
    'checkbox',
    'radio',
    'combobox',
    'listbox',
    'slider',
    'spinbutton',
    'searchbox',
    'switch',
    'tab',
    'menuitem',
    'option',
  ]);

  const results: SearchResult[] = [];

  function searchNode(node: SnapshotNode, lineNumber: number): number {
    if (interactiveRoles.has(node.role) && !node.disabled) {
      results.push({
        ref: node.ref,
        role: node.role,
        name: node.name || '',
        text: node.name || node.value || '',
        lineNumber,
      });
    }

    let currentLine = lineNumber + 1;

    if (node.children) {
      for (const child of node.children) {
        currentLine = searchNode(child, currentLine);
      }
    }

    return currentLine;
  }

  searchNode(tree, 1);
  return results;
}

/**
 * Search for specific patterns commonly needed
 */
export const commonPatterns = {
  // Forms
  textInputs: (tree: SnapshotNode) => searchByRole(tree, 'textbox'),
  buttons: (tree: SnapshotNode) => searchByRole(tree, 'button'),
  links: (tree: SnapshotNode) => searchByRole(tree, 'link'),
  checkboxes: (tree: SnapshotNode) => searchByRole(tree, 'checkbox'),

  // Prices
  prices: (tree: SnapshotNode) =>
    searchSnapshot(tree, { pattern: '\\$\\d+\\.\\d{2}', limit: 50 }),

  // Emails
  emails: (tree: SnapshotNode) =>
    searchSnapshot(tree, {
      pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}',
      limit: 50,
    }),

  // Phone numbers
  phones: (tree: SnapshotNode) =>
    searchSnapshot(tree, {
      pattern: '\\(?\\d{3}\\)?[-\\.\\s]?\\d{3}[-\\.\\s]?\\d{4}',
      limit: 50,
    }),
};
