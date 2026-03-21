import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock experience store before importing
vi.mock('../experience-store.js', () => ({
  recordExperience: vi.fn(() => Promise.resolve('mock-id')),
  trackPreference: vi.fn(() => Promise.resolve()),
  findSimilarExperiences: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../../utils/logger.js', () => ({
  createContextualLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import {
  observeConversation,
  observeWindow,
  compressToDigest,
  type ConversationSnapshot,
} from '../observational.js';
import { recordExperience, trackPreference } from '../experience-store.js';

describe('Observational Memory Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('observeConversation', () => {
    it('extracts decisions from conversation', async () => {
      const snapshot: ConversationSnapshot = {
        conversationId: 'conv-1',
        messages: [
          { role: 'user', content: 'Should we use PostgreSQL or SQLite?' },
          { role: 'assistant', content: 'Both work. PostgreSQL for production, SQLite for simplicity.' },
          { role: 'user', content: "Let's go with SQLite for now, we can migrate later." },
        ],
      };

      const result = await observeConversation(snapshot);
      expect(result.observations.length).toBeGreaterThan(0);
      expect(result.observations.some(o => o.type === 'decision')).toBe(true);
    });

    it('extracts user preferences', async () => {
      const snapshot: ConversationSnapshot = {
        conversationId: 'conv-2',
        messages: [
          { role: 'user', content: 'I prefer TypeScript for all my projects' },
          { role: 'assistant', content: 'Noted, I will use TypeScript.' },
          { role: 'user', content: 'Also I always use React with Tailwind' },
        ],
        metadata: { userId: 'user-1' },
      };

      const result = await observeConversation(snapshot);
      const prefs = result.observations.filter(o => o.type === 'preference');
      expect(prefs.length).toBeGreaterThan(0);
      expect(prefs.some(p => p.summary.toLowerCase().includes('typescript'))).toBe(true);
    });

    it('extracts solution patterns from tool-using conversations', async () => {
      const snapshot: ConversationSnapshot = {
        conversationId: 'conv-3',
        messages: [
          { role: 'user', content: 'Fix the login bug in auth.ts' },
          { role: 'assistant', content: 'I found the issue.', toolsUsed: ['read_file', 'edit_file'] },
          { role: 'assistant', content: 'Fixed the authentication check.', toolsUsed: ['exec'] },
          { role: 'user', content: 'Thanks, that works perfectly!' },
        ],
      };

      const result = await observeConversation(snapshot);
      const solutions = result.observations.filter(o => o.type === 'solution');
      expect(solutions.length).toBeGreaterThan(0);
    });

    it('extracts project facts', async () => {
      const snapshot: ConversationSnapshot = {
        conversationId: 'conv-4',
        messages: [
          { role: 'user', content: 'The project uses Docker for deployment' },
          { role: 'user', content: 'Our database is PostgreSQL on AWS RDS' },
        ],
      };

      const result = await observeConversation(snapshot);
      const facts = result.observations.filter(o => o.type === 'fact');
      expect(facts.length).toBeGreaterThan(0);
    });

    it('extracts error recovery patterns', async () => {
      const snapshot: ConversationSnapshot = {
        conversationId: 'conv-5',
        messages: [
          { role: 'user', content: 'Deploy to production' },
          { role: 'assistant', content: 'Deployment failed with error: connection timeout to database' },
          { role: 'assistant', content: 'Fixed by updating the connection string and resolved the timeout issue' },
        ],
      };

      const result = await observeConversation(snapshot);
      const errors = result.observations.filter(o => o.type === 'error_pattern');
      expect(errors.length).toBeGreaterThan(0);
    });

    it('persists observations as experiences', async () => {
      const snapshot: ConversationSnapshot = {
        conversationId: 'conv-6',
        messages: [
          { role: 'user', content: "Let's go with Express for the API" },
        ],
      };

      await observeConversation(snapshot);
      expect(recordExperience).toHaveBeenCalled();
    });

    it('tracks preferences for identified users', async () => {
      const snapshot: ConversationSnapshot = {
        conversationId: 'conv-7',
        messages: [
          { role: 'user', content: 'I prefer using Python for scripts' },
        ],
        metadata: { userId: 'alice' },
      };

      await observeConversation(snapshot);
      expect(trackPreference).toHaveBeenCalledWith('alice', 'language', 'Python');
    });

    it('returns timing information', async () => {
      const result = await observeConversation({
        conversationId: 'conv-8',
        messages: [{ role: 'user', content: 'hello' }],
      });
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('observeWindow', () => {
    it('observes a sliding window of messages', async () => {
      const messages = Array.from({ length: 30 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `Message ${i}`,
      }));

      const result = await observeWindow('conv-w1', messages, 10);
      expect(result).toBeDefined();
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('compressToDigest', () => {
    it('creates a structured digest from messages and observations', () => {
      const messages = [
        { role: 'user' as const, content: 'Fix the authentication bug' },
        { role: 'assistant' as const, content: 'Found and fixed the issue' },
        { role: 'user' as const, content: 'Thanks, works great!' },
      ];
      const observations = [
        {
          id: '1',
          type: 'solution' as const,
          summary: 'Solved "Fix the authentication bug" using read_file -> edit_file',
          details: { tools: ['read_file', 'edit_file'] },
          confidence: 0.85,
          source: { conversationId: 'c1', messageRange: [0, 2] as [number, number], timestamp: Date.now() },
        },
      ];

      const digest = compressToDigest(messages, observations);
      expect(digest).toContain('Conversation:');
      expect(digest).toContain('Solutions:');
      expect(digest).toContain('authentication');
    });

    it('includes all observation types in digest', () => {
      const messages = [{ role: 'user' as const, content: 'test' }];
      const observations = [
        { id: '1', type: 'decision' as const, summary: 'Chose X', details: {}, confidence: 0.7, source: { conversationId: 'c1', messageRange: [0, 0] as [number, number], timestamp: Date.now() } },
        { id: '2', type: 'fact' as const, summary: 'Uses Docker', details: {}, confidence: 0.6, source: { conversationId: 'c1', messageRange: [0, 0] as [number, number], timestamp: Date.now() } },
      ];

      const digest = compressToDigest(messages, observations);
      expect(digest).toContain('Decisions:');
      expect(digest).toContain('Facts:');
    });
  });
});
