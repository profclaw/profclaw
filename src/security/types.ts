/**
 * Security Guard Types
 *
 * Shared types for input-level security guards:
 * prompt injection, SSRF, filesystem, audit scanning.
 */

// =============================================================================
// Common
// =============================================================================

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface GuardResult {
  allowed: boolean;
  reason?: string;
  risk: RiskLevel;
  /** Score 0-100 representing severity */
  score?: number;
}

// =============================================================================
// Prompt Guard
// =============================================================================

export interface PromptGuardConfig {
  enabled: boolean;
  /** Maximum input length in characters (default 50000) */
  maxInputLength: number;
  /** Length of canary token marker (default 16) */
  canaryTokenLength: number;
  /** Jailbreak detection patterns */
  jailbreakPatterns: RegExp[];
  /** Score threshold to block (default 50) */
  blockThreshold: number;
  /** Score threshold to warn (default 25) */
  warnThreshold: number;
}

export interface CanaryToken {
  token: string;
  createdAt: number;
  conversationId?: string;
}

// =============================================================================
// SSRF Guard
// =============================================================================

export interface SsrfGuardConfig {
  enabled: boolean;
  /** Hosts that bypass private IP checks */
  allowedHosts: string[];
  /** CIDR ranges to block (RFC 1918, link-local, loopback) */
  blockedCidrs: string[];
  /** Maximum redirect hops to follow (default 5) */
  maxRedirects: number;
  /** DNS resolution timeout in ms (default 3000) */
  dnsResolutionTimeout: number;
  /** Allowed URL schemes (default: http, https) */
  allowedSchemes: string[];
}

// =============================================================================
// Filesystem Guard
// =============================================================================

export type FsOperation = 'read' | 'write' | 'delete' | 'list';

export interface FsGuardConfig {
  enabled: boolean;
  /** Paths the agent is allowed to access */
  allowedPaths: string[];
  /** Paths that are always blocked */
  blockedPaths: string[];
  /** Whether to resolve symlinks before checking (default true) */
  followSymlinks: boolean;
  /** Blocked filename patterns (e.g., .env*) */
  blockedPatterns: string[];
}

// =============================================================================
// Audit Scanner
// =============================================================================

export interface AuditScannerConfig {
  enabled: boolean;
  /** Patterns that indicate dangerous code in skills */
  dangerousPatterns: RegExp[];
  /** Whether to log alerts when patterns match */
  alertOnMatch: boolean;
}

export interface ScanFinding {
  pattern: string;
  match: string;
  line: number;
  risk: RiskLevel;
  description: string;
}

export interface ScanResult {
  source: string;
  findings: ScanFinding[];
  riskLevel: RiskLevel;
  scannedAt: number;
}

export interface ConfigValidationResult {
  valid: boolean;
  warnings: Array<{
    field: string;
    message: string;
    risk: RiskLevel;
  }>;
}

// =============================================================================
// Context Isolation
// =============================================================================

export interface IsolationContext {
  conversationId: string;
  userId?: string;
  /** Memory paths this conversation is allowed to access */
  allowedMemoryPaths: string[];
}
