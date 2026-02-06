import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../tool-use.js', () => ({
  getSessionEvents: vi.fn(() => []),
  clearSessionEvents: vi.fn(),
  getSessionSummary: vi.fn(() => ({
    filesModified: [],
    filesCreated: [],
    toolUseCounts: {},
  })),
}));

vi.mock('../../intelligence/rules.js', () => ({
  aggregateInferences: vi.fn(() => ({
    confidence: 0,
    tags: [],
  })),
}));

import {
  getSessionAggregate,
  getAllSessionAggregates,
  getRecentSessions,
} from '../session-end.js';

describe('Session End Hook', () => {
  // ===========================================================================
  // Aggregate queries (in-memory storage)
  // ===========================================================================

  describe('query functions', () => {
    it('getSessionAggregate returns undefined for unknown session', () => {
      expect(getSessionAggregate('nonexistent')).toBeUndefined();
    });

    it('getAllSessionAggregates returns an array', () => {
      const aggregates = getAllSessionAggregates();
      expect(Array.isArray(aggregates)).toBe(true);
    });

    it('getRecentSessions returns an array', () => {
      const sessions = getRecentSessions(10);
      expect(Array.isArray(sessions)).toBe(true);
    });

    it('getRecentSessions respects limit', () => {
      const sessions = getRecentSessions(5);
      expect(sessions.length).toBeLessThanOrEqual(5);
    });
  });
});
