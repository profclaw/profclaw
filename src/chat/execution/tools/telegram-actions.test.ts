/**
 * Telegram Actions Tool Tests
 *
 * Tests for src/chat/execution/tools/telegram-actions.ts
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

import { telegramActionsTool } from './telegram-actions.js';
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

function mockTelegramOk(result: unknown = true) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ ok: true, result }),
  });
}

function mockTelegramFail(errorCode = 400, description = 'Bad Request') {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ ok: false, error_code: errorCode, description }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('telegramActionsTool', () => {
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = originalToken;
    }
  });

  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('tool metadata', () => {
    it('has correct name', () => {
      expect(telegramActionsTool.name).toBe('telegram_actions');
    });

    it('requires approval', () => {
      expect(telegramActionsTool.requiresApproval).toBe(true);
    });

    it('has dangerous security level', () => {
      expect(telegramActionsTool.securityLevel).toBe('dangerous');
    });
  });

  // -------------------------------------------------------------------------
  // isAvailable
  // -------------------------------------------------------------------------

  describe('isAvailable()', () => {
    it('returns available: true when TELEGRAM_BOT_TOKEN is set', () => {
      process.env.TELEGRAM_BOT_TOKEN = 'some-token';
      const result = telegramActionsTool.isAvailable?.();
      expect(result?.available).toBe(true);
    });

    it('returns available: false when TELEGRAM_BOT_TOKEN is not set', () => {
      delete process.env.TELEGRAM_BOT_TOKEN;
      const result = telegramActionsTool.isAvailable?.();
      expect(result?.available).toBe(false);
      expect(result?.reason).toContain('TELEGRAM_BOT_TOKEN');
    });
  });

  // -------------------------------------------------------------------------
  // No token
  // -------------------------------------------------------------------------

  describe('no TELEGRAM_BOT_TOKEN', () => {
    it('returns NOT_CONFIGURED error when token is missing', async () => {
      delete process.env.TELEGRAM_BOT_TOKEN;

      const result = await telegramActionsTool.execute(createContext(), {
        action: 'pin_message',
        chat_id: '-100123456789',
        message_id: 42,
        disable_notification: false,
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_CONFIGURED');
    });
  });

  // -------------------------------------------------------------------------
  // pin_message
  // -------------------------------------------------------------------------

  describe('pin_message', () => {
    it('pins a message successfully', async () => {
      mockTelegramOk();

      const result = await telegramActionsTool.execute(createContext(), {
        action: 'pin_message',
        chat_id: '-100123456789',
        message_id: 42,
        disable_notification: false,
      });

      expect(result.success).toBe(true);
      expect(result.data?.action).toBe('pin_message');
      expect(result.output).toContain('42');
      expect(result.output).toContain('-100123456789');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('pinChatMessage'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('pins silently when disable_notification is true', async () => {
      mockTelegramOk();

      const result = await telegramActionsTool.execute(createContext(), {
        action: 'pin_message',
        chat_id: '-100123',
        message_id: 99,
        disable_notification: true,
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('silent');
    });

    it('returns error when pin fails', async () => {
      mockTelegramFail(400, 'CHAT_ADMIN_REQUIRED');

      const result = await telegramActionsTool.execute(createContext(), {
        action: 'pin_message',
        chat_id: '-100bad',
        message_id: 1,
        disable_notification: false,
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TELEGRAM_API_ERROR');
      expect(result.error?.message).toContain('CHAT_ADMIN_REQUIRED');
    });
  });

  // -------------------------------------------------------------------------
  // create_poll
  // -------------------------------------------------------------------------

  describe('create_poll', () => {
    it('creates an anonymous poll successfully', async () => {
      mockTelegramOk({ message_id: 100, poll: { id: 'poll-1' } });

      const result = await telegramActionsTool.execute(createContext(), {
        action: 'create_poll',
        chat_id: '-100chat',
        question: 'Favorite color?',
        options: ['Red', 'Blue', 'Green'],
        is_anonymous: true,
        allows_multiple_answers: false,
      });

      expect(result.success).toBe(true);
      expect(result.data?.action).toBe('create_poll');
      expect(result.output).toContain('Favorite color?');
      expect(result.output).toContain('3 options');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('sendPoll'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('creates a non-anonymous multi-select poll', async () => {
      mockTelegramOk({ message_id: 101 });

      const result = await telegramActionsTool.execute(createContext(), {
        action: 'create_poll',
        chat_id: '-100chat',
        question: 'Best time for meeting?',
        options: ['Mon 10am', 'Tue 2pm', 'Wed 4pm'],
        is_anonymous: false,
        allows_multiple_answers: true,
        open_period: 120,
      });

      expect(result.success).toBe(true);
    });

    it('returns error when poll creation fails', async () => {
      mockTelegramFail(403, 'CHAT_WRITE_FORBIDDEN');

      const result = await telegramActionsTool.execute(createContext(), {
        action: 'create_poll',
        chat_id: '-100bad',
        question: 'Bad poll',
        options: ['A', 'B'],
        is_anonymous: true,
        allows_multiple_answers: false,
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TELEGRAM_API_ERROR');
    });
  });

  // -------------------------------------------------------------------------
  // ban_user
  // -------------------------------------------------------------------------

  describe('ban_user', () => {
    it('permanently bans a user', async () => {
      mockTelegramOk();

      const result = await telegramActionsTool.execute(createContext(), {
        action: 'ban_user',
        chat_id: '-100group',
        user_id: 123456789,
        revoke_messages: false,
      });

      expect(result.success).toBe(true);
      expect(result.data?.action).toBe('ban_user');
      expect(result.output).toContain('123456789');
      expect(result.output).toContain('permanent');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('banChatMember'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('bans a user temporarily with message revocation', async () => {
      mockTelegramOk();

      const untilDate = Math.floor(Date.now() / 1000) + 86400;
      const result = await telegramActionsTool.execute(createContext(), {
        action: 'ban_user',
        chat_id: '-100group',
        user_id: 987654321,
        until_date: untilDate,
        revoke_messages: true,
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('messages revoked');
    });

    it('returns error when ban fails', async () => {
      mockTelegramFail(400, 'USER_NOT_PARTICIPANT');

      const result = await telegramActionsTool.execute(createContext(), {
        action: 'ban_user',
        chat_id: '-100group',
        user_id: 1,
        revoke_messages: false,
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('USER_NOT_PARTICIPANT');
    });
  });

  // -------------------------------------------------------------------------
  // restrict_user
  // -------------------------------------------------------------------------

  describe('restrict_user', () => {
    it('restricts a user from sending messages', async () => {
      mockTelegramOk();

      const result = await telegramActionsTool.execute(createContext(), {
        action: 'restrict_user',
        chat_id: '-100group',
        user_id: 111222333,
        can_send_messages: false,
        can_send_media: false,
        can_send_polls: false,
        can_add_web_page_previews: false,
      });

      expect(result.success).toBe(true);
      expect(result.data?.action).toBe('restrict_user');
      expect(result.output).toContain('111222333');
      expect(result.output).toContain('indefinitely');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('restrictChatMember'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('restricts a user with a time-limited restriction', async () => {
      mockTelegramOk();

      const untilDate = Math.floor(Date.now() / 1000) + 3600;
      const result = await telegramActionsTool.execute(createContext(), {
        action: 'restrict_user',
        chat_id: '-100group',
        user_id: 444555666,
        until_date: untilDate,
        can_send_messages: true,
        can_send_media: true,
        can_send_polls: false,
        can_add_web_page_previews: false,
      });

      expect(result.success).toBe(true);
      // until_date is set, so it should show an ISO date not 'indefinitely'
      expect(result.output).not.toContain('indefinitely');
    });

    it('returns error when restriction fails', async () => {
      mockTelegramFail(400, 'PARTICIPANT_ID_INVALID');

      const result = await telegramActionsTool.execute(createContext(), {
        action: 'restrict_user',
        chat_id: '-100group',
        user_id: 99,
        can_send_messages: false,
        can_send_media: false,
        can_send_polls: false,
        can_add_web_page_previews: false,
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TELEGRAM_API_ERROR');
    });
  });

  // -------------------------------------------------------------------------
  // set_chat_title
  // -------------------------------------------------------------------------

  describe('set_chat_title', () => {
    it('sets chat title successfully', async () => {
      mockTelegramOk();

      const result = await telegramActionsTool.execute(createContext(), {
        action: 'set_chat_title',
        chat_id: '-100channel',
        title: 'Awesome New Team',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Awesome New Team');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('setChatTitle'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('returns error when title update fails', async () => {
      mockTelegramFail(400, 'CHAT_NOT_MODIFIED');

      const result = await telegramActionsTool.execute(createContext(), {
        action: 'set_chat_title',
        chat_id: '-100channel',
        title: 'Same Title',
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('CHAT_NOT_MODIFIED');
    });
  });

  // -------------------------------------------------------------------------
  // set_chat_description
  // -------------------------------------------------------------------------

  describe('set_chat_description', () => {
    it('sets chat description successfully', async () => {
      mockTelegramOk();

      const result = await telegramActionsTool.execute(createContext(), {
        action: 'set_chat_description',
        chat_id: '-100channel',
        description: 'We discuss AI and automation here',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('description updated');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('setChatDescription'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('clears description when empty string provided', async () => {
      mockTelegramOk();

      const result = await telegramActionsTool.execute(createContext(), {
        action: 'set_chat_description',
        chat_id: '-100channel',
        description: '',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('description cleared');
    });

    it('returns error when description update fails', async () => {
      mockTelegramFail(403, 'CHAT_ADMIN_REQUIRED');

      const result = await telegramActionsTool.execute(createContext(), {
        action: 'set_chat_description',
        chat_id: '-100bad',
        description: 'New description',
      });

      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('handles fetch() throwing an exception', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

      const result = await telegramActionsTool.execute(createContext(), {
        action: 'pin_message',
        chat_id: '-100chat',
        message_id: 1,
        disable_notification: false,
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TELEGRAM_ACTION_FAILED');
      expect(result.error?.message).toContain('Network timeout');
      expect(result.error?.retryable).toBe(true);
    });

    it('handles API response with no error code', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ ok: false }),
      });

      const result = await telegramActionsTool.execute(createContext(), {
        action: 'set_chat_title',
        chat_id: '-100chat',
        title: 'Bad',
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('0');
    });
  });
});
