/**
 * Chat Module
 *
 * Intelligent chat with profClaw context, conversation history,
 * memory management, and specialized presets.
 */

export * from './system-prompts.js';
export * from './conversations.js';
export * from './memory.js';

// Re-export for convenience
export {
  PROFCLAW_CONTEXT,
  CHAT_PRESETS,
  QUICK_ACTIONS,
  buildSystemPrompt,
  type ChatPreset,
  type ChatContext,
  type QuickAction,
  type RuntimeInfo,
} from './system-prompts.js';

export {
  initConversationTables,
  createConversation,
  getConversation,
  listConversations,
  updateConversationTitle,
  deleteConversation,
  addMessage,
  getConversationMessages,
  getRecentConversationsWithPreview,
  deleteMessage,
  type Conversation,
  type ConversationMessage,
} from './conversations.js';

export {
  DEFAULT_MEMORY_CONFIG,
  estimateTokens,
  estimateMessagesTokens,
  getContextWindow,
  needsCompaction,
  summarizeMessages,
  compactMessages,
  getMemoryStats,
  // Advanced context pruning
  truncateToolResult,
  processToolCallsForCompaction,
  scoreMessageImportance,
  selectMessagesForRetention,
  type MemoryConfig,
  type CompactionResult,
  type MemoryStats,
} from './memory.js';

export {
  CHAT_SKILLS,
  MODEL_TIERS,
  detectIntent,
  selectModel,
  buildSkillPrompt,
  type ChatSkill,
  type SkillCapability,
  type IntentPattern,
  type SkillMatch,
  type ModelTier,
} from './skills.js';

export {
  CHAT_TOOLS,
  executeTool,
  getToolDefinitions,
  type ToolResult,
  type CreateProjectInput,
  type CreateTicketInput,
  type CreateSprintInput,
  type ConfigureProviderInput,
} from './tools.js';

// API Key Detection (smart key extraction from chat messages)
export {
  detectApiKeys,
  mightContainApiKey,
  getApiKeyHandlingPrompt,
  createConfigureToolCall,
  logDetection,
  type DetectedApiKey,
  type ApiKeyDetectionResult,
} from './api-key-detector.js';

// Tool execution handler for chat
export {
  createChatToolHandler,
  getToolCategories,
  getChatTools,
  getDefaultChatTools,
  getAllChatTools,
  getChatToolsForModel,
  type ChatToolHandler,
  type ChatToolHandlerOptions,
} from './tool-handler.js';

// Tool result formatting for channels (WhatsApp, Telegram, Discord)
export {
  formatToolResult,
  type ChannelFormat,
  type FormattedToolResult,
} from './format/index.js';

// Session management (model overrides)
export {
  getSessionModel,
  setSessionModel,
  clearSessionModel,
} from './execution/tools/session-status.js';

// Agentic executor (multi-step autonomous execution)
export {
  executeAgenticChat,
  streamAgenticChat,
  type AgenticChatRequest,
  type AgenticChatResponse,
  type AgenticStreamEvent,
  type StreamAgenticChatRequest,
} from './agentic-executor.js';

// Group chat management (mention gating, threading, rate limiting, channel personalities)
export {
  getGroupChatManager,
  GroupChatManager,
  createDefaultGroupChatConfig,
  MentionGateConfigSchema,
  ThreadingConfigSchema,
  RateLimitConfigSchema,
  GroupChatConfigSchema,
  type MentionGateConfig,
  type ThreadingConfig,
  type RateLimitConfig,
  type GroupChatConfig,
  type UserContext,
  type ChannelPersonality,
} from './group.js';
