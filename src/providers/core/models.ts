/**
 * AI Model Definitions
 *
 * Model aliases and catalog for all supported AI providers.
 */

import { ProviderType, type ModelInfo } from './types.js';

// Model Aliases

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
  gemini: { provider: 'google', model: 'gemini-2.5-pro' },
  'gemini-flash': { provider: 'google', model: 'gemini-2.5-flash' },
  'gemini-thinking': { provider: 'google', model: 'gemini-2.0-flash-thinking-exp' },
  'gemini-2': { provider: 'google', model: 'gemini-2.0-flash' },

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
  cerebras: { provider: 'cerebras', model: 'llama3.1-8b' },

  // Fireworks
  fireworks: { provider: 'fireworks', model: 'accounts/fireworks/models/llama-v3p1-70b-instruct' },

  // GitHub Copilot (via proxy)
  copilot: { provider: 'copilot', model: 'gpt-4o' },
  'copilot-fast': { provider: 'copilot', model: 'gpt-4o-mini' },

  // AWS Bedrock
  bedrock: { provider: 'bedrock', model: 'anthropic.claude-3-5-sonnet-20241022-v2:0' },
  'bedrock-haiku': { provider: 'bedrock', model: 'anthropic.claude-3-5-haiku-20241022-v1:0' },
  'bedrock-llama': { provider: 'bedrock', model: 'meta.llama3-1-70b-instruct-v1:0' },

  // Zhipu AI (GLM series) - tested and validated 2026-03-12
  zhipu: { provider: 'zhipu', model: 'glm-4-plus' },
  glm: { provider: 'zhipu', model: 'glm-4-plus' },
  'glm-flash': { provider: 'zhipu', model: 'glm-4.7-flash' },
  'glm-5': { provider: 'zhipu', model: 'glm-5' },
  'glm-4.7': { provider: 'zhipu', model: 'glm-4.7' },
  'glm-4.7-flash': { provider: 'zhipu', model: 'glm-4.7-flash' },
  'glm-air': { provider: 'zhipu', model: 'glm-4-air' },
  'glm-flashx': { provider: 'zhipu', model: 'glm-4-flashx' },
  'glm-long': { provider: 'zhipu', model: 'glm-4-long' },

  // Moonshot AI (Kimi)
  moonshot: { provider: 'moonshot', model: 'moonshot-v1-32k' },
  kimi: { provider: 'moonshot', model: 'moonshot-v1-128k' },
  'kimi-fast': { provider: 'moonshot', model: 'moonshot-v1-8k' },

  // Qwen API (Alibaba Cloud)
  'qwen-cloud': { provider: 'qwen', model: 'qwen-max' },
  'qwen-plus': { provider: 'qwen', model: 'qwen-plus' },
  'qwen-turbo': { provider: 'qwen', model: 'qwen-turbo' },
  'qwen-long': { provider: 'qwen', model: 'qwen-long' },

  // Replicate
  replicate: { provider: 'replicate', model: 'meta/llama-3.1-405b-instruct' },

  // GitHub Models
  'gh-models': { provider: 'github-models', model: 'gpt-4o' },
  'gh-phi': { provider: 'github-models', model: 'Phi-4' },

  // Volcengine (Bytedance Doubao)
  doubao: { provider: 'volcengine', model: 'volcengine/doubao-pro-32k' },
  'doubao-lite': { provider: 'volcengine', model: 'volcengine/doubao-lite-32k' },

  // Qianfan (Baidu)
  ernie: { provider: 'qianfan', model: 'qianfan/ernie-bot-4.0' },
  'ernie-speed': { provider: 'qianfan', model: 'qianfan/ernie-speed-128k' },

  // Minimax
  minimax: { provider: 'minimax', model: 'minimax/abab6.5-chat' },
  'minimax-lite': { provider: 'minimax', model: 'minimax/abab5.5-chat' },

  // HuggingFace
  hf: { provider: 'huggingface', model: 'huggingface/meta-llama/Llama-3.1-70B-Instruct' },

  // NVIDIA NIM
  nim: { provider: 'nvidia-nim', model: 'nvidia-nim/meta/llama-3.1-405b-instruct' },
  'nim-mistral': { provider: 'nvidia-nim', model: 'nvidia-nim/mistralai/mixtral-8x22b-instruct' },

  // Watsonx
  watsonx: { provider: 'watsonx', model: 'watsonx/ibm/granite-13b-chat-v2' },
  granite: { provider: 'watsonx', model: 'watsonx/ibm/granite-3.0-8b-instruct' },
};

// Model Catalog

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
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'google',
    contextWindow: 1000000,
    maxOutput: 65536,
    supportsVision: true,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 1.25,
    costPer1MOutput: 10,
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'google',
    contextWindow: 1000000,
    maxOutput: 65536,
    supportsVision: true,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.15,
    costPer1MOutput: 0.6,
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'google',
    contextWindow: 1000000,
    maxOutput: 8192,
    supportsVision: true,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.1,
    costPer1MOutput: 0.4,
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

  // AWS Bedrock
  {
    id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    name: 'Claude 3.5 Sonnet v2 (Bedrock)',
    provider: 'bedrock',
    contextWindow: 200000,
    maxOutput: 8192,
    supportsVision: true,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 3.0,
    costPer1MOutput: 15.0,
  },
  {
    id: 'anthropic.claude-3-5-haiku-20241022-v1:0',
    name: 'Claude 3.5 Haiku (Bedrock)',
    provider: 'bedrock',
    contextWindow: 200000,
    maxOutput: 8192,
    supportsVision: true,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.80,
    costPer1MOutput: 4.0,
  },
  {
    id: 'meta.llama3-1-70b-instruct-v1:0',
    name: 'Llama 3.1 70B (Bedrock)',
    provider: 'bedrock',
    contextWindow: 128000,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.72,
    costPer1MOutput: 0.72,
  },

  // Zhipu AI (GLM series) - tested and validated 2026-03-12
  // Pricing: CNY to USD at ~$0.14 per 1 CNY
  {
    id: 'glm-5',
    name: 'GLM-5',
    provider: 'zhipu',
    contextWindow: 128000,
    maxOutput: 16384,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.56, // 4 CNY/M tokens
    costPer1MOutput: 2.52, // 18 CNY/M tokens
  },
  {
    id: 'glm-4.7',
    name: 'GLM-4.7',
    provider: 'zhipu',
    contextWindow: 128000,
    maxOutput: 16384,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.28, // 2 CNY/M tokens
    costPer1MOutput: 1.12, // 8 CNY/M tokens
  },
  {
    id: 'glm-4.7-flash',
    name: 'GLM-4.7 Flash (Free)',
    provider: 'zhipu',
    contextWindow: 128000,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0, // FREE
    costPer1MOutput: 0, // FREE
  },
  {
    id: 'glm-4-plus',
    name: 'GLM-4 Plus',
    provider: 'zhipu',
    contextWindow: 128000,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.70, // 5 CNY/M tokens
    costPer1MOutput: 0.35, // 2.5 CNY/M tokens
  },
  {
    id: 'glm-4-air',
    name: 'GLM-4 Air',
    provider: 'zhipu',
    contextWindow: 128000,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.07, // 0.5 CNY/M tokens
    costPer1MOutput: 0.035, // 0.25 CNY/M tokens
  },
  {
    id: 'glm-4-flashx',
    name: 'GLM-4 FlashX',
    provider: 'zhipu',
    contextWindow: 128000,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.014, // 0.1 CNY/M tokens
    costPer1MOutput: 0.007, // 0.05 CNY/M tokens
  },
  {
    id: 'glm-4-long',
    name: 'GLM-4 Long',
    provider: 'zhipu',
    contextWindow: 1000000,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.14, // 1 CNY/M tokens
    costPer1MOutput: 0.07, // 0.5 CNY/M tokens
  },
  {
    id: 'glm-4v-plus',
    name: 'GLM-4V Plus (Vision)',
    provider: 'zhipu',
    contextWindow: 8192,
    maxOutput: 4096,
    supportsVision: true,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 1.00,
    costPer1MOutput: 1.00,
  },

  // Moonshot AI (Kimi) - long context specialist
  {
    id: 'moonshot-v1-8k',
    name: 'Moonshot v1 8K',
    provider: 'moonshot',
    contextWindow: 8192,
    maxOutput: 4096,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.17,
    costPer1MOutput: 0.17,
  },
  {
    id: 'moonshot-v1-32k',
    name: 'Moonshot v1 32K',
    provider: 'moonshot',
    contextWindow: 32768,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.34,
    costPer1MOutput: 0.34,
  },
  {
    id: 'moonshot-v1-128k',
    name: 'Moonshot v1 128K',
    provider: 'moonshot',
    contextWindow: 128000,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.85,
    costPer1MOutput: 0.85,
  },

  // Qwen API (Alibaba Cloud)
  {
    id: 'qwen-max',
    name: 'Qwen Max',
    provider: 'qwen',
    contextWindow: 32768,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 2.80,
    costPer1MOutput: 5.60,
  },
  {
    id: 'qwen-plus',
    name: 'Qwen Plus',
    provider: 'qwen',
    contextWindow: 131072,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.56,
    costPer1MOutput: 1.12,
  },
  {
    id: 'qwen-turbo',
    name: 'Qwen Turbo',
    provider: 'qwen',
    contextWindow: 131072,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.28,
    costPer1MOutput: 0.84,
  },
  {
    id: 'qwen-long',
    name: 'Qwen Long',
    provider: 'qwen',
    contextWindow: 10000000,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.07,
    costPer1MOutput: 0.28,
  },

  // Volcengine (Bytedance Doubao)
  {
    id: 'volcengine/doubao-pro-32k',
    name: 'Doubao Pro 32K',
    provider: 'volcengine',
    contextWindow: 32768,
    maxOutput: 4096,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.80,
    costPer1MOutput: 2.00,
  },
  {
    id: 'volcengine/doubao-lite-32k',
    name: 'Doubao Lite 32K',
    provider: 'volcengine',
    contextWindow: 32768,
    maxOutput: 4096,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: false,
    costPer1MInput: 0.10,
    costPer1MOutput: 0.10,
  },
  {
    id: 'volcengine/doubao-pro-128k',
    name: 'Doubao Pro 128K',
    provider: 'volcengine',
    contextWindow: 128000,
    maxOutput: 4096,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 1.20,
    costPer1MOutput: 3.50,
  },

  // Qianfan (Baidu ERNIE)
  {
    id: 'qianfan/ernie-bot-4.0',
    name: 'ERNIE Bot 4.0',
    provider: 'qianfan',
    contextWindow: 8192,
    maxOutput: 2048,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 8.50,
    costPer1MOutput: 25.50,
  },
  {
    id: 'qianfan/ernie-speed-128k',
    name: 'ERNIE Speed 128K',
    provider: 'qianfan',
    contextWindow: 128000,
    maxOutput: 4096,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: false,
    costPer1MInput: 0.14,
    costPer1MOutput: 0.14,
  },

  // Minimax
  {
    id: 'minimax/abab6.5-chat',
    name: 'MiniMax abab6.5',
    provider: 'minimax',
    contextWindow: 245760,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.70,
    costPer1MOutput: 0.70,
  },
  {
    id: 'minimax/abab5.5-chat',
    name: 'MiniMax abab5.5',
    provider: 'minimax',
    contextWindow: 16384,
    maxOutput: 4096,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: false,
    costPer1MInput: 0.10,
    costPer1MOutput: 0.10,
  },

  // HuggingFace Inference
  {
    id: 'huggingface/meta-llama/Llama-3.1-70B-Instruct',
    name: 'Llama 3.1 70B (HF)',
    provider: 'huggingface',
    contextWindow: 128000,
    maxOutput: 4096,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: false,
    costPer1MInput: 0.00,
    costPer1MOutput: 0.00,
  },
  {
    id: 'huggingface/mistralai/Mixtral-8x7B-Instruct-v0.1',
    name: 'Mixtral 8x7B (HF)',
    provider: 'huggingface',
    contextWindow: 32768,
    maxOutput: 4096,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: false,
    costPer1MInput: 0.00,
    costPer1MOutput: 0.00,
  },

  // NVIDIA NIM
  {
    id: 'nvidia-nim/meta/llama-3.1-405b-instruct',
    name: 'Llama 3.1 405B (NIM)',
    provider: 'nvidia-nim',
    contextWindow: 128000,
    maxOutput: 4096,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 5.00,
    costPer1MOutput: 15.00,
  },
  {
    id: 'nvidia-nim/mistralai/mixtral-8x22b-instruct',
    name: 'Mixtral 8x22B (NIM)',
    provider: 'nvidia-nim',
    contextWindow: 65536,
    maxOutput: 4096,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.40,
    costPer1MOutput: 1.20,
  },

  // Cerebras (fast inference)
  {
    id: 'llama3.1-8b',
    name: 'Llama 3.1 8B (Cerebras)',
    provider: 'cerebras',
    contextWindow: 8192,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: false,
    costPer1MInput: 0.10,
    costPer1MOutput: 0.10,
  },
  {
    id: 'llama-3.3-70b',
    name: 'Llama 3.3 70B (Cerebras)',
    provider: 'cerebras',
    contextWindow: 8192,
    maxOutput: 8192,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: true,
    costPer1MInput: 0.60,
    costPer1MOutput: 0.60,
  },

  // IBM Watsonx
  {
    id: 'watsonx/ibm/granite-13b-chat-v2',
    name: 'Granite 13B Chat v2',
    provider: 'watsonx',
    contextWindow: 8192,
    maxOutput: 4096,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: false,
    costPer1MInput: 0.20,
    costPer1MOutput: 0.80,
  },
  {
    id: 'watsonx/ibm/granite-3.0-8b-instruct',
    name: 'Granite 3.0 8B Instruct',
    provider: 'watsonx',
    contextWindow: 8192,
    maxOutput: 4096,
    supportsVision: false,
    supportsStreaming: true,
    supportsTools: false,
    costPer1MInput: 0.10,
    costPer1MOutput: 0.40,
  },
];

// Helper Functions

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
