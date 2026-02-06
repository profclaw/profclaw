import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  readFileTool,
  writeFileTool,
  editFileTool,
  patchApplyTool,
} from './file-ops.js';
import type { ToolExecutionContext, ToolSession } from '../types.js';

function createContext(workdir: string): ToolExecutionContext {
  return {
    toolCallId: 'tool-call-1',
    conversationId: 'conv-1',
    workdir,
    env: {},
    securityPolicy: { mode: 'ask' },
    sessionManager: {
      create(session: Omit<ToolSession, 'id' | 'createdAt'>): ToolSession {
        return {
          ...session,
          id: 'session-1',
          createdAt: Date.now(),
        };
      },
      get() {
        return undefined;
      },
      update() {},
      list() {
        return [];
      },
      async kill() {},
      cleanup() {},
    },
  };
}

describe('file operation tools', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'profclaw-file-ops-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('reads selected lines from a file and marks the result as truncated', async () => {
    const filePath = path.join(tempDir, 'notes.txt');
    await fs.writeFile(filePath, 'line1\nline2\nline3\nline4\n', 'utf-8');

    const result = await readFileTool.execute(createContext(tempDir), {
      path: 'notes.txt',
      offset: 1,
      lines: 2,
      encoding: 'utf-8',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      path: 'notes.txt',
      content: 'line2\nline3',
      truncated: true,
    });
  });

  it('blocks reading sensitive env files', async () => {
    const result = await readFileTool.execute(createContext(tempDir), {
      path: '.env',
      encoding: 'utf-8',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('BLOCKED_PATH');
  });

  it('writes nested files when createDirs=true', async () => {
    const result = await writeFileTool.execute(createContext(tempDir), {
      path: 'nested/output.txt',
      content: 'hello world',
      createDirs: true,
    });

    expect(result.success).toBe(true);
    const content = await fs.readFile(path.join(tempDir, 'nested/output.txt'), 'utf-8');
    expect(content).toBe('hello world');
  });

  it('rejects ambiguous edits unless replace_all=true', async () => {
    const filePath = path.join(tempDir, 'dup.txt');
    await fs.writeFile(filePath, 'target\ntarget\n', 'utf-8');

    const result = await editFileTool.execute(createContext(tempDir), {
      path: 'dup.txt',
      old_string: 'target',
      new_string: 'replacement',
      replace_all: false,
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('AMBIGUOUS_MATCH');
  });

  it('applies a unified diff patch to a file', async () => {
    const filePath = path.join(tempDir, 'patch.txt');
    await fs.writeFile(filePath, 'line1\nold line\nline3\n', 'utf-8');

    const result = await patchApplyTool.execute(createContext(tempDir), {
      path: 'patch.txt',
      patch: '@@ -1,3 +1,3 @@\n line1\n-old line\n+new line\n line3',
      reverse: false,
    });

    expect(result.success).toBe(true);
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toContain('new line');
    expect(content).not.toContain('old line');
  });
});
