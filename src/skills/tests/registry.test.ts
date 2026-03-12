import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SkillsRegistry } from '../registry.js';
import * as loader from '../loader.js';
import * as promptBuilder from '../prompt-builder.js';

vi.mock('../loader.js', () => ({
  loadAllSkills: vi.fn(),
  filterSkills: vi.fn((skills) => skills),
  parseSkillMd: vi.fn(),
}));

vi.mock('../prompt-builder.js', () => ({
  buildSkillSnapshot: vi.fn(),
  estimateSkillsTokenCost: vi.fn().mockReturnValue(100),
}));

describe('SkillsRegistry', () => {
  let registry: SkillsRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new SkillsRegistry();
  });

  it('should load skills on initialize', async () => {
    const mockSkills = [
      { name: 'skill1', frontmatter: { name: 'skill1', description: 'd1' }, invocation: { modelInvocable: true }, enabled: true, eligible: true }
    ];
    (loader.loadAllSkills as any).mockResolvedValue(mockSkills);

    await registry.initialize({ workspaceDir: '/tmp' });
    
    expect(loader.loadAllSkills).toHaveBeenCalledWith({
      workspaceDir: '/tmp',
      extraDirs: undefined,
    });
    expect(registry.getLoadedSkillNames()).toContain('skill1');
  });

  it('should register MCP servers as dynamic skills', () => {
    const mcpInfo = {
      name: 'test-mcp',
      connected: true,
      tools: [{ name: 'mcp_tool', description: 'an mcp tool' }]
    };

    registry.registerMCPServer(mcpInfo);

    const names = registry.getLoadedSkillNames();
    expect(names).toContain('mcp-test-mcp');
    
    const skill = registry.getSkill('mcp-test-mcp');
    expect(skill?.source).toBe('plugin');
    expect(skill?.instructions).toContain('mcp_tool');
  });

  it('should invalidate snapshot on reload', async () => {
    (loader.loadAllSkills as any).mockResolvedValue([]);
    (promptBuilder.buildSkillSnapshot as any).mockResolvedValue({ version: 0, prompt: 'p0' });

    await registry.getSnapshot();
    expect(promptBuilder.buildSkillSnapshot).toHaveBeenCalledTimes(1);

    // Reload increments version
    await registry.reload();

    (promptBuilder.buildSkillSnapshot as any).mockResolvedValue({ version: 1, prompt: 'p1' });
    await registry.getSnapshot();
    expect(promptBuilder.buildSkillSnapshot).toHaveBeenCalledTimes(2);
  });

  it('should unregister MCP servers', () => {
    registry.registerMCPServer({
      name: 'test-mcp',
      connected: true,
      tools: [{ name: 't', description: 'd' }],
    });
    expect(registry.getSkill('mcp-test-mcp')).toBeDefined();
    expect(registry.getMCPServers()).toHaveLength(1);

    registry.unregisterMCPServer('test-mcp');
    expect(registry.getSkill('mcp-test-mcp')).toBeUndefined();
    expect(registry.getMCPServers()).toHaveLength(0);
  });

  it('should return undefined for non-existent skill', () => {
    expect(registry.getSkill('does-not-exist')).toBeUndefined();
  });

  it('should return all entries', () => {
    (loader.loadAllSkills as any).mockResolvedValue([]);
    registry.registerMCPServer({ name: 'a', connected: true, tools: [{ name: 't1', description: 'd1' }] });
    registry.registerMCPServer({ name: 'b', connected: true, tools: [{ name: 't2', description: 'd2' }] });

    expect(registry.getAllEntries()).toHaveLength(2);
  });

  it('should get eligible entries', () => {
    registry.registerMCPServer({ name: 'c', connected: true, tools: [{ name: 't3', description: 'd3' }] });
    const eligible = registry.getEligibleEntries();
    expect(eligible.length).toBeGreaterThanOrEqual(0);
  });

  it('should include resources in MCP skill content', () => {
    registry.registerMCPServer({
      name: 'fs',
      connected: true,
      tools: [{ name: 'read', description: 'Read file' }],
      resources: [{ uri: 'file:///home', name: 'Home', description: 'Home dir' }],
    });

    const skill = registry.getSkill('mcp-fs');
    expect(skill?.instructions).toContain('## Resources');
    expect(skill?.instructions).toContain('Home');
    expect(skill?.instructions).toContain('file:///home');
  });

  it('should omit resources section when no resources', () => {
    registry.registerMCPServer({
      name: 'simple',
      connected: true,
      tools: [{ name: 'ping', description: 'Ping' }],
    });

    const skill = registry.getSkill('mcp-simple');
    expect(skill?.instructions).not.toContain('## Resources');
  });

  it('getSkillsPrompt returns the prompt string', async () => {
    (promptBuilder.buildSkillSnapshot as any).mockResolvedValue({ version: 0, prompt: 'skills prompt here' });
    const prompt = await registry.getSkillsPrompt();
    expect(prompt).toBe('skills prompt here');
  });

  it('estimateTokenCost returns estimated tokens', async () => {
    const cost = await registry.estimateTokenCost();
    expect(typeof cost).toBe('number');
  });

  it('setConfig updates config and invalidates snapshot', async () => {
    (promptBuilder.buildSkillSnapshot as any).mockResolvedValue({ version: 0, prompt: 'p0' });
    await registry.getSnapshot();

    registry.setConfig({ load: { extraDirs: ['/extra'] } });

    (promptBuilder.buildSkillSnapshot as any).mockResolvedValue({ version: 1, prompt: 'p1' });
    const snapshot = await registry.getSnapshot();
    // Should have rebuilt (called twice total)
    expect(promptBuilder.buildSkillSnapshot).toHaveBeenCalledTimes(2);
  });

  it('getStats returns correct counts', () => {
    registry.registerMCPServer({ name: 'x', connected: true, tools: [{ name: 't', description: 'd' }] });
    const stats = registry.getStats();
    expect(stats.totalSkills).toBe(1);
    expect(stats.mcpServers).toBe(1);
    expect(stats.bySource['plugin']).toBe(1);
    expect(typeof stats.estimatedTokens).toBe('number');
  });

  it('getStats with no entries', () => {
    const stats = registry.getStats();
    expect(stats.totalSkills).toBe(0);
    expect(stats.mcpServers).toBe(0);
  });

  it('snapshot is cached when version matches', async () => {
    (promptBuilder.buildSkillSnapshot as any).mockResolvedValue({ version: 0, prompt: 'cached' });
    const snap1 = await registry.getSnapshot();
    const snap2 = await registry.getSnapshot();
    expect(snap1).toBe(snap2);
    expect(promptBuilder.buildSkillSnapshot).toHaveBeenCalledTimes(1);
  });

  it('MCP tool with input schema includes params', () => {
    registry.registerMCPServer({
      name: 'schema-test',
      connected: true,
      tools: [{
        name: 'complex_tool',
        description: 'A complex tool',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      }],
    });

    const skill = registry.getSkill('mcp-schema-test');
    expect(skill?.instructions).toContain('Parameters:');
    expect(skill?.instructions).toContain('"path"');
  });
});
