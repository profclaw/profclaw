import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractFromTaskResult, inferTaskType, inferComponent, extractFromRawOutput, extractFromSession } from '../extractor.js';
import { getSettings } from '../../settings/index.js';
import { getOllamaService } from '../../intelligence/ollama.js';

// Mock settings and ollama
vi.mock('../../settings/index.js', () => ({
  getSettings: vi.fn().mockResolvedValue({
    aiProvider: { defaultProvider: 'pattern' }
  })
}));

// Mock ollama module
vi.mock('../../intelligence/ollama.js', () => ({
  getOllamaService: vi.fn(() => ({
    generateSummary: vi.fn(async () => ({
      title: 'Ollama Summary',
      whatChanged: 'Ollama details',
      filesChanged: [],
      artifacts: [],
      decisions: [],
      blockers: []
    }))
  }))
}));

const mockGetSettings = vi.mocked(getSettings);

describe('Summary Extractor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default to pattern extraction
    mockGetSettings.mockResolvedValue({ aiProvider: { defaultProvider: 'pattern' } } as any);
  });

  describe('Pattern Extraction', () => {
    it('should extract file changes from text', async () => {
      const output = 'I created index.ts and modified server.js. Also deleted old.txt';
      const result = { success: true, output } as any;
      
      const summary = await extractFromTaskResult(result);
      
      expect(summary.filesChanged).toContainEqual({ path: 'index.ts', action: 'created' });
      expect(summary.filesChanged).toContainEqual({ path: 'server.js', action: 'modified' });
      expect(summary.filesChanged).toContainEqual({ path: 'old.txt', action: 'deleted' });
    });

    it('should extract decisions and blockers', async () => {
      const output = 'I decided to use Vitest for testing. However, I encountered an error: network timeout.';
      const result = { success: true, output } as any;

      const summary = await extractFromTaskResult(result);

      expect(summary.decisions).toContainEqual({ description: 'use Vitest for testing' });
      expect(summary.blockers).toContainEqual(expect.objectContaining({
        description: 'network timeout',
        severity: 'error'
      }));
    });

    it('should extract artifacts like PRs and commits', async () => {
      const output = 'PR created: https://github.com/owner/repo/pull/123. Commit: a1b2c3d';
      const result = { success: true, output } as any;

      const summary = await extractFromTaskResult(result);

      expect(summary.artifacts).toContainEqual(expect.objectContaining({ type: 'pull_request', identifier: '123' }));
      expect(summary.artifacts).toContainEqual(expect.objectContaining({ type: 'commit', identifier: 'a1b2c3d' }));
    });
  });

  describe('Inference', () => {
    it('should infer task type from keywords', () => {
      expect(inferTaskType('Fix a critical bug in the auth flow', [])).toBe('bug_fix');
      expect(inferTaskType('Add a new feature for user profiles', [])).toBe('feature');
      expect(inferTaskType('Refactor the storage layer', [])).toBe('refactor');
      expect(inferTaskType('Write documentation for the API', [])).toBe('documentation');
    });

    it('should infer component from file paths', () => {
      const files = [
        { path: 'src/ui/Button.tsx', action: 'created' as const },
        { path: 'src/ui/Card.tsx', action: 'modified' as const }
      ];
      expect(inferComponent(files)).toBe('ui');

      const apiFiles = [{ path: 'src/api/users.ts', action: 'modified' as const }];
      expect(inferComponent(apiFiles)).toBe('api');
    });
  });

  describe('Smart Title Generation', () => {
    it('should generate title for single file', async () => {
        const output = 'Created Button.tsx';
        const result = { success: true, output } as any;
        const summary = await extractFromTaskResult(result);
        expect(summary.title).toBe('Add Button');
    });

    it('should generate title for multiple files in same directory', async () => {
        const output = 'modified src/ui/Button.tsx and modified src/ui/Card.tsx';
        const result = { success: true, output } as any;
        const summary = await extractFromTaskResult(result);
        expect(summary.title).toBe('Add ui (2 files)');
    });

    it('should handle extension-only files', async () => {
        const output = 'Updated .gitignore';
        const result = { success: true, output } as any;
        const summary = await extractFromTaskResult(result);
        expect(summary.title).toBe('Update .gitignore');
    });

    it('should fallback to PR identifier', async () => {
        const output = 'Completed work. PR: https://github.com/owner/repo/pull/456';
        const result = { success: true, output } as any;
        const summary = await extractFromTaskResult(result);
        expect(summary.title).toBe('Create PR #456');
    });
  });

  describe('Session Extraction', () => {
    it('should extract from session aggregate', () => {
      const session = {
        sessionId: 'session-123',
        startTime: new Date('2025-01-01T10:00:00Z'),
        endTime: new Date('2025-01-01T10:05:00Z'),
        filesCreated: ['src/new.ts'],
        filesModified: ['src/old.ts'],
        commands: [],
        toolCalls: []
      } as any;

      const inference = {
        taskType: 'feature' as const,
        component: 'api',
        commitMessage: 'Add new endpoint',
        confidence: 0.9,
      };

      const summary = extractFromSession(session, inference);
      expect(summary.sessionId).toBe('session-123');
      expect(summary.title).toBe('Add new endpoint');
      expect(summary.filesChanged.length).toBe(2);
    });
  });

  describe('Ollama Provider', () => {
    it('should use Ollama if configured', async () => {
      mockGetSettings.mockResolvedValue({ aiProvider: { defaultProvider: 'ollama' } } as any);

      const result = { success: true, output: 'test' } as any;
      const summary = await extractFromTaskResult(result);
      
      expect(summary.title).toBe('Ollama Summary');
    });
  });

  it('should extract JIRA and Linear issues', async () => {
    const output = 'Fixed PROJ-123 and updated LIN-456';
    const result = { success: true, output } as any;
    const summary = await extractFromTaskResult(result);
    
    expect(summary.artifacts).toBeDefined();
    expect(summary.artifacts).toContainEqual(expect.objectContaining({ identifier: 'PROJ-123' }));
    expect(summary.artifacts).toContainEqual(expect.objectContaining({ identifier: 'LIN-456' }));
    expect(summary.linkedIssue).toBe('PROJ-123');
  });

  it('should extract from raw output directly', () => {
      const output = 'I changed index.ts';
      const summary = extractFromRawOutput(output, { agent: 'test' });
      expect(summary.agent).toBe('test');
      expect(summary.filesChanged[0].path).toBe('index.ts');
  });
});
