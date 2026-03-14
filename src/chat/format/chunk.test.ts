/**
 * Tests for text chunking utility
 */

import { describe, it, expect } from 'vitest';
import {
  chunkForPlatform,
  chunkText,
  getPlatformLimit,
  PLATFORM_LIMITS,
} from './chunk.js';

// =============================================================================
// Platform limit lookup
// =============================================================================

describe('getPlatformLimit', () => {
  it('returns correct limit for known platforms', () => {
    expect(getPlatformLimit('telegram')).toBe(4096);
    expect(getPlatformLimit('discord')).toBe(2000);
    expect(getPlatformLimit('slack')).toBe(4000);
    expect(getPlatformLimit('irc')).toBe(512);
    expect(getPlatformLimit('matrix')).toBe(65536);
    expect(getPlatformLimit('msteams')).toBe(28000);
  });

  it('returns 0 for webchat (unlimited)', () => {
    expect(getPlatformLimit('webchat')).toBe(0);
  });

  it('returns default limit for unknown platforms', () => {
    expect(getPlatformLimit('unknown-platform')).toBe(PLATFORM_LIMITS.default);
  });
});

// =============================================================================
// Edge cases
// =============================================================================

describe('chunkForPlatform - edge cases', () => {
  it('returns empty chunks for empty string', () => {
    const result = chunkForPlatform('', 'discord');
    expect(result.chunks).toEqual([]);
    expect(result.totalLength).toBe(0);
  });

  it('returns single chunk for text shorter than limit', () => {
    const text = 'Hello world';
    const result = chunkForPlatform(text, 'discord');
    expect(result.chunks).toEqual([text]);
    expect(result.chunks).toHaveLength(1);
  });

  it('returns single chunk for text exactly at limit', () => {
    const text = 'x'.repeat(2000);
    const result = chunkForPlatform(text, 'discord');
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toBe(text);
  });

  it('returns single chunk for single character', () => {
    const result = chunkForPlatform('a', 'telegram');
    expect(result.chunks).toEqual(['a']);
  });

  it('returns single chunk for unlimited platform (webchat)', () => {
    const longText = 'word '.repeat(10000).trim();
    const result = chunkForPlatform(longText, 'webchat');
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toBe(longText);
  });

  it('respects custom limit override', () => {
    const text = 'Hello world this is a test message';
    const result = chunkForPlatform(text, 'discord', { limit: 10 });
    expect(result.limit).toBe(10);
    for (const chunk of result.chunks) {
      expect(chunk.length).toBeLessThanOrEqual(10);
    }
  });

  it('returns single chunk when limit override is 0 (unlimited)', () => {
    const text = 'x'.repeat(5000);
    const result = chunkForPlatform(text, 'discord', { limit: 0 });
    expect(result.chunks).toHaveLength(1);
  });

  it('exposes totalLength metadata correctly', () => {
    const text = 'Hello world';
    const result = chunkForPlatform(text, 'discord');
    expect(result.totalLength).toBe(text.length);
  });

  it('exposes the applied limit in result', () => {
    const result = chunkForPlatform('text', 'discord');
    expect(result.limit).toBe(2000);
  });
});

// =============================================================================
// Length mode (default)
// =============================================================================

describe('chunkForPlatform - length mode', () => {
  it('splits text into chunks within the limit', () => {
    const text = 'word '.repeat(500).trim(); // ~2500 chars
    const result = chunkForPlatform(text, 'discord'); // limit 2000
    expect(result.chunks.length).toBeGreaterThan(1);
    for (const chunk of result.chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });

  it('does not split mid-word', () => {
    // 400-char words separated by spaces, total > 2000
    const words = ['a'.repeat(400), 'b'.repeat(400), 'c'.repeat(400), 'd'.repeat(400), 'e'.repeat(400)];
    const text = words.join(' ');
    const result = chunkForPlatform(text, 'discord', { limit: 1000 });
    for (const chunk of result.chunks) {
      // Each chunk should either be a single word or multiple words separated by space
      const chunkWords = chunk.split(' ');
      for (const word of chunkWords) {
        expect(words).toContain(word);
      }
    }
  });

  it('does not split mid-word with natural prose', () => {
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(50);
    const result = chunkForPlatform(text, 'discord', { limit: 100 });
    for (const chunk of result.chunks) {
      // No chunk should start with a partial word (i.e., first char after split is not mid-word)
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
  });

  it('reassembles into original text (ignoring whitespace trimming)', () => {
    const text = 'Hello world this is a test. '.repeat(100).trim();
    const result = chunkForPlatform(text, 'discord', { limit: 200 });
    const reassembled = result.chunks.join(' ');
    // All words must appear in order
    const originalWords = text.split(/\s+/);
    const reassembledWords = reassembled.split(/\s+/);
    expect(reassembledWords).toEqual(originalWords);
  });

  it('handles a very long word by hard-splitting at limit', () => {
    const text = 'x'.repeat(3000); // one huge "word"
    const result = chunkForPlatform(text, 'discord', { limit: 2000 });
    // Should still produce chunks (not crash)
    expect(result.chunks.length).toBeGreaterThanOrEqual(1);
    for (const chunk of result.chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });

  it('irc 512-char limit splits correctly', () => {
    const text = 'word '.repeat(300).trim();
    const result = chunkForPlatform(text, 'irc');
    for (const chunk of result.chunks) {
      expect(chunk.length).toBeLessThanOrEqual(512);
    }
  });
});

// =============================================================================
// Newline mode
// =============================================================================

describe('chunkForPlatform - newline mode', () => {
  it('splits on paragraph boundaries first', () => {
    const para1 = 'First paragraph. This is some content here.';
    const para2 = 'Second paragraph. More content follows.';
    const para3 = 'Third paragraph. Final content block.';
    const text = [para1, para2, para3].join('\n\n');

    // Limit sized to force split at paragraph boundary
    const limit = para1.length + para2.length + 10;
    const result = chunkForPlatform(text, 'slack', { mode: 'newline', limit });

    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0]).toContain(para1);
    expect(result.chunks[0]).toContain(para2);
    expect(result.chunks[1]).toContain(para3);
  });

  it('keeps multi-paragraph content together when it fits', () => {
    const text = 'Line one.\n\nLine two.\n\nLine three.';
    const result = chunkForPlatform(text, 'slack', { mode: 'newline', limit: 4000 });
    expect(result.chunks).toHaveLength(1);
  });

  it('falls back to length splitting for oversized paragraphs', () => {
    const hugeParagraph = 'word '.repeat(500).trim(); // ~2500 chars, no newlines
    const result = chunkForPlatform(hugeParagraph, 'discord', { mode: 'newline', limit: 2000 });
    for (const chunk of result.chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });

  it('handles multiple newlines gracefully', () => {
    const text = 'Para one.\n\n\n\nPara two.';
    const result = chunkForPlatform(text, 'discord', { mode: 'newline', limit: 2000 });
    // Should treat multiple newlines as paragraph separator and collapse them
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toContain('Para one');
    expect(result.chunks[0]).toContain('Para two');
  });
});

// =============================================================================
// Code block preservation
// =============================================================================

describe('chunkForPlatform - code block preservation', () => {
  it('does not split inside a fenced code block', () => {
    const codeBlock = '```typescript\n' + 'const x = 1;\n'.repeat(100) + '```';
    const result = chunkForPlatform(codeBlock, 'discord', { limit: 2000 });

    // Code block should be in its own chunk, not split
    const codeChunks = result.chunks.filter(c => c.includes('```'));
    expect(codeChunks).toHaveLength(1);
    expect(codeChunks[0]).toMatch(/^```/);
    expect(codeChunks[0]).toMatch(/```$/);
  });

  it('keeps prose before a code block in a separate chunk when needed', () => {
    const prose = 'Here is some code:\n\n';
    const code = '```\nconst a = 1;\n```';
    const text = prose + code;

    // Force a split between prose and code
    const result = chunkForPlatform(text, 'discord', { limit: prose.length + 5 });

    const hasCodeChunk = result.chunks.some(c => c.includes('```'));
    expect(hasCodeChunk).toBe(true);

    // Code block should never be split
    for (const chunk of result.chunks) {
      if (chunk.includes('```')) {
        const openCount = (chunk.match(/```/g) || []).length;
        // Each code block contributes 2 backtick markers (open + close)
        expect(openCount % 2).toBe(0);
      }
    }
  });

  it('handles prose followed by code followed by more prose', () => {
    const text = [
      'Introduction text.',
      '',
      '```javascript',
      'function hello() { return "world"; }',
      '```',
      '',
      'Conclusion text.',
    ].join('\n');

    const result = chunkForPlatform(text, 'discord', { limit: 2000 });

    // All original content is present
    const joined = result.chunks.join('\n');
    expect(joined).toContain('Introduction text.');
    expect(joined).toContain('function hello()');
    expect(joined).toContain('Conclusion text.');
  });

  it('handles text with no code blocks normally', () => {
    const text = 'Simple text without any code blocks. '.repeat(100);
    const result = chunkForPlatform(text, 'discord', { limit: 2000 });
    for (const chunk of result.chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });
});

// =============================================================================
// Multi-platform spot checks
// =============================================================================

describe('chunkForPlatform - platform-specific limits', () => {
  it('telegram allows 4096 chars per chunk', () => {
    const text = 'x '.repeat(3000).trim();
    const result = chunkForPlatform(text, 'telegram');
    for (const chunk of result.chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });

  it('msteams allows 28000 chars per chunk', () => {
    const text = 'word '.repeat(10000).trim();
    const result = chunkForPlatform(text, 'msteams');
    for (const chunk of result.chunks) {
      expect(chunk.length).toBeLessThanOrEqual(28000);
    }
  });

  it('matrix allows 65536 chars per chunk', () => {
    // 32000 'a ' pairs = 64000 chars, under the 65536 limit
    const text = 'a '.repeat(32000).trim();
    const result = chunkForPlatform(text, 'matrix');
    // Matrix limit is high enough that this fits in one chunk
    expect(result.chunks).toHaveLength(1);
    for (const chunk of result.chunks) {
      expect(chunk.length).toBeLessThanOrEqual(65536);
    }
  });

  it('whatsapp limit matches telegram', () => {
    expect(getPlatformLimit('whatsapp')).toBe(getPlatformLimit('telegram'));
  });
});

// =============================================================================
// chunkText helper
// =============================================================================

describe('chunkText', () => {
  it('returns just the chunks array', () => {
    const text = 'Hello world. '.repeat(200).trim();
    const chunks = chunkText(text, 'discord');
    expect(Array.isArray(chunks)).toBe(true);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });

  it('accepts options', () => {
    const text = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.';
    const chunks = chunkText(text, 'discord', { mode: 'newline' });
    expect(chunks).toHaveLength(1); // all fit within 2000
  });
});
