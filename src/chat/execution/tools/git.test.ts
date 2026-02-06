import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockSpawnSync = vi.fn();
const mockSpawn = vi.fn();

vi.mock('child_process', () => ({
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

import {
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitCommitTool,
  gitBranchTool,
  gitStashTool,
} from './git.js';
import type { ToolExecutionContext } from '../types.js';

function createContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    toolCallId: 'tc-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    workdir: '/tmp/repo',
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
    ...overrides,
  };
}

// Helper to create a mock spawn child process
function createMockProcess(stdout = '', stderr = '', exitCode = 0) {
  const stdoutCallbacks: Array<(data: Buffer) => void> = [];
  const stderrCallbacks: Array<(data: Buffer) => void> = [];
  const closeCallbacks: Array<(code: number) => void> = [];

  const process = {
    stdout: {
      on: vi.fn((_event: string, cb: (data: Buffer) => void) => {
        stdoutCallbacks.push(cb);
      }),
    },
    stderr: {
      on: vi.fn((_event: string, cb: (data: Buffer) => void) => {
        stderrCallbacks.push(cb);
      }),
    },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'close') closeCallbacks.push(cb as (code: number) => void);
    }),
  };

  // Emit data and close asynchronously
  setTimeout(() => {
    for (const cb of stdoutCallbacks) cb(Buffer.from(stdout));
    for (const cb of stderrCallbacks) cb(Buffer.from(stderr));
    for (const cb of closeCallbacks) cb(exitCode);
  }, 5);

  return process;
}

describe('Git Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: git is available
    mockSpawnSync.mockReturnValue({ status: 0 });
  });

  // ===========================================================================
  // Tool definitions
  // ===========================================================================

  describe('tool definitions', () => {
    it('gitStatusTool has correct metadata', () => {
      expect(gitStatusTool.name).toBe('git_status');
      expect(gitStatusTool.description).toBeTruthy();
    });

    it('gitDiffTool has correct metadata', () => {
      expect(gitDiffTool.name).toBe('git_diff');
    });

    it('gitLogTool has correct metadata', () => {
      expect(gitLogTool.name).toBe('git_log');
    });

    it('gitCommitTool has correct metadata', () => {
      expect(gitCommitTool.name).toBe('git_commit');
    });

    it('gitBranchTool has correct metadata', () => {
      expect(gitBranchTool.name).toBe('git_branch');
    });

    it('gitStashTool has correct metadata', () => {
      expect(gitStashTool.name).toBe('git_stash');
    });
  });

  // ===========================================================================
  // git status
  // ===========================================================================

  describe('gitStatusTool.execute', () => {
    it('runs git status and returns output', async () => {
      mockSpawn.mockReturnValue(createMockProcess('M  src/main.ts\n?? new-file.ts', '', 0));

      const result = await gitStatusTool.execute(createContext(), {});

      expect(result.success).toBe(true);
      expect(result.output).toContain('src/main.ts');
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['status']),
        expect.any(Object),
      );
    });

    it('uses short format when specified', async () => {
      mockSpawn.mockReturnValue(createMockProcess('M src/main.ts', '', 0));

      await gitStatusTool.execute(createContext(), { short: true });

      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['-s']),
        expect.any(Object),
      );
    });

    it('handles git errors', async () => {
      mockSpawn.mockReturnValue(createMockProcess('', 'fatal: not a git repository', 128));

      const result = await gitStatusTool.execute(createContext(), {});

      expect(result.success).toBe(false);
    });
  });

  // ===========================================================================
  // git diff
  // ===========================================================================

  describe('gitDiffTool.execute', () => {
    it('runs git diff', async () => {
      mockSpawn.mockReturnValue(createMockProcess('diff --git a/file.ts b/file.ts\n+added line', '', 0));

      const result = await gitDiffTool.execute(createContext(), {});

      expect(result.success).toBe(true);
      expect(result.output).toContain('diff');
    });

    it('supports staged flag', async () => {
      mockSpawn.mockReturnValue(createMockProcess('', '', 0));

      await gitDiffTool.execute(createContext(), { staged: true });

      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['--staged']),
        expect.any(Object),
      );
    });
  });

  // ===========================================================================
  // git log
  // ===========================================================================

  describe('gitLogTool.execute', () => {
    it('runs git log with default options', async () => {
      mockSpawn.mockReturnValue(createMockProcess('abc1234 Initial commit', '', 0));

      const result = await gitLogTool.execute(createContext(), {});

      expect(result.success).toBe(true);
      expect(result.output).toContain('abc1234');
    });

    it('supports count parameter', async () => {
      mockSpawn.mockReturnValue(createMockProcess('', '', 0));

      await gitLogTool.execute(createContext(), { count: 5 });

      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['-5']),
        expect.any(Object),
      );
    });
  });

  // ===========================================================================
  // git commit
  // ===========================================================================

  describe('gitCommitTool.execute', () => {
    it('runs git commit with message', async () => {
      mockSpawn.mockReturnValue(createMockProcess('[main abc1234] test commit', '', 0));

      const result = await gitCommitTool.execute(createContext(), {
        message: 'test commit',
      });

      expect(result.success).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['commit', '-m', 'test commit']),
        expect.any(Object),
      );
    });

    it('supports --all flag', async () => {
      mockSpawn.mockReturnValue(createMockProcess('', '', 0));

      await gitCommitTool.execute(createContext(), {
        message: 'all changes',
        all: true,
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['-a']),
        expect.any(Object),
      );
    });
  });

  // ===========================================================================
  // git branch
  // ===========================================================================

  describe('gitBranchTool.execute', () => {
    it('lists branches', async () => {
      mockSpawn.mockReturnValue(createMockProcess('* main\n  feature/test', '', 0));

      const result = await gitBranchTool.execute(createContext(), { list: true });

      expect(result.success).toBe(true);
      expect(result.output).toContain('main');
    });

    it('creates a new branch', async () => {
      mockSpawn.mockReturnValue(createMockProcess('', '', 0));

      await gitBranchTool.execute(createContext(), { create: 'feature/new' });

      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['feature/new']),
        expect.any(Object),
      );
    });
  });

  // ===========================================================================
  // git stash
  // ===========================================================================

  describe('gitStashTool.execute', () => {
    it('lists stashes', async () => {
      mockSpawn.mockReturnValue(createMockProcess('stash@{0}: WIP on main', '', 0));

      const result = await gitStashTool.execute(createContext(), { action: 'list' });

      expect(result.success).toBe(true);
    });
  });
});
