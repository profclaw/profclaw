/**
 * Tool Execution System
 *
 * Main entry point for the AI tool execution system.
 * Provides secure, audited, rate-limited tool execution for AI agents.
 */

// Types
export * from './types.js';

// Core modules
import { configureToolRouter } from './tool-router.js';
export { getToolRegistry, ToolRegistryImpl } from './registry.js';
export { getSecurityManager, initSecurityManager, SecurityPolicyManager } from './security.js';
export { getSessionManager, ToolSessionManager } from './session-manager.js';
export { getToolExecutor, initToolExecutor, ToolExecutor } from './executor.js';

// New modules
export { getSandboxManager, initSandboxManager, SandboxManager } from './sandbox.js';
export {
  getProcessPool,
  initProcessPool,
  ProcessPool,
  PoolFullError,
  TimeoutError,
  QueueTimeoutError,
} from './process-pool.js';
export {
  getAuditLogger,
  initAuditLogger,
  AuditLogger,
  type AuditEntry,
  type AuditFilter,
  type AuditStats,
  type AuditEventType,
} from './audit.js';
export {
  getRateLimiter,
  initRateLimiter,
  RateLimiter,
  type RateLimitConfig,
  type RateLimitResult,
} from './rate-limiter.js';

// Model-aware intelligence (Phase 19)
export { detectModelCapability, getRecommendedTier, getMaxSchemaTokens, getModelRouting } from './model-capability.js';
export { filterToolsForModel, promoteToolForConversation, clearPromotedTools, classifyModel, configureToolRouter } from './tool-router.js';
export { buildToolPrompt, getHistoryBudget, estimateTokens, truncateHistory } from './smart-prompts.js';
export {
  // 3.1 - Failure classifier
  classifyFailure,
  // 3.2 - Retry with backoff
  executeWithRetry,
  // 3.3 - Parameter fix suggestions
  suggestParameterFixes,
  // 3.4 - Alternative tool suggestions
  suggestAlternativeTools,
  // 3.5 - Error context injection
  buildErrorContext,
  formatErrorContextForPrompt,
  // 3.6 - Correction budget
  CorrectionTracker,
  // Main orchestrator
  executeWithSelfCorrection,
  // Legacy helpers (backward compat)
  executeWithCorrection,
  getCorrectionBudget,
  consumeCorrection,
  resetCorrectionBudget,
  clearAllBudgets,
} from './self-correction.js';
export type {
  FailureType,
  FailureClassification,
  RetryConfig,
  ParameterFix,
  AlternativeTool,
  ErrorContext,
  CorrectionBudget,
  SelfCorrectionResult,
  // Legacy type aliases
  FailureClass,
  CorrectionStrategy,
} from './self-correction.js';

// Quality guardrails (Phase 19)
export {
  runGuardrails,
  checkSafetyBounds,
  validateAgentResponse,
  scoreResponse,
  detectHallucinations,
  type GuardrailContext,
  type GuardrailResult,
  type ValidationResult,
  type SafetyCheckResult,
  type QualityScore,
} from './guardrails.js';

// Tools
export { registerBuiltinTools, builtinTools } from './tools/index.js';

// Re-export individual tools for convenience
export {
  execTool,
  webFetchTool,
  readFileTool,
  writeFileTool,
  searchFilesTool,
  grepTool,
} from './tools/index.js';

// Initialization

import type { SecurityPolicy, SandboxConfig } from './types.js';
import type { PoolConfig } from './process-pool.js';
import type { RateLimitConfig } from './rate-limiter.js';
import { initSecurityManager } from './security.js';
import { initSandboxManager, getSandboxManager as getSandboxStatusManager } from './sandbox.js';
import { initProcessPool, getProcessPool as getPoolStatusManager } from './process-pool.js';
import { initAuditLogger, getAuditLogger as getAuditStatusLogger } from './audit.js';
import { initRateLimiter, getRateLimiter as getRateLimitStatusManager } from './rate-limiter.js';
import { createPromptGuard } from '../../security/prompt-guard.js';
import { createSsrfGuard } from '../../security/ssrf-guard.js';
import { createFsGuard } from '../../security/fs-guard.js';
import { createAuditScanner } from '../../security/audit-scanner.js';
import { registerBuiltinTools } from './tools/index.js';
import { logger } from '../../utils/logger.js';
import os from 'os';

let initialized = false;

export interface ToolExecutionOptions {
  securityPolicy?: Partial<SecurityPolicy>;
  sandboxConfig?: Partial<SandboxConfig>;
  poolConfig?: Partial<PoolConfig>;
  rateLimitConfig?: Partial<RateLimitConfig>;
  registerBuiltins?: boolean;
  enableSandbox?: boolean;
}

/**
 * Initialize the tool execution system
 */
export async function initializeToolExecution(options?: ToolExecutionOptions): Promise<void> {
  if (initialized) {
    return;
  }

  logger.info('[Execution] Initializing tool execution system...', { component: 'ToolExecution' });

  // Initialize audit logger first (everything uses it)
  initAuditLogger();
  logger.debug('[Execution] Audit logger initialized', { component: 'ToolExecution' });

  // Initialize rate limiter
  initRateLimiter(options?.rateLimitConfig);
  logger.debug('[Execution] Rate limiter initialized', { component: 'ToolExecution' });

  // Initialize process pool
  initProcessPool(options?.poolConfig);
  logger.debug('[Execution] Process pool initialized', { component: 'ToolExecution' });

  // Initialize security manager
  initSecurityManager(options?.securityPolicy);
  logger.debug('[Execution] Security manager initialized', { component: 'ToolExecution' });

  // Initialize input-level security guards
  createPromptGuard();
  createSsrfGuard();
  createFsGuard({ allowedPaths: [process.cwd(), os.tmpdir()] });
  createAuditScanner();
  logger.debug('[Execution] Security guards initialized (prompt, SSRF, FS, audit)', { component: 'ToolExecution' });

  // Initialize sandbox if enabled
  if (options?.enableSandbox !== false) {
    try {
      const sandbox = await initSandboxManager(options?.sandboxConfig);
      if (sandbox.isAvailable()) {
        logger.info('[Execution] Sandbox initialized with Docker', { component: 'ToolExecution' });
      } else {
        logger.info('[Execution] Sandbox unavailable (Docker not running)', { component: 'ToolExecution' });
      }
    } catch (error) {
      logger.warn('[Execution] Failed to initialize sandbox', {
        component: 'ToolExecution',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Register built-in tools
  if (options?.registerBuiltins !== false) {
    await registerBuiltinTools();
    logger.debug('[Execution] Built-in tools registered', { component: 'ToolExecution' });
  }

  // Enable model-aware tool filtering to reduce token usage
  configureToolRouter({ enabled: true });
  logger.debug('[Execution] Tool router enabled', { component: 'ToolExecution' });

  initialized = true;
  logger.info('[Execution] Tool execution system initialized', { component: 'ToolExecution' });
}

/**
 * Check if the execution system is initialized
 */
export function isInitialized(): boolean {
  return initialized;
}

/**
 * Get system status
 */
export function getExecutionStatus() {
  return {
    initialized,
    sandbox: getSandboxStatusManager().getStatus(),
    pool: getPoolStatusManager().getStatus(),
    rateLimit: getRateLimitStatusManager().getConfig(),
    audit: getAuditStatusLogger().getStats(),
  };
}
