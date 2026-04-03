/**
 * Hooks Module
 *
 * Zero-cost integration with Claude Code and other AI agents.
 * Uses shell command callbacks instead of AI tokens.
 */

// Schema exports
export {
  PostToolUsePayloadSchema,
  SessionEndPayloadSchema,
  UserPromptSubmitPayloadSchema,
  HookPayloadSchema,
  type PostToolUsePayload,
  type SessionEndPayload,
  type UserPromptSubmitPayload,
  type HookPayload,
  type EditToolInput,
  type WriteToolInput,
  type BashToolInput,
} from './schemas.js';

// Type exports
export type {
  HookEventType,
  HookEvent,
  HookEventData,
  HookInference,
  SessionAggregate,
  HookProcessingResult,
  HookConfig,
} from './types.js';

// Handler exports
export {
  handlePostToolUse,
  getSessionEvents,
  getEvent,
  getSessionSummary,
  clearSessionEvents,
} from './tool-use.js';

export {
  handleSessionEnd,
  getSessionAggregate,
  getAllSessionAggregates,
  getRecentSessions,
} from './session-end.js';

export {
  handlePromptSubmit,
  getSessionPrompts,
  getInitialPrompt,
  clearSessionPrompts,
} from './prompt-submit.js';

// Agent webhook exports
export {
  handleOpenClawWebhook,
  handleGenericAgentWebhook,
  getAgentReport,
  getTaskReports,
  getRecentReports,
  getReportsByAgent,
  AgentCompletionSchema,
  OpenClawCompletionSchema,
  type AgentCompletion,
  type OpenClawCompletion,
} from './agent-webhook.js';

// Hook Registry (WS-4.1)
export {
  HookRegistry,
  getHookRegistry,
  type HookPoint,
  type HookContext,
  type HookResult,
  type Hook,
} from './registry.js';

// Hook Loader (WS-4.1)
export { loadHooks } from './loader.js';

// Built-in Hooks (WS-4.2)
export {
  costWarningHook,
  dangerousToolHook,
  auditLogHook,
  registerBuiltInHooks,
  DANGEROUS_TOOLS,
} from './built-in/index.js';
