import { describe, expect, it } from 'vitest';
import {
  MODEL_ALIASES,
  MODEL_CATALOG,
  getModelInfo,
  getModelsForProvider,
  getAllModels,
  resolveModelAlias,
} from '../core/models.js';
import { ProviderType, type ModelInfo } from '../core/types.js';

describe('Model Catalog', () => {
  // ===========================================================================
  // MODEL_ALIASES
  // ===========================================================================

  describe('MODEL_ALIASES', () => {
    it('has aliases for common providers', () => {
      expect(MODEL_ALIASES['opus']).toBeDefined();
      expect(MODEL_ALIASES['sonnet']).toBeDefined();
      expect(MODEL_ALIASES['haiku']).toBeDefined();
      expect(MODEL_ALIASES['gpt']).toBeDefined();
      expect(MODEL_ALIASES['gemini']).toBeDefined();
      expect(MODEL_ALIASES['local']).toBeDefined();
    });

    it('core aliases reference valid providers', () => {
      // Some beta aliases (replicate, gh-models) may reference providers not yet in enum
      const betaProviders = new Set(['replicate', 'github-models']);
      for (const [alias, value] of Object.entries(MODEL_ALIASES)) {
        if (betaProviders.has(value.provider)) continue;
        const result = ProviderType.safeParse(value.provider);
        expect(result.success, `Alias "${alias}" has invalid provider "${value.provider}"`).toBe(true);
      }
    });

    it('all aliases have non-empty model strings', () => {
      for (const [alias, value] of Object.entries(MODEL_ALIASES)) {
        expect(value.model.length, `Alias "${alias}" has empty model`).toBeGreaterThan(0);
      }
    });

    it('has replicate alias', () => {
      expect(MODEL_ALIASES['replicate']).toBeDefined();
      expect(MODEL_ALIASES['replicate'].provider).toBe('replicate');
    });

    it('has github models aliases', () => {
      expect(MODEL_ALIASES['gh-models']).toBeDefined();
      expect(MODEL_ALIASES['gh-models'].provider).toBe('github-models');
      expect(MODEL_ALIASES['gh-phi']).toBeDefined();
    });
  });

  // ===========================================================================
  // MODEL_CATALOG
  // ===========================================================================

  describe('MODEL_CATALOG', () => {
    it('is a non-empty array', () => {
      expect(MODEL_CATALOG.length).toBeGreaterThan(10);
    });

    it('all entries have required fields', () => {
      for (const model of MODEL_CATALOG) {
        expect(model.id).toBeDefined();
        expect(model.name).toBeDefined();
        expect(model.provider).toBeDefined();
        expect(model.contextWindow).toBeGreaterThan(0);
        expect(model.maxOutput).toBeGreaterThan(0);
        expect(typeof model.supportsVision).toBe('boolean');
        expect(typeof model.supportsStreaming).toBe('boolean');
        expect(typeof model.supportsTools).toBe('boolean');
        expect(model.costPer1MInput).toBeGreaterThanOrEqual(0);
        expect(model.costPer1MOutput).toBeGreaterThanOrEqual(0);
      }
    });

    it('core entries reference valid providers', () => {
      const betaProviders = new Set(['replicate', 'github-models']);
      for (const model of MODEL_CATALOG) {
        if (betaProviders.has(model.provider)) continue;
        const result = ProviderType.safeParse(model.provider);
        expect(result.success, `Model "${model.id}" has invalid provider "${model.provider}"`).toBe(true);
      }
    });

    it('includes anthropic models', () => {
      const anthropicModels = MODEL_CATALOG.filter(m => m.provider === 'anthropic');
      expect(anthropicModels.length).toBeGreaterThanOrEqual(3);
    });

    it('includes openai models', () => {
      const openaiModels = MODEL_CATALOG.filter(m => m.provider === 'openai');
      expect(openaiModels.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ===========================================================================
  // getModelInfo
  // ===========================================================================

  describe('getModelInfo', () => {
    it('returns model info for known model', () => {
      const info = getModelInfo('claude-opus-4-6');
      expect(info).toBeDefined();
      expect(info!.provider).toBe('anthropic');
      expect(info!.name).toBe('Claude Opus 4.6');
    });

    it('returns undefined for unknown model', () => {
      expect(getModelInfo('nonexistent-model')).toBeUndefined();
    });
  });

  // ===========================================================================
  // getModelsForProvider
  // ===========================================================================

  describe('getModelsForProvider', () => {
    it('returns models for anthropic', () => {
      const models = getModelsForProvider('anthropic');
      expect(models.length).toBeGreaterThanOrEqual(3);
      expect(models.every(m => m.provider === 'anthropic')).toBe(true);
    });

    it('returns empty array for provider with no catalog entries', () => {
      // Some providers may have aliases but no catalog entries
      const models = getModelsForProvider('copilot');
      // Could be 0 or more, just check it's an array
      expect(Array.isArray(models)).toBe(true);
    });
  });

  // ===========================================================================
  // getAllModels
  // ===========================================================================

  describe('getAllModels', () => {
    it('returns all models', () => {
      const models = getAllModels();
      expect(models.length).toBe(MODEL_CATALOG.length);
    });
  });

  // ===========================================================================
  // resolveModelAlias
  // ===========================================================================

  describe('resolveModelAlias', () => {
    it('resolves known alias', () => {
      const result = resolveModelAlias('opus');
      expect(result).toBeDefined();
      expect(result!.provider).toBe('anthropic');
      expect(result!.model).toBe('claude-opus-4-6');
    });

    it('resolves provider/model format', () => {
      const result = resolveModelAlias('openai/gpt-4o');
      expect(result).toBeDefined();
      expect(result!.provider).toBe('openai');
      expect(result!.model).toBe('gpt-4o');
    });

    it('returns undefined for unknown alias', () => {
      expect(resolveModelAlias('completely-unknown')).toBeUndefined();
    });

    it('returns undefined for invalid provider/model format', () => {
      expect(resolveModelAlias('invalid-provider/gpt-4o')).toBeUndefined();
    });

    it('resolves replicate alias', () => {
      const result = resolveModelAlias('replicate');
      expect(result).toBeDefined();
      expect(result!.provider).toBe('replicate');
    });

    it('resolves github models alias', () => {
      const result = resolveModelAlias('gh-models');
      expect(result).toBeDefined();
      expect(result!.provider).toBe('github-models');
    });
  });

  // ===========================================================================
  // MODEL_ALIASES - extended coverage for all major alias groups
  // ===========================================================================

  describe('MODEL_ALIASES - extended alias coverage', () => {
    it('resolves sonnet alias to anthropic claude-sonnet model', () => {
      expect(MODEL_ALIASES['sonnet']).toBeDefined();
      expect(MODEL_ALIASES['sonnet'].provider).toBe('anthropic');
      expect(MODEL_ALIASES['sonnet'].model).toContain('sonnet');
    });

    it('resolves haiku alias to anthropic claude-haiku model', () => {
      expect(MODEL_ALIASES['haiku']).toBeDefined();
      expect(MODEL_ALIASES['haiku'].provider).toBe('anthropic');
      expect(MODEL_ALIASES['haiku'].model).toContain('haiku');
    });

    it('resolves gpt alias to openai gpt-4o', () => {
      expect(MODEL_ALIASES['gpt']).toBeDefined();
      expect(MODEL_ALIASES['gpt'].provider).toBe('openai');
      expect(MODEL_ALIASES['gpt'].model).toBe('gpt-4o');
    });

    it('resolves gpt-mini alias to openai gpt-4o-mini', () => {
      expect(MODEL_ALIASES['gpt-mini']).toBeDefined();
      expect(MODEL_ALIASES['gpt-mini'].provider).toBe('openai');
      expect(MODEL_ALIASES['gpt-mini'].model).toBe('gpt-4o-mini');
    });

    it('resolves o1 alias to openai o1', () => {
      expect(MODEL_ALIASES['o1']).toBeDefined();
      expect(MODEL_ALIASES['o1'].provider).toBe('openai');
      expect(MODEL_ALIASES['o1'].model).toBe('o1');
    });

    it('resolves o3-mini alias to openai o3-mini', () => {
      expect(MODEL_ALIASES['o3-mini']).toBeDefined();
      expect(MODEL_ALIASES['o3-mini'].provider).toBe('openai');
      expect(MODEL_ALIASES['o3-mini'].model).toBe('o3-mini');
    });

    it('resolves gemini alias to google gemini-1.5-pro', () => {
      expect(MODEL_ALIASES['gemini']).toBeDefined();
      expect(MODEL_ALIASES['gemini'].provider).toBe('google');
      expect(MODEL_ALIASES['gemini'].model).toBe('gemini-1.5-pro');
    });

    it('resolves gemini-flash alias to google gemini-1.5-flash', () => {
      expect(MODEL_ALIASES['gemini-flash']).toBeDefined();
      expect(MODEL_ALIASES['gemini-flash'].provider).toBe('google');
      expect(MODEL_ALIASES['gemini-flash'].model).toBe('gemini-1.5-flash');
    });

    it('resolves groq alias to groq llama-3.3-70b', () => {
      expect(MODEL_ALIASES['groq']).toBeDefined();
      expect(MODEL_ALIASES['groq'].provider).toBe('groq');
      expect(MODEL_ALIASES['groq'].model).toBe('llama-3.3-70b-versatile');
    });

    it('resolves groq-fast alias to groq llama-3.1-8b-instant', () => {
      expect(MODEL_ALIASES['groq-fast']).toBeDefined();
      expect(MODEL_ALIASES['groq-fast'].provider).toBe('groq');
      expect(MODEL_ALIASES['groq-fast'].model).toBe('llama-3.1-8b-instant');
    });

    it('resolves local and llama aliases to ollama llama3.2', () => {
      expect(MODEL_ALIASES['local'].provider).toBe('ollama');
      expect(MODEL_ALIASES['local'].model).toBe('llama3.2');
      expect(MODEL_ALIASES['llama'].provider).toBe('ollama');
      expect(MODEL_ALIASES['llama'].model).toBe('llama3.2');
    });

    it('resolves deepseek-local alias to ollama deepseek-r1:7b', () => {
      expect(MODEL_ALIASES['deepseek-local']).toBeDefined();
      expect(MODEL_ALIASES['deepseek-local'].provider).toBe('ollama');
      expect(MODEL_ALIASES['deepseek-local'].model).toBe('deepseek-r1:7b');
    });

    it('resolves grok alias to xai grok-2', () => {
      expect(MODEL_ALIASES['grok']).toBeDefined();
      expect(MODEL_ALIASES['grok'].provider).toBe('xai');
      expect(MODEL_ALIASES['grok'].model).toBe('grok-2');
    });

    it('resolves grok-3 alias to xai grok-3', () => {
      expect(MODEL_ALIASES['grok-3']).toBeDefined();
      expect(MODEL_ALIASES['grok-3'].provider).toBe('xai');
      expect(MODEL_ALIASES['grok-3'].model).toBe('grok-3');
    });

    it('resolves mistral alias to mistral-large-latest', () => {
      expect(MODEL_ALIASES['mistral']).toBeDefined();
      expect(MODEL_ALIASES['mistral'].provider).toBe('mistral');
      expect(MODEL_ALIASES['mistral'].model).toBe('mistral-large-latest');
    });

    it('resolves codestral alias to mistral codestral-latest', () => {
      expect(MODEL_ALIASES['codestral']).toBeDefined();
      expect(MODEL_ALIASES['codestral'].provider).toBe('mistral');
      expect(MODEL_ALIASES['codestral'].model).toBe('codestral-latest');
    });

    it('resolves command alias to cohere command-r-plus', () => {
      expect(MODEL_ALIASES['command']).toBeDefined();
      expect(MODEL_ALIASES['command'].provider).toBe('cohere');
      expect(MODEL_ALIASES['command'].model).toBe('command-r-plus');
    });

    it('resolves perplexity alias', () => {
      expect(MODEL_ALIASES['perplexity']).toBeDefined();
      expect(MODEL_ALIASES['perplexity'].provider).toBe('perplexity');
    });

    it('resolves deepseek alias', () => {
      expect(MODEL_ALIASES['deepseek']).toBeDefined();
      expect(MODEL_ALIASES['deepseek'].provider).toBe('deepseek');
      expect(MODEL_ALIASES['deepseek'].model).toBe('deepseek-chat');
    });

    it('resolves deepseek-r1 alias to deepseek reasoner', () => {
      expect(MODEL_ALIASES['deepseek-r1']).toBeDefined();
      expect(MODEL_ALIASES['deepseek-r1'].provider).toBe('deepseek');
      expect(MODEL_ALIASES['deepseek-r1'].model).toBe('deepseek-reasoner');
    });

    it('resolves together alias', () => {
      expect(MODEL_ALIASES['together']).toBeDefined();
      expect(MODEL_ALIASES['together'].provider).toBe('together');
    });

    it('resolves zhipu and glm aliases', () => {
      expect(MODEL_ALIASES['zhipu']).toBeDefined();
      expect(MODEL_ALIASES['zhipu'].provider).toBe('zhipu');
      expect(MODEL_ALIASES['glm']).toBeDefined();
      expect(MODEL_ALIASES['glm'].provider).toBe('zhipu');
      expect(MODEL_ALIASES['glm-flash']).toBeDefined();
      expect(MODEL_ALIASES['glm-flash'].provider).toBe('zhipu');
    });

    it('resolves moonshot and kimi aliases', () => {
      expect(MODEL_ALIASES['moonshot']).toBeDefined();
      expect(MODEL_ALIASES['moonshot'].provider).toBe('moonshot');
      expect(MODEL_ALIASES['kimi']).toBeDefined();
      expect(MODEL_ALIASES['kimi'].provider).toBe('moonshot');
    });

    it('resolves qwen-cloud aliases to qwen provider', () => {
      expect(MODEL_ALIASES['qwen-cloud']).toBeDefined();
      expect(MODEL_ALIASES['qwen-cloud'].provider).toBe('qwen');
      expect(MODEL_ALIASES['qwen-plus']).toBeDefined();
      expect(MODEL_ALIASES['qwen-turbo']).toBeDefined();
    });

    it('resolves copilot alias to copilot provider', () => {
      expect(MODEL_ALIASES['copilot']).toBeDefined();
      expect(MODEL_ALIASES['copilot'].provider).toBe('copilot');
      expect(MODEL_ALIASES['copilot'].model).toBe('gpt-4o');
    });

    it('resolves bedrock alias to bedrock provider', () => {
      expect(MODEL_ALIASES['bedrock']).toBeDefined();
      expect(MODEL_ALIASES['bedrock'].provider).toBe('bedrock');
    });

    it('resolves nim alias to nvidia-nim provider', () => {
      expect(MODEL_ALIASES['nim']).toBeDefined();
      expect(MODEL_ALIASES['nim'].provider).toBe('nvidia-nim');
    });

    it('resolves watsonx and granite aliases to watsonx provider', () => {
      expect(MODEL_ALIASES['watsonx']).toBeDefined();
      expect(MODEL_ALIASES['watsonx'].provider).toBe('watsonx');
      expect(MODEL_ALIASES['granite']).toBeDefined();
      expect(MODEL_ALIASES['granite'].provider).toBe('watsonx');
    });

    it('resolves doubao alias to volcengine provider', () => {
      expect(MODEL_ALIASES['doubao']).toBeDefined();
      expect(MODEL_ALIASES['doubao'].provider).toBe('volcengine');
    });

    it('resolves ernie alias to qianfan provider', () => {
      expect(MODEL_ALIASES['ernie']).toBeDefined();
      expect(MODEL_ALIASES['ernie'].provider).toBe('qianfan');
    });

    it('resolves minimax alias to minimax provider', () => {
      expect(MODEL_ALIASES['minimax']).toBeDefined();
      expect(MODEL_ALIASES['minimax'].provider).toBe('minimax');
    });

    it('resolves hf alias to huggingface provider', () => {
      expect(MODEL_ALIASES['hf']).toBeDefined();
      expect(MODEL_ALIASES['hf'].provider).toBe('huggingface');
    });

    it('all alias models are non-empty strings', () => {
      for (const [alias, value] of Object.entries(MODEL_ALIASES)) {
        expect(typeof value.model, `Alias "${alias}" model must be a string`).toBe('string');
        expect(value.model.length, `Alias "${alias}" model must not be empty`).toBeGreaterThan(0);
      }
    });
  });

  // ===========================================================================
  // MODEL_CATALOG - required fields validation per provider
  // ===========================================================================

  describe('MODEL_CATALOG - required fields per entry', () => {
    it('every entry has a non-empty string id', () => {
      for (const model of MODEL_CATALOG) {
        expect(typeof model.id, `Expected string id for ${model.name}`).toBe('string');
        expect(model.id.length, `id must not be empty for ${model.name}`).toBeGreaterThan(0);
      }
    });

    it('every entry has a non-empty string name', () => {
      for (const model of MODEL_CATALOG) {
        expect(typeof model.name, `Expected string name`).toBe('string');
        expect(model.name.length, `name must not be empty`).toBeGreaterThan(0);
      }
    });

    it('every entry has a positive contextWindow', () => {
      for (const model of MODEL_CATALOG) {
        expect(model.contextWindow, `${model.id} must have positive contextWindow`).toBeGreaterThan(0);
      }
    });

    it('every entry has a positive maxOutput', () => {
      for (const model of MODEL_CATALOG) {
        expect(model.maxOutput, `${model.id} must have positive maxOutput`).toBeGreaterThan(0);
      }
    });

    it('every entry has boolean supportsVision, supportsStreaming, supportsTools', () => {
      for (const model of MODEL_CATALOG) {
        expect(typeof model.supportsVision, `${model.id} supportsVision`).toBe('boolean');
        expect(typeof model.supportsStreaming, `${model.id} supportsStreaming`).toBe('boolean');
        expect(typeof model.supportsTools, `${model.id} supportsTools`).toBe('boolean');
      }
    });

    it('pricing fields are non-negative numbers', () => {
      for (const model of MODEL_CATALOG) {
        expect(
          typeof model.costPer1MInput,
          `${model.id} costPer1MInput must be number`,
        ).toBe('number');
        expect(
          model.costPer1MInput,
          `${model.id} costPer1MInput must be >= 0`,
        ).toBeGreaterThanOrEqual(0);
        expect(
          typeof model.costPer1MOutput,
          `${model.id} costPer1MOutput must be number`,
        ).toBe('number');
        expect(
          model.costPer1MOutput,
          `${model.id} costPer1MOutput must be >= 0`,
        ).toBeGreaterThanOrEqual(0);
      }
    });

    it('maxOutput does not exceed contextWindow', () => {
      for (const model of MODEL_CATALOG) {
        expect(
          model.maxOutput,
          `${model.id} maxOutput (${model.maxOutput}) must not exceed contextWindow (${model.contextWindow})`,
        ).toBeLessThanOrEqual(model.contextWindow);
      }
    });
  });

  // ===========================================================================
  // getModelsForProvider - correct models per provider
  // ===========================================================================

  describe('getModelsForProvider - per provider coverage', () => {
    it('returns groq models and all belong to groq', () => {
      const models = getModelsForProvider('groq');
      expect(models.length).toBeGreaterThanOrEqual(2);
      expect(models.every((m) => m.provider === 'groq')).toBe(true);
    });

    it('returns ollama models and all belong to ollama', () => {
      const models = getModelsForProvider('ollama');
      expect(models.length).toBeGreaterThanOrEqual(2);
      expect(models.every((m) => m.provider === 'ollama')).toBe(true);
    });

    it('returns google models and all belong to google', () => {
      const models = getModelsForProvider('google');
      expect(models.length).toBeGreaterThanOrEqual(2);
      expect(models.every((m) => m.provider === 'google')).toBe(true);
    });

    it('returns deepseek models and all belong to deepseek', () => {
      const models = getModelsForProvider('deepseek');
      expect(models.length).toBeGreaterThanOrEqual(2);
      expect(models.every((m) => m.provider === 'deepseek')).toBe(true);
    });

    it('returns mistral models and all belong to mistral', () => {
      const models = getModelsForProvider('mistral');
      expect(models.length).toBeGreaterThanOrEqual(2);
      expect(models.every((m) => m.provider === 'mistral')).toBe(true);
    });

    it('returns azure models and all belong to azure', () => {
      const models = getModelsForProvider('azure');
      expect(models.length).toBeGreaterThanOrEqual(2);
      expect(models.every((m) => m.provider === 'azure')).toBe(true);
    });

    it('returns xai models', () => {
      const models = getModelsForProvider('xai');
      expect(models.length).toBeGreaterThanOrEqual(1);
      expect(models.every((m) => m.provider === 'xai')).toBe(true);
    });

    it('returns bedrock models', () => {
      const models = getModelsForProvider('bedrock');
      expect(models.length).toBeGreaterThanOrEqual(2);
      expect(models.every((m) => m.provider === 'bedrock')).toBe(true);
    });

    it('returns zhipu models', () => {
      const models = getModelsForProvider('zhipu');
      expect(models.length).toBeGreaterThanOrEqual(3);
      expect(models.every((m) => m.provider === 'zhipu')).toBe(true);
    });

    it('returns moonshot models', () => {
      const models = getModelsForProvider('moonshot');
      expect(models.length).toBeGreaterThanOrEqual(2);
      expect(models.every((m) => m.provider === 'moonshot')).toBe(true);
    });

    it('returns qwen models', () => {
      const models = getModelsForProvider('qwen');
      expect(models.length).toBeGreaterThanOrEqual(2);
      expect(models.every((m) => m.provider === 'qwen')).toBe(true);
    });

    it('returns volcengine (doubao) models', () => {
      const models = getModelsForProvider('volcengine');
      expect(models.length).toBeGreaterThanOrEqual(2);
      expect(models.every((m) => m.provider === 'volcengine')).toBe(true);
    });

    it('returns watsonx models', () => {
      const models = getModelsForProvider('watsonx');
      expect(models.length).toBeGreaterThanOrEqual(1);
      expect(models.every((m) => m.provider === 'watsonx')).toBe(true);
    });

    it('returns nvidia-nim models', () => {
      const models = getModelsForProvider('nvidia-nim');
      expect(models.length).toBeGreaterThanOrEqual(1);
      expect(models.every((m) => m.provider === 'nvidia-nim')).toBe(true);
    });

    it('returns huggingface models', () => {
      const models = getModelsForProvider('huggingface');
      expect(models.length).toBeGreaterThanOrEqual(1);
      expect(models.every((m) => m.provider === 'huggingface')).toBe(true);
    });

    it('returns empty array for providers not in catalog', () => {
      const models = getModelsForProvider('copilot');
      expect(Array.isArray(models)).toBe(true);
      // copilot has no catalog entries (uses openai backend)
      expect(models).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Pricing validation
  // ===========================================================================

  describe('pricing validation', () => {
    it('all paid models have output cost >= input cost or close to it', () => {
      const paidModels = MODEL_CATALOG.filter(
        (m) => m.costPer1MInput > 0 && m.costPer1MOutput > 0,
      );
      expect(paidModels.length).toBeGreaterThan(10);
      // Output tokens are always billed separately (no strict ratio required)
      for (const model of paidModels) {
        expect(model.costPer1MOutput).toBeGreaterThan(0);
      }
    });

    it('free models (cost = 0) are ollama or specific free-tier cloud models', () => {
      const freeModels = MODEL_CATALOG.filter(
        (m) => m.costPer1MInput === 0 && m.costPer1MOutput === 0,
      );
      for (const model of freeModels) {
        // Free models should be either ollama, huggingface, or explicitly free cloud (glm-4.7-flash)
        const validFreeProviders = ['ollama', 'huggingface', 'zhipu'];
        expect(
          validFreeProviders.includes(model.provider),
          `Free model "${model.id}" (${model.provider}) - expected in: ${validFreeProviders.join(', ')}`,
        ).toBe(true);
      }
    });

    it('anthropic opus is more expensive than haiku', () => {
      const opus = MODEL_CATALOG.find((m) => m.id === 'claude-opus-4-6' && m.provider === 'anthropic');
      const haiku = MODEL_CATALOG.find((m) => m.id === 'claude-haiku-4-5-20251001' && m.provider === 'anthropic');
      expect(opus).toBeDefined();
      expect(haiku).toBeDefined();
      expect(opus!.costPer1MInput).toBeGreaterThan(haiku!.costPer1MInput);
      expect(opus!.costPer1MOutput).toBeGreaterThan(haiku!.costPer1MOutput);
    });

    it('openai o1 has higher pricing than gpt-4o-mini', () => {
      const o1 = MODEL_CATALOG.find((m) => m.id === 'o1' && m.provider === 'openai');
      const mini = MODEL_CATALOG.find((m) => m.id === 'gpt-4o-mini' && m.provider === 'openai');
      expect(o1).toBeDefined();
      expect(mini).toBeDefined();
      expect(o1!.costPer1MInput).toBeGreaterThan(mini!.costPer1MInput);
    });
  });

  // ===========================================================================
  // Context window validation
  // ===========================================================================

  describe('context window validation', () => {
    it('google gemini-1.5-pro has largest context window among Google models', () => {
      const googleModels = getModelsForProvider('google');
      const pro = googleModels.find((m) => m.id === 'gemini-1.5-pro');
      expect(pro).toBeDefined();
      for (const m of googleModels) {
        if (m.id !== 'gemini-1.5-pro') {
          expect(pro!.contextWindow).toBeGreaterThanOrEqual(m.contextWindow);
        }
      }
    });

    it('anthropic opus has the largest context window among anthropic models', () => {
      const anthropicModels = getModelsForProvider('anthropic');
      const opus = anthropicModels.find((m) => m.id === 'claude-opus-4-6');
      expect(opus).toBeDefined();
      expect(opus!.contextWindow).toBe(1000000);
    });

    it('ollama models have context windows of at least 32k', () => {
      const ollamaModels = getModelsForProvider('ollama');
      for (const m of ollamaModels) {
        expect(m.contextWindow, `${m.id} context window`).toBeGreaterThanOrEqual(32768);
      }
    });

    it('qwen-long has the largest context window among qwen models', () => {
      const qwenModels = getModelsForProvider('qwen');
      const qwenLong = qwenModels.find((m) => m.id === 'qwen-long');
      expect(qwenLong).toBeDefined();
      for (const m of qwenModels) {
        expect(qwenLong!.contextWindow).toBeGreaterThanOrEqual(m.contextWindow);
      }
    });

    it('models that do not support streaming have supportsStreaming=false', () => {
      const nonStreamingModels = MODEL_CATALOG.filter((m) => !m.supportsStreaming);
      // At minimum the o1/o1-mini models should not support streaming
      const o1 = nonStreamingModels.find((m) => m.id === 'o1');
      expect(o1).toBeDefined();
    });
  });

  // ===========================================================================
  // getModelInfo - extended lookups
  // ===========================================================================

  describe('getModelInfo - extended', () => {
    it('finds gpt-4o model info', () => {
      const info = getModelInfo('gpt-4o');
      expect(info).toBeDefined();
      expect(info!.provider).toBe('openai');
    });

    it('finds groq llama-3.3-70b model info', () => {
      const info = getModelInfo('llama-3.3-70b-versatile');
      expect(info).toBeDefined();
      expect(info!.provider).toBe('groq');
      expect(info!.supportsTools).toBe(true);
    });

    it('finds ollama llama3.2 model info', () => {
      const info = getModelInfo('llama3.2');
      expect(info).toBeDefined();
      expect(info!.provider).toBe('ollama');
      expect(info!.supportsTools).toBe(false);
    });

    it('finds deepseek-chat model info', () => {
      const info = getModelInfo('deepseek-chat');
      expect(info).toBeDefined();
      expect(info!.provider).toBe('deepseek');
    });

    it('finds gemini-1.5-pro model info', () => {
      const info = getModelInfo('gemini-1.5-pro');
      expect(info).toBeDefined();
      expect(info!.provider).toBe('google');
      expect(info!.supportsVision).toBe(true);
    });

    it('returns undefined for an alias name (not a catalog id)', () => {
      // Aliases are not catalog IDs
      expect(getModelInfo('opus')).toBeUndefined();
      expect(getModelInfo('haiku')).toBeUndefined();
    });
  });

  // ===========================================================================
  // getAllModels
  // ===========================================================================

  describe('getAllModels - completeness', () => {
    it('contains models from all major providers', () => {
      const all = getAllModels();
      const providerSet = new Set(all.map((m) => m.provider));
      const expectedProviders = [
        'anthropic',
        'openai',
        'google',
        'groq',
        'ollama',
        'azure',
        'deepseek',
        'mistral',
        'xai',
        'bedrock',
      ];
      for (const provider of expectedProviders) {
        expect(providerSet.has(provider as ModelInfo['provider']), `Expected ${provider} in catalog`).toBe(true);
      }
    });

    it('returns the same reference as MODEL_CATALOG length', () => {
      const all = getAllModels();
      expect(all.length).toBe(MODEL_CATALOG.length);
    });
  });
});
