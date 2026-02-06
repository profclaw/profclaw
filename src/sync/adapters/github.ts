/**
 * GitHub Issues Sync Adapter
 *
 * Bi-directional sync with GitHub Issues.
 * Uses GitHub REST API v3.
 */

import { BaseSyncAdapter } from './base.js';
import type {
  SyncAdapterConfig,
  ExternalTicket,
  ExternalComment,
  ListTicketsOptions,
  WebhookEvent,
  WebhookEventType,
} from '../types.js';
import type { Ticket, TicketStatus, TicketPriority, TicketType } from '../../tickets/types.js';

const GITHUB_API_URL = 'https://api.github.com';

// GitHub uses open/closed states with labels for more granular tracking
const GITHUB_STATUS_LABELS: Record<TicketStatus, string | null> = {
  backlog: null,  // Just open, no special label
  todo: 'todo',
  in_progress: 'in progress',
  in_review: 'in review',
  done: null,  // Closed state
  cancelled: null,  // Closed with "wontfix" label
};

// Priority labels (common conventions)
const GITHUB_PRIORITY_LABELS: Record<TicketPriority, string> = {
  critical: 'priority: critical',
  high: 'priority: high',
  medium: 'priority: medium',
  low: 'priority: low',
  none: '',
};

// Type labels
const GITHUB_TYPE_LABELS: Record<TicketType, string> = {
  task: 'task',
  bug: 'bug',
  feature: 'enhancement',
  epic: 'epic',
  story: 'user story',
  subtask: 'subtask',
};

interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  state_reason?: 'completed' | 'not_planned' | 'reopened' | null;
  labels: Array<{ id: number; name: string; color: string }>;
  assignee: { id: number; login: string; avatar_url: string } | null;
  assignees: Array<{ id: number; login: string; avatar_url: string }>;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  html_url: string;
}

interface GitHubComment {
  id: number;
  body: string;
  user: { id: number; login: string; avatar_url: string };
  created_at: string;
  updated_at: string;
  html_url: string;
}

export class GitHubSyncAdapter extends BaseSyncAdapter {
  readonly platform = 'github';
  private owner: string;
  private repo: string;

  constructor(config: SyncAdapterConfig) {
    super(config);
    if (!config.accessToken && !config.apiKey) {
      throw new Error('GitHub access token is required');
    }
    if (!config.owner || !config.repo) {
      throw new Error('GitHub owner and repo are required');
    }
    this.owner = config.owner;
    this.repo = config.repo;
  }

  // === Connection ===

  async connect(): Promise<void> {
    // Verify token and repo access
    try {
      const url = `${GITHUB_API_URL}/repos/${this.owner}/${this.repo}`;
      const repo = await this.request<{ full_name: string; permissions?: { push?: boolean } }>('GET', url);
      this.log('Connected to:', repo.full_name);
      this.connected = true;
    } catch (error) {
      this.error('Failed to connect', error);
      throw error;
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      await this.request<{ login: string }>('GET', `${GITHUB_API_URL}/user`);
      return { healthy: true, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }

  // === Ticket Operations ===

  async createTicket(ticket: Ticket): Promise<ExternalTicket> {
    const url = `${GITHUB_API_URL}/repos/${this.owner}/${this.repo}/issues`;

    const labels = this.buildLabels(ticket);

    const issue = await this.request<GitHubIssue>('POST', url, {
      title: ticket.title,
      body: ticket.description || '',
      labels,
      assignees: ticket.assignee ? [ticket.assignee] : [],
    });

    return this.toExternalTicket(issue);
  }

  async updateTicket(externalId: string, updates: Partial<Ticket>): Promise<ExternalTicket> {
    // GitHub uses issue number as ID in API paths
    const issueNumber = externalId.includes('#') ? externalId.replace('#', '') : externalId;
    const url = `${GITHUB_API_URL}/repos/${this.owner}/${this.repo}/issues/${issueNumber}`;

    // First get current issue to merge labels properly
    const current = await this.request<GitHubIssue>('GET', url);

    const body: Record<string, unknown> = {};

    if (updates.title !== undefined) body.title = updates.title;
    if (updates.description !== undefined) body.body = updates.description;
    if (updates.assignee !== undefined) body.assignees = updates.assignee ? [updates.assignee] : [];

    // Handle status change
    if (updates.status !== undefined) {
      const isClosed = updates.status === 'done' || updates.status === 'cancelled';
      body.state = isClosed ? 'closed' : 'open';
      if (updates.status === 'cancelled') {
        body.state_reason = 'not_planned';
      } else if (updates.status === 'done') {
        body.state_reason = 'completed';
      }
    }

    // Update labels
    if (updates.status !== undefined || updates.priority !== undefined || updates.type !== undefined) {
      const newLabels = this.buildLabels({
        ...this.fromExternalTicket(current),
        ...updates,
      } as Ticket);

      // Preserve non-status/priority/type labels
      const preservedLabels = current.labels
        .map(l => l.name)
        .filter(name => !this.isSystemLabel(name));

      body.labels = [...new Set([...newLabels, ...preservedLabels])];
    }

    const issue = await this.request<GitHubIssue>('PATCH', url, body);
    return this.toExternalTicket(issue);
  }

  async deleteTicket(externalId: string): Promise<boolean> {
    // GitHub doesn't allow deleting issues, we close them
    const issueNumber = externalId.includes('#') ? externalId.replace('#', '') : externalId;
    const url = `${GITHUB_API_URL}/repos/${this.owner}/${this.repo}/issues/${issueNumber}`;

    try {
      await this.request<GitHubIssue>('PATCH', url, {
        state: 'closed',
        state_reason: 'not_planned',
      });
      return true;
    } catch {
      return false;
    }
  }

  async getTicket(externalId: string): Promise<ExternalTicket | null> {
    const issueNumber = externalId.includes('#') ? externalId.replace('#', '') : externalId;
    const url = `${GITHUB_API_URL}/repos/${this.owner}/${this.repo}/issues/${issueNumber}`;

    try {
      const issue = await this.request<GitHubIssue>('GET', url);
      return this.toExternalTicket(issue);
    } catch {
      return null;
    }
  }

  async listTickets(options?: ListTicketsOptions): Promise<{ tickets: ExternalTicket[]; cursor?: string }> {
    const params = new URLSearchParams();
    params.set('per_page', String(options?.limit || 30));
    params.set('sort', 'updated');
    params.set('direction', 'desc');

    if (options?.status?.includes('open') || !options?.status?.includes('closed')) {
      params.set('state', 'all');
    }

    if (options?.cursor) {
      params.set('page', options.cursor);
    }

    if (options?.labels && options.labels.length > 0) {
      params.set('labels', options.labels.join(','));
    }

    const url = `${GITHUB_API_URL}/repos/${this.owner}/${this.repo}/issues?${params}`;
    const response = await fetch(url, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const issues = await response.json() as GitHubIssue[];

    // Filter out pull requests (they also come through issues API)
    const realIssues = issues.filter(i => !(i as any).pull_request);

    // Parse Link header for pagination
    const linkHeader = response.headers.get('Link');
    let nextCursor: string | undefined;
    if (linkHeader) {
      const match = linkHeader.match(/<[^>]+[?&]page=(\d+)[^>]*>;\s*rel="next"/);
      if (match) {
        nextCursor = match[1];
      }
    }

    // Filter by updatedAfter if specified
    let filteredIssues = realIssues;
    if (options?.updatedAfter) {
      const cutoff = options.updatedAfter.getTime();
      filteredIssues = realIssues.filter(i => new Date(i.updated_at).getTime() >= cutoff);
    }

    return {
      tickets: filteredIssues.map(i => this.toExternalTicket(i)),
      cursor: nextCursor,
    };
  }

  // === Comment Operations ===

  async addComment(externalTicketId: string, content: string): Promise<ExternalComment> {
    const issueNumber = externalTicketId.includes('#') ? externalTicketId.replace('#', '') : externalTicketId;
    const url = `${GITHUB_API_URL}/repos/${this.owner}/${this.repo}/issues/${issueNumber}/comments`;

    const comment = await this.request<GitHubComment>('POST', url, { body: content });
    return this.toExternalComment(comment, externalTicketId);
  }

  async getComments(externalTicketId: string): Promise<ExternalComment[]> {
    const issueNumber = externalTicketId.includes('#') ? externalTicketId.replace('#', '') : externalTicketId;
    const url = `${GITHUB_API_URL}/repos/${this.owner}/${this.repo}/issues/${issueNumber}/comments`;

    const comments = await this.request<GitHubComment[]>('GET', url);
    return comments.map(c => this.toExternalComment(c, externalTicketId));
  }

  // === Status Mapping ===

  mapStatusToExternal(status: TicketStatus): string {
    // For GitHub, we return the state (open/closed) plus any label
    if (status === 'done' || status === 'cancelled') {
      return 'closed';
    }
    return 'open';
  }

  mapStatusFromExternal(externalStatus: string): TicketStatus {
    // Check if it's a state or a label
    if (externalStatus === 'closed') return 'done';
    if (externalStatus === 'open') return 'todo';

    // Try to match label
    const normalized = externalStatus.toLowerCase();
    if (normalized.includes('progress')) return 'in_progress';
    if (normalized.includes('review')) return 'in_review';
    if (normalized.includes('backlog')) return 'backlog';
    if (normalized.includes('todo')) return 'todo';

    return 'todo';
  }

  // === Priority Mapping ===

  mapPriorityToExternal(priority: TicketPriority): string {
    return GITHUB_PRIORITY_LABELS[priority] || '';
  }

  mapPriorityFromExternal(externalPriority: string | number): TicketPriority {
    const normalized = String(externalPriority).toLowerCase();
    if (normalized.includes('critical') || normalized.includes('p0')) return 'critical';
    if (normalized.includes('high') || normalized.includes('p1')) return 'high';
    if (normalized.includes('medium') || normalized.includes('p2')) return 'medium';
    if (normalized.includes('low') || normalized.includes('p3')) return 'low';
    return 'none';
  }

  // === Type Mapping ===

  mapTypeToExternal(type: TicketType): string {
    return GITHUB_TYPE_LABELS[type] || 'task';
  }

  mapTypeFromExternal(externalType: string): TicketType {
    const normalized = externalType.toLowerCase();
    if (normalized === 'bug') return 'bug';
    if (normalized === 'enhancement' || normalized === 'feature') return 'feature';
    if (normalized === 'epic') return 'epic';
    if (normalized.includes('story')) return 'story';
    if (normalized === 'subtask' || normalized.includes('sub')) return 'subtask';
    return 'task';
  }

  // === Webhook Parsing ===

  parseWebhook(payload: unknown): WebhookEvent | null {
    const data = payload as Record<string, unknown>;
    if (!data || typeof data !== 'object') return null;

    const action = data.action as string;

    // Handle issue events
    if (data.issue && !data.comment) {
      const issue = data.issue as GitHubIssue;
      let eventType: WebhookEventType;

      if (action === 'opened') eventType = 'ticket.created';
      else if (action === 'edited' || action === 'labeled' || action === 'unlabeled' ||
               action === 'assigned' || action === 'unassigned' || action === 'closed' ||
               action === 'reopened') eventType = 'ticket.updated';
      else if (action === 'deleted') eventType = 'ticket.deleted';
      else return null;

      return {
        type: eventType,
        platform: 'github',
        externalId: String(issue.number),
        timestamp: new Date(),
        payload: data,
      };
    }

    // Handle comment events
    if (data.comment) {
      const comment = data.comment as GitHubComment;
      const issue = data.issue as GitHubIssue;
      let eventType: WebhookEventType;

      if (action === 'created') eventType = 'comment.created';
      else if (action === 'edited') eventType = 'comment.updated';
      else if (action === 'deleted') eventType = 'comment.deleted';
      else return null;

      return {
        type: eventType,
        platform: 'github',
        externalId: String(comment.id),
        ticketExternalId: String(issue.number),
        timestamp: new Date(),
        payload: data,
      };
    }

    return null;
  }

  // === Private Helpers ===

  private getHeaders(): Record<string, string> {
    return {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${this.config.accessToken || this.config.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const response = await fetch(url, {
      method,
      headers: this.getHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${text}`);
    }

    return response.json() as Promise<T>;
  }

  private buildLabels(ticket: Partial<Ticket>): string[] {
    const labels: string[] = [];

    // Status label (for granular tracking beyond open/closed)
    if (ticket.status && ticket.status !== 'done' && ticket.status !== 'cancelled') {
      const statusLabel = GITHUB_STATUS_LABELS[ticket.status];
      if (statusLabel) labels.push(statusLabel);
    }

    // Priority label
    if (ticket.priority && ticket.priority !== 'none') {
      const priorityLabel = GITHUB_PRIORITY_LABELS[ticket.priority];
      if (priorityLabel) labels.push(priorityLabel);
    }

    // Type label
    if (ticket.type) {
      const typeLabel = GITHUB_TYPE_LABELS[ticket.type];
      if (typeLabel) labels.push(typeLabel);
    }

    // User labels
    if (ticket.labels) {
      labels.push(...ticket.labels);
    }

    return [...new Set(labels)];
  }

  private isSystemLabel(label: string): boolean {
    const systemPrefixes = ['priority:', 'todo', 'in progress', 'in review', 'backlog'];
    const systemLabels = Object.values(GITHUB_TYPE_LABELS);
    const normalized = label.toLowerCase();

    return systemPrefixes.some(p => normalized.startsWith(p) || normalized === p) ||
           systemLabels.includes(label);
  }

  private toExternalTicket(issue: GitHubIssue): ExternalTicket {
    // Determine status from state and labels
    let status = issue.state === 'closed' ? 'closed' : 'open';
    for (const label of issue.labels) {
      if (label.name.toLowerCase().includes('progress')) status = 'In Progress';
      else if (label.name.toLowerCase().includes('review')) status = 'In Review';
      else if (label.name.toLowerCase() === 'backlog') status = 'Backlog';
      else if (label.name.toLowerCase() === 'todo') status = 'Todo';
    }

    // Extract priority from labels
    let priority: string | undefined;
    for (const label of issue.labels) {
      if (label.name.toLowerCase().startsWith('priority:')) {
        priority = label.name;
        break;
      }
    }

    // Extract type from labels
    let type: string | undefined;
    const typeLabels = Object.values(GITHUB_TYPE_LABELS);
    for (const label of issue.labels) {
      if (typeLabels.includes(label.name)) {
        type = label.name;
        break;
      }
    }

    return {
      platform: 'github',
      externalId: String(issue.number),
      externalUrl: issue.html_url,
      title: issue.title,
      description: issue.body || '',
      status,
      priority,
      type,
      labels: issue.labels.map(l => l.name),
      assignee: issue.assignee?.login,
      createdAt: new Date(issue.created_at),
      updatedAt: new Date(issue.updated_at),
      rawData: issue as unknown as Record<string, unknown>,
    };
  }

  private fromExternalTicket(issue: GitHubIssue): Partial<Ticket> {
    const external = this.toExternalTicket(issue);
    return {
      title: external.title,
      description: external.description,
      status: this.mapStatusFromExternal(external.status),
      priority: external.priority ? this.mapPriorityFromExternal(external.priority) : undefined,
      type: external.type ? this.mapTypeFromExternal(external.type) : undefined,
      labels: external.labels.filter(l => !this.isSystemLabel(l)),
      assignee: external.assignee,
    };
  }

  private toExternalComment(comment: GitHubComment, ticketExternalId: string): ExternalComment {
    return {
      platform: 'github',
      externalId: String(comment.id),
      ticketExternalId,
      content: comment.body,
      authorName: comment.user.login,
      authorId: String(comment.user.id),
      createdAt: new Date(comment.created_at),
      updatedAt: new Date(comment.updated_at),
      rawData: comment as unknown as Record<string, unknown>,
    };
  }
}
