import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('fs');

// Provide a stable import.meta.url for the module under test
vi.mock('../auto-update.js', async (importOriginal) => {
  return await importOriginal();
});

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('checkForUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Simulate no cache file by default
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) => {
      const filePath = String(p);
      if (filePath.endsWith('package.json')) {
        return JSON.stringify({ name: 'profclaw', version: '2.0.0' });
      }
      throw new Error('ENOENT');
    });
    (fs.mkdirSync as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (fs.writeFileSync as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
  });

  it('returns updateAvailable=true when registry has a newer version', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ version: '2.1.0' }));

    const { checkForUpdate } = await import('../auto-update.js');
    const info = await checkForUpdate('profclaw');

    expect(info.updateAvailable).toBe(true);
    expect(info.latestVersion).toBe('2.1.0');
    expect(info.currentVersion).toBe('2.0.0');
  });

  it('returns updateAvailable=false when already on latest', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ version: '2.0.0' }));

    const { checkForUpdate } = await import('../auto-update.js');
    const info = await checkForUpdate('profclaw');

    expect(info.updateAvailable).toBe(false);
  });

  it('returns updateAvailable=false when registry request fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { checkForUpdate } = await import('../auto-update.js');
    const info = await checkForUpdate('profclaw');

    expect(info.updateAvailable).toBe(false);
    expect(info.currentVersion).toBe('2.0.0');
  });

  it('serves from cache when within 24h TTL', async () => {
    const cachedInfo = {
      currentVersion: '2.0.0',
      latestVersion: '2.2.0',
      updateAvailable: true,
      releaseUrl: 'https://www.npmjs.com/package/profclaw/v/2.2.0',
    };
    const cache = { checkedAt: Date.now() - 1000, info: cachedInfo };

    (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) => {
      const filePath = String(p);
      if (filePath.endsWith('update-check.json')) {
        return JSON.stringify(cache);
      }
      if (filePath.endsWith('package.json')) {
        return JSON.stringify({ name: 'profclaw', version: '2.0.0' });
      }
      throw new Error('ENOENT');
    });

    const { checkForUpdate } = await import('../auto-update.js');
    const info = await checkForUpdate('profclaw');

    // fetch should NOT be called — cache is still fresh
    expect(mockFetch).not.toHaveBeenCalled();
    expect(info.latestVersion).toBe('2.2.0');
    expect(info.updateAvailable).toBe(true);
  });

  it('refetches when cache is older than 24h', async () => {
    const staleCache = {
      checkedAt: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
      info: {
        currentVersion: '2.0.0',
        latestVersion: '2.0.0',
        updateAvailable: false,
      },
    };

    (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) => {
      const filePath = String(p);
      if (filePath.endsWith('update-check.json')) {
        return JSON.stringify(staleCache);
      }
      if (filePath.endsWith('package.json')) {
        return JSON.stringify({ name: 'profclaw', version: '2.0.0' });
      }
      throw new Error('ENOENT');
    });

    mockFetch.mockResolvedValueOnce(makeJsonResponse({ version: '2.3.0' }));

    const { checkForUpdate } = await import('../auto-update.js');
    const info = await checkForUpdate('profclaw');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(info.latestVersion).toBe('2.3.0');
    expect(info.updateAvailable).toBe(true);
  });
});

describe('formatUpdateMessage', () => {
  it('returns empty string when no update available', async () => {
    const { formatUpdateMessage } = await import('../auto-update.js');
    const msg = formatUpdateMessage({
      currentVersion: '2.0.0',
      latestVersion: '2.0.0',
      updateAvailable: false,
    });
    expect(msg).toBe('');
  });

  it('includes current and latest version in the message', async () => {
    const { formatUpdateMessage } = await import('../auto-update.js');
    const msg = formatUpdateMessage({
      currentVersion: '2.0.0',
      latestVersion: '2.1.0',
      updateAvailable: true,
    });
    expect(msg).toContain('2.0.0');
    expect(msg).toContain('2.1.0');
    expect(msg).toContain('npm i -g');
  });

  it('includes release URL when provided', async () => {
    const { formatUpdateMessage } = await import('../auto-update.js');
    const msg = formatUpdateMessage({
      currentVersion: '2.0.0',
      latestVersion: '2.1.0',
      updateAvailable: true,
      releaseUrl: 'https://www.npmjs.com/package/profclaw/v/2.1.0',
    });
    expect(msg).toContain('npmjs.com');
  });
});
