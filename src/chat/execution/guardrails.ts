/**
 * Quality Guardrails System - Phase 19 Category 8
 *
 * System-level quality checks that prevent bad outputs regardless of which
 * AI model is used. Ensures even cheap/local models produce safe, valid responses.
 *
 * 8.1 Output Validation
 * 8.2 Hallucination Detection
 * 8.3 Safety Bounds
 * 8.4 Quality Scoring
 */

// =============================================================================
// Shared Context Type
// =============================================================================

export interface GuardrailContext {
  /** Known file paths in the project */
  knownFiles?: string[];
  /** Registered tool names */
  registeredTools?: string[];
  /** The user's original query */
  userQuery?: string;
  /** Current conversation topic */
  topic?: string;
  /** Security mode */
  securityMode?: string;
}

// =============================================================================
// 8.1 Output Validation Types
// =============================================================================

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  score: number; // 0-100
}

export interface ValidationIssue {
  type: 'format' | 'content' | 'safety' | 'hallucination';
  severity: 'warning' | 'error';
  message: string;
  autoFixed?: boolean;
}

// =============================================================================
// 8.2 Hallucination Detection Types
// =============================================================================

export interface HallucinationCheck {
  detected: boolean;
  flags: HallucinationFlag[];
}

export interface HallucinationFlag {
  type: 'nonexistent_file' | 'nonexistent_tool' | 'nonexistent_api' | 'fabricated_data';
  reference: string;
  confidence: number; // 0-1
}

// =============================================================================
// 8.3 Safety Bounds Types
// =============================================================================

export interface SafetyCheckResult {
  safe: boolean;
  blocked: BlockedAction[];
}

export interface BlockedAction {
  action: string;
  reason: string;
  severity: 'warning' | 'critical';
}

// =============================================================================
// 8.4 Quality Scoring Types
// =============================================================================

export interface QualityScore {
  overall: number; // 0-100
  components: {
    relevance: number;
    completeness: number;
    safety: number;
    formatting: number;
  };
  tier: 'excellent' | 'good' | 'acceptable' | 'poor';
  shouldCorrect: boolean;
}

// =============================================================================
// Main Guardrail Result
// =============================================================================

export interface GuardrailResult {
  passed: boolean;
  validation: ValidationResult;
  hallucination: HallucinationCheck;
  safety: SafetyCheckResult;
  quality: QualityScore;
  /** Modified response if auto-fixes were applied */
  cleanedResponse?: string;
}

// =============================================================================
// 8.1 Output Validation
// =============================================================================

const MAX_RESPONSE_CHARS = 50_000;
const STUTTER_THRESHOLD = 3; // same sentence repeated 3+ times

// Patterns for raw tool call syntax leaking into response
const TOOL_CALL_LEAK_PATTERNS = [
  /<tool_call>/i,
  /<\/tool_call>/i,
  /\{"type":"tool_use"/,
  /\{"role":"tool"/,
  /"tool_calls"\s*:\s*\[/,
  /\[TOOL_CALL\]/i,
  /<function_calls>/i,
  /\[FUNCTION_CALL\]/i,
];

// Patterns indicating the system prompt may be echoed back
const SYSTEM_PROMPT_ECHO_PATTERNS = [
  /you are an? (helpful |professional |ai |intelligent )?assistant/i,
  /your name is (profclaw|professor claw|prof claw)/i,
  /you must (always|never|only) respond/i,
  /\[system\]/i,
  /<system>/i,
];

/**
 * Validate an agent response for format, content, safety, and structural issues.
 */
export function validateAgentResponse(
  response: string,
  context: GuardrailContext,
): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Check 1: Non-empty response
  if (!response || response.trim().length === 0) {
    issues.push({
      type: 'content',
      severity: 'error',
      message: 'Response is empty',
    });
    return { valid: false, issues, score: 0 };
  }

  // Check 2: System prompt echo detection
  const echoMatches = SYSTEM_PROMPT_ECHO_PATTERNS.filter((p) => p.test(response));
  if (echoMatches.length >= 2) {
    issues.push({
      type: 'content',
      severity: 'error',
      message: 'Response appears to echo the system prompt back to the user',
    });
  }

  // Check 3: Raw tool call syntax leak
  const leakMatches = TOOL_CALL_LEAK_PATTERNS.filter((p) => p.test(response));
  if (leakMatches.length > 0) {
    issues.push({
      type: 'format',
      severity: 'error',
      message: `Response contains raw tool call syntax (${leakMatches.length} pattern(s) matched) - model is leaking internals`,
    });
  }

  // Check 4: Response length
  if (response.length > MAX_RESPONSE_CHARS) {
    issues.push({
      type: 'format',
      severity: 'warning',
      message: `Response exceeds ${MAX_RESPONSE_CHARS} characters (${response.length} chars) - may indicate runaway generation`,
    });
  }

  // Check 5: Stutter / repeated sentence detection
  const stutterIssue = detectStuttering(response);
  if (stutterIssue) {
    issues.push(stutterIssue);
  }

  // Check 6: Code block brace balance
  const codeBlockIssues = checkCodeBlockBalance(response);
  issues.push(...codeBlockIssues);

  // Check 7: Query context hint (warn if response seems completely unrelated)
  if (context.userQuery && context.userQuery.length > 10) {
    const queryWords = extractKeywords(context.userQuery);
    const responseWords = extractKeywords(response);
    const overlap = queryWords.filter((w) => responseWords.includes(w)).length;
    if (queryWords.length > 3 && overlap === 0) {
      issues.push({
        type: 'content',
        severity: 'warning',
        message: 'Response shares no keywords with the user query - may be off-topic',
      });
    }
  }

  const hasErrors = issues.some((i) => i.severity === 'error');
  const errorPenalty = issues.filter((i) => i.severity === 'error').length * 20;
  const warningPenalty = issues.filter((i) => i.severity === 'warning').length * 10;
  const score = Math.max(0, 100 - errorPenalty - warningPenalty);

  return {
    valid: !hasErrors,
    issues,
    score,
  };
}

function detectStuttering(response: string): ValidationIssue | null {
  // Split into sentences by common sentence terminators
  const sentences = response
    .split(/[.!?]\s+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 15); // ignore short fragments

  if (sentences.length < STUTTER_THRESHOLD) return null;

  const counts = new Map<string, number>();
  for (const sentence of sentences) {
    const normalized = sentence.replace(/\s+/g, ' ');
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  for (const [sentence, count] of counts) {
    if (count >= STUTTER_THRESHOLD) {
      return {
        type: 'format',
        severity: 'error',
        message: `Stutter detected: "${sentence.slice(0, 60)}..." repeated ${count} times`,
      };
    }
  }

  return null;
}

function checkCodeBlockBalance(response: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  // Extract code blocks
  const codeBlockRegex = /```[\w]*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(response)) !== null) {
    const code = match[1];
    if (!code) continue;

    // Check brace/bracket balance
    const openBraces = (code.match(/\{/g) ?? []).length;
    const closeBraces = (code.match(/\}/g) ?? []).length;
    const openBrackets = (code.match(/\[/g) ?? []).length;
    const closeBrackets = (code.match(/\]/g) ?? []).length;

    if (openBraces !== closeBraces) {
      issues.push({
        type: 'format',
        severity: 'warning',
        message: `Code block has unbalanced braces: ${openBraces} opening vs ${closeBraces} closing`,
      });
    }
    if (openBrackets !== closeBrackets) {
      issues.push({
        type: 'format',
        severity: 'warning',
        message: `Code block has unbalanced brackets: ${openBrackets} opening vs ${closeBrackets} closing`,
      });
    }
  }

  return issues;
}

// =============================================================================
// 8.2 Hallucination Detection
// =============================================================================

// Fabricated URL patterns - overly versioned or nonsense paths
const FABRICATED_URL_PATTERNS = [
  /https?:\/\/example\.com\/api\/v\d{2,}/i,   // e.g. /api/v99/
  /https?:\/\/(?:foo|bar|baz|test)\.example\.com/i,
  /https?:\/\/api\.(?:fake|nonexistent|placeholder)\.(?:com|io|dev)/i,
];

// Unrealistic library version patterns
const UNREALISTIC_VERSION_PATTERNS: Array<{ pattern: RegExp; maxMajor: number; name: string }> = [
  { pattern: /React\s+v?(\d+)\./i, maxMajor: 20, name: 'React' },
  { pattern: /Next\.js\s+v?(\d+)\./i, maxMajor: 20, name: 'Next.js' },
  { pattern: /Vue\s+v?(\d+)\./i, maxMajor: 5, name: 'Vue' },
  { pattern: /Angular\s+v?(\d+)\./i, maxMajor: 30, name: 'Angular' },
  { pattern: /Node\.js\s+v?(\d+)\./i, maxMajor: 30, name: 'Node.js' },
  { pattern: /TypeScript\s+v?(\d+)\./i, maxMajor: 10, name: 'TypeScript' },
  { pattern: /Python\s+v?(\d+)\./i, maxMajor: 5, name: 'Python' },
  { pattern: /Django\s+v?(\d+)\./i, maxMajor: 10, name: 'Django' },
  { pattern: /Rust\s+v?(\d+)\./i, maxMajor: 3, name: 'Rust' },
  { pattern: /Go\s+v?(\d+)\./i, maxMajor: 3, name: 'Go' },
];

// File path-like patterns in response text
const FILE_PATH_PATTERN = /(?:^|\s|`|")(\/?(?:src|lib|app|pages|components|utils|hooks|api|routes|models|services|config|tests?)\/[\w\-./]+\.\w{1,6})(?:\s|`|"|$)/gm;

/**
 * Detect potential hallucinations in a response.
 */
export function detectHallucinations(
  response: string,
  context: GuardrailContext,
): HallucinationCheck {
  const flags: HallucinationFlag[] = [];

  // Check 1: File paths mentioned vs known project files
  if (context.knownFiles && context.knownFiles.length > 0) {
    const mentionedPaths = extractFilePaths(response);
    for (const mentionedPath of mentionedPaths) {
      const normalized = mentionedPath.replace(/^\.\//, '');
      const exists = context.knownFiles.some(
        (f) => f.endsWith(normalized) || f.includes(normalized),
      );
      if (!exists) {
        flags.push({
          type: 'nonexistent_file',
          reference: mentionedPath,
          confidence: 0.7,
        });
      }
    }
  }

  // Check 2: Tool names mentioned vs registered tools
  if (context.registeredTools && context.registeredTools.length > 0) {
    const toolRefs = extractToolReferences(response, context.registeredTools);
    for (const ref of toolRefs) {
      if (!context.registeredTools.includes(ref)) {
        flags.push({
          type: 'nonexistent_tool',
          reference: ref,
          confidence: 0.8,
        });
      }
    }
  }

  // Check 3: Fabricated URLs
  for (const pattern of FABRICATED_URL_PATTERNS) {
    const urlMatch = pattern.exec(response);
    if (urlMatch) {
      flags.push({
        type: 'nonexistent_api',
        reference: urlMatch[0],
        confidence: 0.75,
      });
    }
  }

  // Check 4: Unrealistic version numbers
  for (const { pattern, maxMajor, name } of UNREALISTIC_VERSION_PATTERNS) {
    const vMatch = pattern.exec(response);
    if (vMatch && vMatch[1]) {
      const major = parseInt(vMatch[1], 10);
      if (major > maxMajor) {
        flags.push({
          type: 'fabricated_data',
          reference: `${name} v${major} (max realistic major: ${maxMajor})`,
          confidence: 0.9,
        });
      }
    }
  }

  return {
    detected: flags.length > 0,
    flags,
  };
}

function extractFilePaths(text: string): string[] {
  const paths: string[] = [];
  const regex = new RegExp(FILE_PATH_PATTERN.source, FILE_PATH_PATTERN.flags);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) {
      paths.push(match[1].trim());
    }
  }
  // Deduplicate
  return [...new Set(paths)];
}

function extractToolReferences(text: string, registeredTools: string[]): string[] {
  // Look for references to known tool name patterns and potential tool names in backticks
  const found: string[] = [];
  const backtickRefs = text.match(/`([a-z][a-z0-9_-]{2,40})`/gi) ?? [];

  for (const ref of backtickRefs) {
    const name = ref.replace(/`/g, '');
    // Only flag if it looks like a tool (snake_case or kebab-case function name)
    if (/^[a-z][a-z0-9_]{2,}$/.test(name) && !registeredTools.includes(name)) {
      // Only flag if there's at least one registered tool with similar naming
      const hasSimilarStyle = registeredTools.some((t) => /^[a-z][a-z0-9_]{2,}$/.test(t));
      if (hasSimilarStyle) {
        found.push(name);
      }
    }
  }

  return [...new Set(found)];
}

// =============================================================================
// 8.3 Safety Bounds
// =============================================================================

interface SafetyPattern {
  pattern: RegExp;
  reason: string;
  severity: 'warning' | 'critical';
}

const BLOCKED_SAFETY_PATTERNS: SafetyPattern[] = [
  // Destructive filesystem
  { pattern: /rm\s+-rf?\s+\/(?:\s|$|~|\*)/i, reason: 'Recursive deletion of root or home directory', severity: 'critical' },
  { pattern: /rm\s+-rf?\s+~(?:\/|$)/i, reason: 'Recursive deletion of home directory', severity: 'critical' },
  { pattern: /rm\s+-rf?\s+\/\*/i, reason: 'Recursive deletion of root wildcard', severity: 'critical' },
  // SQL destructive
  { pattern: /DROP\s+TABLE\b/i, reason: 'SQL DROP TABLE - destructive database operation', severity: 'critical' },
  { pattern: /DROP\s+DATABASE\b/i, reason: 'SQL DROP DATABASE - destructive database operation', severity: 'critical' },
  { pattern: /TRUNCATE\s+TABLE\b/i, reason: 'SQL TRUNCATE - destroys all table data', severity: 'critical' },
  // Dangerous chmod on system dirs
  { pattern: /chmod\s+(?:a\+rwx|777)\s+\/(?:etc|usr|bin|sbin|var|sys|proc)/i, reason: 'chmod 777 on system directory', severity: 'critical' },
  // Pipe to shell
  { pattern: /curl\s+.*\|\s*(?:sudo\s+)?(?:ba)?sh\b/i, reason: 'Piping curl output directly to shell', severity: 'critical' },
  { pattern: /wget\s+.*\|\s*(?:sudo\s+)?(?:ba)?sh\b/i, reason: 'Piping wget output directly to shell', severity: 'critical' },
  // Kill init/systemd
  { pattern: /kill\s+(?:-9\s+|-SIGKILL\s+)?1\b/i, reason: 'Attempting to kill PID 1 (init/systemd)', severity: 'critical' },
  { pattern: /kill\s+(?:-9\s+|-SIGKILL\s+)?-1\b/i, reason: 'Attempting to kill all processes', severity: 'critical' },
  // Sensitive system file modification
  { pattern: /(?:echo|tee|cat|write|>>|>)\s+.*(?:\/etc\/passwd|\/etc\/shadow|\.ssh\/authorized_keys)/i, reason: 'Modifying sensitive authentication files', severity: 'critical' },
  { pattern: /\bchpasswd\b/i, reason: 'Changing system passwords', severity: 'critical' },
  // Disk/device destructive writes
  { pattern: />\s*\/dev\/sd[a-z]\b/i, reason: 'Direct write to block device', severity: 'critical' },
  { pattern: /dd\s+.*of=\/dev\/(?:sd[a-z]|nvme\d)/i, reason: 'dd write to disk device', severity: 'critical' },
  { pattern: /mkfs\./i, reason: 'Formatting a filesystem', severity: 'critical' },
  { pattern: /\bformat\s+[a-z]:\\/i, reason: 'Windows disk format command', severity: 'critical' },
  // Firewall flush
  { pattern: /iptables\s+-F\b/i, reason: 'Flushing all iptables firewall rules', severity: 'critical' },
  { pattern: /iptables\s+--flush\b/i, reason: 'Flushing all iptables firewall rules', severity: 'critical' },
  { pattern: /ufw\s+--force\s+reset/i, reason: 'Resetting UFW firewall rules', severity: 'warning' },
  // System shutdown
  { pattern: /\bshutdown\b.*(?:-h|-r|\bnow\b)/i, reason: 'System shutdown or reboot command', severity: 'warning' },
  { pattern: /\breboot\b(?:\s|$)/i, reason: 'System reboot command', severity: 'warning' },
  { pattern: /\bhalt\b(?:\s|$)/i, reason: 'System halt command', severity: 'warning' },
  { pattern: /\bpoweroff\b(?:\s|$)/i, reason: 'System poweroff command', severity: 'warning' },
  // Zero-fill writes
  { pattern: /dd\s+if=\/dev\/zero\s+of=\/dev\//i, reason: 'Zero-filling a block device', severity: 'critical' },
  { pattern: /dd\s+if=\/dev\/urandom\s+of=\/dev\//i, reason: 'Random-filling a block device', severity: 'critical' },
];

/**
 * Check tool parameters against absolute safety bounds.
 * These patterns are blocked even in full-autonomous mode.
 */
export function checkSafetyBounds(
  toolName: string,
  params: Record<string, unknown>,
): SafetyCheckResult {
  const blocked: BlockedAction[] = [];

  // Build a searchable string from all param values
  const paramValues = extractStringValues(params);
  const searchTarget = paramValues.join(' ');

  if (searchTarget.length === 0) {
    return { safe: true, blocked: [] };
  }

  for (const { pattern, reason, severity } of BLOCKED_SAFETY_PATTERNS) {
    if (pattern.test(searchTarget)) {
      blocked.push({
        action: `${toolName}: ${searchTarget.slice(0, 120)}`,
        reason,
        severity,
      });
    }
  }

  return {
    safe: blocked.length === 0,
    blocked,
  };
}

function extractStringValues(obj: Record<string, unknown>, depth = 0): string[] {
  if (depth > 3) return [];
  const values: string[] = [];

  for (const val of Object.values(obj)) {
    if (typeof val === 'string') {
      values.push(val);
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string') {
          values.push(item);
        } else if (item !== null && typeof item === 'object') {
          values.push(...extractStringValues(item as Record<string, unknown>, depth + 1));
        }
      }
    } else if (val !== null && typeof val === 'object') {
      values.push(...extractStringValues(val as Record<string, unknown>, depth + 1));
    }
  }

  return values;
}

// =============================================================================
// 8.4 Quality Scoring
// =============================================================================

const TIER_THRESHOLDS = {
  excellent: 80,
  good: 60,
  acceptable: 40,
} as const;

const CORRECT_BELOW = 40;

// Code-related keywords used to check if response should have code blocks
const CODE_KEYWORDS = [
  'function', 'class', 'const ', 'let ', 'var ', 'return', 'import', 'export',
  'interface', 'type ', 'enum ', 'async', 'await', 'promise', 'callback',
  'snippet', 'example code', 'code block', 'implement', 'script', 'program',
];

/**
 * Score response quality across relevance, completeness, safety, and formatting.
 */
export function scoreResponse(
  response: string,
  userQuery: string,
  context: GuardrailContext,
): QualityScore {
  const relevance = scoreRelevance(response, userQuery);
  const completeness = scoreCompleteness(response, userQuery);
  const safety = scoreSafety(response, context);
  const formatting = scoreFormatting(response, userQuery);

  const overall = Math.round((relevance + completeness + safety + formatting) / 4);
  const tier = getTier(overall);

  return {
    overall,
    components: { relevance, completeness, safety, formatting },
    tier,
    shouldCorrect: overall < CORRECT_BELOW,
  };
}

function scoreRelevance(response: string, userQuery: string): number {
  if (!userQuery || userQuery.trim().length === 0) return 70; // neutral if no query

  const queryKeywords = extractKeywords(userQuery);
  const responseKeywords = extractKeywords(response);

  if (queryKeywords.length === 0) return 70;

  const matched = queryKeywords.filter((kw) => responseKeywords.includes(kw)).length;
  const ratio = matched / queryKeywords.length;

  // Scale: 0% overlap = 20, 100% overlap = 100
  return Math.round(20 + ratio * 80);
}

function scoreCompleteness(response: string, userQuery: string): number {
  const trimmed = response.trim();
  const wordCount = trimmed.split(/\s+/).length;

  // Estimate query complexity by word count
  const queryWords = userQuery.trim().split(/\s+/).length;
  const isComplexQuery = queryWords > 15;
  const isSimpleQuery = queryWords <= 5;

  // Check if it's a question
  const isQuestion = /\?$/.test(userQuery.trim()) || /^(?:what|how|why|when|where|who|can|could|should|would|is|are|do|does)\b/i.test(userQuery.trim());

  let expectedMinWords: number;

  if (isSimpleQuery && !isQuestion) {
    expectedMinWords = 10;
  } else if (isComplexQuery || isQuestion) {
    expectedMinWords = 50;
  } else {
    expectedMinWords = 25;
  }

  if (wordCount < 3) return 10; // near-empty response
  if (wordCount >= expectedMinWords * 3) return 100; // more than enough
  if (wordCount >= expectedMinWords) return 80;
  if (wordCount >= expectedMinWords / 2) return 55;
  return 30;
}

function scoreSafety(response: string, context: GuardrailContext): number {
  // Run safety check on response text treated as a pseudo-command
  const safetyResult = checkSafetyBounds('response_text', { content: response });

  if (!safetyResult.safe) {
    const criticalCount = safetyResult.blocked.filter((b) => b.severity === 'critical').length;
    const warningCount = safetyResult.blocked.filter((b) => b.severity === 'warning').length;
    return Math.max(0, 100 - criticalCount * 40 - warningCount * 10);
  }

  // Also check if securityMode context indicates elevated caution
  if (context.securityMode === 'deny') return 100; // deny mode = nothing runs = safe

  return 100;
}

function scoreFormatting(response: string, userQuery: string): number {
  let score = 50; // baseline

  const trimmed = response.trim();
  const hasMultipleParagraphs = trimmed.split(/\n\n+/).length > 1;
  const hasCodeBlock = /```[\s\S]*?```/.test(trimmed);
  const hasBulletList = /^[-*+]\s/m.test(trimmed);
  const hasNumberedList = /^\d+\.\s/m.test(trimmed);
  const hasHeaders = /^#+\s/m.test(trimmed);

  // Is the query code-related?
  const isCodeQuery = CODE_KEYWORDS.some((kw) =>
    userQuery.toLowerCase().includes(kw),
  );

  // Good structure bonuses
  if (hasMultipleParagraphs) score += 10;
  if (hasBulletList || hasNumberedList) score += 10;
  if (hasHeaders && trimmed.length > 500) score += 5; // headers only help for longer responses

  // Code block relevance
  if (isCodeQuery && hasCodeBlock) score += 20;
  if (isCodeQuery && !hasCodeBlock) score -= 15; // expected code but none provided

  // Penalize very short responses to complex queries
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount < 5) score -= 30;

  // Cap to 0-100
  return Math.max(0, Math.min(100, score));
}

function getTier(score: number): QualityScore['tier'] {
  if (score >= TIER_THRESHOLDS.excellent) return 'excellent';
  if (score >= TIER_THRESHOLDS.good) return 'good';
  if (score >= TIER_THRESHOLDS.acceptable) return 'acceptable';
  return 'poor';
}

// =============================================================================
// Shared Utilities
// =============================================================================

// Common English stop words to exclude from keyword extraction
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'it', 'its', 'this', 'that', 'these',
  'those', 'i', 'you', 'we', 'they', 'he', 'she', 'my', 'your', 'our',
  'how', 'what', 'when', 'where', 'why', 'which', 'who', 'not', 'no',
  'if', 'so', 'as', 'up', 'out', 'about', 'into', 'then', 'than', 'just',
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
}

// =============================================================================
// Main Guardrail Pipeline
// =============================================================================

/**
 * Run all guardrails on an agent response and its tool calls.
 * Returns a comprehensive result with per-check details and optional cleaned response.
 */
export async function runGuardrails(
  response: string,
  toolCalls: Array<{ name: string; params: Record<string, unknown> }>,
  context: GuardrailContext,
): Promise<GuardrailResult> {
  // Run all checks (pure functions - can run in parallel conceptually)
  const validation = validateAgentResponse(response, context);
  const hallucination = detectHallucinations(response, context);
  const quality = scoreResponse(response, context.userQuery ?? '', context);

  // Safety bounds: check the response text AND all tool call params
  const safetyChecks: SafetyCheckResult[] = [
    checkSafetyBounds('response_text', { content: response }),
    ...toolCalls.map((tc) => checkSafetyBounds(tc.name, tc.params)),
  ];

  const safety: SafetyCheckResult = {
    safe: safetyChecks.every((r) => r.safe),
    blocked: safetyChecks.flatMap((r) => r.blocked),
  };

  // Determine if guardrails passed overall
  // Fail if: validation errors, safety violations, or very poor quality
  const passed =
    validation.valid &&
    safety.safe &&
    !quality.shouldCorrect;

  // Auto-clean response if there are fixable issues but otherwise valid
  let cleanedResponse: string | undefined;
  if (!passed || validation.issues.some((i) => i.autoFixed)) {
    cleanedResponse = applyAutoFixes(response, validation.issues);
    if (cleanedResponse === response) {
      // No changes were made - don't return a cleanedResponse
      cleanedResponse = undefined;
    }
  }

  if (!passed) {
    console.error('[guardrails] Guardrail check failed', {
      validationIssues: validation.issues.length,
      hallucinationFlags: hallucination.flags.length,
      safetyBlocked: safety.blocked.length,
      qualityTier: quality.tier,
    });
  }

  return {
    passed,
    validation,
    hallucination,
    safety,
    quality,
    cleanedResponse,
  };
}

/**
 * Apply automatic fixes to a response based on detected issues.
 * Returns the (potentially modified) response.
 */
function applyAutoFixes(response: string, issues: ValidationIssue[]): string {
  let cleaned = response;

  for (const issue of issues) {
    if (issue.type === 'format' && issue.message.includes('raw tool call syntax')) {
      // Strip tool call XML/JSON artifacts from the response
      cleaned = cleaned
        .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
        .replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, '')
        .replace(/\{"type":"tool_use"[\s\S]*?\}/g, '')
        .replace(/\[TOOL_CALL\][\s\S]*?\[\/TOOL_CALL\]/gi, '')
        .trim();
    }
  }

  return cleaned;
}
