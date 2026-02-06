/**
 * Security Policy System
 *
 * Enforces security policies for tool execution.
 * Handles allowlist matching, approval workflows, and sandboxing.
 */

import { minimatch } from 'minimatch';
import type {
  SecurityPolicy,
  AllowlistEntry,
  ToolDefinition,
  ApprovalRequest,
  ApprovalDecision,
  ApprovalResponse,
  DMPairingSession,
  ChannelAllowlistEntry,
  ExecApprovalPolicy,
  PluginAllowlistEntry,
  PluginPermission,
  ChannelPolicy,
  SecurityRiskLevel,
  SecurityRiskAnalysis,
  SecurityRiskFactor,
} from './types.js';
import { logger } from '../../utils/logger.js';
import { randomUUID, randomInt } from 'crypto';

// Constants

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

interface SecurityCheckContext {
  conversationId: string;
  toolCallId: string;
  userId?: string;
  channelId?: string;
}

// Security Policy Manager

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
    context: SecurityCheckContext,
  ): Promise<SecurityCheckResult> {
    const command = this.extractCommand(tool, params);

    // Check granular exec policies first (highest priority override)
    const execPolicy = this.evaluateExecPolicies(
      tool.name,
      command,
      { userId: context.userId, channelId: context.channelId },
    );
    if (execPolicy) {
      if (execPolicy.action === 'allow') {
        return { allowed: true, requiresApproval: false };
      }
      if (execPolicy.action === 'deny') {
        return { allowed: false, reason: `Blocked by policy: ${execPolicy.name}`, requiresApproval: false };
      }
      if (execPolicy.action === 'sandbox') {
        return { allowed: true, requiresApproval: false, sandboxRequired: true };
      }
      if (execPolicy.action === 'ask') {
        return { allowed: false, reason: `Policy requires approval: ${execPolicy.name}`, requiresApproval: true, securityLevel: 'moderate' };
      }
    }

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

  // Feature 1: DM Pairing Mode

  private pairingSessions: Map<string, DMPairingSession> = new Map();

  /**
   * Generate a pairing code for an unknown DM sender
   */
  generatePairingCode(senderId: string, channelProvider: string): DMPairingSession {
    const config = this.policy.dmPairing ?? {
      enabled: true,
      codeLength: 6,
      codeExpiryMs: 300_000,
      maxAttempts: 3,
      trustedSenders: [],
    };

    // Check if sender is already trusted
    if (config.trustedSenders.includes(senderId)) {
      return {
        code: '',
        senderId,
        channelProvider,
        createdAt: Date.now(),
        expiresAt: Date.now(),
        attempts: 0,
        verified: true,
      };
    }

    // Generate numeric code
    const max = Math.pow(10, config.codeLength);
    const code = String(randomInt(max)).padStart(config.codeLength, '0');

    const session: DMPairingSession = {
      code,
      senderId,
      channelProvider,
      createdAt: Date.now(),
      expiresAt: Date.now() + config.codeExpiryMs,
      attempts: 0,
      verified: false,
    };

    this.pairingSessions.set(`${channelProvider}:${senderId}`, session);
    logger.info(`[Security] Pairing code generated for ${channelProvider}:${senderId}`, { component: 'Security' });
    return session;
  }

  /**
   * Verify a pairing code from a DM sender
   */
  verifyPairingCode(senderId: string, channelProvider: string, code: string): boolean {
    const key = `${channelProvider}:${senderId}`;
    const session = this.pairingSessions.get(key);

    if (!session) return false;
    if (session.verified) return true;
    if (Date.now() > session.expiresAt) {
      this.pairingSessions.delete(key);
      return false;
    }

    session.attempts++;
    const maxAttempts = this.policy.dmPairing?.maxAttempts ?? 3;

    if (session.attempts > maxAttempts) {
      this.pairingSessions.delete(key);
      logger.warn(`[Security] Pairing max attempts exceeded for ${key}`, { component: 'Security' });
      return false;
    }

    if (session.code === code) {
      session.verified = true;
      // Auto-add to trusted senders
      if (this.policy.dmPairing) {
        this.policy.dmPairing.trustedSenders.push(senderId);
      }
      logger.info(`[Security] Pairing verified for ${key}`, { component: 'Security' });
      return true;
    }

    return false;
  }

  /**
   * Check if a DM sender is trusted
   */
  isDMSenderTrusted(senderId: string): boolean {
    return this.policy.dmPairing?.trustedSenders.includes(senderId) ?? false;
  }

  // Feature 2: Channel Allowlist Management

  /**
   * Add a channel to the allowlist
   */
  addChannelToAllowlist(entry: ChannelAllowlistEntry): void {
    if (!this.policy.channelAllowlist) {
      this.policy.channelAllowlist = [];
    }

    const exists = this.policy.channelAllowlist.some(
      (e) => e.channelId === entry.channelId && e.provider === entry.provider,
    );

    if (!exists) {
      this.policy.channelAllowlist.push(entry);
      logger.info(`[Security] Channel added to allowlist: ${entry.provider}/${entry.channelId}`, { component: 'Security' });
    }
  }

  /**
   * Remove a channel from the allowlist
   */
  removeChannelFromAllowlist(channelId: string, provider: string): boolean {
    if (!this.policy.channelAllowlist) return false;
    const before = this.policy.channelAllowlist.length;
    this.policy.channelAllowlist = this.policy.channelAllowlist.filter(
      (e) => !(e.channelId === channelId && e.provider === provider),
    );
    return this.policy.channelAllowlist.length < before;
  }

  /**
   * Check if a channel is allowed to send messages
   */
  isChannelAllowed(channelId: string, provider: string): boolean {
    // If no allowlist configured, all channels are allowed
    if (!this.policy.channelAllowlist?.length) return true;
    return this.policy.channelAllowlist.some(
      (e) => e.channelId === channelId && e.provider === provider && e.enabled,
    );
  }

  /**
   * Get the channel allowlist
   */
  getChannelAllowlist(): ChannelAllowlistEntry[] {
    return [...(this.policy.channelAllowlist ?? [])];
  }

  // Feature 3: Granular Exec Approval Policies

  /**
   * Add a granular exec approval policy
   */
  addExecPolicy(policy: ExecApprovalPolicy): void {
    if (!this.policy.execPolicies) {
      this.policy.execPolicies = [];
    }
    // Remove existing with same ID
    this.policy.execPolicies = this.policy.execPolicies.filter((p) => p.id !== policy.id);
    this.policy.execPolicies.push(policy);
    // Sort by priority descending
    this.policy.execPolicies.sort((a, b) => b.priority - a.priority);
    logger.info(`[Security] Exec policy added: ${policy.name} (priority ${policy.priority})`, { component: 'Security' });
  }

  /**
   * Remove an exec approval policy
   */
  removeExecPolicy(policyId: string): boolean {
    if (!this.policy.execPolicies) return false;
    const before = this.policy.execPolicies.length;
    this.policy.execPolicies = this.policy.execPolicies.filter((p) => p.id !== policyId);
    return this.policy.execPolicies.length < before;
  }

  /**
   * Evaluate granular exec policies for a tool call
   */
  evaluateExecPolicies(
    toolName: string,
    command: string | null,
    context: { userId?: string; channelId?: string },
  ): ExecApprovalPolicy | null {
    if (!this.policy.execPolicies?.length) return null;

    for (const policy of this.policy.execPolicies) {
      if (!policy.enabled) continue;

      let matches = true;

      // Check tool match
      if (policy.match.tools?.length) {
        matches = matches && policy.match.tools.includes(toolName);
      }

      // Check command match
      if (policy.match.commands?.length && command) {
        matches = matches && policy.match.commands.some((p) => minimatch(command, p));
      }

      // Check user match
      if (policy.match.users?.length && context.userId) {
        matches = matches && policy.match.users.includes(context.userId);
      }

      // Check channel match
      if (policy.match.channels?.length && context.channelId) {
        matches = matches && policy.match.channels.includes(context.channelId);
      }

      if (matches) return policy;
    }

    return null;
  }

  /**
   * Get all exec policies
   */
  getExecPolicies(): ExecApprovalPolicy[] {
    return [...(this.policy.execPolicies ?? [])];
  }

  // Feature 4: Plugin Allowlisting

  /**
   * Add a plugin to the allowlist
   */
  addPluginToAllowlist(entry: PluginAllowlistEntry): void {
    if (!this.policy.pluginAllowlist) {
      this.policy.pluginAllowlist = [];
    }
    this.policy.pluginAllowlist = this.policy.pluginAllowlist.filter(
      (p) => p.pluginId !== entry.pluginId,
    );
    this.policy.pluginAllowlist.push(entry);
    logger.info(`[Security] Plugin allowlisted: ${entry.name} (${entry.pluginId})`, { component: 'Security' });
  }

  /**
   * Remove a plugin from the allowlist
   */
  removePluginFromAllowlist(pluginId: string): boolean {
    if (!this.policy.pluginAllowlist) return false;
    const before = this.policy.pluginAllowlist.length;
    this.policy.pluginAllowlist = this.policy.pluginAllowlist.filter((p) => p.pluginId !== pluginId);
    return this.policy.pluginAllowlist.length < before;
  }

  /**
   * Check if a plugin is allowed and has a specific permission
   */
  isPluginAllowed(pluginId: string, permission?: PluginPermission): boolean {
    if (!this.policy.pluginAllowlist?.length) return false;
    const entry = this.policy.pluginAllowlist.find((p) => p.pluginId === pluginId);
    if (!entry) return false;
    if (!permission) return entry.trusted;
    return entry.trusted && entry.permissions.includes(permission);
  }

  /**
   * Get the plugin allowlist
   */
  getPluginAllowlist(): PluginAllowlistEntry[] {
    return [...(this.policy.pluginAllowlist ?? [])];
  }

  // Feature 5: Security Risk Analyzer

  /**
   * Analyze the security risk of a tool call
   * Rule-based (no LLM needed) with weighted scoring
   */
  analyzeRisk(
    tool: ToolDefinition,
    params: Record<string, unknown>,
  ): SecurityRiskAnalysis {
    const factors: SecurityRiskFactor[] = [];
    const command = this.extractCommand(tool, params);

    // Factor 1: Tool security level
    factors.push({
      name: 'tool_security_level',
      weight: 25,
      detected: tool.securityLevel === 'dangerous',
      detail: `Tool security level: ${tool.securityLevel}`,
    });

    // Factor 2: Dangerous command patterns
    const hasDangerousPattern = command ? this.isDangerousCommand(command) : false;
    factors.push({
      name: 'dangerous_pattern',
      weight: 35,
      detected: hasDangerousPattern,
      detail: hasDangerousPattern ? 'Command matches dangerous pattern' : undefined,
    });

    // Factor 3: Requires approval flag
    factors.push({
      name: 'requires_approval',
      weight: 15,
      detected: tool.requiresApproval === true,
      detail: tool.requiresApproval ? 'Tool explicitly requires approval' : undefined,
    });

    // Factor 4: Network access
    const hasNetworkAccess = ['web_fetch', 'web_search', 'browser_navigate'].includes(tool.name)
      || (command && /curl|wget|ssh|scp|rsync/i.test(command));
    factors.push({
      name: 'network_access',
      weight: 10,
      detected: !!hasNetworkAccess,
      detail: hasNetworkAccess ? 'Tool accesses network resources' : undefined,
    });

    // Factor 5: File system write access
    const hasFileWrite = ['write_file', 'edit_file', 'patch_apply'].includes(tool.name)
      || (command && />\s|tee\s|mv\s|cp\s|rm\s/i.test(command));
    factors.push({
      name: 'filesystem_write',
      weight: 15,
      detected: !!hasFileWrite,
      detail: hasFileWrite ? 'Tool can modify filesystem' : undefined,
    });

    // Calculate score
    const score = factors.reduce((total, f) => total + (f.detected ? f.weight : 0), 0);

    // Determine risk level
    let level: SecurityRiskLevel;
    let recommendation: 'allow' | 'review' | 'deny';

    if (score >= 60) {
      level = 'CRITICAL';
      recommendation = 'deny';
    } else if (score >= 40) {
      level = 'HIGH';
      recommendation = 'review';
    } else if (score >= 20) {
      level = 'MEDIUM';
      recommendation = 'review';
    } else {
      level = 'LOW';
      recommendation = 'allow';
    }

    const explanation = this.buildRiskExplanation(level, factors.filter((f) => f.detected));

    return { level, score, factors, recommendation, explanation };
  }

  private buildRiskExplanation(level: SecurityRiskLevel, activeFactors: SecurityRiskFactor[]): string {
    if (activeFactors.length === 0) {
      return 'No security risk factors detected.';
    }
    const factorNames = activeFactors.map((f) => f.detail ?? f.name).join('; ');
    return `Risk level ${level}: ${factorNames}`;
  }

  // Feature 6: Per-Channel Retry/Timeout Policies

  /**
   * Set a per-channel policy
   */
  setChannelPolicy(policy: ChannelPolicy): void {
    if (!this.policy.channelPolicies) {
      this.policy.channelPolicies = [];
    }
    this.policy.channelPolicies = this.policy.channelPolicies.filter(
      (p) => !(p.channelId === policy.channelId && p.provider === policy.provider),
    );
    this.policy.channelPolicies.push(policy);
    logger.info(`[Security] Channel policy set: ${policy.provider}/${policy.channelId}`, { component: 'Security' });
  }

  /**
   * Get a per-channel policy
   */
  getChannelPolicy(channelId: string, provider: string): ChannelPolicy | null {
    return this.policy.channelPolicies?.find(
      (p) => p.channelId === channelId && p.provider === provider,
    ) ?? null;
  }

  /**
   * Remove a per-channel policy
   */
  removeChannelPolicy(channelId: string, provider: string): boolean {
    if (!this.policy.channelPolicies) return false;
    const before = this.policy.channelPolicies.length;
    this.policy.channelPolicies = this.policy.channelPolicies.filter(
      (p) => !(p.channelId === channelId && p.provider === provider),
    );
    return this.policy.channelPolicies.length < before;
  }

  /**
   * Get all channel policies
   */
  getChannelPolicies(): ChannelPolicy[] {
    return [...(this.policy.channelPolicies ?? [])];
  }

  /**
   * Get effective timeout for a channel (falls back to default)
   */
  getEffectiveTimeout(channelId: string, provider: string): number {
    const policy = this.getChannelPolicy(channelId, provider);
    return policy?.timeoutMs ?? 300_000;
  }

  /**
   * Get effective retry config for a channel
   */
  getEffectiveRetryConfig(channelId: string, provider: string): { attempts: number; delayMs: number } {
    const policy = this.getChannelPolicy(channelId, provider);
    return {
      attempts: policy?.retryAttempts ?? 3,
      delayMs: policy?.retryDelayMs ?? 1000,
    };
  }

  // Private Methods

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

// Types

export interface SecurityCheckResult {
  allowed: boolean;
  reason?: string;
  requiresApproval: boolean;
  securityLevel?: 'moderate' | 'dangerous';
  sandboxRequired?: boolean;
}

// Singleton

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
