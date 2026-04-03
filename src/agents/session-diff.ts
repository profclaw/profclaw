/**
 * Session Diff Tracker
 *
 * Records original file contents before the agent makes any edits so that
 * a unified diff of all changes can be produced at any time (e.g. /diff).
 */

import fs from 'node:fs/promises';

export type FileChangeStatus = 'modified' | 'created' | 'deleted';

interface TrackedFile {
  originalContent: string | null; // null = file did not exist (created)
  created: boolean;
}

let defaultTracker: SessionDiffTracker | null = null;

export class SessionDiffTracker {
  private originals: Map<string, TrackedFile>;

  constructor() {
    this.originals = new Map();
  }

  /**
   * Record the original content of a file before the agent touches it.
   * Only the first call per file path is honoured — subsequent calls are
   * ignored so the "before" state remains the pre-session state.
   */
  recordOriginal(filePath: string, content: string): void {
    if (!this.originals.has(filePath)) {
      this.originals.set(filePath, { originalContent: content, created: false });
    }
  }

  /**
   * Record that a file was created during this session (it did not exist before).
   */
  recordCreated(filePath: string): void {
    if (!this.originals.has(filePath)) {
      this.originals.set(filePath, { originalContent: null, created: true });
    }
  }

  /**
   * Generate a unified diff for all modified files.
   * Returns an empty string if nothing has changed.
   */
  async generateDiff(): Promise<string> {
    const parts: string[] = [];

    for (const filePath of this.originals.keys()) {
      const diff = await this.getFileDiff(filePath);
      if (diff) {
        parts.push(diff);
      }
    }

    return parts.join('\n');
  }

  /**
   * Return a list of changed files with their status.
   */
  getChangedFiles(): Array<{ path: string; status: FileChangeStatus }> {
    const result: Array<{ path: string; status: FileChangeStatus }> = [];

    for (const [filePath, tracked] of this.originals.entries()) {
      if (tracked.created) {
        result.push({ path: filePath, status: 'created' });
      } else {
        result.push({ path: filePath, status: 'modified' });
      }
    }

    return result;
  }

  /**
   * Generate a unified diff for a single file.
   * Returns an empty string if the file content is unchanged.
   */
  async getFileDiff(filePath: string): Promise<string> {
    const tracked = this.originals.get(filePath);
    if (!tracked) return '';

    let currentContent: string | null;
    try {
      currentContent = await fs.readFile(filePath, 'utf-8');
    } catch {
      currentContent = null;
    }

    const originalContent = tracked.originalContent ?? '';
    const newContent = currentContent ?? '';

    if (originalContent === newContent) return '';

    const aLabel = tracked.created ? '/dev/null' : `a/${filePath}`;
    const bLabel = currentContent === null ? '/dev/null' : `b/${filePath}`;

    return buildUnifiedDiff(aLabel, bLabel, originalContent, newContent);
  }
}

/**
 * Returns the process-level singleton SessionDiffTracker.
 */
export function getSessionDiffTracker(): SessionDiffTracker {
  if (!defaultTracker) {
    defaultTracker = new SessionDiffTracker();
  }
  return defaultTracker;
}

// ---------------------------------------------------------------------------
// Minimal unified diff implementation (no external dependencies)
// ---------------------------------------------------------------------------

function buildUnifiedDiff(
  aLabel: string,
  bLabel: string,
  oldText: string,
  newText: string,
): string {
  const oldLines = oldText === '' ? [] : oldText.split('\n');
  const newLines = newText === '' ? [] : newText.split('\n');

  const hunks = computeHunks(oldLines, newLines);
  if (hunks.length === 0) return '';

  const header = [`--- ${aLabel}`, `+++ ${bLabel}`];
  const body = hunks.map(renderHunk);

  return [...header, ...body].join('\n') + '\n';
}

interface Hunk {
  oldStart: number;
  oldLines: string[];
  newStart: number;
  newLines: string[];
  contextLines: Array<{ idx: number; content: string }>;
  changes: Array<{ type: '+' | '-' | ' '; content: string }>;
}

const CONTEXT = 3;

function computeHunks(
  oldLines: string[],
  newLines: string[],
): Array<{ header: string; lines: string[] }> {
  // Myers-style LCS diff
  const edit = shortestEditScript(oldLines, newLines);

  // Group edits into hunks with context
  const hunks: Array<{ header: string; lines: string[] }> = [];

  interface EditOp {
    type: '+' | '-' | '=';
    oldIdx: number;
    newIdx: number;
    content: string;
  }

  // Build flat edit list
  const ops: EditOp[] = [];
  let oi = 0;
  let ni = 0;
  for (const [type, content] of edit) {
    if (type === '=') {
      ops.push({ type: '=', oldIdx: oi, newIdx: ni, content });
      oi++;
      ni++;
    } else if (type === '-') {
      ops.push({ type: '-', oldIdx: oi, newIdx: ni, content });
      oi++;
    } else {
      ops.push({ type: '+', oldIdx: oi, newIdx: ni, content });
      ni++;
    }
  }

  // Find change ranges
  const changeIndices = ops
    .map((op, i) => (op.type !== '=' ? i : -1))
    .filter((i) => i !== -1);

  if (changeIndices.length === 0) return [];

  // Merge ranges with context into hunks
  let start = Math.max(0, changeIndices[0] - CONTEXT);
  let end = Math.min(ops.length - 1, changeIndices[0] + CONTEXT);

  const ranges: Array<[number, number]> = [];

  for (let k = 1; k < changeIndices.length; k++) {
    const ci = changeIndices[k];
    if (ci - CONTEXT <= end + 1) {
      end = Math.min(ops.length - 1, ci + CONTEXT);
    } else {
      ranges.push([start, end]);
      start = Math.max(0, ci - CONTEXT);
      end = Math.min(ops.length - 1, ci + CONTEXT);
    }
  }
  ranges.push([start, end]);

  for (const [s, e] of ranges) {
    const slice = ops.slice(s, e + 1);
    const oldStart = (slice.find((op) => op.type !== '+')?.oldIdx ?? 0) + 1;
    const newStart = (slice.find((op) => op.type !== '-')?.newIdx ?? 0) + 1;
    const oldCount = slice.filter((op) => op.type !== '+').length;
    const newCount = slice.filter((op) => op.type !== '-').length;

    const header = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
    const lines = slice.map((op) => {
      if (op.type === '=') return ` ${op.content}`;
      if (op.type === '-') return `-${op.content}`;
      return `+${op.content}`;
    });

    hunks.push({ header, lines });
  }

  return hunks;
}

function renderHunk(hunk: { header: string; lines: string[] }): string {
  return [hunk.header, ...hunk.lines].join('\n');
}

/**
 * Produce a minimal edit script using the Myers diff algorithm.
 * Returns an array of [type, line] tuples where type is '+', '-', or '='.
 */
function shortestEditScript(
  oldLines: string[],
  newLines: string[],
): Array<['+' | '-' | '=', string]> {
  const n = oldLines.length;
  const m = newLines.length;
  const max = n + m;

  if (max === 0) return [];

  // v[k] stores the furthest-reaching x position for diagonal k
  const v: number[] = new Array(2 * max + 1).fill(0);
  const trace: Array<number[]> = [];

  outer: for (let d = 0; d <= max; d++) {
    trace.push([...v]);
    for (let k = -d; k <= d; k += 2) {
      const ki = k + max;
      let x: number;
      if (k === -d || (k !== d && v[ki - 1] < v[ki + 1])) {
        x = v[ki + 1];
      } else {
        x = v[ki - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && oldLines[x] === newLines[y]) {
        x++;
        y++;
      }
      v[ki] = x;
      if (x >= n && y >= m) {
        break outer;
      }
    }
  }

  // Backtrack to reconstruct the edit path
  const edits: Array<['+' | '-' | '=', string]> = [];
  let x = n;
  let y = m;

  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const vPrev = trace[d];
    const k = x - y;
    const ki = k + max;

    let prevK: number;
    if (k === -d || (k !== d && vPrev[ki - 1] < vPrev[ki + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = vPrev[prevK + max];
    const prevY = prevX - prevK;

    while (x > prevX + 1 && y > prevY + 1) {
      edits.unshift(['=', oldLines[x - 1]]);
      x--;
      y--;
    }

    if (d > 0) {
      if (x > prevX && y > prevY) {
        edits.unshift(['=', oldLines[x - 1]]);
        x--;
        y--;
      } else if (x > prevX) {
        edits.unshift(['-', oldLines[x - 1]]);
        x--;
      } else if (y > prevY) {
        edits.unshift(['+', newLines[y - 1]]);
        y--;
      }
    }
  }

  while (x > 0) {
    edits.unshift(['-', oldLines[x - 1]]);
    x--;
  }
  while (y > 0) {
    edits.unshift(['+', newLines[y - 1]]);
    y--;
  }

  return edits;
}
