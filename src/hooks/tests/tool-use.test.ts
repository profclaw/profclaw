import { describe, it, expect, beforeEach } from 'vitest';
import {
  PostToolUsePayloadSchema,
  SessionEndPayloadSchema,
  type PostToolUsePayload,
  type SessionEndPayload,
} from '../schemas.js';

describe('Hook Schemas', () => {
  describe('PostToolUsePayloadSchema', () => {
    it('should validate Edit tool payload', () => {
      const payload = {
        event: 'PostToolUse',
        tool: 'Edit',
        input: {
          file_path: '/src/file.ts',
          old_string: 'old',
          new_string: 'new',
        },
        session_id: 'test-session',
        timestamp: '2026-02-01T12:00:00Z',
      };

      const result = PostToolUsePayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tool).toBe('Edit');
        expect(result.data.event).toBe('PostToolUse');
      }
    });

    it('should validate Bash tool payload', () => {
      const payload = {
        event: 'PostToolUse',
        tool: 'Bash',
        input: {
          command: 'git status',
          description: 'Check git status',
        },
      };

      const result = PostToolUsePayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should validate Write tool payload', () => {
      const payload = {
        event: 'PostToolUse',
        tool: 'Write',
        input: {
          file_path: '/src/new-file.ts',
          content: 'export const foo = 1;',
        },
      };

      const result = PostToolUsePayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should reject invalid event type', () => {
      const payload = {
        event: 'InvalidEvent',
        tool: 'Edit',
        input: {},
      };

      const result = PostToolUsePayloadSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('should accept unknown tools with generic input', () => {
      const payload = {
        event: 'PostToolUse',
        tool: 'CustomTool',
        input: {
          custom_field: 'value',
        },
      };

      const result = PostToolUsePayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });

  describe('SessionEndPayloadSchema', () => {
    it('should validate session end payload', () => {
      const payload: SessionEndPayload = {
        event: 'Stop',
        session_id: 'test-session',
        reason: 'completed',
        summary: 'Task completed successfully',
        files_changed: ['/src/file.ts'],
        duration_ms: 5000,
        timestamp: '2026-02-01T12:00:00Z',
      };

      const result = SessionEndPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.reason).toBe('completed');
      }
    });

    it('should accept minimal session end payload', () => {
      const payload = {
        event: 'Stop',
      };

      const result = SessionEndPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should validate reason enum', () => {
      const validReasons = ['completed', 'cancelled', 'error', 'timeout'];

      for (const reason of validReasons) {
        const payload = {
          event: 'Stop',
          reason,
        };
        const result = SessionEndPayloadSchema.safeParse(payload);
        expect(result.success).toBe(true);
      }
    });
  });
});
