/**
 * Tests for Matrix Provider
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock logger before any imports that use it
vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  matrixProvider,
  setMatrixConfig,
  clearMatrixConfig,
  parseSyncResponse,
  MatrixMsgType,
  MatrixRoomType,
} from '../matrix/index.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const validConfig = {
  id: 'matrix-test',
  provider: 'matrix' as const,
  homeserverUrl: 'https://matrix.example.com',
  accessToken: 'syt_test_token_12345',
  userId: '@bot:matrix.example.com',
  enabled: true,
  enableEncryption: false,
};

const minimalConfig = {
  id: 'matrix-min',
  provider: 'matrix' as const,
  enabled: true,
  enableEncryption: false,
};

function makeMatrixEvent(overrides: Record<string, unknown> = {}) {
  return {
    event_id: '$event123:matrix.example.com',
    type: 'm.room.message',
    room_id: '!room123:matrix.example.com',
    sender: '@alice:matrix.example.com',
    origin_server_ts: 1700000000000,
    content: {
      msgtype: 'm.text',
      body: 'Hello from Matrix',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Provider metadata
// ---------------------------------------------------------------------------

describe('Matrix Provider', () => {
  describe('provider metadata', () => {
    it('has the correct provider id', () => {
      expect(matrixProvider.meta.id).toBe('matrix');
    });

    it('has the correct provider name', () => {
      expect(matrixProvider.meta.name).toBe('Matrix');
    });

    it('has a description', () => {
      expect(typeof matrixProvider.meta.description).toBe('string');
      expect(matrixProvider.meta.description.length).toBeGreaterThan(0);
    });

    it('has correct capabilities: send and receive', () => {
      expect(matrixProvider.capabilities.send).toBe(true);
      expect(matrixProvider.capabilities.receive).toBe(true);
    });

    it('has thread support', () => {
      expect(matrixProvider.capabilities.threads).toBe(true);
    });

    it('has no OAuth or webhooks', () => {
      expect(matrixProvider.capabilities.oauth).toBe(false);
      expect(matrixProvider.capabilities.webhooks).toBe(false);
    });

    it('has no slash commands or interactive components', () => {
      expect(matrixProvider.capabilities.slashCommands).toBe(false);
      expect(matrixProvider.capabilities.interactiveComponents).toBe(false);
    });

    it('exposes outbound adapter with send function', () => {
      expect(matrixProvider.outbound).toBeDefined();
      expect(typeof matrixProvider.outbound.send).toBe('function');
    });

    it('exposes inbound adapter', () => {
      expect(matrixProvider.inbound).toBeDefined();
      expect(typeof matrixProvider.inbound.parseMessage).toBe('function');
      expect(typeof matrixProvider.inbound.parseCommand).toBe('function');
      expect(typeof matrixProvider.inbound.parseAction).toBe('function');
    });

    it('exposes status adapter', () => {
      expect(matrixProvider.status).toBeDefined();
      expect(typeof matrixProvider.status.isConfigured).toBe('function');
      expect(typeof matrixProvider.status.checkHealth).toBe('function');
    });

    it('has auth adapter that throws for OAuth getAuthUrl', () => {
      expect(() => matrixProvider.auth?.getAuthUrl('state')).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Config management
  // ---------------------------------------------------------------------------

  describe('config management', () => {
    afterEach(() => {
      clearMatrixConfig();
    });

    it('setMatrixConfig applies the config (verified via outbound behaviour)', async () => {
      setMatrixConfig(validConfig);
      // With a valid config set, send should fail on network, not on missing token
      const result = await matrixProvider.outbound.send({
        provider: 'matrix',
        to: '!room123:matrix.example.com',
        text: 'Test',
      });
      // Will fail at fetch (network), not at "Access token not configured"
      expect(result.success).toBe(false);
      expect(result.error).not.toBe('Access token not configured');
    });

    it('clearMatrixConfig causes outbound send to report missing token', async () => {
      setMatrixConfig(validConfig);
      clearMatrixConfig();
      const result = await matrixProvider.outbound.send({
        provider: 'matrix',
        to: '!room123:matrix.example.com',
        text: 'Test',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Access token not configured');
    });
  });

  // ---------------------------------------------------------------------------
  // Status adapter
  // ---------------------------------------------------------------------------

  describe('status adapter — isConfigured', () => {
    it('returns true when homeserverUrl, accessToken and userId are present', () => {
      expect(
        matrixProvider.status.isConfigured({
          id: 'x',
          provider: 'matrix',
          homeserverUrl: 'https://matrix.org',
          accessToken: 'token',
          userId: '@bot:matrix.org',
          enabled: true,
          enableEncryption: false,
        })
      ).toBe(true);
    });

    it('returns false when accessToken is missing', () => {
      expect(
        matrixProvider.status.isConfigured({
          id: 'x',
          provider: 'matrix',
          homeserverUrl: 'https://matrix.org',
          userId: '@bot:matrix.org',
          enabled: true,
          enableEncryption: false,
        })
      ).toBe(false);
    });

    it('returns false when homeserverUrl is missing', () => {
      expect(
        matrixProvider.status.isConfigured({
          id: 'x',
          provider: 'matrix',
          accessToken: 'token',
          userId: '@bot:matrix.org',
          enabled: true,
          enableEncryption: false,
        })
      ).toBe(false);
    });

    it('returns false when userId is missing', () => {
      expect(
        matrixProvider.status.isConfigured({
          id: 'x',
          provider: 'matrix',
          homeserverUrl: 'https://matrix.org',
          accessToken: 'token',
          enabled: true,
          enableEncryption: false,
        })
      ).toBe(false);
    });
  });

  describe('status adapter — checkHealth', () => {
    it('returns connected:false when homeserverUrl is missing', async () => {
      const health = await matrixProvider.status.checkHealth({
        id: 'x',
        provider: 'matrix',
        accessToken: 'token',
        enabled: true,
        enableEncryption: false,
      });
      expect(health.connected).toBe(false);
      expect(health.error).toContain('required');
    });

    it('returns connected:false when accessToken is missing', async () => {
      const health = await matrixProvider.status.checkHealth({
        id: 'x',
        provider: 'matrix',
        homeserverUrl: 'https://matrix.org',
        enabled: true,
        enableEncryption: false,
      });
      expect(health.connected).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Inbound adapter
  // ---------------------------------------------------------------------------

  describe('inbound adapter — parseMessage', () => {
    beforeEach(() => {
      clearMatrixConfig();
    });

    it('returns null for an empty payload object', () => {
      // Matrix parseMessage casts payload as MatrixEvent; an empty object lacks
      // type === 'm.room.message', so it returns null safely.
      expect(matrixProvider.inbound.parseMessage({})).toBeNull();
    });

    it('returns null for non-room-message event types', () => {
      const event = makeMatrixEvent({ type: 'm.room.redaction' });
      expect(matrixProvider.inbound.parseMessage(event)).toBeNull();
    });

    it('returns null for events missing body', () => {
      const event = makeMatrixEvent({ content: { msgtype: 'm.text' } });
      expect(matrixProvider.inbound.parseMessage(event)).toBeNull();
    });

    it('parses a standard text message (direct event)', () => {
      const event = makeMatrixEvent();
      const msg = matrixProvider.inbound.parseMessage(event);
      expect(msg).not.toBeNull();
      expect(msg?.provider).toBe('matrix');
      expect(msg?.text).toBe('Hello from Matrix');
      expect(msg?.senderId).toBe('@alice:matrix.example.com');
      expect(msg?.senderName).toBe('alice');
    });

    it('parses a wrapped { event, roomId, isDirect } payload', () => {
      const event = makeMatrixEvent();
      const msg = matrixProvider.inbound.parseMessage({
        event,
        roomId: '!room123:matrix.example.com',
        isDirect: true,
      });
      expect(msg).not.toBeNull();
      expect(msg?.chatType).toBe('direct');
    });

    it('identifies thread messages via m.relates_to', () => {
      const event = makeMatrixEvent({
        content: {
          msgtype: 'm.text',
          body: 'Thread reply',
          'm.relates_to': {
            rel_type: 'm.thread',
            event_id: '$root_event:matrix.example.com',
          },
        },
      });
      const msg = matrixProvider.inbound.parseMessage(event);
      expect(msg?.chatType).toBe('thread');
      expect(msg?.threadId).toBe('$root_event:matrix.example.com');
    });

    it('identifies channel rooms (room_id starting with #)', () => {
      const event = makeMatrixEvent({ room_id: '#general:matrix.example.com' });
      const msg = matrixProvider.inbound.parseMessage(event);
      expect(msg?.chatType).toBe('channel');
    });

    it('parses reply-to events', () => {
      const event = makeMatrixEvent({
        content: {
          msgtype: 'm.text',
          body: 'Reply',
          'm.relates_to': {
            'm.in_reply_to': { event_id: '$original:matrix.example.com' },
          },
        },
      });
      const msg = matrixProvider.inbound.parseMessage(event);
      expect(msg?.replyToId).toBe('$original:matrix.example.com');
    });

    it('returns null for events from rooms not in the allowlist', () => {
      setMatrixConfig({
        ...validConfig,
        allowedRoomIds: ['!allowed:matrix.example.com'],
      });
      const event = makeMatrixEvent({ room_id: '!other:matrix.example.com' });
      const msg = matrixProvider.inbound.parseMessage(event);
      expect(msg).toBeNull();
      clearMatrixConfig();
    });

    it('parses image attachment events', () => {
      const event = makeMatrixEvent({
        content: {
          msgtype: 'm.image',
          body: 'photo.jpg',
          url: 'mxc://matrix.example.com/abc123',
          info: { mimetype: 'image/jpeg', size: 4096 },
        },
      });
      const msg = matrixProvider.inbound.parseMessage(event);
      expect(msg).not.toBeNull();
      expect(msg?.attachments).toBeDefined();
      expect(msg?.attachments?.[0].type).toBe('image');
      expect(msg?.attachments?.[0].url).toBe('mxc://matrix.example.com/abc123');
    });
  });

  describe('inbound adapter — parseCommand and parseAction', () => {
    it('parseCommand always returns null (Matrix has no native slash commands)', () => {
      expect(matrixProvider.inbound.parseCommand({})).toBeNull();
      expect(matrixProvider.inbound.parseCommand(makeMatrixEvent())).toBeNull();
    });

    it('parseAction always returns null (Matrix has no interactive components)', () => {
      expect(matrixProvider.inbound.parseAction({})).toBeNull();
    });
  });

  describe('inbound adapter — buildCommandResponse', () => {
    it('returns m.text msgtype for non-ephemeral responses', () => {
      const result = matrixProvider.inbound.buildCommandResponse({
        text: 'Hello',
        responseType: 'in_channel',
      }) as Record<string, unknown>;
      expect(result['msgtype']).toBe(MatrixMsgType.TEXT);
      expect(result['body']).toBe('Hello');
    });

    it('returns m.notice msgtype for ephemeral responses', () => {
      const result = matrixProvider.inbound.buildCommandResponse({
        text: 'Quiet',
        responseType: 'ephemeral',
      }) as Record<string, unknown>;
      expect(result['msgtype']).toBe(MatrixMsgType.NOTICE);
    });
  });

  // ---------------------------------------------------------------------------
  // Outbound adapter
  // ---------------------------------------------------------------------------

  describe('outbound adapter — send', () => {
    afterEach(() => {
      clearMatrixConfig();
    });

    it('returns error when no config is set', async () => {
      const result = await matrixProvider.outbound.send({
        provider: 'matrix',
        to: '!room:matrix.example.com',
        text: 'Hi',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Access token not configured');
    });

    it('returns error when "to" room is missing', async () => {
      setMatrixConfig(validConfig);
      const result = await matrixProvider.outbound.send({
        provider: 'matrix',
        to: '',
        text: 'Hi',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Target room ID (to) is required');
    });

    it('returns error when room is not in allowlist', async () => {
      setMatrixConfig({
        ...validConfig,
        allowedRoomIds: ['!allowed:matrix.example.com'],
      });
      const result = await matrixProvider.outbound.send({
        provider: 'matrix',
        to: '!blocked:matrix.example.com',
        text: 'Hi',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not in the allowlist');
    });
  });

  // ---------------------------------------------------------------------------
  // parseSyncResponse utility
  // ---------------------------------------------------------------------------

  describe('parseSyncResponse', () => {
    beforeEach(() => {
      clearMatrixConfig();
    });

    it('returns an empty array for an empty sync response', () => {
      const result = parseSyncResponse({ next_batch: 'batch1' });
      expect(result).toEqual([]);
    });

    it('returns an empty array when joined rooms have no timeline events', () => {
      const result = parseSyncResponse({
        next_batch: 'batch1',
        rooms: {
          join: {
            '!room1:matrix.example.com': {
              timeline: { events: [] },
            },
          },
        },
      });
      expect(result).toEqual([]);
    });

    it('parses m.room.message events from joined rooms', () => {
      const event = makeMatrixEvent();
      const result = parseSyncResponse({
        next_batch: 'batch2',
        rooms: {
          join: {
            '!room123:matrix.example.com': {
              timeline: { events: [event] },
            },
          },
        },
      });
      expect(result.length).toBe(1);
      expect(result[0].provider).toBe('matrix');
      expect(result[0].text).toBe('Hello from Matrix');
    });

    it('correctly marks direct rooms using directRoomIds set', () => {
      const event = makeMatrixEvent();
      const directRooms = new Set(['!room123:matrix.example.com']);
      const result = parseSyncResponse(
        {
          next_batch: 'batch3',
          rooms: {
            join: {
              '!room123:matrix.example.com': {
                timeline: { events: [event] },
              },
            },
          },
        },
        directRooms
      );
      expect(result[0].chatType).toBe('direct');
    });

    it('skips non-m.room.message events', () => {
      const reactionEvent = makeMatrixEvent({ type: 'm.reaction' });
      const result = parseSyncResponse({
        next_batch: 'batch4',
        rooms: {
          join: {
            '!room123:matrix.example.com': {
              timeline: { events: [reactionEvent] },
            },
          },
        },
      });
      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Exported constants
  // ---------------------------------------------------------------------------

  describe('exported constants', () => {
    it('MatrixMsgType exposes expected values', () => {
      expect(MatrixMsgType.TEXT).toBe('m.text');
      expect(MatrixMsgType.IMAGE).toBe('m.image');
      expect(MatrixMsgType.NOTICE).toBe('m.notice');
    });

    it('MatrixRoomType exposes expected values', () => {
      expect(MatrixRoomType.DIRECT).toBe('m.direct');
      expect(MatrixRoomType.GROUP).toBe('group');
    });
  });
});
