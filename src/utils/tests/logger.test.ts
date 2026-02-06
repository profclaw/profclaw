import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger } from '../logger.js';

describe('Logger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should log info messages', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('test info');
    expect(spy).toHaveBeenCalled();
  });

  it('should log warn messages', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.warn('test warn');
    expect(spy).toHaveBeenCalled();
  });

  it('should log error messages', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.error('test error');
    expect(spy).toHaveBeenCalled();
  });
});
