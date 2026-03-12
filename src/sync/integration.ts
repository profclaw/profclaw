/**
 * Sync Integration
 *
 * Wires the sync engine to the ticket service.
 * Initializes callbacks and enables bi-directional sync.
 */

import { SyncEngine, initSyncEngine, getSyncEngine, hasSyncEngine } from './engine.js';
import { isSyncEnabled, loadSyncConfig } from './config.js';
import {
  createTicketFromSync,
  updateTicketFromSync,
  addCommentFromSync,
  getTicket,
  getTicketByExternalLink,
  getExternalLinks,
  updateExternalLink,
  registerSyncCallbacks,
} from '../tickets/index.js';
import type { Ticket, ExternalLink, TicketComment } from '../tickets/types.js';
import { logger } from '../utils/logger.js';

let initialized = false;

/**
 * Initialize sync integration
 * Wires sync engine callbacks to ticket service
 */
export async function initSyncIntegration(): Promise<SyncEngine | null> {
  if (initialized) {
    return hasSyncEngine() ? getSyncEngine() : null;
  }

  // Check if sync is enabled
  if (!isSyncEnabled()) {
    logger.info('[SyncIntegration] Sync is disabled in configuration');
    initialized = true;
    return null;
  }

  logger.info('[SyncIntegration] Initializing');

  // Initialize the sync engine
  const engine = await initSyncEngine();
  if (!engine) {
    logger.warn('[SyncIntegration] Failed to initialize sync engine');
    initialized = true;
    return null;
  }

  // Wire callbacks
  engine.setCallbacks({
    // Called when sync creates a new ticket from external
    onTicketCreated: async (ticket: Ticket, link: ExternalLink) => {
      logger.info('[SyncIntegration] Creating ticket from external', { platform: link.platform, title: ticket.title });
      await createTicketFromSync(ticket, {
        platform: link.platform,
        externalId: link.externalId,
        externalUrl: link.externalUrl,
      });
    },

    // Called when sync updates an existing ticket
    onTicketUpdated: async (ticketId: string, updates: Partial<Ticket>, source: string) => {
      logger.info('[SyncIntegration] Updating ticket from external', { ticketId, source });
      await updateTicketFromSync(ticketId, updates, source);
    },

    // Called when sync adds a comment from external
    onCommentAdded: async (ticketId: string, comment: Partial<TicketComment>) => {
      logger.info('[SyncIntegration] Adding comment to ticket', { ticketId });
      await addCommentFromSync(
        ticketId,
        comment.content || '',
        comment.author || { type: 'human', name: 'Unknown', platform: 'profclaw' },
        comment.externalId
      );
    },

    // Get ticket by ID
    getTicket: async (id: string) => {
      return getTicket(id);
    },

    // Get ticket by external link
    getTicketByExternalLink: async (platform: string, externalId: string) => {
      return getTicketByExternalLink(platform, externalId);
    },

    // Get external links for a ticket
    getExternalLinks: async (ticketId: string) => {
      return getExternalLinks(ticketId);
    },

    // Update external link
    updateExternalLink: async (id: string, updates: Partial<ExternalLink>) => {
      await updateExternalLink(id, updates as any);
    },
  });

  // Register outbound sync callbacks with ticket service
  registerSyncCallbacks({
    onTicketChanged,
    onCommentCreated,
  });
  logger.info('[SyncIntegration] Registered outbound sync callbacks');

  // Start auto-sync if configured
  const config = loadSyncConfig();
  if (config.enabled && config.intervalMs > 0) {
    logger.info('[SyncIntegration] Starting auto-sync', { intervalMs: config.intervalMs });
    engine.startAutoSync();
  }

  initialized = true;
  logger.info('[SyncIntegration] Initialized successfully');

  return engine;
}

/**
 * Handle incoming webhook from external platform
 */
export async function handleSyncWebhook(platform: string, payload: unknown): Promise<{ success: boolean; message: string }> {
  if (!hasSyncEngine()) {
    return { success: false, message: 'Sync engine not initialized' };
  }

  try {
    const engine = getSyncEngine();
    await engine.handleWebhook(platform, payload);
    return { success: true, message: `Processed ${platform} webhook` };
  } catch (error) {
    logger.error('[SyncIntegration] Webhook error', error as Error, { platform });
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Push a ticket to external platforms
 */
export async function pushTicketToExternal(ticketId: string, platform?: string): Promise<{ success: boolean; externalId?: string; error?: string }> {
  if (!hasSyncEngine()) {
    return { success: false, error: 'Sync engine not initialized' };
  }

  const ticket = await getTicket(ticketId);
  if (!ticket) {
    return { success: false, error: 'Ticket not found' };
  }

  const engine = getSyncEngine();

  if (platform) {
    // Push to specific platform
    const result = await engine.pushTicket(ticket, platform);
    return {
      success: result.success,
      externalId: result.externalId,
      error: result.error,
    };
  } else {
    // Push to all configured platforms
    const links = await getExternalLinks(ticketId);
    const results = await engine.pushTicketUpdates(ticket, {}, links);
    const failed = results.filter(r => !r.success);

    if (failed.length > 0) {
      return {
        success: false,
        error: `Failed for platforms: ${failed.map(f => f.platform).join(', ')}`,
      };
    }

    return { success: true };
  }
}

/**
 * Trigger outbound sync when a ticket is updated in profClaw
 * Called by the ticket service after updates
 */
export async function onTicketChanged(ticketId: string, updates: Partial<Ticket>): Promise<void> {
  if (!hasSyncEngine()) return;

  const ticket = await getTicket(ticketId);
  if (!ticket) return;

  const links = await getExternalLinks(ticketId);
  if (links.length === 0) return;

  const engine = getSyncEngine();
  const results = await engine.pushTicketUpdates(ticket, updates, links);

  for (const result of results) {
    if (result.success) {
      logger.info('[SyncIntegration] Pushed update to external', {
        ticketId,
        platform: result.platform,
        externalId: result.externalId,
      });
    } else {
      logger.warn('[SyncIntegration] Failed to push update', {
        ticketId,
        platform: result.platform,
        error: result.error,
      });
    }
  }
}

/**
 * Trigger outbound sync when a comment is added in profClaw
 * Called by the ticket service after adding comments
 */
export async function onCommentCreated(ticketId: string, content: string, source: string): Promise<void> {
  // Skip if the comment came from an external platform (avoid echo)
  if (source !== 'profclaw') return;

  if (!hasSyncEngine()) return;

  const links = await getExternalLinks(ticketId);
  if (links.length === 0) return;

  const engine = getSyncEngine();
  const results = await engine.pushComment(ticketId, content, links);

  for (const result of results) {
    if (result.success) {
      logger.info('[SyncIntegration] Pushed comment to external', {
        ticketId,
        platform: result.platform,
      });
    } else {
      logger.warn('[SyncIntegration] Failed to push comment', {
        ticketId,
        platform: result.platform,
        error: result.error,
      });
    }
  }
}

/**
 * Get sync status
 */
export function getSyncStatus(): {
  enabled: boolean;
  initialized: boolean;
  adapters: Record<string, { connected: boolean; lastSync?: Date; errorCount: number }>;
  pendingConflicts: number;
  autoSyncEnabled: boolean;
} {
  if (!initialized || !hasSyncEngine()) {
    return {
      enabled: isSyncEnabled(),
      initialized: false,
      adapters: {},
      pendingConflicts: 0,
      autoSyncEnabled: false,
    };
  }

  const engine = getSyncEngine();
  const status = engine.getStatus();

  return {
    enabled: true,
    initialized: true,
    ...status,
  };
}
