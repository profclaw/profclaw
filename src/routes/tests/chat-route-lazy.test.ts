import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  providerImports: 0,
  chatImports: 0,
  storageImports: 0,
  costsImports: 0,
}));

vi.mock('../../providers/index.js', async () => {
  state.providerImports += 1;
  const { z } = await vi.importActual<typeof import('zod')>('zod');
  return {
    ProviderType: z.enum(['anthropic', 'openai', 'azure', 'google', 'ollama', 'openrouter', 'groq', 'xai', 'mistral', 'cohere', 'perplexity', 'deepseek', 'together', 'cerebras', 'fireworks', 'copilot', 'bedrock', 'zhipu', 'moonshot', 'qwen', 'replicate', 'github-models', 'volcengine', 'byteplus', 'qianfan', 'modelstudio', 'minimax', 'xiaomi', 'huggingface', 'nvidia-nim', 'venice', 'kilocode', 'vercel-ai', 'cloudflare-ai', 'watsonx']),
    aiProvider: {
      getAllModels: vi.fn(() => []),
      getModelsForProvider: vi.fn(() => []),
      getConfiguredProviders: vi.fn(() => []),
      healthCheck: vi.fn(() => Promise.resolve([])),
      getDefaultProvider: vi.fn(() => 'ollama'),
      configure: vi.fn(),
      setDefaultProvider: vi.fn(),
      chat: vi.fn(),
      chatStream: vi.fn(),
      resolveModel: vi.fn(() => ({ provider: 'ollama', model: 'llama3.2' })),
      chatWithNativeTools: vi.fn(),
    },
    MODEL_ALIASES: {},
  };
});

vi.mock('../../chat/index.js', () => {
  state.chatImports += 1;
  return {
    CHAT_PRESETS: [],
    QUICK_ACTIONS: [],
    buildSystemPrompt: vi.fn(() => Promise.resolve('system')),
    createConversation: vi.fn(),
    getConversation: vi.fn(),
    listConversations: vi.fn(),
    deleteConversation: vi.fn(),
    addMessage: vi.fn(),
    getConversationMessages: vi.fn(() => Promise.resolve([])),
    getRecentConversationsWithPreview: vi.fn(),
    compactMessages: vi.fn(),
    getMemoryStats: vi.fn(() => ({ needsCompaction: false, usagePercentage: 0 })),
    needsCompaction: vi.fn(() => false),
    CHAT_SKILLS: [],
    MODEL_TIERS: [],
    detectIntent: vi.fn(() => []),
    selectModel: vi.fn(),
    buildSkillPrompt: vi.fn(() => ''),
    createChatToolHandler: vi.fn(),
    getDefaultChatTools: vi.fn(() => []),
    getAllChatTools: vi.fn(() => []),
    getChatToolsForModel: vi.fn(() => []),
    getSessionModel: vi.fn(),
    deleteMessage: vi.fn(() => Promise.resolve()),
    streamAgenticChat: vi.fn(),
    getGroupChatManager: vi.fn(),
  };
});

vi.mock('../../storage/index.js', () => {
  state.storageImports += 1;
  return {
    saveProviderConfig: vi.fn(),
    getClient: vi.fn(),
  };
});

vi.mock('../../costs/token-tracker.js', () => {
  state.costsImports += 1;
  return {
    trackChatUsage: vi.fn(),
  };
});

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { Hono } from 'hono';
import { chatRoutes } from '../chat.js';

function makeApp() {
  const app = new Hono();
  app.route('/api/chat', chatRoutes);
  return app;
}

describe('chat route lazy runtime loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.providerImports = 0;
    state.chatImports = 0;
    state.storageImports = 0;
    state.costsImports = 0;
  });

  it('does not load runtime modules on import', () => {
    expect(state.providerImports).toBe(0);
    expect(state.chatImports).toBe(0);
    expect(state.storageImports).toBe(0);
    expect(state.costsImports).toBe(0);
  });

  it('loads runtime modules and serves requests correctly', async () => {
    const app = makeApp();

    const first = await app.fetch(new Request('http://localhost/api/chat/models'));
    const second = await app.fetch(new Request('http://localhost/api/chat/models'));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const json = await first.json();
    expect(json).toHaveProperty('models');
    expect(json).toHaveProperty('aliases');
  });
});
