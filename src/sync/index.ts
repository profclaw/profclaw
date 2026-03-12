/**
 * profClaw Sync Engine
 *
 * Bi-directional sync with external platforms:
 * - Linear
 * - GitHub Issues
 * - Jira (planned)
 * - Plane (planned)
 *
 * @example
 * ```typescript
 * import { initSyncEngine, getSyncEngine } from './sync/index.js';
 *
 * // Initialize from config/settings.yml
 * const engine = await initSyncEngine();
 *
 * // Push a ticket to Linear
 * const result = await engine.pushTicket(ticket, 'linear');
 *
 * // Handle incoming webhook
 * await engine.handleWebhook('linear', webhookPayload);
 * ```
 */

// TODO(@copilot): Generate unit tests for this module
// Key functions to test: getSyncEngine, initSyncEngine, hasSyncEngine, loadSyncConfig, reloadSyncConfig, toSyncEngineConfig, isSyncEnabled, getEnabledPlatforms, getPlatformConfig, validatePlatformCredentials, getStatusMapping, BaseSyncAdapter, LinearSyncAdapter, GitHubSyncAdapter, initSyncIntegration, handleSyncWebhook, pushTicketToExternal, getSyncStatus
// Test file location: src/sync/tests/index.test.ts

// Core engine
export { SyncEngine, getSyncEngine, initSyncEngine, hasSyncEngine } from './engine.js';

// Configuration
export {
  loadSyncConfig,
  reloadSyncConfig,
  toSyncEngineConfig,
  isSyncEnabled,
  getEnabledPlatforms,
  getPlatformConfig,
  validatePlatformCredentials,
  getStatusMapping,
  type SyncConfig,
  type LinearConfig,
  type GitHubConfig,
  type JiraConfig,
  type PlaneConfig,
} from './config.js';

// Types
export type {
  SyncAdapter,
  SyncAdapterConfig,
  SyncEngineConfig,
  SyncResult,
  SyncState,
  SyncConflict,
  SyncOperation,
  SyncOperationType,
  SyncDirection,
  ConflictStrategy,
  ExternalTicket,
  ExternalComment,
  WebhookEvent,
  WebhookEventType,
  ListTicketsOptions,
  SyncQueueItem,
} from './types.js';

// Adapters
export { BaseSyncAdapter } from './adapters/base.js';
export { LinearSyncAdapter } from './adapters/linear.js';
export { GitHubSyncAdapter } from './adapters/github.js';

// Integration (wires sync to ticket service)
export {
  initSyncIntegration,
  handleSyncWebhook,
  pushTicketToExternal,
  getSyncStatus,
} from './integration.js';
