/**
 * PromptSuggestionEngine
 *
 * Generates contextual follow-up prompt suggestions based on the current
 * conversation context. All logic is local — no LLM calls.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Suggestion {
  text: string;
  category: 'follow-up' | 'deeper' | 'related' | 'action';
}

export interface SuggestionContext {
  lastUserMessage: string;
  lastAssistantResponse: string;
  toolsUsed?: string[];
  conversationLength: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CODE_PATTERNS = [
  /```[\w]*\n/,
  /function\s+\w+/,
  /class\s+\w+/,
  /const\s+\w+\s*=/,
  /import\s+/,
  /export\s+/,
  /\.(ts|js|tsx|jsx|py|go|rs|java)\b/,
  /\bcode\b/i,
  /\bimplementation\b/i,
  /\brefactor\b/i,
];

const ERROR_PATTERNS = [
  /\berror\b/i,
  /\bfailed\b/i,
  /\bfailure\b/i,
  /\bexception\b/i,
  /\bthrew\b/i,
  /\bcrash\b/i,
  /\bundefined\b/i,
  /\bnull\b/i,
  /\btrace\b/i,
  /\bstack\b/i,
];

const FILE_EDIT_PATTERNS = [
  /\bedited\b/i,
  /\bmodified\b/i,
  /\bupdated\b/i,
  /\bwrote\b/i,
  /\bchanged\b/i,
  /\bsaved\b/i,
  /\bfile\b/i,
];

const CONCEPT_PATTERNS = [
  /\bexplain\b/i,
  /\bhow\s+does\b/i,
  /\bwhat\s+is\b/i,
  /\bwhy\b/i,
  /\bwhen\s+should\b/i,
  /\bdifference\b/i,
];

function containsAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

/** Extract a plausible code subject from the assistant message (best-effort). */
function extractCodeSubject(response: string): string {
  // Try to find a function/class name
  const fnMatch = response.match(/function\s+(\w+)/);
  if (fnMatch) return fnMatch[1] ?? 'this';

  const classMatch = response.match(/class\s+(\w+)/);
  if (classMatch) return classMatch[1] ?? 'this';

  const constMatch = response.match(/const\s+(\w+)\s*=/);
  if (constMatch) return constMatch[1] ?? 'this';

  return 'this';
}

/** Extract the first tool name from the list or a default. */
function extractToolName(tools: string[]): string {
  return tools[0] ?? 'this tool';
}

// ── Engine ────────────────────────────────────────────────────────────────────

export class PromptSuggestionEngine {
  /**
   * Generate up to 3 contextual follow-up suggestions.
   *
   * Rules (local, no LLM):
   * - If assistant mentioned code → "Can you explain X?" or "Write tests for this"
   * - If assistant used tools    → "What else can you do with {tool}?"
   * - If short conversation      → exploratory prompts
   * - If error was mentioned     → "How do I fix this?" or "What caused this?"
   * - If file was edited         → "Show me the diff" or "Run the tests"
   * - Vary by conversation length (early = broad, late = specific)
   * - Always cap at 3
   */
  generateSuggestions(context: SuggestionContext): Suggestion[] {
    const { lastUserMessage, lastAssistantResponse, toolsUsed = [], conversationLength } = context;
    const combined = lastUserMessage + ' ' + lastAssistantResponse;
    const suggestions: Suggestion[] = [];

    const hasCode = containsAny(combined, CODE_PATTERNS);
    const hasError = containsAny(combined, ERROR_PATTERNS);
    const hasFileEdit = containsAny(combined, FILE_EDIT_PATTERNS);
    const hasTools = toolsUsed.length > 0;
    const hasConcept = containsAny(combined, CONCEPT_PATTERNS);
    const isEarlyConversation = conversationLength <= 4;

    // --- Error-related suggestions (highest priority) ---
    if (hasError) {
      suggestions.push({
        text: 'How do I fix this error?',
        category: 'follow-up',
      });
      suggestions.push({
        text: 'What caused this error and how can I prevent it?',
        category: 'deeper',
      });
    }

    // --- File edit suggestions ---
    if (hasFileEdit && !hasError) {
      suggestions.push({
        text: '/diff',
        category: 'action',
      });
      suggestions.push({
        text: 'Run the tests to verify the changes',
        category: 'action',
      });
    }

    // --- Code-related suggestions ---
    if (hasCode && !hasError) {
      const subject = extractCodeSubject(lastAssistantResponse);
      suggestions.push({
        text: `Can you explain how ${subject} works?`,
        category: 'deeper',
      });
      suggestions.push({
        text: 'Write tests for this',
        category: 'action',
      });
      if (conversationLength > 4) {
        suggestions.push({
          text: 'Optimize this for performance',
          category: 'related',
        });
      }
    }

    // --- Tool usage suggestions ---
    if (hasTools && !hasError) {
      const toolName = extractToolName(toolsUsed);
      suggestions.push({
        text: `What else can you do with ${toolName}?`,
        category: 'related',
      });
    }

    // --- Concept / explanation suggestions ---
    if (hasConcept && !hasError && !hasCode) {
      suggestions.push({
        text: 'Can you give me a concrete example?',
        category: 'follow-up',
      });
      suggestions.push({
        text: 'What are the trade-offs?',
        category: 'deeper',
      });
    }

    // --- Early conversation: broad exploratory prompts ---
    if (isEarlyConversation && suggestions.length < 2) {
      suggestions.push({
        text: 'What else can you help me with?',
        category: 'related',
      });
      suggestions.push({
        text: 'Can you elaborate on that?',
        category: 'follow-up',
      });
    }

    // --- Late conversation: specific follow-up ---
    if (!isEarlyConversation && suggestions.length < 2) {
      suggestions.push({
        text: 'Summarize what we have done so far',
        category: 'follow-up',
      });
      suggestions.push({
        text: 'What should we do next?',
        category: 'action',
      });
    }

    // --- Always ensure at least 2 sensible defaults ---
    if (suggestions.length === 0) {
      suggestions.push({
        text: 'Tell me more about this',
        category: 'follow-up',
      });
      suggestions.push({
        text: 'How does this compare to alternatives?',
        category: 'related',
      });
    }

    // Cap at 3, deduplicate by text
    const seen = new Set<string>();
    const unique: Suggestion[] = [];
    for (const s of suggestions) {
      if (!seen.has(s.text)) {
        seen.add(s.text);
        unique.push(s);
      }
      if (unique.length === 3) break;
    }

    return unique;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _engine: PromptSuggestionEngine | null = null;

export function getPromptSuggestionEngine(): PromptSuggestionEngine {
  if (!_engine) {
    _engine = new PromptSuggestionEngine();
  }
  return _engine;
}
