/**
 * Secrets Detection & Redaction
 *
 * Scans output for potential secrets and redacts them.
 * Detects: API keys, tokens, passwords, private keys, credentials.
 */

import { logger } from '../../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export interface SecretMatch {
  type: string;
  pattern: string;
  start: number;
  end: number;
  preview: string; // First few chars for debugging
}

export interface ScanResult {
  hasSecrets: boolean;
  matches: SecretMatch[];
  redactedText: string;
}

// =============================================================================
// Secret Patterns
// =============================================================================

// Pattern definitions with descriptions
const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp; preview: number }> = [
  // API Keys & Tokens
  {
    name: 'AWS Access Key',
    pattern: /\b(AKIA[0-9A-Z]{16})\b/g,
    preview: 8,
  },
  {
    name: 'AWS Secret Key',
    pattern: /\b([A-Za-z0-9/+=]{40})(?=\s|$|")/g,
    preview: 8,
  },
  {
    name: 'GitHub Token',
    pattern: /\b(gh[pousr]_[A-Za-z0-9_]{36,255})\b/g,
    preview: 8,
  },
  {
    name: 'GitHub OAuth',
    pattern: /\b(gho_[A-Za-z0-9]{36,255})\b/g,
    preview: 8,
  },
  {
    name: 'GitHub Personal Access Token (Classic)',
    pattern: /\b(ghp_[A-Za-z0-9]{36,255})\b/g,
    preview: 8,
  },
  {
    name: 'GitLab Token',
    pattern: /\b(glpat-[A-Za-z0-9\-_]{20,})\b/g,
    preview: 10,
  },
  {
    name: 'Slack Token',
    pattern: /\b(xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*)\b/g,
    preview: 10,
  },
  {
    name: 'Slack Webhook',
    pattern: /\b(https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[a-zA-Z0-9]+)\b/g,
    preview: 30,
  },
  {
    name: 'Discord Token',
    pattern: /\b([MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27})\b/g,
    preview: 10,
  },
  {
    name: 'Discord Webhook',
    pattern: /\b(https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+)\b/g,
    preview: 30,
  },
  {
    name: 'Anthropic API Key',
    pattern: /\b(sk-ant-[A-Za-z0-9\-_]{95,})\b/g,
    preview: 12,
  },
  {
    name: 'OpenAI API Key',
    pattern: /\b(sk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,})\b/g,
    preview: 10,
  },
  {
    name: 'OpenAI Project Key',
    pattern: /\b(sk-proj-[A-Za-z0-9\-_]{40,})\b/g,
    preview: 12,
  },
  {
    name: 'Google API Key',
    pattern: /\b(AIza[0-9A-Za-z\-_]{35})\b/g,
    preview: 10,
  },
  {
    name: 'Firebase Token',
    pattern: /\b([0-9]+:[A-Za-z0-9_-]{140,})\b/g,
    preview: 10,
  },
  {
    name: 'Stripe API Key',
    pattern: /\b(sk_live_[A-Za-z0-9]{24,})\b/g,
    preview: 12,
  },
  {
    name: 'Stripe Test Key',
    pattern: /\b(sk_test_[A-Za-z0-9]{24,})\b/g,
    preview: 12,
  },
  {
    name: 'Stripe Publishable Key',
    pattern: /\b(pk_(live|test)_[A-Za-z0-9]{24,})\b/g,
    preview: 12,
  },
  {
    name: 'Twilio API Key',
    pattern: /\b(SK[a-f0-9]{32})\b/g,
    preview: 10,
  },
  {
    name: 'Sendgrid API Key',
    pattern: /\b(SG\.[A-Za-z0-9\-_]{22}\.[A-Za-z0-9\-_]{43})\b/g,
    preview: 10,
  },
  {
    name: 'Mailchimp API Key',
    pattern: /\b([a-f0-9]{32}-us\d{1,2})\b/g,
    preview: 10,
  },
  {
    name: 'NPM Token',
    pattern: /\b(npm_[A-Za-z0-9]{36})\b/g,
    preview: 8,
  },
  {
    name: 'PyPI Token',
    pattern: /\b(pypi-[A-Za-z0-9\-_]{50,})\b/g,
    preview: 10,
  },
  {
    name: 'Heroku API Key',
    pattern: /\b([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\b/g,
    preview: 12,
  },
  {
    name: 'DigitalOcean Token',
    pattern: /\b(dop_v1_[a-f0-9]{64})\b/g,
    preview: 12,
  },
  {
    name: 'Vercel Token',
    pattern: /\b([A-Za-z0-9]{24})\b/g, // Too generic, check context
    preview: 8,
  },
  {
    name: 'Linear API Key',
    pattern: /\b(lin_api_[A-Za-z0-9]{40,})\b/g,
    preview: 12,
  },

  // Private Keys & Certificates
  {
    name: 'RSA Private Key',
    pattern: /-----BEGIN RSA PRIVATE KEY-----[\s\S]*?-----END RSA PRIVATE KEY-----/g,
    preview: 30,
  },
  {
    name: 'OpenSSH Private Key',
    pattern: /-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----/g,
    preview: 30,
  },
  {
    name: 'EC Private Key',
    pattern: /-----BEGIN EC PRIVATE KEY-----[\s\S]*?-----END EC PRIVATE KEY-----/g,
    preview: 30,
  },
  {
    name: 'Private Key (Generic)',
    pattern: /-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g,
    preview: 30,
  },
  {
    name: 'PGP Private Key',
    pattern: /-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----/g,
    preview: 30,
  },

  // Database & Connection Strings
  {
    name: 'MongoDB Connection String',
    pattern: /mongodb(?:\+srv)?:\/\/[^\s"']+/g,
    preview: 20,
  },
  {
    name: 'PostgreSQL Connection String',
    pattern: /postgres(?:ql)?:\/\/[^\s"']+/g,
    preview: 20,
  },
  {
    name: 'MySQL Connection String',
    pattern: /mysql:\/\/[^\s"']+/g,
    preview: 20,
  },
  {
    name: 'Redis Connection String',
    pattern: /redis(?:s)?:\/\/[^\s"']+/g,
    preview: 20,
  },
  {
    name: 'JDBC Connection String',
    pattern: /jdbc:[a-z]+:\/\/[^\s"']+/g,
    preview: 20,
  },

  // Generic Patterns (more specific context needed)
  {
    name: 'Bearer Token',
    pattern: /\b(Bearer\s+[A-Za-z0-9\-_.~+\/]+=*)\b/gi,
    preview: 15,
  },
  {
    name: 'Basic Auth Header',
    pattern: /\b(Basic\s+[A-Za-z0-9+\/]+=*)\b/gi,
    preview: 15,
  },
  {
    name: 'JWT Token',
    pattern: /\b(eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*)\b/g,
    preview: 20,
  },

  // Password patterns in common formats
  {
    name: 'Password in URL',
    pattern: /:\/\/[^:]+:([^@\s]{8,})@/g,
    preview: 0, // Don't show password preview
  },
  {
    name: 'Password Assignment',
    pattern: /(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[=:]\s*["']?([^"'\s]{8,})["']?/gi,
    preview: 0,
  },
  {
    name: 'Secret in Env',
    pattern: /(?:SECRET|TOKEN|API_KEY|APIKEY|PASSWORD|PASSWD|CREDENTIALS?)\s*=\s*["']?([^"'\s\n]{8,})["']?/gi,
    preview: 0,
  },
];

// Redaction placeholder
const REDACTION_PLACEHOLDER = '[REDACTED]';

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Scan text for potential secrets
 */
export function scanForSecrets(text: string): ScanResult {
  if (!text || typeof text !== 'string') {
    return { hasSecrets: false, matches: [], redactedText: text };
  }

  const matches: SecretMatch[] = [];
  let redactedText = text;

  // Track already-replaced positions to avoid double-replacement
  const replacedRanges: Array<{ start: number; end: number }> = [];

  for (const { name, pattern, preview } of SECRET_PATTERNS) {
    // Reset regex state for global patterns
    pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const fullMatch = match[0];
      const captured = match[1] || fullMatch;
      const start = match.index;
      const end = start + fullMatch.length;

      // Skip if already replaced
      const alreadyReplaced = replacedRanges.some(
        (r) => (start >= r.start && start < r.end) || (end > r.start && end <= r.end)
      );
      if (alreadyReplaced) continue;

      // Generate preview (first N chars)
      const previewText = preview > 0 ? captured.slice(0, preview) + '...' : '***';

      matches.push({
        type: name,
        pattern: pattern.source.slice(0, 30) + '...',
        start,
        end,
        preview: previewText,
      });

      replacedRanges.push({ start, end });
    }
  }

  // Sort matches by position (descending) for safe replacement
  matches.sort((a, b) => b.start - a.start);

  // Apply redactions
  for (const m of matches) {
    redactedText =
      redactedText.slice(0, m.start) + REDACTION_PLACEHOLDER + redactedText.slice(m.end);
  }

  // Re-sort by position (ascending) for reporting
  matches.sort((a, b) => a.start - b.start);

  const hasSecrets = matches.length > 0;

  if (hasSecrets) {
    logger.warn(`[Secrets] Detected ${matches.length} potential secrets in output`, {
      types: [...new Set(matches.map((m) => m.type))],
    });
  }

  return { hasSecrets, matches, redactedText };
}

/**
 * Redact secrets from text (returns only the redacted text)
 */
export function redactSecrets(text: string): string {
  return scanForSecrets(text).redactedText;
}

/**
 * Check if text contains secrets (quick check without full scan)
 */
export function hasSecrets(text: string): boolean {
  if (!text) return false;

  // Quick check with a subset of high-confidence patterns
  const quickPatterns = [
    /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,
    /\b(gh[pousr]_[A-Za-z0-9_]{36,})\b/,
    /\b(sk-ant-[A-Za-z0-9\-_]{95,})\b/,
    /\b(sk-[A-Za-z0-9]{20,}T3BlbkFJ)/,
    /\b(AKIA[0-9A-Z]{16})\b/,
    /\b(sk_(live|test)_[A-Za-z0-9]{24,})\b/,
    /\beyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\./,
    /mongodb(?:\+srv)?:\/\/[^:]+:[^@]+@/,
    /postgres(?:ql)?:\/\/[^:]+:[^@]+@/,
  ];

  return quickPatterns.some((p) => p.test(text));
}

/**
 * Get statistics about secret types
 */
export function getSecretStats(matches: SecretMatch[]): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const m of matches) {
    stats[m.type] = (stats[m.type] || 0) + 1;
  }
  return stats;
}

// =============================================================================
// Configuration
// =============================================================================

let secretsDetectionEnabled = process.env.SECRETS_DETECTION !== 'false';

export function isSecretsDetectionEnabled(): boolean {
  return secretsDetectionEnabled;
}

export function setSecretsDetectionEnabled(enabled: boolean): void {
  secretsDetectionEnabled = enabled;
  logger.info(`[Secrets] Detection ${enabled ? 'enabled' : 'disabled'}`);
}

// =============================================================================
// Export for testing
// =============================================================================

export const _internals = {
  SECRET_PATTERNS,
  REDACTION_PLACEHOLDER,
};
