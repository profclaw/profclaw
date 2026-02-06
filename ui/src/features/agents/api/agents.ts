import { useQuery } from '@tanstack/react-query';

const API_BASE = 'http://localhost:3000';

export interface Agent {
  type: string;
  name: string;
  description: string;
  capabilities: string[];
  configured: boolean;
  healthy: {
    healthy: boolean;
    latencyMs: number;
  };
  lastActivity: string | null;
  stats: {
    completed: number;
    failed: number;
    avgDuration: number;
  };
}

export function useAgents() {
  return useQuery({
    queryKey: ['agents'],
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/api/agents`);
      if (!response.ok) {
        throw new Error('Failed to fetch agents');
      }
      const data = await response.json();
      return data.agents as Agent[];
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  });
}
