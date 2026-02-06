/**
 * Base Sync Adapter
 *
 * Abstract base class for all platform sync adapters.
 * Provides common functionality and enforces the adapter interface.
 */

import type {
  SyncAdapter,
  SyncAdapterConfig,
  ExternalTicket,
  ExternalComment,
  ListTicketsOptions,
  WebhookEvent,
} from '../types.js';
import type { Ticket, TicketStatus, TicketPriority, TicketType } from '../../tickets/types.js';
import { STATUS_MAP, REVERSE_STATUS_MAP, PRIORITY_MAP } from '../../tickets/types.js';
import { logger } from '../../utils/logger.js';

export abstract class BaseSyncAdapter implements SyncAdapter {
  abstract readonly platform: string;
  readonly config: SyncAdapterConfig;
  protected connected = false;

  constructor(config: SyncAdapterConfig) {
    this.config = config;
  }

  // === Connection Management ===

  abstract connect(): Promise<void>;

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  abstract healthCheck(): Promise<{ healthy: boolean; latencyMs: number }>;

  // === Ticket Operations (must be implemented) ===

  abstract createTicket(ticket: Ticket): Promise<ExternalTicket>;
  abstract updateTicket(externalId: string, updates: Partial<Ticket>): Promise<ExternalTicket>;
  abstract deleteTicket(externalId: string): Promise<boolean>;
  abstract getTicket(externalId: string): Promise<ExternalTicket | null>;
  abstract listTickets(options?: ListTicketsOptions): Promise<{ tickets: ExternalTicket[]; cursor?: string }>;

  // === Comment Operations (must be implemented) ===

  abstract addComment(externalTicketId: string, content: string): Promise<ExternalComment>;
  abstract getComments(externalTicketId: string): Promise<ExternalComment[]>;

  // === Status Mapping (default implementation using STATUS_MAP) ===

  mapStatusToExternal(status: TicketStatus): string {
    const platformMap = STATUS_MAP[status];
    if (platformMap && platformMap[this.platform]) {
      return platformMap[this.platform];
    }
    // Fallback: capitalize first letter
    return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
  }

  mapStatusFromExternal(externalStatus: string): TicketStatus {
    const platformMap = REVERSE_STATUS_MAP[this.platform];
    if (platformMap && platformMap[externalStatus]) {
      return platformMap[externalStatus];
    }
    // Fallback: try to match common patterns
    const normalized = externalStatus.toLowerCase().replace(/\s+/g, '_');
    const validStatuses: TicketStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled'];
    if (validStatuses.includes(normalized as TicketStatus)) {
      return normalized as TicketStatus;
    }
    // Default to backlog for unknown statuses
    return 'backlog';
  }

  // === Priority Mapping (default implementation using PRIORITY_MAP) ===

  mapPriorityToExternal(priority: TicketPriority): string | number | undefined {
    const platformMap = PRIORITY_MAP[priority];
    if (platformMap && platformMap[this.platform] !== undefined) {
      return platformMap[this.platform];
    }
    return priority;
  }

  mapPriorityFromExternal(externalPriority: string | number): TicketPriority {
    // Try to match by value
    for (const [profclawPriority, platformMap] of Object.entries(PRIORITY_MAP)) {
      if (platformMap[this.platform] === externalPriority) {
        return profclawPriority as TicketPriority;
      }
    }
    // Fallback: try common patterns
    const normalized = String(externalPriority).toLowerCase();
    if (normalized.includes('urgent') || normalized.includes('critical') || normalized.includes('highest')) {
      return 'critical';
    }
    if (normalized.includes('high')) {
      return 'high';
    }
    if (normalized.includes('medium') || normalized.includes('normal')) {
      return 'medium';
    }
    if (normalized.includes('low')) {
      return 'low';
    }
    return 'none';
  }

  // === Type Mapping (default implementation) ===

  mapTypeToExternal(type: TicketType): string | undefined {
    // Most platforms use similar naming
    const typeMap: Record<TicketType, string> = {
      task: 'Task',
      bug: 'Bug',
      feature: 'Feature',
      epic: 'Epic',
      story: 'Story',
      subtask: 'Subtask',
    };
    return typeMap[type] || type;
  }

  mapTypeFromExternal(externalType: string): TicketType {
    const normalized = externalType.toLowerCase();
    const validTypes: TicketType[] = ['task', 'bug', 'feature', 'epic', 'story', 'subtask'];
    if (validTypes.includes(normalized as TicketType)) {
      return normalized as TicketType;
    }
    // Common mappings
    if (normalized.includes('issue') || normalized.includes('task')) return 'task';
    if (normalized.includes('bug') || normalized.includes('defect')) return 'bug';
    if (normalized.includes('feature') || normalized.includes('enhancement')) return 'feature';
    if (normalized.includes('epic')) return 'epic';
    if (normalized.includes('story') || normalized.includes('user story')) return 'story';
    if (normalized.includes('subtask') || normalized.includes('sub-task')) return 'subtask';
    return 'task';
  }

  // === Webhook Parsing (optional, override in subclass) ===

  parseWebhook?(_payload: unknown): WebhookEvent | null {
    return null;
  }

  // === Helper Methods ===

  protected async makeRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    body?: unknown,
    headers?: Record<string, string>
  ): Promise<T> {
    const defaultHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      defaultHeaders['Authorization'] = `Bearer ${this.config.apiKey}`;
    } else if (this.config.accessToken) {
      defaultHeaders['Authorization'] = `Bearer ${this.config.accessToken}`;
    }

    const response = await fetch(url, {
      method,
      headers: { ...defaultHeaders, ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${this.platform} API error (${response.status}): ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  protected log(message: string, data?: unknown): void {
    logger.info(`[Sync:${this.platform}] ${message}`, data ? { data } : undefined);
  }

  protected error(message: string, err?: unknown): void {
    logger.error(`[Sync:${this.platform}] ${message}`, err instanceof Error ? err : undefined);
  }
}
