import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenClawAdapter, extractArtifacts, createOpenClawAdapter, type OpenClawResponse } from './openclaw.js';
import type { AgentConfig } from '../types/agent.js';
import type { Task } from '../types/task.js';
import { TaskStatus, TaskSource } from '../types/task.js';

// Mock fetch globally
global.fetch = vi.fn();

describe('OpenClawAdapter', () => {
  const mockConfig: AgentConfig = {
    id: 'test-openclaw-1',
    type: 'openclaw',
    enabled: true,
    maxConcurrent: 5,
    priority: 100,
    config: {
      baseUrl: 'http://test-openclaw.local',
      token: 'test-token-123',
      workingDir: '/tmp/openclaw',
      timeout: 10000,
    },
  };

  const mockTask: Task = {
    id: 'task-123',
    title: 'Fix login bug',
    description: 'Users cannot log in with SSO',
    prompt: 'Fix the SSO authentication flow in the login component',
    priority: 2,
    source: TaskSource.GITHUB_ISSUE,
    sourceId: '456',
    sourceUrl: 'https://github.com/org/repo/issues/456',
    repository: 'org/repo',
    branch: 'main',
    labels: ['bug', 'auth'],
    status: TaskStatus.QUEUED,
    createdAt: new Date(),
    updatedAt: new Date(),
    attempts: 0,
    maxAttempts: 3,
    metadata: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with provided config', () => {
      const adapter = new OpenClawAdapter(mockConfig);
      expect(adapter.type).toBe('openclaw');
      expect(adapter.name).toBe('OpenClaw');
      expect(adapter.capabilities).toContain('code_generation');
      expect(adapter.capabilities).toContain('web_browsing');
    });

    it('should use environment variables as fallbacks', () => {
      const originalEnv = process.env.OPENCLAW_GATEWAY_TOKEN;
      process.env.OPENCLAW_GATEWAY_TOKEN = 'env-token';
      
      const configWithoutToken: AgentConfig = {
        id: 'test-openclaw-2',
        type: 'openclaw',
        enabled: true,
        maxConcurrent: 5,
        priority: 100,
        config: {},
      };

      const adapter = new OpenClawAdapter(configWithoutToken);
      expect(adapter).toBeDefined();

      process.env.OPENCLAW_GATEWAY_TOKEN = originalEnv;
    });

    it('should throw error if no token is provided', () => {
      const originalEnv = process.env.OPENCLAW_GATEWAY_TOKEN;
      delete process.env.OPENCLAW_GATEWAY_TOKEN;

      const configWithoutToken: AgentConfig = {
        id: 'test-openclaw-3',
        type: 'openclaw',
        enabled: true,
        maxConcurrent: 5,
        priority: 100,
        config: {},
      };

      expect(() => new OpenClawAdapter(configWithoutToken)).toThrow(
        'OpenClaw gateway token is required'
      );

      process.env.OPENCLAW_GATEWAY_TOKEN = originalEnv;
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when gateway responds', async () => {
      const adapter = new OpenClawAdapter(mockConfig);
      
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      const health = await adapter.healthCheck();

      expect(health.healthy).toBe(true);
      expect(health.message).toBe('OpenClaw gateway is healthy');
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
      expect(health.lastChecked).toBeInstanceOf(Date);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://test-openclaw.local/api/health',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token-123',
          }),
        })
      );
    });

    it('should return unhealthy status on HTTP error', async () => {
      const adapter = new OpenClawAdapter(mockConfig);
      
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      } as Response);

      const health = await adapter.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.message).toContain('503');
      expect(health.message).toContain('Service Unavailable');
    });

    it('should return unhealthy status on network error', async () => {
      const adapter = new OpenClawAdapter(mockConfig);
      
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Network timeout')
      );

      const health = await adapter.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.message).toBe('Network timeout');
    });
  });

  describe('executeTask', () => {
    it('should successfully execute a task', async () => {
      const adapter = new OpenClawAdapter(mockConfig);
      
      const mockResponse: OpenClawResponse = {
        message: 'Task completed successfully. commit abc123 modified file src/auth.ts',
        usage: {
          prompt_tokens: 100,
          completion_tokens: 200,
          total_tokens: 300,
        },
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await adapter.executeTask(mockTask);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Task completed successfully');
      expect(result.tokensUsed).toEqual({
        input: 100,
        output: 200,
        total: 300,
      });
      expect(result.artifacts).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://test-openclaw.local/api/chat',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token-123',
          }),
        })
      );
    });

    it('should handle task with alternative response field', async () => {
      const adapter = new OpenClawAdapter(mockConfig);
      
      const mockResponse: OpenClawResponse = {
        response: 'Alternative response field content',
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await adapter.executeTask(mockTask);

      expect(result.success).toBe(true);
      expect(result.output).toBe('Alternative response field content');
    });

    it('should handle HTTP errors', async () => {
      const adapter = new OpenClawAdapter(mockConfig);
      
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal server error',
      } as Response);

      const result = await adapter.executeTask(mockTask);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('HTTP_500');
      expect(result.error?.message).toContain('OpenClaw API error');
      expect(result.error?.message).toContain('500');
    });

    it('should handle network/execution errors', async () => {
      const adapter = new OpenClawAdapter(mockConfig);
      
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Connection refused')
      );

      const result = await adapter.executeTask(mockTask);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EXECUTION_ERROR');
      expect(result.error?.message).toBe('Connection refused');
      expect(result.error?.stack).toBeDefined();
    });

    it('should use repository in working directory if provided', async () => {
      const adapter = new OpenClawAdapter(mockConfig);
      
      const mockResponse: OpenClawResponse = { message: 'Done' };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await adapter.executeTask(mockTask);

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.options.workingDir).toBe('/tmp/openclaw/repo');
    });

    it('should fall back to base working directory if no repository', async () => {
      const adapter = new OpenClawAdapter(mockConfig);
      
      const taskWithoutRepo = { ...mockTask, repository: undefined };
      const mockResponse: OpenClawResponse = { message: 'Done' };
      
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await adapter.executeTask(taskWithoutRepo);

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.options.workingDir).toBe('/tmp/openclaw');
    });
  });

  describe('buildPrompt', () => {
    it('should include all task information in prompt', async () => {
      const adapter = new OpenClawAdapter(mockConfig);
      
      const mockResponse: OpenClawResponse = { message: 'Done' };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await adapter.executeTask(mockTask);

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      const prompt = body.message;

      expect(prompt).toContain('Fix login bug');
      expect(prompt).toContain('Users cannot log in with SSO');
      expect(prompt).toContain('org/repo');
      expect(prompt).toContain('bug, auth');
      expect(prompt).toContain('456');
    });

    it('should handle task without optional fields', async () => {
      const adapter = new OpenClawAdapter(mockConfig);
      
      const minimalTask: Task = {
        ...mockTask,
        description: undefined,
        sourceUrl: undefined,
        repository: undefined,
        labels: [],
      };

      const mockResponse: OpenClawResponse = { message: 'Done' };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await adapter.executeTask(minimalTask);
      expect(result.success).toBe(true);
    });
  });
});

describe('extractArtifacts', () => {
  it('should extract commit artifacts', () => {
    const response: OpenClawResponse = {
      message: 'Created commit abc1234 and commit def5678',
    };

    const artifacts = extractArtifacts(response);

    const commits = artifacts.filter((a) => a.type === 'commit');
    expect(commits).toHaveLength(2);
    expect(commits[0].sha).toBe('abc1234');
    expect(commits[1].sha).toBe('def5678');
  });

  it('should extract PR artifacts with metadata', () => {
    const response: OpenClawResponse = {
      message: 'Created PR: https://github.com/owner/repo/pull/123',
    };

    const artifacts = extractArtifacts(response);

    const prs = artifacts.filter((a) => a.type === 'pull_request');
    expect(prs).toHaveLength(1);
    expect(prs[0].url).toBe('https://github.com/owner/repo/pull/123');
    expect(prs[0].metadata).toEqual({
      owner: 'owner',
      repo: 'repo',
      number: 123,
    });
  });

  it('should extract file artifacts', () => {
    const response: OpenClawResponse = {
      message: 'modified file src/auth.ts and created file tests/auth.test.ts',
    };

    const artifacts = extractArtifacts(response);

    const files = artifacts.filter((a) => a.type === 'file');
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe('src/auth.ts');
    expect(files[1].path).toBe('tests/auth.test.ts');
  });

  it('should extract multiple artifact types', () => {
    const response: OpenClawResponse = {
      message: `
        Task completed successfully.
        commit abc123
        https://github.com/owner/repo/pull/456
        modified file src/index.ts
        edited file package.json
      `,
    };

    const artifacts = extractArtifacts(response);

    expect(artifacts).toHaveLength(4);
    expect(artifacts.some((a) => a.type === 'commit')).toBe(true);
    expect(artifacts.some((a) => a.type === 'pull_request')).toBe(true);
    expect(artifacts.some((a) => a.type === 'file')).toBe(true);
  });

  it('should handle response field in addition to message', () => {
    const response: OpenClawResponse = {
      response: 'commit xyz789',
      message: undefined,
    };

    const artifacts = extractArtifacts(response);
    // extractArtifacts only checks message field, so this should be empty
    expect(artifacts).toHaveLength(0);
  });

  it('should merge structured artifacts from response', () => {
    const response: OpenClawResponse = {
      message: 'commit abc123',
      artifacts: [
        { type: 'branch', path: 'feature/new-feature' },
      ],
    };

    const artifacts = extractArtifacts(response);

    expect(artifacts).toHaveLength(2);
    expect(artifacts.some((a) => a.type === 'commit')).toBe(true);
    expect(artifacts.some((a) => a.type === 'branch')).toBe(true);
  });

  it('should handle empty response', () => {
    const response: OpenClawResponse = {};
    const artifacts = extractArtifacts(response);
    expect(artifacts).toHaveLength(0);
  });

  it('should handle response with no artifacts', () => {
    const response: OpenClawResponse = {
      message: 'Task completed with no artifacts',
    };

    const artifacts = extractArtifacts(response);
    expect(artifacts).toHaveLength(0);
  });

  it('should extract long commit SHAs', () => {
    const response: OpenClawResponse = {
      message: 'commit 1234567890abcdef1234567890abcdef12345678',
    };

    const artifacts = extractArtifacts(response);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].type).toBe('commit');
    expect(artifacts[0].sha).toBe('1234567890abcdef1234567890abcdef12345678');
  });
});

describe('createOpenClawAdapter', () => {
  it('should create an OpenClawAdapter instance', () => {
    const config: AgentConfig = {
      id: 'test-openclaw-factory',
      type: 'openclaw',
      enabled: true,
      maxConcurrent: 5,
      priority: 100,
      config: {
        token: 'test-token',
      },
    };

    const adapter = createOpenClawAdapter(config);

    expect(adapter).toBeInstanceOf(OpenClawAdapter);
    expect(adapter.type).toBe('openclaw');
  });
});
