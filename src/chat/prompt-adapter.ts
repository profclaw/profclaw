/**
 * Model-Adaptive Prompt System
 *
 * Adapts system prompts based on model capability:
 * - Reasoning models (Claude, GPT-4): high-level goals, natural language
 * - Instruction models (GPT-3.5, Haiku): step-by-step instructions
 * - Basic models (Llama 7B, Phi): explicit fill-in-the-blank, strict format
 *
 * Also handles:
 * - Context budget awareness (auto-truncate based on context window)
 * - Few-shot examples for small models
 * - Tool usage instructions adapted per level
 */

import { logger } from '../utils/logger.js';

// --- Types ---

export type ModelCapabilityLevel = 'reasoning' | 'instruction' | 'basic';

interface PromptAdaptation {
  level: ModelCapabilityLevel;
  systemPromptPrefix: string;
  toolUsageGuidance: string;
  responseFormat: string;
  maxHistoryTokens: number;
  fewShotExamples: string[];
}

export interface AdaptPromptOptions {
  modelId: string;
  systemPrompt: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  contextWindowSize?: number;
  toolDescriptions?: string;
}

export interface AdaptedPrompt {
  systemPrompt: string;
  truncatedHistory?: Array<{ role: string; content: string }>;
  adaptationLevel: ModelCapabilityLevel;
  estimatedTokens: number;
}

// --- Model Classification ---

const REASONING_PATTERNS = [
  /claude-(3\.5|4|opus|sonnet-4)/i,
  /gpt-4o|gpt-4-turbo|gpt-4\.5/i,
  /gemini-(pro|1\.5|2\.0)/i,
  /o[13]-/i,
  /deepseek-(v3|r1|chat)/i,
  /qwen-?2\.5-(72b|110b)/i,
  /llama-?3\.1-405b/i,
];

const INSTRUCTION_PATTERNS = [
  /claude.*haiku/i,
  /gpt-3\.5/i,
  /gemini.*flash/i,
  /mistral-(large|medium)/i,
  /llama-?3\.(1-70b|3-70b)/i,
  /qwen-?2\.5-(32b|14b)/i,
  /command-r/i,
  /mixtral/i,
];

// Everything else defaults to 'basic'

/**
 * Classify a model's capability level based on its ID
 */
export function classifyModelCapability(modelId: string): ModelCapabilityLevel {
  if (REASONING_PATTERNS.some((p) => p.test(modelId))) return 'reasoning';
  if (INSTRUCTION_PATTERNS.some((p) => p.test(modelId))) return 'instruction';

  // Check for size indicator in model ID (e.g. "llama-13b", "phi-7b")
  const sizeMatch = modelId.match(/(\d+)b$/i);
  if (sizeMatch) {
    const size = parseInt(sizeMatch[1], 10);
    if (size >= 70) return 'instruction';
    if (size >= 30) return 'instruction';
  }

  // Unknown - default to instruction (safe middle ground)
  return 'instruction';
}

/**
 * Get estimated context window size for a model
 */
function getContextWindow(modelId: string): number {
  if (/claude|gpt-4o|gemini-(1\.5|2)/i.test(modelId)) return 128000;
  if (/gpt-4-turbo/i.test(modelId)) return 128000;
  if (/gpt-3\.5/i.test(modelId)) return 16385;
  if (/llama-?3/i.test(modelId)) return 131072;
  if (/qwen/i.test(modelId)) return 32768;
  if (/mistral/i.test(modelId)) return 32768;
  if (/phi/i.test(modelId)) return 16384;
  if (/gemma-?4/i.test(modelId)) return 128000;
  if (/gemma/i.test(modelId)) return 8192;
  return 32768;
}

// --- Prompt Adaptations ---

const ADAPTATIONS: Record<ModelCapabilityLevel, Omit<PromptAdaptation, 'level'>> = {
  reasoning: {
    // No prefix needed - these models understand natural language well
    systemPromptPrefix: '',
    toolUsageGuidance: `Use the available tools as needed to accomplish the user's request. Choose the most appropriate tool for each step.`,
    // Natural language response is fine
    responseFormat: '',
    // Can handle long history
    maxHistoryTokens: 100000,
    // Not needed for reasoning models
    fewShotExamples: [],
  },

  instruction: {
    systemPromptPrefix: `IMPORTANT: Follow these instructions carefully. Complete each step in order.\n\n`,
    toolUsageGuidance: `When using tools:
1. Read the tool description carefully before using it
2. Provide all required parameters
3. Check the result before proceeding to the next step
4. If a tool fails, explain the error to the user`,
    responseFormat: `Format your responses clearly with markdown. Use bullet points for lists.`,
    // More limited context budget
    maxHistoryTokens: 12000,
    fewShotExamples: [
      `User: "Read the file config.json"
Assistant: I'll read that file for you.
[Uses read_file tool with path="config.json"]
Here's the content of config.json: ...`,
    ],
  },

  basic: {
    systemPromptPrefix: `You are a helpful assistant with access to tools. Follow these rules EXACTLY:
1. Answer the user's question directly
2. Use ONLY the tools listed below when needed
3. Do NOT make up tool names - use only what is available
4. Keep responses short and clear\n\n`,
    toolUsageGuidance: `TOOL USAGE RULES:
- Use tools ONLY when the user asks you to do something (read files, search, execute commands)
- Do NOT use tools just to answer simple questions
- When using a tool, provide ALL required parameters exactly
- After using a tool, summarize the result in 1-2 sentences`,
    responseFormat: `RESPONSE FORMAT:
- Keep responses under 200 words unless the user asks for detail
- Use simple language
- Do NOT use complex markdown formatting
- Answer the question first, then explain if needed`,
    // Very limited context budget
    maxHistoryTokens: 4000,
    fewShotExamples: [
      `User: "What's in the src folder?"
Assistant: I'll list the files in src/ for you.
[Uses search_files with directory="src", pattern="*"]
The src/ folder contains: index.ts, server.ts, types.ts, and folders: chat/, routes/, providers/.`,

      `User: "Run the tests"
Assistant: Running tests now.
[Uses exec with command="pnpm test"]
Tests completed: 45 passed, 0 failed.`,
    ],
  },
};

// --- Core Function ---

/**
 * Adapt a system prompt for a specific model's capability level.
 * Adds appropriate prefixes, guidance, and truncates history to fit context budget.
 */
export function adaptPromptForModel(options: AdaptPromptOptions): AdaptedPrompt {
  const level = classifyModelCapability(options.modelId);
  const adaptation = ADAPTATIONS[level];
  const contextWindow = options.contextWindowSize ?? getContextWindow(options.modelId);

  // Suppress unused variable warning - contextWindow reserved for future budget checks
  void contextWindow;

  // Build adapted system prompt
  const parts: string[] = [];

  // Prefix for instruction/basic models
  if (adaptation.systemPromptPrefix) {
    parts.push(adaptation.systemPromptPrefix);
  }

  // Original system prompt
  parts.push(options.systemPrompt);

  // Tool usage guidance (only when tools are available)
  if (options.toolDescriptions) {
    parts.push('\n\n' + adaptation.toolUsageGuidance);
  }

  // Response format guidance for non-reasoning models
  if (adaptation.responseFormat) {
    parts.push('\n\n' + adaptation.responseFormat);
  }

  // Few-shot examples for basic models
  if (adaptation.fewShotExamples.length > 0) {
    parts.push('\n\n## Examples\n');
    for (const example of adaptation.fewShotExamples) {
      parts.push(example);
      parts.push('');
    }
  }

  const adaptedPrompt = parts.join('\n');

  // Truncate conversation history based on context budget
  let truncatedHistory = options.conversationHistory;
  if (truncatedHistory && truncatedHistory.length > 0) {
    truncatedHistory = truncateHistory(truncatedHistory, adaptation.maxHistoryTokens);
  }

  const estimatedTokens = estimateTokenCount(adaptedPrompt);

  logger.debug('[PromptAdapter] Adapted prompt', {
    model: options.modelId,
    level,
    originalLength: options.systemPrompt.length,
    adaptedLength: adaptedPrompt.length,
    estimatedTokens,
    historyMessages: truncatedHistory?.length ?? 0,
  });

  return {
    systemPrompt: adaptedPrompt,
    truncatedHistory,
    adaptationLevel: level,
    estimatedTokens,
  };
}

/**
 * Truncate conversation history to fit within token budget.
 * Always preserves the first message (task context), then keeps most recent messages.
 */
function truncateHistory(
  history: Array<{ role: string; content: string }>,
  maxTokens: number,
): Array<{ role: string; content: string }> {
  if (history.length <= 2) return history;

  let totalTokens = 0;
  const result: Array<{ role: string; content: string }> = [];

  // Always keep first message (usually contains task context)
  result.push(history[0]);
  totalTokens += estimateTokenCount(history[0].content);

  // Add messages from the end (most recent) until budget is exhausted
  const remaining = history.slice(1);
  const reversed = [...remaining].reverse();
  const toAdd: Array<{ role: string; content: string }> = [];

  for (const msg of reversed) {
    const msgTokens = estimateTokenCount(msg.content);
    if (totalTokens + msgTokens > maxTokens) break;
    totalTokens += msgTokens;
    toAdd.unshift(msg);
  }

  result.push(...toAdd);
  return result;
}

/**
 * Rough token count estimate (1 token ~= 4 chars for English text)
 */
function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Get adaptation info for display purposes (e.g. in debug UI or session status)
 */
export function getAdaptationInfo(modelId: string): {
  level: ModelCapabilityLevel;
  description: string;
  maxTools: string;
  historyBudget: string;
} {
  const level = classifyModelCapability(modelId);
  const adaptation = ADAPTATIONS[level];

  const descriptions: Record<ModelCapabilityLevel, string> = {
    reasoning: 'Full capability - natural language, all tools, long context',
    instruction: 'Instruction-following - step-by-step guidance, standard tools',
    basic: 'Basic - explicit rules, essential tools only, short context',
  };

  return {
    level,
    description: descriptions[level],
    maxTools: level === 'basic' ? '8-10' : level === 'instruction' ? '25-30' : 'all',
    historyBudget: `~${adaptation.maxHistoryTokens} tokens`,
  };
}
