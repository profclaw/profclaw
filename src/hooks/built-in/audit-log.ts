/**
 * Built-in Hook: Audit Log
 *
 * Logs all tool executions after they complete (`afterToolCall`).
 * Records: timestamp, sessionId, toolName, sanitized args, success/failure,
 * and duration (if startedAt is provided via metadata).
 */

import { createContextualLogger } from '../../utils/logger.js';
import type { Hook, HookContext, HookResult } from '../registry.js';

const log = createContextualLogger('AuditLog');

/** Keys that should never appear in audit logs */
const SENSITIVE_ARG_KEYS = new Set([
  'password',
  'token',
  'secret',
  'apiKey',
  'api_key',
  'Authorization',
  'authorization',
  'credential',
  'credentials',
  'private_key',
  'privateKey',
]);

function sanitizeArgs(args: unknown): unknown {
  if (args === null || typeof args !== 'object') return args;

  if (Array.isArray(args)) {
    return args.map(sanitizeArgs);
  }

  const record = args as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    sanitized[key] = SENSITIVE_ARG_KEYS.has(key) ? '[REDACTED]' : sanitizeArgs(value);
  }

  return sanitized;
}

function isSuccessResult(result: unknown): boolean {
  if (result === null || result === undefined) return true;
  if (typeof result !== 'object') return true;

  const r = result as Record<string, unknown>;
  if (typeof r.success === 'boolean') return r.success;
  if (r.error !== undefined) return false;

  return true;
}

export const auditLogHook: Hook = {
  name: 'built-in:audit-log',
  point: 'afterToolCall',
  priority: 200, // Run late so other hooks can modify before we record
  handler: async (context: HookContext): Promise<HookResult> => {
    const { toolName, toolArgs, toolResult, sessionId, metadata } = context;

    const timestamp = new Date().toISOString();
    const success = isSuccessResult(toolResult);
    const sanitizedArgs = sanitizeArgs(toolArgs);

    // Duration: caller may pass startedAt (epoch ms) in metadata
    let durationMs: number | undefined;
    if (typeof metadata.toolStartedAt === 'number') {
      durationMs = Date.now() - metadata.toolStartedAt;
    }

    log.info('Tool executed', {
      audit: true,
      timestamp,
      sessionId,
      toolName,
      args: sanitizedArgs,
      success,
      durationMs,
    });

    return {
      proceed: true,
      metadata: {
        auditRecorded: true,
        auditTimestamp: timestamp,
        auditSuccess: success,
        auditDurationMs: durationMs,
      },
    };
  },
};

export default auditLogHook;
