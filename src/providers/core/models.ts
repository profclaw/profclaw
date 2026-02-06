/**
 * AI Model Definitions
 *
 * Model aliases and catalog for all supported AI providers.
 */

import { ProviderType, type ModelInfo } from './types.js';

// =============================================================================
// Model Aliases
// =============================================================================

export const MODEL_ALIASES: Record<string, { provider: ProviderType; model: string }> = {
  // Anthropic
  opus: { provider: 'anthropic', model: 'claude-opus-4-6' },
  sonnet: { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
  haiku: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },

  // OpenAI
  gpt: { provider: 'openai', model: 'gpt-4o' },
  'gpt-mini': { provider: 'openai', model: 'gpt-4o-mini' },
  o1: { provider: 'openai', model: 'o1' },
  'o1-mini': { provider: 'openai', model: 'o1-mini' },
  'o3-mini': { provider: 'openai', model: 'o3-mini' },

  // Azure OpenAI (uses configured deployment - not hardcoded)
  azure: { provider: 'azure', model: 'default' },
  'azure-gpt': { provider: 'azure', model: 'default' },

  // Google
  gemini: { provider: 'google', model: 'gemini-1.5-pro' },
  'gemini-flash': { provider: 'google', model: 'gemini-1.5-flash' },
  'gemini-thinking': { provider: 'google', model: 'gemini-2.0-flash-thinking-exp' },

  // Groq (fast inference)
  groq: { provider: 'groq', model: 'llama-3.3-70b-versatile' },
  'groq-fast': { provider: 'groq', model: 'llama-3.1-8b-instant' },
  'groq-mixtral': { provider: 'groq', model: 'mixtral-8x7b-32768' },

  // Ollama (local)
  local: { provider: 'ollama', model: 'llama3.2' },
  llama: { provider: 'ollama', model: 'llama3.2' },
  'deepseek-local': { provider: 'ollama', model: 'deepseek-r1:7b' },
  qwen: { provider: 'ollama', model: 'qwen2.5:14b' },
  'mistral-local': { provider: 'ollama', model: 'mistral:7b' },

  // xAI (Grok)
  grok: { provider: 'xai', model: 'grok-2' },
  'grok-3': { provider: 'xai', model: 'grok-3' },

  // Mistral
  mistral: { provider: 'mistral', model: 'mistral-large-latest' },
  'mistral-medium': { provider: 'mistral', model: 'mistral-medium-latest' },
  codestral: { provider: 'mistral', model: 'codestral-latest' },

  // Cohere
  command: { provider: 'cohere', model: 'command-r-plus' },
  'command-r': { provider: 'cohere', model: 'command-r' },

  // Perplexity
  perplexity: { provider: 'perplexity', model: 'llama-3.1-sonar-huge-128k-online' },
  'pplx-fast': { provider: 'perplexity', model: 'llama-3.1-sonar-small-128k-online' },

  // DeepSeek
  deepseek: { provider: 'deepseek', model: 'deepseek-chat' },
  'deepseek-coder': { provider: 'deepseek', model: 'deepseek-coder' },
  'deepseek-r1': { provider: 'deepseek', model: 'deepseek-reasoner' },

  // Together AI
  together: { provider: 'together', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  'together-qwen': { provider: 'together', model: 'Qwen/Qwen2.5-72B-Instruct-Turbo' },

  // Cerebras
  cerebras: { provider: 'cerebras', model: 'llama3.1-70b' },

  // Fireworks
  fireworks: { provider: 'fireworks', model: 'accounts/fireworks/models/llama-v3p1-70b-instruct' },

  // GitHub Copilot (via proxy)
  copilot: { provider: 'copilot', model: 'gpt-4o' },
  'copilot-fast': { provider: 'copilot', model: 'gpt-4o-mini' },
};

// =============================================================================
// Model Catalog
// =============================================================================

export const MODEL_CATALOG: ModelInfo[] = [
  // Anthropic - All support native function calling
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    provider: 'anthropic',
    contextWindow: 1000000,
    maxOutput: 128000,
    supportsVision: true,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 5,
    costPer1MOutput: 25,
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    name: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    contextWindow: 200000,
    maxOutput: 16000,
    supportsVision: true,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 3,
    costPer1MOutput: 15,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    contextWindow: 200000,
    maxOutput: 8192,
    supportsVision: true,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.25,
    costPer1MOutput: 1.25,
  },

  // OpenAI - GPT-4+ supports function calling
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    contextWindow: 128000,
    maxOutput: 16384,
    supportsVision: true,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 2.5,
    costPer1MOutput: 10,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    contextWindow: 128000,
    maxOutput: 16384,
    supportsVision: true,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.15,
    costPer1MOutput: 0.6,
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    contextWindow: 128000,
    maxOutput: 16384,
    supportsVision: true,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 2.0,
    costPer1MOutput: 8.0,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    contextWindow: 128000,
    maxOutput: 16384,
    supportsVision: true,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.4,
    costPer1MOutput: 1.6,
  },
  {
    id: 'o1',
    name: 'o1',
    provider: 'openai',
    contextWindow: 200000,
    maxOutput: 100000,
    supportsVision: false,
    supportsStreaming: false,
    supportsTools: true,
    costPer1MInput: 15,
    costPer1MOutput: 60,
  },
  {
    id: 'o1-mini',
    name: 'o1 Mini',
    provider: 'openai',
    contextWindow: 128000,
    maxOutput: 65536,
    supportsVision: false,
    supportsStreaming: false,
    supportsTools: true,
    costPer1MInput: 1.1,
    costPer1MOutput: 4.4,
  },
  {
    id: 'o3-mini',
    name: 'o3 Mini',
    provider: 'openai',
    contextWindow: 200000,
    maxOutput: 100000,
    supportsVision: false,
    supportsStreaming: false,
    supportsTools: true,
    costPer1MInput: 1.1,
    costPer1MOutput: 4.4,
  },

  // Google - Gemini supports function calling
  {
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    provider: 'google',
    contextWindow: 2000000,
    maxOutput: 65536,
    supportsVision: true,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 1.25,
    costPer1MOutput: 5,
  },
  {
    id: 'gemini-1.5-flash',
    name: 'Gemini 1.5 Flash',
    provider: 'google',
    contextWindow: 1000000,
    maxOutput: 8192,
    supportsVision: true,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.075,
    costPer1MOutput: 0.3,
  },
  {
    id: 'gemini-2.0-flash-thinking-exp',
    name: 'Gemini 2.0 Flash Thinking',
    provider: 'google',
    contextWindow: 1000000,
    maxOutput: 8192,
    supportsVision: true,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.075,
    costPer1MOutput: 0.3,
  },

  // Groq - Llama models via Groq support function calling
  {
    id: 'llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B',
    provider: 'groq',
    contextWindow: 128000,
    maxOutput: 32768,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.59,
    costPer1MOutput: 0.79,
  },
  {
    id: 'llama-3.1-8b-instant',
    name: 'Llama 3.1 8B Instant',
    provider: 'groq',
    contextWindow: 128000,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.05,
    costPer1MOutput: 0.08,
  },
  {
    id: 'mixtral-8x7b-32768',
    name: 'Mixtral 8x7B',
    provider: 'groq',
    contextWindow: 32768,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.24,
    costPer1MOutput: 0.24,
  },

  // Azure OpenAI
  {
    id: 'gpt-4o',
    name: 'GPT-4o (Azure)',
    provider: 'azure',
    contextWindow: 128000,
    maxOutput: 16384,
    supportsVision: true,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 2.5,
    costPer1MOutput: 10.0,
  },
  {
    id: 'gpt4o',
    name: 'GPT-4o (Azure)',
    provider: 'azure',
    contextWindow: 128000,
    maxOutput: 16384,
    supportsVision: true,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 2.5,
    costPer1MOutput: 10.0,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini (Azure)',
    provider: 'azure',
    contextWindow: 128000,
    maxOutput: 16384,
    supportsVision: true,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.15,
    costPer1MOutput: 0.6,
  },
  {
    id: 'gpt4o-mini',
    name: 'GPT-4o Mini (Azure)',
    provider: 'azure',
    contextWindow: 128000,
    maxOutput: 16384,
    supportsVision: true,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.15,
    costPer1MOutput: 0.6,
  },
  {
    id: 'gpt-4',
    name: 'GPT-4 (Azure)',
    provider: 'azure',
    contextWindow: 128000,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 30.0,
    costPer1MOutput: 60.0,
  },

  // Ollama (local) - Most models don't reliably support native tool calling
  {
    id: 'llama3.2',
    name: 'Llama 3.2 (Local)',
    provider: 'ollama',
    contextWindow: 131072,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: false, // Reverted: Native tool calling flaky for local models
    costPer1MInput: 0,
    costPer1MOutput: 0,
  },
  {
    id: 'deepseek-r1:7b',
    name: 'DeepSeek R1 7B (Local)',
    provider: 'ollama',
    contextWindow: 32768,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: false,
    costPer1MInput: 0,
    costPer1MOutput: 0,
  },
  {
    id: 'qwen2.5:14b',
    name: 'Qwen 2.5 14B (Local)',
    provider: 'ollama',
    contextWindow: 32768,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: false,
    costPer1MInput: 0,
    costPer1MOutput: 0,
  },
  {
    id: 'mistral:7b',
    name: 'Mistral 7B (Local)',
    provider: 'ollama',
    contextWindow: 32768,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: false,
    costPer1MInput: 0,
    costPer1MOutput: 0,
  },

  // xAI (Grok)
  {
    id: 'grok-2',
    name: 'Grok 2',
    provider: 'xai',
    contextWindow: 131072,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 2.0,
    costPer1MOutput: 10.0,
  },
  {
    id: 'grok-3',
    name: 'Grok 3',
    provider: 'xai',
    contextWindow: 131072,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 3.0,
    costPer1MOutput: 15.0,
  },

  // Mistral
  {
    id: 'mistral-large-latest',
    name: 'Mistral Large',
    provider: 'mistral',
    contextWindow: 128000,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 2.0,
    costPer1MOutput: 6.0,
  },
  {
    id: 'mistral-medium-latest',
    name: 'Mistral Medium',
    provider: 'mistral',
    contextWindow: 32768,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 2.7,
    costPer1MOutput: 8.1,
  },
  {
    id: 'codestral-latest',
    name: 'Codestral',
    provider: 'mistral',
    contextWindow: 32768,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.2,
    costPer1MOutput: 0.6,
  },

  // DeepSeek
  {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat',
    provider: 'deepseek',
    contextWindow: 64000,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.14,
    costPer1MOutput: 0.28,
  },
  {
    id: 'deepseek-coder',
    name: 'DeepSeek Coder',
    provider: 'deepseek',
    contextWindow: 64000,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.14,
    costPer1MOutput: 0.28,
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek R1',
    provider: 'deepseek',
    contextWindow: 64000,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.55,
    costPer1MOutput: 2.19,
  },
];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get model info by ID
 */
export function getModelInfo(modelId: string): ModelInfo | undefined {
  return MODEL_CATALOG.find((m) => m.id === modelId);
}

/**
 * Get all models for a provider
 */
export function getModelsForProvider(provider: ProviderType): ModelInfo[] {
  return MODEL_CATALOG.filter((m) => m.provider === provider);
}

/**
 * Get all models
 */
export function getAllModels(): ModelInfo[] {
  return MODEL_CATALOG;
}

/**
 * Resolve a model alias to provider and model
 */
export function resolveModelAlias(
  modelOrAlias: string
): { provider: ProviderType; model: string } | undefined {
  // Check if it's an alias
  if (MODEL_ALIASES[modelOrAlias]) {
    return MODEL_ALIASES[modelOrAlias];
  }

  // Check if it's a provider/model format
  if (modelOrAlias.includes('/')) {
    const [provider, model] = modelOrAlias.split('/');
    if (ProviderType.safeParse(provider).success) {
      return { provider: provider as ProviderType, model };
    }
  }

  return undefined;
}
