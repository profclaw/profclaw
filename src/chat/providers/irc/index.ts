/**
 * IRC Provider - Full Implementation
 *
 * IRC (Internet Relay Chat) integration using raw TCP/TLS socket:
 * - TLS connection (default port 6697) or plain TCP (port 6667)
 * - NICK + USER registration then JOIN configured channels
 * - Send via PRIVMSG, receive via PRIVMSG parsing
 * - PING/PONG keepalive
 * - Module-level persistent connection, initialized on first send
 * - No threads, no reactions, no rich blocks, no OAuth
 *
 * Protocol reference: RFC 1459 / RFC 2812
 */

import * as net from 'net';
import * as tls from 'tls';
import { z } from 'zod';
import type {
  ChatProvider,
  IRCAccountConfig,
  ChatProviderMeta,
  ChatProviderCapabilities,
  AuthAdapter,
  OutboundAdapter,
  InboundAdapter,
  StatusAdapter,
  SendResult,
  IncomingMessage,
  SlashCommand,
  InteractiveAction,
  CommandResponse,
  OutgoingMessage,
} from '../types.js';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// IRC PROTOCOL TYPES
// =============================================================================

/** Parsed IRC message (RFC 1459) */
interface IRCMessage {
  prefix?: string;           // :nick!user@host  or  :server
  command: string;           // PRIVMSG, PING, 001, etc.
  params: string[];          // Space-separated parameters
  trailing?: string;         // Text after the final colon
}

/** Internal connection state */
type ConnectionState = 'disconnected' | 'connecting' | 'registering' | 'ready' | 'error';

/** Holds the active socket and state for one IRC session */
interface IRCConnection {
  socket: net.Socket | tls.TLSSocket;
  state: ConnectionState;
  nick: string;
  buffer: string;            // Incomplete line accumulator
  /** Callbacks waiting for READY (state = 'ready') */
  readyCallbacks: Array<() => void>;
  messageHandlers: Array<(msg: IRCMessage) => void>;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

export const IRCAccountConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().optional(),
  provider: z.literal('irc'),
  server: z.string().optional(),
  port: z.number().int().min(1).max(65535).default(6697),
  nick: z.string().optional(),
  password: z.string().optional(),
  channels: z.array(z.string()).optional(),
  useTLS: z.boolean().default(true),
}) satisfies z.ZodType<IRCAccountConfig>;

type IRCConfig = z.infer<typeof IRCAccountConfigSchema>;

// =============================================================================
// METADATA
// =============================================================================

const meta: ChatProviderMeta = {
  id: 'irc',
  name: 'IRC',
  description: 'Internet Relay Chat - classic channel-based messaging over TCP/TLS',
  icon: '#',
  docsUrl: 'https://www.rfc-editor.org/rfc/rfc2812',
  order: 10,
  color: '#6B7280',
};

// =============================================================================
// CAPABILITIES
// =============================================================================

const capabilities: ChatProviderCapabilities = {
  chatTypes: ['direct', 'channel'],
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
  realtime: true,  // Persistent TCP socket
};

// =============================================================================
// MODULE-LEVEL STATE
// =============================================================================

let currentConfig: IRCConfig | null = null;
let activeConnection: IRCConnection | null = null;

// =============================================================================
// IRC PROTOCOL HELPERS
// =============================================================================

/**
 * Parse a raw IRC line into a structured IRCMessage.
 * Format: [:prefix] COMMAND [params...] [:trailing]
 */
function parseIRCLine(line: string): IRCMessage | null {
  if (!line.trim()) return null;

  let rest = line;
  let prefix: string | undefined;

  // Extract optional prefix
  if (rest.startsWith(':')) {
    const spaceIdx = rest.indexOf(' ');
    if (spaceIdx === -1) return null;
    prefix = rest.slice(1, spaceIdx);
    rest = rest.slice(spaceIdx + 1);
  }

  // Extract trailing (after final ' :')
  let trailing: string | undefined;
  const trailingIdx = rest.indexOf(' :');
  if (trailingIdx !== -1) {
    trailing = rest.slice(trailingIdx + 2);
    rest = rest.slice(0, trailingIdx);
  }

  const parts = rest.split(' ').filter((p) => p.length > 0);
  if (parts.length === 0) return null;

  const command = parts[0].toUpperCase();
  const params = parts.slice(1);
  if (trailing !== undefined) {
    params.push(trailing);
  }

  return { prefix, command, params, trailing };
}

/**
 * Extract the nick portion from a prefix string.
 * prefix format: nick!user@host  or  server
 */
function nickFromPrefix(prefix: string): string {
  const bangIdx = prefix.indexOf('!');
  return bangIdx !== -1 ? prefix.slice(0, bangIdx) : prefix;
}

/**
 * Determine whether the target of a PRIVMSG is a channel or a user.
 * Channels begin with '#', '&', '+', or '!' per RFC 2812.
 */
function isChannelTarget(target: string): boolean {
  return /^[#&+!]/.test(target);
}

/**
 * Write a line to the socket, appending CRLF.
 * Silently drops the write if the socket is destroyed.
 */
function writeLine(socket: net.Socket | tls.TLSSocket, line: string): void {
  if (socket.destroyed) return;
  socket.write(`${line}\r\n`, 'utf8');
}

// =============================================================================
// CONNECTION MANAGER
// =============================================================================

/**
 * Create a new IRC connection from the given config.
 * Performs the registration handshake (PASS, NICK, USER) then
 * joins configured channels once the server sends RPL_WELCOME (001).
 */
function createConnection(config: IRCConfig): IRCConnection {
  const nick = config.nick ?? 'profclaw';
  const server = config.server ?? 'irc.libera.chat';
  const port = config.port ?? 6697;
  const useTLS = config.useTLS ?? true;

  const conn: IRCConnection = {
    socket: null as unknown as net.Socket,  // filled below
    state: 'connecting',
    nick,
    buffer: '',
    readyCallbacks: [],
    messageHandlers: [],
  };

  logger.info(`[IRC] Connecting to ${server}:${port} (TLS=${useTLS}) as ${nick}`);

  const socket = useTLS
    ? tls.connect({ host: server, port, rejectUnauthorized: true })
    : net.createConnection({ host: server, port });

  conn.socket = socket;

  socket.setEncoding('utf8');

  socket.on('data', (chunk: string) => {
    conn.buffer += chunk;
    const lines = conn.buffer.split('\r\n');
    // Last element is either empty or a partial line
    conn.buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line) continue;
      const msg = parseIRCLine(line);
      if (!msg) continue;

      // Dispatch to all registered handlers
      for (const handler of conn.messageHandlers) {
        try {
          handler(msg);
        } catch (err) {
          logger.error('[IRC] Message handler error:', err instanceof Error ? err : undefined);
        }
      }
    }
  });

  socket.on('error', (err: Error) => {
    logger.error(`[IRC] Socket error: ${err.message}`);
    conn.state = 'error';
    activeConnection = null;
  });

  socket.on('close', () => {
    logger.info('[IRC] Connection closed');
    conn.state = 'disconnected';
    if (activeConnection === conn) {
      activeConnection = null;
    }
  });

  // ---- Registration state machine ----
  conn.state = 'registering';

  conn.messageHandlers.push((msg: IRCMessage) => {
    // Respond to server PING to stay connected
    if (msg.command === 'PING') {
      const pongTarget = msg.params[0] ?? '';
      writeLine(socket, `PONG :${pongTarget}`);
      return;
    }

    // RPL_WELCOME - registration complete
    if (msg.command === '001' && conn.state === 'registering') {
      conn.state = 'ready';
      logger.info(`[IRC] Registered as ${nick} on ${server}`);

      // Join configured channels
      const channels = config.channels ?? [];
      for (const channel of channels) {
        writeLine(socket, `JOIN ${channel}`);
        logger.info(`[IRC] Joining ${channel}`);
      }

      // Flush queued ready callbacks
      for (const cb of conn.readyCallbacks) {
        try { cb(); } catch { /* ignore */ }
      }
      conn.readyCallbacks = [];
    }

    // ERR_NICKNAMEINUSE - append underscore and retry
    if (msg.command === '433' && conn.state === 'registering') {
      conn.nick = `${conn.nick}_`;
      writeLine(socket, `NICK ${conn.nick}`);
    }
  });

  // Send registration commands once TCP is established
  const sendRegistration = (): void => {
    if (config.password) {
      writeLine(socket, `PASS ${config.password}`);
    }
    writeLine(socket, `NICK ${nick}`);
    writeLine(socket, `USER profclaw 0 * :profClaw bot`);
  };

  if (useTLS) {
    (socket as tls.TLSSocket).on('secureConnect', sendRegistration);
  } else {
    socket.on('connect', sendRegistration);
  }

  return conn;
}

/**
 * Get or create the active connection.
 * Returns a Promise that resolves once the connection is in 'ready' state.
 */
async function getOrCreateConnection(config: IRCConfig): Promise<IRCConnection> {
  // Reuse an existing ready or registering connection
  if (activeConnection && activeConnection.state !== 'error' && activeConnection.state !== 'disconnected') {
    if (activeConnection.state === 'ready') {
      return activeConnection;
    }
    // Still registering - wait for ready
    return new Promise<IRCConnection>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('IRC connection timed out waiting for ready'));
      }, 30_000);

      activeConnection!.readyCallbacks.push(() => {
        clearTimeout(timeout);
        resolve(activeConnection!);
      });
    });
  }

  // Create a new connection
  const conn = createConnection(config);
  activeConnection = conn;

  if (conn.state === 'ready') {
    return conn;
  }

  return new Promise<IRCConnection>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('IRC connection timed out waiting for ready'));
    }, 30_000);

    conn.readyCallbacks.push(() => {
      clearTimeout(timeout);
      resolve(conn);
    });

    conn.socket.on('error', (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Disconnect the active IRC session cleanly.
 */
export function disconnectIRC(reason = 'Disconnecting'): void {
  if (!activeConnection) return;
  const conn = activeConnection;
  activeConnection = null;
  try {
    writeLine(conn.socket, `QUIT :${reason}`);
    conn.socket.destroy();
  } catch { /* ignore */ }
  conn.state = 'disconnected';
}

// =============================================================================
// AUTH ADAPTER
// =============================================================================

const authAdapter: AuthAdapter = {
  getAuthUrl(_state: string, _scopes?: string[]): string {
    throw new Error(
      'IRC does not use OAuth. Configure server, nick, and password directly in the account settings.'
    );
  },

  async exchangeCode(_code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  }> {
    throw new Error(
      'IRC does not use OAuth authorization codes. ' +
      'Authenticate with NickServ password via the password config field.'
    );
  },

  verifyWebhook(_signature: string, _timestamp: string, _body: string): boolean {
    // IRC does not use webhooks or HMAC signatures.
    return false;
  },
};

// =============================================================================
// OUTBOUND ADAPTER
// =============================================================================

const outboundAdapter: OutboundAdapter = {
  async send(message: OutgoingMessage): Promise<SendResult> {
    if (!currentConfig?.server) {
      return { success: false, error: 'IRC server not configured' };
    }

    if (!currentConfig.nick) {
      return { success: false, error: 'IRC nick not configured' };
    }

    if (!message.to) {
      return { success: false, error: 'Target channel or nick (to) is required' };
    }

    const text = message.text ?? '';
    if (!text) {
      return { success: false, error: 'Message text is required for IRC' };
    }

    let conn: IRCConnection;
    try {
      conn = await getOrCreateConnection(currentConfig);
    } catch (error) {
      logger.error('[IRC] Failed to get connection for send:', error instanceof Error ? error : undefined);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to connect to IRC server',
      };
    }

    try {
      // Split multi-line messages - IRC does not support newlines in a single PRIVMSG
      const lines = text.split('\n').filter((l) => l.trim().length > 0);
      for (const line of lines) {
        writeLine(conn.socket, `PRIVMSG ${message.to} :${line}`);
      }

      // IRC does not provide message IDs; use a timestamp-based identifier
      const messageId = `irc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      return {
        success: true,
        messageId,
      };
    } catch (error) {
      logger.error('[IRC] Send failed:', error instanceof Error ? error : undefined);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send IRC message',
      };
    }
  },
};

// =============================================================================
// INBOUND ADAPTER
// =============================================================================

const inboundAdapter: InboundAdapter = {
  parseMessage(payload: unknown): IncomingMessage | null {
    // Accepts either a raw IRCMessage or a string (raw IRC line)
    let msg: IRCMessage | null;

    if (typeof payload === 'string') {
      msg = parseIRCLine(payload);
    } else if (
      payload !== null &&
      typeof payload === 'object' &&
      'command' in (payload as Record<string, unknown>)
    ) {
      msg = payload as IRCMessage;
    } else {
      return null;
    }

    if (!msg || msg.command !== 'PRIVMSG') return null;

    // params[0] = target (#channel or nick), params[1] = text (trailing)
    const target = msg.params[0];
    const text = msg.params[1] ?? msg.trailing ?? '';

    if (!target || !text) return null;
    if (!msg.prefix) return null;

    const senderNick = nickFromPrefix(msg.prefix);

    // Ignore messages from the bot itself
    if (currentConfig?.nick && senderNick === currentConfig.nick) return null;

    const chatIsChannel = isChannelTarget(target);
    const chatType = chatIsChannel ? 'channel' : 'direct';

    // For channels, chatId is the channel name. For DMs, it is the sender nick.
    const chatId = chatIsChannel ? target : senderNick;
    const chatName = chatIsChannel ? target : undefined;

    // Generate a synthetic message ID (IRC has no native IDs)
    const id = `irc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return {
      id,
      provider: 'irc',
      accountId: currentConfig?.id ?? 'default',
      senderId: msg.prefix,
      senderName: senderNick,
      senderUsername: senderNick,
      chatType,
      chatId,
      chatName,
      text,
      rawContent: msg,
      timestamp: new Date(),
    };
  },

  parseCommand(_payload: unknown): SlashCommand | null {
    // IRC has no native slash commands.
    return null;
  },

  parseAction(_payload: unknown): InteractiveAction | null {
    // IRC has no interactive components.
    return null;
  },

  buildCommandResponse(response: CommandResponse): unknown {
    // Return a plain string ready to pass to PRIVMSG.
    return response.text ?? '';
  },

  buildActionResponse(response: CommandResponse): unknown {
    return response.text ?? '';
  },
};

// =============================================================================
// STATUS ADAPTER
// =============================================================================

const statusAdapter: StatusAdapter = {
  isConfigured(config: IRCAccountConfig): boolean {
    return !!(config.server && config.nick);
  },

  async checkHealth(config: IRCAccountConfig): Promise<{
    connected: boolean;
    latencyMs?: number;
    error?: string;
    details?: Record<string, unknown>;
  }> {
    if (!config.server || !config.nick) {
      return { connected: false, error: 'server and nick are required' };
    }

    const port = config.port ?? 6697;
    const useTLS = config.useTLS ?? true;
    const start = Date.now();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({
          connected: false,
          latencyMs: Date.now() - start,
          error: 'Connection timed out (5s)',
          details: {
            server: config.server,
            port,
            useTLS,
          },
        });
      }, 5_000);

      const onConnect = (): void => {
        clearTimeout(timeout);
        const latencyMs = Date.now() - start;
        testSocket.destroy();
        resolve({
          connected: true,
          latencyMs,
          details: {
            server: config.server,
            port,
            useTLS,
            nick: config.nick,
            channels: config.channels ?? [],
          },
        });
      };

      const onError = (err: Error): void => {
        clearTimeout(timeout);
        resolve({
          connected: false,
          latencyMs: Date.now() - start,
          error: err.message,
          details: { server: config.server, port, useTLS },
        });
      };

      let testSocket: net.Socket | tls.TLSSocket;

      try {
        if (useTLS) {
          testSocket = tls.connect(
            { host: config.server, port, rejectUnauthorized: true },
            onConnect
          );
        } else {
          testSocket = net.createConnection({ host: config.server as string, port }, onConnect);
        }
        testSocket.on('error', onError);
      } catch (err) {
        clearTimeout(timeout);
        resolve({
          connected: false,
          latencyMs: Date.now() - start,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    });
  },
};

// =============================================================================
// CONFIG MANAGEMENT
// =============================================================================

export function setIRCConfig(config: IRCConfig): void {
  currentConfig = config;
}

export function clearIRCConfig(): void {
  currentConfig = null;
}

// =============================================================================
// EXPORTED HELPERS
// =============================================================================

/**
 * Register a handler that will be called for every parsed IRC message
 * received on the active connection. Useful for inbound message routing.
 * Returns an unsubscribe function.
 */
export function onIRCMessage(
  handler: (msg: IRCMessage) => void
): () => void {
  if (!activeConnection) {
    logger.warn('[IRC] onIRCMessage: no active connection; handler will not fire until connect');
    return () => { /* noop */ };
  }
  activeConnection.messageHandlers.push(handler);
  return () => {
    if (activeConnection) {
      activeConnection.messageHandlers = activeConnection.messageHandlers.filter(
        (h) => h !== handler
      );
    }
  };
}

/**
 * Join an IRC channel on the active connection.
 * Connects first if not already connected.
 */
export async function joinChannel(channel: string): Promise<{ success: boolean; error?: string }> {
  if (!currentConfig) {
    return { success: false, error: 'IRC not configured' };
  }
  try {
    const conn = await getOrCreateConnection(currentConfig);
    writeLine(conn.socket, `JOIN ${channel}`);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to join channel',
    };
  }
}

/**
 * Part (leave) an IRC channel on the active connection.
 */
export function partChannel(channel: string, reason = 'Leaving'): void {
  if (!activeConnection || activeConnection.state !== 'ready') return;
  writeLine(activeConnection.socket, `PART ${channel} :${reason}`);
}

// =============================================================================
// PROVIDER EXPORT
// =============================================================================

export const ircProvider: ChatProvider<IRCAccountConfig> = {
  meta,
  capabilities,
  defaultConfig: {
    provider: 'irc',
    enabled: true,
    port: 6697,
    useTLS: true,
    channels: [],
  },
  configSchema: IRCAccountConfigSchema as z.ZodType<IRCAccountConfig>,
  auth: authAdapter,
  outbound: outboundAdapter,
  inbound: inboundAdapter,
  status: statusAdapter,
};

export type { IRCMessage, IRCConnection, ConnectionState, IRCConfig };
