/**
 * Tests for Microsoft Teams Provider
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
  msteamsProvider,
  setTeamsConfig,
  clearTeamsConfig,
  isTeamsSenderAllowed,
  buildProactiveTarget,
  extractTeamsChannelData,
  isTeamsActivity,
  isMessageReactionActivity,
  parseReactionActivity,
  verifyTeamsSignature,
  ActivityType,
  ChannelId,
} from '../msteams/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validConfig = {
  id: 'teams-test',
  provider: 'msteams' as const,
  enabled: true,
  appId: 'app-id-123',
  appPassword: 'app-password-secret',
  tenantId: 'tenant-id-456',
};

function makeMessageActivity(overrides: Record<string, unknown> = {}) {
  return {
    type: ActivityType.MESSAGE,
    id: 'activity-id-001',
    timestamp: '2024-01-01T00:00:00Z',
    serviceUrl: 'https://smba.trafficmanager.net/apis',
    channelId: ChannelId.MSTEAMS,
    from: {
      id: 'user-id-001',
      name: 'Alice',
      aadObjectId: 'aad-alice',
      role: 'user',
    },
    conversation: {
      id: 'conv-id-001',
      name: 'General',
      isGroup: true,
      conversationType: 'channel',
      tenantId: 'tenant-id-456',
    },
    recipient: {
      id: 'bot-id-001',
      name: 'GLINR Bot',
      role: 'bot',
    },
    text: 'Hello Teams',
    channelData: {
      team: { id: 'team-id-001', name: 'Engineering' },
      channel: { id: 'channel-id-001', name: 'General' },
    },
    ...overrides,
  };
}

function makeInvokeActivity(name: string, value: Record<string, unknown> = {}) {
  return {
    type: ActivityType.INVOKE,
    id: 'invoke-id-001',
    timestamp: '2024-01-01T00:00:00Z',
    serviceUrl: 'https://smba.trafficmanager.net/apis',
    channelId: ChannelId.MSTEAMS,
    from: {
      id: 'user-id-001',
      name: 'Alice',
      role: 'user',
    },
    conversation: {
      id: 'conv-id-001',
      conversationType: 'channel',
    },
    recipient: { id: 'bot-id-001', role: 'bot' },
    name,
    value,
  };
}

// ---------------------------------------------------------------------------
// Provider metadata
// ---------------------------------------------------------------------------

describe('Microsoft Teams Provider', () => {
  describe('provider metadata', () => {
    it('has the correct provider id', () => {
      expect(msteamsProvider.meta.id).toBe('msteams');
    });

    it('has the correct provider name', () => {
      expect(msteamsProvider.meta.name).toBe('Microsoft Teams');
    });

    it('has a non-empty description', () => {
      expect(typeof msteamsProvider.meta.description).toBe('string');
      expect(msteamsProvider.meta.description.length).toBeGreaterThan(0);
    });

    it('has correct capabilities: send and receive', () => {
      expect(msteamsProvider.capabilities.send).toBe(true);
      expect(msteamsProvider.capabilities.receive).toBe(true);
    });

    it('supports slash commands (messaging extensions)', () => {
      expect(msteamsProvider.capabilities.slashCommands).toBe(true);
    });

    it('supports interactive components (Adaptive Cards)', () => {
      expect(msteamsProvider.capabilities.interactiveComponents).toBe(true);
    });

    it('supports rich blocks', () => {
      expect(msteamsProvider.capabilities.richBlocks).toBe(true);
    });

    it('supports reactions', () => {
      expect(msteamsProvider.capabilities.reactions).toBe(true);
    });

    it('supports threads', () => {
      expect(msteamsProvider.capabilities.threads).toBe(true);
    });

    it('exposes outbound adapter with send function', () => {
      expect(msteamsProvider.outbound).toBeDefined();
      expect(typeof msteamsProvider.outbound.send).toBe('function');
    });

    it('exposes inbound adapter', () => {
      expect(msteamsProvider.inbound).toBeDefined();
      expect(typeof msteamsProvider.inbound.parseMessage).toBe('function');
      expect(typeof msteamsProvider.inbound.parseCommand).toBe('function');
      expect(typeof msteamsProvider.inbound.parseAction).toBe('function');
    });

    it('exposes status adapter', () => {
      expect(msteamsProvider.status).toBeDefined();
      expect(typeof msteamsProvider.status.isConfigured).toBe('function');
      expect(typeof msteamsProvider.status.checkHealth).toBe('function');
    });

    it('has auth adapter that throws for OAuth getAuthUrl', () => {
      expect(() => msteamsProvider.auth?.getAuthUrl('state')).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Config management
  // ---------------------------------------------------------------------------

  describe('config management', () => {
    afterEach(() => {
      clearTeamsConfig();
    });

    it('clearTeamsConfig causes send to report missing credentials', async () => {
      clearTeamsConfig();
      const result = await msteamsProvider.outbound.send({
        provider: 'msteams',
        to: 'conv-id-001',
        text: 'Hi',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('App ID and App Password not configured');
    });

    it('setTeamsConfig with valid config changes the error to a network/auth failure', async () => {
      setTeamsConfig(validConfig);
      const result = await msteamsProvider.outbound.send({
        provider: 'msteams',
        to: 'conv-id-001',
        text: 'Hi',
      });
      // Should fail at token acquisition (network), not at missing-config check
      expect(result.error).not.toBe('App ID and App Password not configured');
    });
  });

  // ---------------------------------------------------------------------------
  // Status adapter
  // ---------------------------------------------------------------------------

  describe('status adapter — isConfigured', () => {
    it('returns true when appId and appPassword are set', () => {
      expect(
        msteamsProvider.status.isConfigured({
          id: 'x',
          provider: 'msteams',
          enabled: true,
          appId: 'app-id',
          appPassword: 'secret',
        })
      ).toBe(true);
    });

    it('returns false when appPassword is missing', () => {
      expect(
        msteamsProvider.status.isConfigured({
          id: 'x',
          provider: 'msteams',
          enabled: true,
          appId: 'app-id',
        })
      ).toBe(false);
    });

    it('returns false when appId is missing', () => {
      expect(
        msteamsProvider.status.isConfigured({
          id: 'x',
          provider: 'msteams',
          enabled: true,
          appPassword: 'secret',
        })
      ).toBe(false);
    });
  });

  describe('status adapter — checkHealth', () => {
    it('returns connected:false when appId is missing', async () => {
      const health = await msteamsProvider.status.checkHealth({
        id: 'x',
        provider: 'msteams',
        enabled: true,
        appPassword: 'secret',
      });
      expect(health.connected).toBe(false);
      expect(health.error).toContain('not configured');
    });

    it('returns connected:false when appPassword is missing', async () => {
      const health = await msteamsProvider.status.checkHealth({
        id: 'x',
        provider: 'msteams',
        enabled: true,
        appId: 'app-id',
      });
      expect(health.connected).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Inbound adapter — parseMessage
  // ---------------------------------------------------------------------------

  describe('inbound adapter — parseMessage', () => {
    beforeEach(() => {
      clearTeamsConfig();
    });

    it('returns null for non-MESSAGE activity types', () => {
      const activity = makeMessageActivity({ type: ActivityType.CONVERSATION_UPDATE });
      expect(msteamsProvider.inbound.parseMessage(activity)).toBeNull();
    });

    it('returns null when activity.from is missing', () => {
      const activity = { ...makeMessageActivity(), from: undefined };
      expect(msteamsProvider.inbound.parseMessage(activity)).toBeNull();
    });

    it('returns null when activity.conversation is missing', () => {
      const activity = { ...makeMessageActivity(), conversation: undefined };
      expect(msteamsProvider.inbound.parseMessage(activity)).toBeNull();
    });

    it('returns null for messages sent by the bot itself', () => {
      const activity = makeMessageActivity({ from: { id: 'bot-001', role: 'bot' } });
      expect(msteamsProvider.inbound.parseMessage(activity)).toBeNull();
    });

    it('parses a valid channel message', () => {
      const msg = msteamsProvider.inbound.parseMessage(makeMessageActivity());
      expect(msg).not.toBeNull();
      expect(msg?.provider).toBe('msteams');
      expect(msg?.text).toBe('Hello Teams');
      expect(msg?.senderId).toBe('user-id-001');
      expect(msg?.senderName).toBe('Alice');
    });

    it('maps channel conversationType to channel chatType', () => {
      const msg = msteamsProvider.inbound.parseMessage(makeMessageActivity());
      expect(msg?.chatType).toBe('channel');
    });

    it('maps personal conversationType to direct chatType', () => {
      const activity = makeMessageActivity({
        conversation: {
          id: 'conv-dm',
          conversationType: 'personal',
        },
      });
      const msg = msteamsProvider.inbound.parseMessage(activity);
      expect(msg?.chatType).toBe('direct');
    });

    it('maps groupChat conversationType to group chatType', () => {
      const activity = makeMessageActivity({
        conversation: {
          id: 'conv-gc',
          conversationType: 'groupChat',
          isGroup: true,
        },
      });
      const msg = msteamsProvider.inbound.parseMessage(activity);
      expect(msg?.chatType).toBe('group');
    });

    it('strips <at> bot mentions from text', () => {
      const activity = makeMessageActivity({ text: '<at>GLINR Bot</at> do something' });
      const msg = msteamsProvider.inbound.parseMessage(activity);
      expect(msg?.text).toBe('do something');
    });

    it('captures replyToId as threadId', () => {
      const activity = makeMessageActivity({ replyToId: 'root-msg-001' });
      const msg = msteamsProvider.inbound.parseMessage(activity);
      expect(msg?.threadId).toBe('root-msg-001');
    });

    it('rejects messages from disallowed teams when allowedTeamIds is set', () => {
      setTeamsConfig({ ...validConfig, allowedTeamIds: ['allowed-team'] });
      const activity = makeMessageActivity({
        channelData: {
          team: { id: 'other-team', name: 'Other' },
          channel: { id: 'channel-id-001', name: 'General' },
        },
      });
      const msg = msteamsProvider.inbound.parseMessage(activity);
      expect(msg).toBeNull();
    });

    it('includes media attachments (non-adaptive-card)', () => {
      const activity = makeMessageActivity({
        attachments: [
          { contentType: 'image/png', contentUrl: 'https://example.com/img.png', name: 'img.png' },
        ],
      });
      const msg = msteamsProvider.inbound.parseMessage(activity);
      expect(msg?.attachments).toBeDefined();
      expect(msg?.attachments?.[0].type).toBe('image');
    });

    it('filters out adaptive card attachments from the attachment list', () => {
      const activity = makeMessageActivity({
        attachments: [
          { contentType: 'application/vnd.microsoft.card.adaptive', content: {} },
        ],
      });
      const msg = msteamsProvider.inbound.parseMessage(activity);
      expect(msg?.attachments).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Inbound adapter — parseCommand
  // ---------------------------------------------------------------------------

  describe('inbound adapter — parseCommand', () => {
    it('returns null for non-invoke activities', () => {
      expect(msteamsProvider.inbound.parseCommand(makeMessageActivity())).toBeNull();
    });

    it('returns null for invoke activities that are not composeExtension', () => {
      const activity = makeInvokeActivity('adaptiveCard/action');
      expect(msteamsProvider.inbound.parseCommand(activity)).toBeNull();
    });

    it('parses a composeExtension/query invoke', () => {
      const activity = makeInvokeActivity('composeExtension/query', {
        commandId: 'searchTasks',
        parameters: [{ name: 'query', value: 'open bugs' }],
      });
      const cmd = msteamsProvider.inbound.parseCommand(activity);
      expect(cmd).not.toBeNull();
      expect(cmd?.provider).toBe('msteams');
      expect(cmd?.command).toBe('/searchTasks');
      expect(cmd?.text).toBe('open bugs');
    });
  });

  // ---------------------------------------------------------------------------
  // Inbound adapter — parseAction
  // ---------------------------------------------------------------------------

  describe('inbound adapter — parseAction', () => {
    it('returns null for plain message activities without a value', () => {
      expect(msteamsProvider.inbound.parseAction(makeMessageActivity())).toBeNull();
    });

    it('returns null for invoke activities that are not adaptiveCard/action', () => {
      const activity = makeInvokeActivity('composeExtension/query');
      expect(msteamsProvider.inbound.parseAction(activity)).toBeNull();
    });

    it('parses an adaptiveCard/action invoke', () => {
      const activity = makeInvokeActivity('adaptiveCard/action', {
        action: { verb: 'approve', data: 'task-99' },
      });
      const action = msteamsProvider.inbound.parseAction(activity);
      expect(action).not.toBeNull();
      expect(action?.provider).toBe('msteams');
      expect(action?.actionId).toBe('approve');
      expect(action?.value).toBe('task-99');
    });

    it('identifies "select" actions from the verb name', () => {
      const activity = makeInvokeActivity('adaptiveCard/action', {
        action: { verb: 'select_option', data: 'opt-1' },
      });
      const action = msteamsProvider.inbound.parseAction(activity);
      expect(action?.type).toBe('select');
    });

    it('parses an old-style Action.Submit message with value', () => {
      const activity = makeMessageActivity({
        value: { actionId: 'dismiss', value: 'close' },
      });
      const action = msteamsProvider.inbound.parseAction(activity);
      expect(action).not.toBeNull();
      expect(action?.actionId).toBe('dismiss');
    });
  });

  // ---------------------------------------------------------------------------
  // Inbound adapter — buildCommandResponse / buildActionResponse
  // ---------------------------------------------------------------------------

  describe('inbound adapter — buildCommandResponse', () => {
    it('returns a composeExtension result structure', () => {
      const result = msteamsProvider.inbound.buildCommandResponse({
        text: 'Result',
        responseType: 'in_channel',
      }) as Record<string, unknown>;
      const ext = result['composeExtension'] as Record<string, unknown>;
      expect(ext).toBeDefined();
      expect(ext['type']).toBe('result');
    });
  });

  describe('inbound adapter — buildActionResponse', () => {
    it('returns statusCode 200 for text-only response', () => {
      const result = msteamsProvider.inbound.buildActionResponse({
        text: 'OK',
      }) as Record<string, unknown>;
      expect(result['statusCode']).toBe(200);
      expect(result['value']).toBe('OK');
    });

    it('returns an adaptive card response when blocks are provided', () => {
      const result = msteamsProvider.inbound.buildActionResponse({
        text: 'Updated',
        blocks: [{ type: 'AdaptiveCard', version: '1.4', body: [] }],
      }) as Record<string, unknown>;
      expect(result['statusCode']).toBe(200);
      expect(result['type']).toBe('application/vnd.microsoft.card.adaptive');
    });
  });

  // ---------------------------------------------------------------------------
  // Outbound adapter — send error paths
  // ---------------------------------------------------------------------------

  describe('outbound adapter — send', () => {
    afterEach(() => {
      clearTeamsConfig();
    });

    it('returns error when no config is set', async () => {
      const result = await msteamsProvider.outbound.send({
        provider: 'msteams',
        to: 'conv-id-001',
        text: 'Hi',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('App ID and App Password not configured');
    });
  });

  // ---------------------------------------------------------------------------
  // isTeamsSenderAllowed
  // ---------------------------------------------------------------------------

  describe('isTeamsSenderAllowed', () => {
    const baseConfig = {
      id: 'x',
      provider: 'msteams' as const,
      enabled: true,
      appId: 'id',
      appPassword: 'pw',
    };

    it('allows all when no allowlists are configured', () => {
      const result = isTeamsSenderAllowed(baseConfig, 'team-1', 'channel-1');
      expect(result.allowed).toBe(true);
    });

    it('blocks teams not in allowedTeamIds', () => {
      const result = isTeamsSenderAllowed(
        { ...baseConfig, allowedTeamIds: ['team-allowed'] },
        'team-blocked',
        undefined
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('team-blocked');
    });

    it('allows teams in allowedTeamIds', () => {
      const result = isTeamsSenderAllowed(
        { ...baseConfig, allowedTeamIds: ['team-1'] },
        'team-1',
        undefined
      );
      expect(result.allowed).toBe(true);
    });

    it('blocks channels not in allowedChannelIds', () => {
      const result = isTeamsSenderAllowed(
        { ...baseConfig, allowedChannelIds: ['ch-allowed'] },
        undefined,
        'ch-blocked'
      );
      expect(result.allowed).toBe(false);
    });

    it('allows channels in allowedChannelIds', () => {
      const result = isTeamsSenderAllowed(
        { ...baseConfig, allowedChannelIds: ['ch-1'] },
        undefined,
        'ch-1'
      );
      expect(result.allowed).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Utility helpers
  // ---------------------------------------------------------------------------

  describe('buildProactiveTarget', () => {
    it('joins serviceUrl and conversationId with a pipe', () => {
      const target = buildProactiveTarget('https://smba.example.com', 'conv-123');
      expect(target).toBe('https://smba.example.com|conv-123');
    });
  });

  describe('extractTeamsChannelData', () => {
    it('returns channelData from an activity', () => {
      const activity = makeMessageActivity();
      const channelData = extractTeamsChannelData(activity);
      expect(channelData?.team?.id).toBe('team-id-001');
    });

    it('returns undefined when channelData is absent', () => {
      const activity = { ...makeMessageActivity(), channelData: undefined };
      const channelData = extractTeamsChannelData(activity);
      expect(channelData).toBeUndefined();
    });
  });

  describe('isTeamsActivity', () => {
    it('returns true for activities with channelId msteams', () => {
      expect(isTeamsActivity(makeMessageActivity())).toBe(true);
    });

    it('returns false for activities from other channels', () => {
      const activity = makeMessageActivity({ channelId: 'directline' });
      expect(isTeamsActivity(activity)).toBe(false);
    });
  });

  describe('isMessageReactionActivity', () => {
    it('returns true for messageReaction activities', () => {
      const activity = makeMessageActivity({ type: ActivityType.MESSAGE_REACTION });
      expect(isMessageReactionActivity(activity)).toBe(true);
    });

    it('returns false for non-reaction activities', () => {
      expect(isMessageReactionActivity(makeMessageActivity())).toBe(false);
    });
  });

  describe('parseReactionActivity', () => {
    it('returns null for non-messageReaction activities', () => {
      expect(parseReactionActivity(makeMessageActivity())).toBeNull();
    });

    it('parses added and removed reactions', () => {
      const activity = makeMessageActivity({
        type: ActivityType.MESSAGE_REACTION,
        replyToId: 'msg-root',
        reactionsAdded: [{ type: 'like' }, { type: 'heart' }],
        reactionsRemoved: [{ type: 'laugh' }],
      });
      const result = parseReactionActivity(activity);
      expect(result).not.toBeNull();
      expect(result?.added).toEqual(['like', 'heart']);
      expect(result?.removed).toEqual(['laugh']);
      expect(result?.messageId).toBe('msg-root');
      expect(result?.userId).toBe('user-id-001');
    });

    it('returns empty arrays when no reactions are added or removed', () => {
      const activity = makeMessageActivity({ type: ActivityType.MESSAGE_REACTION });
      const result = parseReactionActivity(activity);
      expect(result?.added).toEqual([]);
      expect(result?.removed).toEqual([]);
    });
  });

  describe('verifyTeamsSignature', () => {
    it('returns false when appPassword is undefined', async () => {
      const result = await verifyTeamsSignature(undefined, 'sha256=abc', '{}');
      expect(result).toBe(false);
    });

    it('returns false when signature is undefined', async () => {
      const result = await verifyTeamsSignature('password', undefined, '{}');
      expect(result).toBe(false);
    });

    it('returns false for a mismatched HMAC signature', async () => {
      const result = await verifyTeamsSignature('password', 'sha256=badhash', '{"test":true}');
      expect(result).toBe(false);
    });
  });

  describe('exported constants', () => {
    it('ActivityType has expected values', () => {
      expect(ActivityType.MESSAGE).toBe('message');
      expect(ActivityType.INVOKE).toBe('invoke');
      expect(ActivityType.MESSAGE_REACTION).toBe('messageReaction');
      expect(ActivityType.CONVERSATION_UPDATE).toBe('conversationUpdate');
    });

    it('ChannelId has expected values', () => {
      expect(ChannelId.MSTEAMS).toBe('msteams');
      expect(ChannelId.DIRECTLINE).toBe('directline');
    });
  });
});
