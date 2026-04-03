import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  AutoMemoryExtractor,
  _resetAutoMemoryExtractorSingleton,
  getAutoMemoryExtractor,
} from '../auto-memory.js';
import type { TurnInput, MemoryEntry } from '../auto-memory.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'profclaw-auto-memory-test-'));
}

function makeTurn(overrides: Partial<TurnInput> = {}): TurnInput {
  return {
    userMessage: 'Hello',
    assistantResponse: 'Hi there',
    sessionId: 'session-test',
    turnIndex: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Construction + persistence
// ---------------------------------------------------------------------------

describe('AutoMemoryExtractor construction and persistence', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    _resetAutoMemoryExtractorSingleton();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    _resetAutoMemoryExtractorSingleton();
  });

  it('starts with no entries when directory is empty', () => {
    const extractor = new AutoMemoryExtractor(tmpDir);
    expect(extractor.getAll()).toHaveLength(0);
  });

  it('persists entries to disk and reloads them', () => {
    const extractor = new AutoMemoryExtractor(tmpDir);
    extractor.extractFromTurn(
      makeTurn({ userMessage: 'I prefer TypeScript over JavaScript.' }),
    );

    const extractor2 = new AutoMemoryExtractor(tmpDir);
    expect(extractor2.getAll().length).toBeGreaterThan(0);
  });

  it('save/load round-trips entries without data loss', () => {
    const extractor = new AutoMemoryExtractor(tmpDir);
    extractor.extractFromTurn(
      makeTurn({ userMessage: 'I prefer Vitest over Jest.' }),
    );
    extractor.save();

    const extractor2 = new AutoMemoryExtractor(tmpDir);
    const entries = extractor2.getAll();
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].type).toBe('preference');
  });
});

// ---------------------------------------------------------------------------
// extractFromTurn — decision
// ---------------------------------------------------------------------------

describe('extractFromTurn — decision memories', () => {
  let tmpDir: string;
  let extractor: AutoMemoryExtractor;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    extractor = new AutoMemoryExtractor(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts a decision from "no, use X instead"', () => {
    const entries = extractor.extractFromTurn(
      makeTurn({ userMessage: 'No, use Zod instead of Joi for validation.' }),
    );

    expect(entries.some((e) => e.type === 'decision')).toBe(true);
  });

  it('extracts a decision from "don\'t use X"', () => {
    const entries = extractor.extractFromTurn(
      makeTurn({ userMessage: "Don't use jQuery, we're on React." }),
    );

    expect(entries.some((e) => e.type === 'decision')).toBe(true);
  });

  it('extracts a decision from "use X not Y"', () => {
    const entries = extractor.extractFromTurn(
      makeTurn({ userMessage: 'Use pnpm not npm for package management.' }),
    );

    expect(entries.some((e) => e.type === 'decision')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractFromTurn — preference
// ---------------------------------------------------------------------------

describe('extractFromTurn — preference memories', () => {
  let tmpDir: string;
  let extractor: AutoMemoryExtractor;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    extractor = new AutoMemoryExtractor(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts a preference from "I prefer X"', () => {
    const entries = extractor.extractFromTurn(
      makeTurn({ userMessage: 'I prefer functional components over class components.' }),
    );

    expect(entries.some((e) => e.type === 'preference')).toBe(true);
  });

  it('extracts a preference from "I always use X"', () => {
    const entries = extractor.extractFromTurn(
      makeTurn({ userMessage: 'I always use Tailwind for styling.' }),
    );

    expect(entries.some((e) => e.type === 'preference')).toBe(true);
  });

  it('extracts a preference from "always use X"', () => {
    const entries = extractor.extractFromTurn(
      makeTurn({ userMessage: 'Always use const for variable declarations.' }),
    );

    expect(entries.some((e) => e.type === 'preference')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractFromTurn — context
// ---------------------------------------------------------------------------

describe('extractFromTurn — context memories', () => {
  let tmpDir: string;
  let extractor: AutoMemoryExtractor;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    extractor = new AutoMemoryExtractor(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts context from "this project uses X"', () => {
    const entries = extractor.extractFromTurn(
      makeTurn({ userMessage: 'This project uses React 19 and TypeScript.' }),
    );

    expect(entries.some((e) => e.type === 'context')).toBe(true);
  });

  it('extracts context from "we use X"', () => {
    const entries = extractor.extractFromTurn(
      makeTurn({ userMessage: 'We use PostgreSQL for all our data storage.' }),
    );

    expect(entries.some((e) => e.type === 'context')).toBe(true);
  });

  it('extracts context from "the stack is X"', () => {
    const entries = extractor.extractFromTurn(
      makeTurn({ userMessage: 'The stack is Next.js, Prisma, and tRPC.' }),
    );

    expect(entries.some((e) => e.type === 'context')).toBe(true);
  });

  it('extracts context from assistant response', () => {
    const entries = extractor.extractFromTurn(
      makeTurn({
        userMessage: 'What framework?',
        assistantResponse: 'You are using Next.js with the App Router.',
      }),
    );

    expect(entries.some((e) => e.type === 'context')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractFromTurn — error_fix
// ---------------------------------------------------------------------------

describe('extractFromTurn — error_fix memories', () => {
  let tmpDir: string;
  let extractor: AutoMemoryExtractor;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    extractor = new AutoMemoryExtractor(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts error_fix from "the fix was X"', () => {
    const entries = extractor.extractFromTurn(
      makeTurn({ userMessage: 'The fix was adding async/await to the handler.' }),
    );

    expect(entries.some((e) => e.type === 'error_fix')).toBe(true);
  });

  it('extracts error_fix from "the issue was X"', () => {
    const entries = extractor.extractFromTurn(
      makeTurn({ userMessage: 'The issue was a missing return statement in the reducer.' }),
    );

    expect(entries.some((e) => e.type === 'error_fix')).toBe(true);
  });

  it('extracts error_fix from "solved by X"', () => {
    const entries = extractor.extractFromTurn(
      makeTurn({ userMessage: 'Solved by upgrading the dependency to v2.' }),
    );

    expect(entries.some((e) => e.type === 'error_fix')).toBe(true);
  });

  it('extracts error_fix from assistant response (root cause)', () => {
    const entries = extractor.extractFromTurn(
      makeTurn({
        userMessage: 'Why did this crash?',
        assistantResponse: 'Root cause: the callback was called twice due to a React strict-mode double-invoke.',
      }),
    );

    expect(entries.some((e) => e.type === 'error_fix')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractFromTurn — pattern (repeated tool chains)
// ---------------------------------------------------------------------------

describe('extractFromTurn — pattern memories from tool chains', () => {
  let tmpDir: string;
  let extractor: AutoMemoryExtractor;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    extractor = new AutoMemoryExtractor(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does NOT emit pattern until threshold (3) is reached', () => {
    const toolCalls = [
      { name: 'read_file', args: {}, result: 'ok' },
      { name: 'write_file', args: {}, result: 'ok' },
    ];

    extractor.extractFromTurn(makeTurn({ toolCalls, turnIndex: 0 }));
    extractor.extractFromTurn(makeTurn({ toolCalls, turnIndex: 1 }));

    const entries = extractor.getAll();
    expect(entries.filter((e) => e.type === 'pattern')).toHaveLength(0);
  });

  it('emits a pattern memory exactly once when threshold is reached', () => {
    const toolCalls = [
      { name: 'read_file', args: {}, result: 'ok' },
      { name: 'write_file', args: {}, result: 'ok' },
    ];

    extractor.extractFromTurn(makeTurn({ toolCalls, turnIndex: 0 }));
    extractor.extractFromTurn(makeTurn({ toolCalls, turnIndex: 1 }));
    extractor.extractFromTurn(makeTurn({ toolCalls, turnIndex: 2 }));

    const patterns = extractor.getAll().filter((e) => e.type === 'pattern');
    expect(patterns).toHaveLength(1);
    expect(patterns[0].content).toContain('read_file → write_file');
  });

  it('does not duplicate the pattern memory on subsequent calls', () => {
    const toolCalls = [
      { name: 'bash', args: {}, result: 'ok' },
      { name: 'read_file', args: {}, result: 'ok' },
    ];

    for (let i = 0; i < 6; i++) {
      extractor.extractFromTurn(makeTurn({ toolCalls, turnIndex: i }));
    }

    const patterns = extractor.getAll().filter((e) => e.type === 'pattern');
    expect(patterns).toHaveLength(1);
  });

  it('ignores tool chains with fewer than 2 tools', () => {
    const toolCalls = [{ name: 'read_file', args: {}, result: 'ok' }];

    for (let i = 0; i < 5; i++) {
      extractor.extractFromTurn(makeTurn({ toolCalls, turnIndex: i }));
    }

    expect(extractor.getAll().filter((e) => e.type === 'pattern')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// deduplication
// ---------------------------------------------------------------------------

describe('AutoMemoryExtractor deduplication', () => {
  let tmpDir: string;
  let extractor: AutoMemoryExtractor;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    extractor = new AutoMemoryExtractor(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not store duplicate entries with identical content', () => {
    const turn = makeTurn({ userMessage: 'I prefer ESM over CommonJS.' });
    extractor.extractFromTurn(turn);
    extractor.extractFromTurn(turn);

    const all = extractor.getAll();
    const preference = all.filter((e) => e.type === 'preference');
    // Should not be duplicated
    const contents = preference.map((e) => e.content);
    const unique = new Set(contents);
    expect(unique.size).toBe(contents.length);
  });
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe('AutoMemoryExtractor.search', () => {
  let tmpDir: string;
  let extractor: AutoMemoryExtractor;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    extractor = new AutoMemoryExtractor(tmpDir);
    extractor.extractFromTurn(
      makeTurn({ userMessage: 'I prefer TypeScript over JavaScript.', turnIndex: 0 }),
    );
    extractor.extractFromTurn(
      makeTurn({ userMessage: 'This project uses React 19.', turnIndex: 1 }),
    );
    extractor.extractFromTurn(
      makeTurn({ userMessage: 'The fix was adding an async guard.', turnIndex: 2 }),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns entries that match the query keyword', () => {
    const results = extractor.search('TypeScript');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content.toLowerCase()).toContain('typescript');
  });

  it('returns empty array for a query that matches nothing', () => {
    const results = extractor.search('Elixir Phoenix');
    expect(results).toHaveLength(0);
  });

  it('respects the limit parameter', () => {
    const results = extractor.search('the', 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('returns all entries for an empty query (up to limit)', () => {
    const results = extractor.search('', 100);
    expect(results.length).toBe(extractor.getAll().length);
  });
});

// ---------------------------------------------------------------------------
// prune
// ---------------------------------------------------------------------------

describe('AutoMemoryExtractor.prune', () => {
  let tmpDir: string;
  let extractor: AutoMemoryExtractor;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    extractor = new AutoMemoryExtractor(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('prunes entries older than maxAgeMs', () => {
    // Manually insert a very old entry
    const old: MemoryEntry = {
      id: 'old-entry',
      type: 'context',
      content: 'Context: this is old',
      source: { sessionId: 'test', turnIndex: 0 },
      createdAt: Date.now() - 100 * 24 * 60 * 60 * 1000, // 100 days ago
      relevance: 0.9,
    };
    // Access private entries via type assertion for test injection
    (extractor as unknown as { entries: MemoryEntry[] }).entries.push(old);

    const pruned = extractor.prune(30 * 24 * 60 * 60 * 1000, 0.1);
    expect(pruned).toBeGreaterThan(0);
    expect(extractor.getAll().find((e) => e.id === 'old-entry')).toBeUndefined();
  });

  it('prunes entries with relevance below minRelevance', () => {
    const weak: MemoryEntry = {
      id: 'weak-entry',
      type: 'preference',
      content: 'Preference: I prefer very old tools.',
      source: { sessionId: 'test', turnIndex: 0 },
      createdAt: Date.now() - 1000, // recent but relevance will decay to near zero
      relevance: 0.001,
    };
    (extractor as unknown as { entries: MemoryEntry[] }).entries.push(weak);

    const pruned = extractor.prune(30 * 24 * 60 * 60 * 1000, 0.01);
    expect(pruned).toBeGreaterThan(0);
    expect(extractor.getAll().find((e) => e.id === 'weak-entry')).toBeUndefined();
  });

  it('returns 0 and keeps entries when nothing qualifies for pruning', () => {
    extractor.extractFromTurn(
      makeTurn({ userMessage: 'I prefer Bun over Node.js.' }),
    );

    const pruned = extractor.prune(30 * 24 * 60 * 60 * 1000, 0.01);
    expect(pruned).toBe(0);
    expect(extractor.getAll().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

describe('getAutoMemoryExtractor singleton', () => {
  beforeEach(() => _resetAutoMemoryExtractorSingleton());
  afterEach(() => _resetAutoMemoryExtractorSingleton());

  it('returns the same instance on repeated calls', () => {
    const a = getAutoMemoryExtractor();
    const b = getAutoMemoryExtractor();
    expect(a).toBe(b);
  });

  it('returns a fresh instance after reset', () => {
    const a = getAutoMemoryExtractor();
    _resetAutoMemoryExtractorSingleton();
    const b = getAutoMemoryExtractor();
    expect(a).not.toBe(b);
  });
});
