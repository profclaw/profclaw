/**
 * Permission Dialog System
 *
 * Manages per-session tool permissions with configurable rules.
 * Dangerous tools always prompt; cautious tools prompt once then remember;
 * safe tools (or unknown tools) are auto-allowed.
 */

import { createContextualLogger } from '../utils/logger.js';

const log = createContextualLogger('PermissionManager');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PermissionLevel = 'safe' | 'cautious' | 'dangerous';
export type PermissionResponse = 'allow' | 'deny' | 'always_allow' | 'always_deny';

export interface PermissionRule {
  toolName: string;
  level: PermissionLevel;
  reason: string;
}

export interface PermissionState {
  /** Tools permanently allowed for this session */
  autoAllow: Set<string>;
  /** Tools permanently denied for this session */
  autoDeny: Set<string>;
}

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Default rules
// ---------------------------------------------------------------------------

export const DEFAULT_PERMISSION_RULES: PermissionRule[] = [
  // Dangerous — always ask
  { toolName: 'bash', level: 'dangerous', reason: 'Executes arbitrary shell commands' },
  { toolName: 'exec', level: 'dangerous', reason: 'Executes arbitrary shell commands' },
  { toolName: 'delete_file', level: 'dangerous', reason: 'Permanently deletes files' },
  { toolName: 'git_push', level: 'dangerous', reason: 'Pushes changes to remote repository' },
  {
    toolName: 'git_force_push',
    level: 'dangerous',
    reason: 'Force pushes, potentially losing remote changes',
  },

  // Cautious — ask first time, then remember
  { toolName: 'write_file', level: 'cautious', reason: 'Modifies files on disk' },
  { toolName: 'patch_file', level: 'cautious', reason: 'Modifies files on disk' },
  { toolName: 'move_file', level: 'cautious', reason: 'Moves/renames files' },
  { toolName: 'git_commit', level: 'cautious', reason: 'Creates git commits' },
  { toolName: 'git_branch', level: 'cautious', reason: 'Creates/switches git branches' },

  // Safe — auto-allow (read_file, search_files, git_status, git_diff, etc.)
];

// ---------------------------------------------------------------------------
// PermissionManager
// ---------------------------------------------------------------------------

type PromptCallback = (
  toolName: string,
  args: unknown,
  rule: PermissionRule,
) => Promise<PermissionResponse>;

export class PermissionManager {
  private state: PermissionState;
  private rules: Map<string, PermissionRule>;
  private promptCallback?: PromptCallback;

  constructor(rules: PermissionRule[] = DEFAULT_PERMISSION_RULES) {
    this.state = {
      autoAllow: new Set<string>(),
      autoDeny: new Set<string>(),
    };

    this.rules = new Map<string, PermissionRule>();
    for (const rule of rules) {
      this.rules.set(rule.toolName, rule);
    }
  }

  /**
   * Register the interactive prompt callback.
   * Without this, all tools (including dangerous ones) are allowed — non-interactive mode.
   */
  setPromptCallback(cb: PromptCallback): void {
    this.promptCallback = cb;
  }

  /**
   * Check whether a tool call is permitted.
   *
   * Resolution order:
   * 1. autoAllow set  → allowed immediately
   * 2. autoDeny set   → denied immediately
   * 3. No rule / safe → allowed
   * 4. cautious/dangerous → invoke promptCallback
   *    - allow       → allow once
   *    - deny        → deny once
   *    - always_allow → add to autoAllow, allow
   *    - always_deny  → add to autoDeny, deny
   * 5. No callback registered → allow (non-interactive)
   */
  async check(toolName: string, args?: unknown): Promise<PermissionCheckResult> {
    // 1. Session-level auto-allow
    if (this.state.autoAllow.has(toolName)) {
      log.debug('Tool auto-allowed (session rule)', { tool: toolName });
      return { allowed: true };
    }

    // 2. Session-level auto-deny
    if (this.state.autoDeny.has(toolName)) {
      log.info('Tool auto-denied (session rule)', { tool: toolName });
      return { allowed: false, reason: `Tool "${toolName}" has been denied for this session` };
    }

    // 3. Look up permission rule
    const rule = this.rules.get(toolName);
    if (!rule || rule.level === 'safe') {
      return { allowed: true };
    }

    // 4. cautious or dangerous — need user confirmation
    if (!this.promptCallback) {
      // Non-interactive mode: allow but log
      log.warn('No prompt callback registered — allowing tool in non-interactive mode', {
        tool: toolName,
        level: rule.level,
      });
      return { allowed: true };
    }

    log.debug('Prompting user for permission', { tool: toolName, level: rule.level });

    let response: PermissionResponse;
    try {
      response = await this.promptCallback(toolName, args, rule);
    } catch (error) {
      log.error('[PermissionManager] Prompt callback threw', {
        tool: toolName,
        error: error instanceof Error ? error.message : String(error),
      });
      // Fail-safe: deny on callback error
      return { allowed: false, reason: 'Permission prompt failed' };
    }

    switch (response) {
      case 'allow':
        log.debug('User allowed tool (once)', { tool: toolName });
        return { allowed: true };

      case 'deny':
        log.info('User denied tool (once)', { tool: toolName });
        return { allowed: false, reason: `User denied "${toolName}"` };

      case 'always_allow':
        this.state.autoAllow.add(toolName);
        log.info('User always-allowed tool for session', { tool: toolName });
        return { allowed: true };

      case 'always_deny':
        this.state.autoDeny.add(toolName);
        log.info('User always-denied tool for session', { tool: toolName });
        return { allowed: false, reason: `User permanently denied "${toolName}" for this session` };
    }
  }

  /**
   * Return the permission level for a tool, or 'safe' if no rule exists.
   */
  getLevel(toolName: string): PermissionLevel {
    return this.rules.get(toolName)?.level ?? 'safe';
  }

  /**
   * Clear session-level autoAllow/autoDeny sets.
   * Useful when starting a fresh session without constructing a new manager.
   */
  reset(): void {
    this.state.autoAllow.clear();
    this.state.autoDeny.clear();
    log.debug('PermissionManager session state reset');
  }
}
