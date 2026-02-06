/**
 * Element Reference Tracking
 *
 * Manages element refs (e1, e2, etc.) for accessibility tree snapshots.
 * Refs allow AI agents to target elements without complex selectors.
 */

import type { ElementRef } from './types.js';

export class RefTracker {
  private refs: Map<string, ElementRef> = new Map();
  private counter = 0;
  private pageId: string;

  constructor(pageId: string) {
    this.pageId = pageId;
  }

  /**
   * Generate a new ref for an element
   */
  generateRef(role: string, name: string, selector: string, attributes?: Record<string, string>): string {
    this.counter++;
    const ref = `e${this.counter}`;

    this.refs.set(ref, {
      ref,
      role,
      name,
      selector,
      attributes,
    });

    return ref;
  }

  /**
   * Get element info by ref
   */
  getRef(ref: string): ElementRef | undefined {
    return this.refs.get(ref);
  }

  /**
   * Get all refs
   */
  getAllRefs(): Map<string, ElementRef> {
    return new Map(this.refs);
  }

  /**
   * Reset refs for new snapshot
   */
  reset(): void {
    this.refs.clear();
    this.counter = 0;
  }

  /**
   * Get count of tracked refs
   */
  get count(): number {
    return this.refs.size;
  }

  /**
   * Build a Playwright locator from a ref
   *
   * Priority order:
   * 1. getByRole with name (most accessible)
   * 2. getByText (for links/buttons)
   * 3. CSS selector (fallback)
   */
  buildLocatorCode(ref: string): string | null {
    const element = this.refs.get(ref);
    if (!element) return null;

    const { role, name, selector } = element;

    // Prefer role-based locators
    const roleLocators: Record<string, string> = {
      'button': 'button',
      'link': 'link',
      'textbox': 'textbox',
      'checkbox': 'checkbox',
      'radio': 'radio',
      'combobox': 'combobox',
      'listbox': 'listbox',
      'slider': 'slider',
      'spinbutton': 'spinbutton',
      'searchbox': 'searchbox',
      'switch': 'switch',
      'tab': 'tab',
      'menuitem': 'menuitem',
      'option': 'option',
      'heading': 'heading',
      'img': 'img',
    };

    if (roleLocators[role] && name) {
      const escapedName = name.replace(/'/g, "\\'");
      return `page.getByRole('${roleLocators[role]}', { name: '${escapedName}' })`;
    }

    if (name && (role === 'link' || role === 'button')) {
      const escapedName = name.replace(/'/g, "\\'");
      return `page.getByText('${escapedName}')`;
    }

    // Fallback to CSS selector
    if (selector) {
      const escapedSelector = selector.replace(/'/g, "\\'");
      return `page.locator('${escapedSelector}')`;
    }

    return null;
  }
}

/**
 * Global ref tracker registry (per page)
 */
const pageTrackers = new Map<string, RefTracker>();

export function getRefTracker(pageId: string): RefTracker {
  let tracker = pageTrackers.get(pageId);
  if (!tracker) {
    tracker = new RefTracker(pageId);
    pageTrackers.set(pageId, tracker);
  }
  return tracker;
}

export function resetRefTracker(pageId: string): void {
  pageTrackers.delete(pageId);
}

export function clearAllTrackers(): void {
  pageTrackers.clear();
}
