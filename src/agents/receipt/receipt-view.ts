/**
 * Receipt viewer: a terminal summary and a self-contained single-file HTML page
 * (inline CSS and JS, no external assets). Every piece of receipt data is
 * HTML-escaped, and a CSP meta tag blocks anything not inline.
 */

import { createHash } from 'node:crypto';
import type {
  AttemptEndData,
  FileChangeData,
  ReceiptEvent,
  RollbackData,
  RunEndData,
  RunStartData,
  ToolCallData,
  UsageData,
  VerifierResultData,
  VerifyResult,
} from './receipt-types.js';

// Model

export interface AttemptView {
  attempt: number;
  model?: string;
  toolCalls: ToolCallData[];
  verifier?: VerifierResultData;
  usage?: UsageData;
  rollbacks: RollbackData[];
  end?: AttemptEndData;
}

export interface ReceiptModel {
  start?: RunStartData;
  baseline?: VerifierResultData;
  attempts: AttemptView[];
  files: FileChangeData[];
  end?: RunEndData;
  startedAt?: string;
  endedAt?: string;
}

export function buildReceiptModel(events: ReceiptEvent[]): ReceiptModel {
  const model: ReceiptModel = { attempts: [], files: [] };
  const byAttempt = new Map<number, AttemptView>();
  const view = (n: number): AttemptView => {
    let a = byAttempt.get(n);
    if (!a) {
      a = { attempt: n, toolCalls: [], rollbacks: [] };
      byAttempt.set(n, a);
      model.attempts.push(a);
    }
    return a;
  };
  for (const e of events) {
    switch (e.type) {
      case 'run_start':
        model.start = e.data;
        model.startedAt = e.ts;
        break;
      case 'attempt_start':
        view(e.data.attempt).model = e.data.model;
        break;
      case 'tool_call':
        view(e.data.attempt).toolCalls.push(e.data);
        break;
      case 'file_change':
        model.files.push(e.data);
        break;
      case 'verifier_result':
        if (e.data.attempt === 0) model.baseline = e.data;
        else view(e.data.attempt).verifier = e.data;
        break;
      case 'usage': {
        const a = view(e.data.attempt);
        a.usage = e.data;
        if (!a.model && e.data.model) a.model = e.data.model;
        break;
      }
      case 'rollback':
        view(e.data.attempt).rollbacks.push(e.data);
        break;
      case 'attempt_end':
        view(e.data.attempt).end = e.data;
        break;
      case 'run_end':
        model.end = e.data;
        model.endedAt = e.ts;
        break;
    }
  }
  return model;
}

const usd = (n: number): string => `$${n.toFixed(4)}`;

// Terminal

export function renderTerminalSummary(events: ReceiptEvent[], verify?: VerifyResult): string {
  const m = buildReceiptModel(events);
  const out: string[] = [];
  if (verify) out.push(`Integrity: ${verify.ok ? 'OK' : 'FAILED'}. ${verify.message}`, '');
  if (m.start) {
    out.push(`Goal:     ${m.start.goal}`);
    out.push(`Verifier: ${m.start.verifyCommand}`);
    out.push(`Branch:   ${m.start.branch}${m.start.repoHead ? ` (from ${m.start.repoHead.slice(0, 12)})` : ''}`);
    out.push(`Tool:     ${m.start.tool.name} ${m.start.tool.version}`);
  }
  if (m.end) {
    out.push(
      `Result:   ${m.end.verified ? 'VERIFIED' : 'NOT VERIFIED'} (${m.end.stopReason}), ${m.end.totals.attempts} attempt(s), ${m.end.totals.totalTokens} tokens, ${usd(m.end.totals.costUsd)}`,
    );
  } else {
    out.push('Result:   incomplete (no run_end)');
  }
  if (m.baseline) out.push(`Baseline: ${m.baseline.passed ? 'pass' : `fail (score ${m.baseline.failureScore})`}`);
  out.push('');
  for (const a of m.attempts) {
    const bits = [`Attempt ${a.attempt}: ${a.end?.outcome ?? 'unfinished'}`];
    if (a.model) bits.push(a.model);
    if (a.verifier) bits.push(`verifier ${a.verifier.passed ? 'pass' : `fail (score ${a.verifier.failureScore})`}`);
    if (a.toolCalls.length) bits.push(`${a.toolCalls.length} tool call(s)`);
    if (a.usage) bits.push(`${a.usage.totalTokens} tokens, ${usd(a.usage.costUsd)}`);
    for (const r of a.rollbacks) bits.push(`rolled back: ${r.reason}`);
    out.push(bits.join(', '));
  }
  if (m.files.length) {
    out.push('', 'Files changed:');
    for (const f of m.files) out.push(`  ${f.status} ${f.path}`);
  }
  return out.join('\n') + '\n';
}

// HTML

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CSS = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1a1a1a;--mut:#666;--line:#ddd;--ok:#127a3a;--bad:#b3261e;--warn:#8a5a00;--code:#f5f5f5}
@media(prefers-color-scheme:dark){:root{--bg:#141414;--fg:#e8e8e8;--mut:#9a9a9a;--line:#333;--ok:#5fd08a;--bad:#ff8a80;--warn:#e0b050;--code:#1e1e1e}}
body{font:14px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg);margin:0 auto;padding:16px;max-width:960px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px}
.mut{color:var(--mut)}.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}
.card{border:1px solid var(--line);border-radius:6px;padding:10px 12px;margin:8px 0}
.row{display:flex;flex-wrap:wrap;gap:4px 16px}
pre{background:var(--code);padding:8px;overflow:auto;border-radius:4px;margin:6px 0;font:12px/1.4 ui-monospace,monospace;white-space:pre-wrap;word-break:break-word}
.add{color:var(--ok)}.del{color:var(--bad)}.hunk{color:var(--mut)}
details>summary{cursor:pointer}
table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:2px 8px 2px 0;border-bottom:1px solid var(--line);font-size:13px}
button{font:inherit;padding:2px 8px}
`;

const JS = `
document.getElementById('expand').addEventListener('click',function(){
  var open=this.getAttribute('data-open')!=='1';
  document.querySelectorAll('details').forEach(function(d){d.open=open});
  this.setAttribute('data-open',open?'1':'0');
  this.textContent=open?'Collapse all':'Expand all';
});
`;

const cspHash = (s: string): string => `'sha256-${createHash('sha256').update(s, 'utf-8').digest('base64')}'`;

function diffHtml(diff: string): string {
  return diff
    .split('\n')
    .map((line) => {
      const cls = line.startsWith('+') && !line.startsWith('+++')
        ? 'add'
        : line.startsWith('-') && !line.startsWith('---')
          ? 'del'
          : line.startsWith('@@')
            ? 'hunk'
            : '';
      const text = escapeHtml(line);
      return cls ? `<span class="${cls}">${text}</span>` : text;
    })
    .join('\n');
}

function verifierHtml(v: VerifierResultData, label: string): string {
  const cls = v.passed ? 'ok' : 'bad';
  return `<details><summary>${escapeHtml(label)}: <span class="${cls}">${v.passed ? 'PASS' : 'FAIL'}</span>, exit ${
    v.exitCode === null ? 'n/a' : escapeHtml(String(v.exitCode))
  }, score ${escapeHtml(String(v.failureScore))}${v.timedOut ? ', timed out' : ''}</summary><pre>${escapeHtml(v.output)}</pre></details>`;
}

export function renderHtml(events: ReceiptEvent[], verify?: VerifyResult): string {
  const m = buildReceiptModel(events);
  const p: string[] = [];
  const title = m.start ? `Run receipt: ${m.start.goal}` : 'Run receipt';

  p.push(`<h1>${escapeHtml(title.length > 120 ? `${title.slice(0, 117)}...` : title)}</h1>`);
  if (verify) {
    p.push(
      `<div class="card"><strong class="${verify.ok ? 'ok' : 'bad'}">Integrity: ${verify.ok ? 'OK' : 'FAILED'}</strong> <span class="mut">${escapeHtml(verify.message)}</span>${
        verify.signature.present ? ` <span class="${verify.signature.valid ? 'ok' : 'bad'}">signature ${verify.signature.valid ? 'valid' : 'invalid'}</span>` : ' <span class="mut">unsigned</span>'
      }${verify.signature.publicKey ? `<div class="mut">key ${escapeHtml(verify.signature.publicKey.slice(-24))}</div>` : ''}${verify.lastHash ? `<div class="mut">last hash ${escapeHtml(verify.lastHash)}</div>` : ''}</div>`,
    );
  } else {
    p.push('<div class="card mut">Integrity was not checked for this view.</div>');
  }

  if (m.start) {
    p.push(
      `<div class="card"><div class="row"><span>Verifier <code>${escapeHtml(m.start.verifyCommand)}</code></span><span>Branch <code>${escapeHtml(m.start.branch)}</code></span>` +
        `<span>Head <code>${escapeHtml(m.start.repoHead ?? 'unknown')}</code></span><span>${escapeHtml(m.start.tool.name)} ${escapeHtml(m.start.tool.version)}</span></div></div>`,
    );
  }
  if (m.end) {
    p.push(
      `<div class="card"><strong class="${m.end.verified ? 'ok' : 'bad'}">${m.end.verified ? 'VERIFIED' : 'NOT VERIFIED'}</strong> (${escapeHtml(m.end.stopReason)})` +
        `<div class="row mut"><span>${escapeHtml(String(m.end.totals.attempts))} attempt(s)</span><span>${escapeHtml(String(m.end.totals.totalTokens))} tokens</span>` +
        `<span>cost ${escapeHtml(usd(m.end.totals.costUsd))}</span><span>${escapeHtml(String(m.end.totals.filesChanged))} file(s) changed</span></div></div>`,
    );
  } else {
    p.push('<div class="card warn">Incomplete: no run_end event.</div>');
  }

  p.push('<h2>Timeline</h2><button id="expand" type="button" data-open="0">Expand all</button>');
  if (m.baseline) p.push(`<div class="card">${verifierHtml(m.baseline, 'Baseline (before any attempt)')}</div>`);
  for (const a of m.attempts) {
    const outcome = a.end?.outcome ?? 'unfinished';
    const cls = outcome === 'verified' ? 'ok' : outcome === 'improved' || outcome === 'unchanged' ? 'warn' : 'bad';
    const head = [`<strong>Attempt ${escapeHtml(String(a.attempt))}</strong>`, `<span class="${cls}">${escapeHtml(outcome)}</span>`];
    if (a.model) head.push(`<span class="mut">${escapeHtml(a.model)}</span>`);
    if (a.usage) head.push(`<span class="mut">${escapeHtml(String(a.usage.totalTokens))} tokens, ${escapeHtml(usd(a.usage.costUsd))}</span>`);
    const body: string[] = [];
    if (a.toolCalls.length) {
      body.push(
        `<details><summary>${escapeHtml(String(a.toolCalls.length))} tool call(s)</summary><table><tr><th>Tool</th><th>Args</th><th>ms</th><th>ok</th></tr>` +
          a.toolCalls
            .map(
              (t) =>
                `<tr><td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.argsSummary)}${t.redacted ? ' <span class="warn">(redacted)</span>' : ''}</td><td>${escapeHtml(String(Math.round(t.durationMs)))}</td><td class="${t.ok ? 'ok' : 'bad'}">${t.ok ? 'yes' : 'no'}</td></tr>`,
            )
            .join('') +
          '</table></details>',
      );
    }
    if (a.verifier) body.push(verifierHtml(a.verifier, 'Verifier'));
    for (const r of a.rollbacks) body.push(`<div class="bad">Rolled back: ${escapeHtml(r.reason)}</div>`);
    p.push(`<div class="card"><div class="row">${head.join('')}</div>${body.join('')}</div>`);
  }

  p.push('<h2>Diff</h2>');
  if (m.files.length === 0) p.push('<div class="mut">No files changed.</div>');
  for (const f of m.files) {
    const label = `${escapeHtml(f.status)} <code>${escapeHtml(f.path)}</code>`;
    const detail = f.diff !== undefined
      ? `<pre>${diffHtml(f.diff)}</pre>`
      : `<div class="mut">Diff omitted. sha256 ${escapeHtml(f.diffSha256)}</div>`;
    p.push(`<div class="card"><details open><summary>${label}${f.diffTruncated ? ' <span class="warn">(truncated)</span>' : ''}</summary>${detail}</details></div>`);
  }

  const csp = `default-src 'none'; style-src ${cspHash(CSS)}; script-src ${cspHash(JS)}; base-uri 'none'; form-action 'none'`;
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">`,
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(title.slice(0, 120))}</title>`,
    `<style>${CSS}</style></head><body>`,
    p.join('\n'),
    `<script>${JS}</script></body></html>`,
    '',
  ].join('\n');
}
