import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ReceiptWriter,
  canonicalJson,
  computeEventHash,
  createSigner,
  redactString,
  redactValue,
  sha256Hex,
} from '../receipt-writer.js';
import { verifyReceiptText } from '../receipt-verify.js';
import { parseReceiptText } from '../receipt-verify.js';
import { renderHtml, renderTerminalSummary } from '../receipt-view.js';
import { generateKeyPairFiles, summarizeArgs } from '../receipt-cli.js';
import { GENESIS_HASH } from '../receipt-types.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'receipt-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

let n = 0;
const fixedNow = (): Date => new Date(Date.UTC(2026, 0, 1, 0, 0, n++));

function writeSample(path: string, opts: { signer?: ReturnType<typeof createSigner>; goal?: string; diff?: string; end?: boolean } = {}): string[] {
  const w = new ReceiptWriter({ path, signer: opts.signer, now: fixedNow });
  w.append('run_start', {
    goal: opts.goal ?? 'fix it',
    verifyCommand: 'pnpm test',
    repoHead: 'abc123',
    branch: 'profclaw/run-x',
    tool: { name: 'profclaw', version: '1.0.0' },
  });
  w.append('verifier_result', { attempt: 0, command: 'pnpm test', exitCode: 1, passed: false, output: 'FAIL a', failureScore: 1 });
  w.append('attempt_start', { attempt: 1, model: 'm1' });
  w.append('tool_call', { attempt: 1, name: 'bash', argsSummary: 'command="ls"', redacted: false, durationMs: 5, ok: true });
  w.append('usage', { attempt: 1, inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 15, costUsd: 0.001 });
  w.append('verifier_result', { attempt: 1, command: 'pnpm test', exitCode: 0, passed: true, output: 'ok', failureScore: 0 });
  w.append('attempt_end', { attempt: 1, outcome: 'verified', rolledBack: false });
  const diff = opts.diff ?? '--- a\n+++ b\n@@\n-x\n+y';
  w.append('file_change', { path: 'a.js', status: 'modified', beforeSha256: sha256Hex('x'), afterSha256: sha256Hex('y'), diffSha256: sha256Hex(diff), diff });
  if (opts.end !== false) {
    w.append('run_end', { stopReason: 'verified', verified: true, totals: { attempts: 1, totalTokens: 15, costUsd: 0.001, filesChanged: 1 } });
  }
  return [];
}

async function lines(path: string): Promise<string[]> {
  return (await readFile(path, 'utf-8')).split('\n').filter((l) => l !== '');
}

describe('canonical JSON and chain', () => {
  it('sorts keys, drops undefined and rejects non-finite numbers', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: undefined }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"z":1}]},"b":1}');
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
  });

  it('chains events: seq, prev, and a hash equal to sha256 of the canonical event without hash', async () => {
    const path = join(dir, 'r.jsonl');
    writeSample(path);
    const events = (await lines(path)).map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(events[0]['prev']).toBe(GENESIS_HASH);
    events.forEach((e, i) => {
      expect(e['seq']).toBe(i);
      if (i > 0) expect(e['prev']).toBe(events[i - 1]['hash']);
      const { hash, ...rest } = e;
      expect(hash).toBe(sha256Hex(canonicalJson(rest)));
      expect(hash).toBe(computeEventHash(e));
    });
    const res = verifyReceiptText(await readFile(path, 'utf-8'));
    expect(res.ok).toBe(true);
    expect(res.eventCount).toBe(events.length);
  });

  it('refuses to reopen an existing receipt and to append after run_end', async () => {
    const path = join(dir, 'r.jsonl');
    writeSample(path);
    expect(() => new ReceiptWriter({ path })).toThrow(/already exists/);
    const w = new ReceiptWriter({ path: join(dir, 'b.jsonl') });
    w.append('run_end', { stopReason: 'x', verified: false, totals: { attempts: 0, totalTokens: 0, costUsd: 0, filesChanged: 0 } });
    expect(() => w.append('rollback', { attempt: 1, reason: 'r' })).toThrow();
  });
});

describe('tamper detection', () => {
  async function sample(): Promise<string[]> {
    const path = join(dir, 'r.jsonl');
    writeSample(path);
    return lines(path);
  }
  const check = (ls: string[]) => verifyReceiptText(ls.join('\n') + '\n');

  it('detects an edited field at that seq', async () => {
    const ls = await sample();
    ls[3] = ls[3].replace('"ok":true', '"ok":false');
    const r = check(ls);
    expect(r.ok).toBe(false);
    expect(r.firstBadSeq).toBe(3);
    expect(r.reason).toBe('hash_mismatch');
  });

  it('detects an edit with a recomputed hash at the next seq', async () => {
    const ls = await sample();
    const e = JSON.parse(ls[3]) as Record<string, unknown>;
    (e['data'] as Record<string, unknown>)['ok'] = false;
    e['hash'] = computeEventHash(e);
    ls[3] = JSON.stringify(e);
    const r = check(ls);
    expect(r.firstBadSeq).toBe(4);
    expect(r.reason).toBe('prev_mismatch');
  });

  it('detects two reordered lines', async () => {
    const ls = await sample();
    [ls[2], ls[3]] = [ls[3], ls[2]];
    const r = check(ls);
    expect(r.ok).toBe(false);
    expect(r.firstBadSeq).toBe(2);
    expect(r.reason).toBe('seq_mismatch');
  });

  it('detects a deleted middle line', async () => {
    const ls = await sample();
    ls.splice(4, 1);
    const r = check(ls);
    expect(r.firstBadSeq).toBe(4);
    expect(r.reason).toBe('seq_mismatch');
  });

  it('detects a deleted last line only because run_end is required', async () => {
    const ls = await sample();
    ls.pop();
    const r = check(ls);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('truncated');
    expect(r.firstBadSeq).toBe(ls.length);
  });

  it('flags a receipt that never wrote run_end, an empty file, and events after run_end', async () => {
    const path = join(dir, 'open.jsonl');
    writeSample(path, { end: false });
    expect(verifyReceiptText(await readFile(path, 'utf-8')).reason).toBe('truncated');
    expect(verifyReceiptText('').reason).toBe('empty');
    const ls = await sample();
    const extra = JSON.parse(ls[ls.length - 1]) as Record<string, unknown>;
    extra['seq'] = ls.length;
    extra['prev'] = extra['hash'];
    extra['type'] = 'rollback';
    extra['data'] = { attempt: 1, reason: 'x' };
    extra['hash'] = computeEventHash(extra);
    delete extra['signature'];
    const r = check([...ls, JSON.stringify(extra)]);
    expect(r.reason).toBe('event_after_run_end');
  });

  it('reports garbage lines as invalid_json at their seq', async () => {
    const ls = await sample();
    ls[2] = '{not json';
    const r = check(ls);
    expect(r.firstBadSeq).toBe(2);
    expect(r.reason).toBe('invalid_json');
  });
});

describe('redaction', () => {
  it('redacts common token shapes and env-style secrets', () => {
    const cases = [
      'key sk-ant-api03-abcdefghijklmnopqrstuv',
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'AKIAABCDEFGHIJKLMNOP',
      'Authorization: Bearer abcdef1234567890xyz',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk',
      'xoxb-1234567890-abcdefghij',
    ];
    for (const c of cases) {
      const out = redactString(c);
      expect(out).toContain('[REDACTED]');
      expect(out).not.toMatch(/abcdefghijklmnop|AKIAABCD|eyJhbGci|1234567890-abc/);
    }
    expect(redactString('API_KEY=hunter2 and DB_PASSWORD="p w" ok')).toBe('API_KEY=[REDACTED] and DB_PASSWORD=[REDACTED] ok');
    expect(redactString('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----')).toBe('[REDACTED]');
    expect(redactString('tokens: 100 and PATH=/usr/bin')).toBe('tokens: 100 and PATH=/usr/bin');
  });

  it('redacts secret-named object keys deeply and reports change', () => {
    const r = redactValue({ a: { apiKey: 'abc', n: 1 }, list: ['SECRET_X=1'] });
    expect(r.changed).toBe(true);
    expect(JSON.stringify(r.value)).not.toMatch(/abc|SECRET_X=1/);
  });

  it('redacts before hashing, so the chain covers the redacted text and stays valid', async () => {
    const path = join(dir, 'r.jsonl');
    const w = new ReceiptWriter({ path });
    w.append('run_start', { goal: 'use OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwx', verifyCommand: 'x', repoHead: null, branch: 'b', tool: { name: 't', version: '1' } });
    w.append('tool_call', { attempt: 1, name: 'bash', argsSummary: 'export GH_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123', redacted: false, durationMs: 1, ok: true });
    w.append('run_end', { stopReason: 's', verified: false, totals: { attempts: 1, totalTokens: 0, costUsd: 0, filesChanged: 0 } });
    const text = await readFile(path, 'utf-8');
    expect(text).not.toMatch(/sk-abcdef|ghp_abcdef/);
    expect(text).toContain('[REDACTED]');
    const tool = JSON.parse(text.split('\n')[1]) as { data: { redacted: boolean } };
    expect(tool.data.redacted).toBe(true);
    expect(verifyReceiptText(text).ok).toBe(true);
  });
});

describe('signatures', () => {
  function keypair() {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    return {
      signer: createSigner(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()),
      pubPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    };
  }

  it('accepts a valid signature and a pinned matching key', async () => {
    const path = join(dir, 's.jsonl');
    const { signer, pubPem } = keypair();
    writeSample(path, { signer });
    const text = await readFile(path, 'utf-8');
    const r = verifyReceiptText(text);
    expect(r.ok).toBe(true);
    expect(r.signature).toMatchObject({ present: true, valid: true });
    expect(verifyReceiptText(text, { expectedPublicKey: pubPem }).ok).toBe(true);
    expect(verifyReceiptText(text, { expectedPublicKey: signer.publicKey }).ok).toBe(true);
  });

  it('rejects a wrong pinned key, a forged signature, and a stripped signature when required', async () => {
    const path = join(dir, 's.jsonl');
    const { signer } = keypair();
    writeSample(path, { signer });
    const text = await readFile(path, 'utf-8');
    expect(verifyReceiptText(text, { expectedPublicKey: keypair().pubPem }).reason).toBe('untrusted_key');

    const ls = text.split('\n').filter((l) => l !== '');
    const last = JSON.parse(ls[ls.length - 1]) as { signature: { sig: string } };
    const other = keypair().signer;
    last.signature.sig = other.sign('0'.repeat(64));
    ls[ls.length - 1] = JSON.stringify(last);
    const forged = verifyReceiptText(ls.join('\n'));
    expect(forged.ok).toBe(false);
    expect(forged.reason).toBe('bad_signature');
    expect(forged.signature.valid).toBe(false);

    delete (last as { signature?: unknown }).signature;
    ls[ls.length - 1] = JSON.stringify(last);
    expect(verifyReceiptText(ls.join('\n')).ok).toBe(true);
    expect(verifyReceiptText(ls.join('\n'), { requireSignature: true }).reason).toBe('unsigned');
  });

  it('unsigned by default', async () => {
    const path = join(dir, 'u.jsonl');
    writeSample(path);
    const r = verifyReceiptText(await readFile(path, 'utf-8'));
    expect(r.signature.present).toBe(false);
    expect(r.ok).toBe(true);
  });

  it('keygen writes a private key with mode 0600 that can sign', async () => {
    const files = generateKeyPairFiles(join(dir, 'keys'));
    const mode = (await stat(files.privateKeyPath)).mode & 0o777;
    expect(mode).toBe(0o600);
    const signer = createSigner(await readFile(files.privateKeyPath, 'utf-8'));
    const path = join(dir, 'k.jsonl');
    writeSample(path, { signer });
    const text = await readFile(path, 'utf-8');
    expect(verifyReceiptText(text, { expectedPublicKey: await readFile(files.publicKeyPath, 'utf-8') }).ok).toBe(true);
  });
});

describe('viewers', () => {
  it('escapes script injection in goal, diff, verifier output and tool args', async () => {
    const evil = '<script>alert(1)</script>';
    const path = join(dir, 'x.jsonl');
    const w = new ReceiptWriter({ path });
    w.append('run_start', { goal: evil, verifyCommand: evil, repoHead: evil, branch: '"><img src=x onerror=alert(2)>', tool: { name: evil, version: '1' } });
    w.append('attempt_start', { attempt: 1, model: evil });
    w.append('tool_call', { attempt: 1, name: evil, argsSummary: evil, redacted: false, durationMs: 1, ok: true });
    w.append('verifier_result', { attempt: 1, command: evil, exitCode: 1, passed: false, output: evil, failureScore: 1 });
    const diff = `--- a\n+++ b\n+${evil}\n-<img src=x onerror=alert(3)>`;
    w.append('file_change', { path: evil, status: 'modified', beforeSha256: null, afterSha256: null, diffSha256: sha256Hex(diff), diff });
    w.append('rollback', { attempt: 1, reason: evil });
    w.append('attempt_end', { attempt: 1, outcome: 'worse', rolledBack: true });
    w.append('run_end', { stopReason: evil, verified: false, totals: { attempts: 1, totalTokens: 0, costUsd: 0, filesChanged: 1 } });
    const text = await readFile(path, 'utf-8');
    const events = parseReceiptText(text);
    const html = renderHtml(events, verifyReceiptText(text));

    // The only <script> is the viewer's own.
    expect(html.match(/<script/gi)?.length).toBe(1);
    expect(html).not.toContain(evil);
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain('Content-Security-Policy');
    expect(renderTerminalSummary(events)).toContain('Goal:');
  });

  it('shows integrity failure and incomplete runs', async () => {
    const path = join(dir, 'i.jsonl');
    writeSample(path, { end: false });
    const text = await readFile(path, 'utf-8');
    const html = renderHtml(parseReceiptText(text), verifyReceiptText(text));
    expect(html).toContain('Integrity: FAILED');
    expect(html).toContain('no run_end');
  });

  it('summarizes long tool args without copying content', () => {
    const s = summarizeArgs({ path: 'a.txt', content: 'x'.repeat(5000) }, 200);
    expect(s.length).toBeLessThan(260);
    expect(s).toContain('5000 chars');
  });
});

// keep writeFile import used for future fixtures
void writeFile;
