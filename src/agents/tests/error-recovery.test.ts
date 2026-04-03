import { describe, it, expect } from 'vitest';
import { ErrorRecoveryAdvisor, getErrorRecoveryAdvisor } from '../error-recovery.js';
import type { ErrorInput, RecoveryContext } from '../error-recovery.js';

function makeError(overrides: Partial<ErrorInput> = {}): ErrorInput {
  return {
    message: 'something went wrong',
    provider: 'openai',
    model: 'gpt-4o',
    ...overrides,
  };
}

function makeContext(overrides: Partial<RecoveryContext> = {}): RecoveryContext {
  return {
    availableProviders: ['openai', 'anthropic', 'ollama'],
    retryCount: 0,
    maxRetries: 3,
    ...overrides,
  };
}

describe('ErrorRecoveryAdvisor', () => {
  const advisor = new ErrorRecoveryAdvisor();

  // === Auth errors ===

  describe('401 Unauthorized', () => {
    it('returns a single abort action', () => {
      const actions = advisor.advise(makeError({ statusCode: 401 }), makeContext());
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('abort');
      expect(actions[0].description).toMatch(/authentication/i);
    });
  });

  describe('403 Forbidden', () => {
    it('returns a single abort action', () => {
      const actions = advisor.advise(makeError({ statusCode: 403 }), makeContext());
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('abort');
    });
  });

  // === Rate limit ===

  describe('429 Rate Limit', () => {
    it('starts with a wait action', () => {
      const actions = advisor.advise(makeError({ statusCode: 429 }), makeContext());
      expect(actions[0].type).toBe('wait');
      expect(actions[0].waitMs).toBeGreaterThan(0);
    });

    it('suggests switching provider when alternatives exist', () => {
      const actions = advisor.advise(makeError({ statusCode: 429 }), makeContext());
      const switchAction = actions.find(a => a.type === 'switch_provider');
      expect(switchAction).toBeDefined();
      expect(['anthropic', 'ollama']).toContain(switchAction?.provider);
    });

    it('includes retry when retryCount < maxRetries', () => {
      const actions = advisor.advise(
        makeError({ statusCode: 429 }),
        makeContext({ retryCount: 0, maxRetries: 3 }),
      );
      expect(actions.some(a => a.type === 'retry')).toBe(true);
    });

    it('does not include retry when retryCount >= maxRetries', () => {
      const actions = advisor.advise(
        makeError({ statusCode: 429 }),
        makeContext({ retryCount: 3, maxRetries: 3 }),
      );
      expect(actions.some(a => a.type === 'retry')).toBe(false);
    });

    it('applies exponential back-off on repeat retries', () => {
      const first = advisor.advise(
        makeError({ statusCode: 429 }),
        makeContext({ retryCount: 0 }),
      );
      const second = advisor.advise(
        makeError({ statusCode: 429 }),
        makeContext({ retryCount: 2 }),
      );
      const firstWait = first.find(a => a.type === 'wait')?.waitMs ?? 0;
      const secondWait = second.find(a => a.type === 'wait')?.waitMs ?? 0;
      expect(secondWait).toBeGreaterThan(firstWait);
    });

    it('also matches on message text', () => {
      const actions = advisor.advise(
        makeError({ message: 'rate limit exceeded' }),
        makeContext(),
      );
      expect(actions.some(a => a.type === 'wait')).toBe(true);
    });
  });

  // === Server overloaded ===

  describe('503 Overloaded', () => {
    it('starts with a wait action', () => {
      const actions = advisor.advise(makeError({ statusCode: 503 }), makeContext());
      expect(actions[0].type).toBe('wait');
    });

    it('includes retry when budget allows', () => {
      const actions = advisor.advise(makeError({ statusCode: 503 }), makeContext());
      expect(actions.some(a => a.type === 'retry')).toBe(true);
    });

    it('also matches "overloaded" in message', () => {
      const actions = advisor.advise(
        makeError({ message: 'The model is currently overloaded' }),
        makeContext(),
      );
      expect(actions[0].type).toBe('wait');
    });
  });

  // === Bad request ===

  describe('400 Bad Request', () => {
    it('suggests reduce_context first', () => {
      const actions = advisor.advise(makeError({ statusCode: 400 }), makeContext());
      expect(actions[0].type).toBe('reduce_context');
    });

    it('also suggests switch_model', () => {
      const actions = advisor.advise(makeError({ statusCode: 400 }), makeContext());
      expect(actions.some(a => a.type === 'switch_model')).toBe(true);
    });
  });

  // === Connection refused ===

  describe('ECONNREFUSED', () => {
    it('suggests switching provider', () => {
      const actions = advisor.advise(
        makeError({ code: 'ECONNREFUSED' }),
        makeContext(),
      );
      expect(actions[0].type).toBe('switch_provider');
    });

    it('aborts when no alternatives available', () => {
      const actions = advisor.advise(
        makeError({ code: 'ECONNREFUSED', provider: 'ollama' }),
        makeContext({ availableProviders: ['ollama'] }),
      );
      expect(actions[0].type).toBe('abort');
    });

    it('also matches on message text', () => {
      const actions = advisor.advise(
        makeError({ message: 'connect ECONNREFUSED 127.0.0.1:11434' }),
        makeContext(),
      );
      expect(actions[0].type).toBe('switch_provider');
    });
  });

  describe('ENOTFOUND', () => {
    it('suggests switching provider', () => {
      const actions = advisor.advise(
        makeError({ code: 'ENOTFOUND' }),
        makeContext(),
      );
      expect(actions[0].type).toBe('switch_provider');
    });
  });

  // === Timeout ===

  describe('Timeout errors', () => {
    it('starts with a wait action', () => {
      const actions = advisor.advise(
        makeError({ code: 'ETIMEDOUT' }),
        makeContext(),
      );
      expect(actions[0].type).toBe('wait');
    });

    it('suggests retry and reduce_context', () => {
      const actions = advisor.advise(
        makeError({ code: 'ETIMEDOUT' }),
        makeContext(),
      );
      expect(actions.some(a => a.type === 'retry')).toBe(true);
      expect(actions.some(a => a.type === 'reduce_context')).toBe(true);
    });

    it('also matches "timed out" in message', () => {
      const actions = advisor.advise(
        makeError({ message: 'Request timed out after 30000ms' }),
        makeContext(),
      );
      expect(actions[0].type).toBe('wait');
    });
  });

  // === Context length exceeded ===

  describe('context_length_exceeded', () => {
    it('suggests reduce_context first', () => {
      const actions = advisor.advise(
        makeError({ code: 'context_length_exceeded' }),
        makeContext(),
      );
      expect(actions[0].type).toBe('reduce_context');
    });

    it('suggests switch_model as fallback', () => {
      const actions = advisor.advise(
        makeError({ message: 'This model\'s maximum context length is 128000 tokens.' }),
        makeContext(),
      );
      expect(actions.some(a => a.type === 'switch_model')).toBe(true);
    });
  });

  // === Content filter ===

  describe('content filter', () => {
    it('suggests switch_model', () => {
      const actions = advisor.advise(
        makeError({ message: 'Content was filtered by the content filter.' }),
        makeContext(),
      );
      expect(actions.some(a => a.type === 'switch_model')).toBe(true);
    });

    it('includes abort as final fallback', () => {
      const actions = advisor.advise(
        makeError({ message: 'Your request was blocked due to safety policy' }),
        makeContext(),
      );
      expect(actions.some(a => a.type === 'abort')).toBe(true);
    });
  });

  // === Generic fallback ===

  describe('generic errors', () => {
    it('suggests retry when retryCount < maxRetries', () => {
      const actions = advisor.advise(
        makeError({ message: 'Unexpected error occurred' }),
        makeContext({ retryCount: 0, maxRetries: 3 }),
      );
      expect(actions[0].type).toBe('retry');
    });

    it('suggests abort when maxRetries exhausted', () => {
      const actions = advisor.advise(
        makeError({ message: 'Unexpected error occurred' }),
        makeContext({ retryCount: 3, maxRetries: 3 }),
      );
      expect(actions[0].type).toBe('abort');
    });
  });

  // === Return type contract ===

  describe('return type contract', () => {
    it('always returns a non-empty array', () => {
      const actions = advisor.advise(makeError(), makeContext());
      expect(actions.length).toBeGreaterThan(0);
    });

    it('each action has a type and description', () => {
      const actions = advisor.advise(makeError({ statusCode: 429 }), makeContext());
      for (const action of actions) {
        expect(typeof action.type).toBe('string');
        expect(typeof action.description).toBe('string');
        expect(action.description.length).toBeGreaterThan(0);
      }
    });
  });

  // === Singleton ===

  describe('getErrorRecoveryAdvisor', () => {
    it('returns the same instance on repeated calls', () => {
      const a = getErrorRecoveryAdvisor();
      const b = getErrorRecoveryAdvisor();
      expect(a).toBe(b);
    });
  });
});
