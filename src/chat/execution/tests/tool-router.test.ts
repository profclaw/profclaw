import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  classifyModel,
  filterToolsForModel,
  filterToolsByTier,
  promoteToolForConversation,
  clearPromotedTools,
  configureToolRouter,
  ESSENTIAL_TOOL_NAMES,
  FULL_ONLY_TOOL_NAMES,
} from '../tool-router.js';
import type { ToolDefinition, ToolTier } from '../types.js';
import { z } from 'zod';

function mockTool(name: string, tier: ToolTier): ToolDefinition {
  return {
    name,
    description: `${name} tool description`,
    category: 'custom',
    parameters: z.object({}) as z.ZodType<unknown, z.ZodTypeDef, unknown>,
    tier,
    securityLevel: 'safe',
    execute: async () => ({ success: true, data: null }),
  } as unknown as ToolDefinition;
}

describe('ESSENTIAL_TOOL_NAMES and FULL_ONLY_TOOL_NAMES', () => {
  it('ESSENTIAL_TOOL_NAMES is a non-empty Set', () => {
    expect(ESSENTIAL_TOOL_NAMES).toBeInstanceOf(Set);
    expect(ESSENTIAL_TOOL_NAMES.size).toBeGreaterThan(0);
  });

  it('FULL_ONLY_TOOL_NAMES is a non-empty Set', () => {
    expect(FULL_ONLY_TOOL_NAMES).toBeInstanceOf(Set);
    expect(FULL_ONLY_TOOL_NAMES.size).toBeGreaterThan(0);
  });
});

describe('classifyModel', () => {
  it("'claude-opus-4' -> capability='reasoning', tier='full'", () => {
    const profile = classifyModel('claude-opus-4');
    expect(profile.capability).toBe('reasoning');
    expect(profile.tier).toBe('full');
  });

  it("'claude-haiku-4.5' -> capability='instruction', tier='standard'", () => {
    const profile = classifyModel('claude-haiku-4.5');
    expect(profile.capability).toBe('instruction');
    expect(profile.tier).toBe('standard');
  });

  it("'gpt-4o' -> capability='reasoning', tier='full'", () => {
    const profile = classifyModel('gpt-4o');
    expect(profile.capability).toBe('reasoning');
    expect(profile.tier).toBe('full');
  });

  it("'gpt-3.5-turbo' -> capability='instruction', tier='standard'", () => {
    const profile = classifyModel('gpt-3.5-turbo');
    expect(profile.capability).toBe('instruction');
    expect(profile.tier).toBe('standard');
  });

  it("'llama-3.2-3b' -> capability='basic', tier='essential'", () => {
    const profile = classifyModel('llama-3.2-3b');
    expect(profile.capability).toBe('basic');
    expect(profile.tier).toBe('essential');
  });

  it("'phi-4' -> capability='basic', tier='essential'", () => {
    const profile = classifyModel('phi-4');
    expect(profile.capability).toBe('basic');
    expect(profile.tier).toBe('essential');
  });

  it("'unknown-model' -> capability='reasoning' (default for unknown), tier='full'", () => {
    const profile = classifyModel('unknown-model');
    expect(profile.capability).toBe('reasoning');
    expect(profile.tier).toBe('full');
  });

  it("'custom-7b' -> capability='basic', tier='essential' (size inference)", () => {
    const profile = classifyModel('custom-7b');
    expect(profile.capability).toBe('basic');
    expect(profile.tier).toBe('essential');
  });

  it("'custom-30b' -> capability='instruction', tier='standard' (size inference)", () => {
    const profile = classifyModel('custom-30b');
    expect(profile.capability).toBe('instruction');
    expect(profile.tier).toBe('standard');
  });
});

describe('filterToolsForModel', () => {
  const tools = [
    mockTool('essential-tool', 'essential'),
    mockTool('standard-tool', 'standard'),
    mockTool('full-tool', 'full'),
  ];

  beforeEach(() => {
    configureToolRouter({ enabled: true, defaultTier: 'full', maxToolTokenPercent: 15, dynamicPromotion: true });
  });

  it("'llama-3.2-3b' (basic): only gets essential tools", () => {
    const result = filterToolsForModel(tools, 'llama-3.2-3b');
    expect(result.every((t) => t.tier === 'essential')).toBe(true);
    expect(result.map((t) => t.name)).toContain('essential-tool');
    expect(result.map((t) => t.name)).not.toContain('standard-tool');
    expect(result.map((t) => t.name)).not.toContain('full-tool');
  });

  it("'gpt-3.5-turbo' (instruction): gets essential + standard tools", () => {
    const result = filterToolsForModel(tools, 'gpt-3.5-turbo');
    const names = result.map((t) => t.name);
    expect(names).toContain('essential-tool');
    expect(names).toContain('standard-tool');
    expect(names).not.toContain('full-tool');
  });

  it("'claude-opus-4' (reasoning): gets all tools", () => {
    const result = filterToolsForModel(tools, 'claude-opus-4');
    const names = result.map((t) => t.name);
    expect(names).toContain('essential-tool');
    expect(names).toContain('standard-tool');
    expect(names).toContain('full-tool');
  });
});

describe('filterToolsByTier', () => {
  const tools = [
    mockTool('essential-tool', 'essential'),
    mockTool('standard-tool', 'standard'),
    mockTool('full-tool', 'full'),
  ];

  it("maxTier='essential': only essential tools", () => {
    const result = filterToolsByTier(tools, 'essential');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('essential-tool');
  });

  it("maxTier='standard': essential + standard", () => {
    const result = filterToolsByTier(tools, 'standard');
    expect(result).toHaveLength(2);
    const names = result.map((t) => t.name);
    expect(names).toContain('essential-tool');
    expect(names).toContain('standard-tool');
    expect(names).not.toContain('full-tool');
  });

  it("maxTier='full': all tools", () => {
    const result = filterToolsByTier(tools, 'full');
    expect(result).toHaveLength(3);
  });
});

describe('promoteToolForConversation + filterToolsForModel', () => {
  const conversationId = 'test-conv-promote-001';
  const tools = [
    mockTool('exec', 'essential'),
    mockTool('browser_navigate', 'full'),
    mockTool('standard-tool', 'standard'),
  ];

  beforeEach(() => {
    configureToolRouter({ enabled: true, defaultTier: 'full', maxToolTokenPercent: 15, dynamicPromotion: true });
    clearPromotedTools(conversationId);
  });

  afterEach(() => {
    clearPromotedTools(conversationId);
  });

  it('promoted tool appears for basic model when conversationId is provided', () => {
    // Without promotion, basic model should NOT get browser_navigate
    const beforePromotion = filterToolsForModel(tools, 'llama-3.2-3b', conversationId);
    expect(beforePromotion.map((t) => t.name)).not.toContain('browser_navigate');

    // Promote browser_navigate for this conversation
    promoteToolForConversation(conversationId, 'browser_navigate');

    const afterPromotion = filterToolsForModel(tools, 'llama-3.2-3b', conversationId);
    expect(afterPromotion.map((t) => t.name)).toContain('browser_navigate');
  });

  it('clearPromotedTools: promoted tool no longer appears after clearing', () => {
    promoteToolForConversation(conversationId, 'browser_navigate');

    // Confirm it appears
    const withPromotion = filterToolsForModel(tools, 'llama-3.2-3b', conversationId);
    expect(withPromotion.map((t) => t.name)).toContain('browser_navigate');

    clearPromotedTools(conversationId);

    const afterClear = filterToolsForModel(tools, 'llama-3.2-3b', conversationId);
    expect(afterClear.map((t) => t.name)).not.toContain('browser_navigate');
  });
});

describe('configureToolRouter', () => {
  afterEach(() => {
    // Reset to default config after each test
    configureToolRouter({ enabled: true, defaultTier: 'full', maxToolTokenPercent: 15, dynamicPromotion: true });
  });

  it('configureToolRouter({ enabled: false }): filterToolsForModel returns all tools unfiltered', () => {
    const tools = [
      mockTool('essential-tool', 'essential'),
      mockTool('standard-tool', 'standard'),
      mockTool('full-tool', 'full'),
    ];

    configureToolRouter({ enabled: false });

    // Even a basic model should get all tools when router is disabled
    const result = filterToolsForModel(tools, 'llama-3.2-3b');
    expect(result).toHaveLength(3);
    expect(result.map((t) => t.name)).toContain('essential-tool');
    expect(result.map((t) => t.name)).toContain('standard-tool');
    expect(result.map((t) => t.name)).toContain('full-tool');
  });
});
