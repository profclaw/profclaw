import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GatewayRouter } from '../router.js';
import { getAgentRegistry } from '../../adapters/registry.js';

vi.mock('../../adapters/registry.js', () => ({
  getAgentRegistry: vi.fn()
}));

describe('GatewayRouter Scoring', () => {
  let router: GatewayRouter;
  let mockRegistry: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRegistry = {
      getAdapter: vi.fn(),
      getActiveAdapters: vi.fn(),
    };
    (getAgentRegistry as any).mockReturnValue(mockRegistry);
    router = new GatewayRouter({ minAgentScore: 0 });
  });

  it('should favor agents with matching capabilities', async () => {
    const agent1 = {
      type: 'coder',
      name: 'Coder',
      capabilities: ['code_generation'],
      healthCheck: () => ({ healthy: true }),
      executeTask: () => ({ success: true }),
    };
    const agent2 = {
      type: 'writer',
      name: 'Writer',
      capabilities: ['documentation'],
      healthCheck: () => ({ healthy: true }),
      executeTask: () => ({ success: true }),
    };

    mockRegistry.getActiveAdapters.mockReturnValue([agent1, agent2]);

    const request = {
      task: { id: '1', title: 'Write code', prompt: 'test', labels: [] },
      workflow: 'feature' // requires code_generation
    };

    const response = await router.execute(request as any);
    expect(response.agent.type).toBe('coder');
    expect(response.routing.scores.find(s => s.agentType === 'coder')?.totalScore)
      .toBeGreaterThan(response.routing.scores.find(s => s.agentType === 'writer')?.totalScore || 0);
  });

  it('should apply load penalty', async () => {
    const agent1 = {
      type: 'agent1',
      name: 'Agent 1',
      capabilities: ['code_generation'],
      healthCheck: () => ({ healthy: true }),
      executeTask: () => new Promise(r => setTimeout(() => r({ success: true }), 10)),
    };
    const agent2 = {
      type: 'agent2',
      name: 'Agent 2',
      capabilities: ['code_generation'],
      healthCheck: () => ({ healthy: true }),
      executeTask: () => new Promise(r => setTimeout(() => r({ success: true }), 10)),
    };

    mockRegistry.getActiveAdapters.mockReturnValue([agent1, agent2]);
    mockRegistry.getAdapter.mockImplementation((id: string) => id === 'agent1' ? agent1 : agent2);

    // Initial state: both have 0 load. agent1 is picked first (alphabetical/order)
    // We'll execute one task on agent1 to give it load
    const p1 = router.execute({ task: { id: 't1', title: 'T1', prompt: 'P', labels: [] } } as any);
    
    // Give it a tiny bit of time to pass the health check and increment load
    // We need at least 2 ticks (one for routeTask, one for healthCheck)
    await new Promise(r => setTimeout(r, 10)); 
    
    // While t1 is running, t2 should favor agent2 because agent1 has load
    const response2 = await router.execute({ task: { id: 't2', title: 'T2', prompt: 'P', labels: [] } } as any);
    
    expect(response2.agent.instanceId).toBe('agent2');
    
    await p1;
  });

  it('should favor agents with better historical success', async () => {
    const agent1 = {
      type: 'reliable',
      name: 'Reliable',
      capabilities: ['code_generation'],
      healthCheck: () => ({ healthy: true }),
      executeTask: vi.fn().mockResolvedValue({ success: true }),
    };
    const agent2 = {
      type: 'unreliable',
      name: 'Unreliable',
      capabilities: ['code_generation'],
      healthCheck: () => ({ healthy: true }),
      executeTask: vi.fn().mockResolvedValue({ success: false, error: { message: 'fail' } }),
    };

    mockRegistry.getActiveAdapters.mockReturnValue([agent1, agent2]);
    mockRegistry.getAdapter.mockImplementation((id: string) => id === 'reliable' ? agent1 : agent2);

    // Run some tasks to build history
    // unreliable fails
    await router.execute({ task: { id: 'h1', title: 'T', prompt: 'P', labels: [] }, preferredAgent: 'unreliable' } as any);
    // reliable succeeds
    await router.execute({ task: { id: 'h2', title: 'T', prompt: 'P', labels: [] }, preferredAgent: 'reliable' } as any);

    // Now a neutral task should pick reliable
    const response = await router.execute({ task: { id: 'h3', title: 'T', prompt: 'P', labels: [] } } as any);
    expect(response.agent.type).toBe('reliable');
    
    const reliableScore = response.routing.scores.find(s => s.agentType === 'reliable');
    const unreliableScore = response.routing.scores.find(s => s.agentType === 'unreliable');
    
    expect(reliableScore?.breakdown.historicalSuccess).toBeGreaterThan(unreliableScore?.breakdown.historicalSuccess || 0);
  });
});
