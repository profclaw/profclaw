import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenClawAdapter, extractArtifacts, OpenClawResponse } from '../openclaw.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('OpenClaw Adapter', () => {
  const config = {
    id: 'oc-1',
    type: 'openclaw',
    config: {
      token: 'secret-token',
      baseUrl: 'http://oc-gateway:18789'
    }
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should perform a successful health check', async () => {
    const adapter = new OpenClawAdapter(config);
    mockFetch.mockResolvedValue({ ok: true });

    const health = await adapter.healthCheck();
    expect(health.healthy).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('http://oc-gateway:18789/api/health', expect.any(Object));
  });

  it('should execute a task successfully', async () => {
    const adapter = new OpenClawAdapter(config);
    const task = {
      id: 'task-1',
      title: 'Fix issue',
      prompt: 'Refactor index.ts',
      repository: 'profclaw/profclaw',
      labels: [],
    } as any;

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        message: 'I fixed it in commit abc123def456. Pull request created: https://github.com/profclaw/profclaw/pull/42',
        usage: { total_tokens: 100 }
      })
    });

    const result = await adapter.executeTask(task);
    expect(result.success).toBe(true);
    expect(result.tokensUsed?.total).toBe(100);
    expect(result.artifacts?.length).toBeGreaterThan(0);
    
    // Check if PR artifact was extracted
    const prAtf = result.artifacts?.find(a => a.type === 'pull_request');
    expect(prAtf?.url).toBe('https://github.com/profclaw/profclaw/pull/42');
  });

  it('should handle API errors during execution', async () => {
    const adapter = new OpenClawAdapter(config);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Error'
    });

    const result = await adapter.executeTask({ title: 'T' } as any);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('HTTP_500');
  });

  describe('Artifact Extraction', () => {
    it('should extract commits, PRs, and files from text', () => {
      const response: OpenClawResponse = {
        message: 'Modified index.ts and created server.js. Committed as a1b2c3d4. PR: https://github.com/o/r/pull/1'
      };

      const artifacts = extractArtifacts(response);
      
      expect(artifacts).toContainEqual(expect.objectContaining({ type: 'commit', sha: 'a1b2c3d4' }));
      expect(artifacts).toContainEqual(expect.objectContaining({ type: 'pull_request', url: 'https://github.com/o/r/pull/1' }));
      expect(artifacts).toContainEqual(expect.objectContaining({ type: 'file', path: 'index.ts' }));
      expect(artifacts).toContainEqual(expect.objectContaining({ type: 'file', path: 'server.js' }));
    });
  });
});
