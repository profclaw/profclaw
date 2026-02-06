import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  classifyFailure,
  suggestParameterFixes,
  suggestAlternativeTools,
  buildErrorContext,
  formatErrorContextForPrompt,
  CorrectionTracker,
  executeWithRetry,
} from '../self-correction.js';
import type { ToolError } from '../types.js';

// =============================================================================
// 3.1 - classifyFailure
// =============================================================================

describe('classifyFailure', () => {
  describe('explicit retryable flag', () => {
    it('returns retryable when error has retryable: true', () => {
      const error: ToolError = { code: 'TIMEOUT', message: 'Request timed out', retryable: true };
      const result = classifyFailure(error, 'some_tool');
      expect(result.type).toBe('retryable');
      expect(result.reason).toMatch(/retryable/i);
      expect(result.suggestedAction).toContain('some_tool');
    });

    it('returns retryable when retryable flag overrides pattern match', () => {
      // An error that would normally be terminal but is flagged retryable
      const error: ToolError = { code: '401', message: 'Unauthorized', retryable: true };
      const result = classifyFailure(error, 'auth_tool');
      expect(result.type).toBe('retryable');
    });
  });

  describe('pattern-based retryable errors', () => {
    it('classifies 429 code as retryable', () => {
      const error: ToolError = { code: '429', message: 'Too many requests' };
      const result = classifyFailure(error, 'web_fetch');
      expect(result.type).toBe('retryable');
    });

    it('classifies ETIMEDOUT code as retryable', () => {
      const error: ToolError = { code: 'ETIMEDOUT', message: 'Connection timed out' };
      const result = classifyFailure(error, 'web_fetch');
      expect(result.type).toBe('retryable');
    });

    it('classifies 503 status as retryable', () => {
      const error: ToolError = { code: '503', message: 'Service unavailable' };
      const result = classifyFailure(error, 'api_call');
      expect(result.type).toBe('retryable');
    });

    it('classifies timeout keyword in message as retryable', () => {
      const error: ToolError = { code: 'ERR', message: 'Request timeout after 30s' };
      const result = classifyFailure(error, 'slow_tool');
      expect(result.type).toBe('retryable');
    });

    it('classifies rate limit message as retryable', () => {
      const error: ToolError = { code: 'ERR', message: 'Rate limit exceeded' };
      const result = classifyFailure(error, 'api_tool');
      expect(result.type).toBe('retryable');
    });
  });

  describe('terminal auth/permission errors', () => {
    it('classifies 401 as terminal', () => {
      const error: ToolError = { code: '401', message: 'Unauthorized' };
      const result = classifyFailure(error, 'api_call');
      expect(result.type).toBe('terminal');
      expect(result.reason).toMatch(/auth|permission/i);
    });

    it('classifies 403 as terminal', () => {
      const error: ToolError = { code: '403', message: 'Forbidden' };
      const result = classifyFailure(error, 'api_call');
      expect(result.type).toBe('terminal');
    });

    it('classifies EACCES as terminal', () => {
      const error: ToolError = { code: 'EACCES', message: 'Permission denied' };
      const result = classifyFailure(error, 'read_file');
      expect(result.type).toBe('terminal');
    });

    it('classifies unauthorized message as terminal', () => {
      const error: ToolError = { code: 'ERR', message: 'You are not authorized to perform this action' };
      const result = classifyFailure(error, 'write_file');
      expect(result.type).toBe('terminal');
    });
  });

  describe('404/ENOENT - file tool vs web tool', () => {
    it('classifies ENOENT for read_file as fixable', () => {
      const error: ToolError = { code: 'ENOENT', message: 'No such file' };
      const result = classifyFailure(error, 'read_file');
      expect(result.type).toBe('fixable');
      expect(result.suggestedAction).toMatch(/directory_tree|search_files/i);
    });

    it('classifies 404 for web_fetch as terminal', () => {
      const error: ToolError = { code: '404', message: 'Not found' };
      const result = classifyFailure(error, 'web_fetch');
      expect(result.type).toBe('terminal');
      expect(result.reason).toMatch(/404/);
    });

    it('classifies 404 for browser_navigate as terminal', () => {
      const error: ToolError = { code: '404', message: 'Page not found' };
      const result = classifyFailure(error, 'browser_navigate');
      expect(result.type).toBe('terminal');
    });

    it('classifies ENOENT for non-web tool as fixable', () => {
      const error: ToolError = { code: 'ENOENT', message: 'No such file or directory' };
      const result = classifyFailure(error, 'write_file');
      expect(result.type).toBe('fixable');
    });
  });

  describe('fixable validation errors', () => {
    it('classifies VALIDATION code as fixable', () => {
      const error: ToolError = { code: 'VALIDATION', message: 'Validation failed for input' };
      const result = classifyFailure(error, 'create_issue');
      expect(result.type).toBe('fixable');
    });

    it('classifies ZodError code as fixable', () => {
      const error: ToolError = { code: 'ZodError', message: 'Invalid input' };
      const result = classifyFailure(error, 'update_task');
      expect(result.type).toBe('fixable');
    });

    it('classifies missing required field message as fixable', () => {
      const error: ToolError = { code: '400', message: 'Missing required field: title' };
      const result = classifyFailure(error, 'create_item');
      expect(result.type).toBe('fixable');
    });
  });

  describe('terminal default', () => {
    it('classifies unknown error as terminal', () => {
      const error: ToolError = { code: 'UNKNOWN', message: 'Something broke' };
      const result = classifyFailure(error, 'some_tool');
      expect(result.type).toBe('terminal');
      expect(result.reason).toContain('some_tool');
    });

    it('includes the tool name and message in reason for terminal default', () => {
      const error: ToolError = { code: 'CRASH', message: 'Unexpected crash occurred' };
      const result = classifyFailure(error, 'my_tool');
      expect(result.type).toBe('terminal');
      expect(result.reason).toContain('my_tool');
      expect(result.reason).toContain('Unexpected crash occurred');
    });
  });

  describe('return shape', () => {
    it('always returns type, reason, and suggestedAction', () => {
      const error: ToolError = { code: 'ERR', message: 'some error' };
      const result = classifyFailure(error, 'tool');
      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('reason');
      expect(result).toHaveProperty('suggestedAction');
      expect(typeof result.type).toBe('string');
      expect(typeof result.reason).toBe('string');
      expect(typeof result.suggestedAction).toBe('string');
    });
  });
});

// =============================================================================
// 3.3 - suggestParameterFixes
// =============================================================================

describe('suggestParameterFixes', () => {
  describe('path fixes', () => {
    it('suggests absolute path when path param is relative and error is ENOENT', () => {
      const error: ToolError = { code: 'ENOENT', message: 'No such file or directory' };
      const params = { path: 'relative/path/file.txt' };
      const fixes = suggestParameterFixes(error, 'read_file', params);
      const pathFix = fixes.find((f) => f.paramName === 'path');
      expect(pathFix).toBeDefined();
      expect(typeof pathFix?.suggestedValue).toBe('string');
      expect((pathFix?.suggestedValue as string).startsWith('/')).toBe(true);
      expect(pathFix?.suggestedValue).toContain('relative/path/file.txt');
    });

    it('returns no path fix when path is already absolute', () => {
      const error: ToolError = { code: 'ENOENT', message: 'No such file or directory' };
      const params = { path: '/absolute/path/file.txt' };
      const fixes = suggestParameterFixes(error, 'read_file', params);
      const pathFix = fixes.find((f) => f.paramName === 'path');
      expect(pathFix).toBeUndefined();
    });

    it('returns no path fix when error is unrelated', () => {
      const error: ToolError = { code: '429', message: 'Rate limited' };
      const params = { path: 'relative/path' };
      const fixes = suggestParameterFixes(error, 'read_file', params);
      const pathFix = fixes.find((f) => f.paramName === 'path');
      expect(pathFix).toBeUndefined();
    });
  });

  describe('URL fixes', () => {
    it('prepends https:// to URL without protocol', () => {
      const error: ToolError = { code: 'ERR', message: 'Request failed' };
      const params = { url: 'example.com' };
      const fixes = suggestParameterFixes(error, 'web_fetch', params);
      const urlFix = fixes.find((f) => f.paramName === 'url');
      expect(urlFix).toBeDefined();
      expect(urlFix?.suggestedValue).toBe('https://example.com');
      expect(urlFix?.reason).toMatch(/protocol/i);
    });

    it('returns no URL fix when URL already has https protocol', () => {
      const error: ToolError = { code: 'ERR', message: 'Request failed' };
      const params = { url: 'https://example.com' };
      const fixes = suggestParameterFixes(error, 'web_fetch', params);
      const urlFix = fixes.find((f) => f.paramName === 'url');
      expect(urlFix).toBeUndefined();
    });

    it('returns no URL fix when URL already has http protocol', () => {
      const error: ToolError = { code: 'ERR', message: 'Request failed' };
      const params = { url: 'http://example.com' };
      const fixes = suggestParameterFixes(error, 'web_fetch', params);
      const urlFix = fixes.find((f) => f.paramName === 'url');
      expect(urlFix).toBeUndefined();
    });
  });

  describe('type coercion fixes', () => {
    it('suggests String() conversion when expected string but got number', () => {
      const error: ToolError = { code: 'VALIDATION', message: 'expected string for count' };
      const params = { count: 42 };
      const fixes = suggestParameterFixes(error, 'create_item', params);
      const fix = fixes.find((f) => f.paramName === 'count');
      expect(fix).toBeDefined();
      expect(fix?.suggestedValue).toBe('42');
      expect(fix?.reason).toMatch(/string/i);
    });

    it('does not suggest type fix when value is already a string', () => {
      const error: ToolError = { code: 'VALIDATION', message: 'expected string for count' };
      const params = { count: '42' };
      const fixes = suggestParameterFixes(error, 'create_item', params);
      const fix = fixes.find((f) => f.paramName === 'count' && fix?.reason?.match(/string/i));
      // Should not have a number-to-string fix since value is already string
      const numToStrFix = fixes.find((f) => f.paramName === 'count' && (f.suggestedValue === '42' && typeof f.currentValue === 'number'));
      expect(numToStrFix).toBeUndefined();
    });
  });

  describe('missing required field fixes', () => {
    it('suggests adding missing required field when mentioned in error', () => {
      // The "X is required" pattern in the error message is reliably parsed by the regex
      const error: ToolError = { code: 'VALIDATION', message: '"name" is required' };
      const params: Record<string, unknown> = {};
      const fixes = suggestParameterFixes(error, 'create_item', params);
      const fix = fixes.find((f) => f.paramName === 'name');
      expect(fix).toBeDefined();
      expect(fix?.currentValue).toBeUndefined();
      expect(typeof fix?.suggestedValue).toBe('string');
      expect(fix?.reason).toMatch(/required/i);
    });

    it('does not suggest missing field fix when field already present', () => {
      const error: ToolError = { code: 'VALIDATION', message: 'missing required "name"' };
      const params = { name: 'existing value' };
      const fixes = suggestParameterFixes(error, 'create_item', params);
      // The fix should not appear since 'name' is already in params
      const fix = fixes.find((f) => f.paramName === 'name' && f.currentValue === undefined);
      expect(fix).toBeUndefined();
    });
  });

  describe('empty results', () => {
    it('returns empty array when no fixes can be inferred', () => {
      const error: ToolError = { code: 'CRASH', message: 'Internal server error' };
      const params = { value: 'something' };
      const fixes = suggestParameterFixes(error, 'tool', params);
      expect(Array.isArray(fixes)).toBe(true);
      // No relevant patterns match CRASH/Internal server error
      expect(fixes.length).toBe(0);
    });

    it('returns empty array for empty params', () => {
      const error: ToolError = { code: 'CRASH', message: 'Internal error' };
      const fixes = suggestParameterFixes(error, 'tool', {});
      expect(fixes).toEqual([]);
    });
  });
});

// =============================================================================
// 3.4 - suggestAlternativeTools
// =============================================================================

describe('suggestAlternativeTools', () => {
  it('suggests web_search for web_fetch with timeout error', () => {
    const error: ToolError = { code: 'ETIMEDOUT', message: 'Connection timed out' };
    const alts = suggestAlternativeTools('web_fetch', error);
    const toolNames = alts.map((a) => a.toolName);
    expect(toolNames).toContain('web_search');
  });

  it('returns no alternatives for web_fetch with auth error (onlyFor does not match)', () => {
    const error: ToolError = { code: '401', message: 'Unauthorized' };
    const alts = suggestAlternativeTools('web_fetch', error);
    expect(alts.length).toBe(0);
  });

  it('suggests search_files as alternative for grep', () => {
    const error: ToolError = { code: 'ERR', message: 'Command not found' };
    const alts = suggestAlternativeTools('grep', error);
    const toolNames = alts.map((a) => a.toolName);
    expect(toolNames).toContain('search_files');
  });

  it('suggests directory_tree and search_files for read_file with ENOENT', () => {
    const error: ToolError = { code: 'ENOENT', message: 'No such file or directory' };
    const alts = suggestAlternativeTools('read_file', error);
    const toolNames = alts.map((a) => a.toolName);
    expect(toolNames).toContain('directory_tree');
    expect(toolNames).toContain('search_files');
  });

  it('returns empty array for unknown tool', () => {
    const error: ToolError = { code: 'ERR', message: 'Failed' };
    const alts = suggestAlternativeTools('unknown_tool', error);
    expect(alts).toEqual([]);
  });

  it('returns alternatives with correct shape (toolName, reason, paramMapping)', () => {
    const error: ToolError = { code: 'ENOENT', message: 'Not found' };
    const alts = suggestAlternativeTools('read_file', error);
    for (const alt of alts) {
      expect(alt).toHaveProperty('toolName');
      expect(alt).toHaveProperty('reason');
      expect(alt).toHaveProperty('paramMapping');
      expect(typeof alt.toolName).toBe('string');
      expect(typeof alt.reason).toBe('string');
      expect(typeof alt.paramMapping).toBe('object');
    }
  });
});

// =============================================================================
// 3.6 - CorrectionTracker
// =============================================================================

describe('CorrectionTracker', () => {
  it('canCorrect() returns true for a new tracker with default budget', () => {
    const tracker = new CorrectionTracker();
    expect(tracker.canCorrect()).toBe(true);
  });

  it('canCorrect() returns false after exhausting the default budget of 3', () => {
    const tracker = new CorrectionTracker();
    tracker.recordCorrection();
    tracker.recordCorrection();
    tracker.recordCorrection();
    expect(tracker.canCorrect()).toBe(false);
  });

  it('getStatus().exhausted is true after budget is consumed', () => {
    const tracker = new CorrectionTracker();
    tracker.recordCorrection();
    tracker.recordCorrection();
    tracker.recordCorrection();
    expect(tracker.getStatus().exhausted).toBe(true);
  });

  it('getStatus().used tracks the number of corrections recorded', () => {
    const tracker = new CorrectionTracker();
    expect(tracker.getStatus().used).toBe(0);
    tracker.recordCorrection();
    expect(tracker.getStatus().used).toBe(1);
    tracker.recordCorrection();
    expect(tracker.getStatus().used).toBe(2);
  });

  it('reset() restores the budget so canCorrect() returns true again', () => {
    const tracker = new CorrectionTracker();
    tracker.recordCorrection();
    tracker.recordCorrection();
    tracker.recordCorrection();
    expect(tracker.canCorrect()).toBe(false);
    tracker.reset();
    expect(tracker.canCorrect()).toBe(true);
    expect(tracker.getStatus().used).toBe(0);
    expect(tracker.getStatus().exhausted).toBe(false);
  });

  it('custom budget of 1: one correction exhausts it', () => {
    const tracker = new CorrectionTracker(1);
    expect(tracker.canCorrect()).toBe(true);
    tracker.recordCorrection();
    expect(tracker.canCorrect()).toBe(false);
    expect(tracker.getStatus().exhausted).toBe(true);
  });

  it('getStatus() returns a copy - mutations do not affect internal state', () => {
    const tracker = new CorrectionTracker();
    const status = tracker.getStatus();
    status.used = 999;
    expect(tracker.getStatus().used).toBe(0);
  });

  it('recordCorrection() is a no-op when already exhausted', () => {
    const tracker = new CorrectionTracker(1);
    tracker.recordCorrection(); // exhausts budget
    tracker.recordCorrection(); // should be no-op
    expect(tracker.getStatus().used).toBe(1);
  });

  it('getStatus().maxCorrections matches the value passed to constructor', () => {
    const tracker = new CorrectionTracker(5);
    expect(tracker.getStatus().maxCorrections).toBe(5);
  });
});

// =============================================================================
// 3.5 - buildErrorContext
// =============================================================================

describe('buildErrorContext', () => {
  it('returns an ErrorContext with the correct shape', () => {
    const error: ToolError = { code: 'TIMEOUT', message: 'Timed out', retryable: true };
    const classification = classifyFailure(error, 'web_fetch');
    const ctx = buildErrorContext('web_fetch', error, 1, classification);

    expect(ctx.failedTool).toBe('web_fetch');
    expect(ctx.error).toContain('TIMEOUT');
    expect(ctx.error).toContain('Timed out');
    expect(ctx.attemptNumber).toBe(1);
    expect(typeof ctx.suggestion).toBe('string');
    expect(ctx.suggestion.length).toBeGreaterThan(0);
    expect(Array.isArray(ctx.alternatives)).toBe(true);
  });

  it('formats error as [code] message', () => {
    const error: ToolError = { code: 'ENOENT', message: 'No such file or directory' };
    const classification = classifyFailure(error, 'read_file');
    const ctx = buildErrorContext('read_file', error, 2, classification);
    expect(ctx.error).toBe('[ENOENT] No such file or directory');
  });

  it('populates alternatives from suggestAlternativeTools', () => {
    const error: ToolError = { code: 'ENOENT', message: 'Not found' };
    const classification = classifyFailure(error, 'read_file');
    const ctx = buildErrorContext('read_file', error, 1, classification);
    // read_file + ENOENT should produce alternatives
    expect(ctx.alternatives.length).toBeGreaterThan(0);
    expect(ctx.alternatives).toContain('directory_tree');
  });

  it('populates empty alternatives for unknown tool', () => {
    const error: ToolError = { code: 'ERR', message: 'Failed' };
    const classification = classifyFailure(error, 'unknown_tool');
    const ctx = buildErrorContext('unknown_tool', error, 1, classification);
    expect(ctx.alternatives).toEqual([]);
  });

  it('preserves the attemptNumber passed in', () => {
    const error: ToolError = { code: 'ERR', message: 'Broken' };
    const classification = classifyFailure(error, 'tool');
    const ctx = buildErrorContext('tool', error, 42, classification);
    expect(ctx.attemptNumber).toBe(42);
  });
});

// =============================================================================
// 3.5 - formatErrorContextForPrompt
// =============================================================================

describe('formatErrorContextForPrompt', () => {
  it('includes the tool name in the output', () => {
    const ctx = {
      failedTool: 'my_tool',
      error: '[ERR] Something went wrong',
      attemptNumber: 1,
      suggestion: 'Try a different approach',
      alternatives: [],
    };
    const output = formatErrorContextForPrompt(ctx);
    expect(output).toContain('my_tool');
  });

  it('includes the error string in the output', () => {
    const ctx = {
      failedTool: 'my_tool',
      error: '[TIMEOUT] Request timed out',
      attemptNumber: 1,
      suggestion: 'Retry later',
      alternatives: [],
    };
    const output = formatErrorContextForPrompt(ctx);
    expect(output).toContain('[TIMEOUT] Request timed out');
  });

  it('includes the suggestion in the output', () => {
    const ctx = {
      failedTool: 'my_tool',
      error: '[ERR] Failed',
      attemptNumber: 1,
      suggestion: 'Check the file path',
      alternatives: [],
    };
    const output = formatErrorContextForPrompt(ctx);
    expect(output).toContain('Check the file path');
  });

  it('includes alternatives line when alternatives are present', () => {
    const ctx = {
      failedTool: 'read_file',
      error: '[ENOENT] No such file',
      attemptNumber: 1,
      suggestion: 'Use directory_tree first',
      alternatives: ['directory_tree', 'search_files'],
    };
    const output = formatErrorContextForPrompt(ctx);
    expect(output).toContain('directory_tree');
    expect(output).toContain('search_files');
  });

  it('does not include alternatives line when alternatives are empty', () => {
    const ctx = {
      failedTool: 'unknown_tool',
      error: '[ERR] Unknown failure',
      attemptNumber: 1,
      suggestion: 'Try a different approach',
      alternatives: [],
    };
    const output = formatErrorContextForPrompt(ctx);
    expect(output).not.toContain('Alternative tools');
  });

  it('includes the attempt number in the output', () => {
    const ctx = {
      failedTool: 'some_tool',
      error: '[ERR] Failed',
      attemptNumber: 3,
      suggestion: 'Give up',
      alternatives: [],
    };
    const output = formatErrorContextForPrompt(ctx);
    expect(output).toContain('3');
  });
});

// =============================================================================
// 3.2 - executeWithRetry
// =============================================================================

describe('executeWithRetry', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns success on first try without delay', async () => {
    const fn = vi.fn().mockResolvedValue({ success: true, data: 'ok' });
    const result = await executeWithRetry(fn);
    expect(result.success).toBe(true);
    expect(result.data).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable error and returns success on second attempt', async () => {
    vi.useFakeTimers();
    const retryableError: ToolError = { code: 'ETIMEDOUT', message: 'Connection timed out' };
    const fn = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: retryableError })
      .mockResolvedValueOnce({ success: true, data: 'recovered' });

    const retryPromise = executeWithRetry(fn, { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000, backoffMultiplier: 2 });
    // Advance past any jitter delay
    await vi.advanceTimersByTimeAsync(2000);
    const result = await retryPromise;

    expect(result.success).toBe(true);
    expect(result.data).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-retryable error and returns failure immediately', async () => {
    const terminalError: ToolError = { code: '401', message: 'Unauthorized' };
    const fn = vi.fn().mockResolvedValue({ success: false, error: terminalError });

    const result = await executeWithRetry(fn, { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000, backoffMultiplier: 2 });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('401');
    // Only called once - no retries for terminal errors
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns ABORTED error when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const fn = vi.fn().mockResolvedValue({ success: true, data: 'ok' });
    const result = await executeWithRetry(fn, {}, controller.signal);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ABORTED');
    expect(fn).not.toHaveBeenCalled();
  });

  it('returns failure after exhausting all retries for persistent retryable error', async () => {
    vi.useFakeTimers();
    const retryableError: ToolError = { code: 'ETIMEDOUT', message: 'Always times out' };
    const fn = vi.fn().mockResolvedValue({ success: false, error: retryableError });

    const retryPromise = executeWithRetry(fn, { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 500, backoffMultiplier: 2 });
    await vi.advanceTimersByTimeAsync(10000);
    const result = await retryPromise;

    expect(result.success).toBe(false);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('respects custom maxAttempts config', async () => {
    vi.useFakeTimers();
    const retryableError: ToolError = { code: '429', message: 'Too many requests' };
    const fn = vi.fn().mockResolvedValue({ success: false, error: retryableError });

    const retryPromise = executeWithRetry(fn, { maxAttempts: 2, baseDelayMs: 50, maxDelayMs: 200, backoffMultiplier: 2 });
    await vi.advanceTimersByTimeAsync(5000);
    const result = await retryPromise;

    expect(result.success).toBe(false);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('passes through data from successful result', async () => {
    const fn = vi.fn().mockResolvedValue({ success: true, data: { id: 123, name: 'test' } });
    const result = await executeWithRetry<{ id: number; name: string }>(fn);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 123, name: 'test' });
  });

  it('uses retryable flag on error to determine retry eligibility', async () => {
    vi.useFakeTimers();
    const retryableError: ToolError = { code: 'CUSTOM_ERR', message: 'Custom retryable error', retryable: true };
    const fn = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: retryableError })
      .mockResolvedValueOnce({ success: true, data: 'done' });

    const retryPromise = executeWithRetry(fn, { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 500, backoffMultiplier: 2 });
    await vi.advanceTimersByTimeAsync(5000);
    const result = await retryPromise;

    expect(result.success).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
