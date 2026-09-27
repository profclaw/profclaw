/**
 * Helpers that connect receipts to the CLI: key handling and writer setup.
 */

import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ReceiptWriter, defaultReceiptPath, loadSignerFromFile } from './receipt-writer.js';

export interface RunReceiptArgs {
  projectRoot: string;
  runId: string;
  /** --sign-key path; falls back to env PROFCLAW_RECEIPT_KEY */
  signKeyPath?: string;
  env?: NodeJS.ProcessEnv;
}

/** Create the writer for a run. Signing is off unless a key path is given. */
export function createRunReceipt(args: RunReceiptArgs): ReceiptWriter {
  const env = args.env ?? process.env;
  const keyPath = args.signKeyPath ?? (env['PROFCLAW_RECEIPT_KEY']?.trim() || undefined);
  return new ReceiptWriter({
    path: defaultReceiptPath(args.projectRoot, args.runId, env),
    signer: keyPath ? loadSignerFromFile(keyPath) : undefined,
  });
}

/** Version of the running profclaw package, or 'unknown'. */
export function toolVersion(): string {
  try {
    const pkg = createRequire(import.meta.url)('../../../package.json') as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

export interface KeyPairFiles {
  privateKeyPath: string;
  publicKeyPath: string;
}

/** Write an Ed25519 keypair into dir. The private key file is mode 0600. */
export function generateKeyPairFiles(dir: string): KeyPairFiles {
  mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const privateKeyPath = join(dir, 'receipt-key.pem');
  const publicKeyPath = join(dir, 'receipt-key.pub.pem');
  writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644, flag: 'wx' });
  return { privateKeyPath, publicKeyPath };
}

function argsSummaryChars(env: NodeJS.ProcessEnv): number {
  const n = Number(env['PROFCLAW_RECEIPT_ARGS_CHARS']);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 300;
}

/** Short one-line description of tool arguments. Long values are cut so files are not copied into the receipt. */
export function summarizeArgs(args: Record<string, unknown>, maxChars: number = 300): string {
  const perValue = Math.max(16, Math.floor(maxChars / 3));
  const parts = Object.entries(args).map(([key, value]) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value) ?? 'undefined';
    const short = text.length > perValue ? `${text.slice(0, perValue)}...(${text.length} chars)` : text;
    return `${key}=${JSON.stringify(short)}`;
  });
  const joined = parts.join(' ');
  return joined.length > maxChars ? `${joined.slice(0, maxChars)}...` : joined;
}

export interface RunReceiptSetup {
  runId: string;
  receipt?: ReceiptWriter;
  /** Hook for ExecutorRunner: records each tool call */
  onToolCall?: (event: { attempt: number; name: string; args: Record<string, unknown>; durationMs: number; ok: boolean }) => void;
}

/** Everything `profclaw run` needs to record a receipt; a no-op setup when disabled. */
export function setupRunReceipt(args: {
  enabled: boolean;
  projectRoot: string;
  signKeyPath?: string;
  env?: NodeJS.ProcessEnv;
}): RunReceiptSetup {
  const runId = randomUUID().slice(0, 8);
  if (!args.enabled) return { runId };
  const env = args.env ?? process.env;
  const receipt = createRunReceipt({ projectRoot: args.projectRoot, runId, signKeyPath: args.signKeyPath, env });
  const cap = argsSummaryChars(env);
  return {
    runId,
    receipt,
    onToolCall: (e) => {
      try {
        receipt.append('tool_call', {
          attempt: e.attempt,
          name: e.name,
          argsSummary: summarizeArgs(e.args, cap),
          redacted: false,
          durationMs: e.durationMs,
          ok: e.ok,
        });
      } catch {
        // Receipt problems must never break the agent; a missing event shows up as a bad chain or gap.
      }
    },
  };
}
