/**
 * Verifier
 *
 * Runs a user-provided verification command (tests, typecheck, lint, build or
 * anything custom) as an objective judge of "done". The command is the only
 * shell input: goal text and model output are never interpolated into it.
 *
 * Safety conventions:
 *  - runs with cwd pinned to the run's worktree
 *  - hard timeout, process group is killed on expiry
 *  - captured output is capped in memory and trimmed for feedback
 *  - a small denylist rejects commands that publish or destroy (git push,
 *    gh pr create, rm -rf /, curl | sh) because a verifier must only observe
 */

import { spawn } from 'node:child_process';

// Types

export interface VerifierResult {
  passed: boolean;
  /** Exit code, or null when killed by timeout or signal */
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  /** Trimmed combined stdout + stderr, suitable for feeding back to an agent */
  output: string;
  /** True when the raw output was longer than the trimmed output */
  truncated: boolean;
}

export interface VerifierOptions {
  cwd: string;
  timeoutMs: number;
  /** Max characters of output kept for feedback (head and tail are kept) */
  maxOutputChars: number;
  env?: NodeJS.ProcessEnv;
}

/** Anything that can judge a workspace. Tests inject fakes. */
export interface Verifier {
  verify(): Promise<VerifierResult>;
}

// Command policy

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bgit\b[^;&|\n]*\bpush\b/, reason: 'git push is not allowed in a verifier' },
  { pattern: /\bgh\s+pr\s+(?:create|merge)\b/, reason: 'opening or merging PRs is not allowed in a verifier' },
  { pattern: /\brm\s+(?:-\S*\s+)*-\S*[rR]\S*\s+(?:-\S+\s+)*(?:\/|~|\$HOME)(?:\s|$)/, reason: 'destructive rm is not allowed in a verifier' },
  { pattern: /\b(?:curl|wget)\b[^|;&]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/, reason: 'piping downloads into a shell is not allowed' },
  { pattern: /\bsudo\b/, reason: 'sudo is not allowed in a verifier' },
];

/** Returns a rejection reason, or null when the command is acceptable. */
export function validateVerifyCommand(command: string): string | null {
  if (command.trim().length === 0) return 'verify command is empty';
  if (command.includes('\0')) return 'verify command contains a NUL byte';
  for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
    if (pattern.test(command)) return reason;
  }
  return null;
}

// Output trimming

/**
 * Keep the head and tail of long output (failures usually name the problem
 * at the top and summarise at the bottom) and drop the middle.
 */
export function trimOutput(raw: string, maxChars: number): { text: string; truncated: boolean } {
  const cleaned = stripAnsi(raw).trim();
  if (cleaned.length <= maxChars) return { text: cleaned, truncated: false };
  const marker = '\n... [output trimmed] ...\n';
  const budget = Math.max(0, maxChars - marker.length);
  const head = Math.ceil(budget * 0.4);
  const tail = budget - head;
  return {
    text: cleaned.slice(0, head) + marker + (tail > 0 ? cleaned.slice(-tail) : ''),
    truncated: true,
  };
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

// Command verifier

export class CommandVerifier implements Verifier {
  constructor(
    private readonly command: string,
    private readonly options: VerifierOptions,
  ) {}

  async verify(): Promise<VerifierResult> {
    const rejection = validateVerifyCommand(this.command);
    if (rejection) {
      return {
        passed: false,
        exitCode: null,
        timedOut: false,
        durationMs: 0,
        output: `Verifier rejected: ${rejection}`,
        truncated: false,
      };
    }
    return runCommand(this.command, this.options);
  }
}

// Cap on raw bytes retained in memory regardless of trim setting.
const RAW_CAPTURE_LIMIT = 2_000_000;

function runCommand(command: string, options: VerifierOptions): Promise<VerifierResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    let buffer = '';
    let rawTruncated = false;
    let timedOut = false;
    let settled = false;

    const child = spawn('/bin/sh', ['-c', command], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env, CI: process.env.CI ?? '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    const append = (chunk: Buffer): void => {
      if (buffer.length >= RAW_CAPTURE_LIMIT) {
        rawTruncated = true;
        return;
      }
      buffer += chunk.toString('utf-8');
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);

    const killGroup = (): void => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, options.timeoutMs);

    const finish = (exitCode: number | null, extra?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const trimmed = trimOutput(buffer + (extra ?? ''), options.maxOutputChars);
      const output = timedOut
        ? `${trimmed.text}\n[verifier timed out after ${options.timeoutMs}ms]`.trim()
        : trimmed.text;
      resolve({
        passed: exitCode === 0 && !timedOut,
        exitCode,
        timedOut,
        durationMs: Date.now() - started,
        output,
        truncated: trimmed.truncated || rawTruncated,
      });
    };

    child.on('error', (err: Error) => finish(null, `\n${err.message}`));
    child.on('close', (code: number | null) => finish(code));
  });
}

/** Format a result as feedback text for the next agent attempt. */
export function formatFailureFeedback(result: VerifierResult, command: string): string {
  const status = result.timedOut
    ? 'timed out'
    : `exited with code ${result.exitCode === null ? 'unknown' : result.exitCode}`;
  return [
    `The verification command \`${command}\` ${status}.`,
    'Output (trimmed):',
    '```',
    result.output,
    '```',
    'Fix the underlying problem so the command passes. Do not edit the verification command or weaken tests to force a pass.',
  ].join('\n');
}
