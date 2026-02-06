/**
 * GLINR Sync Engine Types
 *
 * Core types for bi-directional sync with external platforms:
 * - Linear
 * - GitHub Issues
 * - Jira
 * - Plane
 */

import { z } from 'zod';
import type { Ticket, TicketComment, ExternalLink, TicketStatus, TicketPriority, TicketType } from '../tickets/types.js';

// === Sync Direction ===

export type SyncDirection = 'push' | 'pull' | 'bidirectional';

// === Sync Operation Types ===

export type SyncOperationType = 'create' | 'update' | 'delete' | 'comment_add' | 'comment_update' | 'status_change';

export interface SyncOperation {
  id: string;
  type: SyncOperationType;
  platform: string;
  ticketId: string;
  externalId?: string;
  payload: Record<string, unknown>;
  timestamp: Date;
  retryCount: number;
  error?: string;
}

// === Sync Result ===

export interface SyncResult {
  success: boolean;
  platform: string;
  ticketId: string;
  externalId?: string;
  operation: SyncOperationType;
  timestamp: Date;
  error?: string;
  details?: Record<string, unknown>;
}

// === Conflict Resolution ===

export type ConflictStrategy = 'local_wins' | 'remote_wins' | 'latest_wins' | 'manual';

export interface SyncConflict {
  ticketId: string;
  platform: string;
  field: string;
  localValue: unknown;
  remoteValue: unknown;
  localTimestamp: Date;
  remoteTimestamp: Date;
  resolution?: 'local' | 'remote' | 'merged';
  mergedValue?: unknown;
}

// === Platform-specific Ticket Representation ===

export interface ExternalTicket {
  platform: string;
  externalId: string;
  externalUrl?: string;
  title: string;
  description: string;
  status: string;
  priority?: string;
  type?: string;
  labels: string[];
  assignee?: string;
  createdAt: Date;
  updatedAt: Date;
  rawData: Record<string, unknown>;
}

export interface ExternalComment {
  platform: string;
  externalId: string;
  ticketExternalId: string;
  content: string;
  authorName: string;
  authorId?: string;
  createdAt: Date;
  updatedAt?: Date;
  rawData: Record<string, unknown>;
}

// === Sync Adapter Interface ===

export interface SyncAdapterConfig {
  apiKey?: string;
  accessToken?: string;
  baseUrl?: string;
  workspaceId?: string;
  projectId?: string;
  teamId?: string;
  owner?: string;
  repo?: string;
}

export interface SyncAdapter {
  readonly platform: string;
  readonly config: SyncAdapterConfig;

  // Connection
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  healthCheck(): Promise<{ healthy: boolean; latencyMs: number }>;

  // Ticket Operations
  createTicket(ticket: Ticket): Promise<ExternalTicket>;
  updateTicket(externalId: string, updates: Partial<Ticket>): Promise<ExternalTicket>;
  deleteTicket(externalId: string): Promise<boolean>;
  getTicket(externalId: string): Promise<ExternalTicket | null>;
  listTickets(options?: ListTicketsOptions): Promise<{ tickets: ExternalTicket[]; cursor?: string }>;

  // Comment Operations
  addComment(externalTicketId: string, content: string): Promise<ExternalComment>;
  getComments(externalTicketId: string): Promise<ExternalComment[]>;

  // Status/Field Mapping
  mapStatusToExternal(status: TicketStatus): string;
  mapStatusFromExternal(externalStatus: string): TicketStatus;
  mapPriorityToExternal(priority: TicketPriority): string | number | undefined;
  mapPriorityFromExternal(externalPriority: string | number): TicketPriority;
  mapTypeToExternal(type: TicketType): string | undefined;
  mapTypeFromExternal(externalType: string): TicketType;

  // Webhook handling (optional)
  parseWebhook?(payload: unknown): WebhookEvent | null;
}

export interface ListTicketsOptions {
  cursor?: string;
  limit?: number;
  updatedAfter?: Date;
  status?: string[];
  labels?: string[];
}

// === Webhook Events ===

export type WebhookEventType =
  | 'ticket.created'
  | 'ticket.updated'
  | 'ticket.deleted'
  | 'comment.created'
  | 'comment.updated'
  | 'comment.deleted';

export interface WebhookEvent {
  type: WebhookEventType;
  platform: string;
  externalId: string;
  ticketExternalId?: string;
  timestamp: Date;
  payload: Record<string, unknown>;
}

// === Sync Engine State ===

export interface SyncState {
  platform: string;
  lastSyncAt?: Date;
  cursor?: string;
  syncInProgress: boolean;
  errorCount: number;
  lastError?: string;
}

export interface SyncEngineConfig {
  conflictStrategy: ConflictStrategy;
  syncIntervalMs: number;
  maxRetries: number;
  retryDelayMs: number;
  enableWebhooks: boolean;
  platforms: Record<string, SyncAdapterConfig>;
}

// === Sync Queue ===

export interface SyncQueueItem {
  id: string;
  operation: SyncOperation;
  priority: number;
  createdAt: Date;
  scheduledFor: Date;
  attempts: number;
  maxAttempts: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: SyncResult;
}

// === Zod Schemas for Validation ===

export const SyncAdapterConfigSchema = z.object({
  apiKey: z.string().optional(),
  accessToken: z.string().optional(),
  baseUrl: z.string().url().optional(),
  workspaceId: z.string().optional(),
  projectId: z.string().optional(),
  teamId: z.string().optional(),
  owner: z.string().optional(),
  repo: z.string().optional(),
});

export const SyncEngineConfigSchema = z.object({
  conflictStrategy: z.enum(['local_wins', 'remote_wins', 'latest_wins', 'manual']).default('latest_wins'),
  syncIntervalMs: z.number().min(1000).default(60000), // 1 minute default
  maxRetries: z.number().min(0).max(10).default(3),
  retryDelayMs: z.number().min(100).default(1000),
  enableWebhooks: z.boolean().default(true),
  platforms: z.record(SyncAdapterConfigSchema).default({}),
});
