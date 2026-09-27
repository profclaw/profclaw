/**
 * Receipt verifier: chain integrity, completeness and optional signature.
 * Reports the first bad seq and why. Spec: docs/specs/run-receipt-v0.md
 */

import { createPublicKey, verify as edVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { computeEventHash } from './receipt-writer.js';
import { GENESIS_HASH, RECEIPT_EVENT_TYPES, RECEIPT_VERSION } from './receipt-types.js';
import type { ReceiptEvent, ReceiptEventType, VerifyResult, VerifyFailureReason } from './receipt-types.js';

const HEX64 = /^[0-9a-f]{64}$/;

export interface VerifyOptions {
  /** Trusted public key (PEM, or base64 SPKI DER). If set, the receipt must be signed by it. */
  expectedPublicKey?: string;
  /** Fail an unsigned receipt. Implied by expectedPublicKey. */
  requireSignature?: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Normalise a PEM or base64 DER public key to base64 SPKI DER. */
export function normalizePublicKey(input: string): string {
  const trimmed = input.trim();
  const key = trimmed.includes('-----BEGIN')
    ? createPublicKey(trimmed)
    : createPublicKey({ key: Buffer.from(trimmed, 'base64'), format: 'der', type: 'spki' });
  return key.export({ type: 'spki', format: 'der' }).toString('base64');
}

function fail(
  events: number,
  seq: number,
  reason: VerifyFailureReason,
  message: string,
  extra: Partial<VerifyResult> = {},
): VerifyResult {
  return { ok: false, eventCount: events, firstBadSeq: seq, reason, message, signature: { present: false }, ...extra };
}

/** Structural check of one parsed line. Returns a problem description or null. */
function shapeProblem(obj: Record<string, unknown>): string | null {
  if (obj['v'] !== RECEIPT_VERSION) return `unsupported version ${JSON.stringify(obj['v'])}`;
  if (typeof obj['seq'] !== 'number' || !Number.isInteger(obj['seq'])) return 'seq is not an integer';
  if (typeof obj['ts'] !== 'string') return 'ts is not a string';
  if (typeof obj['type'] !== 'string') return 'type is not a string';
  if (!isRecord(obj['data'])) return 'data is not an object';
  if (typeof obj['prev'] !== 'string' || !HEX64.test(obj['prev'])) return 'prev is not a sha256 hex string';
  if (typeof obj['hash'] !== 'string' || !HEX64.test(obj['hash'])) return 'hash is not a sha256 hex string';
  return null;
}

/** Verify receipt text (JSON Lines). */
export function verifyReceiptText(text: string, options: VerifyOptions = {}): VerifyResult {
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length === 0) return fail(0, 0, 'empty', 'Receipt is empty: expected a run_start event at seq 0');

  let prev = GENESIS_HASH;
  let runEnd: Record<string, unknown> | undefined;
  let count = 0;

  for (let i = 0; i < lines.length; i++) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[i]);
    } catch {
      return fail(count, i, 'invalid_json', `Line ${i + 1} (seq ${i}) is not valid JSON`);
    }
    if (!isRecord(parsed)) return fail(count, i, 'invalid_event', `Line ${i + 1} (seq ${i}) is not a JSON object`);
    const problem = shapeProblem(parsed);
    if (problem) return fail(count, i, 'invalid_event', `Event at seq ${i}: ${problem}`);

    if (runEnd) {
      return fail(count, i, 'event_after_run_end', `Event at seq ${i} follows run_end`);
    }
    if (parsed['seq'] !== i) {
      return fail(
        count,
        i,
        'seq_mismatch',
        `Expected seq ${i} but found seq ${String(parsed['seq'])}: events were reordered, or one was deleted or inserted`,
      );
    }
    if (parsed['prev'] !== prev) {
      return fail(count, i, 'prev_mismatch', `seq ${i}: prev does not match the hash of seq ${i - 1}: the previous event was changed or removed`);
    }
    const expected = computeEventHash(parsed);
    if (parsed['hash'] !== expected) {
      return fail(count, i, 'hash_mismatch', `seq ${i}: hash does not match the event content: the event was edited`);
    }
    if (i === 0 && parsed['type'] !== 'run_start') {
      return fail(count, 0, 'bad_first_event', `seq 0 must be run_start, found ${String(parsed['type'])}`);
    }
    prev = parsed['hash'];
    count++;
    if (parsed['type'] === 'run_end') runEnd = parsed;
  }

  if (!runEnd) {
    return fail(count, count, 'truncated', `No run_end event after seq ${count - 1}: the receipt is truncated or the run did not finish`, {
      lastHash: prev,
    });
  }

  return checkSignature(runEnd, count, prev, options);
}

function checkSignature(runEnd: Record<string, unknown>, count: number, lastHash: string, options: VerifyOptions): VerifyResult {
  const seq = count - 1;
  const sig = runEnd['signature'];
  const wantSigned = options.requireSignature === true || options.expectedPublicKey !== undefined;

  if (sig === undefined) {
    if (wantSigned) {
      return fail(count, seq, 'unsigned', 'Receipt has no signature but one is required', { lastHash });
    }
    return { ok: true, eventCount: count, message: `Chain intact, ${count} events, run complete (unsigned)`, signature: { present: false }, lastHash };
  }

  if (!isRecord(sig) || sig['alg'] !== 'ed25519' || typeof sig['publicKey'] !== 'string' || typeof sig['sig'] !== 'string') {
    return fail(count, seq, 'bad_signature', 'run_end signature block is malformed', { lastHash, signature: { present: true, valid: false } });
  }
  const publicKey = sig['publicKey'];
  let valid = false;
  try {
    const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
    valid = edVerify(null, Buffer.from(lastHash, 'utf-8'), key, Buffer.from(sig['sig'], 'base64'));
  } catch {
    valid = false;
  }
  if (!valid) {
    return fail(count, seq, 'bad_signature', 'Signature does not verify against the last hash', {
      lastHash,
      signature: { present: true, valid: false, publicKey },
    });
  }
  if (options.expectedPublicKey !== undefined) {
    let trusted: string;
    try {
      trusted = normalizePublicKey(options.expectedPublicKey);
    } catch {
      return fail(count, seq, 'untrusted_key', 'The expected public key could not be parsed', { lastHash, signature: { present: true, valid: true, publicKey } });
    }
    if (trusted !== publicKey) {
      return fail(count, seq, 'untrusted_key', 'Signature is valid but the signing key is not the expected key', {
        lastHash,
        signature: { present: true, valid: true, publicKey },
      });
    }
  }
  return {
    ok: true,
    eventCount: count,
    message: `Chain intact, ${count} events, run complete, signature valid`,
    signature: { present: true, valid: true, publicKey },
    lastHash,
  };
}

export function verifyReceiptFile(path: string, options: VerifyOptions = {}): VerifyResult {
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch (error: unknown) {
    return fail(0, 0, 'unreadable', `Cannot read ${path}: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  return verifyReceiptText(text, options);
}

/** Parse events without verifying. For viewers; callers should verify separately. */
export function parseReceiptText(text: string): ReceiptEvent[] {
  const events: ReceiptEvent[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (isRecord(parsed) && shapeProblem(parsed) === null && isKnownType(parsed['type'])) {
      events.push(parsed as unknown as ReceiptEvent);
    }
  }
  return events;
}

function isKnownType(t: unknown): t is ReceiptEventType {
  return typeof t === 'string' && (RECEIPT_EVENT_TYPES as readonly string[]).includes(t);
}
