/**
 * Group Chat Management Module
 *
 * Handles mention gating, reply threading, multi-user context tracking,
 * channel personality configuration, and per-user rate limiting.
 */

import { z } from 'zod';
import { logger } from '../utils/logger.js';
import type { ChatProviderId, IncomingMessage } from './providers/types.js';

// ---- Schemas and Types -------------------------------------------------------

export const MentionGateConfigSchema = z.object({
  enabled: z.boolean(),
  botNames: z.array(z.string()).min(1),
  respondInDMs: z.boolean().default(true),
  respondToReplies: z.boolean().default(true),
});

export type MentionGateConfig = z.infer<typeof MentionGateConfigSchema>;

export const ThreadingConfigSchema = z.object({
  preferThreads: z.boolean().default(true),
  threadTimeout: z.number().int().positive().default(30),
});

export type ThreadingConfig = z.infer<typeof ThreadingConfigSchema>;

export const RateLimitConfigSchema = z.object({
  maxMessagesPerMinute: z.number().int().positive().default(10),
  maxMessagesPerHour: z.number().int().positive().default(100),
  cooldownMessage: z.string().optional(),
});

export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;

export interface UserContext {
  userId: string;
  userName: string;
  provider: ChatProviderId;
  chatId: string;
  messageCount: number;
  lastSeen: number;
  metadata?: Record<string, unknown>;
}

export interface ChannelPersonality {
  chatId: string;
  provider: ChatProviderId;
  systemPrompt?: string;
  name?: string;
  responseStyle?: 'concise' | 'detailed' | 'casual' | 'professional';
}

export const GroupChatConfigSchema = z.object({
  mentionGate: MentionGateConfigSchema,
  threading: ThreadingConfigSchema,
  rateLimit: RateLimitConfigSchema,
  defaultPersonality: z
    .object({
      systemPrompt: z.string().optional(),
      name: z.string().optional(),
      responseStyle: z
        .enum(['concise', 'detailed', 'casual', 'professional'])
        .optional(),
    })
    .optional(),
});

export type GroupChatConfig = z.infer<typeof GroupChatConfigSchema>;

// ---- Rate Limit Internals ---------------------------------------------------

/** Sliding window timestamps per user+chat key */
type RateLimitEntry = {
  minuteWindow: number[];
  hourWindow: number[];
};

// ---- GroupChatManager -------------------------------------------------------

export class GroupChatManager {
  private readonly config: GroupChatConfig;

  /** userId:chatId -> UserContext */
  private readonly userContexts = new Map<string, UserContext>();

  /** chatId:provider -> ChannelPersonality */
  private readonly personalities = new Map<string, ChannelPersonality>();

  /** userId:chatId -> RateLimitEntry */
  private readonly rateLimitMap = new Map<string, RateLimitEntry>();

  /** chatId -> per-minute override (set via setRateLimit) */
  private readonly _channelRateLimits = new Map<string, number>();

  /** Cleanup timer reference */
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;

  constructor(config: GroupChatConfig) {
    this.config = GroupChatConfigSchema.parse(config);
    // Cleanup stale rate limit entries every 10 minutes
    this.cleanupTimer = setInterval(() => this._cleanupRateLimitMap(), 10 * 60 * 1000);
  }

  // -- 1. Mention Gating -------------------------------------------------------

  /** Returns true if the bot should respond to this message. */
  shouldRespond(message: IncomingMessage): boolean {
    const { mentionGate } = this.config;

    if (!mentionGate.enabled) return true;

    if (message.chatType === 'direct' && mentionGate.respondInDMs) return true;

    if (mentionGate.respondToReplies && message.replyToId !== undefined) {
      logger.debug('[GroupChatManager] Responding to reply', { messageId: message.id });
      return true;
    }

    const textLower = message.text.toLowerCase();
    const mentioned = mentionGate.botNames.some((name) =>
      textLower.includes(name.toLowerCase()),
    );

    if (mentioned) {
      logger.debug('[GroupChatManager] Bot mentioned', { messageId: message.id });
      return true;
    }

    return false;
  }

  // -- 2. Reply Threading ------------------------------------------------------

  /** Determines the appropriate thread/reply target for an outgoing response. */
  getReplyTarget(message: IncomingMessage): { threadId?: string; replyToId?: string } {
    const { preferThreads } = this.config.threading;

    // Stay in an existing thread
    if (message.threadId !== undefined) {
      return { threadId: message.threadId };
    }

    // Start/continue a thread for group and channel messages
    if (preferThreads && (message.chatType === 'group' || message.chatType === 'channel')) {
      return { threadId: message.id };
    }

    // DMs or threading not preferred - quote the originating message
    return { replyToId: message.id };
  }

  // -- 3. Multi-User Context ---------------------------------------------------

  /** Records or updates the user context from an incoming message. */
  trackUser(message: IncomingMessage): void {
    const key = this._userKey(message.senderId, message.chatId);
    const existing = this.userContexts.get(key);

    if (existing !== undefined) {
      existing.messageCount += 1;
      existing.lastSeen = Date.now();
      existing.userName = message.senderName;
    } else {
      this.userContexts.set(key, {
        userId: message.senderId,
        userName: message.senderName,
        provider: message.provider,
        chatId: message.chatId,
        messageCount: 1,
        lastSeen: Date.now(),
      });
    }
  }

  /** Returns the stored context for a specific user in a chat, if available. */
  getUserContext(userId: string, chatId: string): UserContext | undefined {
    return this.userContexts.get(this._userKey(userId, chatId));
  }

  /** Returns all users active in a chat within the given window (default: 1 hour). */
  getActiveUsers(chatId: string, sinceMs?: number): UserContext[] {
    const cutoff = Date.now() - (sinceMs ?? 60 * 60 * 1000);
    const results: UserContext[] = [];

    for (const ctx of this.userContexts.values()) {
      if (ctx.chatId === chatId && ctx.lastSeen >= cutoff) {
        results.push(ctx);
      }
    }

    return results;
  }

  // -- 4. Channel Personality --------------------------------------------------

  /** Stores or merges a personality configuration for a channel. */
  setPersonality(
    chatId: string,
    provider: ChatProviderId,
    personality: Partial<ChannelPersonality>,
  ): void {
    const key = this._channelKey(chatId, provider);
    const existing = this.personalities.get(key);

    if (existing !== undefined) {
      this.personalities.set(key, { ...existing, ...personality, chatId, provider });
    } else {
      this.personalities.set(key, {
        ...this.config.defaultPersonality,
        ...personality,
        chatId,
        provider,
      });
    }

    logger.info('[GroupChatManager] Channel personality updated', { chatId, provider });
  }

  /** Returns the personality for the given channel, or undefined if not set. */
  getPersonality(chatId: string, provider: ChatProviderId): ChannelPersonality | undefined {
    return this.personalities.get(this._channelKey(chatId, provider));
  }

  // -- 5. Per-User Rate Limiting -----------------------------------------------

  /** Checks whether a user is within rate limits (sliding window). */
  checkRateLimit(
    userId: string,
    chatId: string,
  ): { allowed: boolean; retryAfterMs?: number; message?: string } {
    const { maxMessagesPerHour, cooldownMessage } = this.config.rateLimit;
    const maxMessagesPerMinute =
      this._channelRateLimits.get(chatId) ?? this.config.rateLimit.maxMessagesPerMinute;
    const key = this._userKey(userId, chatId);
    const nowMs = Date.now();
    const oneMinuteAgo = nowMs - 60_000;
    const oneHourAgo = nowMs - 3_600_000;

    let entry = this.rateLimitMap.get(key);
    if (entry === undefined) {
      entry = { minuteWindow: [], hourWindow: [] };
      this.rateLimitMap.set(key, entry);
    }

    // Evict expired timestamps
    entry.minuteWindow = entry.minuteWindow.filter((ts) => ts > oneMinuteAgo);
    entry.hourWindow = entry.hourWindow.filter((ts) => ts > oneHourAgo);

    // Check per-minute limit
    if (entry.minuteWindow.length >= maxMessagesPerMinute) {
      const oldestInMinute = entry.minuteWindow[0];
      const retryAfterMs = oldestInMinute !== undefined
        ? oldestInMinute + 60_000 - nowMs
        : 60_000;

      logger.warn('[GroupChatManager] Per-minute rate limit reached', { userId, chatId });
      return {
        allowed: false,
        retryAfterMs: Math.max(retryAfterMs, 0),
        message: cooldownMessage ?? 'Too many messages. Please wait a moment.',
      };
    }

    // Check per-hour limit
    if (entry.hourWindow.length >= maxMessagesPerHour) {
      const oldestInHour = entry.hourWindow[0];
      const retryAfterMs = oldestInHour !== undefined
        ? oldestInHour + 3_600_000 - nowMs
        : 3_600_000;

      logger.warn('[GroupChatManager] Per-hour rate limit reached', { userId, chatId });
      return {
        allowed: false,
        retryAfterMs: Math.max(retryAfterMs, 0),
        message: cooldownMessage ?? 'Hourly message limit reached. Please try again later.',
      };
    }

    // Record this message
    entry.minuteWindow.push(nowMs);
    entry.hourWindow.push(nowMs);

    return { allowed: true };
  }

  // -- Convenience API (provider-agnostic) ------------------------------------

  /**
   * Returns a flat map of channelId -> systemPrompt for all stored personalities.
   * Used by the REST API layer where provider context is not available.
   */
  getChannelPersonalities(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const personality of this.personalities.values()) {
      if (personality.systemPrompt !== undefined) {
        result[personality.chatId] = personality.systemPrompt;
      }
    }
    return result;
  }

  /**
   * Sets the system prompt for a channel without requiring a provider.
   * Defaults to the 'slack' provider key so the entry is addressable.
   * For full provider-aware control use `setPersonality` directly.
   */
  setChannelPersonality(channelId: string, systemPrompt: string): void {
    // Use a dedicated provider key for API-configured personalities.
    const key = `api:${channelId}`;
    const existing = this.personalities.get(key);

    if (existing !== undefined) {
      this.personalities.set(key, { ...existing, systemPrompt });
    } else {
      this.personalities.set(key, {
        chatId: channelId,
        provider: 'slack', // placeholder; overridden when a real message arrives
        systemPrompt,
        ...this.config.defaultPersonality,
      });
    }

    logger.info('[GroupChatManager] Channel personality set via API', { channelId });
  }

  /**
   * Overrides the per-minute rate limit for a specific channel (all users in that chat).
   * The change is stored in the config's rateLimit field and applies to subsequent checks.
   */
  setRateLimit(channelId: string, maxPerMinute: number): void {
    // Store per-channel overrides in a private map so the global config is unchanged.
    this._channelRateLimits.set(channelId, maxPerMinute);
    logger.info('[GroupChatManager] Per-channel rate limit set', { channelId, maxPerMinute });
  }

  // -- Lifecycle ---------------------------------------------------------------

  /** Stops the background cleanup timer. Call when shutting down. */
  destroy(): void {
    if (this.cleanupTimer !== undefined) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  // -- Private Helpers ---------------------------------------------------------

  private _userKey(userId: string, chatId: string): string {
    return `${userId}:${chatId}`;
  }

  private _channelKey(chatId: string, provider: ChatProviderId): string {
    return `${provider}:${chatId}`;
  }

  /**
   * Removes rate limit entries that have no recent timestamps to free memory.
   */
  private _cleanupRateLimitMap(): void {
    const oneHourAgo = Date.now() - 3_600_000;
    let removed = 0;

    for (const [key, entry] of this.rateLimitMap.entries()) {
      const hasRecent =
        entry.minuteWindow.some((ts) => ts > oneHourAgo) ||
        entry.hourWindow.some((ts) => ts > oneHourAgo);

      if (!hasRecent) {
        this.rateLimitMap.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug('[GroupChatManager] Cleaned up stale rate limit entries', { removed });
    }
  }
}

// ---- Singleton --------------------------------------------------------------

let instance: GroupChatManager | undefined;

/**
 * Returns the shared GroupChatManager singleton.
 * Initializes with default config on first call if not already created.
 */
export function getGroupChatManager(config?: GroupChatConfig): GroupChatManager {
  if (instance === undefined) {
    instance = new GroupChatManager(config ?? createDefaultGroupChatConfig());
    logger.info('[GroupChatManager] Singleton initialized');
  }
  return instance;
}

// ---- Default Config ---------------------------------------------------------

/** Returns a sensible default GroupChatConfig suitable for most deployments. */
export function createDefaultGroupChatConfig(): GroupChatConfig {
  return {
    mentionGate: {
      enabled: true,
      botNames: ['profclaw', '@profclaw', 'pc'],
      respondInDMs: true,
      respondToReplies: true,
    },
    threading: {
      preferThreads: true,
      threadTimeout: 30,
    },
    rateLimit: {
      maxMessagesPerMinute: 10,
      maxMessagesPerHour: 100,
      cooldownMessage: 'You are sending messages too quickly. Please slow down.',
    },
  };
}
