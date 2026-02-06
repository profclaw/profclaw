/**
 * Security Policy System
 *
 * Enforces security policies for tool execution.
 * Handles allowlist matching, approval workflows, and sandboxing.
 */

import { minimatch } from 'minimatch';
import type {
  SecurityMode,
  SecurityPolicy,
  AllowlistEntry,
  ToolDefinition,
  ApprovalRequest,
  ApprovalDecision,
  ApprovalResponse,
} from './types.js';
import { logger } from '../../utils/logger.js';
import { randomUUID } from 'crypto';

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_ASK_TIMEOUT_MS = 120_000; // 2 minutes
const APPROVAL_CLEANUP_INTERVAL_MS = 60_000; // 1 minute
const MAX_PENDING_APPROVALS = 100;

// Dangerous patterns that always require approval
const DANGEROUS_PATTERNS = [
  /rm\s+-rf?\s+\//i,          // rm -rf /
  /sudo\s+/i,                  // sudo commands
  /chmod\s+777/i,              // chmod 777
  /curl.*\|\s*sh/i,            // curl | sh (piped execution)
  /wget.*\|\s*sh/i,            // wget | sh
  /eval\s*\(/i,                // eval()
  />(\/etc|\/var|\/usr)/i,     // redirect to system dirs
  /\$\(.*\)/,                  // command substitution
  /`.*`/,                      // backtick execution
];

// Safe commands that don't need approval in allowlist mode
const SAFE_COMMANDS = new Set([
  'ls', 'pwd', 'echo', 'cat', 'head', 'tail', 'grep', 'find',
  'wc', 'sort', 'uniq', 'diff', 'date', 'whoami', 'hostname',
  'uname', 'env', 'printenv', 'which', 'type', 'file',
  'node', 'npm', 'pnpm', 'yarn', 'npx', 'bun',
  'python', 'python3', 'pip', 'pip3',
  'git', 'gh',
  'curl', 'wget', // when not piped to sh
  'jq', 'yq',
]);

// =============================================================================
// Security Policy Manager
// =============================================================================

export class SecurityPolicyManager {
  private policy: SecurityPolicy;
  private pendingApprovals: Map<string, ApprovalRequest> = new Map();
  private approvalResolvers: Map<string, (decision: ApprovalDecision | null) => void> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(policy?: Partial<SecurityPolicy>) {
    this.policy = {
      mode: policy?.mode ?? 'full',
      allowlist: policy?.allowlist ?? [],
      askTimeout: policy?.askTimeout ?? DEFAULT_ASK_TIMEOUT_MS,
      sandboxConfig: policy?.sandboxConfig,
    };

    // Start cleanup timer
    this.cleanupTimer = setInterval(() => this.cleanupExpiredApprovals(), APPROVAL_CLEANUP_INTERVAL_MS);
  }

  /**
   * Check if a tool call is allowed based on security policy
   */
  async checkPermission(
    tool: ToolDefinition,
    params: Record<string, unknown>,
    context: { conversationId: string; toolCallId: string },
  ): Promise<SecurityCheckResult> {
    const command = this.extractCommand(tool, params);

    // Deny mode blocks everything
    if (this.policy.mode === 'deny') {
      return {
        allowed: false,
        reason: 'Tool execution is disabled (security mode: deny)',
        requiresApproval: false,
      };
    }

    // Full mode allows everything
    if (this.policy.mode === 'full') {
      logger.warn(`[Security] Full mode: allowing ${tool.name} without checks`, { component: 'Security' });
      return { allowed: true, requiresApproval: false };
    }

    // Check for dangerous patterns first
    if (command && this.isDangerousCommand(command)) {
      if (this.policy.mode === 'sandbox') {
        // Allow in sandbox but log warning
        logger.warn(`[Security] Dangerous command in sandbox: ${command}`, { component: 'Security' });
        return { allowed: true, requiresApproval: false, sandboxRequired: true };
      }

      // Always require approval for dangerous commands
      return {
        allowed: false,
        reason: 'Command matches dangerous pattern',
        requiresApproval: true,
        securityLevel: 'dangerous',
      };
    }

    // Sandbox mode - allow everything in container
    if (this.policy.mode === 'sandbox') {
      return { allowed: true, requiresApproval: false, sandboxRequired: true };
    }

    // Allowlist mode - check against patterns
    if (this.policy.mode === 'allowlist') {
      // Check if tool/command is in allowlist
      if (this.isAllowlisted(tool, params, command)) {
        return { allowed: true, requiresApproval: false };
      }

      // Safe commands pass without allowlist
      if (command && this.isSafeCommand(command)) {
        return { allowed: true, requiresApproval: false };
      }

      // Not in allowlist - requires approval
      return {
        allowed: false,
        reason: 'Not in allowlist',
        requiresApproval: true,
        securityLevel: tool.securityLevel === 'dangerous' ? 'dangerous' : 'moderate',
      };
    }

    // Ask mode - require approval for non-safe tools
    if (this.policy.mode === 'ask') {
      // Safe tools don't need approval
      if (tool.securityLevel === 'safe' && (!command || this.isSafeCommand(command))) {
        return { allowed: true, requiresApproval: false };
      }

      // Everything else needs approval
      return {
        allowed: false,
        reason: 'Approval required',
        requiresApproval: true,
        securityLevel: tool.securityLevel === 'dangerous' ? 'dangerous' : 'moderate',
      };
    }

    // Default deny
    return {
      allowed: false,
      reason: 'Unknown security mode',
      requiresApproval: false,
    };
  }

  /**
   * Create an approval request
   */
  createApprovalRequest(
    tool: ToolDefinition,
    params: Record<string, unknown>,
    context: { conversationId: string; toolCallId: string },
    securityLevel: 'moderate' | 'dangerous',
  ): ApprovalRequest {
    // Limit pending approvals
    if (this.pendingApprovals.size >= MAX_PENDING_APPROVALS) {
      this.cleanupOldestApprovals(10);
    }

    const request: ApprovalRequest = {
      id: randomUUID(),
      toolCallId: context.toolCallId,
      toolName: tool.name,
      conversationId: context.conversationId,
      command: this.extractCommand(tool, params) ?? undefined,
      params,
      securityLevel,
      createdAt: Date.now(),
      expiresAt: Date.now() + (this.policy.askTimeout ?? DEFAULT_ASK_TIMEOUT_MS),
      status: 'pending',
    };

    this.pendingApprovals.set(request.id, request);
    logger.info(`[Security] Approval request created: ${request.id} for ${tool.name}`, { component: 'Security' });

    return request;
  }

  /**
   * Wait for user approval
   */
  async waitForApproval(requestId: string): Promise<ApprovalDecision | null> {
    const request = this.pendingApprovals.get(requestId);
    if (!request) {
      return null;
    }

    return new Promise((resolve) => {
      // Set up timeout
      const timeoutMs = request.expiresAt - Date.now();
      const timeout = setTimeout(() => {
        this.handleApprovalTimeout(requestId);
        resolve(null);
      }, Math.max(timeoutMs, 0));

      // Store resolver for when user responds
      this.approvalResolvers.set(requestId, (decision) => {
        clearTimeout(timeout);
        resolve(decision);
      });
    });
  }

  /**
   * Handle user's approval response
   */
  handleApprovalResponse(response: ApprovalResponse): boolean {
    const request = this.pendingApprovals.get(response.requestId);
    if (!request || request.status !== 'pending') {
      return false;
    }

    request.status = response.decision === 'deny' ? 'denied' : 'approved';
    request.decision = response.decision;
    request.decidedAt = Date.now();
    request.decidedBy = response.userId;

    // If allow-always, add to allowlist
    if (response.decision === 'allow-always' && request.command) {
      this.addToAllowlist({
        pattern: this.normalizeCommandPattern(request.command),
        type: 'command',
        description: `Auto-added from approval: ${request.toolName}`,
        addedAt: new Date().toISOString(),
        addedBy: response.userId,
      });
    }

    // Resolve any waiting promise
    const resolver = this.approvalResolvers.get(response.requestId);
    if (resolver) {
      resolver(response.decision);
      this.approvalResolvers.delete(response.requestId);
    }

    logger.info(`[Security] Approval ${response.decision}: ${request.id}`, { component: 'Security' });
    return true;
  }

  /**
   * Get pending approval requests for a conversation
   */
  getPendingApprovals(conversationId?: string): ApprovalRequest[] {
    const approvals = Array.from(this.pendingApprovals.values())
      .filter((r) => r.status === 'pending');

    if (conversationId) {
      return approvals.filter((r) => r.conversationId === conversationId);
    }
    return approvals;
  }

  /**
   * Get current security policy
   */
  getPolicy(): SecurityPolicy {
    return { ...this.policy };
  }

  /**
   * Update security policy
   */
  updatePolicy(updates: Partial<SecurityPolicy>): void {
    this.policy = { ...this.policy, ...updates };
    logger.info(`[Security] Policy updated: mode=${this.policy.mode}`, { component: 'Security' });
  }

  /**
   * Add entry to allowlist
   */
  addToAllowlist(entry: AllowlistEntry): void {
    // Check for duplicates
    const exists = this.policy.allowlist?.some((e) => e.pattern === entry.pattern);
    if (!exists) {
      this.policy.allowlist = [...(this.policy.allowlist ?? []), entry];
      logger.info(`[Security] Added to allowlist: ${entry.pattern}`, { component: 'Security' });
    }
  }

  /**
   * Remove entry from allowlist
   */
  removeFromAllowlist(pattern: string): boolean {
    const before = this.policy.allowlist?.length ?? 0;
    this.policy.allowlist = this.policy.allowlist?.filter((e) => e.pattern !== pattern);
    return (this.policy.allowlist?.length ?? 0) < before;
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.pendingApprovals.clear();
    this.approvalResolvers.clear();
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private extractCommand(tool: ToolDefinition, params: Record<string, unknown>): string | null {
    // For exec-like tools, extract the command
    if (tool.name === 'exec' || tool.name === 'bash' || tool.name === 'shell') {
      return (params.command as string) ?? null;
    }
    return null;
  }

  private isDangerousCommand(command: string): boolean {
    return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
  }

  private isSafeCommand(command: string): boolean {
    // Extract the base command (first word)
    const baseCommand = command.trim().split(/\s+/)[0];
    if (!baseCommand) return false;

    // Check if it's in the safe list
    return SAFE_COMMANDS.has(baseCommand);
  }

  private isAllowlisted(
    tool: ToolDefinition,
    params: Record<string, unknown>,
    command: string | null,
  ): boolean {
    if (!this.policy.allowlist?.length) return false;

    for (const entry of this.policy.allowlist) {
      // Check tool name
      if (entry.type === 'command' && entry.pattern === `tool:${tool.name}`) {
        return true;
      }

      // Check command pattern
      if (command && entry.type === 'command') {
        if (minimatch(command, entry.pattern) || command.startsWith(entry.pattern)) {
          return true;
        }
      }

      // Check URL patterns for web tools
      if (entry.type === 'url' && params.url) {
        if (minimatch(params.url as string, entry.pattern)) {
          return true;
        }
      }

      // Check path patterns for file tools
      if (entry.type === 'path' && (params.path || params.file_path)) {
        const path = (params.path ?? params.file_path) as string;
        if (minimatch(path, entry.pattern)) {
          return true;
        }
      }
    }

    return false;
  }

  private normalizeCommandPattern(command: string): string {
    // Extract base command and create a pattern
    const parts = command.trim().split(/\s+/);
    const base = parts[0];

    // For simple commands, use the base command
    if (parts.length === 1) {
      return `${base}*`;
    }

    // For commands with args, try to create a sensible pattern
    return `${base} *`;
  }

  private handleApprovalTimeout(requestId: string): void {
    const request = this.pendingApprovals.get(requestId);
    if (request && request.status === 'pending') {
      request.status = 'expired';
      logger.info(`[Security] Approval expired: ${requestId}`, { component: 'Security' });
    }

    const resolver = this.approvalResolvers.get(requestId);
    if (resolver) {
      resolver(null);
      this.approvalResolvers.delete(requestId);
    }
  }

  private cleanupExpiredApprovals(): void {
    const now = Date.now();
    const expired: string[] = [];

    for (const [id, request] of this.pendingApprovals) {
      if (request.status !== 'pending' && now - request.createdAt > 300_000) {
        // Remove completed approvals after 5 minutes
        expired.push(id);
      } else if (request.expiresAt < now && request.status === 'pending') {
        // Mark pending as expired
        this.handleApprovalTimeout(id);
      }
    }

    for (const id of expired) {
      this.pendingApprovals.delete(id);
    }
  }

  private cleanupOldestApprovals(count: number): void {
    const sorted = Array.from(this.pendingApprovals.entries())
      .sort((a, b) => a[1].createdAt - b[1].createdAt);

    for (let i = 0; i < count && i < sorted.length; i++) {
      this.pendingApprovals.delete(sorted[i][0]);
    }
  }
}

// =============================================================================
// Types
// =============================================================================

export interface SecurityCheckResult {
  allowed: boolean;
  reason?: string;
  requiresApproval: boolean;
  securityLevel?: 'moderate' | 'dangerous';
  sandboxRequired?: boolean;
}

// =============================================================================
// Singleton
// =============================================================================

let securityManager: SecurityPolicyManager | null = null;

export function getSecurityManager(): SecurityPolicyManager {
  if (!securityManager) {
    securityManager = new SecurityPolicyManager();
  }
  return securityManager;
}

export function initSecurityManager(policy?: Partial<SecurityPolicy>): SecurityPolicyManager {
  if (securityManager) {
    securityManager.destroy();
  }
  securityManager = new SecurityPolicyManager(policy);
  return securityManager;
}
