/**
 * DOM Compression Algorithm
 *
 * Intelligent compression of accessibility trees to reduce token usage.
 * Based on Better Playwright MCP - achieves ~90% reduction.
 *
 * Techniques:
 * 1. List Folding - Collapse repetitive list items
 * 2. Text Truncation - Limit long text content
 * 3. Interactive-Only Mode - Filter non-interactive elements
 */

import type { SnapshotNode } from './types.js';

// Configuration
const MAX_TEXT_LENGTH = 100;
const MIN_SIMILAR_TO_FOLD = 3;
const MAX_CHILDREN_BEFORE_FOLD = 5;

// Roles considered interactive
const INTERACTIVE_ROLES = new Set([
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
  'tablist',
  'menuitem',
  'menu',
  'menubar',
  'option',
  'dialog',
  'alertdialog',
  'form',
  // Also include navigation landmarks
  'navigation',
  'main',
  'banner',
  'complementary',
  'contentinfo',
  'search',
]);

// Roles that contain repeated items
const LIST_CONTAINER_ROLES = new Set([
  'list',
  'listbox',
  'menu',
  'menubar',
  'tablist',
  'tree',
  'grid',
  'rowgroup',
  'table',
]);

/**
 * Check if two nodes are similar enough to fold
 */
function areNodesSimilar(a: SnapshotNode, b: SnapshotNode): boolean {
  // Same role is required
  if (a.role !== b.role) return false;

  // Check children count similarity
  const aChildCount = a.children?.length ?? 0;
  const bChildCount = b.children?.length ?? 0;

  // Allow slight variation in children count
  if (Math.abs(aChildCount - bChildCount) > 2) return false;

  // Check attribute similarity
  const aAttrs = new Set([
    a.checked ? 'checked' : null,
    a.selected ? 'selected' : null,
    a.disabled ? 'disabled' : null,
  ].filter(Boolean));

  const bAttrs = new Set([
    b.checked ? 'checked' : null,
    b.selected ? 'selected' : null,
    b.disabled ? 'disabled' : null,
  ].filter(Boolean));

  // If attributes differ significantly, not similar
  for (const attr of aAttrs) {
    if (!bAttrs.has(attr)) return false;
  }

  return true;
}

/**
 * Fold similar consecutive children
 */
function foldSimilarChildren(children: SnapshotNode[]): SnapshotNode[] {
  if (children.length <= MAX_CHILDREN_BEFORE_FOLD) {
    return children;
  }

  const result: SnapshotNode[] = [];
  let i = 0;

  while (i < children.length) {
    const current = children[i];
    const similarNodes: SnapshotNode[] = [current];

    // Find consecutive similar nodes
    let j = i + 1;
    while (j < children.length && areNodesSimilar(current, children[j])) {
      similarNodes.push(children[j]);
      j++;
    }

    if (similarNodes.length >= MIN_SIMILAR_TO_FOLD) {
      // Keep first item, fold the rest
      const firstNode = { ...similarNodes[0] };
      firstNode.similarCount = similarNodes.length - 1;
      firstNode.similarRefs = similarNodes.slice(1).map(n => n.ref);
      result.push(firstNode);
    } else {
      // Keep all items
      result.push(...similarNodes);
    }

    i = j;
  }

  return result;
}

/**
 * Truncate long text
 */
function truncateText(text: string | undefined, maxLength = MAX_TEXT_LENGTH): string | undefined {
  if (!text) return text;
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Check if a node or its descendants are interactive
 */
function hasInteractiveDescendant(node: SnapshotNode): boolean {
  if (INTERACTIVE_ROLES.has(node.role)) return true;

  if (node.children) {
    return node.children.some(child => hasInteractiveDescendant(child));
  }

  return false;
}

/**
 * Compress a snapshot tree
 */
export function compressTree(
  tree: SnapshotNode,
  options: {
    interactive?: boolean;
    maxTextLength?: number;
  } = {}
): SnapshotNode {
  const { interactive = false, maxTextLength = MAX_TEXT_LENGTH } = options;

  function compress(node: SnapshotNode): SnapshotNode | null {
    // In interactive mode, filter non-interactive nodes
    if (interactive && !hasInteractiveDescendant(node)) {
      return null;
    }

    // Create a copy of the node
    const compressed: SnapshotNode = {
      role: node.role,
      ref: node.ref,
    };

    // Copy relevant properties with truncation
    if (node.name) compressed.name = truncateText(node.name, maxTextLength);
    if (node.value) compressed.value = truncateText(node.value, maxTextLength);
    if (node.checked !== undefined) compressed.checked = node.checked;
    if (node.selected !== undefined) compressed.selected = node.selected;
    if (node.disabled !== undefined) compressed.disabled = node.disabled;
    if (node.required !== undefined) compressed.required = node.required;
    if (node.expanded !== undefined) compressed.expanded = node.expanded;
    if (node.level !== undefined) compressed.level = node.level;

    // Process children
    if (node.children && node.children.length > 0) {
      // Recursively compress children
      const compressedChildren = node.children
        .map(child => compress(child))
        .filter((child): child is SnapshotNode => child !== null);

      // Apply list folding for list containers
      if (LIST_CONTAINER_ROLES.has(node.role)) {
        compressed.children = foldSimilarChildren(compressedChildren);
      } else {
        compressed.children = compressedChildren;
      }
    }

    return compressed;
  }

  const result = compress(tree);
  return result || tree;
}

/**
 * Convert compressed tree to YAML string
 */
export function treeToYaml(tree: SnapshotNode, indent = 0): string {
  const lines: string[] = [];
  const prefix = '  '.repeat(indent);

  // Build the main line
  let line = `${prefix}- ${tree.role}`;

  if (tree.name) {
    line += ` "${tree.name}"`;
  }

  // Add attributes
  const attrs: string[] = [];
  if (tree.checked) attrs.push('checked');
  if (tree.selected) attrs.push('selected');
  if (tree.disabled) attrs.push('disabled');
  if (tree.required) attrs.push('required');
  if (tree.expanded !== undefined) attrs.push(tree.expanded ? 'expanded' : 'collapsed');
  if (tree.level !== undefined) attrs.push(`level=${tree.level}`);

  // Add ref
  attrs.push(`ref=${tree.ref}`);

  if (attrs.length > 0) {
    line += ` [${attrs.join(', ')}]`;
  }

  // Handle folded nodes
  if (tree.similarCount && tree.similarRefs) {
    line += ` (... and ${tree.similarCount} more similar)`;
    line += ` [refs: ${tree.similarRefs.slice(0, 5).join(', ')}${tree.similarRefs.length > 5 ? ', ...' : ''}]`;
  }

  lines.push(line);

  // Add value on next line if present
  if (tree.value) {
    lines.push(`${prefix}  value: "${tree.value}"`);
  }

  // Process children
  if (tree.children) {
    for (const child of tree.children) {
      lines.push(treeToYaml(child, indent + 1));
    }
  }

  return lines.join('\n');
}

/**
 * Get compression statistics
 */
export function getCompressionStats(
  originalTree: SnapshotNode,
  compressedTree: SnapshotNode
): { original: number; compressed: number; reduction: number } {
  function countNodes(node: SnapshotNode): number {
    let count = 1;
    if (node.children) {
      count += node.children.reduce((sum, child) => sum + countNodes(child), 0);
    }
    // Add similar nodes count
    if (node.similarCount) {
      count += node.similarCount;
    }
    return count;
  }

  function countVisibleNodes(node: SnapshotNode): number {
    let count = 1;
    if (node.children) {
      count += node.children.reduce((sum, child) => sum + countVisibleNodes(child), 0);
    }
    return count;
  }

  const original = countNodes(originalTree);
  const compressed = countVisibleNodes(compressedTree);
  const reduction = Math.round((1 - compressed / original) * 100);

  return { original, compressed, reduction };
}
