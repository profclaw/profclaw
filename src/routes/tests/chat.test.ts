/**
 * Chat Routes Tests
 *
 * Comprehensive tests for the chat API route handlers.
 * Tests validation, success paths, error handling, and edge cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks (must be declared before imports that use them) ---

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../providers/index.js', async () => {
  const { z } = await vi.importActual<typeof import('zod')>('zod');
  return {
  ProviderType: z.enum(['anthropic', 'openai', 'azure', 'google', 'ollama', 'openrouter', 'groq', 'xai', 'mistral', 'cohere', 'perplexity', 'deepseek', 'together', 'cerebras', 'fireworks', 'copilot', 'bedrock', 'zhipu', 'moonshot', 'qwen', 'replicate', 'github-models', 'volcengine', 'byteplus', 'qianfan', 'modelstudio', 'minimax', 'xiaomi', 'huggingface', 'nvidia-nim', 'venice', 'kilocode', 'vercel-ai', 'cloudflare-ai', 'watsonx']),
  aiProvider: {
    chat: vi.fn(),
    chatStream: vi.fn(),
    chatWithNativeTools: vi.fn(),
    getAllModels: vi.fn(() => []),
    getModelsForProvider: vi.fn(() => []),
    getConfiguredProviders: vi.fn(() => []),
    getDefaultProvider: vi.fn(() => 'anthropic'),
    healthCheck: vi.fn(() => Promise.resolve([])),
    configure: vi.fn(),
    setDefaultProvider: vi.fn(),
    resolveModel: vi.fn(() => ({ provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' })),
  },
  MODEL_ALIASES: {
    'fast': { provider: 'anthropic', model: 'claude-haiku-4-5' },
    'smart': { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  },
};
});

vi.mock('../../storage/index.js', () => ({
  saveProviderConfig: vi.fn(() => Promise.resolve()),
  loadAllProviderConfigs: vi.fn(() => Promise.resolve([])),
  getClient: vi.fn(() => ({
    execute: vi.fn(() => Promise.resolve({ rows: [] })),
  })),
}));

vi.mock('../../chat/index.js', () => ({
  CHAT_PRESETS: [
    {
      id: 'profclaw-assistant',
      name: 'ProfClaw Assistant',
      description: 'General assistant',
      icon: '🤖',
      examples: ['What can you do?'],
    },
  ],
  QUICK_ACTIONS: [
    { id: 'create-task', label: 'Create Task', prompt: 'Create a task for...' },
  ],
  CHAT_SKILLS: [
    {
      id: 'code',
      name: 'Code',
      description: 'Write code',
      icon: '💻',
      capabilities: ['code_generation'],
      preferredModel: 'smart',
      examples: ['Write a function'],
    },
  ],
  MODEL_TIERS: [
    { tier: 'fast', description: 'Fast tier', costMultiplier: 1 },
    { tier: 'balanced', description: 'Balanced tier', costMultiplier: 2 },
  ],
  buildSystemPrompt: vi.fn(() => Promise.resolve('You are a helpful assistant.')),
  createConversation: vi.fn(),
  getConversation: vi.fn(),
  listConversations: vi.fn(),
  deleteConversation: vi.fn(),
  addMessage: vi.fn(),
  getConversationMessages: vi.fn(() => Promise.resolve([])),
  getRecentConversationsWithPreview: vi.fn(),
  compactMessages: vi.fn(),
  getMemoryStats: vi.fn(),
  needsCompaction: vi.fn(() => false),
  detectIntent: vi.fn(() => []),
  selectModel: vi.fn(),
  buildSkillPrompt: vi.fn(),
  createChatToolHandler: vi.fn(),
  getDefaultChatTools: vi.fn(() => []),
  getAllChatTools: vi.fn(() => []),
  getChatToolsForModel: vi.fn(() => []),
  getSessionModel: vi.fn(() => null),
  deleteMessage: vi.fn(() => Promise.resolve()),
  streamAgenticChat: vi.fn(async function* () { /* yields nothing */ }),
  getGroupChatManager: vi.fn(),
}));

vi.mock('../../costs/token-tracker.js', () => ({
  trackChatUsage: vi.fn(),
}));

// --- Import after mocks ---

import { Hono } from 'hono';
import { chatRoutes } from '../chat.js';
import { aiProvider, MODEL_ALIASES } from '../../providers/index.js';
import { saveProviderConfig, getClient } from '../../storage/index.js';
import {
  createConversation,
  getConversation,
  listConversations,
  deleteConversation,
  addMessage,
  getConversationMessages,
  getRecentConversationsWithPreview,
  compactMessages,
  getMemoryStats,
  needsCompaction,
  detectIntent,
  selectModel,
  createChatToolHandler,
  getDefaultChatTools,
  getAllChatTools,
  buildSystemPrompt,
  CHAT_PRESETS,
  QUICK_ACTIONS,
  CHAT_SKILLS,
} from '../../chat/index.js';
import { logger } from '../../utils/logger.js';

// --- Test helpers ---

/** Mount chatRoutes under /api/chat and dispatch a request */
function makeApp() {
  const app = new Hono();
  app.route('/api/chat', chatRoutes);
  return app;
}

async function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const app = makeApp();
  const init: RequestInit = {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return app.fetch(new Request(`http://localhost${path}`, init));
}

const mockAiResponse = {
  id: 'resp-123',
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  content: 'Hello, I can help!',
  finishReason: 'stop',
  usage: {
    promptTokens: 10,
    completionTokens: 20,
    totalTokens: 30,
    cost: 0.0001,
  },
  duration: 500,
};

const mockConversation = {
  id: 'conv-abc',
  title: 'Test Conversation',
  presetId: 'profclaw-assistant',
  taskId: null,
  ticketId: null,
  createdAt: '2026-03-11T00:00:00Z',
  updatedAt: '2026-03-11T00:00:00Z',
};

const mockMessage = {
  id: 'msg-001',
  conversationId: 'conv-abc',
  role: 'user' as const,
  content: 'Hello',
  createdAt: '2026-03-11T00:00:00Z',
};

// =============================================================================
// POST /api/chat/completions
// =============================================================================

describe('POST /api/chat/completions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(aiProvider.chat).mockResolvedValue(mockAiResponse);
  });

  it('returns a chat completion for a valid request', async () => {
    const res = await request('POST', '/api/chat/completions', {
      messages: [{ role: 'user', content: 'Say hi' }],
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      id: 'resp-123',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      message: { role: 'assistant', content: 'Hello, I can help!' },
      finishReason: 'stop',
    });
    expect(aiProvider.chat).toHaveBeenCalledOnce();
  });

  it('passes optional model, temperature, maxTokens to aiProvider', async () => {
    await request('POST', '/api/chat/completions', {
      messages: [{ role: 'user', content: 'Test' }],
      model: 'gpt-4o',
      temperature: 0.5,
      maxTokens: 256,
    });

    const callArgs = vi.mocked(aiProvider.chat).mock.calls[0][0];
    expect(callArgs.model).toBe('gpt-4o');
    expect(callArgs.temperature).toBe(0.5);
    expect(callArgs.maxTokens).toBe(256);
  });

  it('returns 500 when aiProvider.chat throws', async () => {
    vi.mocked(aiProvider.chat).mockRejectedValue(new Error('AI unavailable'));

    const res = await request('POST', '/api/chat/completions', {
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('AI unavailable');
  });

  it('returns 400 for invalid JSON body (missing messages)', async () => {
    const res = await request('POST', '/api/chat/completions', {
      model: 'gpt-4',
      // messages is required
    });

    expect(res.status).toBe(400);
  });

  it('rejects temperature outside [0, 2]', async () => {
    const res = await request('POST', '/api/chat/completions', {
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 3,
    });

    expect(res.status).toBe(400);
  });

  it('rejects invalid role in messages', async () => {
    const res = await request('POST', '/api/chat/completions', {
      messages: [{ role: 'admin', content: 'Hack' }],
    });

    expect(res.status).toBe(400);
  });
});

// =============================================================================
// GET /api/chat/models
// =============================================================================

describe('GET /api/chat/models', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(aiProvider.getAllModels).mockReturnValue([
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic' } as never,
    ]);
    vi.mocked(aiProvider.getModelsForProvider).mockReturnValue([
      { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' } as never,
    ]);
  });

  it('returns all models when no provider filter is given', async () => {
    const res = await request('GET', '/api/chat/models');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.models).toHaveLength(1);
    expect(json.models[0].id).toBe('claude-sonnet-4-6');
    expect(Array.isArray(json.aliases)).toBe(true);
    // Aliases are derived from MODEL_ALIASES
    const aliases = json.aliases as Array<{ alias: string; provider: string; model: string }>;
    expect(aliases.some((a) => a.alias === 'fast')).toBe(true);
  });

  it('filters models by provider query param', async () => {
    const res = await request('GET', '/api/chat/models?provider=openai');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(aiProvider.getModelsForProvider).toHaveBeenCalledWith('openai');
    expect(json.models[0].id).toBe('gpt-4o');
  });
});

// =============================================================================
// GET /api/chat/providers
// =============================================================================

describe('GET /api/chat/providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(aiProvider.getConfiguredProviders).mockReturnValue(['anthropic', 'openai']);
    vi.mocked(aiProvider.healthCheck).mockResolvedValue([
      { provider: 'anthropic', healthy: true, latencyMs: 120 },
      { provider: 'openai', healthy: false, message: 'No API key' },
    ] as never);
    vi.mocked(aiProvider.getDefaultProvider).mockReturnValue('anthropic');
  });

  it('returns configured providers with health status', async () => {
    const res = await request('GET', '/api/chat/providers');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.default).toBe('anthropic');
    expect(json.providers).toHaveLength(2);
    const anthropic = json.providers.find((p: { type: string }) => p.type === 'anthropic');
    expect(anthropic.healthy).toBe(true);
    expect(anthropic.latencyMs).toBe(120);
    const openai = json.providers.find((p: { type: string }) => p.type === 'openai');
    expect(openai.healthy).toBe(false);
  });
});

// =============================================================================
// POST /api/chat/providers/:type/configure
// =============================================================================

describe('POST /api/chat/providers/:type/configure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(aiProvider.configure).mockReturnValue(undefined as never);
    vi.mocked(saveProviderConfig).mockResolvedValue(undefined as never);
  });

  it('configures a provider and persists to db when apiKey is provided', async () => {
    const res = await request('POST', '/api/chat/providers/anthropic/configure', {
      type: 'anthropic',
      apiKey: 'sk-ant-test',
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(aiProvider.configure).toHaveBeenCalledWith('anthropic', expect.objectContaining({
      type: 'anthropic',
      apiKey: 'sk-ant-test',
    }));
    expect(saveProviderConfig).toHaveBeenCalled();
  });

  it('configures a provider without persisting when no apiKey or baseUrl', async () => {
    const res = await request('POST', '/api/chat/providers/anthropic/configure', {
      type: 'anthropic',
      enabled: true,
    });

    expect(res.status).toBe(200);
    expect(aiProvider.configure).toHaveBeenCalled();
    expect(saveProviderConfig).not.toHaveBeenCalled();
  });

  it('returns 400 when aiProvider.configure throws', async () => {
    vi.mocked(aiProvider.configure).mockImplementation(() => {
      throw new Error('Invalid configuration');
    });

    const res = await request('POST', '/api/chat/providers/anthropic/configure', {
      type: 'anthropic',
      apiKey: 'bad-key',
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid configuration');
  });

  it('returns 400 for unknown provider type', async () => {
    const res = await request('POST', '/api/chat/providers/unknownprovider/configure', {
      type: 'unknownprovider',
    });

    expect(res.status).toBe(400);
  });
});

// =============================================================================
// POST /api/chat/providers/default
// =============================================================================

describe('POST /api/chat/providers/default', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(aiProvider.setDefaultProvider).mockReturnValue(undefined as never);
  });

  it('sets the default provider', async () => {
    const res = await request('POST', '/api/chat/providers/default', {
      provider: 'openai',
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.default).toBe('openai');
    expect(aiProvider.setDefaultProvider).toHaveBeenCalledWith('openai');
  });

  it('returns 400 when setDefaultProvider throws', async () => {
    vi.mocked(aiProvider.setDefaultProvider).mockImplementation(() => {
      throw new Error('Provider not configured');
    });

    const res = await request('POST', '/api/chat/providers/default', {
      provider: 'openai',
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Provider not configured');
  });
});

// =============================================================================
// POST /api/chat/quick
// =============================================================================

describe('POST /api/chat/quick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(aiProvider.chat).mockResolvedValue(mockAiResponse);
  });

  it('returns a quick chat response', async () => {
    const res = await request('POST', '/api/chat/quick', {
      prompt: 'What is 2+2?',
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.content).toBe('Hello, I can help!');
    expect(json.model).toBe('claude-sonnet-4-6');
    expect(json.provider).toBe('anthropic');
  });

  it('passes model and temperature to aiProvider', async () => {
    await request('POST', '/api/chat/quick', {
      prompt: 'Hello',
      model: 'gpt-4o',
      temperature: 0.2,
    });

    const callArgs = vi.mocked(aiProvider.chat).mock.calls[0][0];
    expect(callArgs.model).toBe('gpt-4o');
    expect(callArgs.temperature).toBe(0.2);
    expect(callArgs.messages[0].content).toBe('Hello');
  });

  it('returns 500 when aiProvider.chat throws', async () => {
    vi.mocked(aiProvider.chat).mockRejectedValue(new Error('Quota exceeded'));

    const res = await request('POST', '/api/chat/quick', { prompt: 'Hi' });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Quota exceeded');
  });

  it('requires prompt field', async () => {
    const res = await request('POST', '/api/chat/quick', { model: 'gpt-4' });
    expect(res.status).toBe(400);
  });
});

// =============================================================================
// GET /api/chat/presets
// =============================================================================

describe('GET /api/chat/presets', () => {
  it('returns available presets', async () => {
    const res = await request('GET', '/api/chat/presets');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.default).toBe('profclaw-assistant');
    expect(Array.isArray(json.presets)).toBe(true);
    expect(json.presets[0].id).toBe('profclaw-assistant');
    expect(json.presets[0]).toHaveProperty('name');
    expect(json.presets[0]).toHaveProperty('description');
  });
});

// =============================================================================
// GET /api/chat/quick-actions
// =============================================================================

describe('GET /api/chat/quick-actions', () => {
  it('returns quick actions', async () => {
    const res = await request('GET', '/api/chat/quick-actions');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.actions)).toBe(true);
    expect(json.actions[0].id).toBe('create-task');
  });
});

// =============================================================================
// GET /api/chat/skills
// =============================================================================

describe('GET /api/chat/skills', () => {
  it('returns skills and model tiers', async () => {
    const res = await request('GET', '/api/chat/skills');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.skills)).toBe(true);
    expect(json.skills[0].id).toBe('code');
    expect(Array.isArray(json.modelTiers)).toBe(true);
    expect(json.modelTiers[0].tier).toBe('fast');
  });
});

// =============================================================================
// POST /api/chat/skills/detect
// =============================================================================

describe('POST /api/chat/skills/detect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty matches when no skill detected', async () => {
    vi.mocked(detectIntent).mockReturnValue([]);

    const res = await request('POST', '/api/chat/skills/detect', {
      message: 'random message',
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.matches).toEqual([]);
    expect(json.recommendedSkill).toBeNull();
  });

  it('returns top 3 matches and recommendedSkill', async () => {
    const mockSkill = { id: 'code', name: 'Code', preferredModel: 'smart' };
    vi.mocked(detectIntent).mockReturnValue([
      { skill: mockSkill, confidence: 0.9, matchedPattern: 'write.*function', extractedVars: {} },
      { skill: mockSkill, confidence: 0.7, matchedPattern: 'code', extractedVars: {} },
      { skill: mockSkill, confidence: 0.5, matchedPattern: null, extractedVars: {} },
      { skill: mockSkill, confidence: 0.3, matchedPattern: null, extractedVars: {} }, // should be omitted
    ] as never);

    const res = await request('POST', '/api/chat/skills/detect', {
      message: 'write a function to sort arrays',
      hasCode: true,
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.matches).toHaveLength(3);
    expect(json.recommendedSkill?.id).toBe('code');
    expect(json.recommendedSkill?.confidence).toBe(0.9);
  });

  it('passes context flags to detectIntent', async () => {
    vi.mocked(detectIntent).mockReturnValue([]);

    await request('POST', '/api/chat/skills/detect', {
      message: 'fix the bug',
      hasTask: true,
      hasTicket: true,
      hasCode: false,
    });

    expect(detectIntent).toHaveBeenCalledWith('fix the bug', {
      hasTask: true,
      hasTicket: true,
      hasCode: false,
    });
  });

  it('requires message field', async () => {
    const res = await request('POST', '/api/chat/skills/detect', { hasCode: true });
    expect(res.status).toBe(400);
  });
});

// =============================================================================
// POST /api/chat/skills/route
// =============================================================================

describe('POST /api/chat/skills/route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(aiProvider.getAllModels).mockReturnValue([
      { id: 'claude-sonnet-4-6' } as never,
    ]);
  });

  it('returns error when no skill is detected', async () => {
    vi.mocked(detectIntent).mockReturnValue([]);

    const res = await request('POST', '/api/chat/skills/route', {
      message: 'unrecognized message',
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.error).toBe('Could not detect intent');
    expect(json.fallback).toHaveProperty('model');
  });

  it('returns skill and model selection', async () => {
    const mockSkill = { id: 'code', name: 'Code', preferredModel: 'smart' };
    vi.mocked(detectIntent).mockReturnValue([
      { skill: mockSkill, confidence: 0.85, matchedPattern: 'write.*code', extractedVars: {} },
    ] as never);
    vi.mocked(selectModel).mockReturnValue({
      model: 'claude-sonnet-4-6',
      tier: { tier: 'balanced', costMultiplier: 2 },
      reason: 'Code task requires balanced model',
    } as never);

    const res = await request('POST', '/api/chat/skills/route', {
      message: 'write some code',
      availableModels: ['claude-sonnet-4-6', 'gpt-4o'],
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skill.id).toBe('code');
    expect(json.skill.confidence).toBe(0.85);
    expect(json.model.selected).toBe('claude-sonnet-4-6');
    expect(json.routing.method).toBe('pattern_match');
  });
});

// =============================================================================
// GET /api/chat/conversations
// =============================================================================

describe('GET /api/chat/conversations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listConversations).mockResolvedValue({
      conversations: [mockConversation],
      total: 1,
    } as never);
  });

  it('returns a list of conversations', async () => {
    const res = await request('GET', '/api/chat/conversations');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(listConversations).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20, offset: 0 }),
    );
    expect(json.conversations).toHaveLength(1);
  });

  it('passes query params to listConversations', async () => {
    await request('GET', '/api/chat/conversations?limit=5&offset=10&taskId=task-1');

    expect(listConversations).toHaveBeenCalledWith({
      limit: 5,
      offset: 10,
      taskId: 'task-1',
      ticketId: undefined,
    });
  });

  it('returns 500 on listConversations error', async () => {
    vi.mocked(listConversations).mockRejectedValue(new Error('DB error'));

    const res = await request('GET', '/api/chat/conversations');

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to list conversations');
  });
});

// =============================================================================
// GET /api/chat/conversations/recent
// =============================================================================

describe('GET /api/chat/conversations/recent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRecentConversationsWithPreview).mockResolvedValue([
      { ...mockConversation, preview: 'Hello...' },
    ] as never);
  });

  it('returns recent conversations', async () => {
    const res = await request('GET', '/api/chat/conversations/recent');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.conversations).toHaveLength(1);
    expect(getRecentConversationsWithPreview).toHaveBeenCalledWith(10);
  });

  it('respects limit query param', async () => {
    await request('GET', '/api/chat/conversations/recent?limit=5');
    expect(getRecentConversationsWithPreview).toHaveBeenCalledWith(5);
  });

  it('returns 500 on error', async () => {
    vi.mocked(getRecentConversationsWithPreview).mockRejectedValue(new Error('fail'));

    const res = await request('GET', '/api/chat/conversations/recent');
    expect(res.status).toBe(500);
  });
});

// =============================================================================
// POST /api/chat/conversations
// =============================================================================

describe('POST /api/chat/conversations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createConversation).mockResolvedValue(mockConversation as never);
  });

  it('creates a new conversation and returns 201', async () => {
    const res = await request('POST', '/api/chat/conversations', {
      title: 'My Conversation',
      presetId: 'profclaw-assistant',
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.conversation.id).toBe('conv-abc');
    expect(createConversation).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'My Conversation', presetId: 'profclaw-assistant' }),
    );
  });

  it('creates a conversation with all optional fields', async () => {
    await request('POST', '/api/chat/conversations', {
      title: 'Task Chat',
      taskId: 'task-1',
      ticketId: 'ticket-1',
      projectId: 'proj-1',
    });

    expect(createConversation).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', ticketId: 'ticket-1', projectId: 'proj-1' }),
    );
  });

  it('returns 500 on createConversation error', async () => {
    vi.mocked(createConversation).mockRejectedValue(new Error('Insert failed'));

    const res = await request('POST', '/api/chat/conversations', {});
    expect(res.status).toBe(500);
  });
});

// =============================================================================
// GET /api/chat/conversations/:id
// =============================================================================

describe('GET /api/chat/conversations/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns conversation with messages', async () => {
    vi.mocked(getConversation).mockResolvedValue(mockConversation as never);
    vi.mocked(getConversationMessages).mockResolvedValue([mockMessage] as never);

    const res = await request('GET', '/api/chat/conversations/conv-abc');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.conversation.id).toBe('conv-abc');
    expect(json.messages).toHaveLength(1);
  });

  it('returns 404 when conversation is not found', async () => {
    vi.mocked(getConversation).mockResolvedValue(null as never);

    const res = await request('GET', '/api/chat/conversations/missing-id');

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Conversation not found');
  });

  it('returns 500 on getConversation error', async () => {
    vi.mocked(getConversation).mockRejectedValue(new Error('DB gone'));

    const res = await request('GET', '/api/chat/conversations/conv-abc');
    expect(res.status).toBe(500);
  });
});

// =============================================================================
// DELETE /api/chat/conversations/:id
// =============================================================================

describe('DELETE /api/chat/conversations/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(deleteConversation).mockResolvedValue(undefined as never);
  });

  it('deletes a conversation successfully', async () => {
    const res = await request('DELETE', '/api/chat/conversations/conv-abc');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toBe('Conversation deleted');
    expect(deleteConversation).toHaveBeenCalledWith('conv-abc');
  });

  it('returns 500 on deleteConversation error', async () => {
    vi.mocked(deleteConversation).mockRejectedValue(new Error('Cannot delete'));

    const res = await request('DELETE', '/api/chat/conversations/conv-abc');
    expect(res.status).toBe(500);
  });
});

// =============================================================================
// GET /api/chat/conversations/:id/memory
// =============================================================================

describe('GET /api/chat/conversations/:id/memory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getConversation).mockResolvedValue(mockConversation as never);
    vi.mocked(getConversationMessages).mockResolvedValue([mockMessage] as never);
    vi.mocked(getMemoryStats).mockReturnValue({
      usagePercentage: 30,
      needsCompaction: false,
      totalTokens: 300,
      maxTokens: 1000,
    } as never);
  });

  it('returns memory stats for a conversation', async () => {
    const res = await request('GET', '/api/chat/conversations/conv-abc/memory');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.conversationId).toBe('conv-abc');
    expect(json.stats).toBeDefined();
    expect(json.recommendation).toContain('Memory usage healthy');
  });

  it('returns 404 if conversation not found', async () => {
    vi.mocked(getConversation).mockResolvedValue(null as never);

    const res = await request('GET', '/api/chat/conversations/missing/memory');
    expect(res.status).toBe(404);
  });

  it('recommends compaction when usagePercentage > 50', async () => {
    vi.mocked(getMemoryStats).mockReturnValue({
      usagePercentage: 75,
      needsCompaction: false,
      totalTokens: 750,
      maxTokens: 1000,
    } as never);

    const res = await request('GET', '/api/chat/conversations/conv-abc/memory');
    const json = await res.json();
    expect(json.recommendation).toContain('Approaching context limit');
  });
});

// =============================================================================
// POST /api/chat/conversations/:id/compact
// =============================================================================

describe('POST /api/chat/conversations/:id/compact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getConversation).mockResolvedValue(mockConversation as never);
    vi.mocked(getConversationMessages).mockResolvedValue([mockMessage] as never);
    vi.mocked(getMemoryStats).mockReturnValue({
      usagePercentage: 20,
      needsCompaction: false,
    } as never);
  });

  it('returns not-compacted when compaction not needed', async () => {
    vi.mocked(compactMessages).mockResolvedValue({
      wasCompacted: false,
      messages: [mockMessage],
      originalCount: 1,
      compactedCount: 1,
      tokensReduced: 0,
      summary: '',
    } as never);

    const res = await request('POST', '/api/chat/conversations/conv-abc/compact');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.compacted).toBe(false);
  });

  it('returns compaction results when compaction was applied', async () => {
    vi.mocked(compactMessages).mockResolvedValue({
      wasCompacted: true,
      messages: [mockMessage],
      originalCount: 20,
      compactedCount: 5,
      tokensReduced: 800,
      summary: 'Discussion about coding.',
    } as never);

    const res = await request('POST', '/api/chat/conversations/conv-abc/compact');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.compacted).toBe(true);
    expect(json.originalCount).toBe(20);
    expect(json.compactedCount).toBe(5);
    expect(json.tokensReduced).toBe(800);
    expect(json.summary).toBe('Discussion about coding.');
  });

  it('returns 404 when conversation not found', async () => {
    vi.mocked(getConversation).mockResolvedValue(null as never);

    const res = await request('POST', '/api/chat/conversations/missing/compact');
    expect(res.status).toBe(404);
  });
});

// Stats row that the recentActivity query always returns
const statsRow = { completed: 5, pending: 3 };

/** Build a mock DB client that returns an empty rows array for entity lookups
 *  and a stats row for aggregate queries (contains 'completed'/'pending'). */
function buildMockClient(overrideRows?: Record<string, unknown>[]) {
  return {
    execute: vi.fn((sqlOrObj: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof sqlOrObj === 'string' ? sqlOrObj : sqlOrObj.sql;
      // The stats query is the only one that uses a plain string
      if (typeof sqlOrObj === 'string' || sql.includes('completed')) {
        return Promise.resolve({ rows: [statsRow] });
      }
      return Promise.resolve({ rows: overrideRows ?? [] });
    }),
  };
}

// =============================================================================
// POST /api/chat/conversations/:id/messages
// =============================================================================

describe('POST /api/chat/conversations/:id/messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getConversation).mockResolvedValue(mockConversation as never);
    vi.mocked(getConversationMessages).mockResolvedValue([] as never);
    vi.mocked(needsCompaction).mockReturnValue(false);
    vi.mocked(addMessage).mockResolvedValue(mockMessage as never);
    vi.mocked(aiProvider.chat).mockResolvedValue(mockAiResponse);
    vi.mocked(getClient).mockReturnValue(buildMockClient() as never);
  });

  it('sends a message and returns user + assistant messages', async () => {
    const res = await request('POST', '/api/chat/conversations/conv-abc/messages', {
      content: 'What is the status?',
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.userMessage).toBeDefined();
    expect(json.assistantMessage).toBeDefined();
    expect(json.usage).toBeDefined();
    expect(addMessage).toHaveBeenCalledTimes(2);
  });

  it('returns 404 if conversation not found', async () => {
    vi.mocked(getConversation).mockResolvedValue(null as never);

    const res = await request('POST', '/api/chat/conversations/missing/messages', {
      content: 'Hello',
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Conversation not found');
  });

  it('includes compaction info when compaction was applied', async () => {
    vi.mocked(needsCompaction).mockReturnValue(true);
    vi.mocked(compactMessages).mockResolvedValue({
      wasCompacted: true,
      messages: [mockMessage],
      originalCount: 30,
      compactedCount: 8,
      tokensReduced: 1200,
      summary: 'Previous discussion.',
    } as never);

    const res = await request('POST', '/api/chat/conversations/conv-abc/messages', {
      content: 'Continue',
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.compaction).toMatchObject({
      originalCount: 30,
      compactedCount: 8,
      tokensReduced: 1200,
    });
  });

  it('returns 500 on aiProvider.chat error', async () => {
    vi.mocked(aiProvider.chat).mockRejectedValue(new Error('Rate limited'));

    const res = await request('POST', '/api/chat/conversations/conv-abc/messages', {
      content: 'Hello',
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Rate limited');
  });

  it('validates content field is required', async () => {
    const res = await request('POST', '/api/chat/conversations/conv-abc/messages', {
      model: 'gpt-4',
    });

    expect(res.status).toBe(400);
  });
});

// =============================================================================
// POST /api/chat/conversations/:id/messages/with-tools
// =============================================================================

describe('POST /api/chat/conversations/:id/messages/with-tools', () => {
  const mockToolHandler = {
    executeTool: vi.fn(() => Promise.resolve({ success: true })),
    getPendingApprovals: vi.fn(() => []),
    handleApproval: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getConversation).mockResolvedValue(mockConversation as never);
    vi.mocked(getConversationMessages).mockResolvedValue([] as never);
    vi.mocked(needsCompaction).mockReturnValue(false);
    vi.mocked(addMessage).mockResolvedValue(mockMessage as never);
    vi.mocked(createChatToolHandler).mockResolvedValue(mockToolHandler as never);
    vi.mocked(getDefaultChatTools).mockReturnValue([]);
    vi.mocked(aiProvider.chatWithNativeTools).mockResolvedValue({
      ...mockAiResponse,
      toolCalls: [],
      toolResults: [],
      toolSupport: { supported: true },
    } as never);
    vi.mocked(getClient).mockReturnValue(buildMockClient() as never);
  });

  it('sends a message with tools enabled and returns response', async () => {
    const res = await request('POST', '/api/chat/conversations/conv-abc/messages/with-tools', {
      content: 'Read file README.md',
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.userMessage).toBeDefined();
    expect(json.assistantMessage).toBeDefined();
    expect(createChatToolHandler).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-abc', securityMode: 'ask' }),
    );
  });

  it('returns 404 if conversation not found', async () => {
    vi.mocked(getConversation).mockResolvedValue(null as never);

    const res = await request('POST', '/api/chat/conversations/missing/messages/with-tools', {
      content: 'Hello',
    });

    expect(res.status).toBe(404);
  });

  it('includes pending approvals in response when present', async () => {
    const approval = {
      id: 'approval-1',
      toolName: 'exec',
      params: { command: 'rm -rf /' },
    };
    mockToolHandler.getPendingApprovals.mockReturnValue([approval]);

    const res = await request('POST', '/api/chat/conversations/conv-abc/messages/with-tools', {
      content: 'Delete files',
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.pendingApprovals).toHaveLength(1);
    expect(json.pendingApprovals[0].toolName).toBe('exec');
  });
});

// =============================================================================
// POST /api/chat/smart
// =============================================================================

describe('POST /api/chat/smart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(aiProvider.chat).mockResolvedValue(mockAiResponse);
    vi.mocked(getClient).mockReturnValue(buildMockClient() as never);
    vi.mocked(buildSystemPrompt).mockResolvedValue('System prompt');
  });

  it('returns a smart chat response with context', async () => {
    const res = await request('POST', '/api/chat/smart', {
      messages: [{ role: 'user', content: 'Status update please' }],
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message.content).toBe('Hello, I can help!');
    expect(json.context.presetId).toBe('profclaw-assistant');
  });

  it('uses custom presetId and taskId when provided', async () => {
    await request('POST', '/api/chat/smart', {
      messages: [{ role: 'user', content: 'Help' }],
      presetId: 'code-reviewer',
      taskId: 'task-xyz',
    });

    expect(buildSystemPrompt).toHaveBeenCalledWith(
      'code-reviewer',
      expect.any(Object),
    );
  });

  it('returns 500 on aiProvider.chat error', async () => {
    vi.mocked(aiProvider.chat).mockRejectedValue(new Error('Timeout'));

    const res = await request('POST', '/api/chat/smart', {
      messages: [{ role: 'user', content: 'Help' }],
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Timeout');
  });

  it('requires messages field', async () => {
    const res = await request('POST', '/api/chat/smart', { model: 'gpt-4' });
    expect(res.status).toBe(400);
  });
});

// =============================================================================
// POST /api/chat/with-tools
// =============================================================================

describe('POST /api/chat/with-tools', () => {
  const mockToolHandler = {
    executeTool: vi.fn(() => Promise.resolve({ success: true })),
    getPendingApprovals: vi.fn(() => []),
    handleApproval: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createChatToolHandler).mockResolvedValue(mockToolHandler as never);
    vi.mocked(getDefaultChatTools).mockReturnValue([]);
    vi.mocked(getAllChatTools).mockReturnValue([]);
    vi.mocked(buildSystemPrompt).mockResolvedValue('You are an assistant with tools.');
    vi.mocked(aiProvider.chatWithNativeTools).mockResolvedValue({
      ...mockAiResponse,
      toolCalls: [],
      toolResults: [],
      steps: [],
      toolSupport: { supported: true },
    } as never);
  });

  it('returns chat response with tool results', async () => {
    const res = await request('POST', '/api/chat/with-tools', {
      messages: [{ role: 'user', content: 'List files' }],
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message.content).toBe('Hello, I can help!');
    expect(json.toolCalls).toBeDefined();
    expect(json.conversationId).toBeDefined();
  });

  it('uses enableAllTools when set to true', async () => {
    await request('POST', '/api/chat/with-tools', {
      messages: [{ role: 'user', content: 'Run tests' }],
      enableAllTools: true,
    });

    expect(getAllChatTools).toHaveBeenCalled();
    expect(getDefaultChatTools).not.toHaveBeenCalled();
  });

  it('uses getDefaultChatTools when enableAllTools is false', async () => {
    await request('POST', '/api/chat/with-tools', {
      messages: [{ role: 'user', content: 'List files' }],
      enableAllTools: false,
    });

    expect(getDefaultChatTools).toHaveBeenCalled();
  });

  it('passes securityMode to createChatToolHandler', async () => {
    await request('POST', '/api/chat/with-tools', {
      messages: [{ role: 'user', content: 'Delete build artifacts' }],
      securityMode: 'deny',
    });

    expect(createChatToolHandler).toHaveBeenCalledWith(
      expect.objectContaining({ securityMode: 'deny' }),
    );
  });

  it('returns 500 on chatWithNativeTools error', async () => {
    vi.mocked(aiProvider.chatWithNativeTools).mockRejectedValue(new Error('Tool error'));

    const res = await request('POST', '/api/chat/with-tools', {
      messages: [{ role: 'user', content: 'Run git diff' }],
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Tool error');
  });

  it('requires messages field', async () => {
    const res = await request('POST', '/api/chat/with-tools', { model: 'gpt-4' });
    expect(res.status).toBe(400);
  });
});

// =============================================================================
// GET /api/chat/tools
// =============================================================================

describe('GET /api/chat/tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDefaultChatTools).mockReturnValue([
      { name: 'read_file', description: 'Read a file', parameters: {} } as never,
    ]);
    vi.mocked(getAllChatTools).mockReturnValue([
      { name: 'read_file', description: 'Read a file', parameters: {} } as never,
      { name: 'exec', description: 'Execute command', parameters: {} } as never,
    ]);
  });

  it('returns default tools when all query param is not set', async () => {
    const res = await request('GET', '/api/chat/tools');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.mode).toBe('default');
    expect(json.total).toBe(1);
    expect(getDefaultChatTools).toHaveBeenCalled();
  });

  it('returns all tools when ?all=true', async () => {
    const res = await request('GET', '/api/chat/tools?all=true');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.mode).toBe('all');
    expect(json.total).toBe(2);
    expect(getAllChatTools).toHaveBeenCalled();
  });
});

// =============================================================================
// POST /api/chat/tools/approve
// =============================================================================

describe('POST /api/chat/tools/approve', () => {
  const mockToolHandler = {
    executeTool: vi.fn(),
    getPendingApprovals: vi.fn(() => []),
    handleApproval: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createChatToolHandler).mockResolvedValue(mockToolHandler as never);
  });

  it('approves a pending tool and returns result', async () => {
    mockToolHandler.handleApproval.mockResolvedValue({
      result: { success: true, output: 'File deleted' },
    });

    const res = await request('POST', '/api/chat/tools/approve', {
      conversationId: 'conv-abc',
      approvalId: 'approval-123',
      decision: 'allow-once',
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.decision).toBe('allow-once');
    expect(json.result).toMatchObject({ success: true });
  });

  it('returns 404 when approval is not found', async () => {
    mockToolHandler.handleApproval.mockResolvedValue(null);

    const res = await request('POST', '/api/chat/tools/approve', {
      conversationId: 'conv-abc',
      approvalId: 'nonexistent',
      decision: 'deny',
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Approval not found or expired');
  });

  it('returns 500 on unexpected error', async () => {
    mockToolHandler.handleApproval.mockRejectedValue(new Error('Handler crashed'));

    const res = await request('POST', '/api/chat/tools/approve', {
      conversationId: 'conv-abc',
      approvalId: 'approval-123',
      decision: 'allow-always',
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Handler crashed');
  });

  it('validates decision enum', async () => {
    const res = await request('POST', '/api/chat/tools/approve', {
      conversationId: 'conv-abc',
      approvalId: 'approval-123',
      decision: 'maybe', // invalid
    });

    expect(res.status).toBe(400);
  });

  it('requires all three fields', async () => {
    const res = await request('POST', '/api/chat/tools/approve', {
      approvalId: 'approval-123',
      decision: 'deny',
      // missing conversationId
    });

    expect(res.status).toBe(400);
  });
});
