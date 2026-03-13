/**
 * Self-Correction & Retry Loop (Phase 19 Category 3)
 *
 * Classifies tool failures and provides retry strategies, parameter fix
 * suggestions, alternative tool recommendations, and error context for
 * the AI model. Makes every model more reliable by handling failures at
 * the system level instead of silently passing errors back.
 *
 * Items implemented:
 *   3.1 Tool failure classifier
 *   3.2 Auto-retry with exponential backoff + jitter
 *   3.3 Parameter fix suggestions
 *   3.4 Alternative tool suggestions
 *   3.5 Error context injection
 *   3.6 Correction budget tracker
 */

import type { ToolResult, ToolError } from './types.js';
import { logger } from '../../utils/logger.js';

// 3.1 - Tool Failure Classifier

/** Broad category of a tool failure - determines the correction strategy */
export type FailureType = 'retryable' | 'fixable' | 'terminal';

/** Result of classifying a tool failure */
export interface FailureClassification {
  type: FailureType;
  reason: string;
  suggestedAction: string;
}

/** HTTP status codes and error patterns that indicate a transient error */
const RETRYABLE_PATTERNS: RegExp[] = [
  /timeout/i,
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /rate.?limit/i,
  /429/,
  /502/,
  /503/,
  /504/,
  /too many requests/i,
  /service unavailable/i,
  /temporarily unavailable/i,
  /network error/i,
  /socket hang up/i,
  /connection reset/i,
];

/**
 * HTTP status codes and error patterns that indicate wrong parameters or
 * a missing resource the caller can fix without server-side changes.
 */
const FIXABLE_PATTERNS: RegExp[] = [
  /validation.*fail/i,
  /invalid.*param/i,
  /missing.*required/i,
  /parse.*error/i,
  /syntax.*error/i,
  /ZodError/i,
  /wrong.*type/i,
  /expected.*string/i,
  /expected.*number/i,
  /400/,
  /422/,
];

/**
 * Classify a ToolError into retryable / fixable / terminal.
 *
 * Priority order:
 *   1. Explicit `retryable` flag on ToolError
 *   2. Auth / permission codes  -> terminal
 *   3. Retryable patterns       -> retryable
 *   4. Fixable patterns         -> fixable
 *   5. Default                  -> terminal
 */
export function classifyFailure(
  error: ToolError,
  toolName: string,
): FailureClassification {
  const msg = `${error.code} ${error.message}`.trim();

  // Explicit retryable hint from the error itself
  if (error.retryable === true) {
    return {
      type: 'retryable',
      reason: 'Error is marked as retryable by the tool',
      suggestedAction: `Retry "${toolName}" after a short delay`,
    };
  }

  // Auth and permission failures are always terminal
  if (/401|403|EPERM|EACCES|permission denied|unauthorized|forbidden/i.test(msg)) {
    return {
      type: 'terminal',
      reason: 'Authentication or permission failure - credentials are invalid or access is denied',
      suggestedAction: 'Check credentials and permissions before attempting again',
    };
  }

  // 404 / ENOENT for file-system tools are fixable (wrong path), but for
  // web tools they are terminal (resource genuinely does not exist).
  if (/404|not found|ENOENT|no such file/i.test(msg)) {
    const isWebTool = /web_fetch|web_search|browser_navigate/i.test(toolName);
    if (isWebTool) {
      return {
        type: 'terminal',
        reason: `${toolName} returned 404 - resource does not exist at this URL`,
        suggestedAction: 'Verify the URL or use web_search to locate the correct resource',
      };
    }
    return {
      type: 'fixable',
      reason: 'File or directory not found - path is likely incorrect',
      suggestedAction: 'Use directory_tree or search_files to locate the correct path first',
    };
  }

  for (const pattern of RETRYABLE_PATTERNS) {
    if (pattern.test(msg)) {
      return {
        type: 'retryable',
        reason: `Transient error detected: ${error.message}`,
        suggestedAction: `Retry "${toolName}" after exponential backoff`,
      };
    }
  }

  for (const pattern of FIXABLE_PATTERNS) {
    if (pattern.test(msg)) {
      return {
        type: 'fixable',
        reason: `Parameter or validation error: ${error.message}`,
        suggestedAction: 'Review and correct the parameters before retrying',
      };
    }
  }

  return {
    type: 'terminal',
    reason: `Unrecoverable error in "${toolName}": ${error.message}`,
    suggestedAction: 'Consider an alternative approach or tool',
  };
}

// 3.2 - Auto-Retry with Exponential Backoff + Jitter

export interface RetryConfig {
  /** Maximum number of attempts (including the initial one). Default: 3 */
  maxAttempts: number;
  /** Initial delay in ms. Default: 1000 */
  baseDelayMs: number;
  /** Upper bound on delay in ms. Default: 10000 */
  maxDelayMs: number;
  /** Multiplier applied after each failed attempt. Default: 2 */
  backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

/**
 * Calculate the delay for the nth retry attempt (0-indexed) with full jitter.
 * Full jitter: delay = random(0, min(maxDelayMs, baseDelayMs * multiplier^attempt))
 */
function calcRetryDelay(attempt: number, config: RetryConfig): number {
  const exponential = config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt);
  const capped = Math.min(exponential, config.maxDelayMs);
  return Math.floor(Math.random() * capped);
}

/**
 * Execute `fn` with automatic exponential-backoff retries for retryable failures.
 * Respects the provided AbortSignal.
 */
export async function executeWithRetry<T>(
  fn: () => Promise<ToolResult<T>>,
  config?: Partial<RetryConfig>,
  signal?: AbortSignal,
): Promise<ToolResult<T>> {
  const cfg: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastResult: ToolResult<T> | undefined;

  for (let attempt = 0; attempt < cfg.maxAttempts; attempt++) {
    if (signal?.aborted) {
      return {
        success: false,
        error: { code: 'ABORTED', message: 'Execution aborted by caller' },
      };
    }

    lastResult = await fn();

    if (lastResult.success) {
      return lastResult;
    }

    const error = lastResult.error ?? { code: 'UNKNOWN', message: 'Unknown error' };
    const isRetryable =
      error.retryable === true ||
      RETRYABLE_PATTERNS.some((p) => p.test(`${error.code} ${error.message}`));

    if (!isRetryable || attempt === cfg.maxAttempts - 1) {
      return lastResult;
    }

    const delayMs = calcRetryDelay(attempt, cfg);
    logger.info(
      `[self-correction] Retrying after ${delayMs}ms (attempt ${attempt + 1}/${cfg.maxAttempts})`,
      { component: 'self-correction', attempt, delayMs },
    );

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('Aborted'));
      }, { once: true });
    }).catch(() => {
      /* aborted - fall through, next loop iteration checks signal */
    });
  }

  return lastResult as ToolResult<T>;
}

// 3.3 - Parameter Fix Suggestions

export interface ParameterFix {
  paramName: string;
  currentValue: unknown;
  suggestedValue: unknown;
  reason: string;
}

/**
 * Analyse the failed tool's error and current parameters to produce concrete
 * fix suggestions.  Returns an empty array when no specific fix can be inferred.
 */
export function suggestParameterFixes(
  error: ToolError,
  toolName: string,
  params: Record<string, unknown>,
): ParameterFix[] {
  const fixes: ParameterFix[] = [];
  const msg = `${error.code} ${error.message}`;

  for (const [key, value] of Object.entries(params)) {
    const strVal = typeof value === 'string' ? value : '';

    // Path doesn't exist: suggest resolving relative to cwd
    if (/ENOENT|no such file|not found/i.test(msg) && /path|file|dir/i.test(key)) {
      if (strVal && !strVal.startsWith('/') && !strVal.startsWith('~')) {
        const suggested = `${process.cwd()}/${strVal}`;
        fixes.push({
          paramName: key,
          currentValue: value,
          suggestedValue: suggested,
          reason: 'Path not found - resolved to absolute path relative to working directory',
        });
      }
    }

    // Invalid JSON string: attempt to parse and re-serialise
    if (/parse.*error|invalid.*json|syntax.*error/i.test(msg) && /json|data|body|payload/i.test(key)) {
      if (typeof value === 'string') {
        try {
          const parsed: unknown = JSON.parse(value);
          const fixed = JSON.stringify(parsed);
          if (fixed !== value) {
            fixes.push({
              paramName: key,
              currentValue: value,
              suggestedValue: fixed,
              reason: 'JSON re-serialised to fix formatting issues',
            });
          }
        } catch {
          fixes.push({
            paramName: key,
            currentValue: value,
            suggestedValue: value.replace(/'/g, '"').replace(/(\w+):/g, '"$1":'),
            reason: 'Attempted to convert single-quoted or unquoted JSON to valid JSON',
          });
        }
      }
    }

    // Wrong type: string expected but number provided (or vice-versa)
    if (/expected.*string|must be.*string/i.test(msg) && typeof value === 'number') {
      fixes.push({
        paramName: key,
        currentValue: value,
        suggestedValue: String(value),
        reason: 'Parameter must be a string - converted number to string',
      });
    }
    if (/expected.*number|must be.*number/i.test(msg) && typeof value === 'string') {
      const coerced = Number(value);
      if (!Number.isNaN(coerced)) {
        fixes.push({
          paramName: key,
          currentValue: value,
          suggestedValue: coerced,
          reason: 'Parameter must be a number - coerced from string',
        });
      }
    }

    // URL without protocol
    if (/url|endpoint|href|link/i.test(key) && typeof value === 'string') {
      if (value && !/^https?:\/\//i.test(value) && !value.startsWith('/')) {
        fixes.push({
          paramName: key,
          currentValue: value,
          suggestedValue: `https://${value}`,
          reason: 'URL missing protocol - prepended https://',
        });
      }
    }
  }

  // Missing required field: check error message for field name hints
  const missingMatch = /missing.*required.*['"`]?(\w+)['"`]?|['"`]?(\w+)['"`]? is required/i.exec(msg);
  if (missingMatch) {
    const fieldName = missingMatch[1] ?? missingMatch[2];
    if (fieldName && !(fieldName in params)) {
      fixes.push({
        paramName: fieldName,
        currentValue: undefined,
        suggestedValue: `<provide ${fieldName}>`,
        reason: `Required field "${fieldName}" is missing from the parameters`,
      });
    }
  }

  return fixes;
}

// 3.4 - Alternative Tool Suggestions

export interface AlternativeTool {
  toolName: string;
  reason: string;
  /** Maps original parameter names to the equivalent parameter name in the alternative tool */
  paramMapping: Record<string, string>;
}

/**
 * Full alternative tool mapping table.
 * Keys are the failed tool names; values are ranked alternatives with context.
 */
const ALTERNATIVE_TOOL_MAP: Record<
  string,
  Array<{ toolName: string; reason: string; paramMapping: Record<string, string>; onlyFor?: RegExp }>
> = {
  web_fetch: [
    {
      toolName: 'web_search',
      reason: 'web_fetch failed - web_search can locate the resource by keyword',
      paramMapping: { url: 'query' },
      onlyFor: /404|timeout|ETIMEDOUT|ECONNRESET/i,
    },
  ],
  exec: [
    {
      toolName: 'read_file',
      reason: 'exec failed - read_file can inspect a file without executing it',
      paramMapping: { command: 'path' },
    },
    {
      toolName: 'write_file',
      reason: 'exec failed - write_file can create or overwrite a file directly',
      paramMapping: { command: 'path' },
    },
  ],
  grep: [
    {
      toolName: 'search_files',
      reason: 'grep returned no results - search_files performs a broader recursive search',
      paramMapping: { pattern: 'query', path: 'directory' },
    },
  ],
  search_files: [
    {
      toolName: 'grep',
      reason: 'search_files failed - grep supports full regex patterns',
      paramMapping: { query: 'pattern', directory: 'path' },
    },
    {
      toolName: 'directory_tree',
      reason: 'search_files failed - directory_tree lists all paths to find the target manually',
      paramMapping: { directory: 'path' },
    },
  ],
  read_file: [
    {
      toolName: 'directory_tree',
      reason: 'read_file failed (ENOENT) - directory_tree can reveal the correct path',
      paramMapping: { path: 'path' },
      onlyFor: /ENOENT|not found|no such file/i,
    },
    {
      toolName: 'search_files',
      reason: 'read_file failed (ENOENT) - search_files can locate the file by name',
      paramMapping: { path: 'query' },
      onlyFor: /ENOENT|not found|no such file/i,
    },
  ],
  git: [
    {
      toolName: 'exec',
      reason: 'git tool failed - exec can run git commands directly with git init if needed',
      paramMapping: { subcommand: 'command' },
      onlyFor: /not a git repo|not a git repository/i,
    },
  ],
  browser_navigate: [
    {
      toolName: 'web_fetch',
      reason: 'browser_navigate timed out - web_fetch fetches the page content without a browser',
      paramMapping: { url: 'url' },
      onlyFor: /timeout|ETIMEDOUT/i,
    },
  ],
};

/**
 * Suggest alternative tools when `failedTool` cannot complete its task.
 * Filters by error context when the mapping has an `onlyFor` condition.
 */
export function suggestAlternativeTools(
  failedTool: string,
  error: ToolError,
): AlternativeTool[] {
  const candidates = ALTERNATIVE_TOOL_MAP[failedTool] ?? [];
  const errorText = `${error.code} ${error.message}`;

  return candidates
    .filter((c) => !c.onlyFor || c.onlyFor.test(errorText))
    .map(({ toolName, reason, paramMapping }) => ({ toolName, reason, paramMapping }));
}

// 3.5 - Error Context Injection

export interface ErrorContext {
  failedTool: string;
  error: string;
  attemptNumber: number;
  suggestion: string;
  alternatives: string[];
}

/**
 * Build structured error context that gets appended to the next AI prompt
 * so the model can learn from the failure and adapt its strategy.
 */
export function buildErrorContext(
  failedTool: string,
  error: ToolError,
  attemptNumber: number,
  classification: FailureClassification,
): ErrorContext {
  const alternatives = suggestAlternativeTools(failedTool, error).map((a) => a.toolName);

  return {
    failedTool,
    error: `[${error.code}] ${error.message}`,
    attemptNumber,
    suggestion: classification.suggestedAction,
    alternatives,
  };
}

/**
 * Serialise an ErrorContext into a human-readable string suitable for
 * appending to a prompt message.
 */
export function formatErrorContextForPrompt(ctx: ErrorContext): string {
  const lines = [
    `TOOL FAILURE (attempt ${ctx.attemptNumber}): "${ctx.failedTool}" failed with ${ctx.error}.`,
    `Suggestion: ${ctx.suggestion}`,
  ];
  if (ctx.alternatives.length > 0) {
    lines.push(`Alternative tools you may use instead: ${ctx.alternatives.join(', ')}.`);
  }
  return lines.join('\n');
}

// 3.6 - Correction Budget

export interface CorrectionBudget {
  maxCorrections: number;
  used: number;
  exhausted: boolean;
}

/**
 * Per-chain correction budget tracker.
 * Prevents infinite retry/correction loops by capping self-corrections at a
 * configurable limit (default: 3) per tool call chain.
 */
export class CorrectionTracker {
  private budget: CorrectionBudget;

  constructor(maxPerChain = 3) {
    this.budget = {
      maxCorrections: maxPerChain,
      used: 0,
      exhausted: false,
    };
  }

  canCorrect(): boolean {
    return !this.budget.exhausted;
  }

  recordCorrection(): void {
    if (this.budget.exhausted) return;
    this.budget.used += 1;
    this.budget.exhausted = this.budget.used >= this.budget.maxCorrections;
  }

  reset(): void {
    this.budget.used = 0;
    this.budget.exhausted = false;
  }

  getStatus(): CorrectionBudget {
    return { ...this.budget };
  }
}

// Main orchestrator

export interface SelfCorrectionResult<T> {
  result: ToolResult<T>;
  corrections: number;
  retries: number;
  errorContexts: ErrorContext[];
  alternativesSuggested: AlternativeTool[];
}

/**
 * Execute a tool with full self-correction: auto-retry for transient errors,
 * parameter fix suggestions for validation errors, alternative tool suggestions,
 * and error context injection for the AI model.
 *
 * Usage:
 * ```ts
 * const outcome = await executeWithSelfCorrection('read_file', () =>
 *   fileOpsTool.execute(ctx, { path: '/tmp/foo.txt' }),
 * );
 * if (!outcome.result.success && outcome.errorContexts.length > 0) {
 *   promptBuilder.appendSystem(formatErrorContextForPrompt(outcome.errorContexts.at(-1)!));
 * }
 * ```
 */
export async function executeWithSelfCorrection<T>(
  toolName: string,
  executor: () => Promise<ToolResult<T>>,
  options?: {
    retryConfig?: Partial<RetryConfig>;
    correctionBudget?: number;
    signal?: AbortSignal;
    onRetry?: (attempt: number, error: ToolError) => void;
    onCorrection?: (fix: ParameterFix[] | AlternativeTool[]) => void;
  },
): Promise<SelfCorrectionResult<T>> {
  const tracker = new CorrectionTracker(options?.correctionBudget ?? 3);
  const errorContexts: ErrorContext[] = [];
  const alternativesSuggested: AlternativeTool[] = [];
  let retries = 0;
  let corrections = 0;
  const attemptNumber = 1;

  // Wrap executor with retry logic for retryable failures
  const retryWrapper = async (): Promise<ToolResult<T>> => {
    const innerResult = await executor();
    if (innerResult.success) return innerResult;

    const err = innerResult.error ?? { code: 'UNKNOWN', message: 'Unknown error' };
    const cls = classifyFailure(err, toolName);

    if (cls.type === 'retryable' && tracker.canCorrect()) {
      options?.onRetry?.(attemptNumber, err);

      const retryResult = await executeWithRetry(
        executor,
        options?.retryConfig,
        options?.signal,
      );

      // Count each retry loop iteration
      const maxAttempts = options?.retryConfig?.maxAttempts ?? DEFAULT_RETRY_CONFIG.maxAttempts;
      retries += maxAttempts - 1; // at most maxAttempts-1 retries after first call

      return retryResult;
    }

    return innerResult;
  };

  const result = await retryWrapper();

  if (!result.success) {
    const err = result.error ?? { code: 'UNKNOWN', message: 'Unknown error' };
    const cls = classifyFailure(err, toolName);

    // Build error context for the AI model
    const ctx = buildErrorContext(toolName, err, attemptNumber, cls);
    errorContexts.push(ctx);
    corrections += 1;
    tracker.recordCorrection();

    // Collect alternative tool suggestions
    const alts = suggestAlternativeTools(toolName, err);
    if (alts.length > 0) {
      alternativesSuggested.push(...alts);
      options?.onCorrection?.(alts);
    }

    // For fixable errors, also produce parameter fix suggestions
    // (callers can read them via errorContexts[n] and alternativesSuggested)
    logger.error(
      `[self-correction] Tool "${toolName}" failed (${cls.type}) after ${retries} retries. Budget: ${tracker.getStatus().used}/${tracker.getStatus().maxCorrections}`,
      { component: 'self-correction', toolName, failureType: cls.type, attemptNumber },
    );
  } else {
    logger.info(
      `[self-correction] Tool "${toolName}" succeeded after ${retries} retries`,
      { component: 'self-correction', toolName, retries },
    );
  }

  return {
    result,
    corrections,
    retries,
    errorContexts,
    alternativesSuggested,
  };
}

// Legacy helpers (preserved for backward compatibility with executor.ts)

/** @deprecated Use CorrectionTracker class instead */
export type FailureClass = FailureType;

/** @deprecated Use classifyFailure() which returns FailureClassification */
export interface CorrectionStrategy {
  failureClass: FailureClass;
  shouldRetry: boolean;
  retryDelayMs: number;
  suggestedFix?: string;
  alternativeTools?: string[];
  contextForModel?: string;
}

/** Map from tool name to simple list of alternative tool names (for quick lookup) */
const TOOL_ALTERNATIVES: Record<string, string[]> = {
  web_fetch: ['web_search', 'link_understand'],
  web_search: ['web_fetch'],
  exec: ['read_file', 'directory_tree'],
  write_file: ['edit_file'],
  edit_file: ['write_file'],
  search_files: ['grep', 'directory_tree'],
  grep: ['search_files', 'read_file'],
  git_diff: ['git_status', 'git_log'],
  git_stash: ['git_status', 'git_diff'],
  browser_navigate: ['web_fetch', 'link_understand'],
  browser_click: ['browser_type', 'browser_search'],
  openai_image_gen: ['canvas_render'],
  screen_capture: ['browser_screenshot'],
};

/** @deprecated Use executeWithSelfCorrection instead */
export async function executeWithCorrection<T>(
  chainId: string,
  toolName: string,
  executeFn: () => Promise<ToolResult<T>>,
): Promise<{ result: ToolResult<T>; correctionContext?: string }> {
  // Map legacy budget using chainId
  let used = 0;
  const maxCorrections = 3;

  let result = await executeFn();
  if (result.success) return { result };

  const error = result.error ?? { code: 'UNKNOWN', message: 'Unknown error' };
  const cls = classifyFailure(error, toolName);

  if (cls.type === 'retryable' && used < maxCorrections) {
    used++;
    const delay = Math.min(1000 * Math.pow(2, used - 1), 10000);
    logger.info(`[self-correction] Retrying "${toolName}" after ${delay}ms (legacy path)`, {
      component: 'self-correction',
      toolName,
      chainId,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
    result = await executeFn();
    if (result.success) return { result };
    return { result, correctionContext: cls.suggestedAction };
  }

  const alternatives = TOOL_ALTERNATIVES[toolName];
  const context = [
    `Tool "${toolName}" failed: ${error.message}`,
    `Suggestion: ${cls.suggestedAction}`,
    alternatives?.length ? `Alternative tools: ${alternatives.join(', ')}` : '',
  ].filter(Boolean).join('\n');

  return { result, correctionContext: context };
}

/** @deprecated Use CorrectionTracker class instead */
const budgets = new Map<string, CorrectionBudget>();

/** @deprecated */
export function getCorrectionBudget(chainId: string): CorrectionBudget {
  let budget = budgets.get(chainId);
  if (!budget) {
    budget = { maxCorrections: 3, used: 0, exhausted: false };
    budgets.set(chainId, budget);
  }
  return budget;
}

/** @deprecated */
export function consumeCorrection(chainId: string): CorrectionBudget {
  const budget = getCorrectionBudget(chainId);
  budget.used += 1;
  budget.exhausted = budget.used >= budget.maxCorrections;
  budgets.set(chainId, budget);
  return budget;
}

/** @deprecated */
export function resetCorrectionBudget(chainId: string): void {
  budgets.delete(chainId);
}

/** @deprecated */
export function clearAllBudgets(): void {
  budgets.clear();
}
