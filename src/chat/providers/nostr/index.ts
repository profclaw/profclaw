/**
 * Nostr Provider - kind 1 (public note) and kind 4 (encrypted DM / NIP-04).
 * Outbound: POST signed events via bare ["EVENT", event] HTTP POST to relay.
 * Inbound: parse wire messages ["EVENT", subscription_id, { ...event }].
 * IMPORTANT: signing and NIP-04 encryption are TODO stubs.
 * Install @noble/secp256k1 + @noble/hashes and replace the stubs below.
 * Docs: https://github.com/nostr-protocol/nostr
 */

import { z } from 'zod';
import type {
  ChatProvider, NostrAccountConfig, ChatProviderMeta, ChatProviderCapabilities,
  AuthAdapter, OutboundAdapter, InboundAdapter, StatusAdapter, SendResult,
  IncomingMessage, SlashCommand, InteractiveAction, CommandResponse, OutgoingMessage,
} from '../types.js';
import { logger } from '../../../utils/logger.js';

// --- Types ---

const NostrKind = { PUBLIC_NOTE: 1, ENCRYPTED_DM: 4 } as const;
type NostrKindValue = (typeof NostrKind)[keyof typeof NostrKind];

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: NostrKindValue;
  tags: string[][];
  content: string;
  sig: string;
}

type NostrWireMessage = ['EVENT', string, NostrEvent] | [string, ...unknown[]];

// --- Config ---

export const NostrAccountConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().optional(),
  provider: z.literal('nostr'),
  privateKey: z.string().optional(),
  relayUrls: z.array(z.string().url()).optional(),
  allowedPubkeys: z.array(z.string()).optional(),
}) satisfies z.ZodType<NostrAccountConfig>;

type NostrConfig = z.infer<typeof NostrAccountConfigSchema>;

let currentConfig: NostrConfig | null = null;

// --- Meta + Capabilities ---

const meta: ChatProviderMeta = {
  id: 'nostr', name: 'Nostr', order: 17, color: '#8B5CF6',
  description: 'Decentralized protocol using cryptographic keys and relays',
  icon: 'Nostr icon',
  docsUrl: 'https://github.com/nostr-protocol/nostr',
};

const capabilities: ChatProviderCapabilities = {
  chatTypes: ['direct', 'group'],
  send: true, receive: true, webhooks: true,
  slashCommands: false, interactiveComponents: false,
  reactions: false, edit: false, delete: false,
  threads: false, media: false, richBlocks: false,
  oauth: false, realtime: false,
};

// --- Crypto stubs (TODO: implement with @noble/secp256k1 + @noble/hashes) ---

/** TODO: secp256k1.getPublicKey(privkey, true).slice(2) */
function derivePubkey(_privateKey: string): string {
  logger.warn('[Nostr] derivePubkey: crypto stub - install @noble/secp256k1');
  return 'stub-pubkey';
}

// TODO: id = sha256(JSON.stringify([0, pubkey, created_at, kind, tags, content])), sig = schnorr sign
function signEvent(partial: Omit<NostrEvent, 'id' | 'sig'>, _privateKey: string): NostrEvent {
  logger.warn('[Nostr] signEvent: crypto stub - install @noble/secp256k1');
  return { ...partial, id: 'stub-id', sig: 'stub-sig' };
}

// TODO: NIP-04 ECDH(senderPrivkey, recipientPubkey) -> AES-256-CBC -> base64(ct)+'?iv='+base64(iv)
function encryptNip04(content: string, _senderPrivkey: string, _recipientPubkey: string): string {
  logger.warn('[Nostr] encryptNip04: NIP-04 crypto stub - implement before using DMs');
  return content;
}

// --- Auth ---

const authAdapter: AuthAdapter = {
  getAuthUrl(_state: string, _scopes?: string[]): string {
    throw new Error('Nostr does not use OAuth. Supply a private key in config.');
  },
  async exchangeCode(_code: string): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
    throw new Error('Nostr does not use OAuth authorization codes.');
  },
  verifyWebhook(_sig: string, _ts: string, _body: string): boolean {
    // Relay trust model - each event carries its own cryptographic signature.
    return true;
  },
};

// --- Outbound ---

const outboundAdapter: OutboundAdapter = {
  async send(message: OutgoingMessage): Promise<SendResult> {
    if (!currentConfig?.privateKey) return { success: false, error: 'Nostr private key not configured' };
    if (!message.to) return { success: false, error: 'Recipient pubkey (to) is required' };
    const relayUrl = currentConfig.relayUrls?.[0];
    if (!relayUrl) return { success: false, error: 'No relay URLs configured' };

    const isDm = message.chatType === 'direct';
    const event = signEvent(
      {
        pubkey: derivePubkey(currentConfig.privateKey),
        created_at: Math.floor(Date.now() / 1000),
        kind: isDm ? NostrKind.ENCRYPTED_DM : NostrKind.PUBLIC_NOTE,
        tags: isDm ? [['p', message.to]] : [],
        content: isDm
          ? encryptNip04(message.text ?? '', currentConfig.privateKey, message.to)
          : (message.text ?? ''),
      },
      currentConfig.privateKey
    );

    try {
      const res = await fetch(relayUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(['EVENT', event]),
      });
      return res.ok
        ? { success: true, messageId: event.id }
        : { success: false, error: `HTTP ${res.status}` };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  },
};

// --- Inbound ---

const inboundAdapter: InboundAdapter = {
  parseMessage(payload: unknown): IncomingMessage | null {
    if (!Array.isArray(payload) || payload[0] !== 'EVENT' || payload.length < 3) return null;
    const event = (payload as NostrWireMessage)[2] as NostrEvent;
    if (!event || typeof event !== 'object') return null;

    const { id, pubkey, kind, content, tags, created_at } = event;
    if (kind !== NostrKind.PUBLIC_NOTE && kind !== NostrKind.ENCRYPTED_DM) {
      logger.debug(`[Nostr] parseMessage: unsupported kind ${kind}, skipping`);
      return null;
    }

    const allowed = currentConfig?.allowedPubkeys;
    if (allowed && allowed.length > 0 && !allowed.includes(pubkey)) {
      logger.debug(`[Nostr] parseMessage: pubkey ${pubkey} not in allowedPubkeys`);
      return null;
    }

    const recipientPubkey = tags.find((t) => t[0] === 'p')?.[1];
    const isDm = kind === NostrKind.ENCRYPTED_DM;

    // TODO: decrypt content for kind 4 (NIP-04) once crypto stubs are implemented
    return {
      id,
      provider: 'nostr',
      accountId: currentConfig?.id ?? 'default',
      senderId: pubkey,
      senderName: pubkey,
      senderUsername: pubkey,
      chatType: isDm ? 'direct' : 'group',
      chatId: isDm ? (recipientPubkey ?? pubkey) : 'global',
      chatName: undefined,
      threadId: undefined,
      replyToId: undefined,
      text: content,
      rawContent: event,
      timestamp: new Date(created_at * 1000),
      attachments: undefined,
    };
  },
  parseCommand(_payload: unknown): SlashCommand | null { return null; },
  parseAction(_payload: unknown): InteractiveAction | null { return null; },
  buildCommandResponse(r: CommandResponse): unknown { return { type: 'text', content: r.text ?? '' }; },
  buildActionResponse(r: CommandResponse): unknown { return { type: 'text', content: r.text ?? '' }; },
};

// --- Status ---

const statusAdapter: StatusAdapter = {
  isConfigured(config: NostrAccountConfig): boolean {
    return !!(config.privateKey && config.relayUrls && config.relayUrls.length > 0);
  },
  async checkHealth(config: NostrAccountConfig): Promise<{ connected: boolean; latencyMs?: number; error?: string; details?: Record<string, unknown> }> {
    const relayUrl = config.relayUrls?.[0];
    if (!relayUrl) return { connected: false, error: 'No relay URLs configured' };

    const start = Date.now();
    try {
      const res = await fetch(relayUrl, {
        method: 'HEAD',
        headers: { 'Accept': 'application/nostr+json' },
        signal: AbortSignal.timeout(5000),
      });
      return {
        connected: true,
        latencyMs: Date.now() - start,
        details: {
          relayUrl,
          relayCount: config.relayUrls?.length ?? 1,
          httpStatus: res.status,
          privateKeyConfigured: !!config.privateKey,
          allowedPubkeys: config.allowedPubkeys?.length ?? 0,
        },
      };
    } catch (error) {
      return {
        connected: false,
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : 'Failed to reach relay',
      };
    }
  },
};

// --- Config helpers ---

export function setNostrConfig(config: NostrConfig): void { currentConfig = config; }
export function clearNostrConfig(): void { currentConfig = null; }

// --- Provider export ---

export const nostrProvider: ChatProvider<NostrAccountConfig> = {
  meta,
  capabilities,
  defaultConfig: { provider: 'nostr', enabled: true },
  configSchema: NostrAccountConfigSchema as z.ZodType<NostrAccountConfig>,
  auth: authAdapter,
  outbound: outboundAdapter,
  inbound: inboundAdapter,
  status: statusAdapter,
};

export type { NostrConfig, NostrEvent, NostrWireMessage };
export { NostrKind };
