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

// --- Multi-Agent Orchestration ---

import { z } from 'zod';
import { orchestrate, cancelOrchestration, listActiveOrchestrations } from '../agents/orchestrator.js';

const subAgentSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  prompt: z.string(),
  systemPrompt: z.string().optional(),
  model: z.string().optional(),
  maxTokens: z.number().optional(),
  timeoutMs: z.number().optional(),
  allowedTools: z.array(z.string()).optional(),
  effort: z.enum(['low', 'medium', 'high']).optional(),
});

const orchestrateSchema = z.object({
  name: z.string().min(1).max(200),
  pattern: z.enum(['fan_out', 'pipeline', 'debate', 'custom']),
  agents: z.array(subAgentSchema).min(1).max(10),
  synthesizerPrompt: z.string().optional(),
  judgePrompt: z.string().optional(),
  timeoutMs: z.number().optional(),
  failFast: z.boolean().optional(),
});

/** Execute a multi-agent orchestration */
agents.post('/orchestrate', async (c) => {
  const body = await c.req.json();
  const parsed = orchestrateSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
  }

  const config = {
    id: crypto.randomUUID(),
    ...parsed.data,
    agents: parsed.data.agents.map((a, i) => ({
      ...a,
      id: a.id || `agent-${i}`,
    })),
  };

  const result = await orchestrate(config);
  return c.json({ success: result.success, data: result });
});

/** Cancel a running orchestration */
agents.post('/orchestrate/:id/cancel', (c) => {
  const cancelled = cancelOrchestration(c.req.param('id'));
  return c.json({ success: cancelled });
});

/** List active orchestrations */
agents.get('/orchestrate/active', (c) => {
  return c.json({ success: true, data: listActiveOrchestrations() });
});

export { agents as agentsRoutes };
