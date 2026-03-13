/**
 * Audit Scanner
 *
 * Advanced audit logging with proactive scanning.
 * Features:
 * - Skill scanning for dangerous patterns
 * - Config validation for insecure settings
 * - Pattern alerting with risk levels
 * - Integration with AuditLogger
 */

import { logger } from '../utils/logger.js';
import type {
  AuditScannerConfig,
  ScanFinding,
  ScanResult,
  ConfigValidationResult,
  RiskLevel,
} from './types.js';

// =============================================================================
// Default Dangerous Patterns
// =============================================================================

interface PatternDef {
  pattern: RegExp;
  risk: RiskLevel;
  description: string;
}

const DEFAULT_DANGEROUS_PATTERNS: PatternDef[] = [
  // Shell execution
  {
    pattern: /child_process|exec\s*\(|execSync|spawn\s*\(|spawnSync/,
    risk: 'CRITICAL',
    description: 'Shell execution detected',
  },
  {
    pattern: /\beval\s*\(/,
    risk: 'CRITICAL',
    description: 'eval() usage detected',
  },
  {
    pattern: /Function\s*\(\s*['"`]/,
    risk: 'HIGH',
    description: 'Dynamic function construction',
  },

  // Network access
  {
    pattern: /\bfetch\s*\(|require\s*\(\s*['"]https?['"]\)|axios|got\s*\(/,
    risk: 'HIGH',
    description: 'Network access detected',
  },
  {
    pattern: /net\.connect|dgram\.createSocket|tls\.connect/,
    risk: 'CRITICAL',
    description: 'Raw socket access',
  },

  // Environment / credential access
  {
    pattern: /process\.env\[|process\.env\./,
    risk: 'MEDIUM',
    description: 'Environment variable access',
  },
  {
    pattern: /(?:API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)(?:\s*[:=]|\s*\])/i,
    risk: 'HIGH',
    description: 'Potential credential access',
  },

  // Filesystem writes outside project
  {
    pattern: /writeFileSync|appendFileSync|createWriteStream/,
    risk: 'MEDIUM',
    description: 'Filesystem write operation',
  },
  {
    pattern: /unlinkSync|rmdirSync|rmSync/,
    risk: 'HIGH',
    description: 'Filesystem deletion operation',
  },

  // Prototype pollution / injection
  {
    pattern: /__proto__|constructor\s*\[|Object\.setPrototypeOf/,
    risk: 'CRITICAL',
    description: 'Prototype pollution risk',
  },

  // Obfuscation indicators
  {
    pattern: /atob\s*\(|Buffer\.from\s*\([^)]+,\s*['"]base64['"]\)/,
    risk: 'MEDIUM',
    description: 'Base64 decoding (possible obfuscation)',
  },
  {
    pattern: /\\x[0-9a-f]{2}|\\u[0-9a-f]{4}/i,
    risk: 'LOW',
    description: 'Encoded characters detected',
  },
];

const DEFAULT_CONFIG: AuditScannerConfig = {
  enabled: true,
  dangerousPatterns: DEFAULT_DANGEROUS_PATTERNS.map((p) => p.pattern),
  alertOnMatch: true,
};

// =============================================================================
// Audit Scanner
// =============================================================================

export class AuditScanner {
  private config: AuditScannerConfig;
  private patternDefs: PatternDef[];

  constructor(config?: Partial<AuditScannerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.patternDefs = DEFAULT_DANGEROUS_PATTERNS;
  }

  /**
   * Scan skill content for dangerous patterns
   */
  scanSkill(content: string, source: string): ScanResult {
    if (!this.config.enabled) {
      return { source, findings: [], riskLevel: 'LOW', scannedAt: Date.now() };
    }

    const findings: ScanFinding[] = [];
    const lines = content.split('\n');

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];

      for (const def of this.patternDefs) {
        const match = line.match(def.pattern);
        if (match) {
          findings.push({
            pattern: def.pattern.source,
            match: match[0],
            line: lineIdx + 1,
            risk: def.risk,
            description: def.description,
          });
        }
      }
    }

    // Determine overall risk level
    const riskLevel = this.highestRisk(findings);

    if (findings.length > 0 && this.config.alertOnMatch) {
      logger.warn(
        `[AuditScanner] ${findings.length} finding(s) in ${source}: ${riskLevel} risk`,
        { component: 'AuditScanner' },
      );
      for (const finding of findings) {
        logger.info(
          `[AuditScanner]   Line ${finding.line}: ${finding.description} (${finding.risk})`,
          { component: 'AuditScanner' },
        );
      }
    }

    return { source, findings, riskLevel, scannedAt: Date.now() };
  }

  /**
   * Validate configuration for security issues
   */
  validateConfig(config: Record<string, unknown>): ConfigValidationResult {
    const warnings: ConfigValidationResult['warnings'] = [];

    // Check security mode
    if (config.securityMode === 'full' || config.security_mode === 'full') {
      warnings.push({
        field: 'securityMode',
        message: 'Security mode is set to "full" - all tool calls are unrestricted',
        risk: 'CRITICAL',
      });
    }

    // Check sandbox disabled
    if (config.enableSandbox === false || config.sandbox?.toString() === 'false') {
      warnings.push({
        field: 'enableSandbox',
        message: 'Docker sandbox is disabled - tool execution is not isolated',
        risk: 'HIGH',
      });
    }

    // Check missing auth
    if (!config.authToken && !config.AUTH_TOKEN && !config.apiKey && !config.API_KEY) {
      warnings.push({
        field: 'authToken',
        message: 'No authentication token configured',
        risk: 'HIGH',
      });
    }

    // Check deployment mode
    if (config.PROFCLAW_MODE === 'pico' || config.deploymentMode === 'pico') {
      // Pico mode has limited security features
      if (config.securityMode !== 'deny' && config.security_mode !== 'deny') {
        warnings.push({
          field: 'deploymentMode',
          message: 'Pico mode has limited security - consider restricting security mode',
          risk: 'MEDIUM',
        });
      }
    }

    // Check for insecure defaults
    if (config.POOL_TIMEOUT_MS && Number(config.POOL_TIMEOUT_MS) > 600_000) {
      warnings.push({
        field: 'POOL_TIMEOUT_MS',
        message: 'Tool timeout exceeds 10 minutes - risk of long-running attacks',
        risk: 'MEDIUM',
      });
    }

    if (config.POOL_MAX_CONCURRENT && Number(config.POOL_MAX_CONCURRENT) > 200) {
      warnings.push({
        field: 'POOL_MAX_CONCURRENT',
        message: 'High concurrency limit may enable resource exhaustion',
        risk: 'LOW',
      });
    }

    if (warnings.length > 0 && this.config.alertOnMatch) {
      logger.warn(
        `[AuditScanner] Config validation: ${warnings.length} warning(s)`,
        { component: 'AuditScanner' },
      );
    }

    return {
      valid: !warnings.some((w) => w.risk === 'CRITICAL'),
      warnings,
    };
  }

  /**
   * Get current config
   */
  getConfig(): AuditScannerConfig {
    return { ...this.config };
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private highestRisk(findings: ScanFinding[]): RiskLevel {
    const order: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    let highest: RiskLevel = 'LOW';
    for (const f of findings) {
      if (order.indexOf(f.risk) > order.indexOf(highest)) {
        highest = f.risk;
      }
    }
    return highest;
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: AuditScanner | null = null;

export function getAuditScanner(): AuditScanner | null {
  return instance;
}

export function createAuditScanner(config?: Partial<AuditScannerConfig>): AuditScanner {
  instance = new AuditScanner(config);
  return instance;
}
