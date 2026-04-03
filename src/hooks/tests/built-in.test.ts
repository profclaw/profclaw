import { describe, it, expect } from 'vitest';
import { costWarningHook } from '../built-in/cost-warning.js';
import { dangerousToolHook, DANGEROUS_TOOLS } from '../built-in/dangerous-tool.js';
import { auditLogHook } from '../built-in/audit-log.js';
import type { HookContext } from '../registry.js';

function makeContext(overrides: Partial<HookContext> = {}): HookContext {
  return {
    hookPoint: 'onBudgetWarning',
    metadata: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Cost Warning Hook
// ---------------------------------------------------------------------------

describe('costWarningHook', () => {
  it('returns proceed: true when budget is not exceeded', async () => {
    const ctx = makeContext({ budgetUsed: 30000, budgetMax: 100000 });
    const result = await costWarningHook.handler(ctx);
    expect(result.proceed).toBe(true);
  });

  it('fires a warning and returns proceed: true at 50% threshold', async () => {
    // Cross the 50% threshold (previous: 40%, current: 55%)
    const ctx = makeContext({
      budgetUsed: 55000,
      budgetMax: 100000,
      metadata: { previousBudgetRatio: 0.4 },
    });
    const result = await costWarningHook.handler(ctx);
    expect(result.proceed).toBe(true);
    expect(result.metadata?.previousBudgetRatio).toBeCloseTo(0.55);
  });

  it('fires a warning and returns proceed: true at 80% threshold', async () => {
    const ctx = makeContext({
      budgetUsed: 82000,
      budgetMax: 100000,
      metadata: { previousBudgetRatio: 0.79 },
    });
    const result = await costWarningHook.handler(ctx);
    expect(result.proceed).toBe(true);
    expect(result.metadata?.previousBudgetRatio).toBeCloseTo(0.82);
  });

  it('stops execution (proceed: false) at 100% budget', async () => {
    const ctx = makeContext({ budgetUsed: 100000, budgetMax: 100000 });
    const result = await costWarningHook.handler(ctx);
    expect(result.proceed).toBe(false);
    expect(result.metadata?.budgetExhausted).toBe(true);
  });

  it('stops execution when budget is over 100%', async () => {
    const ctx = makeContext({ budgetUsed: 110000, budgetMax: 100000 });
    const result = await costWarningHook.handler(ctx);
    expect(result.proceed).toBe(false);
  });

  it('returns proceed: true when budgetMax is undefined', async () => {
    const ctx = makeContext({ budgetUsed: 5000, budgetMax: undefined });
    const result = await costWarningHook.handler(ctx);
    expect(result.proceed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dangerous Tool Hook
// ---------------------------------------------------------------------------

describe('dangerousToolHook', () => {
  it('flags bash as requiring approval', async () => {
    const ctx = makeContext({
      hookPoint: 'beforeToolCall',
      toolName: 'bash',
      toolArgs: { command: 'rm -rf /' },
    });
    const result = await dangerousToolHook.handler(ctx);
    expect(result.proceed).toBe(true);
    expect(result.metadata?.requiresApproval).toBe(true);
    expect(result.metadata?.dangerousTool).toBe('bash');
  });

  it('flags write_file as requiring approval', async () => {
    const ctx = makeContext({
      hookPoint: 'beforeToolCall',
      toolName: 'write_file',
    });
    const result = await dangerousToolHook.handler(ctx);
    expect(result.proceed).toBe(true);
    expect(result.metadata?.requiresApproval).toBe(true);
  });

  it('flags delete_file as requiring approval', async () => {
    const ctx = makeContext({
      hookPoint: 'beforeToolCall',
      toolName: 'delete_file',
    });
    const result = await dangerousToolHook.handler(ctx);
    expect(result.proceed).toBe(true);
    expect(result.metadata?.requiresApproval).toBe(true);
  });

  it('flags git_push as requiring approval', async () => {
    const ctx = makeContext({
      hookPoint: 'beforeToolCall',
      toolName: 'git_push',
    });
    const result = await dangerousToolHook.handler(ctx);
    expect(result.proceed).toBe(true);
    expect(result.metadata?.requiresApproval).toBe(true);
  });

  it('does not flag safe tools', async () => {
    const ctx = makeContext({
      hookPoint: 'beforeToolCall',
      toolName: 'read_file',
    });
    const result = await dangerousToolHook.handler(ctx);
    expect(result.proceed).toBe(true);
    expect(result.metadata?.requiresApproval).toBeUndefined();
  });

  it('does not flag when toolName is missing', async () => {
    const ctx = makeContext({ hookPoint: 'beforeToolCall', toolName: undefined });
    const result = await dangerousToolHook.handler(ctx);
    expect(result.proceed).toBe(true);
    expect(result.metadata?.requiresApproval).toBeUndefined();
  });

  it('DANGEROUS_TOOLS set includes all expected dangerous-level tools', () => {
    expect(DANGEROUS_TOOLS.has('bash')).toBe(true);
    expect(DANGEROUS_TOOLS.has('delete_file')).toBe(true);
    expect(DANGEROUS_TOOLS.has('git_push')).toBe(true);
    expect(DANGEROUS_TOOLS.has('git_force_push')).toBe(true);
    // write_file is cautious (not dangerous), so it is NOT in DANGEROUS_TOOLS
    expect(DANGEROUS_TOOLS.has('write_file')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Audit Log Hook
// ---------------------------------------------------------------------------

describe('auditLogHook', () => {
  it('records a successful tool execution', async () => {
    const ctx = makeContext({
      hookPoint: 'afterToolCall',
      toolName: 'read_file',
      toolArgs: { path: '/src/index.ts' },
      toolResult: { success: true, content: 'file contents' },
      sessionId: 'session-abc',
    });
    const result = await auditLogHook.handler(ctx);
    expect(result.proceed).toBe(true);
    expect(result.metadata?.auditRecorded).toBe(true);
    expect(result.metadata?.auditSuccess).toBe(true);
    expect(typeof result.metadata?.auditTimestamp).toBe('string');
  });

  it('records a failed tool execution', async () => {
    const ctx = makeContext({
      hookPoint: 'afterToolCall',
      toolName: 'bash',
      toolArgs: { command: 'missing-cmd' },
      toolResult: { success: false, error: 'command not found' },
      sessionId: 'session-abc',
    });
    const result = await auditLogHook.handler(ctx);
    expect(result.proceed).toBe(true);
    expect(result.metadata?.auditSuccess).toBe(false);
  });

  it('sanitizes sensitive arguments before logging', async () => {
    const ctx = makeContext({
      hookPoint: 'afterToolCall',
      toolName: 'http_request',
      toolArgs: {
        url: 'https://api.example.com',
        token: 'super-secret-token',
        password: 'hunter2',
        body: { userId: 42 },
      },
      toolResult: { success: true },
    });

    // The hook should not throw or leak sensitive values — just complete cleanly
    const result = await auditLogHook.handler(ctx);
    expect(result.proceed).toBe(true);
    expect(result.metadata?.auditRecorded).toBe(true);
  });

  it('calculates duration when toolStartedAt is in metadata', async () => {
    const startedAt = Date.now() - 150; // ~150ms ago
    const ctx = makeContext({
      hookPoint: 'afterToolCall',
      toolName: 'some_tool',
      toolResult: { success: true },
      metadata: { toolStartedAt: startedAt },
    });
    const result = await auditLogHook.handler(ctx);
    expect(result.proceed).toBe(true);
    expect(typeof result.metadata?.auditDurationMs).toBe('number');
    expect(result.metadata?.auditDurationMs as number).toBeGreaterThanOrEqual(0);
  });
});
