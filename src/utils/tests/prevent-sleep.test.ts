import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SleepPreventer } from '../prevent-sleep.js';

// Mock child_process so we never actually spawn anything
vi.mock('child_process', () => {
  const mockKill = vi.fn();
  const mockUnref = vi.fn();
  const mockOn = vi.fn();

  const mockProcess = {
    kill: mockKill,
    unref: mockUnref,
    on: mockOn,
    pid: 99999,
  };

  return {
    spawn: vi.fn(() => mockProcess),
    __mockProcess: mockProcess,
  };
});

describe('SleepPreventer', () => {
  let preventer: SleepPreventer;

  beforeEach(() => {
    vi.clearAllMocks();
    preventer = new SleepPreventer();
  });

  afterEach(() => {
    preventer.stop();
  });

  it('starts inactive', () => {
    expect(preventer.isActive()).toBe(false);
  });

  it('becomes active after start() on macOS/linux', () => {
    const platform = process.platform;
    if (platform === 'win32') {
      // Windows is a no-op — stays inactive
      preventer.start();
      expect(preventer.isActive()).toBe(false);
    } else {
      preventer.start();
      expect(preventer.isActive()).toBe(true);
    }
  });

  it('becomes inactive after stop()', () => {
    preventer.start();
    preventer.stop();
    expect(preventer.isActive()).toBe(false);
  });

  it('calling start() multiple times is idempotent', async () => {
    const { spawn } = await import('child_process');
    const spawnMock = vi.mocked(spawn);

    preventer.start();
    preventer.start();
    preventer.start();

    const platform = process.platform;
    if (platform !== 'win32') {
      // spawn should be called exactly once despite 3 start() calls
      expect(spawnMock).toHaveBeenCalledTimes(1);
    }
  });

  it('calling stop() when not active is a no-op', () => {
    expect(() => preventer.stop()).not.toThrow();
    expect(preventer.isActive()).toBe(false);
  });

  it('can be restarted after stop()', () => {
    const platform = process.platform;
    if (platform === 'win32') return;

    preventer.start();
    expect(preventer.isActive()).toBe(true);

    preventer.stop();
    expect(preventer.isActive()).toBe(false);

    preventer.start();
    expect(preventer.isActive()).toBe(true);
  });

  it('kills the spawned process on stop()', async () => {
    const { __mockProcess } = await import('child_process') as unknown as {
      __mockProcess: { kill: ReturnType<typeof vi.fn> };
    };

    const platform = process.platform;
    if (platform === 'win32') return;

    preventer.start();
    preventer.stop();

    expect(__mockProcess.kill).toHaveBeenCalledTimes(1);
  });
});
