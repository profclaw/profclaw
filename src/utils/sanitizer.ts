/**
 * Output Sanitization Utilities
 *
 * Protects against terminal injection, path traversal, dangerous shell commands,
 * and sensitive data leaking into logs.
 */

import { resolve, normalize, relative, isAbsolute } from 'node:path';

// ─── Terminal sanitization ────────────────────────────────────────────────────

/**
 * ANSI / VT escape sequence pattern.
 *
 * Handles:
 *   - CSI sequences:  ESC [ <params> <final>
 *   - OSC sequences:  ESC ] <text> BEL   or  ESC ] <text> ESC \
 *   - Two-char ESC sequences:  ESC <single byte in 0x40-0x5F>
 *
 * Must be listed longest-match first (OSC before two-char) to avoid partial matches.
 */
const ANSI_ESCAPE_RE =
   
  /\x1B(?:\][^\x07\x1B]*(?:\x07|\x1B\\)|\[[0-?]*[ -/]*[@-~]|[@-_])/g;

/**
 * Additional terminal control characters that should not appear in display output.
 * Excludes LF (\n) and CR (\r) which are legitimate line endings.
 */
 
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F\x7F]/g;

/**
 * Sanitize text before displaying in a terminal.
 *
 * - Strips all ANSI/VT escape sequences to prevent terminal injection via
 *   malicious model responses (e.g. cursor repositioning, title bar spoofing).
 * - Removes non-printable control characters except newlines.
 *
 * @param text Untrusted string from external source (model output, API data, etc.)
 * @returns Safe string suitable for terminal display
 */
export function sanitizeForTerminal(text: string): string {
  if (!text) return text;
  return text
    .replace(ANSI_ESCAPE_RE, '')
    .replace(CONTROL_CHARS_RE, '');
}

// ─── Path sanitization ────────────────────────────────────────────────────────

/**
 * Sanitize a file path to prevent path traversal attacks.
 *
 * Checks that the resolved path is strictly inside `baseDir`.
 * Rejects:
 *   - Paths containing `..` segments that escape the base
 *   - Absolute paths outside `baseDir`
 *   - Null bytes
 *
 * @param inputPath  Path provided by the user / untrusted source
 * @param baseDir    Absolute directory that the path must stay inside
 * @returns Normalized absolute path if safe, or `null` if the path is unsafe
 */
export function sanitizePath(inputPath: string, baseDir: string): string | null {
  if (!inputPath || typeof inputPath !== 'string') return null;

  // Reject null bytes
  if (inputPath.includes('\x00')) return null;

  // Reject clearly absolute paths that start outside baseDir right away
  // (resolve will handle this too, but this is a fast early-exit)
  const normalizedBase = normalize(resolve(baseDir));
  const resolvedInput = resolve(normalizedBase, inputPath);
  const rel = relative(normalizedBase, resolvedInput);

  // relative() returns something starting with '..' when outside base
  if (rel.startsWith('..') || isAbsolute(rel)) return null;

  return resolvedInput;
}

// ─── Shell command safety ─────────────────────────────────────────────────────

interface ShellSafetyResult {
  safe: boolean;
  reason?: string;
}

/**
 * Patterns that indicate a dangerously destructive or privilege-escalating command.
 * Order matters — first match wins and provides the clearest reason.
 */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // Destructive filesystem
  { pattern: /rm\s+(-[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|--force|--recursive)/, reason: 'destructive rm flags detected' },
  { pattern: /rm\s+-rf/, reason: 'rm -rf detected' },
  { pattern: /:\s*\(\s*\)\s*\{.*\}/, reason: 'fork bomb pattern detected' },
  // Privilege escalation
  { pattern: /\bsudo\b/, reason: 'sudo is not allowed' },
  { pattern: /\bsu\s+-/, reason: 'su command is not allowed' },
  { pattern: /chmod\s+[0-7]*7[0-7][0-7]/, reason: 'chmod 777 / world-writable permission denied' },
  { pattern: /chown\s+root/, reason: 'chown root is not allowed' },
  // Remote code execution via pipe-to-shell
  { pattern: /\|\s*(ba|z|da|fi|c)?sh\b/, reason: 'pipe to shell is not allowed' },
  { pattern: /curl[^|]*\|/, reason: 'curl piped to shell is not allowed' },
  { pattern: /wget[^|]*\|/, reason: 'wget piped to shell is not allowed' },
  // Disk wipe / overwrite
  { pattern: /\bdd\s+.*of=\/dev\/(sd|nvme|hd|disk)/, reason: 'dd write to block device is not allowed' },
  { pattern: /mkfs\./, reason: 'filesystem format command is not allowed' },
  // Environment manipulation that could bypass guards
  { pattern: /\benv\s+-i\b/, reason: 'env -i clears environment and is not allowed' },
  // Bypass via exec
  { pattern: /\bexec\s+bash\b/, reason: 'exec bash shell replacement is not allowed' },
];

/**
 * Evaluate whether a shell command string is safe to run.
 *
 * This is a best-effort heuristic for the `/run` feature and is NOT a sandbox.
 * Dangerous patterns (rm -rf, sudo, chmod 777, curl | bash, etc.) are rejected.
 *
 * @param cmd Raw command string submitted by the user
 * @returns `{ safe: true }` or `{ safe: false, reason: '...' }`
 */
export function sanitizeShellCommand(cmd: string): ShellSafetyResult {
  if (!cmd || typeof cmd !== 'string') {
    return { safe: false, reason: 'empty or invalid command' };
  }

  const trimmed = cmd.trim();
  if (trimmed.length === 0) {
    return { safe: false, reason: 'empty command' };
  }

  // Null bytes in commands indicate injection attempts
  if (trimmed.includes('\x00')) {
    return { safe: false, reason: 'null byte in command' };
  }

  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { safe: false, reason };
    }
  }

  return { safe: true };
}

// ─── Sensitive value redaction ────────────────────────────────────────────────

/**
 * Matches common API key / token / secret value patterns in plain text.
 *
 * Designed to catch values that appear in log lines such as:
 *   Authorization: Bearer sk-proj-abc123...
 *   token=ghp_abcXYZ
 *   password=s3cr3t
 *   OPENAI_API_KEY=sk-...
 */
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Authorization header value
  { pattern: /((?:Bearer|Basic|Token)\s+)[A-Za-z0-9\-._~+/]+=*/gi, replacement: '$1[REDACTED]' },
  // API key prefixes (OpenAI sk-, Anthropic sk-ant-, etc.)
  { pattern: /\b(sk-(?:ant-|proj-)?)[A-Za-z0-9\-_]{8,}/g, replacement: '$1[REDACTED]' },
  // GitHub tokens
  { pattern: /\b(gh[pousr]_)[A-Za-z0-9]{36,}/g, replacement: '$1[REDACTED]' },
  // Generic "key-*" style tokens
  { pattern: /\b(key-)[A-Za-z0-9\-_]{8,}/g, replacement: '$1[REDACTED]' },
  // Query / form param assignments: token=, password=, api_key=, apikey=, secret=
  {
    pattern: /\b((?:token|password|passwd|api[_-]?key|secret|access[_-]?token|refresh[_-]?token|client[_-]?secret)=)[^\s&"']+/gi,
    replacement: '$1[REDACTED]',
  },
  // JSON field values: "password": "...", "token": "..."
  {
    pattern: /"(password|token|secret|apiKey|api_key|accessToken|access_token|refreshToken|refresh_token|clientSecret|client_secret|authorization)"\s*:\s*"[^"]{4,}"/gi,
    replacement: '"$1": "[REDACTED]"',
  },
];

/**
 * Redact sensitive values from a plain-text string before it reaches logs.
 *
 * Replaces patterns matching API keys, bearer tokens, passwords, and similar
 * credential-shaped values with `[REDACTED]`.
 *
 * @param text Raw string that may contain secrets
 * @returns String with sensitive values replaced
 */
export function redactSensitive(text: string): string {
  if (!text || typeof text !== 'string') return text;

  let result = text;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
