/**
 * Skills Registry
 *
 * Central registry for managing skills and their snapshots.
 * Supports MCP server discovery for dynamic capability extension.
 */

import type {
  SkillEntry,
  SkillSnapshot,
  SkillsSystemConfig,
  SkillSource,
} from './types.js';
import { loadAllSkills, filterSkills } from './loader.js';
import { buildSkillSnapshot, estimateSkillsTokenCost } from './prompt-builder.js';
import { logger } from '../utils/logger.js';

/**
 * MCP Server capability info
 */
export interface MCPServerInfo {
  name: string;
  connected: boolean;
  tools: Array<{
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
  }>;
  resources?: Array<{
    uri: string;
    name: string;
    description?: string;
  }>;
}

/**
 * Skills Registry - manages loaded skills and snapshots
 */
export class SkillsRegistry {
  private entries: Map<string, SkillEntry> = new Map();
  private snapshot: SkillSnapshot | null = null;
  private snapshotVersion = 0;
  private config: SkillsSystemConfig | undefined;
  private workspaceDir: string | null = null;
  private mcpServers: Map<string, MCPServerInfo> = new Map();

  /**
   * Initialize the registry with a workspace
   */
  async initialize(params: {
    workspaceDir?: string;
    config?: SkillsSystemConfig;
  }): Promise<void> {
    this.workspaceDir = params.workspaceDir || null;
    this.config = params.config;
    await this.reload();
  }

  /**
   * Reload all skills from disk
   */
  async reload(): Promise<void> {
    const allEntries = await loadAllSkills({
      workspaceDir: this.workspaceDir || undefined,
      extraDirs: this.config?.load?.extraDirs,
    });

    this.entries.clear();
    for (const entry of allEntries) {
      this.entries.set(entry.name, entry);
    }

    // Invalidate snapshot
    this.snapshotVersion++;
    this.snapshot = null;

    logger.info(`[SkillsRegistry] Loaded ${this.entries.size} skills`);
  }

  /**
   * Register an MCP server and its capabilities
   */
  registerMCPServer(info: MCPServerInfo): void {
    this.mcpServers.set(info.name, info);

    // Create a dynamic skill for this MCP server
    const mcpSkill: SkillEntry = {
      name: `mcp-${info.name}`,
      description: `MCP server: ${info.name} - ${info.tools.length} tools available`,
      source: 'plugin' as SkillSource, // MCP skills are treated as plugins
      dirPath: `mcp://${info.name}`,
      skillMdPath: `mcp://${info.name}/SKILL.md`,
      frontmatter: {
        name: `mcp-${info.name}`,
        description: `MCP server capabilities for ${info.name}`,
      },
      metadata: {
        toolCategories: info.tools.map((t) => t.name),
      },
      instructions: this.generateMCPSkillContent(info),
      invocation: {
        userInvocable: true,
        modelInvocable: true,
      },
      eligible: true,
      eligibilityErrors: [],
      enabled: true,
    };

    this.entries.set(mcpSkill.name, mcpSkill);

    // Invalidate snapshot
    this.snapshotVersion++;
    this.snapshot = null;

    logger.info(`[SkillsRegistry] Registered MCP server: ${info.name} with ${info.tools.length} tools`);
  }

  /**
   * Unregister an MCP server
   */
  unregisterMCPServer(name: string): void {
    this.mcpServers.delete(name);
    this.entries.delete(`mcp-${name}`);

    // Invalidate snapshot
    this.snapshotVersion++;
    this.snapshot = null;
  }

  /**
   * Generate skill content from MCP server info
   */
  private generateMCPSkillContent(info: MCPServerInfo): string {
    const toolDocs = info.tools.map((tool) => {
      const params = tool.inputSchema
        ? `\nParameters: ${JSON.stringify(tool.inputSchema, null, 2)}`
        : '';
      return `### ${tool.name}\n${tool.description}${params}`;
    }).join('\n\n');

    const resourceDocs = info.resources && info.resources.length > 0
      ? `\n## Resources\n\n${info.resources.map((r) => `- **${r.name}** (${r.uri}): ${r.description || 'No description'}`).join('\n')}`
      : '';

    return `# MCP Server: ${info.name}

This server provides the following capabilities via MCP (Model Context Protocol).

## Available Tools

${toolDocs}
${resourceDocs}

## Usage

Call these tools using the MCP protocol. The tools will be executed by the MCP server.
`;
  }

  /**
   * Get all entries (raw, unfiltered)
   */
  getAllEntries(): SkillEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Get eligible entries based on current context
   */
  getEligibleEntries(): SkillEntry[] {
    return filterSkills(this.getAllEntries(), this.config);
  }

  /**
   * Get a skill by name
   */
  getSkill(name: string): SkillEntry | undefined {
    return this.entries.get(name);
  }

  /**
   * Get connected MCP servers
   */
  getMCPServers(): MCPServerInfo[] {
    return Array.from(this.mcpServers.values());
  }

  /**
   * Get or build skills snapshot for the current session
   */
  async getSnapshot(): Promise<SkillSnapshot> {
    // Return cached snapshot if still valid
    if (this.snapshot && this.snapshot.version === this.snapshotVersion) {
      return this.snapshot;
    }

    // Build fresh snapshot
    this.snapshot = await buildSkillSnapshot({
      workspaceDir: this.workspaceDir || undefined,
      config: this.config,
      entries: this.getAllEntries(),
      version: this.snapshotVersion,
    });

    return this.snapshot;
  }

  /**
   * Get skills prompt for injection into system message
   */
  async getSkillsPrompt(): Promise<string> {
    const snapshot = await this.getSnapshot();
    return snapshot.prompt;
  }

  /**
   * Estimate token cost of current skills
   */
  async estimateTokenCost(): Promise<number> {
    const eligible = this.getEligibleEntries();
    const promptEntries = eligible.filter((e) => e.invocation.modelInvocable);
    return estimateSkillsTokenCost(promptEntries);
  }

  /**
   * Update configuration
   */
  setConfig(config: SkillsSystemConfig): void {
    this.config = config;
    // Invalidate snapshot on config change
    this.snapshotVersion++;
    this.snapshot = null;
  }

  /**
   * Get list of loaded skill names
   */
  getLoadedSkillNames(): string[] {
    return Array.from(this.entries.keys());
  }

  /**
   * Get registry stats
   */
  getStats(): {
    totalSkills: number;
    bySource: Record<string, number>;
    mcpServers: number;
    estimatedTokens: number;
  } {
    const bySource: Record<string, number> = {};
    for (const entry of this.entries.values()) {
      const source = entry.source;
      bySource[source] = (bySource[source] || 0) + 1;
    }

    const eligible = this.getEligibleEntries();
    const promptEntries = eligible.filter((e) => e.invocation.modelInvocable);

    return {
      totalSkills: this.entries.size,
      bySource,
      mcpServers: this.mcpServers.size,
      estimatedTokens: estimateSkillsTokenCost(promptEntries),
    };
  }
}

// Singleton instance
let registryInstance: SkillsRegistry | null = null;

/**
 * Get the global skills registry instance
 */
export function getSkillsRegistry(): SkillsRegistry {
  if (!registryInstance) {
    registryInstance = new SkillsRegistry();
  }
  return registryInstance;
}

/**
 * Initialize the global skills registry
 */
export async function initializeSkillsRegistry(params: {
  workspaceDir?: string;
  config?: SkillsSystemConfig;
}): Promise<SkillsRegistry> {
  const registry = getSkillsRegistry();
  await registry.initialize(params);
  return registry;
}
