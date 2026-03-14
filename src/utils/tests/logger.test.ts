import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger, Logger } from '../logger.js';

describe('Logger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should log info messages', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    logger.info('test info');
    expect(spy).toHaveBeenCalled();
  });

  it('should log warn messages', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    logger.warn('test warn');
    expect(spy).toHaveBeenCalled();
  });

  it('should log error messages', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    logger.error('test error');
    expect(spy).toHaveBeenCalled();
  });

  it('should support stderr output', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const stderrLogger = new Logger({ stream: 'stderr' });

    stderrLogger.error('stderr only');

    expect(stderrSpy).toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
