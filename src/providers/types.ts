/**
 * profClaw AI Provider System Types
 *
 * Multi-provider AI chat system supporting:
 * - Anthropic (Claude)
 * - OpenAI (GPT)
 * - Google (Gemini)
 * - Ollama (local models)
 * - OpenRouter (auto-routing)
 * - Custom providers
 */

import { z } from 'zod';

// === Provider Types ===

export const ProviderType = z.enum([
  'anthropic',
  'openai',
  'google',
  'ollama',
  'openrouter',
  'bedrock',
  'azure',
  'custom',
]);
export type ProviderType = z.infer<typeof ProviderType>;

export const ModelCapability = z.enum([
  'text',
  'vision',
  'code',
  'reasoning',
  'function_calling',
  'streaming',
]);
export type ModelCapability = z.infer<typeof ModelCapability>;

// === Model Definition ===

export const ModelDefinitionSchema = z.object({
  id: z.string(),                           // e.g., "claude-opus-4-5"
  name: z.string(),                         // Human-readable name
  provider: ProviderType,
  capabilities: z.array(ModelCapability).default(['text']),
  contextWindow: z.number().default(128000),
  maxOutputTokens: z.number().default(8192),
  supportsStreaming: z.boolean().default(true),
  supportsVision: z.boolean().default(false),
  cost: z.object({
    inputPerMillion: z.number(),            // Cost per 1M input tokens
    outputPerMillion: z.number(),           // Cost per 1M output tokens
    cacheReadPerMillion: z.number().optional(),
    cacheWritePerMillion: z.number().optional(),
  }).optional(),
  isDefault: z.boolean().default(false),
});

export type ModelDefinition = z.infer<typeof ModelDefinitionSchema>;

// === Provider Configuration ===

export const ProviderConfigSchema = z.object({
  id: z.string(),
  type: ProviderType,
  name: z.string(),
  enabled: z.boolean().default(true),
  baseUrl: z.string().optional(),           // Override default API URL
  apiKey: z.string().optional(),            // API key (stored encrypted)
  models: z.array(ModelDefinitionSchema).default([]),
  defaultModel: z.string().optional(),
  maxConcurrent: z.number().default(5),
  timeout: z.number().default(300000),      // 5 minutes
  headers: z.record(z.string()).optional(), // Custom headers
  organizationId: z.string().optional(),    // For OpenAI orgs
  projectId: z.string().optional(),         // For Google projects
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

// === Model Aliases ===

export const ModelAliasSchema = z.object({
  alias: z.string(),                        // e.g., "opus", "sonnet", "gpt"
  provider: ProviderType,
  model: z.string(),                        // Full model ID
});

export type ModelAlias = z.infer<typeof ModelAliasSchema>;

// Default model aliases (like OpenClaw)
export const DEFAULT_MODEL_ALIASES: ModelAlias[] = [
  // Anthropic
  { alias: 'opus', provider: 'anthropic', model: 'claude-opus-4-6' },
  { alias: 'sonnet', provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
  { alias: 'haiku', provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },

  // OpenAI
  { alias: 'gpt', provider: 'openai', model: 'gpt-4o' },
  { alias: 'gpt-mini', provider: 'openai', model: 'gpt-4o-mini' },
  { alias: 'o1', provider: 'openai', model: 'o1' },

  // Google
  { alias: 'gemini', provider: 'google', model: 'gemini-1.5-pro' },
  { alias: 'gemini-flash', provider: 'google', model: 'gemini-1.5-flash' },

  // Ollama (local)
  { alias: 'local', provider: 'ollama', model: 'llama3.2' },
  { alias: 'deepseek', provider: 'ollama', model: 'deepseek-r1:7b' },
  { alias: 'qwen', provider: 'ollama', model: 'qwen2.5:14b' },
];

// === Chat Message Types ===

export const MessageRole = z.enum(['user', 'assistant', 'system', 'tool']);
export type MessageRole = z.infer<typeof MessageRole>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: MessageRole,
  content: z.string(),
  name: z.string().optional(),              // For tool calls
  toolCallId: z.string().optional(),
  imageUrls: z.array(z.string()).optional(), // For vision
  timestamp: z.string().datetime(),
  tokensUsed: z.number().optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// === Chat Completion Request ===

export const ChatCompletionRequestSchema = z.object({
  provider: ProviderType.optional(),        // If not set, use default
  model: z.string().optional(),             // Can be alias or full ID
  messages: z.array(ChatMessageSchema),
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().optional(),
  stream: z.boolean().default(false),
  tools: z.array(z.object({
    name: z.string(),
    description: z.string(),
    parameters: z.record(z.unknown()),
  })).optional(),
  // Conversation context
  conversationId: z.string().optional(),
  ticketId: z.string().optional(),          // Link to ticket
  taskId: z.string().optional(),            // Link to task
});

export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;

// === Chat Completion Response ===

export const ChatCompletionResponseSchema = z.object({
  id: z.string(),
  provider: ProviderType,
  model: z.string(),
  message: ChatMessageSchema,
  finishReason: z.enum(['stop', 'length', 'tool_calls', 'error']),
  usage: z.object({
    promptTokens: z.number(),
    completionTokens: z.number(),
    totalTokens: z.number(),
    cost: z.number().optional(),            // USD
  }),
  toolCalls: z.array(z.object({
    id: z.string(),
    name: z.string(),
    arguments: z.record(z.unknown()),
  })).optional(),
  duration: z.number(),                     // ms
});

export type ChatCompletionResponse = z.infer<typeof ChatCompletionResponseSchema>;

// === Conversation Types ===

export const ConversationSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  provider: ProviderType,
  model: z.string(),
  messages: z.array(ChatMessageSchema),
  systemPrompt: z.string().optional(),
  // Context links
  ticketId: z.string().optional(),
  taskId: z.string().optional(),
  // Stats
  totalTokens: z.number().default(0),
  totalCost: z.number().default(0),
  messageCount: z.number().default(0),
  // Timestamps
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastMessageAt: z.string().datetime().optional(),
});

export type Conversation = z.infer<typeof ConversationSchema>;

// === Provider Health ===

export const ProviderHealthSchema = z.object({
  provider: ProviderType,
  healthy: z.boolean(),
  latencyMs: z.number().optional(),
  message: z.string().optional(),
  availableModels: z.array(z.string()).optional(),
  lastChecked: z.string().datetime(),
});

export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;

// === Provider Interface ===

export interface AIProvider {
  readonly type: ProviderType;
  readonly name: string;

  // Configuration
  configure(config: Partial<ProviderConfig>): void;
  getConfig(): ProviderConfig;

  // Health
  healthCheck(): Promise<ProviderHealth>;

  // Models
  listModels(): Promise<ModelDefinition[]>;
  getModel(modelId: string): ModelDefinition | undefined;

  // Chat completions
  complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  completeStream(
    request: ChatCompletionRequest,
    onChunk: (chunk: string) => void
  ): Promise<ChatCompletionResponse>;
}

// === Default Model Catalogs ===

export const ANTHROPIC_MODELS: ModelDefinition[] = [
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    provider: 'anthropic',
    capabilities: ['text', 'vision', 'code', 'reasoning', 'function_calling', 'streaming'],
    contextWindow: 1000000,
    maxOutputTokens: 128000,
    supportsStreaming: true,
    supportsVision: true,
    cost: { inputPerMillion: 5, outputPerMillion: 25, cacheReadPerMillion: 0.5, cacheWritePerMillion: 1.25 },
    isDefault: true,
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    name: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    capabilities: ['text', 'vision', 'code', 'reasoning', 'function_calling', 'streaming'],
    contextWindow: 200000,
    maxOutputTokens: 16000,
    supportsStreaming: true,
    supportsVision: true,
    cost: { inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheWritePerMillion: 0.75 },
    isDefault: false,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    capabilities: ['text', 'vision', 'code', 'function_calling', 'streaming'],
    contextWindow: 200000,
    maxOutputTokens: 8192,
    supportsStreaming: true,
    supportsVision: true,
    cost: { inputPerMillion: 0.25, outputPerMillion: 1.25 },
    isDefault: false,
  },
];

export const OPENAI_MODELS: ModelDefinition[] = [
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    capabilities: ['text', 'vision', 'code', 'function_calling', 'streaming'],
    contextWindow: 128000,
    maxOutputTokens: 16384,
    supportsStreaming: true,
    supportsVision: true,
    cost: { inputPerMillion: 2.5, outputPerMillion: 10 },
    isDefault: true,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    capabilities: ['text', 'vision', 'code', 'function_calling', 'streaming'],
    contextWindow: 128000,
    maxOutputTokens: 16384,
    supportsStreaming: true,
    supportsVision: true,
    cost: { inputPerMillion: 0.15, outputPerMillion: 0.60 },
    isDefault: false,
  },
  {
    id: 'o1',
    name: 'o1',
    provider: 'openai',
    capabilities: ['text', 'code', 'reasoning'],
    contextWindow: 200000,
    maxOutputTokens: 100000,
    supportsStreaming: false,
    supportsVision: false,
    cost: { inputPerMillion: 15, outputPerMillion: 60 },
    isDefault: false,
  },
];

export const GOOGLE_MODELS: ModelDefinition[] = [
  {
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    provider: 'google',
    capabilities: ['text', 'vision', 'code', 'reasoning', 'function_calling', 'streaming'],
    contextWindow: 2000000,
    maxOutputTokens: 65536,
    supportsStreaming: true,
    supportsVision: true,
    cost: { inputPerMillion: 1.25, outputPerMillion: 5 },
    isDefault: true,
  },
  {
    id: 'gemini-1.5-flash',
    name: 'Gemini 1.5 Flash',
    provider: 'google',
    capabilities: ['text', 'vision', 'code', 'function_calling', 'streaming'],
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    supportsStreaming: true,
    supportsVision: true,
    cost: { inputPerMillion: 0.075, outputPerMillion: 0.30 },
    isDefault: false,
  },
];

// Combined default catalog
export const DEFAULT_MODEL_CATALOG: ModelDefinition[] = [
  ...ANTHROPIC_MODELS,
  ...OPENAI_MODELS,
  ...GOOGLE_MODELS,
];
