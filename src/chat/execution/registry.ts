/**
 * Tool Registry
 *
 * Central registry for all available AI tools.
 * Converts tool definitions to AI-compatible schemas.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import type {
  ToolDefinition,
  ToolRegistry,
  ToolCategory,
  ToolTier,
  AIToolSchema,
  ToolFilterOptions,
} from './types.js';
import { logger } from '../../utils/logger.js';
import { filterToolsForModel } from './tool-router.js';

// =============================================================================
// Tool Registry Implementation
// =============================================================================

export class ToolRegistryImpl implements ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  /**
   * Register a tool
   */
  register<TParams, TResult>(tool: ToolDefinition<TParams, TResult>): void {
    if (this.tools.has(tool.name)) {
      logger.warn(`[ToolRegistry] Overwriting existing tool: ${tool.name}`, { component: 'ToolRegistry' });
    }

    this.tools.set(tool.name, tool as ToolDefinition);
    logger.info(`[ToolRegistry] Registered tool: ${tool.name} (${tool.category})`, { component: 'ToolRegistry' });
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): boolean {
    const existed = this.tools.has(name);
    this.tools.delete(name);
    if (existed) {
      logger.info(`[ToolRegistry] Unregistered tool: ${name}`, { component: 'ToolRegistry' });
    }
    return existed;
  }

  /**
   * Get a tool by name
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * List all tools or filter by category
   */
  list(category?: ToolCategory): ToolDefinition[] {
    const tools = Array.from(this.tools.values());
    if (category) {
      return tools.filter((t) => t.category === category);
    }
    return tools;
  }

  /**
   * Get tools in AI function calling format, optionally filtered by tier and token budget.
   */
  getForAI(options?: ToolFilterOptions): AIToolSchema[] {
    let tools = Array.from(this.tools.values());

    // Filter by availability
    tools = tools.filter((t) => {
      if (t.isAvailable) {
        return t.isAvailable().available;
      }
      return true;
    });

    // Filter by tier (essential < standard < full)
    if (options?.tier) {
      const tierOrder: Record<ToolTier, number> = { essential: 0, standard: 1, full: 2 };
      const maxTier = tierOrder[options.tier];
      const promotedSet = new Set(options?.promote ?? []);

      tools = tools.filter((t) => {
        // Promoted tools bypass tier filtering
        if (promotedSet.has(t.name)) return true;
        const toolTier = t.tier ?? 'standard';
        return tierOrder[toolTier] <= maxTier;
      });
    }

    // Convert to AI schemas
    let schemas = tools.map((tool) => this.toAISchema(tool, options?.capabilityLevel));

    // Apply token budget if specified
    if (options?.maxSchemaTokens) {
      schemas = this.applyTokenBudget(schemas, options.maxSchemaTokens);
    }

    return schemas;
  }

  /**
   * Get tools filtered for a specific model's capability tier.
   * Uses the tool router to classify the model and apply appropriate tier filters.
   * Preferred over getForAI() when the model ID is known.
   */
  getForModel(modelId: string, conversationId?: string): AIToolSchema[] {
    let tools = Array.from(this.tools.values());

    // Filter by availability first
    tools = tools.filter((t) => {
      if (t.isAvailable) {
        return t.isAvailable().available;
      }
      return true;
    });

    // Apply model-aware tier filtering via tool router
    tools = filterToolsForModel(tools, modelId, conversationId);

    return tools.map((tool) => this.toAISchema(tool));
  }

  /**
   * Get tools for specific categories
   */
  getForAIByCategory(categories: ToolCategory[]): AIToolSchema[] {
    return Array.from(this.tools.values())
      .filter((t) => categories.includes(t.category))
      .map((tool) => this.toAISchema(tool));
  }

  /**
   * Get tool descriptions for system prompt
   */
  getDescriptions(): string {
    const tools = Array.from(this.tools.values());

    const grouped = new Map<ToolCategory, ToolDefinition[]>();
    for (const tool of tools) {
      const existing = grouped.get(tool.category) ?? [];
      existing.push(tool);
      grouped.set(tool.category, existing);
    }

    const lines: string[] = ['## Available Tools\n'];

    for (const [category, categoryTools] of grouped) {
      lines.push(`### ${this.formatCategory(category)}\n`);
      for (const tool of categoryTools) {
        lines.push(`- **${tool.name}**: ${tool.description}`);
        if (tool.securityLevel !== 'safe') {
          lines.push(`  _(Security: ${tool.securityLevel})_`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private toAISchema(tool: ToolDefinition, capabilityLevel?: 'basic' | 'instruction' | 'reasoning'): AIToolSchema {
    // Convert Zod schema to JSON Schema
    const jsonSchema = zodToJsonSchema(tool.parameters, {
      $refStrategy: 'none',
      target: 'openAi',
    });

    // Extract properties and required from JSON schema
    const schemaObj = jsonSchema as {
      type?: string;
      properties?: Record<string, unknown>;
      required?: string[];
    };

    return {
      type: 'function',
      function: {
        name: tool.name,
        description: this.buildDescription(tool, capabilityLevel),
        parameters: {
          type: 'object',
          properties: schemaObj.properties ?? {},
          required: schemaObj.required,
        },
      },
    };
  }

  private buildDescription(tool: ToolDefinition, capabilityLevel?: 'basic' | 'instruction' | 'reasoning'): string {
    // For basic models, use short one-liner descriptions to save tokens
    if (capabilityLevel === 'basic') {
      // First sentence only
      const firstSentence = tool.description.split(/\.\s/)[0];
      return firstSentence.endsWith('.') ? firstSentence : `${firstSentence}.`;
    }

    let desc = tool.description;

    // Add security note for non-safe tools
    if (tool.securityLevel === 'dangerous') {
      desc += '\n\n⚠️ This tool requires approval before execution.';
    } else if (tool.securityLevel === 'moderate') {
      desc += '\n\nNote: This tool may require approval depending on the command.';
    }

    // Add examples only for reasoning models (saves tokens for instruction models)
    if (capabilityLevel !== 'instruction' && tool.examples?.length) {
      desc += '\n\nExamples:';
      for (const example of tool.examples.slice(0, 2)) {
        desc += `\n- ${example.description}`;
      }
    }

    return desc;
  }

  /**
   * Trim schemas to fit within a token budget (approximate).
   * Prioritizes essential > standard > full tier tools.
   */
  private applyTokenBudget(schemas: AIToolSchema[], maxTokens: number): AIToolSchema[] {
    let totalTokens = 0;
    const result: AIToolSchema[] = [];

    for (const schema of schemas) {
      // Rough estimate: 4 chars per token for JSON-stringified schema
      const schemaTokens = Math.ceil(JSON.stringify(schema).length / 4);
      if (totalTokens + schemaTokens > maxTokens && result.length > 0) {
        break;
      }
      totalTokens += schemaTokens;
      result.push(schema);
    }

    return result;
  }

  private formatCategory(category: ToolCategory): string {
    const names: Record<ToolCategory, string> = {
      execution: 'Command Execution',
      filesystem: 'File System',
      web: 'Web & Search',
      data: 'Data & APIs',
      system: 'System Information',
      profclaw: 'profClaw Operations',
      memory: 'Memory Management',
      browser: 'Browser Automation',
      custom: 'Custom Tools',
    };
    return names[category] ?? category;
  }
}

// =============================================================================
// Singleton
// =============================================================================

let toolRegistry: ToolRegistryImpl | null = null;

export function getToolRegistry(): ToolRegistryImpl {
  if (!toolRegistry) {
    toolRegistry = new ToolRegistryImpl();
  }
  return toolRegistry;
}
