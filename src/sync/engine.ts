/**
 * profClaw Sync Engine
 *
 * Orchestrates bi-directional sync between profClaw tickets and external platforms.
 * Handles:
 * - Push: profClaw → External (Linear, GitHub, Jira)
 * - Pull: External → profClaw
 * - Bidirectional: Both directions with conflict resolution
 */

import { randomUUID } from 'crypto';
import type {
  SyncAdapter,
  SyncAdapterConfig,
  SyncEngineConfig,
  SyncResult,
  SyncState,
  SyncConflict,
  ExternalTicket,
} from './types.js';
import type { Ticket, TicketComment, ExternalLink } from '../tickets/types.js';
import { LinearSyncAdapter } from './adapters/linear.js';
import { GitHubSyncAdapter } from './adapters/github.js';
import { loadSyncConfig, toSyncEngineConfig, isSyncEnabled } from './config.js';
import { logger } from '../utils/logger.js';

// Adapter factory - extensible for new platforms
const ADAPTER_FACTORIES: Record<string, (config: SyncAdapterConfig) => SyncAdapter> = {
  linear: (config) => new LinearSyncAdapter(config),
  github: (config) => new GitHubSyncAdapter(config),
  // Add more platforms here as they're implemented:
  // jira: (config) => new JiraSyncAdapter(config),
  // plane: (config) => new PlaneSyncAdapter(config),
};

export class SyncEngine {
  private config: SyncEngineConfig;
  private adapters: Map<string, SyncAdapter> = new Map();
  private states: Map<string, SyncState> = new Map();
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private pendingConflicts: SyncConflict[] = [];

  // Callbacks for ticket operations (set by consumer)
  private onTicketCreated?: (ticket: Ticket, link: ExternalLink) => Promise<void>;
  private onTicketUpdated?: (ticketId: string, updates: Partial<Ticket>, source: string) => Promise<void>;
  private onCommentAdded?: (ticketId: string, comment: Partial<TicketComment>) => Promise<void>;
  private getTicket?: (id: string) => Promise<Ticket | null>;
  private getTicketByExternalLink?: (platform: string, externalId: string) => Promise<Ticket | null>;
  private getExternalLinks?: (ticketId: string) => Promise<ExternalLink[]>;
  private updateExternalLink?: (id: string, updates: Partial<ExternalLink>) => Promise<void>;

  private toTicketCommentSource(platform: string): TicketComment['source'] {
    switch (platform) {
      case 'github':
      case 'linear':
      case 'jira':
      case 'plane':
      case 'profclaw':
        return platform;
      default:
        return 'profclaw';
    }
  }

  /**
   * Create a new SyncEngine instance
   * @param config Optional config override. If not provided, loads from config/settings.yml
   */
  constructor(config?: Partial<SyncEngineConfig>) {
    // Load from YAML config if no override provided
    const yamlConfig = loadSyncConfig();
    const engineConfig = toSyncEngineConfig(yamlConfig);

    // Merge with any overrides
    this.config = {
      ...engineConfig,
      ...config,
      platforms: {
        ...engineConfig.platforms,
        ...config?.platforms,
      },
    };
  }

  // === Lifecycle ===

  async initialize(): Promise<void> {
    logger.info('[SyncEngine] Initializing');

    // Create and connect adapters for configured platforms
    for (const [platform, platformConfig] of Object.entries(this.config.platforms)) {
      await this.addAdapter(platform, platformConfig);
    }

    logger.info('[SyncEngine] Initialized', { adapterCount: this.adapters.size });
  }

  async addAdapter(platform: string, config: SyncAdapterConfig): Promise<void> {
    const factory = ADAPTER_FACTORIES[platform];
    if (!factory) {
      logger.warn('[SyncEngine] Unknown platform', { platform });
      return;
    }

    try {
      const adapter = factory(config);
      await adapter.connect();

      this.adapters.set(platform, adapter);
      this.states.set(platform, {
        platform,
        syncInProgress: false,
        errorCount: 0,
      });

      logger.info('[SyncEngine] Added adapter', { platform });
    } catch (error) {
      logger.error('[SyncEngine] Failed to add adapter', error as Error, { platform });
    }
  }

  async removeAdapter(platform: string): Promise<void> {
    const adapter = this.adapters.get(platform);
    if (adapter) {
      await adapter.disconnect();
      this.adapters.delete(platform);
      this.states.delete(platform);
      logger.info('[SyncEngine] Removed adapter', { platform });
    }
  }

  async shutdown(): Promise<void> {
    logger.info('[SyncEngine] Shutting down');
    this.stopAutoSync();

    for (const adapter of this.adapters.values()) {
      await adapter.disconnect();
    }

    this.adapters.clear();
    this.states.clear();
  }

  // === Auto Sync ===

  startAutoSync(): void {
    if (this.syncInterval) return;

    logger.info('[SyncEngine] Starting auto-sync', { intervalMs: this.config.syncIntervalMs });
    this.syncInterval = setInterval(() => {
      this.syncAll().catch(err => logger.error('[SyncEngine] Auto-sync error', err as Error));
    }, this.config.syncIntervalMs);
  }

  stopAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      logger.info('[SyncEngine] Stopped auto-sync');
    }
  }

  // === Manual Sync Operations ===

  /**
   * Sync all platforms
   */
  async syncAll(): Promise<SyncResult[]> {
    const results: SyncResult[] = [];

    for (const platform of this.adapters.keys()) {
      const platformResults = await this.syncPlatform(platform);
      results.push(...platformResults);
    }

    return results;
  }

  /**
   * Sync a specific platform
   */
  async syncPlatform(platform: string): Promise<SyncResult[]> {
    const adapter = this.adapters.get(platform);
    const state = this.states.get(platform);

    if (!adapter || !state) {
      return [{
        success: false,
        platform,
        ticketId: '',
        operation: 'update',
        timestamp: new Date(),
        error: `Platform not configured: ${platform}`,
      }];
    }

    if (state.syncInProgress) {
      logger.debug('[SyncEngine] Sync already in progress', { platform });
      return [];
    }

    state.syncInProgress = true;
    const results: SyncResult[] = [];

    try {
      // Pull changes from external platform
      const pullResults = await this.pullFromPlatform(platform);
      results.push(...pullResults);

      // Update sync state
      state.lastSyncAt = new Date();
      state.errorCount = 0;
      state.lastError = undefined;
    } catch (error) {
      state.errorCount++;
      state.lastError = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[SyncEngine] Sync failed', error as Error, { platform });

      results.push({
        success: false,
        platform,
        ticketId: '',
        operation: 'update',
        timestamp: new Date(),
        error: state.lastError,
      });
    } finally {
      state.syncInProgress = false;
    }

    return results;
  }

  // === Push Operations (profClaw → External) ===

  /**
   * Push a ticket to an external platform
   */
  async pushTicket(ticket: Ticket, platform: string): Promise<SyncResult> {
    const adapter = this.adapters.get(platform);
    if (!adapter) {
      return {
        success: false,
        platform,
        ticketId: ticket.id,
        operation: 'create',
        timestamp: new Date(),
        error: `Platform not configured: ${platform}`,
      };
    }

    try {
      const external = await adapter.createTicket(ticket);

      logger.info('[SyncEngine] Pushed ticket', { ticketId: ticket.id, platform, externalId: external.externalId });

      return {
        success: true,
        platform,
        ticketId: ticket.id,
        externalId: external.externalId,
        operation: 'create',
        timestamp: new Date(),
        details: { externalUrl: external.externalUrl },
      };
    } catch (error) {
      logger.error('[SyncEngine] Failed to push ticket', error as Error, { platform, ticketId: ticket.id });
      return {
        success: false,
        platform,
        ticketId: ticket.id,
        operation: 'create',
        timestamp: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Push ticket updates to all linked platforms
   */
  async pushTicketUpdates(ticket: Ticket, updates: Partial<Ticket>, links: ExternalLink[]): Promise<SyncResult[]> {
    const results: SyncResult[] = [];

    for (const link of links) {
      if (!link.syncEnabled || link.syncDirection === 'pull') continue;

      const adapter = this.adapters.get(link.platform);
      if (!adapter) continue;

      try {
        await adapter.updateTicket(link.externalId, updates);

        // Update sync timestamp
        if (this.updateExternalLink) {
          await this.updateExternalLink(link.id, { lastSyncedAt: new Date().toISOString() });
        }

        results.push({
          success: true,
          platform: link.platform,
          ticketId: ticket.id,
          externalId: link.externalId,
          operation: 'update',
          timestamp: new Date(),
        });
      } catch (error) {
        logger.error('[SyncEngine] Failed to push update', error as Error, { platform: link.platform });

        // Record sync error
        if (this.updateExternalLink) {
          await this.updateExternalLink(link.id, {
            syncError: error instanceof Error ? error.message : 'Unknown error',
          });
        }

        results.push({
          success: false,
          platform: link.platform,
          ticketId: ticket.id,
          externalId: link.externalId,
          operation: 'update',
          timestamp: new Date(),
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  }

  /**
   * Push a comment to all linked platforms
   */
  async pushComment(ticketId: string, content: string, links: ExternalLink[]): Promise<SyncResult[]> {
    const results: SyncResult[] = [];

    for (const link of links) {
      if (!link.syncEnabled || link.syncDirection === 'pull') continue;

      const adapter = this.adapters.get(link.platform);
      if (!adapter) continue;

      try {
        await adapter.addComment(link.externalId, content);

        results.push({
          success: true,
          platform: link.platform,
          ticketId,
          externalId: link.externalId,
          operation: 'comment_add',
          timestamp: new Date(),
        });
      } catch (error) {
        logger.error('[SyncEngine] Failed to push comment', error as Error, { platform: link.platform });
        results.push({
          success: false,
          platform: link.platform,
          ticketId,
          externalId: link.externalId,
          operation: 'comment_add',
          timestamp: new Date(),
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  }

  // === Pull Operations (External → profClaw) ===

  /**
   * Pull changes from an external platform
   */
  async pullFromPlatform(platform: string): Promise<SyncResult[]> {
    const adapter = this.adapters.get(platform);
    const state = this.states.get(platform);

    if (!adapter || !state) {
      return [];
    }

    const results: SyncResult[] = [];

    try {
      // List tickets updated since last sync
      const { tickets } = await adapter.listTickets({
        updatedAfter: state.lastSyncAt,
        limit: 100,
      });

      for (const external of tickets) {
        const result = await this.processExternalTicket(platform, external);
        results.push(result);
      }
    } catch (error) {
      logger.error('[SyncEngine] Pull failed', error as Error, { platform });
    }

    return results;
  }

  /**
   * Process an external ticket (create or update in profClaw)
   */
  private async processExternalTicket(platform: string, external: ExternalTicket): Promise<SyncResult> {
    const adapter = this.adapters.get(platform)!;

    // Check if we already have this ticket linked
    let existingTicket: Ticket | null = null;
    if (this.getTicketByExternalLink) {
      existingTicket = await this.getTicketByExternalLink(platform, external.externalId);
    }

    if (existingTicket) {
      // Update existing ticket
      const updates = this.externalToTicketUpdates(adapter, external);

      // Check for conflicts
      const conflict = await this.detectConflict(existingTicket, updates, external);
      if (conflict) {
        const resolved = this.resolveConflict(conflict);
        if (!resolved) {
          this.pendingConflicts.push(conflict);
          return {
            success: false,
            platform,
            ticketId: existingTicket.id,
            externalId: external.externalId,
            operation: 'update',
            timestamp: new Date(),
            error: 'Conflict requires manual resolution',
          };
        }
      }

      if (this.onTicketUpdated) {
        await this.onTicketUpdated(existingTicket.id, updates, platform);
      }

      return {
        success: true,
        platform,
        ticketId: existingTicket.id,
        externalId: external.externalId,
        operation: 'update',
        timestamp: new Date(),
      };
    } else {
      // Create new ticket from external
      const newTicket = this.externalToNewTicket(adapter, external);

      if (this.onTicketCreated) {
        const link: ExternalLink = {
          id: randomUUID(),
          ticketId: newTicket.id,
          platform: platform as ExternalLink['platform'],
          externalId: external.externalId,
          externalUrl: external.externalUrl,
          syncEnabled: true,
          syncDirection: 'bidirectional',
          createdAt: new Date().toISOString(),
        };

        await this.onTicketCreated(newTicket, link);
      }

      return {
        success: true,
        platform,
        ticketId: newTicket.id,
        externalId: external.externalId,
        operation: 'create',
        timestamp: new Date(),
      };
    }
  }

  // === Webhook Handling ===

  /**
   * Handle incoming webhook from external platform
   */
  async handleWebhook(platform: string, payload: unknown): Promise<SyncResult | null> {
    const adapter = this.adapters.get(platform);
    if (!adapter || !adapter.parseWebhook) {
      logger.warn('[SyncEngine] No webhook handler for platform', { platform });
      return null;
    }

    const event = adapter.parseWebhook(payload);
    if (!event) {
      logger.warn('[SyncEngine] Could not parse webhook', { platform });
      return null;
    }

    logger.info('[SyncEngine] Processing webhook', { eventType: event.type, platform });

    switch (event.type) {
      case 'ticket.created':
      case 'ticket.updated': {
        const external = await adapter.getTicket(event.externalId);
        if (external) {
          return this.processExternalTicket(platform, external);
        }
        break;
      }

      case 'ticket.deleted': {
        // Optionally handle deletion (mark as cancelled in profClaw?)
        logger.info('[SyncEngine] Ticket deleted externally', { platform, externalId: event.externalId });
        break;
      }

      case 'comment.created': {
        if (event.ticketExternalId && this.getTicketByExternalLink && this.onCommentAdded) {
          const ticket = await this.getTicketByExternalLink(platform, event.ticketExternalId);
          if (ticket) {
            const comments = await adapter.getComments(event.ticketExternalId);
            const newComment = comments.find(c => c.externalId === event.externalId);
            if (newComment) {
              await this.onCommentAdded(ticket.id, {
                content: newComment.content,
                source: this.toTicketCommentSource(platform),
                externalId: newComment.externalId,
                author: {
                  type: 'human',
                  name: newComment.authorName,
                  platform,
                },
                createdAt: newComment.createdAt.toISOString(),
              });
            }
          }
        }
        break;
      }
    }

    return null;
  }

  // === Conflict Resolution ===

  private async detectConflict(
    local: Ticket,
    remoteUpdates: Partial<Ticket>,
    external: ExternalTicket
  ): Promise<SyncConflict | null> {
    // Check if the same field was modified locally and remotely
    const localUpdated = new Date(local.updatedAt);
    const remoteUpdated = external.updatedAt;

    // If remote is older than local, there might be a conflict
    if (remoteUpdated <= localUpdated) {
      // Check for conflicting fields
      for (const [field, remoteValue] of Object.entries(remoteUpdates)) {
        const localValue = local[field as keyof Ticket];
        if (localValue !== undefined && localValue !== remoteValue) {
          return {
            ticketId: local.id,
            platform: external.platform,
            field,
            localValue,
            remoteValue,
            localTimestamp: localUpdated,
            remoteTimestamp: remoteUpdated,
          };
        }
      }
    }

    return null;
  }

  private resolveConflict(conflict: SyncConflict): boolean {
    switch (this.config.conflictStrategy) {
      case 'local_wins':
        conflict.resolution = 'local';
        return true;

      case 'remote_wins':
        conflict.resolution = 'remote';
        return true;

      case 'latest_wins':
        if (conflict.remoteTimestamp > conflict.localTimestamp) {
          conflict.resolution = 'remote';
        } else {
          conflict.resolution = 'local';
        }
        return true;

      case 'manual':
        // Don't auto-resolve, add to pending
        return false;
    }
  }

  // === Conversion Helpers ===

  private externalToTicketUpdates(adapter: SyncAdapter, external: ExternalTicket): Partial<Ticket> {
    return {
      title: external.title,
      description: external.description,
      status: adapter.mapStatusFromExternal(external.status),
      priority: external.priority ? adapter.mapPriorityFromExternal(external.priority) : undefined,
      type: external.type ? adapter.mapTypeFromExternal(external.type) : undefined,
      labels: external.labels,
      assignee: external.assignee,
      updatedAt: external.updatedAt.toISOString(),
    };
  }

  private externalToNewTicket(adapter: SyncAdapter, external: ExternalTicket): Ticket {
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      sequence: 0, // Will be assigned by ticket service
      title: external.title,
      description: external.description,
      status: adapter.mapStatusFromExternal(external.status),
      priority: external.priority ? adapter.mapPriorityFromExternal(external.priority) : 'medium',
      type: external.type ? adapter.mapTypeFromExternal(external.type) : 'task',
      labels: external.labels,
      assignee: external.assignee,
      linkedPRs: [],
      linkedCommits: [],
      createdAt: external.createdAt.toISOString(),
      updatedAt: now,
      createdBy: 'human', // Imported from external = human created
    };
  }

  // === Callbacks Registration ===

  setCallbacks(callbacks: {
    onTicketCreated?: (ticket: Ticket, link: ExternalLink) => Promise<void>;
    onTicketUpdated?: (ticketId: string, updates: Partial<Ticket>, source: string) => Promise<void>;
    onCommentAdded?: (ticketId: string, comment: Partial<TicketComment>) => Promise<void>;
    getTicket?: (id: string) => Promise<Ticket | null>;
    getTicketByExternalLink?: (platform: string, externalId: string) => Promise<Ticket | null>;
    getExternalLinks?: (ticketId: string) => Promise<ExternalLink[]>;
    updateExternalLink?: (id: string, updates: Partial<ExternalLink>) => Promise<void>;
  }): void {
    this.onTicketCreated = callbacks.onTicketCreated;
    this.onTicketUpdated = callbacks.onTicketUpdated;
    this.onCommentAdded = callbacks.onCommentAdded;
    this.getTicket = callbacks.getTicket;
    this.getTicketByExternalLink = callbacks.getTicketByExternalLink;
    this.getExternalLinks = callbacks.getExternalLinks;
    this.updateExternalLink = callbacks.updateExternalLink;
  }

  // === Status & Health ===

  getStatus(): {
    adapters: Record<string, { connected: boolean; lastSync?: Date; errorCount: number }>;
    pendingConflicts: number;
    autoSyncEnabled: boolean;
  } {
    const adapters: Record<string, { connected: boolean; lastSync?: Date; errorCount: number }> = {};

    for (const [platform, adapter] of this.adapters) {
      const state = this.states.get(platform);
      adapters[platform] = {
        connected: adapter.isConnected(),
        lastSync: state?.lastSyncAt,
        errorCount: state?.errorCount || 0,
      };
    }

    return {
      adapters,
      pendingConflicts: this.pendingConflicts.length,
      autoSyncEnabled: this.syncInterval !== null,
    };
  }

  async healthCheck(): Promise<Record<string, { healthy: boolean; latencyMs: number }>> {
    const results: Record<string, { healthy: boolean; latencyMs: number }> = {};

    for (const [platform, adapter] of this.adapters) {
      results[platform] = await adapter.healthCheck();
    }

    return results;
  }

  getPendingConflicts(): SyncConflict[] {
    return [...this.pendingConflicts];
  }

  resolvePendingConflict(ticketId: string, resolution: 'local' | 'remote'): void {
    const index = this.pendingConflicts.findIndex(c => c.ticketId === ticketId);
    if (index >= 0) {
      this.pendingConflicts[index].resolution = resolution;
      this.pendingConflicts.splice(index, 1);
    }
  }
}

// === Singleton Instance ===

let syncEngine: SyncEngine | null = null;

/**
 * Get the sync engine singleton (creates if not exists)
 */
export function getSyncEngine(): SyncEngine {
  if (!syncEngine) {
    syncEngine = new SyncEngine();
  }
  return syncEngine;
}

/**
 * Initialize the sync engine from config/settings.yml
 * Only initializes if sync.enabled = true in config
 * @returns SyncEngine if initialized, null if sync is disabled
 */
export async function initSyncEngine(config?: Partial<SyncEngineConfig>): Promise<SyncEngine | null> {
  // Check if sync is enabled in config
  if (!isSyncEnabled()) {
    logger.info('[SyncEngine] Sync is disabled in configuration');
    return null;
  }

  syncEngine = new SyncEngine(config);
  await syncEngine.initialize();
  return syncEngine;
}

/**
 * Check if sync engine is available
 */
export function hasSyncEngine(): boolean {
  return syncEngine !== null && isSyncEnabled();
}
