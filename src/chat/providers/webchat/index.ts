/**
 * WebChat Provider
 *
 * Browser-based chat interface via SSE (Server-Sent Events).
 * Enables zero-install access to profClaw from any browser.
 * Session-based with optional anonymous access and rate limiting.
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import type {
  ChatProvider,
  WebChatAccountConfig,
  ChatProviderMeta,
  ChatProviderCapabilities,
  OutboundAdapter,
  InboundAdapter,
  StatusAdapter,
  SendResult,
  IncomingMessage,
  SlashCommand,
  InteractiveAction,
  CommandResponse,
  OutgoingMessage,
  ChatAccountConfig,
} from '../types.js';
// =============================================================================
// SESSION MANAGEMENT
// =============================================================================

interface WebChatSession {
  id: string;
  userId: string;
  userName: string;
  ip: string;
  createdAt: Date;
  lastActiveAt: Date;
  controller: ReadableStreamDefaultController<Uint8Array> | null;
}

const sessions = new Map<string, WebChatSession>();
const encoder = new TextEncoder();

// Cleanup expired sessions every 5 minutes
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes default
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActiveAt.getTime() > SESSION_TIMEOUT_MS) {
      if (session.controller) {
        try { session.controller.close(); } catch { /* already closed */ }
      }
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

// =============================================================================
// PUBLIC API
// =============================================================================

/** Create a new WebChat session. Returns session ID. */
export function createSession(opts: {
  userId?: string;
  userName?: string;
  ip: string;
}): string {
  const sessionId = randomUUID();
  sessions.set(sessionId, {
    id: sessionId,
    userId: opts.userId || `anon-${sessionId.slice(0, 8)}`,
    userName: opts.userName || 'Anonymous',
    ip: opts.ip,
    createdAt: new Date(),
    lastActiveAt: new Date(),
    controller: null,
  });
  return sessionId;
}

/** Get session by ID. */
export function getSession(sessionId: string): WebChatSession | undefined {
  const session = sessions.get(sessionId);
  if (session) {
    session.lastActiveAt = new Date();
  }
  return session;
}

/** Attach SSE controller to a session. */
export function attachSSE(sessionId: string, controller: ReadableStreamDefaultController<Uint8Array>): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;

  // Close previous connection if any
  if (session.controller) {
    try { session.controller.close(); } catch { /* ok */ }
  }
  session.controller = controller;
  return true;
}

/** Send a message to a specific session via SSE. */
export function sendToSession(sessionId: string, eventType: string, data: Record<string, unknown>): boolean {
  const session = sessions.get(sessionId);
  if (!session?.controller) return false;

  try {
    const msg = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    session.controller.enqueue(encoder.encode(msg));
    return true;
  } catch {
    // Connection closed
    session.controller = null;
    return false;
  }
}

/** Remove a session. */
export function removeSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session?.controller) {
    try { session.controller.close(); } catch { /* ok */ }
  }
  sessions.delete(sessionId);
}

/** Get active session count. */
export function getSessionCount(): number {
  return sessions.size;
}

/** Count sessions per IP for rate limiting. */
export function getSessionCountByIp(ip: string): number {
  let count = 0;
  for (const session of sessions.values()) {
    if (session.ip === ip) count++;
  }
  return count;
}

// =============================================================================
// WEBCHAT PROVIDER IMPLEMENTATION
// =============================================================================

const meta: ChatProviderMeta = {
  id: 'webchat',
  name: 'WebChat',
  description: 'Browser-based chat via SSE',
  icon: 'message-circle',
  order: 0,
  color: '#6366f1',
};

const capabilities: ChatProviderCapabilities = {
  chatTypes: ['direct'],
  send: true,
  receive: true,
  slashCommands: false,
  interactiveComponents: false,
  reactions: false,
  edit: false,
  delete: false,
  threads: false,
  media: false,
  richBlocks: false,
  oauth: false,
  webhooks: false,
  realtime: true,
};

const outbound: OutboundAdapter = {
  async send(message: OutgoingMessage): Promise<SendResult> {
    const sessionId = message.to;
    const messageId = randomUUID();

    const sent = sendToSession(sessionId, 'message', {
      id: messageId,
      text: message.text || '',
      timestamp: new Date().toISOString(),
      from: 'assistant',
    });

    if (!sent) {
      return { success: false, error: 'Session not found or disconnected' };
    }

    return { success: true, messageId };
  },
};

const inbound: InboundAdapter = {
  parseMessage(payload: unknown): IncomingMessage | null {
    const data = payload as Record<string, unknown>;
    if (!data?.sessionId || !data?.text) return null;

    const session = getSession(data.sessionId as string);
    if (!session) return null;

    return {
      id: randomUUID(),
      provider: 'webchat',
      accountId: 'default',
      senderId: session.userId,
      senderName: session.userName,
      chatType: 'direct',
      chatId: session.id,
      text: data.text as string,
      timestamp: new Date(),
    };
  },

  parseCommand(_payload: unknown): SlashCommand | null {
    return null; // WebChat doesn't support slash commands
  },

  parseAction(_payload: unknown): InteractiveAction | null {
    return null; // WebChat doesn't support interactive actions
  },

  buildCommandResponse(response: CommandResponse): unknown {
    return { text: response.text };
  },
};

const status: StatusAdapter = {
  isConfigured(_config: ChatAccountConfig): boolean {
    return true; // WebChat is always available
  },

  async checkHealth(_config: ChatAccountConfig): Promise<{
    connected: boolean;
    latencyMs?: number;
    error?: string;
    details?: Record<string, unknown>;
  }> {
    return {
      connected: true,
      details: {
        activeSessions: getSessionCount(),
      },
    };
  },
};

const configSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  provider: z.literal('webchat'),
  allowAnonymous: z.boolean().optional(),
  maxSessionsPerIp: z.number().optional(),
  sessionTimeoutMs: z.number().optional(),
}) as z.ZodType<WebChatAccountConfig>;

export const webchatProvider: ChatProvider<WebChatAccountConfig> = {
  meta,
  capabilities,
  defaultConfig: {
    provider: 'webchat',
    allowAnonymous: true,
    maxSessionsPerIp: 5,
    sessionTimeoutMs: 30 * 60 * 1000,
  },
  configSchema,
  outbound,
  inbound,
  status,
};
