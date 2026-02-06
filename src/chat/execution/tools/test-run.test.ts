import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { testRunTool } from './test-run.js';
import type { ToolExecutionContext, ToolSession } from '../types.js';

function createContext(workdir: string): ToolExecutionContext {
  return {
    toolCallId: 'tool-call-1',
    conversationId: 'conv-1',
    userId: 'user-1',
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

describe('test run tool', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'profclaw-test-run-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('runs a manual command even when no framework can be auto-detected', async () => {
    const result = await testRunTool.execute(createContext(tempDir), {
      command: "printf '3 passed, 0 failed, 0 skipped\\n'",
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      framework: 'manual',
      passed: 3,
      failed: 0,
      skipped: 0,
      total: 3,
    });
    expect(result.output).toContain('Framework: manual');
  });

  it('parses vitest-style failures and coverage from command output', async () => {
    await fs.writeFile(
      path.join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'tool-test',
        private: true,
        devDependencies: {
          vitest: '^4.0.0',
        },
      }),
      'utf-8',
    );

    const result = await testRunTool.execute(createContext(tempDir), {
      command:
        "printf 'Tests: 1 failed, 2 skipped, 3 passed, 6 total\\nDuration 1.5s\\nFAIL src/auth.test.ts > rejects invalid body\\nAll files | 87.5\\n'",
    });

    expect(result.success).toBe(false);
    expect(result.data).toMatchObject({
      framework: 'vitest',
      passed: 3,
      failed: 1,
      skipped: 2,
      total: 6,
      duration_ms: 1500,
      coverage: 87.5,
      failures: [
        expect.objectContaining({
          name: 'rejects invalid body',
          file: 'src/auth.test.ts',
        }),
      ],
    });
    expect(result.output).toContain('Failures:');
    expect(result.output).toContain('--- Raw Output ---');
  });
});
