import { describe, it, expect } from 'vitest';
import { pingDockerWithTimeout } from '../sandbox.js';

describe('pingDockerWithTimeout', () => {
  it('resolves when the daemon answers', async () => {
    await expect(pingDockerWithTimeout({ ping: async () => 'OK' }, 500)).resolves.toBeUndefined();
  });

  it('rejects quickly when the daemon never answers', async () => {
    const started = Date.now();
    const wedged = { ping: (): Promise<unknown> => new Promise(() => undefined) };
    await expect(pingDockerWithTimeout(wedged, 50)).rejects.toThrow(/did not respond within 50ms/);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('passes through the daemon error when ping fails', async () => {
    const broken = { ping: async (): Promise<unknown> => { throw new Error('ECONNREFUSED'); } };
    await expect(pingDockerWithTimeout(broken, 500)).rejects.toThrow('ECONNREFUSED');
  });
});
