import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  validateEnvironment,
  getConfiguredIntegrations,
  getConfiguredAIProviders,
  generateEnvExample,
  ENV_SPEC,
} from '../env-validator.js';

describe('env-validator', () => {
  // Store original env
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset env for each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('validateEnvironment', () => {
    it('applies defaults for missing optional variables', () => {
      delete process.env.PORT;
      
      const result = validateEnvironment({ logResults: false });
      
      expect(result.valid).toBe(true);
      expect(process.env.PORT).toBe('3000');
    });

    it('warns when no AI provider is configured', () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOGLE_AI_API_KEY;
      
      const result = validateEnvironment({ logResults: false });
      
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('No AI provider configured');
    });

    it('fails when STORAGE_TIER=libsql but no LIBSQL_URL', () => {
      process.env.STORAGE_TIER = 'libsql';
      delete process.env.LIBSQL_URL;
      
      const result = validateEnvironment({ logResults: false });
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('STORAGE_TIER=libsql requires LIBSQL_URL to be set');
    });

    it('passes when STORAGE_TIER=libsql with LIBSQL_URL', () => {
      process.env.STORAGE_TIER = 'libsql';
      process.env.LIBSQL_URL = 'libsql://test.turso.io';
      
      const result = validateEnvironment({ logResults: false });
      
      expect(result.errors).not.toContain('STORAGE_TIER=libsql requires LIBSQL_URL to be set');
    });
  });

  describe('getConfiguredIntegrations', () => {
    it('returns empty array when no integrations configured', () => {
      delete process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_CLIENT_ID;
      delete process.env.JIRA_CLIENT_ID;
      delete process.env.LINEAR_API_KEY;
      delete process.env.SLACK_BOT_TOKEN;
      delete process.env.DISCORD_BOT_TOKEN;
      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.WHATSAPP_ACCESS_TOKEN;
      
      const integrations = getConfiguredIntegrations();
      expect(integrations).toEqual([]);
    });

    it('lists GitHub when GITHUB_TOKEN is set', () => {
      process.env.GITHUB_TOKEN = 'ghp_test';
      
      const integrations = getConfiguredIntegrations();
      expect(integrations).toContain('GitHub');
    });

    it('lists multiple integrations', () => {
      process.env.GITHUB_TOKEN = 'ghp_test';
      process.env.SLACK_BOT_TOKEN = 'xoxb-test';
      process.env.LINEAR_API_KEY = 'lin_test';
      
      const integrations = getConfiguredIntegrations();
      expect(integrations).toContain('GitHub');
      expect(integrations).toContain('Slack');
      expect(integrations).toContain('Linear');
    });
  });

  describe('getConfiguredAIProviders', () => {
    it('returns empty array when no providers configured', () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOGLE_AI_API_KEY;
      delete process.env.AZURE_OPENAI_API_KEY;
      delete process.env.OLLAMA_URL;
      
      const providers = getConfiguredAIProviders();
      expect(providers).toEqual([]);
    });

    it('lists Anthropic when configured', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      
      const providers = getConfiguredAIProviders();
      expect(providers).toContain('Anthropic (Claude)');
    });

    it('lists Ollama when URL is set', () => {
      process.env.OLLAMA_URL = 'http://localhost:11434';
      
      const providers = getConfiguredAIProviders();
      expect(providers).toContain('Ollama (local)');
    });
  });

  describe('generateEnvExample', () => {
    it('generates valid multi-line string', () => {
      const example = generateEnvExample();
      
      expect(typeof example).toBe('string');
      expect(example.length).toBeGreaterThan(100);
      expect(example).toContain('PORT');
      expect(example).toContain('ANTHROPIC_API_KEY');
    });

    it('includes category headers', () => {
      const example = generateEnvExample();
      
      expect(example).toContain('Server');
      expect(example).toContain('AI Providers');
      expect(example).toContain('GitHub Integration');
    });
  });

  describe('ENV_SPEC', () => {
    it('has all required fields for each spec', () => {
      for (const spec of ENV_SPEC) {
        expect(spec).toHaveProperty('name');
        expect(spec).toHaveProperty('required');
        expect(spec).toHaveProperty('description');
        expect(typeof spec.name).toBe('string');
        expect(typeof spec.required).toBe('boolean');
        expect(typeof spec.description).toBe('string');
      }
    });

    it('includes core variables', () => {
      const names = ENV_SPEC.map(s => s.name);
      expect(names).toContain('PORT');
      expect(names).toContain('STORAGE_TIER');
      expect(names).toContain('ANTHROPIC_API_KEY');
      expect(names).toContain('GITHUB_TOKEN');
    });
  });
});
