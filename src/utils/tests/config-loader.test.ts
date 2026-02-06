import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConfig } from '../config-loader.js';
import fs from 'fs';

vi.mock('fs');
// Mock logger to avoid pollution
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}));

describe('Config Loader', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should load and parse YAML config', () => {
    const mockYaml = 'key: value\nnumber: 123';
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(mockYaml);

    const config = loadConfig<{ key: string; number: number }>('test.yml');
    expect(config.key).toBe('value');
    expect(config.number).toBe(123);
  });

  it('should interpolate environment variables', () => {
    process.env.TEST_VAR = 'env-value';
    const mockYaml = 'key: ${TEST_VAR}\ndefault: ${MISSING:-fallback}';
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(mockYaml);

    const config = loadConfig<{ key: string; default: string }>('test.yml');
    expect(config.key).toBe('env-value');
    expect(config.default).toBe('fallback');
    
    delete process.env.TEST_VAR;
  });

  it('should interpolate environment variables with empty default', () => {
    const mockYaml = 'key: ${MISSING}';
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(mockYaml);

    const config = loadConfig<{ key: string }>('test.yml');
    // YAML parses "key: " as null
    expect(config.key).toBe(null);
  });

  it('should return empty object if file not found', () => {
    (fs.existsSync as any).mockReturnValue(false);
    const config = loadConfig('missing.yml');
    expect(config).toEqual({});
  });

  it('should return empty object on parse error', () => {
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue('invalid: yaml: :'); // Invalid YAML

    const config = loadConfig('error.yml');
    expect(config).toEqual({});
  });
});
