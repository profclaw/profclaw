/**
 * TTS Speak Tool Tests
 *
 * Tests for src/chat/execution/tools/tts-speak.ts
 * Mocks: fetch (OpenAI API), child_process exec, fs/promises.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

// Hoisted mocks for stable references across mock definitions and tests
const { execAsyncMock, fsWriteFile, fsRename, fsCopyFile } = vi.hoisted(() => ({
  execAsyncMock: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
  fsWriteFile: vi.fn().mockResolvedValue(undefined),
  fsRename: vi.fn().mockResolvedValue(undefined),
  fsCopyFile: vi.fn().mockResolvedValue(undefined),
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    writeFile: fsWriteFile,
    rename: fsRename,
    copyFile: fsCopyFile,
  },
  writeFile: fsWriteFile,
  rename: fsRename,
  copyFile: fsCopyFile,
}));

// Mock child_process util (the promisified exec)
vi.mock('util', async (importOriginal) => {
  const orig = await importOriginal<typeof import('util')>();
  return {
    ...orig,
    promisify: vi.fn((fn: unknown) => {
      // Return the hoisted mock for exec
      const fnStr = typeof fn === 'function' ? fn.name || String(fn) : '';
      if (fnStr.includes('exec')) {
        return execAsyncMock;
      }
      return orig.promisify(fn as (...args: unknown[]) => unknown);
    }),
  };
});

// Mock os.platform and os.tmpdir
vi.mock('os', async (importOriginal) => {
  const orig = await importOriginal<typeof import('os')>();
  const mocked = {
    ...orig,
    platform: vi.fn(() => 'darwin'),
    tmpdir: vi.fn(() => '/tmp'),
  };
  return {
    ...mocked,
    default: mocked,
  };
});

// Stub global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { ttsSpeakTool } from './tts-speak.js';
import type { ToolExecutionContext } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createContext(): ToolExecutionContext {
  return {
    toolCallId: 'tc-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    workdir: '/tmp',
    env: {},
    securityPolicy: { mode: 'full' },
    sessionManager: {
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      list: vi.fn(() => []),
      kill: vi.fn(),
      cleanup: vi.fn(),
    },
  };
}

function mockOpenAISuccess() {
  const fakeBuffer = new Uint8Array([1, 2, 3, 4]).buffer;
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    arrayBuffer: vi.fn().mockResolvedValue(fakeBuffer),
  });
}

function mockOpenAIFail(status = 500, errText = 'Internal Server Error') {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: vi.fn().mockResolvedValue(errText),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ttsSpeakTool', () => {
  const originalApiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  });

  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('tool metadata', () => {
    it('has correct name', () => {
      expect(ttsSpeakTool.name).toBe('tts_speak');
    });

    it('is always available', () => {
      const result = ttsSpeakTool.isAvailable?.();
      expect(result?.available).toBe(true);
    });

    it('does not require approval', () => {
      expect(ttsSpeakTool.requiresApproval).toBeFalsy();
    });
  });

  // -------------------------------------------------------------------------
  // System TTS (no API key)
  // -------------------------------------------------------------------------

  describe('system TTS - no OPENAI_API_KEY', () => {
    beforeEach(() => {
      delete process.env.OPENAI_API_KEY;
    });

    it('uses system TTS on macOS when no API key', async () => {
      const result = await ttsSpeakTool.execute(createContext(), {
        text: 'Hello world',
        voice: 'nova',
        speed: 1.0,
        format: 'mp3',
      });

      expect(result.success).toBe(true);
      expect(result.data?.engine).toBe('macos-say');
      expect(result.output).toContain('macos-say');
      // fetch should not be called (no API key)
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('includes audio path in result', async () => {
      const result = await ttsSpeakTool.execute(createContext(), {
        text: 'Audio path test',
        voice: 'nova',
        speed: 1.0,
        format: 'mp3',
      });

      expect(result.success).toBe(true);
      expect(typeof result.data?.audioPath).toBe('string');
      expect(result.data?.audioPath).toMatch(/\/tmp\/tts-\d+\.(mp3|aiff)/);
    });

    it('uses custom outputPath when provided', async () => {
      const result = await ttsSpeakTool.execute(createContext(), {
        text: 'Custom path test',
        voice: 'nova',
        speed: 1.0,
        format: 'mp3',
        outputPath: '/tmp/custom-audio.mp3',
      });

      expect(result.success).toBe(true);
      expect(result.data?.audioPath).toBe('/tmp/custom-audio.mp3');
    });

    it('includes char count in result', async () => {
      const text = 'Hello there!';
      const result = await ttsSpeakTool.execute(createContext(), {
        text,
        voice: 'nova',
        speed: 1.0,
        format: 'mp3',
      });

      expect(result.success).toBe(true);
      expect(result.data?.charCount).toBe(text.length);
    });

    it('includes duration estimate', async () => {
      const result = await ttsSpeakTool.execute(createContext(), {
        text: 'The deployment is complete. All systems are operational.',
        voice: 'nova',
        speed: 1.0,
        format: 'mp3',
      });

      expect(result.success).toBe(true);
      expect(typeof result.data?.durationEstimate).toBe('number');
      expect(result.data?.durationEstimate).toBeGreaterThanOrEqual(0);
    });

    it('formats the output message with engine info', async () => {
      const result = await ttsSpeakTool.execute(createContext(), {
        text: 'Format test',
        voice: 'nova',
        speed: 1.0,
        format: 'mp3',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Text-to-Speech Generated');
      expect(result.output).toContain('Audio File');
    });
  });

  // -------------------------------------------------------------------------
  // OpenAI TTS (with API key)
  // -------------------------------------------------------------------------

  describe('OpenAI TTS - with OPENAI_API_KEY', () => {
    beforeEach(() => {
      process.env.OPENAI_API_KEY = 'sk-test-key';
    });

    it('uses OpenAI TTS when API key is set', async () => {
      mockOpenAISuccess();

      const result = await ttsSpeakTool.execute(createContext(), {
        text: 'Hello from OpenAI TTS',
        voice: 'onyx',
        speed: 1.2,
        format: 'mp3',
      });

      expect(result.success).toBe(true);
      expect(result.data?.engine).toBe('openai');
      expect(result.data?.voice).toBe('onyx');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/audio/speech',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('falls back to system TTS when OpenAI API fails', async () => {
      mockOpenAIFail(500, 'Service Unavailable');

      const result = await ttsSpeakTool.execute(createContext(), {
        text: 'Fallback test',
        voice: 'nova',
        speed: 1.0,
        format: 'mp3',
      });

      expect(result.success).toBe(true);
      // Should fall back to macos-say
      expect(result.data?.engine).toBe('macos-say');
    });

    it('includes voice in output when engine is openai', async () => {
      mockOpenAISuccess();

      const result = await ttsSpeakTool.execute(createContext(), {
        text: 'Voice test',
        voice: 'shimmer',
        speed: 1.0,
        format: 'mp3',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Voice');
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('returns TTS_FAILED when system TTS throws', async () => {
      delete process.env.OPENAI_API_KEY;

      // Make execAsync reject to simulate system TTS failure
      execAsyncMock.mockRejectedValueOnce(new Error('say: command not found'));

      const result = await ttsSpeakTool.execute(createContext(), {
        text: 'Error path test',
        voice: 'nova',
        speed: 1.0,
        format: 'mp3',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TTS_FAILED');
      expect(result.error?.message).toContain('say: command not found');
    });

    it('falls back to system TTS when OpenAI writeFile fails', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      mockOpenAISuccess();
      // writeFile will fail, causing OpenAI path to throw
      fsWriteFile.mockRejectedValueOnce(new Error('Disk full'));

      const result = await ttsSpeakTool.execute(createContext(), {
        text: 'Fallback test',
        voice: 'nova',
        speed: 1.0,
        format: 'mp3',
      });

      // Should fall back to system TTS (exec mock succeeds)
      expect(result.success).toBe(true);
      expect(result.data?.engine).toBe('macos-say');
    });
  });

  // -------------------------------------------------------------------------
  // Duration estimation
  // -------------------------------------------------------------------------

  describe('duration estimation', () => {
    it('faster speed gives shorter duration', async () => {
      delete process.env.OPENAI_API_KEY;

      const slowResult = await ttsSpeakTool.execute(createContext(), {
        text: 'The quick brown fox jumps over the lazy dog',
        voice: 'nova',
        speed: 0.5,
        format: 'mp3',
      });

      // For the fast version, need fresh mocks (exec needs to be reset)
      const fastResult = await ttsSpeakTool.execute(createContext(), {
        text: 'The quick brown fox jumps over the lazy dog',
        voice: 'nova',
        speed: 2.0,
        format: 'mp3',
      });

      expect(slowResult.success).toBe(true);
      expect(fastResult.success).toBe(true);

      // Faster speed = shorter duration
      expect(fastResult.data?.durationEstimate).toBeLessThanOrEqual(
        slowResult.data?.durationEstimate ?? 0,
      );
    });
  });
});
