import { describe, it, expect, vi } from 'vitest';
import { DefaultAgentRegistry } from '../registry.js';
import type { AgentConfig } from '../../types/agent.js';

describe('Agent Registry', () => {
  it('should register and create adapters', () => {
    const registry = new DefaultAgentRegistry();
    const mockFactory = vi.fn().mockReturnValue({ name: 'mock' } as any);
    
    registry.registerAdapter('mock-type', mockFactory);
    expect(registry.getAdapterTypes()).toContain('mock-type');

    const config: AgentConfig = {
      id: 'agent-1',
      type: 'mock-type',
      enabled: true,
      priority: 1,
    };

    const adapter = registry.createAdapter(config);
    expect(adapter.name).toBe('mock');
    expect(registry.getAdapter('agent-1')).toBe(adapter);
  });

  it('should find adapter for task by explicit assignment', () => {
    const registry = new DefaultAgentRegistry();
    const mockAdapter = { name: 'test' } as any;
    registry.registerAdapter('type-a', () => mockAdapter);
    registry.createAdapter({ id: 'id-a', type: 'type-a', enabled: true, priority: 1 });

    const task = { assignedAgent: 'id-a', labels: [], title: '', prompt: '' } as any;
    const found = registry.findAdapterForTask(task);
    expect(found).toBe(mockAdapter);
  });

  it('should find adapter by score (labels and type)', () => {
    const registry = new DefaultAgentRegistry();
    const adapterA = { name: 'A' } as any;
    const adapterB = { name: 'B' } as any;

    registry.registerAdapter('type-a', () => adapterA);
    registry.registerAdapter('type-b', () => adapterB);

    registry.createAdapter({ 
      id: 'id-a', 
      type: 'type-a', 
      enabled: true, 
      priority: 1, 
      labels: ['auth'] 
    });
    registry.createAdapter({ 
      id: 'id-b', 
      type: 'type-b', 
      enabled: true, 
      priority: 1, 
      taskTypes: ['bug_fix'] 
    });

    // Task matches 'auth' label (score +10)
    const task1 = { labels: ['auth'], title: '', prompt: '' } as any;
    expect(registry.findAdapterForTask(task1)).toBe(adapterA);

    // Task matches 'bug_fix' type (inferred from title, score +20)
    const task2 = { labels: [], title: 'Fix this bug', prompt: '' } as any;
    expect(registry.findAdapterForTask(task2)).toBe(adapterB);
  });

  it('should respect enabled flag', () => {
    const registry = new DefaultAgentRegistry();
    const mockAdapter = { name: 'test' } as any;
    registry.registerAdapter('type-a', () => mockAdapter);
    registry.createAdapter({ id: 'id-a', type: 'type-a', enabled: false, priority: 1 });

    const task = { labels: [], title: 'Work', prompt: '' } as any;
    const found = registry.findAdapterForTask(task);
    expect(found).toBeUndefined();
  });
});
