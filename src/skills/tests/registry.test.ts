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
});
