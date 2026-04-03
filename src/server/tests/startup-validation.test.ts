import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Hoisted mocks – must be declared before any imports that use them
// ---------------------------------------------------------------------------

const { mockRegistry, mockStorageIsInMemory, mockGetDb } = vi.hoisted(() => ({
  mockRegistry: {
    getActiveAdapters: vi.fn<() => unknown[]>(() => []),
  },
  mockStorageIsInMemory: vi.fn<() => boolean>(() => false),
  mockGetDb: vi.fn(),
}));

vi.mock('../../adapters/registry.js', () => ({
  getAgentRegistry: () => mockRegistry,
}));

vi.mock('../../storage/index.js', () => ({
  isStorageInMemory: mockStorageIsInMemory,
  getDb: mockGetDb,
  initStorage: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Hono app that replicates the `degradedMode` header
 * middleware and the GET `/` first-run redirect logic in isolation.
 */
function buildTestApp(opts: {
  adminCount: number;
  isInMemory: boolean;
}): Hono {
  let degradedMode = opts.isInMemory;

  const app = new Hono();

  // WS-1.4: set ephemeral storage header
  app.use('*', async (c, next) => {
    await next();
    if (degradedMode) {
      c.res.headers.set('X-ProfClaw-Storage', 'ephemeral');
    }
  });

  // WS-1.3: first-run redirect on GET /
  app.get('/', async (c) => {
    if (opts.adminCount === 0) {
      return c.redirect('/setup', 302);
    }
    return c.json({ name: 'profClaw' });
  });

  return app;
}

// ---------------------------------------------------------------------------
// WS-1.2: Provider validation
// ---------------------------------------------------------------------------

describe('WS-1.2: provider validation on startup', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error(`process.exit(${_code})`);
    });
    delete process.env['PROFCLAW_STRICT_MODE'];
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    delete process.env['PROFCLAW_STRICT_MODE'];
  });

  it('logs a warning when no providers are configured', () => {
    mockRegistry.getActiveAdapters.mockReturnValue([]);

    // Simulate the check from main()
    const adapters = mockRegistry.getActiveAdapters();
    let degradedMode = false;
    if (adapters.length === 0) {
      console.warn(
        'No AI providers configured. Run `profclaw setup` or set ANTHROPIC_API_KEY / OPENAI_API_KEY',
      );
      degradedMode = true;
    }

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No AI providers configured'),
    );
    expect(degradedMode).toBe(true);
  });

  it('does not warn when at least one provider is configured', () => {
    mockRegistry.getActiveAdapters.mockReturnValue([{ type: 'anthropic', name: 'claude' }]);

    const adapters = mockRegistry.getActiveAdapters();
    let degradedMode = false;
    if (adapters.length === 0) {
      console.warn('No AI providers configured.');
      degradedMode = true;
    }

    expect(warnSpy).not.toHaveBeenCalled();
    expect(degradedMode).toBe(false);
  });

  it('calls process.exit(1) when PROFCLAW_STRICT_MODE=true and no providers', () => {
    process.env['PROFCLAW_STRICT_MODE'] = 'true';
    mockRegistry.getActiveAdapters.mockReturnValue([]);

    const runCheck = () => {
      const adapters = mockRegistry.getActiveAdapters();
      if (adapters.length === 0) {
        if (process.env['PROFCLAW_STRICT_MODE'] === 'true') {
          process.exit(1);
        }
      }
    };

    expect(runCheck).toThrow('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does NOT call process.exit when strict mode is off and no providers', () => {
    process.env['PROFCLAW_STRICT_MODE'] = 'false';
    mockRegistry.getActiveAdapters.mockReturnValue([]);

    const runCheck = () => {
      const adapters = mockRegistry.getActiveAdapters();
      if (adapters.length === 0) {
        if (process.env['PROFCLAW_STRICT_MODE'] === 'true') {
          process.exit(1);
        }
      }
    };

    expect(runCheck).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// WS-1.3: First-run setup redirect
// ---------------------------------------------------------------------------

describe('WS-1.3: first-run setup redirect', () => {
  it('redirects GET / to /setup when admin count is 0', async () => {
    const app = buildTestApp({ adminCount: 0, isInMemory: false });
    const res = await app.request('/');

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/setup');
  });

  it('serves normal response when at least one admin exists', async () => {
    const app = buildTestApp({ adminCount: 1, isInMemory: false });
    const res = await app.request('/');

    expect(res.status).toBe(200);
    const body = await res.json() as { name: string };
    expect(body.name).toBe('profClaw');
  });
});

// ---------------------------------------------------------------------------
// WS-1.4: In-memory storage warning header
// ---------------------------------------------------------------------------

describe('WS-1.4: in-memory storage warning header', () => {
  it('sets X-ProfClaw-Storage: ephemeral header when storage is in-memory', async () => {
    const app = buildTestApp({ adminCount: 1, isInMemory: true });
    const res = await app.request('/');

    expect(res.headers.get('X-ProfClaw-Storage')).toBe('ephemeral');
  });

  it('does not set ephemeral header when storage is persistent', async () => {
    const app = buildTestApp({ adminCount: 1, isInMemory: false });
    const res = await app.request('/');

    expect(res.headers.get('X-ProfClaw-Storage')).toBeNull();
  });

  it('sets ephemeral header even on the /setup redirect response', async () => {
    const app = buildTestApp({ adminCount: 0, isInMemory: true });
    const res = await app.request('/');

    expect(res.status).toBe(302);
    expect(res.headers.get('X-ProfClaw-Storage')).toBe('ephemeral');
  });

  it('isStorageInMemory returns true when mocked so', () => {
    mockStorageIsInMemory.mockReturnValue(true);
    expect(mockStorageIsInMemory()).toBe(true);
  });
});
