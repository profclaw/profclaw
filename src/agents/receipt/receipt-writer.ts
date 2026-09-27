/**
 * Receipt writer: append-only JSONL, canonical JSON, SHA-256 hash chaining,
 * secret redaction before hashing, optional Ed25519 signature on run_end.
 * Spec: docs/specs/run-receipt-v0.md
 */

import { createHash, createPrivateKey, createPublicKey, sign as edSign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GENESIS_HASH, RECEIPT_VERSION } from './receipt-types.js';
import type {
  ReceiptDataMap,
  ReceiptEvent,
  ReceiptEventType,
  ReceiptSignature,
  ReceiptSink,
} from './receipt-types.js';

// Canonical JSON

/** Sorted keys, no whitespace, `undefined` members dropped, non-finite numbers rejected. */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new Error('canonicalJson: non-finite number');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
      }
      const obj = value as Record<string, unknown>;
      const parts: string[] = [];
      for (const key of Object.keys(obj).sort()) {
        if (obj[key] === undefined) continue;
        parts.push(`${JSON.stringify(key)}:${canonicalJson(obj[key])}`);
      }
      return `{${parts.join(',')}}`;
    }
    default:
      throw new Error(`canonicalJson: unsupported type ${typeof value}`);
  }
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Hash of an event: canonical JSON without `hash` and `signature`. */
export function computeEventHash(event: Record<string, unknown>): string {
  const rest: Record<string, unknown> = { ...event };
  delete rest['hash'];
  delete rest['signature'];
  return sha256Hex(canonicalJson(rest));
}

// Redaction

export const REDACTED = '[REDACTED]';

const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i;

const TOKEN_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\bnpm_[A-Za-z0-9]{30,}/g,
];
const BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi;
/** NAME=value or NAME: value, where NAME looks like a secret variable. */
const ENV_ASSIGN = /\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)[A-Z0-9_]*)(\s*[=:]\s*)("[^"\n]*"|'[^'\n]*'|[^\s"',;]+)/g;

export function redactString(input: string): string {
  let out = input;
  for (const re of TOKEN_PATTERNS) out = out.replace(re, REDACTED);
  out = out.replace(BEARER, `$1${REDACTED}`);
  out = out.replace(ENV_ASSIGN, (match, name: string, sep: string, value: string) =>
    value === REDACTED || value === `"${REDACTED}"` ? match : `${name}${sep}${REDACTED}`,
  );
  return out;
}

/** Deep-redacts strings and values under secret-looking object keys. Returns the changed flag. */
export function redactValue(value: unknown): { value: unknown; changed: boolean } {
  if (typeof value === 'string') {
    const next = redactString(value);
    return { value: next, changed: next !== value };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
      const r = redactValue(item);
      changed = changed || r.changed;
      return r.value;
    });
    return { value: out, changed };
  }
  if (value !== null && typeof value === 'object') {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_NAME.test(key) && typeof v === 'string' && v !== '' && v !== REDACTED) {
        out[key] = REDACTED;
        changed = true;
        continue;
      }
      const r = redactValue(v);
      changed = changed || r.changed;
      out[key] = r.value;
    }
    return { value: out, changed };
  }
  return { value, changed: false };
}

// Signing

export interface ReceiptSigner {
  publicKey: string;
  sign(hash: string): string;
}

/** Signer from a PKCS8 PEM Ed25519 private key. */
export function createSigner(privateKeyPem: string): ReceiptSigner {
  const privateKey: KeyObject = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Receipt signing key must be Ed25519');
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64');
  return {
    publicKey,
    sign: (hash: string): string => edSign(null, Buffer.from(hash, 'utf-8'), privateKey).toString('base64'),
  };
}

export function loadSignerFromFile(path: string): ReceiptSigner {
  return createSigner(readFileSync(path, 'utf-8'));
}

// Writer

export interface ReceiptWriterOptions {
  path: string;
  signer?: ReceiptSigner;
  /** Default true. Only disable for tests of the raw chain. */
  redact?: boolean;
  now?: () => Date;
}

/** Default location: <projectRoot>/.profclaw/runs/<runId>/receipt.jsonl (env PROFCLAW_RECEIPT_PATH overrides). */
export function defaultReceiptPath(projectRoot: string, runId: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env['PROFCLAW_RECEIPT_PATH']?.trim();
  return override ? override : join(projectRoot, '.profclaw', 'runs', runId, 'receipt.jsonl');
}

export class ReceiptWriter implements ReceiptSink {
  readonly path: string;
  private seq = 0;
  private prev = GENESIS_HASH;
  private ended = false;
  private readonly signer?: ReceiptSigner;
  private readonly redact: boolean;
  private readonly now: () => Date;

  constructor(options: ReceiptWriterOptions) {
    this.path = options.path;
    this.signer = options.signer;
    this.redact = options.redact ?? true;
    this.now = options.now ?? ((): Date => new Date());
    mkdirSync(dirname(this.path), { recursive: true });
    // Append-only and one receipt per file: refuse to extend an existing file.
    if (existsSync(this.path)) throw new Error(`Receipt already exists: ${this.path}`);
    writeFileSync(this.path, '', { flag: 'wx' });
  }

  get lastHash(): string {
    return this.prev;
  }

  append<K extends ReceiptEventType>(type: K, data: ReceiptDataMap[K]): ReceiptEvent {
    if (this.ended) throw new Error('Receipt already ended (run_end written)');
    let payload: unknown = data;
    if (this.redact) {
      const r = redactValue(data);
      payload = r.value;
      if (type === 'tool_call' && r.changed) {
        (payload as Record<string, unknown>)['redacted'] = true;
      }
    }
    const base: Record<string, unknown> = {
      v: RECEIPT_VERSION,
      seq: this.seq,
      ts: this.now().toISOString(),
      type,
      data: payload,
      prev: this.prev,
    };
    const hash = computeEventHash(base);
    const event: Record<string, unknown> = { ...base, hash };
    if (type === 'run_end' && this.signer) {
      const signature: ReceiptSignature = {
        alg: 'ed25519',
        publicKey: this.signer.publicKey,
        sig: this.signer.sign(hash),
      };
      event['signature'] = signature;
    }
    // Canonical text per line; hash and signature are members like any other.
    appendFileSync(this.path, `${canonicalJson(event)}\n`, 'utf-8');
    this.seq++;
    this.prev = hash;
    if (type === 'run_end') this.ended = true;
    return event as unknown as ReceiptEvent;
  }
}
