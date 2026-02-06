/**
 * Linear Sync Adapter
 *
 * Bi-directional sync with Linear (https://linear.app)
 * Uses Linear's GraphQL API.
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
import type { Ticket, TicketStatus, TicketPriority } from '../../tickets/types.js';

const LINEAR_API_URL = 'https://api.linear.app/graphql';

// Linear-specific status mapping (Linear uses UUIDs for states)
const LINEAR_STATUS_NAMES: Record<string, TicketStatus> = {
  'Backlog': 'backlog',
  'Todo': 'todo',
  'In Progress': 'in_progress',
  'In Review': 'in_review',
  'Done': 'done',
  'Canceled': 'cancelled',
  'Cancelled': 'cancelled',
};

// Linear priority is 0-4 (0 = no priority, 1 = urgent, 2 = high, 3 = medium, 4 = low)
const LINEAR_PRIORITY_MAP: Record<TicketPriority, number> = {
  critical: 1,  // Urgent
  high: 2,
  medium: 3,
  low: 4,
  none: 0,
};

const LINEAR_REVERSE_PRIORITY_MAP: Record<number, TicketPriority> = {
  0: 'none',
  1: 'critical',
  2: 'high',
  3: 'medium',
  4: 'low',
};

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  priority: number;
  state: {
    id: string;
    name: string;
  };
  labels: {
    nodes: Array<{ id: string; name: string }>;
  };
  assignee?: {
    id: string;
    name: string;
    email: string;
  };
  createdAt: string;
  updatedAt: string;
  url: string;
}

interface LinearComment {
  id: string;
  body: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface LinearTeam {
  id: string;
  name: string;
  key: string;
  states: {
    nodes: Array<{ id: string; name: string; type: string }>;
  };
}

export class LinearSyncAdapter extends BaseSyncAdapter {
  readonly platform = 'linear';
  private teamId: string | null = null;
  private stateMap: Map<string, { id: string; name: string }> = new Map();

  constructor(config: SyncAdapterConfig) {
    super(config);
    if (!config.apiKey) {
      throw new Error('Linear API key is required');
    }
  }

  // === Connection ===

  async connect(): Promise<void> {
    // Verify API key and fetch team info
    const query = `
      query {
        viewer {
          id
          name
          email
        }
        teams {
          nodes {
            id
            name
            key
            states {
              nodes {
                id
                name
                type
              }
            }
          }
        }
      }
    `;

    try {
      const result = await this.graphql<{
        viewer: { id: string; name: string; email: string };
        teams: { nodes: LinearTeam[] };
      }>(query);

      this.log('Connected as:', result.viewer.name);

      // Use configured teamId or first team
      const teams = result.teams.nodes;
      if (teams.length === 0) {
        throw new Error('No teams found in Linear workspace');
      }

      const team = this.config.teamId
        ? teams.find(t => t.id === this.config.teamId || t.key === this.config.teamId)
        : teams[0];

      if (!team) {
        throw new Error(`Team not found: ${this.config.teamId}`);
      }

      this.teamId = team.id;
      this.log('Using team:', team.name);

      // Build state map for status mapping
      for (const state of team.states.nodes) {
        this.stateMap.set(state.name.toLowerCase(), { id: state.id, name: state.name });
      }

      this.connected = true;
    } catch (error) {
      this.error('Failed to connect', error);
      throw error;
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      await this.graphql<{ viewer: { id: string } }>(`query { viewer { id } }`);
      return { healthy: true, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }

  // === Ticket Operations ===

  async createTicket(ticket: Ticket): Promise<ExternalTicket> {
    if (!this.teamId) throw new Error('Not connected to Linear');

    const mutation = `
      mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
            identifier
            title
            description
            priority
            state { id name }
            labels { nodes { id name } }
            assignee { id name email }
            createdAt
            updatedAt
            url
          }
        }
      }
    `;

    const stateId = this.getStateIdForStatus(ticket.status);

    const result = await this.graphql<{
      issueCreate: { success: boolean; issue: LinearIssue };
    }>(mutation, {
      input: {
        teamId: this.teamId,
        title: ticket.title,
        description: ticket.description || '',
        priority: LINEAR_PRIORITY_MAP[ticket.priority] ?? 0,
        stateId: stateId,
        labelIds: [], // TODO: Map labels
      },
    });

    if (!result.issueCreate.success) {
      throw new Error('Failed to create Linear issue');
    }

    return this.toExternalTicket(result.issueCreate.issue);
  }

  async updateTicket(externalId: string, updates: Partial<Ticket>): Promise<ExternalTicket> {
    const mutation = `
      mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue {
            id
            identifier
            title
            description
            priority
            state { id name }
            labels { nodes { id name } }
            assignee { id name email }
            createdAt
            updatedAt
            url
          }
        }
      }
    `;

    const input: Record<string, unknown> = {};

    if (updates.title !== undefined) input.title = updates.title;
    if (updates.description !== undefined) input.description = updates.description;
    if (updates.priority !== undefined) input.priority = LINEAR_PRIORITY_MAP[updates.priority] ?? 0;
    if (updates.status !== undefined) {
      const stateId = this.getStateIdForStatus(updates.status);
      if (stateId) input.stateId = stateId;
    }

    const result = await this.graphql<{
      issueUpdate: { success: boolean; issue: LinearIssue };
    }>(mutation, { id: externalId, input });

    if (!result.issueUpdate.success) {
      throw new Error('Failed to update Linear issue');
    }

    return this.toExternalTicket(result.issueUpdate.issue);
  }

  async deleteTicket(externalId: string): Promise<boolean> {
    // Linear doesn't truly delete issues, we archive them
    const mutation = `
      mutation ArchiveIssue($id: String!) {
        issueArchive(id: $id) {
          success
        }
      }
    `;

    const result = await this.graphql<{ issueArchive: { success: boolean } }>(mutation, { id: externalId });
    return result.issueArchive.success;
  }

  async getTicket(externalId: string): Promise<ExternalTicket | null> {
    const query = `
      query GetIssue($id: String!) {
        issue(id: $id) {
          id
          identifier
          title
          description
          priority
          state { id name }
          labels { nodes { id name } }
          assignee { id name email }
          createdAt
          updatedAt
          url
        }
      }
    `;

    try {
      const result = await this.graphql<{ issue: LinearIssue | null }>(query, { id: externalId });
      return result.issue ? this.toExternalTicket(result.issue) : null;
    } catch {
      return null;
    }
  }

  async listTickets(options?: ListTicketsOptions): Promise<{ tickets: ExternalTicket[]; cursor?: string }> {
    if (!this.teamId) throw new Error('Not connected to Linear');

    const query = `
      query ListIssues($teamId: String!, $first: Int, $after: String, $filter: IssueFilter) {
        team(id: $teamId) {
          issues(first: $first, after: $after, filter: $filter, orderBy: updatedAt) {
            nodes {
              id
              identifier
              title
              description
              priority
              state { id name }
              labels { nodes { id name } }
              assignee { id name email }
              createdAt
              updatedAt
              url
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    `;

    const filter: Record<string, unknown> = {};
    if (options?.updatedAfter) {
      filter.updatedAt = { gte: options.updatedAfter.toISOString() };
    }

    const result = await this.graphql<{
      team: {
        issues: {
          nodes: LinearIssue[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      };
    }>(query, {
      teamId: this.teamId,
      first: options?.limit || 50,
      after: options?.cursor,
      filter: Object.keys(filter).length > 0 ? filter : undefined,
    });

    return {
      tickets: result.team.issues.nodes.map(issue => this.toExternalTicket(issue)),
      cursor: result.team.issues.pageInfo.hasNextPage ? result.team.issues.pageInfo.endCursor ?? undefined : undefined,
    };
  }

  // === Comment Operations ===

  async addComment(externalTicketId: string, content: string): Promise<ExternalComment> {
    const mutation = `
      mutation CreateComment($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
          comment {
            id
            body
            user { id name email }
            createdAt
            updatedAt
          }
        }
      }
    `;

    const result = await this.graphql<{
      commentCreate: { success: boolean; comment: LinearComment };
    }>(mutation, {
      input: {
        issueId: externalTicketId,
        body: content,
      },
    });

    if (!result.commentCreate.success) {
      throw new Error('Failed to create comment');
    }

    return this.toExternalComment(result.commentCreate.comment, externalTicketId);
  }

  async getComments(externalTicketId: string): Promise<ExternalComment[]> {
    const query = `
      query GetComments($issueId: String!) {
        issue(id: $issueId) {
          comments {
            nodes {
              id
              body
              user { id name email }
              createdAt
              updatedAt
            }
          }
        }
      }
    `;

    const result = await this.graphql<{
      issue: { comments: { nodes: LinearComment[] } } | null;
    }>(query, { issueId: externalTicketId });

    if (!result.issue) return [];

    return result.issue.comments.nodes.map(c => this.toExternalComment(c, externalTicketId));
  }

  // === Status Mapping ===

  mapStatusToExternal(status: TicketStatus): string {
    const statusNames: Record<TicketStatus, string> = {
      backlog: 'Backlog',
      todo: 'Todo',
      in_progress: 'In Progress',
      in_review: 'In Review',
      done: 'Done',
      cancelled: 'Canceled',
    };
    return statusNames[status] || 'Backlog';
  }

  mapStatusFromExternal(externalStatus: string): TicketStatus {
    return LINEAR_STATUS_NAMES[externalStatus] || 'backlog';
  }

  // === Priority Mapping ===

  mapPriorityToExternal(priority: TicketPriority): number {
    return LINEAR_PRIORITY_MAP[priority] ?? 0;
  }

  mapPriorityFromExternal(externalPriority: string | number): TicketPriority {
    const num = typeof externalPriority === 'number' ? externalPriority : parseInt(externalPriority, 10);
    return LINEAR_REVERSE_PRIORITY_MAP[num] || 'none';
  }

  // === Webhook Parsing ===

  parseWebhook(payload: unknown): WebhookEvent | null {
    const data = payload as Record<string, unknown>;
    if (!data || typeof data !== 'object') return null;

    const action = data.action as string;
    const type = data.type as string;

    if (type !== 'Issue' && type !== 'Comment') return null;

    let eventType: WebhookEventType;
    if (type === 'Issue') {
      if (action === 'create') eventType = 'ticket.created';
      else if (action === 'update') eventType = 'ticket.updated';
      else if (action === 'remove') eventType = 'ticket.deleted';
      else return null;
    } else {
      if (action === 'create') eventType = 'comment.created';
      else if (action === 'update') eventType = 'comment.updated';
      else if (action === 'remove') eventType = 'comment.deleted';
      else return null;
    }

    const issueData = data.data as Record<string, unknown>;
    const externalId = (issueData?.id || data.id) as string;

    return {
      type: eventType,
      platform: 'linear',
      externalId,
      ticketExternalId: type === 'Comment' ? (issueData?.issueId as string) : undefined,
      timestamp: new Date((data.createdAt as string) || Date.now()),
      payload: data,
    };
  }

  // === Private Helpers ===

  private async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await fetch(LINEAR_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.config.apiKey!,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Linear API error (${response.status}): ${text}`);
    }

    const result = await response.json() as { data?: T; errors?: Array<{ message: string }> };

    if (result.errors && result.errors.length > 0) {
      throw new Error(`Linear GraphQL error: ${result.errors[0].message}`);
    }

    return result.data!;
  }

  private getStateIdForStatus(status: TicketStatus): string | undefined {
    const stateName = this.mapStatusToExternal(status).toLowerCase();
    const state = this.stateMap.get(stateName);
    return state?.id;
  }

  private toExternalTicket(issue: LinearIssue): ExternalTicket {
    return {
      platform: 'linear',
      externalId: issue.id,
      externalUrl: issue.url,
      title: issue.title,
      description: issue.description || '',
      status: issue.state.name,
      priority: String(issue.priority),
      labels: issue.labels.nodes.map(l => l.name),
      assignee: issue.assignee?.email,
      createdAt: new Date(issue.createdAt),
      updatedAt: new Date(issue.updatedAt),
      rawData: issue as unknown as Record<string, unknown>,
    };
  }

  private toExternalComment(comment: LinearComment, ticketExternalId: string): ExternalComment {
    return {
      platform: 'linear',
      externalId: comment.id,
      ticketExternalId,
      content: comment.body,
      authorName: comment.user.name,
      authorId: comment.user.id,
      createdAt: new Date(comment.createdAt),
      updatedAt: comment.updatedAt ? new Date(comment.updatedAt) : undefined,
      rawData: comment as unknown as Record<string, unknown>,
    };
  }
}
