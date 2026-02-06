/**
 * Tool Execution System
 *
 * Main entry point for the AI tool execution system.
 * Provides secure, audited, rate-limited tool execution for AI agents.
 */

// Types
export * from './types.js';

// Core modules
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

// =============================================================================
// Initialization
// =============================================================================

import type { SecurityPolicy, SandboxConfig } from './types.js';
import type { PoolConfig } from './process-pool.js';
import type { RateLimitConfig } from './rate-limiter.js';
import { initSecurityManager } from './security.js';
import { initSandboxManager } from './sandbox.js';
import { initProcessPool } from './process-pool.js';
import { initAuditLogger } from './audit.js';
import { initRateLimiter } from './rate-limiter.js';
import { registerBuiltinTools } from './tools/index.js';
import { logger } from '../../utils/logger.js';

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
    registerBuiltinTools();
    logger.debug('[Execution] Built-in tools registered', { component: 'ToolExecution' });
  }

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
  // Import here to avoid circular dependencies during initialization
  const { getSandboxManager: getSandbox } = require('./sandbox.js');
  const { getProcessPool: getPool } = require('./process-pool.js');
  const { getRateLimiter: getLimiter } = require('./rate-limiter.js');
  const { getAuditLogger: getAudit } = require('./audit.js');

  return {
    initialized,
    sandbox: getSandbox().getStatus(),
    pool: getPool().getStatus(),
    rateLimit: getLimiter().getConfig(),
    audit: getAudit().getStats(),
  };
}
