/**
 * Tlon Provider - Urbit/Tlon messaging via ship HTTP API
 * Connects to an Urbit ship for decentralized messaging.
 * API: ship HTTP interface (Eyre)
 */

import { z } from 'zod';
import type {
  ChatProvider,
  TlonAccountConfig,
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

// --- API types ---

interface UrbitPostContent {
  text?: string;
}

interface UrbitPost {
  author: string;
  'time-sent': number;
  contents: UrbitPostContent[];
  index: string;
}

interface UrbitNode {
  post: UrbitPost;
}

interface UrbitAddNodes {
  resource: { ship: string; name: string };
  nodes: Record<string, UrbitNode>;
}

interface UrbitGraphUpdate {
  'add-nodes'?: UrbitAddNodes;
}

interface UrbitEventJson {
  'graph-update'?: UrbitGraphUpdate;
}

interface UrbitEvent {
  id: number;
  response: string;
  json?: UrbitEventJson;
}

// --- Schema ---

export const TlonAccountConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().optional(),
  provider: z.literal('tlon'),
  shipUrl: z.string().optional(),
  shipCode: z.string().optional(),
  shipName: z.string().optional(),
  channelPath: z.string().optional(),
}) satisfies z.ZodType<TlonAccountConfig>;

type TlonConfig = z.infer<typeof TlonAccountConfigSchema>;

// --- State ---

let currentConfig: TlonConfig | null = null;
let sessionCookie: string | null = null;

// --- HTTP helper ---

async function authenticateShip(config: TlonConfig): Promise<string | null> {
  if (!config.shipUrl || !config.shipCode) return null;

  try {
    const res = await fetch(`${config.shipUrl}/~/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `password=${encodeURIComponent(config.shipCode)}`,
      redirect: 'manual',
    });

    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const match = setCookie.match(/urbauth-[^=]+=([^;]+)/);
      if (match) return match[0];
    }
    return null;
  } catch (error) {
    logger.error('[Tlon] Authentication failed:', error instanceof Error ? error : undefined);
    return null;
  }
}

async function callShipApi<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' = 'GET',
  body?: unknown,
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const config = currentConfig;
  if (!config?.shipUrl) return { ok: false, error: 'Ship URL not configured' };

  if (!sessionCookie) {
    sessionCookie = await authenticateShip(config);
    if (!sessionCookie) return { ok: false, error: 'Authentication failed' };
  }

  const makeRequest = async (cookie: string): Promise<Response> =>
    fetch(`${config.shipUrl}${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  try {
    let res = await makeRequest(sessionCookie);

    if (res.status === 401 || res.status === 403) {
      sessionCookie = await authenticateShip(config);
      if (!sessionCookie) return { ok: false, error: 'Re-authentication failed' };
      res = await makeRequest(sessionCookie);
    }

    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json() as T;
    return { ok: true, data };
  } catch (error) {
    logger.error('[Tlon] API call failed:', error instanceof Error ? error : undefined);
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// --- Adapters ---

const authAdapter: AuthAdapter = {
  getAuthUrl(_state: string, _scopes?: string[]): string {
    throw new Error('Tlon uses ship +code authentication. Get your code with +code in Dojo.');
  },
  async exchangeCode(_code: string): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
    throw new Error('Tlon does not use OAuth. Configure shipUrl and shipCode.');
  },
  verifyWebhook(_signature: string, _timestamp: string, _body: string): boolean {
    // Urbit uses session cookies, not webhook signatures
    return true;
  },
};

const outboundAdapter: OutboundAdapter = {
  async send(message: OutgoingMessage): Promise<SendResult> {
    if (!currentConfig?.shipUrl) return { success: false, error: 'Ship URL not configured' };

    const channelPath = message.to || currentConfig.channelPath;
    if (!channelPath) return { success: false, error: 'Channel path required (to or channelPath config)' };

    const result = await callShipApi('/~/channels/profclaw', 'PUT', [
      {
        id: Date.now(),
        action: 'poke',
        ship: currentConfig.shipName?.replace('~', '') ?? '',
        mark: 'graph-update-3',
        json: {
          'add-post': {
            resource: { ship: currentConfig.shipName ?? '', name: channelPath },
            body: {
              contents: [{ text: message.text ?? '' }],
            },
          },
        },
      },
    ]);

    return result.ok
      ? { success: true, messageId: `tlon-${Date.now()}` }
      : { success: false, error: result.error ?? 'Failed to send' };
  },
};

const inboundAdapter: InboundAdapter = {
  parseMessage(payload: unknown): IncomingMessage | null {
    const event = payload as UrbitEvent;
    if (!event?.json?.['graph-update']?.['add-nodes']) return null;

    const addNodes = event.json['graph-update']['add-nodes'];
    if (!addNodes) return null;

    const nodes = Object.values(addNodes.nodes);
    if (nodes.length === 0) return null;

    const node = nodes[0];
    const post = node.post;
    const text = post.contents
      .filter((c): c is { text: string } => typeof c.text === 'string')
      .map((c) => c.text)
      .join('');

    if (!text) return null;

    return {
      id: post.index || `tlon-${Date.now()}`,
      provider: 'tlon',
      accountId: currentConfig?.id ?? 'default',
      senderId: post.author,
      senderName: post.author,
      senderUsername: post.author,
      chatType: 'group',
      chatId: `${addNodes.resource.ship}/${addNodes.resource.name}`,
      chatName: addNodes.resource.name,
      threadId: undefined,
      replyToId: undefined,
      text,
      rawContent: event,
      timestamp: new Date(post['time-sent']),
      attachments: undefined,
    };
  },
  parseCommand(_payload: unknown): SlashCommand | null { return null; },
  parseAction(_payload: unknown): InteractiveAction | null { return null; },
  buildCommandResponse(response: CommandResponse): unknown { return { text: response.text ?? '' }; },
  buildActionResponse(response: CommandResponse): unknown { return { text: response.text ?? '' }; },
};

const statusAdapter: StatusAdapter = {
  isConfigured(config: TlonAccountConfig): boolean {
    return !!(config.shipUrl && config.shipCode);
  },
  async checkHealth(config: TlonAccountConfig): Promise<{
    connected: boolean;
    latencyMs?: number;
    error?: string;
    details?: Record<string, unknown>;
  }> {
    if (!config.shipUrl) return { connected: false, error: 'shipUrl is required' };
    if (!config.shipCode) return { connected: false, error: 'shipCode is required' };

    const start = Date.now();
    try {
      const res = await fetch(`${config.shipUrl}/~/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `password=${encodeURIComponent(config.shipCode)}`,
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      });
      const latencyMs = Date.now() - start;

      const hasCookie = res.headers.get('set-cookie')?.includes('urbauth') ?? false;
      return {
        connected: hasCookie,
        latencyMs,
        details: { shipName: config.shipName, status: res.status },
      };
    } catch (error) {
      return {
        connected: false,
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
};

// --- Config ---

export function setTlonConfig(config: TlonConfig): void {
  currentConfig = config;
  sessionCookie = null;
}

export function clearTlonConfig(): void {
  currentConfig = null;
  sessionCookie = null;
}

// --- Provider export ---

export const tlonProvider: ChatProvider<TlonAccountConfig> = {
  meta: {
    id: 'tlon',
    name: 'Tlon',
    description: 'Urbit/Tlon decentralized messaging via ship HTTP API',
    icon: 'Tlon icon',
    docsUrl: 'https://docs.urbit.org/',
    order: 23,
    color: '#000000',
  } satisfies ChatProviderMeta,
  capabilities: {
    chatTypes: ['group'],
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
  } satisfies ChatProviderCapabilities,
  defaultConfig: { provider: 'tlon', enabled: true },
  configSchema: TlonAccountConfigSchema as z.ZodType<TlonAccountConfig>,
  auth: authAdapter,
  outbound: outboundAdapter,
  inbound: inboundAdapter,
  status: statusAdapter,
};

export type { TlonConfig };
