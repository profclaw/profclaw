/**
 * profClaw AI Provider System
 *
 * Multi-provider AI chat using Vercel AI SDK.
 */

export {
  aiProvider,
  chat,
  chatStream,
  ProviderType,
  MODEL_ALIASES,
  MODEL_CATALOG,
  type ProviderConfig,
  type ModelInfo,
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  type NativeToolCall,
  type NativeToolResult,
  type NativeToolDefinition,
  type ToolExecutionResult,
} from './ai-sdk.js';

export {
  routeQuery,
  classifyComplexity,
  selectModel,
  getRoutingStats,
  recordRoutingDecision,
  configureSmartRouter,
  isSmartRouterEnabled,
  getCostComparison,
  getCostOptimizationAdvice,
  resolveDefaultModel,
  type ComplexityTier,
  type ComplexityResult,
  type RoutingDecision,
  type SmartRouterConfig,
  type ProviderRecommendation,
} from './smart-router.js';
