/**
 * AI Provider Types
 *
 * Core type definitions for the multi-provider AI system.
 */

import { z } from 'zod';

// =============================================================================
// Provider Types
// =============================================================================

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
]);
export type ProviderType = z.infer<typeof ProviderType>;

// =============================================================================
// Provider Configuration
// =============================================================================

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
};

// =============================================================================
// Model Information
// =============================================================================

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

// =============================================================================
// Chat Types
// =============================================================================

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

// =============================================================================
// Tool Calling Types
// =============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
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

// =============================================================================
// Native Tool Calling Types (Vercel AI SDK)
// =============================================================================

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

// =============================================================================
// AI Message Type
// =============================================================================

export type AIMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};
