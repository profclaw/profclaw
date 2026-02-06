/**
 * Tests for Chat Provider Registry
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getChatRegistry, resetChatRegistry, ChatProviderRegistry } from '../registry.js';
import type {
  ChatProvider,
  ChatProviderMeta,
  ChatProviderCapabilities,
  OutboundAdapter,
  InboundAdapter,
  StatusAdapter,
  ChatAccountConfig,
  SlackAccountConfig,
  ChatEvent,
} from '../types.js';
import { z } from 'zod';

// Mock logger
vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function createMockProvider(id: string, order: number): ChatProvider {
  const meta: ChatProviderMeta = {
    id: id as ChatProvider['meta']['id'],
    name: id.charAt(0).toUpperCase() + id.slice(1),
    description: `${id} provider`,
    icon: '📧',
    order,
  };

  const capabilities: ChatProviderCapabilities = {
    chatTypes: ['direct', 'channel'],
    send: true,
    receive: true,
    slashCommands: id === 'slack',
    interactiveComponents: false,
    reactions: false,
    edit: false,
    delete: false,
    threads: id !== 'webchat',
    media: false,
    richBlocks: false,
    oauth: false,
    webhooks: true,
    realtime: false,
  };

  const outbound: OutboundAdapter = {
    async send() {
      return { success: true, messageId: 'msg-123' };
    },
  };

  const inbound: InboundAdapter = {
    parseMessage() { return null; },
    parseCommand() { return null; },
    parseAction() { return null; },
    buildCommandResponse() { return {}; },
  };

  const status: StatusAdapter = {
    isConfigured(config: ChatAccountConfig) {
      return !!config.id;
    },
    async checkHealth() {
      return { connected: true, latencyMs: 10 };
    },
  };

  return {
    meta,
    capabilities,
    defaultConfig: { provider: id as SlackAccountConfig['provider'] } as Partial<ChatAccountConfig>,
    configSchema: z.object({ id: z.string(), provider: z.literal(id) }) as unknown as z.ZodType<ChatAccountConfig>,
    outbound,
    inbound,
    status,
  };
}

describe('ChatProviderRegistry', () => {
  beforeEach(() => {
    resetChatRegistry();
  });

  describe('singleton', () => {
    it('getChatRegistry returns same instance', () => {
      const a = getChatRegistry();
      const b = getChatRegistry();
      expect(a).toBe(b);
    });

    it('resetChatRegistry creates new instance', () => {
      const a = getChatRegistry();
      resetChatRegistry();
      const b = getChatRegistry();
      expect(a).not.toBe(b);
    });
  });

  describe('register/get/list', () => {
    it('registers and retrieves a provider', () => {
      const registry = getChatRegistry();
      const provider = createMockProvider('slack', 1);
      registry.register(provider);
      expect(registry.get('slack')).toBe(provider);
    });

    it('returns undefined for unregistered provider', () => {
      const registry = getChatRegistry();
      expect(registry.get('discord')).toBeUndefined();
    });

    it('has() checks registration', () => {
      const registry = getChatRegistry();
      expect(registry.has('slack')).toBe(false);
      registry.register(createMockProvider('slack', 1));
      expect(registry.has('slack')).toBe(true);
    });

    it('list() returns providers sorted by order', () => {
      const registry = getChatRegistry();
      registry.register(createMockProvider('discord', 3));
      registry.register(createMockProvider('slack', 1));
      registry.register(createMockProvider('telegram', 2));

      const list = registry.list();
      expect(list.map(p => p.meta.id)).toEqual(['slack', 'telegram', 'discord']);
    });

    it('overwrites existing provider on re-registration', () => {
      const registry = getChatRegistry();
      const p1 = createMockProvider('slack', 1);
      const p2 = createMockProvider('slack', 5);
      registry.register(p1);
      registry.register(p2);
      expect(registry.get('slack')?.meta.order).toBe(5);
    });

    it('unregister removes a provider', () => {
      const registry = getChatRegistry();
      registry.register(createMockProvider('slack', 1));
      expect(registry.has('slack')).toBe(true);
      const removed = registry.unregister('slack');
      expect(removed).toBe(true);
      expect(registry.has('slack')).toBe(false);
    });

    it('unregister returns false for non-existent provider', () => {
      const registry = getChatRegistry();
      expect(registry.unregister('slack')).toBe(false);
    });
  });

  describe('withCapability()', () => {
    it('filters providers by capability', () => {
      const registry = getChatRegistry();
      registry.register(createMockProvider('slack', 1)); // has slashCommands
      registry.register(createMockProvider('discord', 2)); // no slashCommands

      const withSlash = registry.withCapability('slashCommands');
      expect(withSlash).toHaveLength(1);
      expect(withSlash[0].meta.id).toBe('slack');
    });

    it('filters by array capabilities', () => {
      const registry = getChatRegistry();
      registry.register(createMockProvider('slack', 1)); // chatTypes: ['direct', 'channel']

      const withThreads = registry.withCapability('threads');
      expect(withThreads).toHaveLength(1);
    });
  });

  describe('account management', () => {
    it('registers and retrieves an account', () => {
      const registry = getChatRegistry();
      const config: SlackAccountConfig = {
        id: 'default',
        provider: 'slack',
        name: 'My Workspace',
        enabled: true,
        isDefault: true,
        botToken: 'xoxb-test',
      };
      registry.registerAccount(config);
      expect(registry.getAccount('slack', 'default')).toBe(config);
    });

    it('getDefaultAccount returns the default', () => {
      const registry = getChatRegistry();
      registry.registerAccount({
        id: 'secondary',
        provider: 'slack',
        name: 'Secondary',
      } as SlackAccountConfig);
      registry.registerAccount({
        id: 'primary',
        provider: 'slack',
        name: 'Primary',
        isDefault: true,
      } as SlackAccountConfig);

      const def = registry.getDefaultAccount('slack');
      expect(def?.id).toBe('primary');
    });

    it('getDefaultAccount falls back to first account', () => {
      const registry = getChatRegistry();
      registry.registerAccount({
        id: 'only',
        provider: 'slack',
        name: 'Only',
      } as SlackAccountConfig);

      const def = registry.getDefaultAccount('slack');
      expect(def?.id).toBe('only');
    });

    it('getDefaultAccount returns undefined when no accounts', () => {
      const registry = getChatRegistry();
      expect(registry.getDefaultAccount('slack')).toBeUndefined();
    });

    it('listAccounts filters by provider', () => {
      const registry = getChatRegistry();
      registry.registerAccount({ id: 'a', provider: 'slack' } as SlackAccountConfig);
      registry.registerAccount({ id: 'b', provider: 'discord' } as ChatAccountConfig);

      expect(registry.listAccounts('slack')).toHaveLength(1);
      expect(registry.listAccounts()).toHaveLength(2);
    });

    it('removeAccount removes an account', () => {
      const registry = getChatRegistry();
      registry.registerAccount({ id: 'test', provider: 'slack' } as SlackAccountConfig);
      expect(registry.removeAccount('slack', 'test')).toBe(true);
      expect(registry.getAccount('slack', 'test')).toBeUndefined();
    });
  });

  describe('event handling', () => {
    it('on/emit cycle works', async () => {
      const registry = getChatRegistry();
      registry.registerAccount({ id: 'acc', provider: 'slack' } as SlackAccountConfig);

      const handler = vi.fn().mockResolvedValue(undefined);
      registry.on('message', handler);

      const event: ChatEvent = {
        type: 'message',
        provider: 'slack',
        accountId: 'acc',
        timestamp: new Date(),
        payload: { text: 'hello' },
      };

      await registry.emit(event);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event, expect.objectContaining({
        provider: 'slack',
        accountId: 'acc',
      }));
    });

    it('unsubscribe removes handler', async () => {
      const registry = getChatRegistry();
      registry.registerAccount({ id: 'acc', provider: 'slack' } as SlackAccountConfig);

      const handler = vi.fn().mockResolvedValue(undefined);
      const unsub = registry.on('message', handler);

      unsub();

      await registry.emit({
        type: 'message',
        provider: 'slack',
        accountId: 'acc',
        timestamp: new Date(),
        payload: {},
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('emit with no handlers does nothing', async () => {
      const registry = getChatRegistry();
      // Should not throw
      await registry.emit({
        type: 'message',
        provider: 'slack',
        accountId: 'test',
        timestamp: new Date(),
        payload: {},
      });
    });

    it('handler errors are caught and logged', async () => {
      const registry = getChatRegistry();
      registry.registerAccount({ id: 'acc', provider: 'slack' } as SlackAccountConfig);

      const handler = vi.fn().mockRejectedValue(new Error('handler boom'));
      registry.on('message', handler);

      // Should not throw
      await registry.emit({
        type: 'message',
        provider: 'slack',
        accountId: 'acc',
        timestamp: new Date(),
        payload: {},
      });
    });
  });

  describe('getStatus()', () => {
    it('returns status for all providers and accounts', async () => {
      const registry = getChatRegistry();
      const provider = createMockProvider('slack', 1);
      registry.register(provider);
      registry.registerAccount({
        id: 'default',
        provider: 'slack',
        enabled: true,
      } as SlackAccountConfig);

      const status = await registry.getStatus();
      expect(status.providers).toHaveLength(1);
      expect(status.providers[0].id).toBe('slack');
      expect(status.providers[0].accounts).toHaveLength(1);
      expect(status.providers[0].accounts[0].connected).toBe(true);
    });
  });
});
