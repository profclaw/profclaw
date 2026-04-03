import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  createContextualLogger: vi.fn(() => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  })),
}));

vi.mock('../../memory/experience-store.js', () => ({
  recordExperience: vi.fn(() => Promise.resolve('mock-id')),
}));

import { importFrom, listImportSources } from '../commands/import.js';

describe('Import/Migration CLI', () => {
  describe('listImportSources', () => {
    it('returns all supported import sources', () => {
      const sources = listImportSources();
      expect(sources).toHaveLength(3);
      expect(sources.map(s => s.source)).toEqual(['openclaw', 'chatgpt', 'aider']);
    });

    it('each source has required fields', () => {
      const sources = listImportSources();
      for (const source of sources) {
        expect(source.description).toBeTruthy();
        expect(source.defaultPath).toBeTruthy();
        expect(source.format).toBeTruthy();
      }
    });
  });

  describe('importFrom', () => {
    it('handles missing OpenClaw path gracefully', async () => {
      const result = await importFrom('openclaw', { path: '/nonexistent/path', dryRun: true });
      expect(result.source).toBe('openclaw');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('handles missing ChatGPT file gracefully', async () => {
      const result = await importFrom('chatgpt', { dryRun: true });
      expect(result.source).toBe('chatgpt');
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('handles missing Aider history gracefully', async () => {
      const result = await importFrom('aider', { path: '/nonexistent', dryRun: true });
      expect(result.source).toBe('aider');
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('returns structured result with all fields', async () => {
      const result = await importFrom('openclaw', { path: '/tmp/test', dryRun: true });
      expect(result).toHaveProperty('source');
      expect(result).toHaveProperty('memories');
      expect(result).toHaveProperty('conversations');
      expect(result).toHaveProperty('skills');
      expect(result).toHaveProperty('preferences');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('duration');
    });

    it('dry run does not persist data', async () => {
      const { recordExperience } = await import('../../memory/experience-store.js');
      const result = await importFrom('openclaw', { path: '/tmp/test', dryRun: true });
      expect(result.source).toBe('openclaw');
      // In dry run, recordExperience should NOT be called
      expect(recordExperience).not.toHaveBeenCalled();
    });
  });
});
