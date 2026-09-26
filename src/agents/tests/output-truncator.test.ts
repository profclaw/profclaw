import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { ResultStore } from '../result-store.js';
import {
  truncateText,
  truncateResult,
  truncateAndStore,
  readStoredRange,
  getTruncationConfig,
  isTruncationEnabled,
} from '../output-truncator.js';
import { runFetchResult } from '../../chat/meta-tool-handlers.js';

const cfg = { maxChars: 100, headRatio: 0.7, fetchMaxChars: 50 };

describe('truncateText', () => {
  it('returns short text unchanged', () => {
    expect(truncateText('abc', 100)).toEqual({ text: 'abc', truncated: false, omitted: 0 });
  });

  it('keeps head and tail with an explicit marker', () => {
    const text = 'H'.repeat(500) + 'M'.repeat(500) + 'T'.repeat(500);
    const out = truncateText(text, 100, 0.7);
    expect(out.truncated).toBe(true);
    expect(out.omitted).toBe(1400);
    expect(out.text.startsWith('H'.repeat(70))).toBe(true);
    expect(out.text.endsWith('T'.repeat(30))).toBe(true);
    expect(out.text).toContain('[truncated 1400 chars');
    expect(out.text).not.toContain('M');
  });
});

describe('truncateResult', () => {
  it('leaves small results untouched', () => {
    const r = { a: 1 };
    expect(truncateResult(r, cfg).value).toBe(r);
  });

  it('shrinks long string fields but keeps object shape', () => {
    const r = { success: true, content: 'x'.repeat(1000) };
    const out = truncateResult(r, cfg);
    expect(out.truncated).toBe(true);
    const v = out.value as { success: boolean; content: string };
    expect(v.success).toBe(true);
    expect(v.content).toContain('[truncated 900 chars');
  });

  it('falls back to JSON text truncation for huge arrays', () => {
    const r = Array.from({ length: 500 }, (_, i) => ({ i }));
    const out = truncateResult(r, cfg);
    expect(out.truncated).toBe(true);
    expect(typeof out.value).toBe('string');
    expect(out.value as string).toContain('[truncated');
  });
});

describe('store integration', () => {
  const store = new ResultStore(`trunc-test-${process.pid}`);
  afterEach(() => {
    delete process.env.PROFCLAW_TOOL_OUTPUT_MAX_CHARS;
    delete process.env.PROFCLAW_TOOL_OUTPUT_TRUNCATION;
  });
  afterAll(async () => {
    await store.cleanup();
  });

  it('stores the full result and allows range fetch', async () => {
    const big = { content: 'abcdefghij'.repeat(50) };
    const out = await truncateAndStore(store, 'call-1', big, cfg);
    expect(out.truncated).toBe(true);
    expect(JSON.stringify(out.value)).toContain('call-1');

    const range = await readStoredRange(store, 'call-1', 0, 20, cfg);
    expect(range?.content).toBe(JSON.stringify(big).slice(0, 20));
    expect(range?.hasMore).toBe(true);
    const capped = await readStoredRange(store, 'call-1', 10, 9999, cfg);
    expect(capped?.length).toBe(50);

    const viaTool = (await runFetchResult({ result_id: 'call-1', offset: 5, length: 10 }, store)) as { content: string };
    expect(viaTool.content).toBe(JSON.stringify(big).slice(5, 15));
    expect(await runFetchResult({ result_id: 'missing' }, store)).toMatchObject({ success: false });
  });

  it('does not store results that fit', async () => {
    await truncateAndStore(store, 'call-small', { a: 1 }, cfg);
    expect(store.retrieve('call-small')).toBeUndefined();
  });

  it('reads config from env', () => {
    process.env.PROFCLAW_TOOL_OUTPUT_MAX_CHARS = '777';
    expect(getTruncationConfig().maxChars).toBe(777);
    process.env.PROFCLAW_TOOL_OUTPUT_TRUNCATION = 'off';
    expect(isTruncationEnabled()).toBe(false);
  });
});
