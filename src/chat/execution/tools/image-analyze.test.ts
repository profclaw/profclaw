/**
 * Image Analyze Tool Tests
 *
 * Tests for src/chat/execution/tools/image-analyze.ts
 * All fs calls are mocked via vi.mock.
 */

import { describe, expect, it, vi } from 'vitest';

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

vi.mock('fs/promises', () => ({
  default: {
    stat: vi.fn(),
    readFile: vi.fn(),
  },
  stat: vi.fn(),
  readFile: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { imageAnalyzeTool } from './image-analyze.js';
import type { ToolExecutionContext } from '../types.js';
import * as fsPromises from 'fs/promises';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createContext(): ToolExecutionContext {
  return {
    toolCallId: 'tc-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    workdir: '/workspace',
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

// We need to mock the default export from 'fs/promises'
const fsMock = fsPromises as unknown as {
  stat: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('imageAnalyzeTool', () => {
  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('tool metadata', () => {
    it('has correct name', () => {
      expect(imageAnalyzeTool.name).toBe('image_analyze');
    });

    it('has filesystem category', () => {
      expect(imageAnalyzeTool.category).toBe('filesystem');
    });

    it('has safe security level', () => {
      expect(imageAnalyzeTool.securityLevel).toBe('safe');
    });
  });

  // -------------------------------------------------------------------------
  // Unsupported format
  // -------------------------------------------------------------------------

  describe('unsupported formats', () => {
    it('returns UNSUPPORTED_FORMAT for .txt files', async () => {
      const result = await imageAnalyzeTool.execute(createContext(), {
        path: '/tmp/doc.txt',
        prompt: 'Describe this',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNSUPPORTED_FORMAT');
      expect(result.error?.message).toContain('.txt');
    });

    it('returns UNSUPPORTED_FORMAT for .pdf files', async () => {
      const result = await imageAnalyzeTool.execute(createContext(), {
        path: '/tmp/file.pdf',
        prompt: 'Describe',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNSUPPORTED_FORMAT');
    });

    it('returns UNSUPPORTED_FORMAT for files with no extension', async () => {
      const result = await imageAnalyzeTool.execute(createContext(), {
        path: '/tmp/imagefile',
        prompt: 'Describe',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNSUPPORTED_FORMAT');
    });
  });

  // -------------------------------------------------------------------------
  // File not found
  // -------------------------------------------------------------------------

  describe('file not found', () => {
    it('returns FILE_NOT_FOUND when stat throws ENOENT', async () => {
      const enoentErr = new Error('ENOENT: no such file or directory, stat \'/tmp/missing.png\'');
      fsMock.stat.mockRejectedValueOnce(enoentErr);

      const result = await imageAnalyzeTool.execute(createContext(), {
        path: '/tmp/missing.png',
        prompt: 'Describe',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('FILE_NOT_FOUND');
      expect(result.error?.message).toContain('missing.png');
    });
  });

  // -------------------------------------------------------------------------
  // Not a file
  // -------------------------------------------------------------------------

  describe('not a file', () => {
    it('returns NOT_A_FILE when path points to a directory', async () => {
      fsMock.stat.mockResolvedValueOnce({
        isFile: () => false,
        size: 0,
      });

      const result = await imageAnalyzeTool.execute(createContext(), {
        path: '/tmp/mydir.png',
        prompt: 'Describe',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_A_FILE');
    });
  });

  // -------------------------------------------------------------------------
  // File too large
  // -------------------------------------------------------------------------

  describe('file too large', () => {
    it('returns FILE_TOO_LARGE when file exceeds 20MB', async () => {
      fsMock.stat.mockResolvedValueOnce({
        isFile: () => true,
        size: 25_000_000, // 25MB > 20MB limit
      });

      const result = await imageAnalyzeTool.execute(createContext(), {
        path: '/tmp/huge.png',
        prompt: 'Describe',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('FILE_TOO_LARGE');
      expect(result.error?.message).toContain('25.0MB');
    });
  });

  // -------------------------------------------------------------------------
  // Successful analysis
  // -------------------------------------------------------------------------

  describe('successful reads', () => {
    it('reads a PNG file and returns base64 data', async () => {
      fsMock.stat.mockResolvedValueOnce({
        isFile: () => true,
        size: 1024,
      });
      const fakeBuffer = Buffer.from('fake-png-data');
      fsMock.readFile.mockResolvedValueOnce(fakeBuffer);

      const result = await imageAnalyzeTool.execute(createContext(), {
        path: '/tmp/screenshot.png',
        prompt: 'Describe this screenshot',
      });

      expect(result.success).toBe(true);
      expect(result.data?.mimeType).toBe('image/png');
      expect(result.data?.base64).toBe(fakeBuffer.toString('base64'));
      expect(result.data?.prompt).toBe('Describe this screenshot');
      expect(result.output).toContain('screenshot.png');
    });

    it('reads a JPEG file with correct mime type', async () => {
      fsMock.stat.mockResolvedValueOnce({
        isFile: () => true,
        size: 2048,
      });
      fsMock.readFile.mockResolvedValueOnce(Buffer.from('fake-jpeg'));

      const result = await imageAnalyzeTool.execute(createContext(), {
        path: '/tmp/photo.jpg',
        prompt: 'What is in this photo?',
      });

      expect(result.success).toBe(true);
      expect(result.data?.mimeType).toBe('image/jpeg');
    });

    it('reads a .jpeg extension file with correct mime type', async () => {
      fsMock.stat.mockResolvedValueOnce({
        isFile: () => true,
        size: 512,
      });
      fsMock.readFile.mockResolvedValueOnce(Buffer.from('fake-jpeg2'));

      const result = await imageAnalyzeTool.execute(createContext(), {
        path: '/tmp/img.jpeg',
        prompt: 'Analyze',
      });

      expect(result.success).toBe(true);
      expect(result.data?.mimeType).toBe('image/jpeg');
    });

    it('reads a GIF file with correct mime type', async () => {
      fsMock.stat.mockResolvedValueOnce({
        isFile: () => true,
        size: 4000,
      });
      fsMock.readFile.mockResolvedValueOnce(Buffer.from('fake-gif'));

      const result = await imageAnalyzeTool.execute(createContext(), {
        path: '/tmp/anim.gif',
        prompt: 'Describe',
      });

      expect(result.success).toBe(true);
      expect(result.data?.mimeType).toBe('image/gif');
    });

    it('reads a WebP file', async () => {
      fsMock.stat.mockResolvedValueOnce({
        isFile: () => true,
        size: 3000,
      });
      fsMock.readFile.mockResolvedValueOnce(Buffer.from('fake-webp'));

      const result = await imageAnalyzeTool.execute(createContext(), {
        path: '/tmp/image.webp',
        prompt: 'Describe',
      });

      expect(result.success).toBe(true);
      expect(result.data?.mimeType).toBe('image/webp');
    });

    it('resolves relative path against workdir', async () => {
      fsMock.stat.mockResolvedValueOnce({
        isFile: () => true,
        size: 500,
      });
      fsMock.readFile.mockResolvedValueOnce(Buffer.from('data'));

      const result = await imageAnalyzeTool.execute(createContext(), {
        path: 'relative/screenshot.png',
        prompt: 'Describe',
      });

      expect(result.success).toBe(true);
      // workdir is /workspace, so it resolves to /workspace/relative/screenshot.png
    });

    it('uses default prompt when not specified', async () => {
      fsMock.stat.mockResolvedValueOnce({
        isFile: () => true,
        size: 100,
      });
      fsMock.readFile.mockResolvedValueOnce(Buffer.from('data'));

      const result = await imageAnalyzeTool.execute(createContext(), {
        path: '/tmp/img.png',
        prompt: 'Describe this image in detail',
      });

      expect(result.success).toBe(true);
      expect(result.data?.prompt).toBe('Describe this image in detail');
    });

    it('includes size in result data', async () => {
      const fileSize = 5120;
      fsMock.stat.mockResolvedValueOnce({
        isFile: () => true,
        size: fileSize,
      });
      fsMock.readFile.mockResolvedValueOnce(Buffer.from('data'));

      const result = await imageAnalyzeTool.execute(createContext(), {
        path: '/tmp/img.png',
        prompt: 'Describe',
      });

      expect(result.success).toBe(true);
      expect(result.data?.size).toBe(fileSize);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('returns IMAGE_ERROR for generic read failures', async () => {
      fsMock.stat.mockResolvedValueOnce({
        isFile: () => true,
        size: 100,
      });
      fsMock.readFile.mockRejectedValueOnce(new Error('Permission denied'));

      const result = await imageAnalyzeTool.execute(createContext(), {
        path: '/tmp/locked.png',
        prompt: 'Describe',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('IMAGE_ERROR');
      expect(result.error?.message).toContain('Permission denied');
    });
  });
});
