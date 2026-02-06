import { Hono } from 'hono';
import { getAgentRegistry } from '../adapters/registry.js';
import { getStorage } from '../storage/index.js';
import type { StorageAdapter } from '../storage/adapter.js';
import { createContextualLogger } from '../utils/logger.js';

const agents = new Hono();
const log = createContextualLogger('Agents');
type AgentStats = Awaited<ReturnType<StorageAdapter['getAgentStats']>>;

// List available agents with detailed status
agents.get('/', async (c) => {
  const registry = getAgentRegistry();
  const adapters = registry.getActiveAdapters();
  const storage = getStorage();

  let agentStats: AgentStats = {};
  try {
    agentStats = await storage.getAgentStats();
  } catch (error) {
    log.warn('Could not fetch agent stats', { error: error instanceof Error ? error.message : String(error) });
  }

  const agentList = await Promise.all(
    adapters.map(async (adapter) => {
      const health = await adapter.healthCheck();
      const stats = agentStats[adapter.type] || { completed: 0, failed: 0, avgDuration: 0 };

      return {
        type: adapter.type,
        name: adapter.name,
        description: adapter.description,
        capabilities: adapter.capabilities,
        configured: true,
        healthy: health,
        lastActivity: stats.lastActivity || null,
        stats: {
          completed: stats.completed,
          failed: stats.failed,
          avgDuration: stats.avgDuration,
        },
      };
    })
  );

  return c.json({ agents: agentList });
});

// List adapter types
agents.get('/types', (c) => {
  const registry = getAgentRegistry();
  return c.json({
    types: registry.getAdapterTypes(),
  });
});

export { agents as agentsRoutes };
