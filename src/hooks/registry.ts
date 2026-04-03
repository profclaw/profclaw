/**
 * Hook Registry
 *
 * Manages lifecycle hooks for the profClaw agent execution pipeline.
 * Hooks run in priority order and can abort or modify the operation.
 */

import { createContextualLogger } from '../utils/logger.js';

const log = createContextualLogger('HookRegistry');

export type HookPoint =
  | 'beforeToolCall'
  | 'afterToolCall'
  | 'beforeApiCall'
  | 'afterResponse'
  | 'onSessionStart'
  | 'onSessionEnd'
  | 'onError'
  | 'onBudgetWarning';

export interface HookContext {
  hookPoint: HookPoint;
  sessionId?: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  error?: Error;
  budgetUsed?: number;
  budgetMax?: number;
  metadata: Record<string, unknown>;
}

export interface HookResult {
  /** false = abort the operation */
  proceed: boolean;
  /** Override args/result if provided */
  modified?: unknown;
  metadata?: Record<string, unknown>;
}

export interface Hook {
  name: string;
  point: HookPoint;
  /** Lower runs first, default 100 */
  priority: number;
  handler: (context: HookContext) => Promise<HookResult>;
}

export class HookRegistry {
  private hooks: Map<HookPoint, Hook[]>;

  constructor() {
    this.hooks = new Map();
  }

  /**
   * Register a hook. If a hook with the same name already exists it is replaced.
   */
  register(hook: Hook): void {
    if (!this.hooks.has(hook.point)) {
      this.hooks.set(hook.point, []);
    }

    const list = this.hooks.get(hook.point)!;

    // Remove existing hook with same name (idempotent registration)
    const existingIdx = list.findIndex((h) => h.name === hook.name);
    if (existingIdx !== -1) {
      list.splice(existingIdx, 1);
    }

    list.push(hook);
    // Keep sorted by priority ascending — lower number runs first
    list.sort((a, b) => a.priority - b.priority);

    log.debug('Hook registered', { name: hook.name, point: hook.point, priority: hook.priority });
  }

  /**
   * Unregister a hook by name (searches all hook points).
   */
  unregister(name: string): void {
    for (const [point, list] of this.hooks) {
      const idx = list.findIndex((h) => h.name === name);
      if (idx !== -1) {
        list.splice(idx, 1);
        log.debug('Hook unregistered', { name, point });
      }
    }
  }

  /**
   * Run all hooks for a given point in priority order.
   *
   * - If any hook returns `proceed: false`, the chain stops immediately.
   * - If a hook returns `modified`, that value is forwarded to the next hook.
   * - Returns `{ proceed: true }` when no hooks are registered for the point.
   */
  async run(point: HookPoint, context: HookContext): Promise<HookResult> {
    const list = this.hooks.get(point);

    if (!list || list.length === 0) {
      return { proceed: true };
    }

    let currentContext: HookContext = { ...context };
    let aggregatedMetadata: Record<string, unknown> = { ...context.metadata };

    for (const hook of list) {
      try {
        const result = await hook.handler(currentContext);

        if (result.metadata) {
          aggregatedMetadata = { ...aggregatedMetadata, ...result.metadata };
        }

        if (!result.proceed) {
          log.info('Hook chain aborted', { hook: hook.name, point });
          return {
            proceed: false,
            modified: result.modified,
            metadata: aggregatedMetadata,
          };
        }

        // Forward modified value to the next hook
        if (result.modified !== undefined) {
          currentContext = {
            ...currentContext,
            toolArgs: result.modified,
            toolResult: result.modified,
            metadata: aggregatedMetadata,
          };
        } else {
          currentContext = { ...currentContext, metadata: aggregatedMetadata };
        }
      } catch (error) {
        log.error('[HookRegistry] Hook threw an error', {
          hook: hook.name,
          point,
          error: error instanceof Error ? error.message : String(error),
        });
        // Non-fatal: log and continue the chain
      }
    }

    const finalModified =
      currentContext.toolArgs !== context.toolArgs ? currentContext.toolArgs : undefined;

    return {
      proceed: true,
      modified: finalModified,
      metadata: aggregatedMetadata,
    };
  }

  /**
   * Return a flat list of all registered hooks across all points.
   */
  getRegistered(): Hook[] {
    const all: Hook[] = [];
    for (const list of this.hooks.values()) {
      all.push(...list);
    }
    return all;
  }

  /**
   * Remove all registered hooks.
   */
  clear(): void {
    this.hooks.clear();
    log.debug('Hook registry cleared');
  }
}

/** Module-level singleton registry */
let defaultRegistry: HookRegistry | null = null;

export function getHookRegistry(): HookRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new HookRegistry();
  }
  return defaultRegistry;
}
