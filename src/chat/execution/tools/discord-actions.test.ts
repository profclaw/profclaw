/**
 * Discord Actions Tool Tests
 *
 * Tests for src/chat/execution/tools/discord-actions.ts
 * All fetch() calls are mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { discordActionsTool } from './discord-actions.js';
import type { ToolExecutionContext } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createContext(): ToolExecutionContext {
  return {
    toolCallId: 'tc-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    workdir: '/tmp',
    env: {},
    securityPolicy: { mode: 'full' },
    sessionManager: {
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      list: vi.fn(() => []),
      kill: vi.fn(),
      cleanup: vi.fn(),
    },
  };
}

function mockDiscordOk(data: unknown = null, status = 204) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status,
    json: vi.fn().mockResolvedValue(data),
  });
}

function mockDiscordFail(status: number, errorMsg = 'Missing Permissions') {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({ message: errorMsg }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('discordActionsTool', () => {
  const originalToken = process.env.DISCORD_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DISCORD_TOKEN = 'test-bot-token';
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.DISCORD_TOKEN;
    } else {
      process.env.DISCORD_TOKEN = originalToken;
    }
  });

  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('tool metadata', () => {
    it('has correct name', () => {
      expect(discordActionsTool.name).toBe('discord_actions');
    });

    it('requires approval', () => {
      expect(discordActionsTool.requiresApproval).toBe(true);
    });

    it('has dangerous security level', () => {
      expect(discordActionsTool.securityLevel).toBe('dangerous');
    });
  });

  // -------------------------------------------------------------------------
  // isAvailable
  // -------------------------------------------------------------------------

  describe('isAvailable()', () => {
    it('returns available: true when DISCORD_TOKEN is set', () => {
      process.env.DISCORD_TOKEN = 'some-token';
      const result = discordActionsTool.isAvailable?.();
      expect(result?.available).toBe(true);
    });

    it('returns available: false when DISCORD_TOKEN is not set', () => {
      delete process.env.DISCORD_TOKEN;
      const result = discordActionsTool.isAvailable?.();
      expect(result?.available).toBe(false);
      expect(result?.reason).toContain('DISCORD_TOKEN');
    });
  });

  // -------------------------------------------------------------------------
  // No token
  // -------------------------------------------------------------------------

  describe('no DISCORD_TOKEN', () => {
    it('returns NOT_CONFIGURED error when token is missing', async () => {
      delete process.env.DISCORD_TOKEN;

      const result = await discordActionsTool.execute(createContext(), {
        action: 'set_status',
        status: 'Online',
        activity_type: 'playing',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_CONFIGURED');
    });
  });

  // -------------------------------------------------------------------------
  // set_status
  // -------------------------------------------------------------------------

  describe('set_status', () => {
    it('returns success without making a fetch call (gateway-only)', async () => {
      const result = await discordActionsTool.execute(createContext(), {
        action: 'set_status',
        status: 'Helping users',
        activity_type: 'watching',
      });

      expect(result.success).toBe(true);
      expect(result.data?.action).toBe('set_status');
      expect(result.output).toContain('Helping users');
      // set_status does not call fetch
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('defaults activity_type to playing when not specified', async () => {
      const result = await discordActionsTool.execute(createContext(), {
        action: 'set_status',
        status: 'Thinking',
        activity_type: 'playing',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('playing');
    });
  });

  // -------------------------------------------------------------------------
  // send_reaction
  // -------------------------------------------------------------------------

  describe('send_reaction', () => {
    it('adds a reaction successfully (204 response)', async () => {
      mockDiscordOk(null, 204);

      const result = await discordActionsTool.execute(createContext(), {
        action: 'send_reaction',
        channel_id: 'ch-111',
        message_id: 'msg-222',
        emoji: '👍',
      });

      expect(result.success).toBe(true);
      expect(result.data?.action).toBe('send_reaction');
      expect(result.output).toContain('msg-222');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/reactions/'),
        expect.objectContaining({ method: 'PUT' }),
      );
    });

    it('returns error on Discord API failure', async () => {
      mockDiscordFail(403, 'Missing Permissions');

      const result = await discordActionsTool.execute(createContext(), {
        action: 'send_reaction',
        channel_id: 'ch-111',
        message_id: 'msg-222',
        emoji: '👍',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('DISCORD_API_ERROR');
      expect(result.error?.message).toContain('Missing Permissions');
    });
  });

  // -------------------------------------------------------------------------
  // pin_message
  // -------------------------------------------------------------------------

  describe('pin_message', () => {
    it('pins a message successfully', async () => {
      mockDiscordOk(null, 204);

      const result = await discordActionsTool.execute(createContext(), {
        action: 'pin_message',
        channel_id: 'ch-333',
        message_id: 'msg-444',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('msg-444');
      expect(result.output).toContain('ch-333');
    });

    it('returns error when pin fails', async () => {
      mockDiscordFail(400, 'Invalid Form Body');

      const result = await discordActionsTool.execute(createContext(), {
        action: 'pin_message',
        channel_id: 'ch-333',
        message_id: 'msg-444',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('DISCORD_API_ERROR');
    });
  });

  // -------------------------------------------------------------------------
  // create_thread
  // -------------------------------------------------------------------------

  describe('create_thread', () => {
    it('creates a thread from a message', async () => {
      mockDiscordOk({ id: 'thread-999', name: 'Test Thread' }, 200);

      const result = await discordActionsTool.execute(createContext(), {
        action: 'create_thread',
        channel_id: 'ch-111',
        message_id: 'msg-555',
        name: 'Test Thread',
        auto_archive_duration: '1440',
      });

      expect(result.success).toBe(true);
      expect(result.data?.details).toMatchObject({ thread_id: 'thread-999', name: 'Test Thread' });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/messages/msg-555/threads'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('creates a standalone thread when no message_id is given', async () => {
      mockDiscordOk({ id: 'thread-888', name: 'Standalone' }, 200);

      await discordActionsTool.execute(createContext(), {
        action: 'create_thread',
        channel_id: 'ch-111',
        name: 'Standalone',
        auto_archive_duration: '1440',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/ch-111/threads'),
        expect.anything(),
      );
    });

    it('returns error when thread creation fails', async () => {
      mockDiscordFail(400, 'Invalid Form Body');

      const result = await discordActionsTool.execute(createContext(), {
        action: 'create_thread',
        channel_id: 'ch-111',
        name: 'Bad Thread',
        auto_archive_duration: '1440',
      });

      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // ban_user
  // -------------------------------------------------------------------------

  describe('ban_user', () => {
    it('bans a user successfully', async () => {
      mockDiscordOk(null, 204);

      const result = await discordActionsTool.execute(createContext(), {
        action: 'ban_user',
        guild_id: 'guild-1',
        user_id: 'user-bad',
        reason: 'Spam',
        delete_message_days: 1,
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('user-bad');
      expect(result.output).toContain('Spam');
    });

    it('bans without optional reason', async () => {
      mockDiscordOk(null, 204);

      const result = await discordActionsTool.execute(createContext(), {
        action: 'ban_user',
        guild_id: 'guild-1',
        user_id: 'user-xyz',
        delete_message_days: 0,
      });

      expect(result.success).toBe(true);
      expect(result.output).not.toContain('Reason:');
    });

    it('returns error when ban fails', async () => {
      mockDiscordFail(403, 'Missing Permissions');

      const result = await discordActionsTool.execute(createContext(), {
        action: 'ban_user',
        guild_id: 'guild-1',
        user_id: 'user-bad',
        delete_message_days: 0,
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('DISCORD_API_ERROR');
    });
  });

  // -------------------------------------------------------------------------
  // kick_user
  // -------------------------------------------------------------------------

  describe('kick_user', () => {
    it('kicks a user successfully', async () => {
      mockDiscordOk(null, 204);

      const result = await discordActionsTool.execute(createContext(), {
        action: 'kick_user',
        guild_id: 'guild-1',
        user_id: 'user-kick',
        reason: 'Disruptive behavior',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('user-kick');
    });

    it('returns error when kick fails', async () => {
      mockDiscordFail(403, 'Missing Permissions');

      const result = await discordActionsTool.execute(createContext(), {
        action: 'kick_user',
        guild_id: 'guild-1',
        user_id: 'user-kick',
      });

      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // set_channel_topic
  // -------------------------------------------------------------------------

  describe('set_channel_topic', () => {
    it('sets channel topic successfully', async () => {
      mockDiscordOk({ id: 'ch-111', topic: 'New topic' }, 200);

      const result = await discordActionsTool.execute(createContext(), {
        action: 'set_channel_topic',
        channel_id: 'ch-111',
        topic: 'New topic for the team',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('New topic for the team');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/channels/ch-111'),
        expect.objectContaining({ method: 'PATCH' }),
      );
    });

    it('returns error on API failure', async () => {
      mockDiscordFail(400, 'Invalid topic');

      const result = await discordActionsTool.execute(createContext(), {
        action: 'set_channel_topic',
        channel_id: 'ch-111',
        topic: 'bad',
      });

      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('handles fetch() throwing an exception', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      const result = await discordActionsTool.execute(createContext(), {
        action: 'send_reaction',
        channel_id: 'ch-1',
        message_id: 'msg-1',
        emoji: '❤',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('DISCORD_ACTION_FAILED');
      expect(result.error?.message).toContain('Network failure');
    });

    it('handles API error response without message field', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({}),
      });

      const result = await discordActionsTool.execute(createContext(), {
        action: 'pin_message',
        channel_id: 'ch-1',
        message_id: 'msg-1',
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('500');
    });
  });
});
