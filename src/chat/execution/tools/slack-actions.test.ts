/**
 * Slack Actions Tool Tests
 *
 * Tests for src/chat/execution/tools/slack-actions.ts
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

import { slackActionsTool } from './slack-actions.js';
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

function mockSlackOk(extra: Record<string, unknown> = {}) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ ok: true, ...extra }),
  });
}

function mockSlackFail(errorKey = 'not_in_channel') {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ ok: false, error: errorKey }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('slackActionsTool', () => {
  const originalToken = process.env.SLACK_BOT_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.SLACK_BOT_TOKEN;
    } else {
      process.env.SLACK_BOT_TOKEN = originalToken;
    }
  });

  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('tool metadata', () => {
    it('has correct name', () => {
      expect(slackActionsTool.name).toBe('slack_actions');
    });

    it('requires approval', () => {
      expect(slackActionsTool.requiresApproval).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // isAvailable
  // -------------------------------------------------------------------------

  describe('isAvailable()', () => {
    it('returns available: true when SLACK_BOT_TOKEN is set', () => {
      process.env.SLACK_BOT_TOKEN = 'some-token';
      const result = slackActionsTool.isAvailable?.();
      expect(result?.available).toBe(true);
    });

    it('returns available: false when SLACK_BOT_TOKEN is not set', () => {
      delete process.env.SLACK_BOT_TOKEN;
      const result = slackActionsTool.isAvailable?.();
      expect(result?.available).toBe(false);
      expect(result?.reason).toContain('SLACK_BOT_TOKEN');
    });
  });

  // -------------------------------------------------------------------------
  // No token
  // -------------------------------------------------------------------------

  describe('no SLACK_BOT_TOKEN', () => {
    it('returns NOT_CONFIGURED error when token is missing', async () => {
      delete process.env.SLACK_BOT_TOKEN;

      const result = await slackActionsTool.execute(createContext(), {
        action: 'add_reaction',
        channel: 'C12345',
        timestamp: '1234567890.000001',
        name: 'thumbsup',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_CONFIGURED');
    });
  });

  // -------------------------------------------------------------------------
  // add_reaction
  // -------------------------------------------------------------------------

  describe('add_reaction', () => {
    it('adds a reaction successfully', async () => {
      mockSlackOk();

      const result = await slackActionsTool.execute(createContext(), {
        action: 'add_reaction',
        channel: 'C12345',
        timestamp: '1234567890.000001',
        name: 'thumbsup',
      });

      expect(result.success).toBe(true);
      expect(result.data?.action).toBe('add_reaction');
      expect(result.output).toContain(':thumbsup:');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('reactions.add'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('returns error on Slack API failure', async () => {
      mockSlackFail('already_reacted');

      const result = await slackActionsTool.execute(createContext(), {
        action: 'add_reaction',
        channel: 'C12345',
        timestamp: '1234567890.000001',
        name: 'thumbsup',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SLACK_API_ERROR');
      expect(result.error?.message).toContain('already_reacted');
    });
  });

  // -------------------------------------------------------------------------
  // pin_message
  // -------------------------------------------------------------------------

  describe('pin_message', () => {
    it('pins a message successfully', async () => {
      mockSlackOk();

      const result = await slackActionsTool.execute(createContext(), {
        action: 'pin_message',
        channel: 'C12345',
        timestamp: '1234567890.000001',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('C12345');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('pins.add'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('returns error when pin fails', async () => {
      mockSlackFail('not_pinnable');

      const result = await slackActionsTool.execute(createContext(), {
        action: 'pin_message',
        channel: 'C12345',
        timestamp: '1234567890.000001',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SLACK_API_ERROR');
    });
  });

  // -------------------------------------------------------------------------
  // create_channel
  // -------------------------------------------------------------------------

  describe('create_channel', () => {
    it('creates a public channel successfully', async () => {
      mockSlackOk({ channel: { id: 'C_NEW', name: 'team-alpha' } });

      const result = await slackActionsTool.execute(createContext(), {
        action: 'create_channel',
        name: 'team-alpha',
        is_private: false,
      });

      expect(result.success).toBe(true);
      expect(result.data?.details.channel_id).toBe('C_NEW');
      expect(result.data?.details.name).toBe('team-alpha');
      expect(result.output).toContain('#team-alpha');
      expect(result.output).toContain('public');
    });

    it('creates a private channel', async () => {
      mockSlackOk({ channel: { id: 'C_PRIV', name: 'private-team' } });

      const result = await slackActionsTool.execute(createContext(), {
        action: 'create_channel',
        name: 'private-team',
        is_private: true,
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('private');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('conversations.create'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('returns error when channel name conflicts', async () => {
      mockSlackFail('name_taken');

      const result = await slackActionsTool.execute(createContext(), {
        action: 'create_channel',
        name: 'existing-channel',
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('name_taken');
    });
  });

  // -------------------------------------------------------------------------
  // set_topic
  // -------------------------------------------------------------------------

  describe('set_topic', () => {
    it('sets channel topic successfully', async () => {
      mockSlackOk();

      const result = await slackActionsTool.execute(createContext(), {
        action: 'set_topic',
        channel: 'C12345',
        topic: 'Sprint planning every Monday at 10am',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Sprint planning');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('conversations.setTopic'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('returns error on failure', async () => {
      mockSlackFail('channel_not_found');

      const result = await slackActionsTool.execute(createContext(), {
        action: 'set_topic',
        channel: 'C_GONE',
        topic: 'New topic',
      });

      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // invite_user
  // -------------------------------------------------------------------------

  describe('invite_user', () => {
    it('invites multiple users to a channel', async () => {
      mockSlackOk();

      const result = await slackActionsTool.execute(createContext(), {
        action: 'invite_user',
        channel: 'C12345',
        users: ['U111AAA', 'U222BBB'],
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('2 user(s)');
      expect(result.output).toContain('U111AAA');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('conversations.invite'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('returns error when user is already in channel', async () => {
      mockSlackFail('already_in_channel');

      const result = await slackActionsTool.execute(createContext(), {
        action: 'invite_user',
        channel: 'C12345',
        users: ['U111AAA'],
      });

      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // archive_channel
  // -------------------------------------------------------------------------

  describe('archive_channel', () => {
    it('archives a channel successfully', async () => {
      mockSlackOk();

      const result = await slackActionsTool.execute(createContext(), {
        action: 'archive_channel',
        channel: 'C_OLD',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('C_OLD');
      expect(result.output).toContain('archived');
    });

    it('returns error when archiving fails', async () => {
      mockSlackFail('cant_archive_general');

      const result = await slackActionsTool.execute(createContext(), {
        action: 'archive_channel',
        channel: 'C_GENERAL',
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('cant_archive_general');
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('handles fetch() throwing an exception', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await slackActionsTool.execute(createContext(), {
        action: 'add_reaction',
        channel: 'C12345',
        timestamp: '111.222',
        name: 'fire',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SLACK_ACTION_FAILED');
      expect(result.error?.message).toContain('Connection refused');
      expect(result.error?.retryable).toBe(true);
    });
  });
});
