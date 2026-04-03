import { describe, it, expect, beforeEach } from 'vitest';
import { PromptSuggestionEngine, getPromptSuggestionEngine } from '../prompt-suggestions.js';
import type { Suggestion, SuggestionContext } from '../prompt-suggestions.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeContext(overrides: Partial<SuggestionContext> = {}): SuggestionContext {
  return {
    lastUserMessage: 'Hello',
    lastAssistantResponse: 'Hi there!',
    toolsUsed: [],
    conversationLength: 2,
    ...overrides,
  };
}

function texts(suggestions: Suggestion[]): string[] {
  return suggestions.map((s) => s.text);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PromptSuggestionEngine', () => {
  let engine: PromptSuggestionEngine;

  beforeEach(() => {
    engine = new PromptSuggestionEngine();
  });

  describe('output constraints', () => {
    it('always returns at most 3 suggestions', () => {
      const ctx = makeContext({
        lastAssistantResponse: `
          Here is the code: \`\`\`ts\nconst foo = () => {}\n\`\`\`
          There was an error: TypeError: cannot read property of undefined.
          The file was saved.
        `,
        toolsUsed: ['readFile', 'writeFile'],
        conversationLength: 10,
      });
      const result = engine.generateSuggestions(ctx);
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it('always returns at least 1 suggestion', () => {
      const ctx = makeContext();
      const result = engine.generateSuggestions(ctx);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('never returns duplicate suggestion texts', () => {
      // Run multiple times with the same context
      for (let i = 0; i < 5; i++) {
        const ctx = makeContext({
          lastAssistantResponse: 'function greet() { return "hello"; }',
          toolsUsed: ['bash'],
          conversationLength: 3,
        });
        const result = engine.generateSuggestions(ctx);
        const seen = new Set<string>();
        for (const s of result) {
          expect(seen.has(s.text)).toBe(false);
          seen.add(s.text);
        }
      }
    });

    it('each suggestion has a valid category', () => {
      const validCategories = new Set(['follow-up', 'deeper', 'related', 'action']);
      const ctx = makeContext({ lastAssistantResponse: 'Here is some code: const x = 1;' });
      const result = engine.generateSuggestions(ctx);
      for (const s of result) {
        expect(validCategories.has(s.category)).toBe(true);
      }
    });
  });

  describe('code context', () => {
    it('suggests explanation when code is present', () => {
      const ctx = makeContext({
        lastAssistantResponse: '```ts\nfunction greet(name: string) { return `Hello ${name}`; }\n```',
        conversationLength: 6,
      });
      const result = engine.generateSuggestions(ctx);
      const allText = texts(result).join(' ');
      expect(allText).toMatch(/explain|test|optimize/i);
    });

    it('includes "Write tests" suggestion for code response', () => {
      const ctx = makeContext({
        lastAssistantResponse: 'Here is the implementation:\n```js\nconst add = (a, b) => a + b;\n```',
        conversationLength: 4,
      });
      const result = engine.generateSuggestions(ctx);
      expect(texts(result)).toContain('Write tests for this');
    });

    it('uses extracted function name in explanation prompt', () => {
      const ctx = makeContext({
        lastAssistantResponse: 'function processQueue() { /* ... */ }',
        conversationLength: 4,
      });
      const result = engine.generateSuggestions(ctx);
      const explanationSuggestion = result.find((s) => s.category === 'deeper');
      expect(explanationSuggestion?.text).toContain('processQueue');
    });
  });

  describe('error context', () => {
    it('suggests fix when error is mentioned in assistant response', () => {
      const ctx = makeContext({
        lastAssistantResponse: 'There was an error: TypeError: Cannot read property of undefined',
        conversationLength: 6,
      });
      const result = engine.generateSuggestions(ctx);
      const allText = texts(result).join(' ');
      expect(allText).toMatch(/fix|caus/i);
    });

    it('suggests root cause when "failed" appears', () => {
      const ctx = makeContext({
        lastUserMessage: 'Why did the build fail?',
        lastAssistantResponse: 'The build failed because of a type error.',
        conversationLength: 4,
      });
      const result = engine.generateSuggestions(ctx);
      const allText = texts(result).join(' ');
      expect(allText).toMatch(/fix|caus/i);
    });

    it('error suggestions have appropriate categories', () => {
      const ctx = makeContext({
        lastAssistantResponse: 'An exception was thrown in the handler.',
        conversationLength: 2,
      });
      const result = engine.generateSuggestions(ctx);
      const categories = result.map((s) => s.category);
      expect(categories).toContain('follow-up');
    });
  });

  describe('tool usage context', () => {
    it('suggests further tool use when tools were used', () => {
      const ctx = makeContext({
        lastAssistantResponse: 'I ran the search and found some results.',
        toolsUsed: ['web_search'],
        conversationLength: 4,
      });
      const result = engine.generateSuggestions(ctx);
      const allText = texts(result).join(' ');
      expect(allText).toContain('web_search');
    });

    it('uses first tool name in suggestion', () => {
      const ctx = makeContext({
        lastAssistantResponse: 'I executed the command.',
        toolsUsed: ['bash', 'readFile'],
        conversationLength: 3,
      });
      const result = engine.generateSuggestions(ctx);
      const toolSuggestion = result.find((s) => s.text.includes('bash'));
      expect(toolSuggestion).toBeDefined();
    });
  });

  describe('file edit context', () => {
    it('suggests /diff when file was edited', () => {
      const ctx = makeContext({
        lastAssistantResponse: 'I updated the file and saved the changes.',
        conversationLength: 6,
      });
      const result = engine.generateSuggestions(ctx);
      expect(texts(result)).toContain('/diff');
    });

    it('suggests running tests after file modification', () => {
      const ctx = makeContext({
        lastAssistantResponse: 'The file has been modified successfully.',
        conversationLength: 8,
      });
      const result = engine.generateSuggestions(ctx);
      const allText = texts(result).join(' ');
      expect(allText).toMatch(/test|diff/i);
    });
  });

  describe('conversation length variation', () => {
    it('returns broad exploratory prompts for early conversations (length <= 4)', () => {
      const ctx = makeContext({
        lastUserMessage: 'Hi',
        lastAssistantResponse: 'Hello! How can I help you today?',
        toolsUsed: [],
        conversationLength: 2,
      });
      const result = engine.generateSuggestions(ctx);
      const allText = texts(result).join(' ');
      expect(allText).toMatch(/help|elaborate|more/i);
    });

    it('returns specific follow-ups for longer conversations (length > 4)', () => {
      const ctx = makeContext({
        lastUserMessage: 'Done for now',
        lastAssistantResponse: 'Great, that covers everything.',
        toolsUsed: [],
        conversationLength: 12,
      });
      const result = engine.generateSuggestions(ctx);
      const allText = texts(result).join(' ');
      expect(allText).toMatch(/summarize|next|so far/i);
    });
  });

  describe('concept / explanation context', () => {
    it('suggests concrete example when explanation is given', () => {
      const ctx = makeContext({
        lastUserMessage: 'What is dependency injection?',
        lastAssistantResponse: 'Dependency injection is a design pattern where dependencies are provided rather than created internally.',
        conversationLength: 2,
      });
      const result = engine.generateSuggestions(ctx);
      const allText = texts(result).join(' ');
      expect(allText).toMatch(/example|trade/i);
    });
  });

  describe('getPromptSuggestionEngine singleton', () => {
    it('returns the same instance on repeated calls', () => {
      const a = getPromptSuggestionEngine();
      const b = getPromptSuggestionEngine();
      expect(a).toBe(b);
    });

    it('singleton instance generates valid suggestions', () => {
      const e = getPromptSuggestionEngine();
      const result = e.generateSuggestions(makeContext());
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
