/**
 * GroupChatManager Tests
 *
 * Tests for GroupChatManager in src/chat/group.ts.
 * Covers mention gating, threading, user tracking, personality,
 * and per-user rate limiting.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock logger before importing module under test
// ---------------------------------------------------------------------------

vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  GroupChatManager,
  createDefaultGroupChatConfig,
} from '../group.js';
import type { GroupChatConfig } from '../group.js';
import type { IncomingMessage } from '../providers/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManager(overrides: Partial<GroupChatConfig> = {}): GroupChatManager {
  const base = createDefaultGroupChatConfig();
  return new GroupChatManager({ ...base, ...overrides });
}

function makeMessage(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    id: 'msg-1',
    provider: 'slack',
    accountId: 'acc-1',
    senderId: 'user-1',
    senderName: 'Alice',
    chatType: 'group',
    chatId: 'channel-1',
    text: 'Hello world',
    ...overrides,
  } as IncomingMessage;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GroupChatManager', () => {
  let manager: GroupChatManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = makeManager();
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // shouldRespond() - mention gating
  // -------------------------------------------------------------------------

  describe('shouldRespond()', () => {
    it('returns true for direct messages regardless of mention', () => {
      const dm = makeMessage({ chatType: 'direct', text: 'hey' });
      expect(manager.shouldRespond(dm)).toBe(true);
    });

    it('returns false in group chat without a mention', () => {
      const groupMsg = makeMessage({ chatType: 'group', text: 'random message' });
      expect(manager.shouldRespond(groupMsg)).toBe(false);
    });

    it('returns false in channel chat without a mention', () => {
      const channelMsg = makeMessage({ chatType: 'channel', text: 'some text' });
      expect(manager.shouldRespond(channelMsg)).toBe(false);
    });

    it('returns true in group with bot name mention', () => {
      const mentioned = makeMessage({ chatType: 'group', text: 'hey profclaw, help me!' });
      expect(manager.shouldRespond(mentioned)).toBe(true);
    });

    it('returns true with @profclaw mention', () => {
      const mentioned = makeMessage({ chatType: 'group', text: '@profclaw please review this' });
      expect(manager.shouldRespond(mentioned)).toBe(true);
    });

    it('is case-insensitive for bot name matching', () => {
      const mentioned = makeMessage({ chatType: 'group', text: 'PROFCLAW do this' });
      expect(manager.shouldRespond(mentioned)).toBe(true);
    });

    it('returns true when mentionGate.enabled is false (always respond)', () => {
      const mgr = makeManager({
        mentionGate: {
          enabled: false,
          botNames: ['profclaw'],
          respondInDMs: true,
          respondToReplies: true,
        },
      });

      const noMention = makeMessage({ chatType: 'group', text: 'random text' });
      expect(mgr.shouldRespond(noMention)).toBe(true);
      mgr.destroy();
    });

    it('returns true for replies when respondToReplies is true', () => {
      const reply = makeMessage({ chatType: 'group', text: 'following up', replyToId: 'msg-0' });
      expect(manager.shouldRespond(reply)).toBe(true);
    });

    it('returns false for replies when respondToReplies is false', () => {
      const mgr = makeManager({
        mentionGate: {
          enabled: true,
          botNames: ['profclaw'],
          respondInDMs: true,
          respondToReplies: false,
        },
      });

      const reply = makeMessage({ chatType: 'group', text: 'following up', replyToId: 'msg-0' });
      expect(mgr.shouldRespond(reply)).toBe(false);
      mgr.destroy();
    });
  });

  // -------------------------------------------------------------------------
  // Rate limiting - checkRateLimit()
  // -------------------------------------------------------------------------

  describe('checkRateLimit()', () => {
    it('allows messages within the per-minute limit', () => {
      const userId = 'user-rl';
      const chatId = 'chan-rl';

      for (let i = 0; i < 5; i++) {
        const result = manager.checkRateLimit(userId, chatId);
        expect(result.allowed).toBe(true);
      }
    });

    it('blocks when per-minute limit is exceeded', () => {
      const mgr = makeManager({
        rateLimit: {
          maxMessagesPerMinute: 3,
          maxMessagesPerHour: 100,
        },
      });

      const userId = 'user-blocked';
      const chatId = 'chan-blocked';

      // Send 3 messages (allowed)
      for (let i = 0; i < 3; i++) {
        mgr.checkRateLimit(userId, chatId);
      }

      // 4th message should be blocked
      const blocked = mgr.checkRateLimit(userId, chatId);
      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfterMs).toBeGreaterThan(0);

      mgr.destroy();
    });

    it('provides a message when rate limited', () => {
      const mgr = makeManager({
        rateLimit: {
          maxMessagesPerMinute: 1,
          maxMessagesPerHour: 100,
          cooldownMessage: 'Slow down!',
        },
      });

      mgr.checkRateLimit('u', 'c');
      const blocked = mgr.checkRateLimit('u', 'c');

      expect(blocked.allowed).toBe(false);
      expect(blocked.message).toBe('Slow down!');
      mgr.destroy();
    });

    it('unblocks after the minute window expires', () => {
      const mgr = makeManager({
        rateLimit: {
          maxMessagesPerMinute: 2,
          maxMessagesPerHour: 100,
        },
      });

      mgr.checkRateLimit('u', 'c');
      mgr.checkRateLimit('u', 'c');

      // Should be blocked now
      expect(mgr.checkRateLimit('u', 'c').allowed).toBe(false);

      // Advance time 61 seconds - messages are evicted from the minute window
      vi.advanceTimersByTime(61_000);

      expect(mgr.checkRateLimit('u', 'c').allowed).toBe(true);
      mgr.destroy();
    });
  });

  // -------------------------------------------------------------------------
  // Channel personality - setPersonality / getPersonality
  // -------------------------------------------------------------------------

  describe('channel personality', () => {
    it('can be set and retrieved', () => {
      manager.setPersonality('chan-1', 'slack', {
        systemPrompt: 'Be concise',
        name: 'ConciseBot',
        responseStyle: 'concise',
      });

      const p = manager.getPersonality('chan-1', 'slack');
      expect(p).toBeDefined();
      expect(p!.systemPrompt).toBe('Be concise');
      expect(p!.name).toBe('ConciseBot');
      expect(p!.responseStyle).toBe('concise');
    });

    it('returns undefined for unknown channel', () => {
      expect(manager.getPersonality('no-channel', 'discord')).toBeUndefined();
    });

    it('merges partial updates', () => {
      manager.setPersonality('chan-merge', 'slack', { systemPrompt: 'First prompt' });
      manager.setPersonality('chan-merge', 'slack', { name: 'NewName' });

      const p = manager.getPersonality('chan-merge', 'slack');
      expect(p!.systemPrompt).toBe('First prompt');
      expect(p!.name).toBe('NewName');
    });

    it('setChannelPersonality (API-level) stores and is retrievable via getChannelPersonalities', () => {
      manager.setChannelPersonality('chan-api', 'You are a helpful assistant');

      const personalities = manager.getChannelPersonalities();
      expect(personalities['chan-api']).toBe('You are a helpful assistant');
    });
  });

  // -------------------------------------------------------------------------
  // Threading config - getReplyTarget()
  // -------------------------------------------------------------------------

  describe('getReplyTarget()', () => {
    it('keeps an existing thread ID', () => {
      const msg = makeMessage({ threadId: 'thread-123', chatType: 'group' });
      const target = manager.getReplyTarget(msg);
      expect(target.threadId).toBe('thread-123');
    });

    it('starts a new thread for group messages when preferThreads is true', () => {
      const msg = makeMessage({ chatType: 'group', id: 'orig-msg' });
      const target = manager.getReplyTarget(msg);
      expect(target.threadId).toBe('orig-msg');
    });

    it('replies directly in DMs', () => {
      const msg = makeMessage({ chatType: 'direct', id: 'dm-msg' });
      const target = manager.getReplyTarget(msg);
      expect(target.replyToId).toBe('dm-msg');
      expect(target.threadId).toBeUndefined();
    });

    it('replies directly when preferThreads is false', () => {
      const mgr = makeManager({
        threading: { preferThreads: false, threadTimeout: 30 },
      });

      const msg = makeMessage({ chatType: 'group', id: 'no-thread-msg' });
      const target = mgr.getReplyTarget(msg);
      expect(target.replyToId).toBe('no-thread-msg');
      mgr.destroy();
    });
  });

  // -------------------------------------------------------------------------
  // User context tracking - trackUser() / getUserContext()
  // -------------------------------------------------------------------------

  describe('user context tracking', () => {
    it('creates a new user context on first message', () => {
      const msg = makeMessage({ senderId: 'user-new', senderName: 'Bob', chatId: 'chan-ctx' });
      manager.trackUser(msg);

      const ctx = manager.getUserContext('user-new', 'chan-ctx');
      expect(ctx).toBeDefined();
      expect(ctx!.userName).toBe('Bob');
      expect(ctx!.messageCount).toBe(1);
    });

    it('increments messageCount on subsequent messages', () => {
      const msg = makeMessage({ senderId: 'user-count', senderName: 'Alice', chatId: 'chan-count' });
      manager.trackUser(msg);
      manager.trackUser(msg);
      manager.trackUser(msg);

      const ctx = manager.getUserContext('user-count', 'chan-count');
      expect(ctx!.messageCount).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // setRateLimit() - per-channel override
  // -------------------------------------------------------------------------

  describe('setRateLimit() channel override', () => {
    it('applies the per-channel rate limit instead of the global one', () => {
      manager.setRateLimit('restricted-chan', 1);

      manager.checkRateLimit('user-1', 'restricted-chan');
      const blocked = manager.checkRateLimit('user-1', 'restricted-chan');

      expect(blocked.allowed).toBe(false);
    });

    it('does not affect other channels', () => {
      manager.setRateLimit('restricted-chan', 1);

      manager.checkRateLimit('user-1', 'restricted-chan');
      manager.checkRateLimit('user-1', 'restricted-chan');

      // Default limit (10/min) should still apply to other channels
      const result = manager.checkRateLimit('user-1', 'other-chan');
      expect(result.allowed).toBe(true);
    });
  });
});
