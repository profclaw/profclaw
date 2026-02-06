/**
 * Agent Session Manager Tests
 *
 * Note: These tests use a simplified mock that doesn't fully replicate
 * drizzle-orm query filtering. For comprehensive testing, use integration
 * tests with a real database.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock logger first
vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the storage module with a simple store
const mockSessions = new Map<string, any>();

vi.mock('../../../storage/index.js', () => ({
  getDb: () => ({
    insert: (table: any) => ({
      values: async (data: any) => {
        mockSessions.set(data.id, data);
        return [data];
      },
    }),
    select: () => ({
      from: (table: any) => {
        // Create a chainable query builder that returns stored sessions
        const createChain = (filter?: (s: any) => boolean) => {
          const chain: any = {
            where: (condition: any) => createChain(filter),
            orderBy: (...args: any[]) => chain,
            limit: (n: number) => chain,
            then: (resolve: any) => {
              const sessions = Array.from(mockSessions.values());
              resolve(filter ? sessions.filter(filter) : sessions);
            },
          };
          return chain;
        };
        return createChain();
      },
    }),
    update: (table: any) => ({
      set: (data: any) => ({
        where: async (condition: any) => {},
      }),
    }),
    delete: (table: any) => ({
      where: () => ({
        returning: async () => [],
      }),
    }),
  }),
}));

import { AgentSessionManagerImpl } from './manager.js';

describe('AgentSessionManagerImpl', () => {
  let manager: AgentSessionManagerImpl;

  beforeEach(() => {
    mockSessions.clear();
    manager = new AgentSessionManagerImpl();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createRootSession', () => {
    it('should create a root session with depth 0', async () => {
      const session = await manager.createRootSession(
        'conv-123',
        'Root Session',
        'Main task goal'
      );

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.depth).toBe(0);
      expect(session.status).toBe('running');
      expect(session.conversationId).toBe('conv-123');
      expect(session.name).toBe('Root Session');
      expect(session.goal).toBe('Main task goal');
      expect(session.parentSessionId).toBeNull();
    });

    it('should set default budget and steps for root sessions', async () => {
      const session = await manager.createRootSession('conv-123', 'Root');

      expect(session.maxSteps).toBe(100);
      expect(session.maxBudget).toBe(100_000);
    });

    it('should store session in the database', async () => {
      const session = await manager.createRootSession('conv-123', 'Root');

      expect(mockSessions.has(session.id)).toBe(true);
      expect(mockSessions.get(session.id).name).toBe('Root');
    });
  });

  describe('hierarchy', () => {
    it('getParent should return null for root session', async () => {
      const root = await manager.createRootSession('conv-123', 'Root');
      const parent = await manager.getParent(root.id);

      expect(parent).toBeNull();
    });

    it('getSiblings should return empty for root session', async () => {
      const root = await manager.createRootSession('conv-123', 'Root');
      const siblings = await manager.getSiblings(root.id);

      // Root has no parent, so no siblings
      expect(siblings).toEqual([]);
    });
  });

  describe('spawn validation', () => {
    it('should reject spawn if parent not found', async () => {
      await expect(
        manager.spawn({
          parentSessionId: 'nonexistent',
          name: 'Child',
          goal: 'Test goal',
        })
      ).rejects.toThrow('Parent session not found');
    });
  });

  describe('cleanup', () => {
    it('should return zero counts on empty cleanup', async () => {
      const result = await manager.cleanup({ olderThanMs: 1000 });

      expect(result).toEqual({
        sessionsDeleted: 0,
        messagesDeleted: 0,
      });
    });
  });
});
