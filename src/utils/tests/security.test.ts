import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  sanitizeString,
  sanitizeFilename,
  validateFileUpload,
  validateUrl,
  redactSensitive,
  isSafeRedirectUrl,
  validateCommand,
  ALLOWED_SCRIPT_COMMANDS,
  FILE_SIZE_LIMITS,
} from '../security.js';

describe('security utilities', () => {
  describe('escapeHtml', () => {
    it('escapes HTML special characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;'
      );
    });

    it('escapes ampersands', () => {
      expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    it('handles empty strings', () => {
      expect(escapeHtml('')).toBe('');
    });

    it('preserves safe characters', () => {
      expect(escapeHtml('Hello, World!')).toBe('Hello, World!');
    });
  });

  describe('sanitizeString', () => {
    it('removes control characters', () => {
      expect(sanitizeString('hello\x00world')).toBe('helloworld');
    });

    it('escapes HTML by default', () => {
      expect(sanitizeString('<b>bold</b>')).toBe('&lt;b&gt;bold&lt;&#x2F;b&gt;');
    });

    it('allows HTML when specified', () => {
      expect(sanitizeString('<b>bold</b>', { allowHtml: true })).toBe('<b>bold</b>');
    });

    it('truncates to max length', () => {
      expect(sanitizeString('hello world', { maxLength: 5 })).toBe('hello');
    });

    it('preserves newlines when allowed', () => {
      expect(sanitizeString('line1\nline2', { allowNewlines: true })).toContain('\n');
    });

    it('removes newlines by default', () => {
      expect(sanitizeString('line1\nline2')).not.toContain('\n');
    });
  });

  describe('sanitizeFilename', () => {
    it('removes path separators', () => {
      expect(sanitizeFilename('../../../etc/passwd')).toBe('etc/passwd'.replace(/\//g, ''));
    });

    it('removes leading dots', () => {
      expect(sanitizeFilename('...hidden')).toBe('hidden');
    });

    it('removes dangerous characters', () => {
      expect(sanitizeFilename('file<name>.txt')).toBe('filename.txt');
    });

    it('handles empty result', () => {
      expect(sanitizeFilename('...')).toBe('unnamed_file');
    });

    it('limits length while preserving extension', () => {
      const longName = 'a'.repeat(300) + '.txt';
      const result = sanitizeFilename(longName);
      expect(result.length).toBeLessThanOrEqual(255);
      expect(result).toMatch(/\.txt$/);
    });
  });

  describe('validateFileUpload', () => {
    it('validates file size within limits', () => {
      const result = validateFileUpload(
        { fileName: 'test.txt', fileSize: 1024 },
        { category: 'attachment' }
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects files exceeding size limit', () => {
      const result = validateFileUpload(
        { fileName: 'huge.txt', fileSize: 100 * 1024 * 1024 }, // 100MB
        { category: 'attachment' }
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('exceeds maximum');
    });

    it('uses custom max size', () => {
      const result = validateFileUpload(
        { fileName: 'small.txt', fileSize: 1024 },
        { maxSize: 512 }
      );
      expect(result.valid).toBe(false);
    });

    it('validates allowed file types', () => {
      const result = validateFileUpload(
        { fileName: 'script.exe', fileType: 'application/x-executable' },
        { allowedTypes: ['image/png', 'image/jpeg'] }
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('not allowed');
    });

    it('detects invalid filename characters', () => {
      const result = validateFileUpload(
        { fileName: '../../../etc/passwd' }
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('invalid characters');
    });
  });

  describe('validateUrl', () => {
    it('accepts valid HTTPS URLs', () => {
      const result = validateUrl('https://example.com/path');
      expect(result.valid).toBe(true);
    });

    it('rejects javascript: protocol', () => {
      const result = validateUrl('javascript:alert(1)');
      expect(result.valid).toBe(false);
    });

    it('blocks localhost by default', () => {
      const result = validateUrl('http://localhost:3000');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Internal');
    });

    it('blocks private IP ranges', () => {
      expect(validateUrl('http://192.168.1.1').valid).toBe(false);
      expect(validateUrl('http://10.0.0.1').valid).toBe(false);
      expect(validateUrl('http://172.16.0.1').valid).toBe(false);
    });

    it('allows localhost when explicitly permitted', () => {
      const result = validateUrl('http://localhost:3000', { blockLocalhost: false });
      expect(result.valid).toBe(true);
    });

    it('enforces allowed hosts list', () => {
      const result = validateUrl('https://evil.com', {
        allowedHosts: ['example.com', 'trusted.org'],
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('redactSensitive', () => {
    it('redacts password fields', () => {
      const obj = { username: 'user', password: 'secret123' };
      const result = redactSensitive(obj);
      expect(result.username).toBe('user');
      expect(result.password).toBe('[REDACTED]');
    });

    it('redacts token fields', () => {
      const obj = { apiKey: 'abc123', accessToken: 'xyz789' };
      const result = redactSensitive(obj);
      expect(result.apiKey).toBe('[REDACTED]');
      expect(result.accessToken).toBe('[REDACTED]');
    });

    it('handles nested objects', () => {
      // Note: 'credentials' is a sensitive key, so use 'auth' instead
      const obj = {
        user: { name: 'John', auth: { password: 'secret' } },
      };
      const result = redactSensitive(obj);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyResult = result as any;
      expect(anyResult.user.name).toBe('John');
      expect(anyResult.user.auth.password).toBe('[REDACTED]');
    });

    it('handles arrays', () => {
      const obj = { tokens: [{ token: 'abc' }, { token: 'def' }] };
      const result = redactSensitive(obj);
      expect(result.tokens[0].token).toBe('[REDACTED]');
      expect(result.tokens[1].token).toBe('[REDACTED]');
    });

    it('truncates long strings that look like tokens', () => {
      const obj = { data: 'abcdefghijklmnopqrstuvwxyz123456' };
      const result = redactSensitive(obj);
      expect(result.data).toContain('[REDACTED]');
      expect(result.data).toMatch(/^[a-z]{8}\.\.\.\[REDACTED\]$/);
    });

    it('preserves null and undefined', () => {
      const obj = { a: null, b: undefined };
      const result = redactSensitive(obj);
      expect(result.a).toBeNull();
      expect(result.b).toBeUndefined();
    });

    it('accepts additional sensitive keys', () => {
      const obj = { customSecret: 'hidden' };
      const result = redactSensitive(obj, ['customSecret']);
      expect(result.customSecret).toBe('[REDACTED]');
    });
  });

  describe('FILE_SIZE_LIMITS', () => {
    it('has correct values', () => {
      expect(FILE_SIZE_LIMITS.image).toBe(10 * 1024 * 1024);
      expect(FILE_SIZE_LIMITS.document).toBe(25 * 1024 * 1024);
      expect(FILE_SIZE_LIMITS.attachment).toBe(50 * 1024 * 1024);
      expect(FILE_SIZE_LIMITS.avatar).toBe(2 * 1024 * 1024);
    });
  });

  describe('isSafeRedirectUrl', () => {
    it('allows relative paths starting with /', () => {
      expect(isSafeRedirectUrl('/dashboard', 'https://example.com')).toBe(true);
      expect(isSafeRedirectUrl('/settings/profile', 'https://example.com')).toBe(true);
    });

    it('blocks protocol-relative URLs (//)', () => {
      expect(isSafeRedirectUrl('//evil.com', 'https://example.com')).toBe(false);
    });

    it('allows same-origin absolute URLs', () => {
      expect(isSafeRedirectUrl('https://example.com/page', 'https://example.com/other')).toBe(true);
    });

    it('blocks external redirects', () => {
      expect(isSafeRedirectUrl('https://evil.com', 'https://example.com')).toBe(false);
      expect(isSafeRedirectUrl('http://malicious.org', 'https://example.com')).toBe(false);
    });

    it('handles edge cases correctly', () => {
      // Relative paths are always safe (same-origin by definition)
      expect(isSafeRedirectUrl('/valid/path', 'invalid-base')).toBe(true);
      // But if the base URL is truly invalid and redirect is not relative, it fails
      expect(isSafeRedirectUrl('https://external.com/page', 'invalid-origin')).toBe(false);
    });
  });

  describe('validateCommand', () => {
    it('allows commands in the allowlist', () => {
      const result = validateCommand('node', ['script.js']);
      expect(result.valid).toBe(true);
      expect(result.sanitizedCommand).toBe('node');
    });

    it('rejects commands not in allowlist', () => {
      const result = validateCommand('rm', ['-rf', '/']);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not in the allowlist');
    });

    it('rejects shell injection attempts', () => {
      expect(validateCommand('node; rm -rf /', []).valid).toBe(false);
      expect(validateCommand('node', ['$(whoami)']).valid).toBe(false);
      expect(validateCommand('node', ['`id`']).valid).toBe(false);
      expect(validateCommand('node', ['arg && rm -rf /']).valid).toBe(false);
    });

    it('rejects commands with pipe operators', () => {
      expect(validateCommand('node', ['| cat /etc/passwd']).valid).toBe(false);
    });

    it('allows safe arguments', () => {
      const result = validateCommand('npm', ['run', 'build']);
      expect(result.valid).toBe(true);
      expect(result.sanitizedArgs).toEqual(['run', 'build']);
    });

    it('handles path-based commands', () => {
      const result = validateCommand('/usr/bin/node', ['script.js']);
      expect(result.valid).toBe(true);
    });

    it('has expected commands in allowlist', () => {
      expect(ALLOWED_SCRIPT_COMMANDS.has('node')).toBe(true);
      expect(ALLOWED_SCRIPT_COMMANDS.has('npm')).toBe(true);
      expect(ALLOWED_SCRIPT_COMMANDS.has('git')).toBe(true);
      expect(ALLOWED_SCRIPT_COMMANDS.has('curl')).toBe(true);
      expect(ALLOWED_SCRIPT_COMMANDS.has('rm')).toBe(false);
      expect(ALLOWED_SCRIPT_COMMANDS.has('sudo')).toBe(false);
    });
  });
});
