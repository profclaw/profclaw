/**
 * Built-in Hooks
 *
 * Export all built-in hooks and a helper to register them all at once.
 */

export { costWarningHook } from './cost-warning.js';
export { dangerousToolHook, DANGEROUS_TOOLS } from './dangerous-tool.js';
export { auditLogHook } from './audit-log.js';

import { costWarningHook } from './cost-warning.js';
import { dangerousToolHook } from './dangerous-tool.js';
import { auditLogHook } from './audit-log.js';
import type { HookRegistry } from '../registry.js';

/**
 * Register all built-in hooks on a registry.
 */
export function registerBuiltInHooks(registry: HookRegistry): void {
  registry.register(costWarningHook);
  registry.register(dangerousToolHook);
  registry.register(auditLogHook);
}
