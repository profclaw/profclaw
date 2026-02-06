import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeCodeAdapter } from '../claude-code.js';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn()
}));

describe('Claude Code Adapter', () => {
  const config = {
    id: 'cc-1',
    type: 'claude-code',
    config: {
      claudePath: 'claude-cli',
      workingDir: '/tmp'
    }
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockSpawnProcess(code: number, stdout = '', stderr = '') {
    const mockProcess = new EventEmitter() as any;
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    
    vi.mocked(spawn).mockReturnValue(mockProcess);

    // Need to trigger events in a way the code expects
    // The code uses: proc.stdout.on('data', ...)
    // And proc.on('close', ...)
    
    process.nextTick(() => {
        if (stdout) mockProcess.stdout.emit('data', Buffer.from(stdout));
        if (stderr) mockProcess.stderr.emit('data', Buffer.from(stderr));
        mockProcess.emit('close', code);
    });

    return mockProcess;
  }

  it('should check health successfully', async () => {
    const adapter = new ClaudeCodeAdapter(config);
    mockSpawnProcess(0, '0.1.0-alpha.1');

    const health = await adapter.healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.message).toContain('0.1.0');
    expect(spawn).toHaveBeenCalledWith('claude-cli', ['--version'], expect.any(Object));
  });

  it('should execute a task successfully', async () => {
    const adapter = new ClaudeCodeAdapter(config);
    const task = {
      title: 'Fix issue',
      prompt: 'Refactor code',
      repository: 'owner/repo',
      labels: [],
    } as any;

    mockSpawnProcess(0, 'Done. Committed as abc1234. PR: https://github.com/o/r/pull/1');

    const result = await adapter.executeTask(task);
    expect(result.success).toBe(true);
    expect(result.artifacts).toContainEqual(expect.objectContaining({ type: 'commit', sha: 'abc1234' }));
  });

  it('should handle process failures', async () => {
    const adapter = new ClaudeCodeAdapter(config);
    mockSpawnProcess(1, '', 'Something went wrong');

    const result = await adapter.executeTask({ title: 'T' } as any);
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Something went wrong');
  });

  it('should handle process errors (spawn crash)', async () => {
    const adapter = new ClaudeCodeAdapter(config);
    const mockProcess = new EventEmitter() as any;
    vi.mocked(spawn).mockReturnValue(mockProcess);

    process.nextTick(() => {
        mockProcess.emit('error', new Error('ENOENT'));
    });

    const result = await adapter.executeTask({ title: 'T' } as any);
    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('ENOENT');
  });
});
