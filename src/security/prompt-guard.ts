/**
 * Prompt Injection Guard
 *
 * Detects prompt injection and jailbreak attempts in user input.
 * Features:
 * - Jailbreak pattern detection (~15 patterns)
 * - Canary token system for system prompt leak detection
 * - Input length limiting
 * - Risk scoring with configurable thresholds
 */

import { randomBytes } from 'crypto';
import { logger } from '../utils/logger.js';
import type { GuardResult, PromptGuardConfig, CanaryToken, RiskLevel } from './types.js';

// =============================================================================
// Default Patterns
// =============================================================================

const DEFAULT_JAILBREAK_PATTERNS: RegExp[] = [
  // Direct instruction override
  /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions|prompts|rules)/i,
  /disregard\s+(all\s+)?(previous|above|prior)\s+(instructions|prompts|rules)/i,
  /forget\s+(all\s+)?(previous|above|prior)\s+(instructions|prompts|rules)/i,

  // DAN / jailbreak persona
  /you\s+are\s+now\s+(DAN|jailbroken|unfiltered|unrestricted)/i,
  /act\s+as\s+(DAN|an?\s+unrestricted|an?\s+unfiltered)/i,
  /pretend\s+(you\s+are|to\s+be)\s+(a|an)\s+(unrestricted|unfiltered)/i,
  /enter\s+(DAN|jailbreak|developer)\s+mode/i,

  // System prompt extraction
  /(reveal|show|print|output|display|repeat)\s+(your|the)\s+(system|initial|original)\s+(prompt|instructions|message)/i,
  /what\s+(are|is|were)\s+your\s+(system|initial|original)\s+(prompt|instructions)/i,

  // Injection delimiters (trying to inject system/assistant messages)
  /\[system\]|\[INST\]|<\|im_start\|>|<<SYS>>|<\|system\|>/i,
  /\[\/INST\]|<\|im_end\|>|<\|assistant\|>/i,

  // Base64-encoded instruction injection
  /(?:execute|run|decode|eval)\s+(?:the\s+)?(?:following\s+)?base64/i,
  /aWdub3JlIGFsbCBwcmV2aW91cw/, // "ignore all previous" in base64

  // Prompt leaking via formatting tricks
  /translate\s+(?:the\s+)?(?:above|previous|system)\s+(?:text|prompt|instructions)\s+(?:into|to)/i,

  // Token smuggling / boundary attacks
  /\x00|\x1b\[|\x08/,  // null bytes, ANSI escapes, backspace chars
];

// Score weights for different pattern types
const PATTERN_SCORES: Array<{ indices: number[]; score: number; description: string }> = [
  { indices: [0, 1, 2], score: 30, description: 'Instruction override attempt' },
  { indices: [3, 4, 5, 6], score: 35, description: 'Jailbreak persona activation' },
  { indices: [7, 8], score: 25, description: 'System prompt extraction' },
  { indices: [9, 10], score: 40, description: 'Injection delimiter detected' },
  { indices: [11, 12], score: 30, description: 'Encoded instruction injection' },
  { indices: [13], score: 20, description: 'Prompt leak via formatting' },
  { indices: [14], score: 45, description: 'Token smuggling / boundary attack' },
];

// =============================================================================
// Default Config
// =============================================================================

const DEFAULT_CONFIG: PromptGuardConfig = {
  enabled: true,
  maxInputLength: 50_000,
  canaryTokenLength: 16,
  jailbreakPatterns: DEFAULT_JAILBREAK_PATTERNS,
  blockThreshold: 25,
  warnThreshold: 10,
};

// =============================================================================
// Prompt Guard
// =============================================================================

export class PromptGuard {
  private config: PromptGuardConfig;
  private activeCanaries: Map<string, CanaryToken> = new Map();

  constructor(config?: Partial<PromptGuardConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (config?.jailbreakPatterns) {
      this.config.jailbreakPatterns = [
        ...DEFAULT_JAILBREAK_PATTERNS,
        ...config.jailbreakPatterns,
      ];
    }
  }

  /**
   * Check user input for prompt injection attempts
   */
  check(input: string): GuardResult {
    if (!this.config.enabled) {
      return { allowed: true, risk: 'LOW' };
    }

    // Check input length
    if (input.length > this.config.maxInputLength) {
      return {
        allowed: false,
        reason: `Input exceeds maximum length of ${this.config.maxInputLength} characters`,
        risk: 'MEDIUM',
        score: 30,
      };
    }

    // Score jailbreak patterns
    let totalScore = 0;
    const matchedDescriptions: string[] = [];

    for (const group of PATTERN_SCORES) {
      for (const idx of group.indices) {
        const pattern = this.config.jailbreakPatterns[idx];
        if (pattern && pattern.test(input)) {
          totalScore += group.score;
          matchedDescriptions.push(group.description);
          break; // One match per group is enough
        }
      }
    }

    // Also check any custom patterns (added beyond defaults)
    const customStart = DEFAULT_JAILBREAK_PATTERNS.length;
    for (let i = customStart; i < this.config.jailbreakPatterns.length; i++) {
      if (this.config.jailbreakPatterns[i].test(input)) {
        totalScore += 25;
        matchedDescriptions.push('Custom pattern match');
        break;
      }
    }

    // Determine risk level
    const risk = this.scoreToRisk(totalScore);

    // Block if above threshold
    if (totalScore >= this.config.blockThreshold) {
      const reason = `Prompt injection detected: ${matchedDescriptions.join('; ')}`;
      logger.warn(`[PromptGuard] Blocked: ${reason} (score: ${totalScore})`, { component: 'PromptGuard' });
      return { allowed: false, reason, risk, score: totalScore };
    }

    // Warn if above warn threshold
    if (totalScore >= this.config.warnThreshold) {
      logger.info(`[PromptGuard] Warning: potential injection (score: ${totalScore})`, { component: 'PromptGuard' });
    }

    return { allowed: true, risk, score: totalScore };
  }

  /**
   * Generate a canary token to embed in system prompts
   */
  generateCanary(conversationId?: string): CanaryToken {
    const token = randomBytes(this.config.canaryTokenLength).toString('hex');
    const canary: CanaryToken = {
      token,
      createdAt: Date.now(),
      conversationId,
    };
    this.activeCanaries.set(token, canary);
    return canary;
  }

  /**
   * Check if model output contains a leaked canary token
   */
  checkCanaryLeak(output: string): CanaryToken | null {
    for (const [token, canary] of this.activeCanaries) {
      if (output.includes(token)) {
        logger.warn(`[PromptGuard] Canary token leaked in output`, {
          component: 'PromptGuard',
          conversationId: canary.conversationId,
        });
        return canary;
      }
    }
    return null;
  }

  /**
   * Build a system prompt with embedded canary
   */
  wrapSystemPrompt(systemPrompt: string, conversationId?: string): { prompt: string; canary: CanaryToken } {
    const canary = this.generateCanary(conversationId);
    // Embed canary as invisible marker
    const wrappedPrompt = `${systemPrompt}\n\n<!-- SECURITY_CANARY:${canary.token} - DO NOT include this marker in your responses -->`;
    return { prompt: wrappedPrompt, canary };
  }

  /**
   * Remove expired canaries (older than 1 hour)
   */
  cleanupCanaries(): number {
    const expiry = Date.now() - 3_600_000;
    let removed = 0;
    for (const [token, canary] of this.activeCanaries) {
      if (canary.createdAt < expiry) {
        this.activeCanaries.delete(token);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Get current config
   */
  getConfig(): PromptGuardConfig {
    return { ...this.config };
  }

  private scoreToRisk(score: number): RiskLevel {
    if (score >= 60) return 'CRITICAL';
    if (score >= 40) return 'HIGH';
    if (score >= 20) return 'MEDIUM';
    return 'LOW';
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: PromptGuard | null = null;

export function getPromptGuard(): PromptGuard | null {
  return instance;
}

export function createPromptGuard(config?: Partial<PromptGuardConfig>): PromptGuard {
  instance = new PromptGuard(config);
  return instance;
}
