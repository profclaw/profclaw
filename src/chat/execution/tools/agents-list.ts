/**
 * Agents List Tool
 *
 * Lists available AI agents with their capabilities and status.
 * Inspired by OpenClaw's agents_list tool.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import { getAgentRegistry } from '../../../adapters/registry.js';
import type { AgentCapability, AgentHealth } from '../../../types/agent.js';

// Schema

const AgentsListParamsSchema = z.object({
  type: z.string().optional()
    .describe('Filter by agent type (e.g., "openclaw", "claude-code", "ollama")'),
  capability: z.string().optional()
    .describe('Filter by capability (e.g., "code_generation", "bug_fix", "testing")'),
  healthyOnly: z.boolean().optional().default(false)
    .describe('Only show agents that are currently healthy'),
  includeDetails: z.boolean().optional().default(true)
    .describe('Include full capability list and health details'),
});

export type AgentsListParams = z.infer<typeof AgentsListParamsSchema>;

// Types

export interface AgentInfo {
  id: string;
  type: string;
  name: string;
  description: string;
  enabled: boolean;
  priority: number;
  capabilities: AgentCapability[];
  taskTypes?: string[];
  labels?: string[];
  health?: AgentHealth;
  maxConcurrent: number;
}

export interface AgentsListResult {
  agents: AgentInfo[];
  total: number;
  activeCount: number;
  adapterTypes: string[];
  message: string;
}

// Tool Definition

export const agentsListTool: ToolDefinition<AgentsListParams, AgentsListResult> = {
  name: 'agents_list',
  description: `List available AI agents and their capabilities.

Use this tool to:
- Discover what agents are available for tasks
- Check agent health status
- Find agents with specific capabilities
- Help decide which agent to use for a task

Available agent types:
- **openclaw**: Full autonomous coding agent with context window
- **claude-code**: Claude Code CLI for terminal-based coding
- **ollama**: Local LLM inference with custom models

Available capabilities:
- code_generation, code_review, bug_fix, testing
- documentation, refactoring, research
- git_operations, file_operations, web_browsing
- api_calls, image_generation, data_analysis`,
  category: 'system',
  securityLevel: 'safe',
  allowedHosts: ['gateway', 'local'],
  parameters: AgentsListParamsSchema,
  examples: [
    { description: 'List all agents', params: {} },
    { description: 'List only healthy agents', params: { healthyOnly: true } },
    { description: 'Find agents that can fix bugs', params: { capability: 'bug_fix' } },
    { description: 'List OpenClaw agents', params: { type: 'openclaw' } },
  ],

  async execute(context: ToolExecutionContext, params: AgentsListParams): Promise<ToolResult<AgentsListResult>> {
    try {
      const registry = getAgentRegistry();
      const adapterTypes = registry.getAdapterTypes();
      const activeAdapters = registry.getActiveAdapters();

      // Collect agent info from all active adapters
      const agents: AgentInfo[] = [];

      for (const adapter of activeAdapters) {
        // Check health if requested
        let health: AgentHealth | undefined;
        if (params.includeDetails || params.healthyOnly) {
          try {
            health = await adapter.healthCheck();
          } catch {
            health = {
              healthy: false,
              message: 'Health check failed',
              lastChecked: new Date(),
            };
          }
        }

        // Skip unhealthy agents if healthyOnly
        if (params.healthyOnly && health && !health.healthy) {
          continue;
        }

        // Filter by type if specified
        if (params.type && adapter.type !== params.type) {
          continue;
        }

        // Filter by capability if specified
        if (params.capability) {
          const hasCapability = adapter.capabilities.includes(params.capability as AgentCapability);
          if (!hasCapability) {
            continue;
          }
        }

        // Find config for this adapter
        // Note: We need to iterate through configs to find matching adapter
        // This is a workaround since registry doesn't expose configs directly
        agents.push({
          id: adapter.type, // Using type as ID for now
          type: adapter.type,
          name: adapter.name,
          description: adapter.description,
          enabled: true,
          priority: 1,
          capabilities: adapter.capabilities,
          health: params.includeDetails ? health : undefined,
          maxConcurrent: 1, // Default
        });
      }

      // Build human-readable output
      const lines: string[] = ['## Available Agents\n'];

      if (agents.length === 0) {
        lines.push('No agents found matching your criteria.\n');
        lines.push('**Tip**: Check agent configuration or remove filters.');
      } else {
        for (const agent of agents) {
          const healthIcon = !agent.health
            ? '⚪'
            : agent.health.healthy
              ? '🟢'
              : '🔴';
          const statusText = !agent.health
            ? ''
            : agent.health.healthy
              ? ' (healthy)'
              : ` (unhealthy: ${agent.health.message})`;

          lines.push(`### ${healthIcon} ${agent.name}${statusText}`);
          lines.push(`- **Type**: \`${agent.type}\``);
          lines.push(`- **Description**: ${agent.description}`);

          if (params.includeDetails) {
            lines.push(`- **Capabilities**: ${agent.capabilities.join(', ')}`);
            if (agent.taskTypes && agent.taskTypes.length > 0) {
              lines.push(`- **Task Types**: ${agent.taskTypes.join(', ')}`);
            }
            if (agent.labels && agent.labels.length > 0) {
              lines.push(`- **Labels**: ${agent.labels.join(', ')}`);
            }
            if (agent.health?.latencyMs) {
              lines.push(`- **Latency**: ${agent.health.latencyMs}ms`);
            }
          }
          lines.push('');
        }

        lines.push('---');
        lines.push(`*${agents.length} agent(s) available. Adapter types: ${adapterTypes.join(', ')}*`);
      }

      return {
        success: true,
        data: {
          agents,
          total: agents.length,
          activeCount: activeAdapters.length,
          adapterTypes,
          message: lines.join('\n'),
        },
        output: lines.join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'LIST_AGENTS_ERROR',
          message: `Failed to list agents: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  },
};

export default agentsListTool;
