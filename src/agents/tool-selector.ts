/**
 * Tool Selector
 *
 * Sends only the tool schemas that are likely needed on a given turn instead
 * of every registered tool. Selection is a cheap, deterministic heuristic (no
 * LLM call): a small core set, plus groups whose keywords appear in the user
 * message or whose tools were used recently. The model can request more groups
 * with the `load_tools` meta-tool.
 *
 * Cache stability: within a session the set of loaded groups only grows, and
 * the output is always sorted by tool name, so the tool prefix of the prompt
 * stays byte-identical between turns unless a new group is genuinely needed.
 *
 * Env:
 *   PROFCLAW_TOOL_SELECTION           off/0/false/no disables (default on)
 *   PROFCLAW_TOOL_SELECTION_MIN_TOOLS skip selection when the tool count is at
 *                                     or below this number (default 12)
 *   PROFCLAW_TOOL_SELECTION_KEEP_UNGROUPED
 *                                     keep tools that match no group, such as
 *                                     MCP or plugin tools (default true)
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Types

export interface SelectableTool {
  name: string;
  description: string;
  parameters: unknown;
}

export interface ToolGroup {
  name: string;
  description: string;
  /** Exact tool names, or prefixes ending in `*` */
  tools: string[];
  /** Matched against the lowercased user message */
  keywords: RegExp;
}

export const LOAD_TOOLS_NAME = 'load_tools';
export const FETCH_RESULT_NAME = 'fetch_result';

/** Tools that are always sent. Keep this small. */
export const CORE_TOOL_NAMES: readonly string[] = [
  'read_file',
  'write_file',
  'edit_file',
  'search_files',
  'grep',
  'exec',
  'complete_task',
];

// Groups

export const TOOL_GROUPS: readonly ToolGroup[] = [
  {
    name: 'git',
    description: 'git status/diff/log/branch/stash/remote/commit, PRs',
    tools: ['git_*', 'create_pr', 'github_pr'],
    keywords: /\b(git|commit|branch|stash|rebase|merge|diff|pull request|pr|github|checkout|push)\b/,
  },
  {
    name: 'dev',
    description: 'run tests, lint, build, typecheck, format, REPL, project info',
    tools: ['test_run', 'lint', 'build', 'format', 'typecheck', 'project_info', 'repl_execute'],
    keywords: /\b(test|tests|lint|build|compile|typecheck|type check|tsc|format|prettier|eslint|repl|ci)\b/,
  },
  {
    name: 'files_extra',
    description: 'directory tree, multi-file patch, patch apply, image analysis',
    tools: ['directory_tree', 'multi_patch', 'patch_apply', 'image_analyze'],
    keywords: /\b(tree|directory|folder|patch|refactor|rename|image|screenshot|picture|photo)\b/,
  },
  {
    name: 'web',
    description: 'web search, fetch a URL, understand a link',
    tools: ['web_fetch', 'web_search', 'link_understand'],
    keywords: /(https?:\/\/|\b(web|website|url|link|search online|google|internet|news|latest|docs?|documentation|browse)\b)/,
  },
  {
    name: 'browser',
    description: 'browser automation: navigate, click, fill, screenshot',
    tools: ['browser_*'],
    keywords: /\b(browser|playwright|click|navigate|scrape|webpage|web page|page)\b/,
  },
  {
    name: 'memory',
    description: 'search and read long-term memory',
    tools: ['memory_*'],
    keywords: /\b(memory|memories|remember|recall|earlier|previous(ly)?|last time|we discussed)\b/,
  },
  {
    name: 'tasks',
    description: 'tickets, projects, todos, task decomposition',
    tools: [
      'create_ticket', 'update_ticket', 'get_ticket', 'list_tickets',
      'create_project', 'list_projects', 'todo_read', 'todo_write', 'decompose_task',
    ],
    keywords: /\b(ticket|tickets|project|projects|todo|todos|task list|backlog|issue|decompose|plan)\b/,
  },
  {
    name: 'sessions',
    description: 'sessions, sub-agents, agent messaging',
    tools: [
      'sessions_*', 'list_sessions', 'spawn_session', 'send_message', 'receive_messages',
      'agents_list', 'session_status', 'subagent_orchestrate',
    ],
    keywords: /\b(session|sessions|agent|agents|sub-?agent|spawn|delegate|orchestrate|parallel)\b/,
  },
  {
    name: 'cron',
    description: 'scheduled jobs: create, list, pause, trigger, delete',
    tools: ['cron_*'],
    keywords: /\b(cron|schedule|scheduled|recurring|every (day|hour|week|minute)|daily|hourly|timer)\b/,
  },
  {
    name: 'feeds',
    description: 'RSS/feed subscriptions and digests',
    tools: ['feed_*'],
    keywords: /\b(feed|feeds|rss|atom|digest|subscribe|newsletter)\b/,
  },
  {
    name: 'messaging',
    description: 'Slack, Discord, Telegram, notifications, clipboard',
    tools: ['slack_actions', 'discord_actions', 'telegram_actions', 'notify', 'clipboard_*'],
    keywords: /\b(slack|discord|telegram|notify|notification|clipboard|copy to|paste)\b/,
  },
  {
    name: 'media',
    description: 'image generation, text to speech, canvas',
    tools: ['openai_image_gen', 'tts_speak', 'canvas_*'],
    keywords: /\b(generate an? image|image generation|draw|illustrat\w*|tts|speak|speech|voice|audio|canvas|render)\b/,
  },
  {
    name: 'system',
    description: 'system info, env vars, processes, which, path info, db maintenance',
    tools: ['system_info', 'env', 'env_vars', 'process_list', 'path_info', 'which', 'db_maintenance'],
    keywords: /\b(system|env|environment|process|processes|cpu|memory usage|disk|port|installed|which|path|maintenance|vacuum)\b/,
  },
];

// Config

function isOff(value: string | undefined): boolean {
  return ['off', '0', 'false', 'no'].includes((value ?? '').toLowerCase());
}

export function isToolSelectionEnabled(): boolean {
  return !isOff(process.env.PROFCLAW_TOOL_SELECTION);
}

function minToolsThreshold(): number {
  const parsed = Number.parseInt(process.env.PROFCLAW_TOOL_SELECTION_MIN_TOOLS ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 12;
}

function keepUngrouped(): boolean {
  return !isOff(process.env.PROFCLAW_TOOL_SELECTION_KEEP_UNGROUPED);
}

// Matching helpers

function matchesPattern(name: string, pattern: string): boolean {
  return pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern;
}

/** Group name a tool belongs to, or undefined for core/ungrouped tools. */
export function groupOfTool(name: string): string | undefined {
  for (const group of TOOL_GROUPS) {
    if (group.tools.some((p) => matchesPattern(name, p))) return group.name;
  }
  return undefined;
}

function isCore(name: string): boolean {
  return CORE_TOOL_NAMES.includes(name) || name === LOAD_TOOLS_NAME || name === FETCH_RESULT_NAME;
}

// Session state

export class ToolSelectorSession {
  /** Groups loaded so far. Only ever grows, which keeps the prefix stable. */
  private readonly loaded = new Set<string>();

  getLoadedGroups(): string[] {
    return Array.from(this.loaded).sort();
  }

  /** Mark groups loaded. Returns the names that were valid. */
  loadGroups(names: string[]): string[] {
    const valid: string[] = [];
    for (const raw of names) {
      const name = raw.trim().toLowerCase();
      if (TOOL_GROUPS.some((g) => g.name === name)) {
        this.loaded.add(name);
        valid.push(name);
      }
    }
    return valid;
  }

  /** Keep the group of a tool that was just executed loaded. */
  noteToolUse(toolName: string): void {
    const group = groupOfTool(toolName);
    if (group) this.loaded.add(group);
  }

  /** Add groups whose keywords match the user message. */
  noteMessage(message: string): string[] {
    const text = message.toLowerCase();
    const hit: string[] = [];
    for (const group of TOOL_GROUPS) {
      if (group.keywords.test(text)) {
        this.loaded.add(group.name);
        hit.push(group.name);
      }
    }
    return hit;
  }

  /**
   * Select tools for this turn. Output is sorted by name and, apart from
   * newly loaded groups, identical across calls in the same session.
   */
  select<T extends SelectableTool>(all: readonly T[], message = ''): T[] {
    if (!isToolSelectionEnabled() || all.length <= minToolsThreshold()) {
      return [...all].sort(byName);
    }
    if (message) this.noteMessage(message);

    const keepOther = keepUngrouped();
    const picked = all.filter((tool) => {
      if (isCore(tool.name)) return true;
      const group = groupOfTool(tool.name);
      if (group === undefined) return keepOther;
      return this.loaded.has(group);
    });
    return picked.sort(byName);
  }
}

function byName(a: SelectableTool, b: SelectableTool): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

// Session registry (keyed by conversation)

const MAX_SESSIONS = 500;
const sessions = new Map<string, ToolSelectorSession>();

export function getToolSelectorSession(sessionId: string): ToolSelectorSession {
  let session = sessions.get(sessionId);
  if (!session) {
    if (sessions.size >= MAX_SESSIONS) {
      const oldest = sessions.keys().next().value;
      if (oldest !== undefined) sessions.delete(oldest);
    }
    session = new ToolSelectorSession();
    sessions.set(sessionId, session);
  }
  return session;
}

export function resetToolSelectorSessions(): void {
  sessions.clear();
}

// Meta tools

const LoadToolsSchema = z.object({
  groups: z.array(z.string()).describe('Group names to load'),
  invoke: z
    .object({ tool: z.string(), args: z.record(z.string(), z.unknown()).optional() })
    .optional()
    .describe('Optionally call one of the loaded tools right now'),
});

const FetchResultSchema = z.object({
  result_id: z.string(),
  offset: z.number().int().min(0).optional(),
  length: z.number().int().min(1).optional(),
});

export type LoadToolsArgs = z.infer<typeof LoadToolsSchema>;
export type FetchResultArgs = z.infer<typeof FetchResultSchema>;

export function parseLoadToolsArgs(args: unknown): LoadToolsArgs | null {
  const parsed = LoadToolsSchema.safeParse(args);
  return parsed.success ? parsed.data : null;
}

export function parseFetchResultArgs(args: unknown): FetchResultArgs | null {
  const parsed = FetchResultSchema.safeParse(args);
  return parsed.success ? parsed.data : null;
}

/** Stable, compact meta-tool definitions. Description text must not vary. */
export function getMetaTools(includeFetchResult: boolean): SelectableTool[] {
  const groupList = TOOL_GROUPS.map((g) => `${g.name} (${g.description})`).join('; ');
  const tools: SelectableTool[] = [
    {
      name: LOAD_TOOLS_NAME,
      description:
        `Load more tool groups when you need a tool you do not have. Groups: ${groupList}. ` +
        'Returns the tool schemas; they are available from the next turn, or use invoke to call one now.',
      parameters: LoadToolsSchema,
    },
  ];
  if (includeFetchResult) {
    tools.push({
      name: FETCH_RESULT_NAME,
      description: 'Read a char range of a truncated tool result by its result_id.',
      parameters: FetchResultSchema,
    });
  }
  return tools;
}

// Token estimate

/** Rough tokens for one tool schema as sent to the provider (about 4 chars per token). */
export function estimateToolTokens(tool: SelectableTool): number {
  let schema = '{}';
  try {
    schema = JSON.stringify(
      zodToJsonSchema(tool.parameters as z.ZodType, { $refStrategy: 'none' }),
    );
  } catch {
    // fall through with an empty schema
  }
  return Math.ceil((tool.name.length + tool.description.length + schema.length) / 4);
}

export function estimateToolsTokens(tools: readonly SelectableTool[]): number {
  return tools.reduce((sum, t) => sum + estimateToolTokens(t), 0);
}

/** Compact JSON schema for a tool, used in load_tools results. */
export function describeTool(tool: SelectableTool): { name: string; description: string; parameters: unknown } {
  let parameters: unknown = {};
  try {
    parameters = zodToJsonSchema(tool.parameters as z.ZodType, { $refStrategy: 'none' });
  } catch {
    // keep empty schema
  }
  return { name: tool.name, description: tool.description, parameters };
}

/** Tools belonging to a named group, sorted by name. */
export function toolsInGroup<T extends SelectableTool>(all: readonly T[], groupName: string): T[] {
  const group = TOOL_GROUPS.find((g) => g.name === groupName);
  if (!group) return [];
  return all.filter((t) => group.tools.some((p) => matchesPattern(t.name, p))).sort(byName);
}

// Request-level entry point

/**
 * Select tools for one agentic request and append the meta-tools. When
 * selection is disabled the input list is returned unchanged.
 */
export function selectToolsForRequest<T extends SelectableTool>(
  tools: readonly T[],
  sessionId: string,
  message: string,
): Array<T | SelectableTool> {
  if (!isToolSelectionEnabled() || tools.length <= minToolsThreshold()) {
    return [...tools];
  }
  const session = getToolSelectorSession(sessionId);
  const selected = session.select(tools, message);
  const withMeta: Array<T | SelectableTool> = [...selected, ...getMetaTools(true)];
  return withMeta.sort(byName);
}
