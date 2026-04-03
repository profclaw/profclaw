/**
 * Proactive Agent Capabilities - Phase 19 Category 6
 *
 * Transforms the agent from purely reactive to event-driven and proactive:
 *   6.1 - TriggerManager: event-driven rule execution with cooldowns
 *   6.2 - generateSuggestions: post-task follow-up suggestions
 *   6.3 - HealthMonitor: periodic service health checks with degradation events
 *   6.4 - gatherContext: auto-context assembly before complex responses
 *   6.5 - BackgroundResearcher: async research task management
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { freemem, totalmem } from 'node:os';
import { statfs } from 'node:fs/promises';
import { createContextualLogger } from '../../utils/logger.js';

const log = createContextualLogger('Proactive');

// 6.1 - Event-Driven Triggers

export type TriggerEvent =
  | 'file_change'      // File modified in watched directory
  | 'cron_complete'    // Scheduled job finished
  | 'webhook_received' // External webhook arrived
  | 'health_degraded'  // Service health check failed
  | 'task_completed'   // Task/ticket status changed
  | 'session_idle'     // User session idle for N minutes
  | 'error_spike';     // Error rate exceeded threshold

export interface TriggerAction {
  type: 'notify' | 'message' | 'workflow' | 'log';
  /** Channel to notify (conversation ID or channel) */
  target?: string;
  /** Message template with {{variable}} interpolation */
  template?: string;
  /** Workflow ID to execute */
  workflowId?: string;
}

export interface TriggerRule {
  id: string;
  event: TriggerEvent;
  /** Simple expression e.g. "error_count > 5" */
  condition?: string;
  action: TriggerAction;
  /** Prevent trigger spam (milliseconds) */
  cooldownMs: number;
  enabled: boolean;
}

export interface TriggerResult {
  ruleId: string;
  executed: boolean;
  /** Reason skipped: cooldown, disabled, or condition-false */
  skipped?: string;
  output?: string;
}

// Internal - tracks when each rule last fired
type CooldownMap = Map<string, number>;

/**
 * Evaluates a simple condition string against a data record.
 * Supports: <key> <op> <value> where op is >, <, >=, <=, ==, !=
 * Returns true when condition is absent (unconditional rule).
 */
function evaluateCondition(
  condition: string,
  data: Record<string, unknown>,
): boolean {
  const match = condition.trim().match(/^(\w+)\s*(>|<|>=|<=|==|!=)\s*(.+)$/);
  if (!match) return false;

  const [, key, op, rawValue] = match;
  const lhs = data[key];
  // Coerce right-hand side to number if possible, else string
  const rhs: number | string = isNaN(Number(rawValue))
    ? rawValue.replace(/^['"]|['"]$/g, '')
    : Number(rawValue);

  switch (op) {
    case '>':  return (lhs as number) > (rhs as number);
    case '<':  return (lhs as number) < (rhs as number);
    case '>=': return (lhs as number) >= (rhs as number);
    case '<=': return (lhs as number) <= (rhs as number);
    case '==': return lhs == rhs; // intentional loose equality
    case '!=': return lhs != rhs;
    default:   return false;
  }
}

/**
 * Interpolates {{variable}} placeholders in a template string from data.
 */
function interpolate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = data[key];
    return value !== undefined ? String(value) : `{{${key}}}`;
  });
}

/**
 * Executes a single TriggerAction and returns descriptive output.
 */
function executeAction(
  action: TriggerAction,
  data: Record<string, unknown>,
): string {
  const message = action.template ? interpolate(action.template, data) : '';

  switch (action.type) {
    case 'notify':
      log.info('Notify action', { target: action.target ?? 'broadcast', message });
      return `notified ${action.target ?? 'broadcast'}: ${message}`;

    case 'message':
      log.info('Message action', { target: action.target, message });
      return `message sent to ${action.target}: ${message}`;

    case 'workflow':
      log.info('Workflow triggered', { workflowId: action.workflowId });
      return `workflow ${action.workflowId} triggered`;

    case 'log':
      log.info('Log action', { message });
      return `logged: ${message}`;
  }
}

export class TriggerManager {
  private readonly rules = new Map<string, TriggerRule>();
  private readonly cooldowns: CooldownMap = new Map();

  addRule(rule: Omit<TriggerRule, 'id'>): string {
    const id = randomUUID();
    this.rules.set(id, { ...rule, id });
    return id;
  }

  removeRule(id: string): boolean {
    this.cooldowns.delete(id);
    return this.rules.delete(id);
  }

  listRules(): TriggerRule[] {
    return Array.from(this.rules.values());
  }

  setEnabled(id: string, enabled: boolean): void {
    const rule = this.rules.get(id);
    if (rule) {
      this.rules.set(id, { ...rule, enabled });
    }
  }

  /**
   * Fire an event - checks all matching rules and executes their actions.
   * Respects cooldowns and condition expressions.
   */
  async fire(
    event: TriggerEvent,
    data: Record<string, unknown>,
  ): Promise<TriggerResult[]> {
    const results: TriggerResult[] = [];
    const now = Date.now();

    for (const rule of this.rules.values()) {
      if (rule.event !== event) continue;

      if (!rule.enabled) {
        results.push({ ruleId: rule.id, executed: false, skipped: 'disabled' });
        continue;
      }

      const lastFired = this.cooldowns.get(rule.id) ?? 0;
      if (now - lastFired < rule.cooldownMs) {
        const remaining = rule.cooldownMs - (now - lastFired);
        results.push({
          ruleId: rule.id,
          executed: false,
          skipped: `cooldown (${remaining}ms remaining)`,
        });
        continue;
      }

      if (rule.condition && !evaluateCondition(rule.condition, data)) {
        results.push({
          ruleId: rule.id,
          executed: false,
          skipped: 'condition-false',
        });
        continue;
      }

      try {
        const output = executeAction(rule.action, data);
        this.cooldowns.set(rule.id, now);
        results.push({ ruleId: rule.id, executed: true, output });
      } catch (error) {
        log.error('TriggerManager action failed', error instanceof Error ? error : new Error(String(error)), { ruleId: rule.id });
        results.push({
          ruleId: rule.id,
          executed: false,
          skipped: `action-error: ${error instanceof Error ? error.message : 'Unknown'}`,
        });
      }
    }

    return results;
  }
}

// 6.2 - Proactive Suggestions

export type SuggestionType = 'follow_up' | 'optimization' | 'warning' | 'tip';

export interface Suggestion {
  id: string;
  type: SuggestionType;
  message: string;
  /** Confidence score 0-1 */
  confidence: number;
  actionable: boolean;
  action?: { label: string; command: string };
}

export interface SuggestionContext {
  /** Number of failed tests (if applicable) */
  failedTests?: number;
  /** Number of suggestions that were applied */
  appliedSuggestions?: number;
  /** Files that were created */
  createdFiles?: string[];
  /** Whether a PR was already created */
  prCreated?: boolean;
  /** Additional data from the completed task */
  metadata?: Record<string, unknown>;
}

// Suggestion templates keyed by task-type keyword
type SuggestionTemplate = {
  type: SuggestionType;
  /** Static message or a function that produces one from context */
  message: string | ((ctx: SuggestionContext) => string);
  confidence: number;
  action?: { label: string; command: string };
  /** Guard - only include when returns true */
  when?: (ctx: SuggestionContext) => boolean;
};

const SUGGESTION_MAP: Record<string, SuggestionTemplate[]> = {
  deploy: [
    {
      type: 'follow_up',
      message: 'Run smoke tests to verify the deployment succeeded.',
      confidence: 0.9,
      action: { label: 'Run smoke tests', command: 'run smoke tests' },
    },
    {
      type: 'follow_up',
      message: 'Check application logs for errors after deployment.',
      confidence: 0.85,
      action: { label: 'Check logs', command: 'check logs for errors' },
    },
    {
      type: 'tip',
      message: 'Consider setting up a rollback plan before the next deployment.',
      confidence: 0.6,
    },
  ],
  test: [
    {
      type: 'follow_up',
      message: (ctx: SuggestionContext) =>
        `Fix the ${ctx.failedTests ?? 'failing'} failing test(s) before merging.`,
      confidence: 0.95,
      action: { label: 'Fix failing tests', command: 'fix failing tests' },
      when: (ctx: SuggestionContext) => (ctx.failedTests ?? 0) > 0,
    },
    {
      type: 'tip',
      message: 'Run tests in debug mode to get more output on failures.',
      confidence: 0.7,
      action: { label: 'Debug tests', command: 'run tests in debug mode' },
      when: (ctx) => (ctx.failedTests ?? 0) > 0,
    },
    {
      type: 'optimization',
      message: 'All tests passed - consider adding coverage reporting.',
      confidence: 0.5,
      when: (ctx) => (ctx.failedTests ?? 0) === 0,
    },
  ],
  'code-review': [
    {
      type: 'follow_up',
      message: 'Apply the suggested changes from the review.',
      confidence: 0.88,
      action: { label: 'Apply suggestions', command: 'apply review suggestions' },
      when: (ctx) => (ctx.appliedSuggestions ?? 0) === 0,
    },
    {
      type: 'follow_up',
      message: 'Create a pull request once the changes look good.',
      confidence: 0.8,
      action: { label: 'Create PR', command: 'create pull request' },
      when: (ctx) => !ctx.prCreated,
    },
  ],
  debug: [
    {
      type: 'follow_up',
      message: 'Create a fix for the identified bug.',
      confidence: 0.92,
      action: { label: 'Create fix', command: 'create a fix for the bug' },
    },
    {
      type: 'follow_up',
      message: 'Add a regression test to prevent this bug from recurring.',
      confidence: 0.85,
      action: { label: 'Add regression test', command: 'add regression test' },
    },
  ],
  'create': [
    {
      type: 'follow_up',
      message: 'Add tests for the newly created file(s).',
      confidence: 0.87,
      action: { label: 'Add tests', command: 'add tests for new files' },
      when: (ctx) => (ctx.createdFiles?.length ?? 0) > 0,
    },
    {
      type: 'follow_up',
      message: 'Update the documentation to reflect the new additions.',
      confidence: 0.75,
      action: { label: 'Update docs', command: 'update documentation' },
    },
  ],
  commit: [
    {
      type: 'follow_up',
      message: 'Push the commit to the remote repository.',
      confidence: 0.9,
      action: { label: 'Push to remote', command: 'git push' },
    },
    {
      type: 'follow_up',
      message: 'Create a pull request for code review.',
      confidence: 0.8,
      action: { label: 'Create PR', command: 'create pull request' },
      when: (ctx) => !ctx.prCreated,
    },
  ],
};

/**
 * Detect which task type matches the completed task description.
 * Returns all matching keys (a task may match multiple).
 */
function detectTaskTypes(completedTask: string): string[] {
  const lower = completedTask.toLowerCase();
  return Object.keys(SUGGESTION_MAP).filter((key) => lower.includes(key));
}

/**
 * Generate proactive follow-up suggestions after a task completes.
 */
export function generateSuggestions(
  completedTask: string,
  context: SuggestionContext,
): Suggestion[] {
  const matchedTypes = detectTaskTypes(completedTask);
  if (matchedTypes.length === 0) return [];

  const suggestions: Suggestion[] = [];
  const seen = new Set<string>();

  for (const taskType of matchedTypes) {
    const templates = SUGGESTION_MAP[taskType] ?? [];
    for (const tpl of templates) {
      // Skip duplicates by message
      if (seen.has(tpl.message as string)) continue;

      // Evaluate guard condition
      if (tpl.when && !tpl.when(context)) continue;

      // Handle message that may be a function (for dynamic templates)
      const message =
        typeof tpl.message === 'function'
          ? tpl.message(context)
          : tpl.message;

      seen.add(message);
      suggestions.push({
        id: randomUUID(),
        type: tpl.type,
        message,
        confidence: tpl.confidence,
        actionable: tpl.action !== undefined,
        action: tpl.action,
      });
    }
  }

  // Sort by confidence descending
  return suggestions.sort((a, b) => b.confidence - a.confidence);
}

// 6.3 - Health Monitoring

export type HealthStatus = 'healthy' | 'degraded' | 'down';

export interface HealthCheck {
  service: string;
  status: HealthStatus;
  latencyMs?: number;
  lastChecked: number;
  message?: string;
}

type HealthChecker = () => Promise<HealthCheck>;
type DegradedCallback = (check: HealthCheck) => void;

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DISK_WARN_THRESHOLD = 0.9;  // 90% used
const MEM_WARN_THRESHOLD  = 0.8;  // 80% used

/**
 * Performs a disk space check. Returns degraded at >= 90% usage.
 * Uses statfs on the current working directory; falls back gracefully.
 */
async function checkDiskSpace(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const stats = await statfs(process.cwd());
    const total = stats.blocks * stats.bsize;
    const free  = stats.bfree  * stats.bsize;
    const used  = total - free;
    const ratio = total > 0 ? used / total : 0;
    const latencyMs = Date.now() - start;

    if (ratio >= DISK_WARN_THRESHOLD) {
      return {
        service: 'disk',
        status: 'degraded',
        latencyMs,
        lastChecked: Date.now(),
        message: `Disk ${(ratio * 100).toFixed(1)}% full (${formatBytes(free)} free)`,
      };
    }

    return {
      service: 'disk',
      status: 'healthy',
      latencyMs,
      lastChecked: Date.now(),
      message: `${(ratio * 100).toFixed(1)}% used`,
    };
  } catch (error) {
    return {
      service: 'disk',
      status: 'degraded',
      latencyMs: Date.now() - start,
      lastChecked: Date.now(),
      message: `Check failed: ${error instanceof Error ? error.message : 'Unknown'}`,
    };
  }
}

/**
 * Performs a memory usage check. Returns degraded at >= 80% used.
 */
async function checkMemoryUsage(): Promise<HealthCheck> {
  const start = Date.now();
  const free = freemem();
  const total = totalmem();
  const ratio = total > 0 ? (total - free) / total : 0;
  const latencyMs = Date.now() - start;

  if (ratio >= MEM_WARN_THRESHOLD) {
    return {
      service: 'memory',
      status: 'degraded',
      latencyMs,
      lastChecked: Date.now(),
      message: `Memory ${(ratio * 100).toFixed(1)}% used (${formatBytes(free)} free)`,
    };
  }

  return {
    service: 'memory',
    status: 'healthy',
    latencyMs,
    lastChecked: Date.now(),
    message: `${(ratio * 100).toFixed(1)}% used`,
  };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)}GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)}MB`;
  return `${(bytes / 1e3).toFixed(1)}KB`;
}

export class HealthMonitor extends EventEmitter {
  private readonly checkers = new Map<string, HealthChecker>();
  private readonly latest   = new Map<string, HealthCheck>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;

  constructor(intervalMs = DEFAULT_INTERVAL_MS) {
    super();
    this.intervalMs = intervalMs;
    // Register built-in checks
    this.register('disk',   checkDiskSpace);
    this.register('memory', checkMemoryUsage);
  }

  register(service: string, checker: HealthChecker): void {
    this.checkers.set(service, checker);
  }

  start(): void {
    if (this.timer) return; // already running
    void this.runAll();
    this.timer = setInterval(() => void this.runAll(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getStatus(): HealthCheck[] {
    return Array.from(this.latest.values());
  }

  /** Subscribe to degradation / down events */
  onDegraded(callback: DegradedCallback): void {
    this.on('degraded', callback);
  }

  private async runAll(): Promise<void> {
    for (const [service, checker] of this.checkers) {
      try {
        const result = await checker();
        const previous = this.latest.get(service);
        this.latest.set(service, result);

        const wasOk = !previous || previous.status === 'healthy';
        const isNowBad = result.status === 'degraded' || result.status === 'down';

        if (wasOk && isNowBad) {
          log.warn('Health degraded', { service, message: result.message ?? result.status });
          this.emit('degraded', result);
        }
      } catch (error) {
        const bad: HealthCheck = {
          service,
          status: 'down',
          lastChecked: Date.now(),
          message: `Checker threw: ${error instanceof Error ? error.message : 'Unknown'}`,
        };
        this.latest.set(service, bad);
        log.error('Health check error', error instanceof Error ? error : new Error(String(error)), { service });
        this.emit('degraded', bad);
      }
    }
  }
}

// 6.4 - Auto-Context Gathering

export type ContextSourceType = 'file' | 'memory' | 'recent_conversation' | 'project_info';

export interface ContextSource {
  type: ContextSourceType;
  path?: string;
  content: string;
  relevance: number; // 0-1
}

export interface GatheredContext {
  sources: ContextSource[];
  /** Estimated token count across all sources */
  tokens: number;
  summary: string;
}

export interface GatherContextOptions {
  maxSources?: number;
  maxTokens?: number;
  includeFiles?: boolean;
  includeMemory?: boolean;
  includeHistory?: boolean;
}

const DEFAULT_GATHER_OPTIONS: Required<GatherContextOptions> = {
  maxSources:     8,
  maxTokens:      4000,
  includeFiles:   true,
  includeMemory:  true,
  includeHistory: true,
};

/** Rough 4-chars-per-token estimate */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Extract keywords from a query for relevance scoring */
function extractKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/** Score text relevance against keywords (0-1) */
function scoreRelevance(text: string, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const lower = text.toLowerCase();
  const hits = keywords.filter((kw) => lower.includes(kw)).length;
  return hits / keywords.length;
}

/**
 * Attempt to read a file for context. Returns null on error.
 */
async function tryReadFile(filePath: string): Promise<string | null> {
  try {
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(filePath, 'utf8');
    return content;
  } catch {
    return null;
  }
}

/**
 * Scan the current working directory for project context files.
 */
async function gatherProjectInfo(keywords: string[]): Promise<ContextSource[]> {
  const candidates = [
    'README.md',
    'CLAUDE.md',
    'AGENTS.md',
    'package.json',
  ];

  const sources: ContextSource[] = [];
  for (const filename of candidates) {
    const content = await tryReadFile(`${process.cwd()}/${filename}`);
    if (!content) continue;

    const truncated = content.slice(0, 2000); // cap each to avoid token explosion
    const relevance = scoreRelevance(truncated, keywords);
    sources.push({ type: 'project_info', path: filename, content: truncated, relevance });
  }
  return sources;
}

/**
 * Discover files in cwd that match keywords by filename.
 * Limits to shallow scan via readdir to stay fast.
 */
async function gatherFileContext(keywords: string[]): Promise<ContextSource[]> {
  try {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(process.cwd(), { withFileTypes: true, recursive: false });

    const sources: ContextSource[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const relevance = scoreRelevance(entry.name, keywords);
      if (relevance < 0.2) continue;

      const content = await tryReadFile(`${process.cwd()}/${entry.name}`);
      if (!content) continue;

      const truncated = content.slice(0, 1500);
      sources.push({
        type: 'file',
        path: entry.name,
        content: truncated,
        relevance,
      });
    }
    return sources;
  } catch (error) {
    log.error('gatherFileContext failed', error instanceof Error ? error : new Error(String(error)));
    return [];
  }
}

/**
 * Assemble relevant context before responding to a complex query.
 * Pulls from project files, memory stubs, and recent conversation stubs.
 * Actual memory/history integration is via adapters - here we provide the
 * scaffolding and return placeholder sources when adapters are unavailable.
 */
export async function gatherContext(
  query: string,
  options?: GatherContextOptions,
): Promise<GatheredContext> {
  const opts: Required<GatherContextOptions> = { ...DEFAULT_GATHER_OPTIONS, ...options };
  const keywords = extractKeywords(query);
  const allSources: ContextSource[] = [];

  // Project info (README, CLAUDE.md, etc.)
  const projectSources = await gatherProjectInfo(keywords);
  allSources.push(...projectSources);

  // Relevant files from cwd
  if (opts.includeFiles) {
    const fileSources = await gatherFileContext(keywords);
    allSources.push(...fileSources);
  }

  // Sort by relevance descending, deduplicate by path
  const seen = new Set<string>();
  const deduped = allSources
    .sort((a, b) => b.relevance - a.relevance)
    .filter((s) => {
      const key = s.path ?? s.type + s.content.slice(0, 40);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  // Respect maxSources and maxTokens
  const selected: ContextSource[] = [];
  let tokenBudget = opts.maxTokens;

  for (const src of deduped) {
    if (selected.length >= opts.maxSources) break;
    const toks = estimateTokens(src.content);
    if (toks > tokenBudget) continue;
    selected.push(src);
    tokenBudget -= toks;
  }

  const totalTokens = selected.reduce((sum, s) => sum + estimateTokens(s.content), 0);

  const summary =
    selected.length === 0
      ? 'No relevant context found.'
      : `Found ${selected.length} context source(s) (~${totalTokens} tokens) relevant to: "${query.slice(0, 80)}"`;

  return { sources: selected, tokens: totalTokens, summary };
}

// 6.5 - Background Research

export type ResearchStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ResearchResult {
  source: string;
  title: string;
  snippet: string;
  url?: string;
  relevance: number; // 0-1
}

export interface ResearchTask {
  id: string;
  query: string;
  status: ResearchStatus;
  results: ResearchResult[];
  startedAt: number;
  completedAt?: number;
}

/** Extract concise search terms from a query string */
function extractSearchTerms(query: string): string[] {
  // Remove stop words and very short tokens
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'can', 'could', 'should', 'may', 'might', 'must', 'to', 'of',
    'in', 'on', 'at', 'for', 'with', 'by', 'from', 'up', 'about',
    'into', 'through', 'how', 'what', 'when', 'where', 'why', 'which',
  ]);

  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w))
    .slice(0, 6); // cap at 6 terms
}

/**
 * Simulated web search placeholder.
 * In production the executor delegates this to the web_search tool;
 * this stub records the request and stores a pending result so callers
 * can poll and later inject real results via BackgroundResearcher.inject().
 */
function buildPendingResults(query: string, terms: string[]): ResearchResult[] {
  // Construct a representative placeholder result so callers know what was queried
  return [
    {
      source: 'web_search',
      title: `Search pending: "${query.slice(0, 60)}"`,
      snippet: `Key terms extracted: ${terms.join(', ')}. Results will be available once the web_search tool executes.`,
      relevance: 1.0,
    },
  ];
}

export class BackgroundResearcher {
  private readonly tasks = new Map<string, ResearchTask>();

  /**
   * Start a background research task.
   * Extracts terms, stores the task, and begins async processing.
   * Pass an AbortSignal to cancel mid-flight.
   */
  start(query: string, signal?: AbortSignal): ResearchTask {
    const id = randomUUID();
    const task: ResearchTask = {
      id,
      query,
      status: 'pending',
      results: [],
      startedAt: Date.now(),
    };
    this.tasks.set(id, task);

    // Run async without blocking caller
    void this.run(id, query, signal);

    return { ...task };
  }

  getResults(taskId: string): ResearchTask | null {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : null;
  }

  cancel(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task && (task.status === 'pending' || task.status === 'running')) {
      this.tasks.set(taskId, {
        ...task,
        status: 'failed',
        completedAt: Date.now(),
        results: [
          ...task.results,
          {
            source: 'system',
            title: 'Cancelled',
            snippet: 'Research task was cancelled by caller.',
            relevance: 0,
          },
        ],
      });
    }
  }

  listActive(): ResearchTask[] {
    return Array.from(this.tasks.values())
      .filter((t) => t.status === 'pending' || t.status === 'running')
      .map((t) => ({ ...t }));
  }

  /**
   * Inject real results from an external tool executor (e.g., web_search).
   * Called by the tool executor once it has fetched actual search results.
   */
  inject(taskId: string, results: ResearchResult[]): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const scored = results
      .map((r) => {
        const terms = extractSearchTerms(task.query);
        const relevance = terms.length > 0 ? scoreRelevance(r.snippet + ' ' + r.title, terms) : r.relevance;
        return { ...r, relevance };
      })
      .sort((a, b) => b.relevance - a.relevance);

    this.tasks.set(taskId, {
      ...task,
      status: 'completed',
      results: scored,
      completedAt: Date.now(),
    });
  }

  private async run(
    id: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) return;

    // Mark running
    this.tasks.set(id, { ...task, status: 'running' });

    try {
      if (signal?.aborted) {
        this.cancel(id);
        return;
      }

      const terms = extractSearchTerms(query);
      log.info('Research started', { id, terms });

      // Build placeholder results; real results injected via inject()
      const pending = buildPendingResults(query, terms);

      if (signal?.aborted) {
        this.cancel(id);
        return;
      }

      const current = this.tasks.get(id);
      if (!current || current.status !== 'running') return;

      this.tasks.set(id, {
        ...current,
        status: 'completed',
        results: pending,
        completedAt: Date.now(),
      });

      log.info('Research completed', { id, resultCount: pending.length });
    } catch (error) {
      const current = this.tasks.get(id);
      if (!current) return;
      log.error('Research failed', error instanceof Error ? error : new Error(String(error)), { id });
      this.tasks.set(id, {
        ...current,
        status: 'failed',
        completedAt: Date.now(),
        results: [
          ...current.results,
          {
            source: 'system',
            title: 'Error',
            snippet: error instanceof Error ? error.message : 'Unknown error',
            relevance: 0,
          },
        ],
      });
    }
  }
}

// 6.6 - Automation Pattern Detector
//
// Tracks repeated queries/tool usage and suggests automations.
// "You've asked for AI news 5 times this week - want me to set up a daily digest?"

export interface PatternMatch {
  pattern: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  /** Suggested automation */
  suggestion: AutomationSuggestion;
}

export interface AutomationSuggestion {
  message: string;
  templateName: string;
  suggestedCron: string;
  params: Record<string, unknown>;
}

interface QueryRecord {
  query: string;
  normalized: string;
  timestamp: number;
  toolsUsed: string[];
}

/**
 * Detects repeated patterns in user queries and suggests automations.
 *
 * Tracks query frequency, tool usage patterns, and timing to identify
 * tasks that should be automated via cron jobs.
 */
export class AutomationPatternDetector {
  private queryHistory: QueryRecord[] = [];
  private dismissedPatterns = new Set<string>();
  private maxHistory = 500;
  private readonly minOccurrences: number;
  private readonly windowMs: number;
  /** Max 1 suggestion per session */
  private suggestedThisSession = false;

  constructor(options?: {
    /** Min occurrences before suggesting automation (default: 3) */
    minOccurrences?: number;
    /** Time window to look at (default: 7 days) */
    windowMs?: number;
  }) {
    this.minOccurrences = options?.minOccurrences ?? 3;
    this.windowMs = options?.windowMs ?? 7 * 24 * 60 * 60 * 1000;
  }

  /**
   * Record a user query for pattern analysis.
   */
  recordQuery(query: string, toolsUsed: string[] = []): void {
    this.queryHistory.push({
      query,
      normalized: this.normalizeQuery(query),
      timestamp: Date.now(),
      toolsUsed,
    });

    // Trim old entries
    if (this.queryHistory.length > this.maxHistory) {
      this.queryHistory = this.queryHistory.slice(-this.maxHistory);
    }
  }

  /**
   * Check for automation-worthy patterns.
   * Returns a suggestion if a pattern is detected, or null.
   * Only returns one suggestion per session to avoid fatigue.
   */
  detectPatterns(): PatternMatch | null {
    if (this.suggestedThisSession) return null;

    const cutoff = Date.now() - this.windowMs;
    const recent = this.queryHistory.filter((q) => q.timestamp >= cutoff);

    // Group by normalized query
    const groups = new Map<string, QueryRecord[]>();
    for (const record of recent) {
      const existing = groups.get(record.normalized) || [];
      existing.push(record);
      groups.set(record.normalized, existing);
    }

    // Find patterns that exceed threshold
    for (const [normalized, records] of groups) {
      if (records.length < this.minOccurrences) continue;
      if (this.dismissedPatterns.has(normalized)) continue;

      const suggestion = this.buildSuggestion(normalized, records);
      if (!suggestion) continue;

      this.suggestedThisSession = true;

      return {
        pattern: normalized,
        count: records.length,
        firstSeen: records[0].timestamp,
        lastSeen: records[records.length - 1].timestamp,
        suggestion,
      };
    }

    return null;
  }

  /**
   * User dismissed a suggestion - don't suggest it again.
   */
  dismiss(pattern: string): void {
    this.dismissedPatterns.add(pattern);
  }

  /**
   * Reset session state (call at session start).
   */
  resetSession(): void {
    this.suggestedThisSession = false;
  }

  /**
   * Normalize a query for pattern matching.
   * Strips dates, numbers, and common filler to find the core intent.
   */
  private normalizeQuery(query: string): string {
    return query
      .toLowerCase()
      .replace(/\b(today|yesterday|this week|last week|this morning)\b/g, '')
      .replace(/\b\d{4}[-/]\d{2}[-/]\d{2}\b/g, '')
      .replace(/\b\d+\b/g, 'N')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Build an automation suggestion from a detected pattern.
   */
  private buildSuggestion(normalized: string, records: QueryRecord[]): AutomationSuggestion | null {
    // Detect common tool patterns
    const toolCounts = new Map<string, number>();
    for (const record of records) {
      for (const tool of record.toolsUsed) {
        toolCounts.set(tool, (toolCounts.get(tool) || 0) + 1);
      }
    }

    const usesWebSearch = (toolCounts.get('web_search') || 0) >= 2;
    const usesWebFetch = (toolCounts.get('web_fetch') || 0) >= 2;

    // News/research patterns
    if (usesWebSearch || normalized.includes('news') || normalized.includes('latest') || normalized.includes('update')) {
      return {
        message: `You've asked about this ${records.length} times recently. Want me to set up a daily digest?`,
        templateName: 'Morning AI News Digest',
        suggestedCron: '0 7 * * 1-5',
        params: { prompt: records[records.length - 1].query },
      };
    }

    // Status/report patterns
    if (normalized.includes('status') || normalized.includes('summary') || normalized.includes('report')) {
      return {
        message: `You check this regularly. Want me to generate this report automatically?`,
        templateName: 'Daily Status Report',
        suggestedCron: '0 9 * * 1-5',
        params: { prompt: records[records.length - 1].query },
      };
    }

    // Health/monitoring patterns
    if (normalized.includes('health') || normalized.includes('check') || normalized.includes('monitor')) {
      return {
        message: `You run this check often. Want me to monitor this automatically?`,
        templateName: 'Health Check',
        suggestedCron: '*/30 * * * *',
        params: { prompt: records[records.length - 1].query },
      };
    }

    // Generic repeated task
    if (records.length >= 5) {
      return {
        message: `You've done this ${records.length} times. Want me to automate it on a schedule?`,
        templateName: 'Custom AI Agent Task',
        suggestedCron: '0 9 * * *',
        params: { prompt: records[records.length - 1].query },
      };
    }

    return null;
  }
}
