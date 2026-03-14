import { describe, it, expect, beforeEach } from 'vitest';
import { AuditScanner } from '../audit-scanner.js';

describe('AuditScanner', () => {
  let scanner: AuditScanner;

  beforeEach(() => {
    scanner = new AuditScanner();
  });

  describe('scanSkill()', () => {
    it('detects eval() usage', () => {
      const result = scanner.scanSkill('const result = eval("code")', 'test-skill');
      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.findings[0].risk).toBe('CRITICAL');
    });

    it('detects child_process usage', () => {
      const result = scanner.scanSkill(
        'const { exec } = require("child_process")',
        'test-skill',
      );
      expect(result.findings.length).toBeGreaterThan(0);
    });

    it('detects exec() calls', () => {
      const result = scanner.scanSkill('exec("rm -rf /")', 'test-skill');
      expect(result.riskLevel).toBe('CRITICAL');
    });

    it('detects network access (fetch)', () => {
      const result = scanner.scanSkill(
        'const data = await fetch("http://evil.com")',
        'test-skill',
      );
      expect(result.findings.length).toBeGreaterThan(0);
    });

    it('detects environment variable access', () => {
      const result = scanner.scanSkill(
        'const key = process.env.SECRET_KEY',
        'test-skill',
      );
      expect(result.findings.length).toBeGreaterThan(0);
    });

    it('detects prototype pollution', () => {
      const result = scanner.scanSkill(
        'obj.__proto__.polluted = true',
        'test-skill',
      );
      expect(result.riskLevel).toBe('CRITICAL');
    });

    it('detects filesystem deletion', () => {
      const result = scanner.scanSkill(
        'fs.unlinkSync("/important/file")',
        'test-skill',
      );
      expect(result.findings.some((f) => f.description.includes('deletion'))).toBe(true);
    });

    it('returns LOW risk for safe content', () => {
      const result = scanner.scanSkill(
        'const x = 1 + 2;\nconsole.log(x);',
        'safe-skill',
      );
      expect(result.findings.length).toBe(0);
      expect(result.riskLevel).toBe('LOW');
    });

    it('reports correct line numbers', () => {
      const content = 'line1\nline2\neval("bad")\nline4';
      const result = scanner.scanSkill(content, 'test-skill');
      const evalFinding = result.findings.find((f) => f.description.includes('eval'));
      expect(evalFinding?.line).toBe(3);
    });

    it('includes scan timestamp', () => {
      const before = Date.now();
      const result = scanner.scanSkill('safe code', 'test');
      expect(result.scannedAt).toBeGreaterThanOrEqual(before);
    });
  });

  describe('validateConfig()', () => {
    it('warns about full security mode', () => {
      const result = scanner.validateConfig({ securityMode: 'full' });
      expect(result.valid).toBe(false);
      expect(result.warnings.some((w) => w.risk === 'CRITICAL')).toBe(true);
    });

    it('warns about disabled sandbox', () => {
      const result = scanner.validateConfig({ enableSandbox: false });
      expect(result.warnings.some((w) => w.field === 'enableSandbox')).toBe(true);
    });

    it('warns about missing auth token', () => {
      const result = scanner.validateConfig({});
      expect(result.warnings.some((w) => w.field === 'authToken')).toBe(true);
    });

    it('warns about high pool timeout', () => {
      const result = scanner.validateConfig({ POOL_TIMEOUT_MS: 900_000, authToken: 'x' });
      expect(result.warnings.some((w) => w.field === 'POOL_TIMEOUT_MS')).toBe(true);
    });

    it('returns valid for secure config', () => {
      const result = scanner.validateConfig({
        securityMode: 'allowlist',
        enableSandbox: true,
        authToken: 'test-token',
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('disabled scanner', () => {
    it('returns empty findings when disabled', () => {
      const disabled = new AuditScanner({ enabled: false });
      const result = disabled.scanSkill('eval("bad")', 'test');
      expect(result.findings.length).toBe(0);
    });
  });
});
