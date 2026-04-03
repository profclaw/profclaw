/**
 * Built-in Hook: Dangerous Tool Guard
 *
 * Intercepts `beforeToolCall` and delegates to a PermissionManager instance.
 * If the manager denies the operation the hook returns `proceed: false`,
 * halting the hook chain before the tool runs.
 *
 * In non-interactive mode (no prompt callback registered on the manager) all
 * tools are allowed and the call is flagged with `metadata.requiresApproval`.
 */

import { createContextualLogger } from '../../utils/logger.js';
import { PermissionManager, DEFAULT_PERMISSION_RULES } from '../../agents/permissions.js';
import type { Hook, HookContext, HookResult } from '../registry.js';

const log = createContextualLogger('DangerousToolHook');

/**
 * Tools that are considered dangerous and should require human approval
 * before execution in interactive sessions.
 *
 * Exported for backwards-compatibility and convenience checks.
 */
export const DANGEROUS_TOOLS = new Set(
  DEFAULT_PERMISSION_RULES.filter((r) => r.level === 'dangerous').map((r) => r.toolName),
);

/**
 * Module-level PermissionManager shared by the hook.
 * Callers can obtain a reference via `getPermissionManager()` to attach a
 * prompt callback before the hook fires.
 */
let sharedManager: PermissionManager = new PermissionManager();

/**
 * Retrieve (or lazily create) the PermissionManager used by this hook.
 * Use this to register a `setPromptCallback` in interactive sessions.
 */
export function getPermissionManager(): PermissionManager {
  return sharedManager;
}

/**
 * Replace the PermissionManager used by this hook.
 * Primarily useful in tests where you want full control over the manager.
 */
export function setPermissionManager(manager: PermissionManager): void {
  sharedManager = manager;
}

export const dangerousToolHook: Hook = {
  name: 'built-in:dangerous-tool',
  point: 'beforeToolCall',
  priority: 20,
  handler: async (context: HookContext): Promise<HookResult> => {
    const { toolName, toolArgs, sessionId } = context;

    if (!toolName) {
      return { proceed: true };
    }

    const level = sharedManager.getLevel(toolName);

    // Safe tools (or unknown tools with no rule) are always allowed without prompting
    if (level === 'safe') {
      return { proceed: true };
    }

    log.debug('Checking permission for tool', { tool: toolName, level, sessionId });

    const result = await sharedManager.check(toolName, toolArgs);

    if (!result.allowed) {
      log.warn('Tool call denied by permission manager', {
        tool: toolName,
        reason: result.reason,
        sessionId,
      });
      return {
        proceed: false,
        metadata: {
          permissionDenied: true,
          deniedTool: toolName,
          reason: result.reason,
        },
      };
    }

    // Allowed — flag with requiresApproval so callers remain aware
    return {
      proceed: true,
      metadata: { requiresApproval: true, dangerousTool: toolName },
    };
  },
};

export default dangerousToolHook;
