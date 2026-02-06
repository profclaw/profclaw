import { Hono } from 'hono';
import { getGateway, type GatewayRequest, type WorkflowType } from '../gateway/index.js';
import { CreateTaskSchema } from '../types/task.js';
import { addTask } from '../queue/task-queue.js';
import { tokenAuthMiddleware } from '../auth/api-tokens.js';

const gateway = new Hono();

// Execute task through gateway (unified routing)
gateway.post('/execute', async (c) => {
  try {
    const body = await c.req.json();
    const gw = getGateway();

    const request: GatewayRequest = {
      task: body.task,
      preferredAgent: body.preferredAgent,
      workflow: body.workflow as WorkflowType,
      timeoutMs: body.timeoutMs,
      priority: body.priority,
      autonomous: body.autonomous ?? false,
      context: body.context,
    };

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
    console.error('[Gateway] Execute error:', error);
    return c.json({
      error: 'Gateway execution failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Protected gateway endpoint (requires token)
gateway.post('/execute-secure', tokenAuthMiddleware(['gateway:execute']), async (c) => {
  try {
    const body = await c.req.json();
    const gw = getGateway();

    const request: GatewayRequest = {
      task: body.task,
      preferredAgent: body.preferredAgent,
      workflow: body.workflow as WorkflowType,
      timeoutMs: body.timeoutMs,
      priority: body.priority,
      autonomous: body.autonomous ?? false,
      context: body.context,
    };

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
  } catch (error) {
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
    const body = await c.req.json();
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
