import { describe, it, expect } from 'vitest';
import {
  inferFromToolUse,
  inferFromFilePath,
  inferActionFromTool,
  inferFromBashCommand,
  extractLinks,
  aggregateInferences,
} from '../rules.js';
import type { PostToolUsePayload } from '../../hooks/schemas.js';

describe('Rules Engine', () => {
  describe('inferFromFilePath', () => {
    it('should infer auth component from path', () => {
      const result = inferFromFilePath('/src/auth/login.ts');
      expect(result.component).toBe('authentication');
      expect(result.taskType).toBe('security');
    });

    it('should infer testing from test file', () => {
      const result = inferFromFilePath('/src/utils/helper.test.ts');
      expect(result.component).toBe('testing');
      expect(result.taskType).toBe('quality');
    });

    it('should infer api component', () => {
      const result = inferFromFilePath('/src/api/routes/users.ts');
      expect(result.component).toBe('api');
      expect(result.taskType).toBe('backend');
    });

    it('should infer database component', () => {
      const result = inferFromFilePath('/src/db/schema.ts');
      expect(result.component).toBe('database');
      expect(result.taskType).toBe('data');
    });

    it('should infer UI component', () => {
      const result = inferFromFilePath('/src/components/Button.tsx');
      expect(result.component).toBe('frontend');
      expect(result.taskType).toBe('ui');
    });

    it('should extract issue from branch pattern in path', () => {
      const result = inferFromFilePath('/feat-123/src/file.ts');
      expect(result.linkedIssue).toBe('123');
    });
  });

  describe('inferActionFromTool', () => {
    it('should return modify for Edit', () => {
      expect(inferActionFromTool('Edit')).toBe('modify');
    });

    it('should return create for Write', () => {
      expect(inferActionFromTool('Write')).toBe('create');
    });

    it('should return execute for Bash', () => {
      expect(inferActionFromTool('Bash')).toBe('execute');
    });

    it('should return undefined for unknown tool', () => {
      expect(inferActionFromTool('UnknownTool')).toBeUndefined();
    });
  });

  describe('inferFromBashCommand', () => {
    it('should extract commit message', () => {
      const result = inferFromBashCommand({
        command: 'git commit -m "feat: Add login feature"',
      });
      expect(result.commitMessage).toBe('feat: Add login feature');
      expect(result.taskType).toBe('commit');
    });

    it('should extract issue from commit message', () => {
      const result = inferFromBashCommand({
        command: 'git commit -m "fix: Resolve issue #42"',
      });
      expect(result.linkedIssue).toBe('42');
    });

    it('should detect push commands', () => {
      const result = inferFromBashCommand({
        command: 'git push origin main',
      });
      expect(result.taskType).toBe('push');
    });

    it('should detect test runs', () => {
      const result = inferFromBashCommand({
        command: 'pnpm test',
      });
      expect(result.taskType).toBe('testing');
    });

    it('should detect build commands', () => {
      const result = inferFromBashCommand({
        command: 'npm run build',
      });
      expect(result.taskType).toBe('build');
    });
  });

  describe('extractLinks', () => {
    it('should extract issue number from #123 pattern', () => {
      const result = extractLinks('Fixes #42 in the code');
      expect(result.linkedIssue).toBe('42');
    });

    it('should extract PR number', () => {
      const result = extractLinks('See PR #99 for details');
      expect(result.linkedPr).toBe('99');
    });

    it('should handle content without links', () => {
      const result = extractLinks('Regular text with no links');
      expect(result.linkedIssue).toBeUndefined();
      expect(result.linkedPr).toBeUndefined();
    });
  });

  describe('inferFromToolUse', () => {
    it('should infer from Edit tool payload', () => {
      const payload: PostToolUsePayload = {
        event: 'PostToolUse',
        tool: 'Edit',
        input: {
          file_path: '/src/auth/login.ts',
          old_string: 'function login()',
          new_string: 'async function login()',
        },
      };

      const result = inferFromToolUse(payload);
      expect(result.component).toBe('authentication');
      expect(result.taskType).toBe('security');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should infer from Bash git commit', () => {
      const payload: PostToolUsePayload = {
        event: 'PostToolUse',
        tool: 'Bash',
        input: {
          command: 'git commit -m "fix: Bug #123"',
        },
      };

      const result = inferFromToolUse(payload);
      expect(result.commitMessage).toBe('fix: Bug #123');
      expect(result.linkedIssue).toBe('123');
    });
  });

  describe('aggregateInferences', () => {
    it('should aggregate multiple inferences', () => {
      const inferences = [
        { taskType: 'auth', component: 'authentication', confidence: 0.5 },
        { taskType: 'auth', component: 'authentication', linkedIssue: '42', confidence: 0.7 },
        { taskType: 'modify', component: 'api', confidence: 0.3 },
      ];

      const result = aggregateInferences(inferences);
      expect(result.taskType).toBe('auth');
      expect(result.component).toBe('authentication');
      expect(result.linkedIssue).toBe('42');
    });

    it('should handle empty array', () => {
      const result = aggregateInferences([]);
      expect(result.confidence).toBe(0);
    });
  });
});
