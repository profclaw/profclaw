import { describe, it, expect } from 'vitest';
import { chunkText, estimateTokens, hashContent } from '../memory-service.js';

describe('Memory Service Utilities', () => {
  describe('estimateTokens', () => {
    it('should estimate tokens roughly (4 chars/token)', () => {
      expect(estimateTokens('1234')).toBe(1);
      expect(estimateTokens('12345678')).toBe(2);
      expect(estimateTokens('')).toBe(0);
    });
  });

  describe('hashContent', () => {
    it('should generate stable sha256 hash', () => {
      const h1 = hashContent('test');
      const h2 = hashContent('test');
      expect(h1).toBe(h2);
      expect(h1.length).toBe(64);
    });
  });

  describe('chunkText', () => {
    it('should split text into chunks based on token limits', () => {
      const text = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
      const config: any = {
        chunking: { tokens: 4, overlap: 0 } // Very small limit
      };
      
      const chunks = chunkText(text, config);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].startLine).toBe(1);
      expect(chunks[chunks.length - 1].text).toContain('Line 5');
    });

    it('should handle overlap', () => {
      const text = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
      const config: any = {
        chunking: { tokens: 4, overlap: 2 }
      };
      
      const chunks = chunkText(text, config);
      expect(chunks.length).toBeGreaterThan(1);
      // Check if subsequent chunk contains end of previous chunk
      if (chunks.length > 1) {
          const firstEnd = chunks[0].text.split('\n').pop();
          expect(chunks[1].text).toContain(firstEnd);
      }
    });
  });
});
