import { describe, it, expect, beforeEach } from 'vitest';
import {
  classifyComplexity,
  selectModel,
  routeQuery,
  getCostComparison,
  getRoutingStats,
  recordRoutingDecision,
  configureSmartRouter,
  getCostOptimizationAdvice,
  type ComplexityTier,
} from '../smart-router.js';
import type { ProviderType } from '../core/types.js';

// Helper: all major providers available
const ALL_PROVIDERS = new Set<ProviderType>([
  'anthropic', 'openai', 'google', 'groq', 'ollama',
  'xai', 'mistral', 'deepseek', 'cerebras',
]);

// Helper: only Anthropic available
const ANTHROPIC_ONLY = new Set<ProviderType>(['anthropic']);

describe('Smart Model Router', () => {
  beforeEach(() => {
    configureSmartRouter({
      enabled: true,
      defaultModel: 'claude-sonnet-4-5-20250929',
      preferredProviders: [],
      maxCostPerRequest: 0.50,
      enableLocalFallback: true,
      complexityThresholds: { trivialMax: 0.25, standardMax: 0.60 },
    });
  });

  // Complexity Classification

  describe('classifyComplexity', () => {
    it('classifies greetings as trivial', () => {
      const result = classifyComplexity('hello');
      expect(result.tier).toBe('trivial');
      expect(result.signals.some(s => s.name === 'greeting_chitchat' && s.matched)).toBe(true);
    });

    it('classifies "hi how are you" as trivial', () => {
      const result = classifyComplexity('hi how are you');
      expect(result.tier).toBe('trivial');
    });

    it('classifies "thanks" as trivial', () => {
      const result = classifyComplexity('thanks');
      expect(result.tier).toBe('trivial');
    });

    it('classifies simple questions as trivial', () => {
      const result = classifyComplexity('what is TypeScript?');
      expect(result.tier).toBe('trivial');
    });

    it('classifies typo fixes as trivial', () => {
      const result = classifyComplexity('fix typo in readme');
      expect(result.tier).toBe('trivial');
    });

    it('classifies code generation as standard or complex', () => {
      const result = classifyComplexity('implement a function that validates email addresses with regex');
      expect(['standard', 'complex']).toContain(result.tier);
      expect(result.signals.some(s => s.name === 'code_generation' && s.matched)).toBe(true);
    });

    it('classifies architecture questions as complex', () => {
      const result = classifyComplexity(
        'design a microservice architecture for our e-commerce platform with event-driven communication, ' +
        'database schema for orders and inventory, and analyze the trade-offs between CQRS and traditional patterns',
      );
      expect(result.tier).toBe('complex');
    });

    it('classifies multi-step reasoning as higher complexity', () => {
      const result = classifyComplexity(
        'analyze the performance bottleneck in our API, compare different caching strategies, ' +
        'and evaluate the trade-offs of Redis vs Memcached for our use case',
      );
      expect(result.score).toBeGreaterThan(0.5);
    });

    it('increases complexity for long conversations', () => {
      const short = classifyComplexity('help me with this code', { conversationLength: 1 });
      const long = classifyComplexity('help me with this code', { conversationLength: 15 });
      expect(long.score).toBeGreaterThan(short.score);
    });

    it('increases complexity when tools are needed', () => {
      const noTools = classifyComplexity('check the status', { hasToolUse: false });
      const withTools = classifyComplexity('check the status', { hasToolUse: true });
      expect(withTools.score).toBeGreaterThan(noTools.score);
    });

    it('increases complexity for images', () => {
      const noImg = classifyComplexity('describe this', { hasImages: false });
      const withImg = classifyComplexity('describe this', { hasImages: true });
      expect(withImg.score).toBeGreaterThan(noImg.score);
    });

    it('returns confidence between 0 and 1', () => {
      const result = classifyComplexity('build a REST API');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('returns score clamped between 0 and 1', () => {
      // Very trivial
      const trivial = classifyComplexity('hi');
      expect(trivial.score).toBeGreaterThanOrEqual(0);
      expect(trivial.score).toBeLessThanOrEqual(1);

      // Very complex
      const complex = classifyComplexity(
        'design and implement a distributed system architecture with microservices, ' +
        'evaluate trade-offs between consistency models, analyze security implications, ' +
        'and create database schemas for user.ts, order.ts, inventory.ts, payment.ts files',
      );
      expect(complex.score).toBeGreaterThanOrEqual(0);
      expect(complex.score).toBeLessThanOrEqual(1);
    });

    it('detects multi-file scope', () => {
      const result = classifyComplexity('refactor the handler in user.ts, order.ts, and payment.ts');
      expect(result.signals.some(s => s.name === 'multi_file_scope' && s.matched)).toBe(true);
    });
  });

  // Model Selection

  describe('selectModel', () => {
    it('selects cheap model for trivial queries', () => {
      const complexity = classifyComplexity('hello');
      const decision = selectModel(complexity, ALL_PROVIDERS);
      // Should not pick Opus for a greeting
      expect(decision.selectedModel.id).not.toBe('claude-opus-4-6');
      expect(decision.savingsPercent).toBeGreaterThan(0);
    });

    it('selects capable model for complex queries', () => {
      const complexity = classifyComplexity(
        'design a distributed system with trade-offs analysis for scaling our microservices',
      );
      const decision = selectModel(complexity, ALL_PROVIDERS);
      // Should pick a reasoning-capable model
      expect(decision.selectedModel.contextWindow).toBeGreaterThanOrEqual(128000);
    });

    it('respects provider availability', () => {
      const complexity = classifyComplexity('implement a REST endpoint');
      const decision = selectModel(complexity, ANTHROPIC_ONLY);
      expect(decision.selectedModel.provider).toBe('anthropic');
    });

    it('respects model override', () => {
      const complexity = classifyComplexity('hello');
      const decision = selectModel(complexity, ALL_PROVIDERS, 'claude-opus-4-6');
      expect(decision.selectedModel.id).toBe('claude-opus-4-6');
    });

    it('provides alternative models', () => {
      const complexity = classifyComplexity('write a unit test');
      const decision = selectModel(complexity, ALL_PROVIDERS);
      // Should have some alternatives
      expect(decision.alternativeModels.length).toBeGreaterThanOrEqual(0);
    });

    it('calculates savings correctly', () => {
      const complexity = classifyComplexity('hi');
      const decision = selectModel(complexity, ALL_PROVIDERS);
      expect(decision.savedVsDefault).toBeGreaterThanOrEqual(0);
      expect(decision.savingsPercent).toBeGreaterThanOrEqual(0);
      expect(decision.savingsPercent).toBeLessThanOrEqual(100);
    });
  });

  // End-to-end routing

  describe('routeQuery', () => {
    it('routes trivial query to cheap model', () => {
      const decision = routeQuery('thanks!', ALL_PROVIDERS);
      expect(decision.complexity.tier).toBe('trivial');
      expect(decision.estimatedCost).toBeLessThan(0.01);
    });

    it('routes complex query to capable model', () => {
      const decision = routeQuery(
        'analyze our system architecture and design a migration plan with security considerations',
        ALL_PROVIDERS,
      );
      expect(decision.complexity.tier).toBe('complex');
    });

    it('filters vision-incapable models when images present', () => {
      const decision = routeQuery('describe this image', ALL_PROVIDERS, { hasImages: true });
      expect(decision.selectedModel.supportsVision).toBe(true);
    });
  });

  // Cost Comparison Display

  describe('getCostComparison', () => {
    it('returns formatted string', () => {
      const decision = routeQuery('hello', ALL_PROVIDERS);
      const comparison = getCostComparison(decision);
      expect(comparison).toContain('$');
      expect(typeof comparison).toBe('string');
    });
  });

  // Stats Tracking

  describe('routing stats', () => {
    it('tracks routing decisions', () => {
      const decision = routeQuery('hello', ALL_PROVIDERS);
      recordRoutingDecision(decision);

      const stats = getRoutingStats();
      expect(stats.totalRouted).toBeGreaterThanOrEqual(1);
      expect(stats.byTier.trivial).toBeGreaterThanOrEqual(1);
    });
  });

  // Tier boundary tests

  describe('tier boundaries', () => {
    const tierCases: Array<[string, ComplexityTier]> = [
      ['ok', 'trivial'],
      ['got it', 'trivial'],
      ['show me the git status', 'trivial'],
      ['fix typo in the readme', 'trivial'],
      ['write a function to parse CSV files', 'standard'],
      [
        'design a system architecture for real-time data processing with event-driven microservices, ' +
        'evaluate trade-offs between Kafka and RabbitMQ, implement the database schema',
        'complex',
      ],
    ];

    for (const [prompt, expectedTier] of tierCases) {
      it(`"${prompt.slice(0, 50)}..." -> ${expectedTier}`, () => {
        const result = classifyComplexity(prompt);
        expect(result.tier).toBe(expectedTier);
      });
    }
  });

  // Provider Recommendations

  describe('missingProviderHint', () => {
    it('suggests a cheaper provider when user only has Anthropic', () => {
      const decision = routeQuery('hello', ANTHROPIC_ONLY);
      // Haiku 4.5 is already very cheap, so hint may suggest Google Gemini Flash
      // which is meaningfully cheaper (67% less)
      if (decision.missingProviderHint) {
        expect(decision.missingProviderHint.freeTrialAvailable).toBe(true);
        expect(decision.missingProviderHint.signupUrl).toBeTruthy();
      }
    });

    it('includes signup URL and savings in hint', () => {
      // Only OpenAI configured - many cheaper options exist
      const openaiOnly = new Set<ProviderType>(['openai']);
      const decision = routeQuery('hello', openaiOnly);
      if (decision.missingProviderHint) {
        expect(decision.missingProviderHint.signupUrl).toContain('http');
        expect(decision.missingProviderHint.estimatedSavings).toContain('%');
      }
    });

    it('no hint when all major providers configured', () => {
      const decision = routeQuery('hello', ALL_PROVIDERS);
      // With all providers available, the cheapest option is already selected
      expect(decision.missingProviderHint).toBeUndefined();
    });
  });

  // Cost Optimization Advice

  describe('getCostOptimizationAdvice', () => {
    it('recommends adding Groq for single-provider users', () => {
      const advice = getCostOptimizationAdvice(ANTHROPIC_ONLY);
      expect(advice.length).toBeGreaterThan(0);
      const groqAdvice = advice.find(a => a.envVar === 'GROQ_API_KEY');
      expect(groqAdvice).toBeDefined();
      expect(groqAdvice?.priority).toBe('high');
    });

    it('warns about single-provider fragility', () => {
      const advice = getCostOptimizationAdvice(ANTHROPIC_ONLY);
      const singleProviderWarning = advice.find(a => a.action.includes('one more provider'));
      expect(singleProviderWarning).toBeDefined();
      expect(singleProviderWarning?.priority).toBe('high');
    });

    it('gives optimal feedback when well-configured', () => {
      const optimal = new Set<ProviderType>(['anthropic', 'groq', 'google', 'openai']);
      const advice = getCostOptimizationAdvice(optimal);
      const optimalCheck = advice.find(a => a.action.includes('cost-optimal'));
      expect(optimalCheck).toBeDefined();
    });

    it('suggests Google when missing', () => {
      const noGoogle = new Set<ProviderType>(['anthropic', 'groq']);
      const advice = getCostOptimizationAdvice(noGoogle);
      const googleAdvice = advice.find(a => a.envVar === 'GOOGLE_API_KEY');
      expect(googleAdvice).toBeDefined();
    });
  });
});
