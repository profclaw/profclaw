/**
 * Tests for Chat Provider Types
 *
 * Validates that all provider type definitions are sound.
 */

import { describe, it, expect } from 'vitest';
import type {
  ChatProviderId,
  ChatProviderMeta,
  ChatProviderCapabilities,
  ChatAccountConfig,
  SlackAccountConfig,
  DiscordAccountConfig,
  TelegramAccountConfig,
  WhatsAppAccountConfig,
  WebChatAccountConfig,
  MatrixAccountConfig,
  GoogleChatAccountConfig,
  MSTeamsAccountConfig,
  IncomingMessage,
  OutgoingMessage,
  SendResult,
  ChatEvent,
  ChatProvider,
} from '../types.js';

describe('Chat Provider Types', () => {
  describe('ChatProviderId', () => {
    it('includes all expected providers', () => {
      const providers: ChatProviderId[] = [
        'slack', 'discord', 'telegram', 'whatsapp',
        'webchat', 'matrix', 'googlechat', 'msteams',
        'mattermost', 'custom',
      ];
      expect(providers).toHaveLength(10);
    });
  });

  describe('Account Configs', () => {
    it('SlackAccountConfig has correct shape', () => {
      const config: SlackAccountConfig = {
        id: 'slack-1',
        provider: 'slack',
        botToken: 'xoxb-test',
        signingSecret: 'secret',
      };
      expect(config.provider).toBe('slack');
    });

    it('DiscordAccountConfig has correct shape', () => {
      const config: DiscordAccountConfig = {
        id: 'discord-1',
        provider: 'discord',
        botToken: 'discord-token',
        applicationId: 'app-id',
        publicKey: 'pub-key',
      };
      expect(config.provider).toBe('discord');
    });

    it('TelegramAccountConfig has correct shape', () => {
      const config: TelegramAccountConfig = {
        id: 'tg-1',
        provider: 'telegram',
        botToken: 'tg-token',
      };
      expect(config.provider).toBe('telegram');
    });

    it('WhatsAppAccountConfig has correct shape', () => {
      const config: WhatsAppAccountConfig = {
        id: 'wa-1',
        provider: 'whatsapp',
        phoneNumberId: '123',
        accessToken: 'wa-token',
      };
      expect(config.provider).toBe('whatsapp');
    });

    it('WebChatAccountConfig has correct shape', () => {
      const config: WebChatAccountConfig = {
        id: 'wc-1',
        provider: 'webchat',
        allowAnonymous: true,
        maxSessionsPerIp: 5,
        sessionTimeoutMs: 1800000,
      };
      expect(config.provider).toBe('webchat');
    });

    it('MatrixAccountConfig has correct shape', () => {
      const config: MatrixAccountConfig = {
        id: 'matrix-1',
        provider: 'matrix',
        homeserverUrl: 'https://matrix.org',
        accessToken: 'matrix-token',
        userId: '@profclaw:matrix.org',
        enableEncryption: false,
        allowedRoomIds: ['!room1:matrix.org'],
      };
      expect(config.provider).toBe('matrix');
      expect(config.homeserverUrl).toBe('https://matrix.org');
    });

    it('GoogleChatAccountConfig has correct shape', () => {
      const config: GoogleChatAccountConfig = {
        id: 'gc-1',
        provider: 'googlechat',
        projectId: 'my-project',
        webhookUrl: 'https://chat.googleapis.com/v1/spaces/xxx/messages?key=yyy',
        allowedSpaceIds: ['spaces/123'],
      };
      expect(config.provider).toBe('googlechat');
    });

    it('MSTeamsAccountConfig has correct shape', () => {
      const config: MSTeamsAccountConfig = {
        id: 'teams-1',
        provider: 'msteams',
        appId: 'app-id',
        appPassword: 'app-password',
        tenantId: 'tenant-id',
        allowedTeamIds: ['team-1'],
      };
      expect(config.provider).toBe('msteams');
    });

    it('ChatAccountConfig is a union of all configs', () => {
      const configs: ChatAccountConfig[] = [
        { id: '1', provider: 'slack' },
        { id: '2', provider: 'discord' },
        { id: '3', provider: 'telegram' },
        { id: '4', provider: 'whatsapp' },
        { id: '5', provider: 'webchat' },
        { id: '6', provider: 'matrix' },
        { id: '7', provider: 'googlechat' },
        { id: '8', provider: 'msteams' },
      ];
      expect(configs).toHaveLength(8);
    });
  });

  describe('Message Types', () => {
    it('IncomingMessage has correct shape', () => {
      const msg: IncomingMessage = {
        id: 'msg-1',
        provider: 'matrix',
        accountId: 'matrix-1',
        senderId: '@user:matrix.org',
        senderName: 'User',
        chatType: 'channel',
        chatId: '!room:matrix.org',
        text: 'Hello',
        timestamp: new Date(),
      };
      expect(msg.provider).toBe('matrix');
    });

    it('OutgoingMessage has correct shape', () => {
      const msg: OutgoingMessage = {
        provider: 'msteams',
        to: 'conversation-id',
        text: 'Hello Teams!',
      };
      expect(msg.provider).toBe('msteams');
    });

    it('SendResult has correct shape', () => {
      const result: SendResult = {
        success: true,
        messageId: 'msg-123',
      };
      expect(result.success).toBe(true);
    });
  });

  describe('Event Types', () => {
    it('ChatEvent has correct shape', () => {
      const event: ChatEvent = {
        type: 'message',
        provider: 'googlechat',
        accountId: 'gc-1',
        timestamp: new Date(),
        payload: { text: 'test' },
      };
      expect(event.type).toBe('message');
      expect(event.provider).toBe('googlechat');
    });
  });
});
