import { Hono } from 'hono';
import type { Context } from 'hono';
import { createContextualLogger } from '../utils/logger.js';

const log = createContextualLogger('Gateway');
import type { GatewayRequest, WorkflowType } from '../gateway/index.js';
import type { GatewayContext } from '../gateway/types.js';
import { CreateTaskSchema } from '../types/task.js';
import { addTask } from '../queue/index.js';
import { tokenAuthMiddleware } from '../auth/api-tokens.js';

const gateway = new Hono();
let gatewayRuntimePromise: Promise<void> | null = null;
let getGateway: typeof import('../gateway/index.js')['getGateway'];

async function ensureGatewayRuntime(): Promise<void> {
  if (!gatewayRuntimePromise) {
    gatewayRuntimePromise = import('../gateway/index.js')
      .then((gatewayModule) => {
        getGateway = gatewayModule.getGateway;
      })
      .catch((error) => {
        gatewayRuntimePromise = null;
        throw error;
      });
  }

  await gatewayRuntimePromise;
}

gateway.use('*', async (c, next) => {
  try {
    await ensureGatewayRuntime();
  } catch {
    return c.json({ error: 'Gateway runtime unavailable' }, 500);
  }

  await next();
});

async function parseJsonBody(c: Context): Promise<
  { ok: true; body: Record<string, unknown> } | { ok: false; response: Response }
> {
  try {
    const body = await c.req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return {
        ok: false,
        response: c.json({ error: 'Request body must be a JSON object' }, 400),
      };
    }

    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      response: c.json({ error: 'Invalid JSON body' }, 400),
    };
  }
}

function buildGatewayRequest(body: Record<string, unknown>): GatewayRequest | null {
  const task = body.task;
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    return null;
  }

  return {
    task: task as GatewayRequest['task'],
    preferredAgent: typeof body.preferredAgent === 'string' ? body.preferredAgent : undefined,
    workflow: typeof body.workflow === 'string' ? body.workflow as WorkflowType : undefined,
    timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined,
    priority: typeof body.priority === 'number' ? body.priority : undefined,
    autonomous: typeof body.autonomous === 'boolean' ? body.autonomous : false,
    context: body.context && typeof body.context === 'object' && !Array.isArray(body.context)
      ? body.context as GatewayContext
      : undefined,
  };
}

// Execute task through gateway (unified routing)
gateway.post('/execute', async (c) => {
  try {
    const parsed = await parseJsonBody(c);
    if (!parsed.ok) {
      return parsed.response;
    }

    const body = parsed.body;
    const gw = getGateway();

    const request = buildGatewayRequest(body);
    if (!request) {
      return c.json({ error: 'Invalid task' }, 400);
    }

    if (!request.task.id) {
      const parsed = CreateTaskSchema.safeParse(request.task);
      if (!parsed.success) {
        return c.json({ error: 'Invalid task', details: parsed.error.flatten() }, 400);
      }
      const createdTask = await addTask(parsed.data);
      request.task = createdTask;
    }

    const response = await gw.execute(request);

    return c.json({
      success: response.success,
      result: response.result,
      agent: response.agent,
      routing: response.routing,
      workflow: response.workflow,
      error: response.error,
      metrics: response.metrics,
    });
  } catch (error) {
    log.error('Execute error', error instanceof Error ? error : new Error(String(error)));
    return c.json({
      error: 'Gateway execution failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Protected gateway endpoint (requires token)
gateway.post('/execute-secure', tokenAuthMiddleware(['gateway:execute']), async (c) => {
  try {
    const parsed = await parseJsonBody(c);
    if (!parsed.ok) {
      return parsed.response;
    }

    const body = parsed.body;
    const gw = getGateway();

    const request = buildGatewayRequest(body);
    if (!request) {
      return c.json({ error: 'Invalid task' }, 400);
    }

    if (!request.task.id) {
      const parsed = CreateTaskSchema.safeParse(request.task);
      if (!parsed.success) {
        return c.json({ error: 'Invalid task', details: parsed.error.flatten() }, 400);
      }
      const createdTask = await addTask(parsed.data);
      request.task = createdTask;
    }

    const response = await gw.execute(request);
    return c.json(response);
  } catch {
    return c.json({ error: 'Gateway execution failed' }, 500);
  }
});

// Get gateway status (online/offline, metrics, connected agents)
gateway.get('/status', async (c) => {
  const gw = getGateway();
  const status = gw.getStatus();
  const agents = gw.getAgents();

  // Get health for all agents
  const agentHealth = await Promise.all(
    agents.map(async (agent) => {
      const health = await gw.getAgentHealth(agent.type);
      return {
        type: agent.type,
        name: agent.name,
        healthy: health.healthy,
        latencyMs: health.latencyMs,
        message: health.message,
        load: status.agentLoads[agent.type] || 0,
      };
    })
  );

  const healthyCount = agentHealth.filter((a) => a.healthy).length;
  const totalLoad = Object.values(status.agentLoads).reduce((sum, load) => sum + load, 0);

  // Calculate throughput from history
  const totalTasks = status.history.reduce((sum, h) => sum + h.totalTasks, 0);
  const successfulTasks = status.history.reduce((sum, h) => sum + h.successfulTasks, 0);
  const avgDuration = status.history.length > 0
    ? status.history.reduce((sum, h) => sum + h.averageDurationMs, 0) / status.history.length
    : 0;

  return c.json({
    status: {
      online: status.online,
      uptime: status.uptime,
      activeRequests: status.activeRequests,
      maxConcurrent: status.maxConcurrent,
      utilizationPercent: status.maxConcurrent > 0
        ? Math.round((status.activeRequests / status.maxConcurrent) * 100)
        : 0,
    },
    agents: {
      total: agents.length,
      healthy: healthyCount,
      unhealthy: agents.length - healthyCount,
      totalLoad,
      list: agentHealth,
    },
    metrics: {
      totalTasks,
      successfulTasks,
      successRate: totalTasks > 0 ? Math.round((successfulTasks / totalTasks) * 100) : 0,
      averageDurationMs: Math.round(avgDuration),
    },
    history: status.history,
  });
});

// Get gateway agents with health
gateway.get('/agents', async (c) => {
  const gw = getGateway();
  const agents = gw.getAgents();

  const agentList = await Promise.all(
    agents.map(async (agent) => {
      const health = await gw.getAgentHealth(agent.type);
      return {
        type: agent.type,
        name: agent.name,
        description: agent.description,
        capabilities: agent.capabilities,
        health,
      };
    })
  );

  return c.json({ agents: agentList, count: agentList.length });
});

// Get available workflows
gateway.get('/workflows', (c) => {
  const gw = getGateway();
  const workflows = gw.getWorkflowTemplates();

  return c.json({
    workflows: workflows.map((w) => ({
      type: w.type,
      name: w.name,
      description: w.description,
      steps: w.steps.length,
      requiredCapabilities: w.requiredCapabilities,
      defaultTimeoutMs: w.defaultTimeoutMs,
    })),
  });
});

// Get specific workflow details
gateway.get('/workflows/:type', (c) => {
  const type = c.req.param('type') as WorkflowType;
  const gw = getGateway();
  const workflow = gw.getWorkflow(type);

  if (!workflow) {
    return c.json({ error: 'Workflow not found' }, 404);
  }

  return c.json({ workflow });
});

// Get gateway configuration
gateway.get('/config', (c) => {
  const gw = getGateway();
  return c.json({ config: gw.getConfig() });
});

// Update gateway configuration
gateway.patch('/config', async (c) => {
  try {
    const parsed = await parseJsonBody(c);
    if (!parsed.ok) {
      return parsed.response;
    }

    const body = parsed.body;
    const gw = getGateway();
    gw.updateConfig(body);

    return c.json({
      message: 'Gateway config updated',
      config: gw.getConfig(),
    });
  } catch (error) {
    return c.json({
      error: 'Failed to update config',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

export { gateway as gatewayRoutes };
