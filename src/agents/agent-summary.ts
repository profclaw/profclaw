/**
 * Agent Summary Tracker
 *
 * Provides real-time 1-2 word progress summaries of what agents are doing,
 * suitable for display in CLI/UI progress indicators.
 */

import path from 'node:path';

export interface AgentSummary {
  sessionId: string;
  status: 'idle' | 'thinking' | 'executing' | 'waiting';
  currentAction: string;
  lastToolName?: string;
  lastToolArgs?: string;
  stepCount: number;
  tokensUsed: number;
  startedAt: number;
  updatedAt: number;
}

function extractFilename(filePath: unknown): string | undefined {
  if (typeof filePath !== 'string' || filePath.length === 0) return undefined;
  return path.basename(filePath);
}

function extractCommand(command: unknown): string | undefined {
  if (typeof command !== 'string' || command.length === 0) return undefined;
  // Truncate long commands to first 40 chars
  const trimmed = command.trim();
  return trimmed.length > 40 ? `${trimmed.substring(0, 40)}…` : trimmed;
}

function extractQuery(query: unknown): string | undefined {
  if (typeof query !== 'string' || query.length === 0) return undefined;
  const trimmed = query.trim();
  return trimmed.length > 30 ? `${trimmed.substring(0, 30)}…` : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toArgs(input: unknown): Record<string, unknown> {
  return isRecord(input) ? input : {};
}

type SseBroadcaster = (eventType: string, data: Record<string, unknown>) => void;

export class AgentSummaryTracker {
  private summaries: Map<string, AgentSummary> = new Map();
  private broadcaster: SseBroadcaster | undefined;

  registerSSEBroadcaster(broadcaster: SseBroadcaster): void {
    this.broadcaster = broadcaster;
  }

  start(sessionId: string): void {
    const now = Date.now();
    const summary: AgentSummary = {
      sessionId,
      status: 'idle',
      currentAction: 'Starting',
      stepCount: 0,
      tokensUsed: 0,
      startedAt: now,
      updatedAt: now,
    };
    this.summaries.set(sessionId, summary);
    this.broadcaster?.('agent:summary', summary as unknown as Record<string, unknown>);
  }

  update(sessionId: string, updates: Partial<AgentSummary>): void {
    const existing = this.summaries.get(sessionId);
    if (!existing) return;

    const updated: AgentSummary = {
      ...existing,
      ...updates,
      sessionId, // always preserve original sessionId
      updatedAt: Date.now(),
    };
    this.summaries.set(sessionId, updated);
    this.broadcaster?.('agent:summary', updated as unknown as Record<string, unknown>);
  }

  /**
   * Auto-generate a human-readable summary from a tool call.
   *
   * Examples:
   *   read_file({ path: '/src/auth.ts' })       → "Reading auth.ts"
   *   write_file({ path: '/src/fix.ts' })        → "Writing fix.ts"
   *   bash({ command: 'npm test' })              → "Running npm test"
   *   search_files({ query: 'login' })           → "Searching for 'login'"
   *   git_commit({ message: 'fix: auth' })       → "Committing changes"
   *   complete_task                              → "Completing task"
   *   default                                    → "Using {toolName}"
   */
  summarizeToolCall(sessionId: string, toolName: string, args: unknown): string {
    const argsRecord = toArgs(args);

    // File reads
    if (toolName === 'read_file' || toolName === 'Read') {
      const filename = extractFilename(argsRecord['path'] ?? argsRecord['file_path']);
      return filename ? `Reading ${filename}` : 'Reading file';
    }

    // File writes
    if (toolName === 'write_file' || toolName === 'Write' || toolName === 'create_file') {
      const filename = extractFilename(argsRecord['path'] ?? argsRecord['file_path']);
      return filename ? `Writing ${filename}` : 'Writing file';
    }

    // File edits
    if (toolName === 'edit_file' || toolName === 'Edit' || toolName === 'str_replace_editor') {
      const filename = extractFilename(argsRecord['path'] ?? argsRecord['file_path']);
      return filename ? `Editing ${filename}` : 'Editing file';
    }

    // Bash/shell execution
    if (toolName === 'bash' || toolName === 'Bash' || toolName === 'execute_command' || toolName === 'run_command') {
      const cmd = extractCommand(argsRecord['command'] ?? argsRecord['cmd']);
      return cmd ? `Running ${cmd}` : 'Running command';
    }

    // File search / glob
    if (toolName === 'search_files' || toolName === 'Glob' || toolName === 'glob') {
      const query = extractQuery(argsRecord['query'] ?? argsRecord['pattern']);
      return query ? `Searching for '${query}'` : 'Searching files';
    }

    // Content search / grep
    if (toolName === 'grep' || toolName === 'Grep' || toolName === 'search_content') {
      const query = extractQuery(argsRecord['query'] ?? argsRecord['pattern']);
      return query ? `Searching for '${query}'` : 'Searching content';
    }

    // Git operations
    if (toolName === 'git_commit' || toolName === 'git_push') {
      return 'Committing changes';
    }

    if (toolName === 'git_status') {
      return 'Checking git status';
    }

    if (toolName === 'git_diff') {
      return 'Reviewing changes';
    }

    // Task completion
    if (toolName === 'complete_task') {
      return 'Completing task';
    }

    // Web fetch / browse
    if (toolName === 'web_fetch' || toolName === 'WebFetch' || toolName === 'fetch_url' || toolName === 'browse') {
      const url = argsRecord['url'] ?? argsRecord['href'];
      if (typeof url === 'string' && url.length > 0) {
        try {
          const { hostname } = new URL(url);
          return `Fetching ${hostname}`;
        } catch {
          // malformed URL - fall through to default
        }
      }
      return 'Fetching URL';
    }

    // Task tool — spawn sub-agent
    if (toolName === 'Task' || toolName === 'task') {
      return 'Spawning agent';
    }

    // Default fallback: humanize camelCase/snake_case tool name
    const humanized = toolName
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase();
    return `Using ${humanized}`;
  }

  get(sessionId: string): AgentSummary | undefined {
    return this.summaries.get(sessionId);
  }

  getAll(): AgentSummary[] {
    return Array.from(this.summaries.values());
  }

  end(sessionId: string): void {
    const existing = this.summaries.get(sessionId);
    if (existing) {
      this.broadcaster?.('agent:summary', {
        ...existing as unknown as Record<string, unknown>,
        status: 'idle',
        currentAction: 'Done',
        updatedAt: Date.now(),
        ended: true,
      });
    }
    this.summaries.delete(sessionId);
  }
}

// Singleton instance

let tracker: AgentSummaryTracker | undefined;

export function getAgentSummaryTracker(): AgentSummaryTracker {
  if (!tracker) {
    tracker = new AgentSummaryTracker();
  }
  return tracker;
}
