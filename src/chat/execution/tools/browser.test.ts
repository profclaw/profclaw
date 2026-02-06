import { describe, expect, it } from 'vitest';

import { browserNavigateTool, browserTools } from './browser.js';

describe('browser chat tools', () => {
  it('exposes an ESM-safe availability check for browser navigation', () => {
    expect(typeof browserNavigateTool.isAvailable).toBe('function');

    const availability = browserNavigateTool.isAvailable?.();

    expect(availability).toBeDefined();
    expect(typeof availability?.available).toBe('boolean');
    if (availability?.reason !== undefined) {
      expect(typeof availability.reason).toBe('string');
    }
  });

  it('re-exports the browser tool definitions for chat execution', () => {
    expect(browserTools.length).toBeGreaterThan(0);
    expect(browserTools[0]?.name).toBe('browser_navigate');
  });
});
