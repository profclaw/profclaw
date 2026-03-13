/**
 * Model-Aware Tool Router
 *
 * Routes tools to AI models based on model capability:
 * - Small/local models (7B-13B): essential tier (8-10 tools)
 * - Medium models (30B-70B, GPT-3.5): standard tier (25-30 tools)
 * - Large models (GPT-4, Claude, Gemini Pro): full tier (all tools)
 *
 * Prevents tool hallucination by not overwhelming small models with 72 tool schemas.
 */

import { logger } from '../../utils/logger.js';
import type { ToolDefinition, ToolTier, ModelCapabilityLevel } from './types.js';

// =============================================================================
// Types
// =============================================================================

interface ModelProfile {
  capability: ModelCapabilityLevel;
  tier: ToolTier;
  maxTools: number;
  contextWindow: number;
  toolTokenBudget: number;
}

interface ToolRouterConfig {
  enabled: boolean;
  defaultTier: ToolTier;
  maxToolTokenPercent: number;
  dynamicPromotion: boolean;
}

interface ModelPattern {
  pattern: RegExp;
  capability: ModelCapabilityLevel;
  tier: ToolTier;
}

// =============================================================================
// Model Classification
// =============================================================================

/**
 * Known model family patterns -> capability classification.
 * Ordered from most specific to least specific.
 */
const MODEL_PATTERNS: ModelPattern[] = [
  // Large reasoning models (full tier)
  { pattern: /claude-(3\.5|4|opus|sonnet-4)/i, capability: 'reasoning', tier: 'full' },
  { pattern: /gpt-4o|gpt-4-turbo|gpt-4\.5/i, capability: 'reasoning', tier: 'full' },
  { pattern: /gemini-(pro|1\.5|2)/i, capability: 'reasoning', tier: 'full' },
  { pattern: /o[13]-/i, capability: 'reasoning', tier: 'full' },
  { pattern: /deepseek-(v3|r1|chat)/i, capability: 'reasoning', tier: 'full' },
  { pattern: /qwen-?2\.5-(72b|110b)/i, capability: 'reasoning', tier: 'full' },
  { pattern: /llama-?3\.1-405b/i, capability: 'reasoning', tier: 'full' },
  { pattern: /grok-[23]/i, capability: 'reasoning', tier: 'full' },
  { pattern: /mistral-large/i, capability: 'reasoning', tier: 'full' },
  { pattern: /glm-(4-plus|4\.7|5)/i, capability: 'reasoning', tier: 'full' },

  // Medium instruction-following models (standard tier)
  { pattern: /claude-haiku|claude-3-haiku/i, capability: 'instruction', tier: 'standard' },
  { pattern: /gpt-3\.5/i, capability: 'instruction', tier: 'standard' },
  { pattern: /gemini-flash/i, capability: 'instruction', tier: 'standard' },
  { pattern: /mistral-medium|mistral-small|codestral/i, capability: 'instruction', tier: 'standard' },
  { pattern: /llama-?3\.(1-70b|3-70b)|llama-?3\.3-70b/i, capability: 'instruction', tier: 'standard' },
  { pattern: /qwen-?2\.5-(32b|14b)/i, capability: 'instruction', tier: 'standard' },
  { pattern: /command-r/i, capability: 'instruction', tier: 'standard' },
  { pattern: /mixtral/i, capability: 'instruction', tier: 'standard' },
  { pattern: /glm-4-(air|flashx|long)/i, capability: 'instruction', tier: 'standard' },
  { pattern: /glm-4\.7-flash/i, capability: 'instruction', tier: 'standard' },
  { pattern: /moonshot|kimi/i, capability: 'instruction', tier: 'standard' },

  // Small/local basic models (essential tier)
  { pattern: /llama-?3\.(2-[13]b|1-8b)|llama3\.2/i, capability: 'basic', tier: 'essential' },
  { pattern: /qwen-?2\.5-[37]b|qwen2\.5:[37]b/i, capability: 'basic', tier: 'essential' },
  { pattern: /mistral:?[0-9]b|mistral-[0-9]x?[0-9]b/i, capability: 'basic', tier: 'essential' },
  { pattern: /phi-?[34]/i, capability: 'basic', tier: 'essential' },
  { pattern: /gemma-?2?-[0-9]b/i, capability: 'basic', tier: 'essential' },
  { pattern: /tinyllama|stablelm/i, capability: 'basic', tier: 'essential' },
  { pattern: /deepseek-r1:[0-9]b/i, capability: 'basic', tier: 'essential' },
];

/**
 * Essential tools that every model gets (core interaction tools).
 */
export const ESSENTIAL_TOOL_NAMES = new Set<string>([
  'exec',
  'read_file',
  'write_file',
  'edit_file',
  'search_files',
  'web_search',
  'web_fetch',
  'complete_task',
  'memory_search',
  'agents_list',
]);

/**
 * Tools restricted to full tier only (large capable models).
 */
export const FULL_ONLY_TOOL_NAMES = new Set<string>([
  'canvas_render',
  'image_analyze',
  'subagent_orchestrate',
  'openai_image_gen',
  'tts_speak',
  'browser_navigate',
  'browser_snapshot',
  'browser_click',
  'browser_type',
  'browser_search',
  'browser_screenshot',
  'browser_pages',
  'browser_close',
  'discord_actions',
  'slack_actions',
  'telegram_actions',
]);

// =============================================================================
// State
// =============================================================================

let config: ToolRouterConfig = {
  enabled: true,
  defaultTier: 'full',
  maxToolTokenPercent: 15,
  dynamicPromotion: true,
};

// Track promoted tools per conversation (conversationId -> set of tool names)
const promotedTools = new Map<string, Set<string>>();

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Classify a model ID into a capability profile.
 */
export function classifyModel(modelId: string): ModelProfile {
  for (const entry of MODEL_PATTERNS) {
    if (entry.pattern.test(modelId)) {
      const contextWindow = getEstimatedContextWindow(modelId);
      return {
        capability: entry.capability,
        tier: entry.tier,
        maxTools: entry.tier === 'essential' ? 10 : entry.tier === 'standard' ? 30 : 100,
        contextWindow,
        toolTokenBudget: Math.floor(contextWindow * (config.maxToolTokenPercent / 100)),
      };
    }
  }

  // Infer from parameter count in model name (e.g. "my-model-7b")
  const sizeMatch = modelId.match(/(\d+)b$/i);
  if (sizeMatch) {
    const size = parseInt(sizeMatch[1], 10);
    const contextWindow = getEstimatedContextWindow(modelId);
    if (size <= 13) {
      return {
        capability: 'basic',
        tier: 'essential',
        maxTools: 10,
        contextWindow,
        toolTokenBudget: Math.floor(contextWindow * (config.maxToolTokenPercent / 100)),
      };
    }
    if (size <= 70) {
      return {
        capability: 'instruction',
        tier: 'standard',
        maxTools: 30,
        contextWindow,
        toolTokenBudget: Math.floor(contextWindow * (config.maxToolTokenPercent / 100)),
      };
    }
  }

  // Unknown model: default to configured tier (safe, won't break)
  const contextWindow = 128000;
  return {
    capability: 'reasoning',
    tier: config.defaultTier,
    maxTools: 100,
    contextWindow,
    toolTokenBudget: Math.floor(contextWindow * (config.maxToolTokenPercent / 100)),
  };
}

function getEstimatedContextWindow(modelId: string): number {
  if (/claude|gpt-4o|gemini-(1\.5|2)|llama-?3\.[123]/i.test(modelId)) return 128000;
  if (/gpt-4-turbo/i.test(modelId)) return 128000;
  if (/gpt-3\.5/i.test(modelId)) return 16385;
  if (/qwen/i.test(modelId)) return 32768;
  if (/mistral/i.test(modelId)) return 32768;
  if (/glm/i.test(modelId)) return 128000;
  return 32768; // Conservative default
}

/**
 * Infer tool tier from tool name when no explicit tier is set.
 */
function inferToolTier(tool: ToolDefinition): ToolTier {
  if (ESSENTIAL_TOOL_NAMES.has(tool.name)) return 'essential';
  if (FULL_ONLY_TOOL_NAMES.has(tool.name)) return 'full';
  return 'standard';
}

/**
 * Filter tools based on model capability.
 * Returns tools appropriate for the given model's tier.
 */
export function filterToolsForModel(
  tools: ToolDefinition[],
  modelId: string,
  conversationId?: string,
): ToolDefinition[] {
  if (!config.enabled) return tools;

  const profile = classifyModel(modelId);
  const promoted = conversationId ? promotedTools.get(conversationId) : undefined;

  const filtered = tools.filter((tool) => {
    const toolTier = tool.tier ?? inferToolTier(tool);

    // Promoted tools always pass through
    if (promoted?.has(tool.name)) return true;

    switch (profile.tier) {
      case 'essential':
        return toolTier === 'essential';
      case 'standard':
        return toolTier === 'essential' || toolTier === 'standard';
      case 'full':
        return true;
    }
  });

  // Enforce max tools limit - prioritise essential > standard > full
  if (filtered.length > profile.maxTools) {
    const tierOrder: Record<ToolTier, number> = { essential: 0, standard: 1, full: 2 };
    const sorted = [...filtered].sort((a, b) => {
      const aTier = a.tier ?? inferToolTier(a);
      const bTier = b.tier ?? inferToolTier(b);
      return tierOrder[aTier] - tierOrder[bTier];
    });
    return sorted.slice(0, profile.maxTools);
  }

  logger.debug('[ToolRouter] Filtered tools for model', {
    model: modelId,
    tier: profile.tier,
    total: tools.length,
    filtered: filtered.length,
  });

  return filtered;
}

/**
 * Filter tools by an explicit tier ceiling (for ToolFilterOptions.tier).
 * Includes all tools at or below the given tier.
 */
export function filterToolsByTier(
  tools: ToolDefinition[],
  maxTier: ToolTier,
): ToolDefinition[] {
  const tierOrder: Record<ToolTier, number> = { essential: 0, standard: 1, full: 2 };
  const ceiling = tierOrder[maxTier];
  return tools.filter((tool) => {
    const toolTier = tool.tier ?? inferToolTier(tool);
    return tierOrder[toolTier] <= ceiling;
  });
}

// =============================================================================
// Dynamic Promotion
// =============================================================================

/**
 * Promote a tool for a specific conversation (grants access above normal tier).
 */
export function promoteToolForConversation(conversationId: string, toolName: string): void {
  if (!config.dynamicPromotion) return;

  let promoted = promotedTools.get(conversationId);
  if (!promoted) {
    promoted = new Set<string>();
    promotedTools.set(conversationId, promoted);
  }
  promoted.add(toolName);

  logger.debug('[ToolRouter] Tool promoted', { conversationId, toolName });
}

/**
 * Clear promoted tools for a conversation (call on conversation end).
 */
export function clearPromotedTools(conversationId: string): void {
  promotedTools.delete(conversationId);
}

/**
 * Cleanup stale promoted tools - keeps map bounded to 1000 entries.
 */
export function cleanupPromotedTools(): void {
  if (promotedTools.size > 1000) {
    const entries = Array.from(promotedTools.keys());
    for (let i = 0; i < 500; i++) {
      promotedTools.delete(entries[i]);
    }
  }
}

// =============================================================================
// Token Estimation
// =============================================================================

/**
 * Rough estimate: ~150 tokens per tool (name, description, params schema).
 */
export function estimateToolTokens(tools: ToolDefinition[]): number {
  return tools.length * 150;
}

// =============================================================================
// Compressed Descriptions
// =============================================================================

/**
 * Get tool descriptions optimised for the model's capability level.
 */
export function getCompressedDescriptions(
  tools: ToolDefinition[],
  capability: ModelCapabilityLevel,
): string {
  if (capability === 'reasoning') {
    return tools.map((t) => `- ${t.name}: ${t.description}`).join('\n');
  }

  if (capability === 'instruction') {
    return tools
      .map((t) => {
        const shortDesc = t.description.split('.')[0];
        return `- ${t.name}: ${shortDesc}`;
      })
      .join('\n');
  }

  // basic: ultra-short, name only
  return tools.map((t) => `- ${t.name}`).join('\n');
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Configure the tool router at runtime.
 */
export function configureToolRouter(newConfig: Partial<ToolRouterConfig>): void {
  config = { ...config, ...newConfig };
  logger.info('[ToolRouter] Configuration updated', config as unknown as Record<string, unknown>);
}

/**
 * Get a copy of the current tool router configuration.
 */
export function getToolRouterConfig(): ToolRouterConfig {
  return { ...config };
}
