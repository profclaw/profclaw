import { describe, it, expect } from 'vitest';
import * as net from 'net';
import { checkPortAvailable, resolvePort } from '../commands/serve.js';

function createBlockingServer(port: number): Promise<net.Server> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('Port conflict handling', () => {
  describe('checkPortAvailable', () => {
    it('returns true when the port is free', async () => {
      const available = await checkPortAvailable(49200);
      expect(available).toBe(true);
    });

    it('returns false when the port is already bound', async () => {
      const server = await createBlockingServer(49201);
      try {
        const available = await checkPortAvailable(49201);
        expect(available).toBe(false);
      } finally {
        await closeServer(server);
      }
    });
  });

  describe('resolvePort', () => {
    it('returns the requested port when it is free', async () => {
      const actual = await resolvePort(49210);
      expect(actual).toBe(49210);
    });

    it('returns port+1 when the first port is occupied', async () => {
      const base = 49220;
      const server = await createBlockingServer(base);
      try {
        const actual = await resolvePort(base);
        expect(actual).toBe(base + 1);
      } finally {
        await closeServer(server);
      }
    });

    it('returns null when all 3 candidate ports are occupied', async () => {
      const base = 49230;
      const servers: net.Server[] = [];

      for (let i = 0; i < 3; i++) {
        servers.push(await createBlockingServer(base + i));
      }

      try {
        const actual = await resolvePort(base);
        expect(actual).toBeNull();
      } finally {
        await Promise.all(servers.map(closeServer));
      }
    });
  });
});
