import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IncomingMessage, ChatEvent, ChatContext, ChatAccountConfig, OutgoingMessage } from './providers/types.js';

// --- Hoisted mocks ---

const mocks = vi.hoisted(() => ({
  aiProvider: {
    chat: vi.fn(),
  },
  getChatRegistry: vi.fn(),
  sendMessage: vi.fn(),
  getGroupChatManager: vi.fn(),
  buildSystemPrompt: vi.fn(() => Promise.resolve('You are profClaw.')),
  createConversation: vi.fn(),
  addMessage: vi.fn(),
  getConversationMessages: vi.fn(() => Promise.resolve([])),
  needsCompaction: vi.fn(() => false),
  compactMessages: vi.fn(),
  getSessionModel: vi.fn(() => undefined),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../providers/ai-sdk.js', () => ({
  aiProvider: mocks.aiProvider,
}));

vi.mock('./providers/registry.js', () => ({
  getChatRegistry: mocks.getChatRegistry,
}));

vi.mock('./providers/index.js', () => ({
  sendMessage: mocks.sendMessage,
}));

vi.mock('./group.js', () => ({
  getGroupChatManager: mocks.getGroupChatManager,
}));

vi.mock('./system-prompts.js', () => ({
  buildSystemPrompt: mocks.buildSystemPrompt,
}));

vi.mock('./conversations.js', () => ({
  createConversation: mocks.createConversation,
  addMessage: mocks.addMessage,
  getConversationMessages: mocks.getConversationMessages,
}));

vi.mock('./memory.js', () => ({
  needsCompaction: mocks.needsCompaction,
  compactMessages: mocks.compactMessages,
}));

vi.mock('./execution/tools/session-status.js', () => ({
  getSessionModel: mocks.getSessionModel,
}));

vi.mock('../utils/logger.js', () => ({
  logger: mocks.logger,
}));

import {
  registerMessageHandler,
  handleIncomingMessage,
  friendlyErrorReply,
  channelConversations,
} from './message-handler.js';

// --- Helpers ---

function makeMessage(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    id: 'msg-1',
    provider: 'telegram',
    accountId: 'default',
    senderId: 'user-123',
    senderName: 'Alice',
    chatType: 'direct',
    chatId: 'chat-456',
    text: 'Hello profClaw!',
    timestamp: new Date('2026-03-12T10:00:00Z'),
    ...overrides,
  };
}

function makeEvent(message: IncomingMessage): ChatEvent {
  return {
    type: 'message',
    provider: message.provider,
    accountId: message.accountId,
    timestamp: message.timestamp,
    payload: message,
  };
}

function makeContext(message: IncomingMessage): ChatContext {
  return {
    provider: message.provider,
    accountId: message.accountId,
    config: { id: 'default', provider: 'telegram' } as ChatAccountConfig,
  };
}

function setupGroupManager(overrides: Record<string, unknown> = {}) {
  const manager = {
    shouldRespond: vi.fn(() => true),
    checkRateLimit: vi.fn(() => ({ allowed: true })),
    trackUser: vi.fn(),
    getReplyTarget: vi.fn(() => ({})),
    getPersonality: vi.fn(() => undefined),
    ...overrides,
  };
  mocks.getGroupChatManager.mockReturnValue(manager);
  return manager;
}

// --- Tests ---

describe('message-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channelConversations.clear();

    // Default: conversation creation returns an id
    mocks.createConversation.mockResolvedValue({
      id: 'conv-1',
      title: 'telegram - chat',
      presetId: 'profclaw-assistant',
      createdAt: '2026-03-12T10:00:00Z',
      updatedAt: '2026-03-12T10:00:00Z',
    });

    // Default: AI returns a response
    mocks.aiProvider.chat.mockResolvedValue({
      id: 'resp-1',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      content: 'Hello Alice! How can I help?',
      finishReason: 'stop',
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120, cost: 0.001 },
      duration: 500,
    });

    // Default: send succeeds
    mocks.sendMessage.mockResolvedValue({ success: true, messageId: 'out-1' });
  });

  describe('handleIncomingMessage', () => {
    it('processes message and sends AI response', async () => {
      const manager = setupGroupManager();
      const message = makeMessage();
      const event = makeEvent(message);
      const context = makeContext(message);

      await handleIncomingMessage(event, context);

      // AI was called with the user's message
      expect(mocks.aiProvider.chat).toHaveBeenCalledOnce();
      const chatCall = mocks.aiProvider.chat.mock.calls[0][0];
      expect(chatCall.messages).toHaveLength(1);
      expect(chatCall.messages[0].content).toBe('Hello profClaw!');
      expect(chatCall.messages[0].role).toBe('user');

      // Response was sent back
      expect(mocks.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'telegram',
          to: 'chat-456',
          text: 'Hello Alice! How can I help?',
        }),
      );

      // Both messages persisted
      expect(mocks.addMessage).toHaveBeenCalledTimes(2);
      expect(mocks.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'user', content: 'Hello profClaw!' }),
      );
      expect(mocks.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'assistant', content: 'Hello Alice! How can I help?' }),
      );
    });

    it('respects mention gating - group message without mention gets no response', async () => {
      const manager = setupGroupManager({ shouldRespond: vi.fn(() => false) });
      const message = makeMessage({ chatType: 'group' });

      await handleIncomingMessage(makeEvent(message), makeContext(message));

      expect(mocks.aiProvider.chat).not.toHaveBeenCalled();
      expect(mocks.sendMessage).not.toHaveBeenCalled();
    });

    it('enforces rate limiting', async () => {
      const manager = setupGroupManager({
        checkRateLimit: vi.fn(() => ({
          allowed: false,
          message: 'Slow down! Try again in 30 seconds.',
        })),
      });
      const message = makeMessage();

      await handleIncomingMessage(makeEvent(message), makeContext(message));

      // AI was NOT called
      expect(mocks.aiProvider.chat).not.toHaveBeenCalled();

      // Cooldown message was sent
      expect(mocks.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Slow down! Try again in 30 seconds.',
          replyToId: 'msg-1',
        }),
      );
    });

    it('handles AI quota error with friendly reply', async () => {
      setupGroupManager();
      mocks.aiProvider.chat.mockRejectedValue(new Error('insufficient_quota'));
      const message = makeMessage();

      await handleIncomingMessage(makeEvent(message), makeContext(message));

      expect(mocks.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'My API quota is used up. Please check the billing.',
        }),
      );
    });

    it('reuses conversation for same chatId', async () => {
      setupGroupManager();
      const message = makeMessage();

      // First message creates conversation
      await handleIncomingMessage(makeEvent(message), makeContext(message));
      expect(mocks.createConversation).toHaveBeenCalledOnce();

      // Second message reuses cached conversation
      vi.clearAllMocks();
      mocks.aiProvider.chat.mockResolvedValue({
        id: 'resp-2',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        content: 'Still here!',
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110, cost: 0.001 },
        duration: 300,
      });
      mocks.sendMessage.mockResolvedValue({ success: true });
      mocks.getConversationMessages.mockResolvedValue([]);
      setupGroupManager();

      await handleIncomingMessage(makeEvent(message), makeContext(message));
      expect(mocks.createConversation).not.toHaveBeenCalled();
    });

    it('skips empty messages', async () => {
      setupGroupManager();
      const message = makeMessage({ text: '' });

      await handleIncomingMessage(makeEvent(message), makeContext(message));

      expect(mocks.aiProvider.chat).not.toHaveBeenCalled();
    });

    it('skips whitespace-only messages', async () => {
      setupGroupManager();
      const message = makeMessage({ text: '   ' });

      await handleIncomingMessage(makeEvent(message), makeContext(message));

      expect(mocks.aiProvider.chat).not.toHaveBeenCalled();
    });

    it('includes channel personality in system prompt', async () => {
      setupGroupManager({
        getPersonality: vi.fn(() => ({
          chatId: 'chat-456',
          provider: 'telegram',
          systemPrompt: 'You are a pirate. Respond in pirate speak.',
        })),
      });
      const message = makeMessage();

      await handleIncomingMessage(makeEvent(message), makeContext(message));

      const chatCall = mocks.aiProvider.chat.mock.calls[0][0];
      expect(chatCall.systemPrompt).toContain('You are a pirate');
    });

    it('uses per-conversation model override', async () => {
      setupGroupManager();
      mocks.getSessionModel.mockReturnValue('anthropic/claude-opus-4-5');
      const message = makeMessage();

      // Pre-populate the conversation cache
      channelConversations.set('telegram:default:chat-456', 'conv-override');

      await handleIncomingMessage(makeEvent(message), makeContext(message));

      const chatCall = mocks.aiProvider.chat.mock.calls[0][0];
      expect(chatCall.model).toBe('anthropic/claude-opus-4-5');
    });

    it('loads and passes history to AI', async () => {
      setupGroupManager();
      mocks.getConversationMessages.mockResolvedValue([
        { id: 'h1', conversationId: 'conv-1', role: 'user', content: 'Previous question', createdAt: '2026-03-12T09:00:00Z' },
        { id: 'h2', conversationId: 'conv-1', role: 'assistant', content: 'Previous answer', createdAt: '2026-03-12T09:01:00Z' },
      ]);
      const message = makeMessage();

      await handleIncomingMessage(makeEvent(message), makeContext(message));

      const chatCall = mocks.aiProvider.chat.mock.calls[0][0];
      // 2 history + 1 new = 3 messages
      expect(chatCall.messages).toHaveLength(3);
      expect(chatCall.messages[0].content).toBe('Previous question');
      expect(chatCall.messages[2].content).toBe('Hello profClaw!');
    });

    it('compacts messages when needed', async () => {
      setupGroupManager();
      mocks.needsCompaction.mockReturnValue(true);
      const compactedMessages = [
        { id: 'summary', conversationId: 'conv-1', role: 'system', content: 'Summary of conversation', createdAt: '2026-03-12T09:00:00Z' },
      ];
      mocks.compactMessages.mockResolvedValue({ messages: compactedMessages, wasCompacted: true });
      mocks.getConversationMessages.mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => ({
          id: `m${i}`,
          conversationId: 'conv-1',
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}`,
          createdAt: '2026-03-12T09:00:00Z',
        })),
      );
      const message = makeMessage();

      await handleIncomingMessage(makeEvent(message), makeContext(message));

      expect(mocks.compactMessages).toHaveBeenCalledOnce();
      // AI should receive compacted messages + new message
      const chatCall = mocks.aiProvider.chat.mock.calls[0][0];
      expect(chatCall.messages).toHaveLength(2); // 1 summary + 1 new
    });
  });

  describe('friendlyErrorReply', () => {
    it('maps rate limit errors', () => {
      expect(friendlyErrorReply(new Error('429 Too Many Requests'))).toContain('rate limited');
    });

    it('maps quota errors', () => {
      expect(friendlyErrorReply(new Error('insufficient_quota'))).toContain('quota');
    });

    it('maps auth errors', () => {
      expect(friendlyErrorReply(new Error('401 Unauthorized'))).toContain('API key');
    });

    it('maps timeout errors', () => {
      expect(friendlyErrorReply(new Error('Request timed out'))).toContain('responding');
    });

    it('returns generic message for unknown errors', () => {
      expect(friendlyErrorReply(new Error('some random error'))).toBe('Something went wrong. Please try again.');
    });

    it('handles non-Error objects', () => {
      expect(friendlyErrorReply('string error')).toBe('Something went wrong. Please try again.');
    });
  });

  describe('registerMessageHandler', () => {
    it('registers on the chat registry and returns unsubscribe', () => {
      const unsubscribeFn = vi.fn();
      const registryMock = {
        on: vi.fn(() => unsubscribeFn),
      };
      mocks.getChatRegistry.mockReturnValue(registryMock);

      const unsub = registerMessageHandler();

      expect(registryMock.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(unsub).toBe(unsubscribeFn);
    });
  });
});
