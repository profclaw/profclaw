/**
 * Tool Output Truncator
 *
 * Caps large tool results (file reads, command output, logs, web content) to a
 * configurable char budget before they reach the model. The head and the tail
 * are kept (errors and summaries usually live at the end), the middle is
 * replaced by an explicit marker, and the full result is kept in the
 * ResultStore so the model can fetch a range with `fetch_result`.
 */

import { readFile } from 'node:fs/promises';
import type { ResultStore } from './result-store.js';

// Configuration (env driven)

export interface TruncationConfig {
  /** Max chars of a result sent to the model */
  maxChars: number;
  /** Fraction of the budget spent on the head (rest goes to the tail) */
  headRatio: number;
  /** Max chars returned by a single fetch_result call */
  fetchMaxChars: number;
}

const DEFAULT_MAX_CHARS = 12_000;
const DEFAULT_HEAD_RATIO = 0.7;

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getTruncationConfig(): TruncationConfig {
  const maxChars = readPositiveInt('PROFCLAW_TOOL_OUTPUT_MAX_CHARS', DEFAULT_MAX_CHARS);
  const rawRatio = Number.parseFloat(process.env.PROFCLAW_TOOL_OUTPUT_HEAD_RATIO ?? '');
  const headRatio = Number.isFinite(rawRatio) && rawRatio > 0 && rawRatio < 1 ? rawRatio : DEFAULT_HEAD_RATIO;
  return {
    maxChars,
    headRatio,
    fetchMaxChars: readPositiveInt('PROFCLAW_TOOL_FETCH_MAX_CHARS', maxChars),
  };
}

/** Truncation is on unless PROFCLAW_TOOL_OUTPUT_TRUNCATION is off/0/false/no. */
export function isTruncationEnabled(): boolean {
  const flag = (process.env.PROFCLAW_TOOL_OUTPUT_TRUNCATION ?? '').toLowerCase();
  return !['off', '0', 'false', 'no'].includes(flag);
}

// Text truncation

export interface TruncatedText {
  text: string;
  truncated: boolean;
  /** Number of chars removed from the middle */
  omitted: number;
}

/**
 * Keep the head and tail of `text`, replacing the middle with a marker.
 */
export function truncateText(
  text: string,
  maxChars: number,
  headRatio: number = DEFAULT_HEAD_RATIO,
  hint = '',
): TruncatedText {
  if (text.length <= maxChars) {
    return { text, truncated: false, omitted: 0 };
  }
  const headLen = Math.floor(maxChars * headRatio);
  const tailLen = Math.max(0, maxChars - headLen);
  const omitted = text.length - headLen - tailLen;
  const marker = `\n[truncated ${omitted} chars${hint ? `. ${hint}` : ''}]\n`;
  const tail = tailLen > 0 ? text.slice(text.length - tailLen) : '';
  return { text: text.slice(0, headLen) + marker + tail, truncated: true, omitted };
}

// Structured truncation

export interface TruncatedResult {
  /** Value to hand to the model (original reference when nothing was cut) */
  value: unknown;
  truncated: boolean;
  omitted: number;
}

function shrinkStrings(
  value: unknown,
  maxChars: number,
  headRatio: number,
  hint: string,
  stats: { omitted: number },
  depth: number,
): unknown {
  if (typeof value === 'string') {
    const t = truncateText(value, maxChars, headRatio, hint);
    stats.omitted += t.omitted;
    return t.text;
  }
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((v) => shrinkStrings(v, maxChars, headRatio, hint, stats, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = shrinkStrings(v, maxChars, headRatio, hint, stats, depth + 1);
  }
  return out;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

/**
 * Truncate an arbitrary tool result. Long string fields are shortened in place
 * so the object shape survives; if the whole payload is still over budget
 * (e.g. a huge array), it falls back to truncating the JSON text.
 */
export function truncateResult(
  result: unknown,
  config: TruncationConfig = getTruncationConfig(),
  hint = '',
): TruncatedResult {
  const serialized = typeof result === 'string' ? result : safeStringify(result);
  if (serialized.length <= config.maxChars) {
    return { value: result, truncated: false, omitted: 0 };
  }

  if (typeof result === 'string') {
    const t = truncateText(result, config.maxChars, config.headRatio, hint);
    return { value: t.text, truncated: true, omitted: t.omitted };
  }

  const stats = { omitted: 0 };
  const shrunk = shrinkStrings(result, config.maxChars, config.headRatio, hint, stats, 0);
  const shrunkSerialized = safeStringify(shrunk);
  if (shrunkSerialized.length <= config.maxChars * 1.25 + 256 && stats.omitted > 0) {
    return { value: shrunk, truncated: true, omitted: stats.omitted };
  }

  const t = truncateText(serialized, config.maxChars, config.headRatio, hint);
  return { value: t.text, truncated: true, omitted: t.omitted };
}

// Store integration

/**
 * Truncate `result` if needed. When truncation happens the FULL result is
 * saved in `store` under `toolCallId` so `fetch_result` can page through it.
 */
export async function truncateAndStore(
  store: ResultStore,
  toolCallId: string,
  result: unknown,
  config: TruncationConfig = getTruncationConfig(),
): Promise<TruncatedResult> {
  const hint = `full output saved as result_id "${toolCallId}", call fetch_result with offset/length`;
  const truncated = truncateResult(result, config, hint);
  if (truncated.truncated) {
    await store.store(toolCallId, result);
  }
  return truncated;
}

export interface ResultRange {
  resultId: string;
  offset: number;
  length: number;
  totalChars: number;
  content: string;
  hasMore: boolean;
}

/** Read a char range of a stored full result (JSON text of the original). */
export async function readStoredRange(
  store: ResultStore,
  resultId: string,
  offset: number,
  length: number,
  config: TruncationConfig = getTruncationConfig(),
): Promise<ResultRange | null> {
  const stored = store.retrieve(resultId);
  if (!stored) return null;

  const full = stored.fullPath ? await readFile(stored.fullPath, 'utf8') : stored.inline;
  const start = Math.max(0, Math.min(offset, full.length));
  const len = Math.max(1, Math.min(length, config.fetchMaxChars));
  const content = full.slice(start, start + len);
  return {
    resultId,
    offset: start,
    length: content.length,
    totalChars: full.length,
    content,
    hasMore: start + content.length < full.length,
  };
}
