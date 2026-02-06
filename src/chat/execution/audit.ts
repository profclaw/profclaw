/**
 * Audit Logging System
 *
 * Records all tool executions, approvals, and security events.
 * Provides compliance-ready audit trail for tool operations.
 */

import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger.js';

// Types

export type AuditEventType =
  | 'tool_execution'
  | 'approval_requested'
  | 'approval_granted'
  | 'approval_denied'
  | 'approval_expired'
  | 'security_denied'
  | 'rate_limited'
  | 'timeout'
  | 'error';

export interface AuditEntry {
  id: string;
  timestamp: number;
  eventType: AuditEventType;

  // Context
  toolName: string;
  toolCallId: string;
  conversationId: string;
  userId?: string;

  // Execution details
  params?: Record<string, unknown>;
  command?: string;
  securityMode?: string;
  securityLevel?: string;

  // Result
  success?: boolean;
  durationMs?: number;
  exitCode?: number | null;
  error?: string;

  // Output (truncated for storage)
  outputPreview?: string;

  // Approval details
  approvalId?: string;
  approvalDecision?: string;

  // Security details
  denialReason?: string;
  rateLimit?: {
    limit: number;
    remaining: number;
    resetAt: number;
  };
}

export interface AuditFilter {
  eventTypes?: AuditEventType[];
  toolName?: string;
  conversationId?: string;
  userId?: string;
  success?: boolean;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
}

export interface AuditStats {
  totalEvents: number;
  byEventType: Record<AuditEventType, number>;
  byTool: Record<string, number>;
  successRate: number;
  avgDurationMs: number;
  timeRange: {
    earliest: number;
    latest: number;
  };
}

// Constants

const OUTPUT_PREVIEW_LENGTH = 500;
const CLEANUP_THRESHOLD = 11_000;
const ENTRIES_TO_REMOVE = 2_000;

// Audit Logger

export class AuditLogger {
  private entries: AuditEntry[] = [];
  private listeners: Set<(entry: AuditEntry) => void> = new Set();

  /**
   * Log a tool execution event
   */
  logExecution(event: {
    toolName: string;
    toolCallId: string;
    conversationId: string;
    userId?: string;
    params?: Record<string, unknown>;
    command?: string;
    securityMode?: string;
    success: boolean;
    durationMs?: number;
    exitCode?: number | null;
    output?: string;
    error?: string;
  }): AuditEntry {
    const entry = this.createEntry('tool_execution', event);

    if (event.output) {
      entry.outputPreview = this.truncateOutput(event.output);
    }

    return this.addEntry(entry);
  }

  /**
   * Log an approval request
   */
  logApprovalRequested(event: {
    toolName: string;
    toolCallId: string;
    conversationId: string;
    userId?: string;
    approvalId: string;
    command?: string;
    securityLevel: string;
  }): AuditEntry {
    const entry = this.createEntry('approval_requested', event);
    entry.approvalId = event.approvalId;
    entry.securityLevel = event.securityLevel;
    return this.addEntry(entry);
  }

  /**
   * Log an approval decision
   */
  logApprovalDecision(event: {
    toolName: string;
    toolCallId: string;
    conversationId: string;
    userId?: string;
    approvalId: string;
    decision: 'allow-once' | 'allow-always' | 'deny';
  }): AuditEntry {
    const eventType: AuditEventType =
      event.decision === 'deny' ? 'approval_denied' : 'approval_granted';

    const entry = this.createEntry(eventType, event);
    entry.approvalId = event.approvalId;
    entry.approvalDecision = event.decision;
    return this.addEntry(entry);
  }

  /**
   * Log approval expiration
   */
  logApprovalExpired(event: {
    toolName: string;
    toolCallId: string;
    conversationId: string;
    approvalId: string;
  }): AuditEntry {
    const entry = this.createEntry('approval_expired', event);
    entry.approvalId = event.approvalId;
    return this.addEntry(entry);
  }

  /**
   * Log a security denial
   */
  logSecurityDenied(event: {
    toolName: string;
    toolCallId: string;
    conversationId: string;
    userId?: string;
    command?: string;
    securityMode: string;
    reason: string;
  }): AuditEntry {
    const entry = this.createEntry('security_denied', event);
    entry.denialReason = event.reason;
    entry.securityMode = event.securityMode;
    return this.addEntry(entry);
  }

  /**
   * Log rate limiting
   */
  logRateLimited(event: {
    toolName: string;
    toolCallId: string;
    conversationId: string;
    userId?: string;
    limit: number;
    remaining: number;
    resetAt: number;
  }): AuditEntry {
    const entry = this.createEntry('rate_limited', event);
    entry.rateLimit = {
      limit: event.limit,
      remaining: event.remaining,
      resetAt: event.resetAt,
    };
    return this.addEntry(entry);
  }

  /**
   * Log a timeout
   */
  logTimeout(event: {
    toolName: string;
    toolCallId: string;
    conversationId: string;
    userId?: string;
    durationMs: number;
  }): AuditEntry {
    const entry = this.createEntry('timeout', event);
    entry.durationMs = event.durationMs;
    return this.addEntry(entry);
  }

  /**
   * Log an error
   */
  logError(event: {
    toolName: string;
    toolCallId: string;
    conversationId: string;
    userId?: string;
    error: string;
  }): AuditEntry {
    const entry = this.createEntry('error', event);
    entry.error = event.error;
    return this.addEntry(entry);
  }

  /**
   * Query audit entries
   */
  query(filter?: AuditFilter): AuditEntry[] {
    let results = [...this.entries];

    if (filter?.eventTypes?.length) {
      results = results.filter(e => filter.eventTypes!.includes(e.eventType));
    }

    if (filter?.toolName) {
      results = results.filter(e => e.toolName === filter.toolName);
    }

    if (filter?.conversationId) {
      results = results.filter(e => e.conversationId === filter.conversationId);
    }

    if (filter?.userId) {
      results = results.filter(e => e.userId === filter.userId);
    }

    if (filter?.success !== undefined) {
      results = results.filter(e => e.success === filter.success);
    }

    if (filter?.since) {
      results = results.filter(e => e.timestamp >= filter.since!);
    }

    if (filter?.until) {
      results = results.filter(e => e.timestamp <= filter.until!);
    }

    // Sort by timestamp descending (newest first)
    results.sort((a, b) => b.timestamp - a.timestamp);

    // Apply pagination
    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? 100;
    results = results.slice(offset, offset + limit);

    return results;
  }

  /**
   * Get a single entry by ID
   */
  get(id: string): AuditEntry | undefined {
    return this.entries.find(e => e.id === id);
  }

  /**
   * Get audit statistics
   */
  getStats(filter?: { since?: number; until?: number }): AuditStats {
    let entries = [...this.entries];

    if (filter?.since) {
      entries = entries.filter(e => e.timestamp >= filter.since!);
    }
    if (filter?.until) {
      entries = entries.filter(e => e.timestamp <= filter.until!);
    }

    const byEventType: Record<string, number> = {};
    const byTool: Record<string, number> = {};
    let successCount = 0;
    let executionCount = 0;
    let totalDuration = 0;
    let durationCount = 0;

    for (const entry of entries) {
      // Count by event type
      byEventType[entry.eventType] = (byEventType[entry.eventType] ?? 0) + 1;

      // Count by tool
      byTool[entry.toolName] = (byTool[entry.toolName] ?? 0) + 1;

      // Track success rate for executions
      if (entry.eventType === 'tool_execution') {
        executionCount++;
        if (entry.success) successCount++;

        if (entry.durationMs !== undefined) {
          totalDuration += entry.durationMs;
          durationCount++;
        }
      }
    }

    return {
      totalEvents: entries.length,
      byEventType: byEventType as Record<AuditEventType, number>,
      byTool,
      successRate: executionCount > 0 ? (successCount / executionCount) * 100 : 0,
      avgDurationMs: durationCount > 0 ? totalDuration / durationCount : 0,
      timeRange: {
        earliest: entries.length > 0 ? Math.min(...entries.map(e => e.timestamp)) : 0,
        latest: entries.length > 0 ? Math.max(...entries.map(e => e.timestamp)) : 0,
      },
    };
  }

  /**
   * Export entries as CSV
   */
  exportCsv(filter?: AuditFilter): string {
    const entries = this.query(filter);

    const headers = [
      'id',
      'timestamp',
      'eventType',
      'toolName',
      'toolCallId',
      'conversationId',
      'userId',
      'success',
      'durationMs',
      'exitCode',
      'error',
      'approvalId',
      'approvalDecision',
      'denialReason',
    ];

    const rows = entries.map(e => [
      e.id,
      new Date(e.timestamp).toISOString(),
      e.eventType,
      e.toolName,
      e.toolCallId,
      e.conversationId,
      e.userId ?? '',
      e.success?.toString() ?? '',
      e.durationMs?.toString() ?? '',
      e.exitCode?.toString() ?? '',
      this.escapeCsv(e.error ?? ''),
      e.approvalId ?? '',
      e.approvalDecision ?? '',
      this.escapeCsv(e.denialReason ?? ''),
    ]);

    return [
      headers.join(','),
      ...rows.map(r => r.join(',')),
    ].join('\n');
  }

  /**
   * Subscribe to new audit entries
   */
  subscribe(listener: (entry: AuditEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Clear all entries (for testing)
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Get entry count
   */
  get count(): number {
    return this.entries.length;
  }

  // Private Methods

  private createEntry(
    eventType: AuditEventType,
    event: {
      toolName: string;
      toolCallId: string;
      conversationId: string;
      userId?: string;
      params?: Record<string, unknown>;
      command?: string;
      securityMode?: string;
      success?: boolean;
      durationMs?: number;
      exitCode?: number | null;
      error?: string;
    },
  ): AuditEntry {
    return {
      id: randomUUID(),
      timestamp: Date.now(),
      eventType,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      conversationId: event.conversationId,
      userId: event.userId,
      params: this.sanitizeParams(event.params),
      command: event.command,
      securityMode: event.securityMode,
      success: event.success,
      durationMs: event.durationMs,
      exitCode: event.exitCode,
      error: event.error,
    };
  }

  private addEntry(entry: AuditEntry): AuditEntry {
    this.entries.push(entry);

    // Notify listeners
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch (error) {
        logger.error('[Audit] Listener error', error instanceof Error ? error : undefined);
      }
    }

    // Cleanup if too many entries
    if (this.entries.length > CLEANUP_THRESHOLD) {
      this.cleanup();
    }

    return entry;
  }

  private cleanup(): void {
    // Remove oldest entries
    this.entries = this.entries.slice(ENTRIES_TO_REMOVE);
    logger.debug(`[Audit] Cleaned up ${ENTRIES_TO_REMOVE} old entries`, { component: 'AuditLogger' });
  }

  private sanitizeParams(params?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!params) return undefined;

    // Redact sensitive fields
    const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth', 'credential'];
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(params)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some(s => lowerKey.includes(s))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'string' && value.length > 1000) {
        sanitized[key] = value.substring(0, 1000) + '...[truncated]';
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  private truncateOutput(output: string): string {
    if (output.length <= OUTPUT_PREVIEW_LENGTH) {
      return output;
    }
    return output.substring(0, OUTPUT_PREVIEW_LENGTH) + '...[truncated]';
  }

  private escapeCsv(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}

// Singleton

let auditLogger: AuditLogger | null = null;

export function getAuditLogger(): AuditLogger {
  if (!auditLogger) {
    auditLogger = new AuditLogger();
  }
  return auditLogger;
}

export function initAuditLogger(): AuditLogger {
  auditLogger = new AuditLogger();
  return auditLogger;
}
