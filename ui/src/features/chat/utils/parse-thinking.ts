/**
 * Parse Thinking Utility
 *
 * Extracts thinking/reasoning from AI responses and filters raw JSON.
 * Used to separate what the AI "thinks" from what it should show to users.
 */

// Regex patterns for detecting various "thinking" patterns
const THINKING_PATTERNS = [
  // Claude-style thinking blocks
  /<thinking>([\s\S]*?)<\/thinking>/gi,
  // Common prefixes that indicate internal reasoning
  /^(Since there's no specific prompt.*?(?=\n\n|$))/gim,
  /^(I'll create a hypothetical.*?(?=\n\n|$))/gim,
  /^(Let me think about.*?(?=\n\n|$))/gim,
  /^(Thinking about this.*?(?=\n\n|$))/gim,
];

// Regex for detecting raw JSON function calls in text
const RAW_JSON_PATTERNS = [
  // {"name": "...", "parameters": {...}}
  /\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"parameters"\s*:\s*\{[^}]*\}\s*\}/g,
  // {"function": "...", "args": {...}}
  /\{\s*"function"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[^}]*\}\s*\}/g,
  // Generic function call JSON
  /\{\s*["']?name["']?\s*:\s*["'][^"']+["']\s*,\s*["']?parameters["']?\s*:\s*\{[^}]*\}\s*\}/gi,
];

export interface ParsedResponse {
  /** The clean content to display to the user */
  content: string;
  /** Any extracted thinking/reasoning (hidden by default) */
  thinking: string | null;
  /** Raw JSON function calls that were filtered out */
  filteredJson: string[];
  /** Whether any thinking or filtering occurred */
  wasProcessed: boolean;
}

/**
 * Parse and clean AI response content
 * - Extracts thinking blocks into separate field
 * - Filters out raw JSON function calls
 * - Returns clean user-facing content
 */
export function parseThinking(rawContent: string): ParsedResponse {
  let content = rawContent;
  let thinking: string[] = [];
  const filteredJson: string[] = [];
  let wasProcessed = false;

  // 1. Extract <thinking> blocks
  for (const pattern of THINKING_PATTERNS) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        thinking.push(match[1].trim());
        wasProcessed = true;
      }
    }
    content = content.replace(pattern, '');
  }

  // 2. Filter out raw JSON function calls
  for (const pattern of RAW_JSON_PATTERNS) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      filteredJson.push(match[0]);
      wasProcessed = true;
    }
    content = content.replace(pattern, '');
  }

  // 3. Clean up extra whitespace/newlines left behind
  content = content
    .replace(/\n{3,}/g, '\n\n') // Max 2 newlines
    .trim();

  // 4. If content is now empty but we have thinking, show a default message
  if (!content && (thinking.length > 0 || filteredJson.length > 0)) {
    content = "I'm processing your request. Check my reasoning below for details.";
  }

  return {
    content,
    thinking: thinking.length > 0 ? thinking.join('\n\n') : null,
    filteredJson,
    wasProcessed,
  };
}

/**
 * Check if content likely contains raw JSON output that should be filtered
 */
export function containsRawJson(content: string): boolean {
  return RAW_JSON_PATTERNS.some((pattern) => pattern.test(content));
}

/**
 * Check if content contains thinking blocks
 */
export function containsThinking(content: string): boolean {
  return THINKING_PATTERNS.some((pattern) => pattern.test(content));
}
