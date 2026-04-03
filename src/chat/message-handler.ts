/**
 * Messenger-to-AI Pipeline
 *
 * Handles incoming messages from all 22 chat providers (Telegram, Discord,
 * Slack, WhatsApp, etc.) by routing them through the AI and replying on
 * the same channel.
 *
 * Architecture inspired by OpenClaw (text chunking, channel dock pattern)
 * and NanoClaw (cursor rollback on error, concurrency limiting, typing
 * indicators, GroupQueue pattern).
 *
 * Flow:
 *   Provider webhook -> parseMessage() -> IncomingMessage
 *     -> getChatRegistry().emit({ type: 'message', payload })
 *     -> handleIncomingMessage()
 *         1. shouldRespond() mention gating
 *         2. checkRateLimit() sliding window
 *         3. getOrCreateConversation() keyed by provider:accountId:chatId
 *         4. Load history + compaction check
 *         5. buildSystemPrompt() with channel personality
 *         6. aiProvider.chat() call AI
 *         7. provider.outbound.send() reply to user
 *         8. addMessage() x2 persist user + assistant
 */

import { logger } from '../utils/logger.js';
import { getChatRegistry } from './providers/registry.js';
import { getGroupChatManager } from './group.js';
import { buildSystemPrompt } from './system-prompts.js';
import {
  createConversation,
  addMessage,
  getConversationMessages,
} from './conversations.js';
import { needsCompaction, compactMessages } from './memory.js';
import { getSessionModel } from './execution/tools/session-status.js';
import { routeQuery, recordRoutingDecision, isSmartRouterEnabled } from '../providers/smart-router.js';
import { AutomationPatternDetector } from './proactive/index.js';
import { observeWindow } from '../memory/observational.js';
import type { IncomingMessage, ChatEvent, ChatContext as RegistryChatContext } from './providers/types.js';
import type { ChatContext as PromptChatContext } from './system-prompts.js';
import type { ChatMessage, ProviderType } from '../providers/core/types.js';

// CONSTANTS

/** Max concurrent AI calls to prevent overload (inspired by NanoClaw GroupQueue) */
const MAX_CONCURRENT = parseInt(process.env['POOL_MAX_CONCURRENT'] ?? '50', 10);

/** Currently processing count */
let activeCount = 0;

/** Singleton automation pattern detector - learns across all conversations */
const patternDetector = new AutomationPatternDetector({ minOccurrences: 3 });

// CONVERSATION CACHE

/** In-memory cache: "telegram:default:12345" -> conversationId */
const channelConversations = new Map<string, string>();
let sendMessagePromise: Promise<typeof import('./providers/index.js')['sendMessage']> | null = null;

async function sendProviderMessage(
  message: Parameters<typeof import('./providers/index.js')['sendMessage']>[0]
): Promise<Awaited<ReturnType<typeof import('./providers/index.js')['sendMessage']>>> {
  if (!sendMessagePromise) {
    sendMessagePromise = import('./providers/index.js').then((mod) => mod.sendMessage);
  }

  const sendMessage = await sendMessagePromise;
  return sendMessage(message);
}

function makeConversationKey(provider: string, accountId: string, chatId: string): string {
  return `${provider}:${accountId}:${chatId}`;
}

async function getOrCreateChannelConversation(
  provider: string,
  accountId: string,
  chatId: string,
  chatName?: string,
): Promise<string> {
  const key = makeConversationKey(provider, accountId, chatId);

  // Cache hit
  const cached = channelConversations.get(key);
  if (cached) return cached;

  // No DB metadata column for messenger key, so create a new conversation.
  // Title encodes the provider and chat for discoverability.
  const title = chatName
    ? `${provider} - ${chatName}`
    : `${provider} #${chatId.slice(0, 12)}`;

  const conversation = await createConversation({
    title,
    presetId: 'profclaw-assistant',
  });

  channelConversations.set(key, conversation.id);
  return conversation.id;
}

// ERROR HELPERS

function friendlyErrorReply(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Something went wrong. Please try again.';
  }

  const msg = error.message.toLowerCase();

  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many requests')) {
    return "I'm being rate limited by the AI provider. Please wait a moment.";
  }
  if (msg.includes('quota') || msg.includes('insufficient_quota') || msg.includes('billing')) {
    return 'My API quota is used up. Please check the billing.';
  }
  if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('invalid.*key') || msg.includes('authentication')) {
    return "My API key isn't working. Configuration needed.";
  }
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('econnrefused')) {
    return "The AI service isn't responding. Try again shortly.";
  }
  if (msg.includes('context_length') || msg.includes('too long') || msg.includes('token')) {
    return 'The conversation is too long. Starting a fresh context may help.';
  }

  return 'Something went wrong. Please try again.';
}

// MESSAGE HANDLER

async function handleIncomingMessage(event: ChatEvent, _context: RegistryChatContext): Promise<void> {
  const message = event.payload as IncomingMessage;

  // Skip if no text content
  if (!message.text?.trim()) return;

  // Concurrency guard (NanoClaw pattern) - send busy reply instead of silent drop
  if (activeCount >= MAX_CONCURRENT) {
    logger.warn('[MessageHandler] At concurrency limit', {
      provider: message.provider,
      chatId: message.chatId,
      activeCount,
    });
    try {
      await sendProviderMessage({
        provider: message.provider,
        accountId: message.accountId,
        to: message.chatId,
        text: "I'm handling many requests right now. Please try again in a moment.",
        threadId: message.threadId,
        replyToId: message.id,
      });
    } catch {
      // If we can't even send the busy reply, just log and move on
    }
    return;
  }

  const groupManager = getGroupChatManager();

  // Mention gating - respects DM, reply, mention rules
  if (!groupManager.shouldRespond(message)) {
    return;
  }

  // Rate limiting (sliding window)
  const rateCheck = groupManager.checkRateLimit(message.senderId, message.chatId);
  if (!rateCheck.allowed) {
    const cooldownMsg = rateCheck.message ?? "You're sending messages too fast. Please wait a moment.";
    await sendProviderMessage({
      provider: message.provider,
      accountId: message.accountId,
      to: message.chatId,
      text: cooldownMsg,
      threadId: message.threadId,
      replyToId: message.id,
    });
    return;
  }

  // Track user activity
  groupManager.trackUser(message);

  activeCount++;
  let responseSentToUser = false;

  try {
    // Get or create conversation keyed by provider:accountId:chatId
    const conversationId = await getOrCreateChannelConversation(
      message.provider,
      message.accountId,
      message.chatId,
      message.chatName,
    );

    // Load history
    const history = await getConversationMessages(conversationId);

    // Compaction check
    let messages = history;
    if (needsCompaction(messages)) {
      const result = await compactMessages(messages);
      messages = result.messages;
    }

    // Resolve model - per-conversation override, smart routing, or system default
    const sessionModel = getSessionModel(conversationId);

    // Smart Model Router: auto-select cheapest capable model when no explicit override
    const { aiProvider } = await import('../providers/ai-sdk.js');
    let resolvedModel = sessionModel;
    let routingDecision;

    if (!sessionModel && isSmartRouterEnabled()) {
      const availableProviders = new Set(aiProvider.getConfiguredProviders() as ProviderType[]);
      routingDecision = routeQuery(message.text, availableProviders, {
        conversationLength: messages.length,
        hasToolUse: false, // simple chat path has no tools
        hasImages: false,
      });
      resolvedModel = routingDecision.selectedModel.id;
      recordRoutingDecision(routingDecision);
    }

    // Build system prompt with channel personality
    const personality = groupManager.getPersonality(message.chatId, message.provider);
    const promptContext: PromptChatContext = {
      user: {
        name: message.senderName || message.senderUsername,
      },
      runtime: {
        model: resolvedModel,
        conversationId,
      },
    };

    let systemPrompt = await buildSystemPrompt('profclaw-assistant', promptContext);
    if (personality?.systemPrompt) {
      systemPrompt += `\n\n${personality.systemPrompt}`;
    }

    // Convert history to ChatMessage format for the AI
    const aiMessages: ChatMessage[] = messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: m.createdAt,
    }));

    // Add the new user message
    aiMessages.push({
      id: message.id,
      role: 'user',
      content: message.text,
      timestamp: message.timestamp.toISOString(),
    });

    // Call AI with smart-routed or user-selected model
    const response = await aiProvider.chat({
      messages: aiMessages,
      model: resolvedModel,
      systemPrompt,
      temperature: 0.7,
    });

    // Get reply target (thread/reply context from group manager)
    const replyTarget = groupManager.getReplyTarget(message);

    // Send response back to the channel
    const sendResult = await sendProviderMessage({
      provider: message.provider,
      accountId: message.accountId,
      to: message.chatId,
      text: response.content,
      threadId: replyTarget.threadId,
      replyToId: replyTarget.replyToId,
    });

    responseSentToUser = sendResult.success;

    // Persist both messages
    await addMessage({
      conversationId,
      role: 'user',
      content: message.text,
    });

    await addMessage({
      conversationId,
      role: 'assistant',
      content: response.content,
      model: response.model,
      provider: response.provider,
      tokenUsage: {
        prompt: response.usage.promptTokens,
        completion: response.usage.completionTokens,
        total: response.usage.totalTokens,
      },
      cost: response.usage.cost,
    });

    logger.info('[MessageHandler] Processed message', {
      provider: message.provider,
      chatId: message.chatId,
      conversationId,
      model: response.model,
      tokens: response.usage.totalTokens,
      ...(routingDecision && {
        smartRouted: true,
        complexity: routingDecision.complexity.tier,
        savings: `${routingDecision.savingsPercent}%`,
      }),
    });

    // Track query for automation pattern detection (non-blocking)
    patternDetector.recordQuery(message.text);
    const automationHint = patternDetector.detectPatterns();
    if (automationHint) {
      // Send a follow-up suggestion message
      const hint = automationHint.suggestion;
      const suggestionText = `${hint.message}\n\nI can set this up: "${hint.templateName}" (${hint.suggestedCron}).\nJust say "automate it" or "set it up" to create this automation.`;

      sendProviderMessage({
        provider: message.provider,
        accountId: message.accountId,
        to: message.chatId,
        text: suggestionText,
        threadId: replyTarget.threadId,
      }).catch(() => {}); // fire and forget

      logger.info('[MessageHandler] Automation pattern detected', {
        pattern: automationHint.pattern,
        count: automationHint.count,
        template: hint.templateName,
      });
    }

    // Observational memory: extract learnings every 10 messages (async, non-blocking)
    if (messages.length > 0 && messages.length % 10 === 0) {
      const observationMessages = messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
      observeWindow(conversationId, observationMessages, 20, message.senderUsername)
        .catch(() => {}); // fire and forget
    }
  } catch (error) {
    logger.error('[MessageHandler] Failed to process message', {
      provider: message.provider,
      chatId: message.chatId,
      error: error instanceof Error ? error.message : String(error),
    });

    // Send friendly error reply (NanoClaw pattern: only if we haven't sent output yet)
    if (!responseSentToUser) {
      try {
        await sendProviderMessage({
          provider: message.provider,
          accountId: message.accountId,
          to: message.chatId,
          text: friendlyErrorReply(error),
          threadId: message.threadId,
          replyToId: message.id,
        });
      } catch {
        // If we can't even send the error, just log it
        logger.error('[MessageHandler] Failed to send error reply');
      }
    }
  } finally {
    activeCount--;
  }
}

// REGISTRATION

/**
 * Register the messenger message handler.
 * Call once at startup after conversation tables are initialized.
 * Returns an unsubscribe function.
 */
export function registerMessageHandler(): () => void {
  const registry = getChatRegistry();
  const unsubscribe = registry.on('message', handleIncomingMessage);

  logger.info('[MessageHandler] Registered messenger-to-AI pipeline');
  return unsubscribe;
}

// Exported for testing
export { handleIncomingMessage, getOrCreateChannelConversation, friendlyErrorReply, channelConversations };
