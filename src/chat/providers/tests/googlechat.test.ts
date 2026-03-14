/**
 * Tests for Google Chat Provider
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
  googlechatProvider,
  setGoogleChatConfig,
  clearGoogleChatConfig,
  buildTextCard,
  buildButtonCard,
  GoogleChatEventType,
  GoogleChatSpaceType,
} from '../googlechat/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const webhookOnlyConfig = {
  id: 'gc-webhook',
  provider: 'googlechat' as const,
  enabled: true,
  webhookUrl: 'https://chat.googleapis.com/v1/spaces/AAAA/messages?key=fake&token=fake',
};

const serviceAccountConfig = {
  id: 'gc-sa',
  provider: 'googlechat' as const,
  enabled: true,
  serviceAccountKey: JSON.stringify({
    client_email: 'bot@project.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nfakekey\n-----END PRIVATE KEY-----\n',
    token_uri: 'https://oauth2.googleapis.com/token',
  }),
};

function makeMessageEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: GoogleChatEventType.MESSAGE,
    eventTime: '2024-01-01T00:00:00Z',
    space: {
      name: 'spaces/AAAA',
      type: 'ROOM',
      displayName: 'General',
    },
    message: {
      name: 'spaces/AAAA/messages/MSG1',
      sender: {
        name: 'users/12345',
        displayName: 'Alice',
        email: 'alice@example.com',
        type: 'HUMAN',
      },
      createTime: '2024-01-01T00:00:00Z',
      text: 'Hello from Google Chat',
      thread: { name: 'spaces/AAAA/threads/THREAD1' },
    },
    user: {
      name: 'users/12345',
      displayName: 'Alice',
      email: 'alice@example.com',
    },
    ...overrides,
  };
}

function makeCardClickedEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: GoogleChatEventType.CARD_CLICKED,
    eventTime: '2024-01-01T00:00:00Z',
    space: {
      name: 'spaces/AAAA',
      type: 'ROOM',
    },
    message: {
      name: 'spaces/AAAA/messages/MSG2',
      sender: { name: 'users/BOT', type: 'BOT' },
      createTime: '2024-01-01T00:00:00Z',
    },
    user: {
      name: 'users/12345',
      displayName: 'Alice',
    },
    action: {
      actionMethodName: 'approve_task',
      parameters: [{ key: 'taskId', value: 'task-42' }],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Provider metadata
// ---------------------------------------------------------------------------

describe('Google Chat Provider', () => {
  describe('provider metadata', () => {
    it('has the correct provider id', () => {
      expect(googlechatProvider.meta.id).toBe('googlechat');
    });

    it('has the correct provider name', () => {
      expect(googlechatProvider.meta.name).toBe('Google Chat');
    });

    it('has a non-empty description', () => {
      expect(typeof googlechatProvider.meta.description).toBe('string');
      expect(googlechatProvider.meta.description.length).toBeGreaterThan(0);
    });

    it('has correct capabilities: send and receive', () => {
      expect(googlechatProvider.capabilities.send).toBe(true);
      expect(googlechatProvider.capabilities.receive).toBe(true);
    });

    it('supports interactive components (Cards v2)', () => {
      expect(googlechatProvider.capabilities.interactiveComponents).toBe(true);
    });

    it('supports rich blocks', () => {
      expect(googlechatProvider.capabilities.richBlocks).toBe(true);
    });

    it('supports threads', () => {
      expect(googlechatProvider.capabilities.threads).toBe(true);
    });

    it('does not support reactions', () => {
      expect(googlechatProvider.capabilities.reactions).toBe(false);
    });

    it('supports webhooks', () => {
      expect(googlechatProvider.capabilities.webhooks).toBe(true);
    });

    it('exposes outbound adapter', () => {
      expect(googlechatProvider.outbound).toBeDefined();
      expect(typeof googlechatProvider.outbound.send).toBe('function');
    });

    it('exposes inbound adapter', () => {
      expect(googlechatProvider.inbound).toBeDefined();
      expect(typeof googlechatProvider.inbound.parseMessage).toBe('function');
      expect(typeof googlechatProvider.inbound.parseCommand).toBe('function');
      expect(typeof googlechatProvider.inbound.parseAction).toBe('function');
    });

    it('exposes status adapter', () => {
      expect(googlechatProvider.status).toBeDefined();
      expect(typeof googlechatProvider.status.isConfigured).toBe('function');
      expect(typeof googlechatProvider.status.checkHealth).toBe('function');
    });

    it('has no auth adapter (no OAuth flow)', () => {
      expect(googlechatProvider.auth).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Config management
  // ---------------------------------------------------------------------------

  describe('config management', () => {
    afterEach(() => {
      clearGoogleChatConfig();
    });

    it('clearGoogleChatConfig causes send to report not configured', async () => {
      clearGoogleChatConfig();
      const result = await googlechatProvider.outbound.send({
        provider: 'googlechat',
        to: 'spaces/AAAA',
        text: 'Hi',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Google Chat not configured');
    });

    it('setGoogleChatConfig with webhook config enables send (fails at network, not config)', async () => {
      setGoogleChatConfig(webhookOnlyConfig);
      const result = await googlechatProvider.outbound.send({
        provider: 'googlechat',
        to: 'spaces/AAAA',
        text: 'Hi',
      });
      // Network will fail; should NOT be "Google Chat not configured"
      expect(result.error).not.toBe('Google Chat not configured');
    });
  });

  // ---------------------------------------------------------------------------
  // Status adapter
  // ---------------------------------------------------------------------------

  describe('status adapter — isConfigured', () => {
    it('returns true when webhookUrl is set', () => {
      expect(
        googlechatProvider.status.isConfigured({
          id: 'x',
          provider: 'googlechat',
          enabled: true,
          webhookUrl: 'https://chat.googleapis.com/v1/spaces/X/messages?key=k&token=t',
        })
      ).toBe(true);
    });

    it('returns true when serviceAccountKey is set', () => {
      expect(
        googlechatProvider.status.isConfigured({
          id: 'x',
          provider: 'googlechat',
          enabled: true,
          serviceAccountKey: '{"client_email":"bot@project.iam.gserviceaccount.com","private_key":"key"}',
        })
      ).toBe(true);
    });

    it('returns false when neither webhookUrl nor serviceAccountKey are set', () => {
      expect(
        googlechatProvider.status.isConfigured({
          id: 'x',
          provider: 'googlechat',
          enabled: true,
        })
      ).toBe(false);
    });
  });

  describe('status adapter — checkHealth', () => {
    it('returns connected:false when neither serviceAccountKey nor webhookUrl are set', async () => {
      const health = await googlechatProvider.status.checkHealth({
        id: 'x',
        provider: 'googlechat',
        enabled: true,
      });
      expect(health.connected).toBe(false);
      expect(health.error).toContain('No webhook URL or service account key');
    });
  });

  // ---------------------------------------------------------------------------
  // Inbound adapter — parseMessage
  // ---------------------------------------------------------------------------

  describe('inbound adapter — parseMessage', () => {
    beforeEach(() => {
      clearGoogleChatConfig();
    });

    it('returns null for non-MESSAGE event types', () => {
      const event = makeMessageEvent({ type: GoogleChatEventType.ADDED_TO_SPACE });
      expect(googlechatProvider.inbound.parseMessage(event)).toBeNull();
    });

    it('returns null for MESSAGE events without a message body', () => {
      const event = { ...makeMessageEvent(), message: undefined };
      expect(googlechatProvider.inbound.parseMessage(event)).toBeNull();
    });

    it('returns null for MESSAGE events without a sender', () => {
      const event = makeMessageEvent();
      (event.message as Record<string, unknown>)['sender'] = undefined;
      expect(googlechatProvider.inbound.parseMessage(event)).toBeNull();
    });

    it('parses a standard room message', () => {
      const event = makeMessageEvent();
      const msg = googlechatProvider.inbound.parseMessage(event);
      expect(msg).not.toBeNull();
      expect(msg?.provider).toBe('googlechat');
      expect(msg?.text).toBe('Hello from Google Chat');
      expect(msg?.senderId).toBe('users/12345');
      expect(msg?.senderName).toBe('Alice');
      expect(msg?.senderUsername).toBe('alice@example.com');
    });

    it('maps ROOM space type to group chatType', () => {
      const msg = googlechatProvider.inbound.parseMessage(makeMessageEvent());
      expect(msg?.chatType).toBe('group');
    });

    it('maps DM space type to direct chatType', () => {
      const event = makeMessageEvent({
        space: { name: 'spaces/BBBB', type: 'DM' },
      });
      const msg = googlechatProvider.inbound.parseMessage(event);
      expect(msg?.chatType).toBe('direct');
    });

    it('captures thread name as threadId', () => {
      const msg = googlechatProvider.inbound.parseMessage(makeMessageEvent());
      expect(msg?.threadId).toBe('spaces/AAAA/threads/THREAD1');
    });

    it('captures space displayName as chatName', () => {
      const msg = googlechatProvider.inbound.parseMessage(makeMessageEvent());
      expect(msg?.chatName).toBe('General');
    });

    it('returns null for messages from disallowed spaces when allowedSpaceIds is set', () => {
      setGoogleChatConfig({
        ...webhookOnlyConfig,
        allowedSpaceIds: ['BBBB'],
      });
      const msg = googlechatProvider.inbound.parseMessage(makeMessageEvent());
      expect(msg).toBeNull();
      clearGoogleChatConfig();
    });

    it('parses messages from allowed spaces when allowedSpaceIds is set', () => {
      setGoogleChatConfig({
        ...webhookOnlyConfig,
        allowedSpaceIds: ['AAAA'],
      });
      const msg = googlechatProvider.inbound.parseMessage(makeMessageEvent());
      expect(msg).not.toBeNull();
      clearGoogleChatConfig();
    });

    it('includes attachment info when message has attachments', () => {
      const event = makeMessageEvent();
      (event.message as Record<string, unknown>)['attachment'] = [
        {
          contentName: 'photo.png',
          contentType: 'image/png',
          downloadUri: 'https://example.com/photo.png',
        },
      ];
      const msg = googlechatProvider.inbound.parseMessage(event);
      expect(msg?.attachments).toBeDefined();
      expect(msg?.attachments?.[0].type).toBe('image');
      expect(msg?.attachments?.[0].name).toBe('photo.png');
    });
  });

  // ---------------------------------------------------------------------------
  // Inbound adapter — parseCommand
  // ---------------------------------------------------------------------------

  describe('inbound adapter — parseCommand', () => {
    it('returns null for non-MESSAGE events', () => {
      const event = makeMessageEvent({ type: GoogleChatEventType.CARD_CLICKED });
      expect(googlechatProvider.inbound.parseCommand(event)).toBeNull();
    });

    it('returns null for MESSAGE events without SLASH_COMMAND annotations', () => {
      expect(googlechatProvider.inbound.parseCommand(makeMessageEvent())).toBeNull();
    });

    it('parses a SLASH_COMMAND annotation', () => {
      const event = makeMessageEvent();
      (event.message as Record<string, unknown>)['annotations'] = [
        {
          type: 'SLASH_COMMAND',
          slashCommand: {
            bot: { name: 'users/BOT' },
            type: 'INVOKE',
            commandName: 'help',
            commandId: '1',
          },
        },
      ];
      (event.message as Record<string, unknown>)['argumentText'] = 'tasks';
      const cmd = googlechatProvider.inbound.parseCommand(event);
      expect(cmd).not.toBeNull();
      expect(cmd?.command).toBe('/help');
      expect(cmd?.text).toBe('tasks');
      expect(cmd?.provider).toBe('googlechat');
    });
  });

  // ---------------------------------------------------------------------------
  // Inbound adapter — parseAction
  // ---------------------------------------------------------------------------

  describe('inbound adapter — parseAction', () => {
    it('returns null for non-CARD_CLICKED events', () => {
      expect(googlechatProvider.inbound.parseAction(makeMessageEvent())).toBeNull();
    });

    it('returns null for CARD_CLICKED events without actionMethodName', () => {
      const event = makeCardClickedEvent();
      (event as Record<string, unknown>)['action'] = {};
      expect(googlechatProvider.inbound.parseAction(event)).toBeNull();
    });

    it('parses a CARD_CLICKED event with action parameters', () => {
      const action = googlechatProvider.inbound.parseAction(makeCardClickedEvent());
      expect(action).not.toBeNull();
      expect(action?.provider).toBe('googlechat');
      expect(action?.actionId).toBe('approve_task');
      expect(action?.value).toBe('task-42');
      expect(action?.type).toBe('button');
    });

    it('uses actionMethodName as value when no parameters are present', () => {
      const event = makeCardClickedEvent({
        action: { actionMethodName: 'dismiss' },
      });
      const action = googlechatProvider.inbound.parseAction(event);
      expect(action?.value).toBe('dismiss');
    });
  });

  // ---------------------------------------------------------------------------
  // Inbound adapter — buildCommandResponse / buildActionResponse
  // ---------------------------------------------------------------------------

  describe('inbound adapter — buildCommandResponse', () => {
    it('returns a body with text and NEW_MESSAGE actionResponse', () => {
      const result = googlechatProvider.inbound.buildCommandResponse({
        text: 'Response text',
        responseType: 'in_channel',
      }) as Record<string, unknown>;
      expect(result['text']).toBe('Response text');
      expect((result['actionResponse'] as Record<string, unknown>)?.['type']).toBe('NEW_MESSAGE');
    });

    it('returns EPHEMERAL actionResponse for ephemeral responses', () => {
      const result = googlechatProvider.inbound.buildCommandResponse({
        text: 'Quiet',
        responseType: 'ephemeral',
      }) as Record<string, unknown>;
      expect((result['actionResponse'] as Record<string, unknown>)?.['type']).toBe('EPHEMERAL');
    });
  });

  describe('inbound adapter — buildActionResponse', () => {
    it('returns UPDATE_MESSAGE actionResponse', () => {
      const result = googlechatProvider.inbound.buildActionResponse({
        text: 'Updated',
      }) as Record<string, unknown>;
      expect((result['actionResponse'] as Record<string, unknown>)?.['type']).toBe('UPDATE_MESSAGE');
    });
  });

  // ---------------------------------------------------------------------------
  // Outbound adapter — send error paths
  // ---------------------------------------------------------------------------

  describe('outbound adapter — send', () => {
    afterEach(() => {
      clearGoogleChatConfig();
    });

    it('returns error when no config is set', async () => {
      const result = await googlechatProvider.outbound.send({
        provider: 'googlechat',
        to: 'spaces/AAAA',
        text: 'Hi',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Google Chat not configured');
    });

    it('returns error when neither webhookUrl nor serviceAccountKey are configured', async () => {
      setGoogleChatConfig({ id: 'x', provider: 'googlechat', enabled: true });
      const result = await googlechatProvider.outbound.send({
        provider: 'googlechat',
        to: 'spaces/AAAA',
        text: 'Hi',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No webhook URL or service account key');
    });
  });

  // ---------------------------------------------------------------------------
  // Utility exports
  // ---------------------------------------------------------------------------

  describe('buildTextCard', () => {
    it('builds a card with a header and text paragraph widget', () => {
      const card = buildTextCard('Title', 'Body text');
      expect(card.card.header?.title).toBe('Title');
      expect(card.card.sections?.[0].widgets[0].textParagraph?.text).toBe('Body text');
    });

    it('uses default cardId when not provided', () => {
      const card = buildTextCard('T', 'B');
      expect(card.cardId).toBe('text_card');
    });

    it('uses custom cardId when provided', () => {
      const card = buildTextCard('T', 'B', 'my_card');
      expect(card.cardId).toBe('my_card');
    });
  });

  describe('buildButtonCard', () => {
    it('builds a card with buttons', () => {
      const card = buildButtonCard('Actions', [
        { label: 'Approve', actionMethodName: 'approve' },
        { label: 'Reject', actionMethodName: 'reject' },
      ]);
      const buttons = card.card.sections?.[0].widgets[0].buttonList?.buttons;
      expect(buttons?.length).toBe(2);
      expect(buttons?.[0].text).toBe('Approve');
      expect(buttons?.[1].text).toBe('Reject');
    });

    it('uses default cardId when not provided', () => {
      const card = buildButtonCard('T', []);
      expect(card.cardId).toBe('button_card');
    });
  });

  describe('exported constants', () => {
    it('GoogleChatEventType has expected keys', () => {
      expect(GoogleChatEventType.MESSAGE).toBe('MESSAGE');
      expect(GoogleChatEventType.CARD_CLICKED).toBe('CARD_CLICKED');
      expect(GoogleChatEventType.ADDED_TO_SPACE).toBe('ADDED_TO_SPACE');
      expect(GoogleChatEventType.REMOVED_FROM_SPACE).toBe('REMOVED_FROM_SPACE');
    });

    it('GoogleChatSpaceType has expected keys', () => {
      expect(GoogleChatSpaceType.ROOM).toBe('ROOM');
      expect(GoogleChatSpaceType.DM).toBe('DM');
      expect(GoogleChatSpaceType.GROUP_CHAT).toBe('GROUP_CHAT');
    });
  });
});
