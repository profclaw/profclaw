/**
 * AI Provider Types
 *
 * Core type definitions for the multi-provider AI system.
 */

import { z } from 'zod';

// Provider Types

export const ProviderType = z.enum([
  'anthropic',
  'openai',
  'azure',
  'google',
  'ollama',
  'openrouter',
  'groq',
  'xai',
  'mistral',
  'cohere',
  'perplexity',
  'deepseek',
  'together',
  'cerebras',
  'fireworks',
  'copilot', // GitHub Copilot proxy (experimental)
  'bedrock', // AWS Bedrock
  'zhipu', // Zhipu AI (GLM-4 series)
  'moonshot', // Moonshot AI (Kimi)
  'qwen', // Qwen API (Alibaba Cloud)
  'replicate', // Replicate (hosted open-source models)
  'github-models', // GitHub Models (Azure-backed inference)
  'volcengine', // Bytedance Doubao
  'byteplus', // BytePlus (international Bytedance)
  'qianfan', // Baidu Qianfan
  'modelstudio', // ModelStudio (Alibaba DashScope)
  'minimax', // Minimax Portal
  'xiaomi', // Xiaomi MiLM
  'huggingface', // HuggingFace Inference
  'nvidia-nim', // NVIDIA NIM
  'venice', // Venice AI
  'kilocode', // Kilocode
  'vercel-ai', // Vercel AI Gateway
  'cloudflare-ai', // Cloudflare AI Gateway
  'watsonx', // IBM Watsonx
]);
export type ProviderType = z.infer<typeof ProviderType>;

// Provider Configuration

export interface ProviderConfig {
  type: ProviderType;
  apiKey?: string;
  baseUrl?: string;
  resourceName?: string; // Azure resource name
  deploymentName?: string; // Azure deployment name
  apiVersion?: string; // Azure API version
  defaultModel?: string; // Default model for this provider
  enabled: boolean;
}

// Provider stability status
export type ProviderStatus = 'stable' | 'beta' | 'experimental';

// Provider metadata with stability status
export const PROVIDER_STATUS: Record<ProviderType, ProviderStatus> = {
  anthropic: 'stable',
  openai: 'stable',
  azure: 'stable',
  google: 'stable',
  ollama: 'stable',
  openrouter: 'stable',
  groq: 'stable',
  xai: 'beta', // Grok is newer
  mistral: 'stable',
  cohere: 'beta',
  perplexity: 'beta', // Search-focused, unique behavior
  deepseek: 'beta', // R1 is new
  together: 'beta',
  cerebras: 'experimental', // Hardware-specific
  fireworks: 'beta',
  copilot: 'experimental', // GitHub Copilot proxy - requires local proxy server
  bedrock: 'stable', // AWS Bedrock - enterprise
  zhipu: 'beta', // Zhipu AI (GLM-4 series)
  moonshot: 'beta', // Moonshot AI (Kimi) - long context
  qwen: 'beta', // Qwen API (Alibaba Cloud)
  replicate: 'beta', // Replicate (hosted open-source models)
  'github-models': 'beta', // GitHub Models (Azure-backed inference)
  volcengine: 'beta', // Bytedance Doubao
  byteplus: 'beta', // BytePlus (international Bytedance)
  qianfan: 'beta', // Baidu Qianfan
  modelstudio: 'experimental', // ModelStudio (Alibaba DashScope)
  minimax: 'beta', // Minimax Portal
  xiaomi: 'experimental', // Xiaomi MiLM
  huggingface: 'beta', // HuggingFace Inference
  'nvidia-nim': 'beta', // NVIDIA NIM
  venice: 'experimental', // Venice AI
  kilocode: 'experimental', // Kilocode
  'vercel-ai': 'beta', // Vercel AI Gateway
  'cloudflare-ai': 'beta', // Cloudflare AI Gateway
  watsonx: 'stable', // IBM Watsonx
};

// Model Information

export interface ModelInfo {
  id: string;
  name: string;
  provider: ProviderType;
  contextWindow: number;
  maxOutput: number;
  supportsVision: boolean;
  supportsStreaming: boolean;
  supportsTools: boolean; // Whether the model supports native tool/function calling
  costPer1MInput: number;
  costPer1MOutput: number;
}

// Chat Types

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string; // Can be alias like "opus" or full like "anthropic/claude-opus-4-5"
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface ChatResponse {
  id: string;
  provider: ProviderType;
  model: string;
  content: string;
  finishReason: 'stop' | 'length' | 'tool-calls' | 'error' | 'approval-required';
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number;
  };
  duration: number;
}

// Tool Calling Types

export type ToolTier = 'essential' | 'standard' | 'full';
export type ModelCapabilityLevel = 'basic' | 'instruction' | 'reasoning';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  tier?: ToolTier;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  result: unknown;
}

export interface ChatWithToolsRequest extends ChatRequest {
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  maxToolRoundtrips?: number;
}

export interface ChatWithToolsResponse extends ChatResponse {
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

// Native Tool Calling Types (Vercel AI SDK)

export interface NativeToolCall {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface NativeToolResult {
  toolCallId: string;
  toolName: string;
  result: unknown;
  approvalRequired?: boolean;
  approvalReason?: string;
}

export interface NativeToolCallResponse extends ChatResponse {
  toolCalls?: NativeToolCall[];
  toolResults?: NativeToolResult[];
  pendingApprovals?: NativeToolResult[];
  steps?: number;
  toolSupport?: {
    requested: boolean;
    supported: boolean;
    used: boolean;
    recommendation?: string;
  };
}

// AI Message Type

export type AIMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};
