import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GatewayRouter, createGateway } from '../router.js';
import { getAgentRegistry } from '../../adapters/registry.js';
import { getWorkflow, inferWorkflow } from '../workflows.js';

// Mock dependencies
vi.mock('../../adapters/registry.js', () => ({
  getAgentRegistry: vi.fn()
}));

vi.mock('../workflows.js', () => ({
  getWorkflow: vi.fn(),
  inferWorkflow: vi.fn(),
  getAllWorkflows: vi.fn(),
  interpolateTemplate: vi.fn((t) => t) // Return template as is for tests
}));

describe('GatewayRouter', () => {
  let router: GatewayRouter;
  let mockRegistry: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup mock registry
    mockRegistry = {
      getAdapter: vi.fn(),
      getActiveAdapters: vi.fn().mockReturnValue([]),
    };
    (getAgentRegistry as any).mockReturnValue(mockRegistry);

    // Create fresh router for each test
    router = createGateway({
      maxConcurrent: 2,
      minAgentScore: 10,
    }) as GatewayRouter;
  });

  describe('Routing', () => {
    it('should route to explicit preferred agent if available', async () => {
      const mockAgent = {
        type: 'test-agent',
        name: 'Test Agent',
        capabilities: ['code_generation'],
        executeTask: vi.fn().mockResolvedValue({ success: true, output: 'done' }),
        healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
      };
      
      mockRegistry.getAdapter.mockReturnValue(mockAgent);

      const request = {
        task: { id: '1', title: 'Test', prompt: 'test', labels: [] },
        preferredAgent: 'test-agent'
      };

      const response = await router.execute(request as any);

      expect(response.success).toBe(true);
      expect(response.agent.name).toBe('Test Agent');
      expect(response.routing.method).toBe('explicit');
      expect(mockAgent.executeTask).toHaveBeenCalled();
    });

    it('should route based on capabilities if no explicit agent', async () => {
      const mockAgent = {
        type: 'coder',
        name: 'Coder Agent',
        capabilities: ['code_generation', 'file_operations'],
        executeTask: vi.fn().mockResolvedValue({ success: true, output: 'code done' }),
        healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
      };

      mockRegistry.getActiveAdapters.mockReturnValue([mockAgent]);
      (inferWorkflow as any).mockReturnValue('general');
      (getWorkflow as any).mockReturnValue(null);

      const request = {
        task: { id: '2', title: 'Write code', prompt: 'write feature x', labels: ['feature'] }
      };

      const response = await router.execute(request as any);

      expect(response.success).toBe(true);
      expect(response.agent.type).toBe('coder');
      expect(response.routing.method).toBe('capability_match');
    });

    it('should return error if no agents are available', async () => {
      mockRegistry.getActiveAdapters.mockReturnValue([]);

      const request = {
        task: { id: '3', title: 'No Agent', prompt: 'fail', labels: [] }
      };

      const response = await router.execute(request as any);

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('NO_AGENT_AVAILABLE');
    });
  });

  describe('Constraints & Health', () => {
    it('should respect maxConcurrent limit', async () => {
      // Set maxConcurrent to 1
      router.updateConfig({ maxConcurrent: 1 });

      const mockAgent = {
        type: 'slow-agent',
        name: 'Slow Agent',
        capabilities: ['code_generation'],
        executeTask: () => new Promise(resolve => setTimeout(() => resolve({ success: true }), 100)),
        healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
      };
      mockRegistry.getActiveAdapters.mockReturnValue([mockAgent]);

      // Start first request
      const req1 = router.execute({ task: { id: '4', title: 'T1', prompt: 'P1', labels: [] } } as any);
      
      // Start second request immediately
      const req2 = router.execute({ task: { id: '5', title: 'T2', prompt: 'P2', labels: [] } } as any);

      const [res1, res2] = await Promise.all([req1, req2]);

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(false);
      expect(res2.error?.code).toBe('RATE_LIMITED');
    });

    it('should fail if selected agent is unhealthy', async () => {
      const mockAgent = {
        type: 'sick-agent',
        name: 'Sick Agent',
        capabilities: ['code_generation'],
        executeTask: vi.fn(),
        healthCheck: vi.fn().mockResolvedValue({ healthy: false, message: 'Down for maintenance' }),
      };
      mockRegistry.getActiveAdapters.mockReturnValue([mockAgent]);

      const response = await router.execute({ task: { id: '6', title: 'T6', prompt: 'P6', labels: [] } } as any);

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('AGENT_UNHEALTHY');
      expect(mockAgent.executeTask).not.toHaveBeenCalled();
    });
  });

  describe('Historical Performance & Cooldown', () => {
    it('should apply cooldown on agent failure', async () => {
        const mockAgent = {
          type: 'flaky',
          name: 'Flaky Agent',
          capabilities: ['code_generation'],
          executeTask: vi.fn().mockResolvedValue({ success: false, error: { message: 'Crash' } }),
          healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
        };
        mockRegistry.getActiveAdapters.mockReturnValue([mockAgent]);
  
        // First execution fails
        await router.execute({ task: { id: '7', title: 'T7', prompt: 'P7', labels: [] } } as any);
        
        // Second execution should fail with NO_AGENT_AVAILABLE because the only agent is in cooldown
        const response = await router.execute({ task: { id: '8', title: 'T8', prompt: 'P8', labels: [] } } as any);
  
        expect(response.success).toBe(false);
        expect(response.error?.code).toBe('NO_AGENT_AVAILABLE');
        
        // The top level reason is generic, but the scores have the detail
        expect(response.routing.scores[0].eligible).toBe(false);
        expect(response.routing.scores[0].reason).toContain('cooldown');
      });
  });

  describe('Workflow Execution', () => {
    it('should execute a task as a workflow if autonomous is true', async () => {
      const mockAgent = {
        type: 'autonomous-agent',
        name: 'Auto Agent',
        capabilities: ['code_generation'],
        executeTask: vi.fn()
            .mockResolvedValueOnce({ success: true, output: 'Plan ready' })
            .mockResolvedValueOnce({ success: true, output: 'Implementation done' }),
        healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
      };
      
      mockRegistry.getActiveAdapters.mockReturnValue([mockAgent]);
      
      const mockWorkflow = {
        type: 'autonomous',
        steps: [
          { id: 'plan', name: 'Plan', promptTemplate: 'Plan {{task.title}}', maxRetries: 1, timeoutMs: 1000, expectedOutputs: [] },
          { id: 'implement', name: 'Implement', promptTemplate: 'Implement {{task.title}}', maxRetries: 1, timeoutMs: 1000, expectedOutputs: [] }
        ],
        requiredCapabilities: ['code_generation'],
        continueOnFailure: false
      };
      
      (getWorkflow as any).mockReturnValue(mockWorkflow);
      (inferWorkflow as any).mockReturnValue('autonomous');

      const request = {
        task: { id: '9', title: 'Feature X', prompt: 'P9', labels: [] },
        autonomous: true
      };

      const response = await router.execute(request as any);

      expect(response.success).toBe(true);
      expect(response.workflow?.status).toBe('completed');
      expect(response.workflow?.completedSteps.length).toBe(2);
      expect(mockAgent.executeTask).toHaveBeenCalledTimes(2);
    });

    it('should handle workflow step failure and skip optional steps', async () => {
      const mockAgent = {
        type: 'auto-agent',
        name: 'Auto Agent',
        capabilities: ['code_generation'],
        executeTask: vi.fn()
            .mockResolvedValueOnce({ success: false, error: { message: 'Plan failed' } }),
        healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
      };
      mockRegistry.getActiveAdapters.mockReturnValue([mockAgent]);
      
      const mockWorkflow = {
        type: 'autonomous',
        steps: [
          { id: 'step-1', name: 'Step 1', promptTemplate: 'S1', optional: true, maxRetries: 0, timeoutMs: 1000, expectedOutputs: [] }
        ],
        requiredCapabilities: ['code_generation'],
        continueOnFailure: true
      };
      (getWorkflow as any).mockReturnValue(mockWorkflow);

      const response = await router.execute({ task: { id: 'w-fail', title: 'T', prompt: 'P', labels: [] }, autonomous: true } as any);
      expect(response.workflow?.completedSteps[0].status).toBe('skipped');
    });

    it('should extract artifacts correctly from workflow steps', async () => {
        const mockAgent = {
            type: 'auto-agent',
            capabilities: ['code_generation'],
            executeTask: vi.fn().mockResolvedValue({
                success: true,
                output: 'done',
                artifacts: [
                    { type: 'commit', sha: 'abc123' },
                    { type: 'pull_request', url: 'https://github.com/pr/1' }
                ]
            }),
            healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
            name: 'Auto Agent'
        };
        mockRegistry.getActiveAdapters.mockReturnValue([mockAgent]);

        const mockWorkflow = {
            type: 'autonomous',
            steps: [
                { id: 'step-1', name: 'S1', promptTemplate: 'T1', expectedOutputs: ['step-1'], maxRetries: 0, timeoutMs: 1000 }
            ],
            requiredCapabilities: ['code_generation'],
            continueOnFailure: false
        };
        (getWorkflow as any).mockReturnValue(mockWorkflow);

        const response = await router.execute({ task: { id: 'w-art', title: 'T', prompt: 'P', labels: [] }, autonomous: true } as any);
        expect(response.result.artifacts?.length).toBe(2);
        // @ts-ignore
        expect(response.result.artifacts[0].sha).toBe('abc123');
    });
  });
});
