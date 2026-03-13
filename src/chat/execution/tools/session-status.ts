/**
 * Session Status Tool
 *
 * Shows current model, usage stats, and allows per-session model override.
 * Inspired by OpenClaw's session_status tool.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import { MODEL_ALIASES, MODEL_CATALOG } from '../../../providers/core/models.js';
import type { ModelInfo } from '../../../providers/core/types.js';

// Schema

const SessionStatusParamsSchema = z.object({
  action: z.enum(['status', 'set_model', 'list_models']).optional().default('status')
    .describe('Action: status (show current), set_model (change model), list_models (show available)'),
  model: z.string().optional()
    .describe('Model to switch to (alias like "opus" or full ID like "anthropic/claude-opus-4-5")'),
});

export type SessionStatusParams = z.infer<typeof SessionStatusParamsSchema>;

// Session State (in-memory per conversation)

// Store per-session model overrides
const sessionModelOverrides = new Map<string, string>();

export function getSessionModel(conversationId: string): string | undefined {
  return sessionModelOverrides.get(conversationId);
}

export function setSessionModel(conversationId: string, model: string): void {
  sessionModelOverrides.set(conversationId, model);
}

export function clearSessionModel(conversationId: string): void {
  sessionModelOverrides.delete(conversationId);
}

// Tool Definition

export interface SessionStatusResult {
  action: 'status' | 'set_model' | 'list_models';
  currentModel?: string;
  currentProvider?: string;
  sessionOverride?: string;
  defaultModel?: string;
  models?: Array<{ alias: string; provider: string; model: string }>;
  message: string;
}

type ToolRuntimeInfo = {
  runtimeInfo?: {
    model?: string;
    provider?: string;
    defaultModel?: string;
  };
};

export const sessionStatusTool: ToolDefinition<SessionStatusParams, SessionStatusResult> = {
  name: 'session_status',
  description: `Show current session status including model, usage, and configuration.
Actions:
- status: Show current model and session info
- set_model: Switch to a different model for this session (use alias like "opus" or full ID)
- list_models: List available models and aliases

Use this tool when users ask "what model is this", "which AI am I talking to", or want to change models.`,
  category: 'system',
  securityLevel: 'safe',
  allowedHosts: ['gateway', 'local'],
  parameters: SessionStatusParamsSchema,
  examples: [
    { description: 'Check current model', params: { action: 'status' } },
    { description: 'Switch to Claude Opus', params: { action: 'set_model', model: 'opus' } },
    { description: 'List available models', params: { action: 'list_models' } },
  ],

  async execute(context: ToolExecutionContext, params: SessionStatusParams): Promise<ToolResult<SessionStatusResult>> {
    const conversationId = context.conversationId;
    const currentOverride = conversationId ? sessionModelOverrides.get(conversationId) : undefined;

    switch (params.action) {
      case 'status': {
        // Get runtime info from context if available
        const runtimeInfo = (context as ToolExecutionContext & ToolRuntimeInfo).runtimeInfo;
        const runtimeModel = runtimeInfo?.model || 'unknown';
        const runtimeProvider = runtimeInfo?.provider || 'unknown';
        const defaultModel = runtimeInfo?.defaultModel || 'anthropic/claude-sonnet-4-5';

        return {
          success: true,
          data: {
            action: 'status',
            currentModel: currentOverride || runtimeModel,
            currentProvider: runtimeProvider,
            sessionOverride: currentOverride,
            defaultModel,
            message: currentOverride
              ? `📊 Session Status\n\n**Current Model**: ${currentOverride} (session override)\n**Default**: ${defaultModel}\n**Provider**: ${runtimeProvider}\n\nUse \`session_status set_model <model>\` to change.`
              : `📊 Session Status\n\n**Current Model**: ${runtimeModel}\n**Provider**: ${runtimeProvider}\n\nUse \`session_status set_model <model>\` to change, or \`session_status list_models\` to see options.`,
          },
          output: currentOverride
            ? `📊 Session using: ${currentOverride} (override)\nDefault: ${defaultModel}`
            : `📊 Session using: ${runtimeModel} (${runtimeProvider})`,
        };
      }

      case 'set_model': {
        if (!params.model) {
          return {
            success: false,
            error: {
              code: 'MISSING_MODEL',
              message: 'Please specify a model. Use `session_status list_models` to see available options.',
            },
          };
        }

        // Resolve model alias or full ID
        const modelLower = params.model.toLowerCase();
        const aliasEntry = MODEL_ALIASES[modelLower as keyof typeof MODEL_ALIASES];

        let resolvedModel: string;
        let resolvedProvider: string;

        if (aliasEntry) {
          resolvedProvider = aliasEntry.provider;
          resolvedModel = aliasEntry.model;
        } else if (params.model.includes('/')) {
          // Full provider/model format
          const [provider, model] = params.model.split('/');
          resolvedProvider = provider;
          resolvedModel = model;
        } else {
          // Try to find in catalog
          const catalogEntry = MODEL_CATALOG.find((m: ModelInfo) =>
            m.id.toLowerCase() === modelLower ||
            m.name.toLowerCase() === modelLower
          );
          if (catalogEntry) {
            resolvedProvider = catalogEntry.provider;
            resolvedModel = catalogEntry.id;
          } else {
            return {
              success: false,
              error: {
                code: 'UNKNOWN_MODEL',
                message: `Unknown model: ${params.model}. Use \`session_status list_models\` to see available options.`,
              },
            };
          }
        }

        // Store the override
        if (conversationId) {
          const fullModel = `${resolvedProvider}/${resolvedModel}`;
          sessionModelOverrides.set(conversationId, fullModel);

          return {
            success: true,
            data: {
              action: 'set_model',
              currentModel: fullModel,
              currentProvider: resolvedProvider,
              sessionOverride: fullModel,
              message: `✅ Model changed to **${resolvedModel}** (${resolvedProvider}) for this session.`,
            },
            output: `✅ Switched to ${resolvedModel} (${resolvedProvider})`,
          };
        }

        return {
          success: false,
          error: {
            code: 'NO_SESSION',
            message: 'No active session to set model override.',
          },
        };
      }

      case 'list_models': {
        // Build list of available models with aliases
        const aliases = Object.entries(MODEL_ALIASES).map(([alias, entry]) => ({
          alias,
          provider: entry.provider,
          model: entry.model,
        }));

        // Group by provider
        const byProvider = new Map<string, typeof aliases>();
        for (const entry of aliases) {
          const existing = byProvider.get(entry.provider) || [];
          existing.push(entry);
          byProvider.set(entry.provider, existing);
        }

        // Format output
        const lines: string[] = ['## Available Models\n'];
        for (const [provider, models] of byProvider) {
          lines.push(`### ${provider}`);
          for (const m of models) {
            lines.push(`- \`${m.alias}\` → ${m.model}`);
          }
          lines.push('');
        }
        lines.push('Use `session_status set_model <alias>` to switch.');

        return {
          success: true,
          data: {
            action: 'list_models',
            models: aliases,
            message: lines.join('\n'),
          },
          output: lines.join('\n'),
        };
      }

      default:
        return {
          success: false,
          error: {
            code: 'UNKNOWN_ACTION',
            message: `Unknown action: ${params.action}`,
          },
        };
    }
  },
};
