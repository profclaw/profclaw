/**
 * Chat Provider Registry
 *
 * Central registry for all chat providers.
 * Handles provider registration, lookup, and capability queries.
 */

import { logger } from '../../utils/logger.js';
import type {
  ChatProvider,
  ChatProviderId,
  ChatProviderCapabilities,
  ProviderRegistry,
  ChatAccountConfig,
  ChatEvent,
  ChatEventHandler,
  ChatContext,
} from './types.js';

// REGISTRY IMPLEMENTATION

class ChatProviderRegistry implements ProviderRegistry {
  private providers = new Map<ChatProviderId, ChatProvider>();
  private accounts = new Map<string, ChatAccountConfig>();
  private eventHandlers = new Map<string, Set<ChatEventHandler>>();

  /**
   * Register a chat provider
   */
  register(provider: ChatProvider): void {
    if (this.providers.has(provider.meta.id)) {
      logger.warn(`[ChatRegistry] Provider ${provider.meta.id} already registered, overwriting`);
    }

    this.providers.set(provider.meta.id, provider);
    logger.info(`[ChatRegistry] Registered provider: ${provider.meta.name}`, {
      id: provider.meta.id,
      capabilities: Object.entries(provider.capabilities)
        .filter(([, v]) => v === true || (Array.isArray(v) && v.length > 0))
        .map(([k]) => k),
    });
  }

  /**
   * Unregister a provider
   */
  unregister(id: ChatProviderId): boolean {
    const removed = this.providers.delete(id);
    if (removed) {
      logger.info(`[ChatRegistry] Unregistered provider: ${id}`);
    }
    return removed;
  }

  /**
   * Get provider by ID
   */
  get(id: ChatProviderId): ChatProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * List all registered providers
   */
  list(): ChatProvider[] {
    return Array.from(this.providers.values()).sort((a, b) => a.meta.order - b.meta.order);
  }

  /**
   * Get providers with specific capability
   */
  withCapability(capability: keyof ChatProviderCapabilities): ChatProvider[] {
    return this.list().filter((p) => {
      const value = p.capabilities[capability];
      return value === true || (Array.isArray(value) && value.length > 0);
    });
  }

  /**
   * Check if a provider is registered
   */
  has(id: ChatProviderId): boolean {
    return this.providers.has(id);
  }

  // ACCOUNT MANAGEMENT

  /**
   * Register an account configuration
   */
  registerAccount(config: ChatAccountConfig): void {
    const key = `${config.provider}:${config.id}`;
    this.accounts.set(key, config);
    logger.debug(`[ChatRegistry] Registered account: ${key}`, { name: config.name });
  }

  /**
   * Get account configuration
   */
  getAccount(providerId: ChatProviderId, accountId: string): ChatAccountConfig | undefined {
    return this.accounts.get(`${providerId}:${accountId}`);
  }

  /**
   * Get default account for a provider
   */
  getDefaultAccount(providerId: ChatProviderId): ChatAccountConfig | undefined {
    for (const [key, config] of this.accounts) {
      if (key.startsWith(`${providerId}:`) && config.isDefault) {
        return config;
      }
    }
    // Return first account if no default set
    for (const [key, config] of this.accounts) {
      if (key.startsWith(`${providerId}:`)) {
        return config;
      }
    }
    return undefined;
  }

  /**
   * List accounts for a provider
   */
  listAccounts(providerId?: ChatProviderId): ChatAccountConfig[] {
    const result: ChatAccountConfig[] = [];
    for (const [key, config] of this.accounts) {
      if (!providerId || key.startsWith(`${providerId}:`)) {
        result.push(config);
      }
    }
    return result;
  }

  /**
   * Remove an account
   */
  removeAccount(providerId: ChatProviderId, accountId: string): boolean {
    return this.accounts.delete(`${providerId}:${accountId}`);
  }

  // EVENT HANDLING

  /**
   * Subscribe to events
   */
  on(eventType: string, handler: ChatEventHandler): () => void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    this.eventHandlers.get(eventType)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.eventHandlers.get(eventType)?.delete(handler);
    };
  }

  /**
   * Emit an event
   */
  async emit(event: ChatEvent): Promise<void> {
    const handlers = this.eventHandlers.get(event.type);
    if (!handlers || handlers.size === 0) {
      return;
    }

    const account = this.getAccount(event.provider, event.accountId);
    const context: ChatContext = {
      provider: event.provider,
      accountId: event.accountId,
      config: account!,
    };

    const promises: Promise<void>[] = [];
    for (const handler of handlers) {
      promises.push(
        handler(event, context).catch((error) => {
          logger.error(`[ChatRegistry] Event handler error`, {
            eventType: event.type,
            provider: event.provider,
            error: error instanceof Error ? error.message : String(error),
          });
        })
      );
    }

    await Promise.all(promises);
  }

  // UTILITY METHODS

  /**
   * Get status summary of all providers and accounts
   */
  async getStatus(): Promise<{
    providers: Array<{
      id: ChatProviderId;
      name: string;
      registered: boolean;
      accounts: Array<{
        id: string;
        name?: string;
        enabled: boolean;
        configured: boolean;
        connected: boolean;
        error?: string;
      }>;
    }>;
  }> {
    const result: {
      providers: Array<{
        id: ChatProviderId;
        name: string;
        registered: boolean;
        accounts: Array<{
          id: string;
          name?: string;
          enabled: boolean;
          configured: boolean;
          connected: boolean;
          error?: string;
        }>;
      }>;
    } = { providers: [] };

    for (const provider of this.list()) {
      const providerStatus: (typeof result.providers)[0] = {
        id: provider.meta.id,
        name: provider.meta.name,
        registered: true,
        accounts: [],
      };

      const accounts = this.listAccounts(provider.meta.id);
      for (const account of accounts) {
        const configured = provider.status.isConfigured(account);
        let connected = false;
        let error: string | undefined;

        if (configured && account.enabled) {
          try {
            const health = await provider.status.checkHealth(account);
            connected = health.connected;
            error = health.error;
          } catch (e) {
            error = e instanceof Error ? e.message : String(e);
          }
        }

        providerStatus.accounts.push({
          id: account.id,
          name: account.name,
          enabled: account.enabled ?? true,
          configured,
          connected,
          error,
        });
      }

      result.providers.push(providerStatus);
    }

    return result;
  }
}

// SINGLETON INSTANCE

let _registry: ChatProviderRegistry | null = null;

export function getChatRegistry(): ChatProviderRegistry {
  if (!_registry) {
    _registry = new ChatProviderRegistry();
  }
  return _registry;
}

/**
 * Reset registry (for testing)
 */
export function resetChatRegistry(): void {
  _registry = null;
}

// EXPORTS

export { ChatProviderRegistry };
