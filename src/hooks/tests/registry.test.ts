import { describe, it, expect, beforeEach } from 'vitest';
import { HookRegistry } from '../registry.js';
import type { Hook, HookContext, HookPoint } from '../registry.js';

function makeContext(overrides: Partial<HookContext> = {}): HookContext {
  return {
    hookPoint: 'beforeToolCall',
    metadata: {},
    ...overrides,
  };
}

function makeHook(
  name: string,
  point: HookPoint,
  priority: number,
  proceed = true,
  modified?: unknown,
): Hook {
  return {
    name,
    point,
    priority,
    handler: async () => ({
      proceed,
      modified,
      metadata: { ranBy: name },
    }),
  };
}

describe('HookRegistry', () => {
  let registry: HookRegistry;

  beforeEach(() => {
    registry = new HookRegistry();
  });

  it('registers a hook and runs it', async () => {
    const hook = makeHook('test-hook', 'beforeToolCall', 100);
    registry.register(hook);

    const result = await registry.run('beforeToolCall', makeContext());

    expect(result.proceed).toBe(true);
    expect(result.metadata?.ranBy).toBe('test-hook');
  });

  it('runs hooks in priority order (lower number first)', async () => {
    const order: string[] = [];

    registry.register({
      name: 'hook-priority-200',
      point: 'beforeToolCall',
      priority: 200,
      handler: async () => {
        order.push('200');
        return { proceed: true };
      },
    });

    registry.register({
      name: 'hook-priority-50',
      point: 'beforeToolCall',
      priority: 50,
      handler: async () => {
        order.push('50');
        return { proceed: true };
      },
    });

    registry.register({
      name: 'hook-priority-100',
      point: 'beforeToolCall',
      priority: 100,
      handler: async () => {
        order.push('100');
        return { proceed: true };
      },
    });

    await registry.run('beforeToolCall', makeContext());

    expect(order).toEqual(['50', '100', '200']);
  });

  it('stops chain when a hook returns proceed: false', async () => {
    const ranHooks: string[] = [];

    registry.register({
      name: 'hook-a',
      point: 'beforeToolCall',
      priority: 10,
      handler: async () => {
        ranHooks.push('hook-a');
        return { proceed: true };
      },
    });

    registry.register({
      name: 'hook-abort',
      point: 'beforeToolCall',
      priority: 20,
      handler: async () => {
        ranHooks.push('hook-abort');
        return { proceed: false };
      },
    });

    registry.register({
      name: 'hook-after-abort',
      point: 'beforeToolCall',
      priority: 30,
      handler: async () => {
        ranHooks.push('hook-after-abort');
        return { proceed: true };
      },
    });

    const result = await registry.run('beforeToolCall', makeContext());

    expect(result.proceed).toBe(false);
    expect(ranHooks).toEqual(['hook-a', 'hook-abort']);
    expect(ranHooks).not.toContain('hook-after-abort');
  });

  it('passes modified value from one hook to the next', async () => {
    const receivedArgs: unknown[] = [];

    registry.register({
      name: 'hook-modifier',
      point: 'beforeToolCall',
      priority: 10,
      handler: async () => ({
        proceed: true,
        modified: { injected: true },
      }),
    });

    registry.register({
      name: 'hook-consumer',
      point: 'beforeToolCall',
      priority: 20,
      handler: async (ctx) => {
        receivedArgs.push(ctx.toolArgs);
        return { proceed: true };
      },
    });

    await registry.run('beforeToolCall', makeContext({ toolArgs: { original: true } }));

    expect(receivedArgs[0]).toEqual({ injected: true });
  });

  it('unregisters a hook so it no longer runs', async () => {
    const ranHooks: string[] = [];

    registry.register({
      name: 'hook-to-remove',
      point: 'beforeToolCall',
      priority: 10,
      handler: async () => {
        ranHooks.push('hook-to-remove');
        return { proceed: true };
      },
    });

    registry.register({
      name: 'hook-stays',
      point: 'beforeToolCall',
      priority: 20,
      handler: async () => {
        ranHooks.push('hook-stays');
        return { proceed: true };
      },
    });

    registry.unregister('hook-to-remove');
    await registry.run('beforeToolCall', makeContext());

    expect(ranHooks).toEqual(['hook-stays']);
    expect(ranHooks).not.toContain('hook-to-remove');
  });

  it('returns proceed: true for an empty hook point', async () => {
    const result = await registry.run('onSessionStart', makeContext({ hookPoint: 'onSessionStart' }));

    expect(result.proceed).toBe(true);
    expect(result.modified).toBeUndefined();
  });

  it('getRegistered returns all registered hooks across all points', () => {
    registry.register(makeHook('hook-1', 'beforeToolCall', 100));
    registry.register(makeHook('hook-2', 'afterToolCall', 100));
    registry.register(makeHook('hook-3', 'onError', 100));

    const all = registry.getRegistered();

    expect(all).toHaveLength(3);
    expect(all.map((h) => h.name)).toContain('hook-1');
    expect(all.map((h) => h.name)).toContain('hook-2');
    expect(all.map((h) => h.name)).toContain('hook-3');
  });

  it('clear removes all hooks', async () => {
    registry.register(makeHook('hook-a', 'beforeToolCall', 100));
    registry.register(makeHook('hook-b', 'afterToolCall', 100));

    registry.clear();

    expect(registry.getRegistered()).toHaveLength(0);
    const result = await registry.run('beforeToolCall', makeContext());
    expect(result.proceed).toBe(true);
  });

  it('re-registering a hook with the same name replaces it', async () => {
    const calls: string[] = [];

    registry.register({
      name: 'replaceable',
      point: 'beforeToolCall',
      priority: 100,
      handler: async () => {
        calls.push('v1');
        return { proceed: true };
      },
    });

    registry.register({
      name: 'replaceable',
      point: 'beforeToolCall',
      priority: 100,
      handler: async () => {
        calls.push('v2');
        return { proceed: true };
      },
    });

    await registry.run('beforeToolCall', makeContext());

    expect(calls).toEqual(['v2']);
    expect(registry.getRegistered()).toHaveLength(1);
  });
});
