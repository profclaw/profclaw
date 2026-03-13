/**
 * Smart System Prompts
 *
 * Generates adaptive system prompt segments based on model capability level.
 * Large models get high-level goals, small models get explicit step-by-step
 * instructions with examples. This makes profClaw work well regardless of
 * which AI model is being used.
 */

import type { ModelCapabilityLevel, ToolTier } from './types.js';

// =============================================================================
// Tool Usage Instructions (per capability level)
// =============================================================================

const TOOL_INSTRUCTIONS: Record<ModelCapabilityLevel, string> = {
  reasoning: `You have access to tools. Use them as needed to complete the user's request.
Chain multiple tool calls when the task requires it - don't stop after one call.
Think about what information you need and which tools will get it most efficiently.
If a tool fails, analyze the error and try an alternative approach.`,

  instruction: `You have access to tools. Follow these rules:
1. Read the tool descriptions carefully before using them.
2. Use one tool at a time. Wait for the result before deciding the next step.
3. If a tool fails, check the error message and try with corrected parameters.
4. Always use "read_file" before "edit_file" or "write_file" to understand current content.
5. Use "directory_tree" or "search_files" to find files before reading them.
6. Report your findings clearly to the user after completing tool calls.`,

  basic: `You have access to a few tools. Use them EXACTLY as described below.

RULES:
- Use ONLY the tools listed. Do not invent tool names.
- Provide ALL required parameters. Check the parameter list carefully.
- Use ONE tool per step. Wait for the result before proceeding.
- If a tool gives an error, tell the user what went wrong.

COMMON PATTERNS:
- To find a file: use "search_files" with a filename pattern
- To read a file: use "read_file" with the exact file path
- To run a command: use "exec" with the command string
- To search text: use "grep" with a search pattern
- To check status: use "git_status" (no parameters needed)

Always explain what you're doing and what the tool returned.`,
};

// =============================================================================
// Response Format Guidance
// =============================================================================

const RESPONSE_FORMAT: Record<ModelCapabilityLevel, string> = {
  reasoning: ``,  // No format constraints for reasoning models

  instruction: `When reporting results:
- Summarize findings concisely
- Include relevant code snippets or file paths
- Suggest next steps if applicable`,

  basic: `RESPONSE FORMAT:
- Start with what you did
- Show the result
- Say what it means
- Keep responses short and clear`,
};

// =============================================================================
// Few-Shot Examples (for basic/instruction models)
// =============================================================================

const FEW_SHOT_EXAMPLES: Record<ModelCapabilityLevel, string> = {
  reasoning: ``, // No examples needed

  instruction: `Example tool usage:
User: "What files are in the src directory?"
Assistant: I'll check the directory structure.
[Uses directory_tree with path="src"]
The src directory contains: [list results]`,

  basic: `EXAMPLES OF CORRECT TOOL USAGE:

Example 1 - Reading a file:
User: "Show me the config file"
You: I'll read the config file.
Tool call: read_file(path="/path/to/config.ts")
Result: [file contents shown]
You: Here's the config file. It contains [summary].

Example 2 - Running a command:
User: "Run the tests"
You: I'll run the test suite.
Tool call: exec(command="pnpm test")
Result: [test output]
You: Tests completed. 15 passed, 0 failed.

Example 3 - Finding files:
User: "Find the login component"
You: I'll search for it.
Tool call: search_files(pattern="**/login*", path="src")
Result: [matching files]
You: Found the login component at src/components/Login.tsx.`,
};

// =============================================================================
// Context Budget Guidance
// =============================================================================

/**
 * Estimate token count for a string (rough: 4 chars per token).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate conversation history to fit within a token budget.
 * Keeps the most recent messages and the system prompt.
 */
export function truncateHistory(
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
): Array<{ role: string; content: string }> {
  let totalTokens = 0;
  const result: Array<{ role: string; content: string }> = [];

  // Always keep the first message (system prompt) if present
  const systemMsg = messages[0]?.role === 'system' ? messages[0] : undefined;
  const nonSystem = systemMsg ? messages.slice(1) : messages;

  if (systemMsg) {
    totalTokens += estimateTokens(systemMsg.content);
    result.push(systemMsg);
  }

  // Add messages from most recent, working backwards
  const reversed = [...nonSystem].reverse();
  const kept: Array<{ role: string; content: string }> = [];

  for (const msg of reversed) {
    const msgTokens = estimateTokens(msg.content);
    if (totalTokens + msgTokens > maxTokens) break;
    totalTokens += msgTokens;
    kept.unshift(msg);
  }

  result.push(...kept);
  return result;
}

// =============================================================================
// Main Builder
// =============================================================================

/**
 * Build adaptive tool usage prompt segment for the given model capability.
 */
export function buildToolPrompt(capability: ModelCapabilityLevel): string {
  const parts: string[] = [];

  const instructions = TOOL_INSTRUCTIONS[capability];
  if (instructions) {
    parts.push(instructions);
  }

  const format = RESPONSE_FORMAT[capability];
  if (format) {
    parts.push(format);
  }

  const examples = FEW_SHOT_EXAMPLES[capability];
  if (examples) {
    parts.push(examples);
  }

  return parts.filter(Boolean).join('\n\n');
}

/**
 * Get the recommended context window usage for history,
 * leaving room for tool schemas and response.
 */
export function getHistoryBudget(
  contextWindow: number,
  capability: ModelCapabilityLevel,
): number {
  // Reserve tokens for: tool schemas + system prompt + response generation
  const reservations: Record<ModelCapabilityLevel, number> = {
    basic: 3000,       // Small schema + small response buffer
    instruction: 8000, // Medium schema + response buffer
    reasoning: 25000,  // Full schema + thinking + response
  };

  const reserved = reservations[capability];
  return Math.max(1000, contextWindow - reserved);
}
