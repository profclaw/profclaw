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
  AIToolSchema,
} from './types.js';
import { logger } from '../../utils/logger.js';

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
   * Get tools in AI function calling format
   */
  getForAI(): AIToolSchema[] {
    return Array.from(this.tools.values()).map((tool) => this.toAISchema(tool));
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

  private toAISchema(tool: ToolDefinition): AIToolSchema {
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
        description: this.buildDescription(tool),
        parameters: {
          type: 'object',
          properties: schemaObj.properties ?? {},
          required: schemaObj.required,
        },
      },
    };
  }

  private buildDescription(tool: ToolDefinition): string {
    let desc = tool.description;

    // Add security note for non-safe tools
    if (tool.securityLevel === 'dangerous') {
      desc += '\n\n⚠️ This tool requires approval before execution.';
    } else if (tool.securityLevel === 'moderate') {
      desc += '\n\nNote: This tool may require approval depending on the command.';
    }

    // Add examples if available
    if (tool.examples?.length) {
      desc += '\n\nExamples:';
      for (const example of tool.examples.slice(0, 2)) {
        desc += `\n- ${example.description}`;
      }
    }

    return desc;
  }

  private formatCategory(category: ToolCategory): string {
    const names: Record<ToolCategory, string> = {
      execution: 'Command Execution',
      filesystem: 'File System',
      web: 'Web & Search',
      data: 'Data & APIs',
      system: 'System Information',
      glinr: 'GLINR Operations',
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
