import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { createServer } from 'net';

// Core imports - keep static only for truly essential boot utilities
import { loadConfig } from './utils/config-loader.js';
import { createContextualLogger } from './utils/logger.js';

const appLog = createContextualLogger('Server');
import { validateEnvironment, getConfiguredIntegrations, getConfiguredAIProviders } from './utils/env-validator.js';
import { initApiTokensTable, tokenAuthMiddleware } from './auth/api-tokens.js';
import { authMiddleware } from './auth/middleware.js';
import { rateLimit } from './middleware/rate-limit.js';
import type { GatewayRequest, WorkflowType } from './gateway/index.js';
import type { AgentConfig } from './types/agent.js';
import { CreateTaskSchema } from './types/task.js';
import { getMode, getModeLabel, hasCapability } from './core/deployment.js';
import { registerRouteModules } from './server/route-loader.js';

const VERSION = '2.0.0';

interface SettingsYaml {
  server: {
    port: number;
    cors: {
      origin: string;
    };
    enableCron: boolean;
  };
  agents?: {
    autoDiscover?: boolean;
  };
}

let cachedSettings: SettingsYaml | null = null;

function getAppSettings(): SettingsYaml {
  if (!cachedSettings) {
    cachedSettings = loadConfig<SettingsYaml>('settings.yml');
  }
  return cachedSettings;
}

function getPort(): number {
  const appSettings = getAppSettings();
  return parseInt(process.env.PORT || appSettings.server?.port?.toString() || '3000');
}

function isCronEnabled(): boolean {
  const appSettings = getAppSettings();
  return process.env.ENABLE_CRON !== undefined
    ? process.env.ENABLE_CRON !== 'false'
    : (appSettings.server?.enableCron !== undefined ? appSettings.server.enableCron : true);
}

const app = new Hono();
export { app };

// === Middleware ===

const log = logger();
app.use('*', (c, next) => {
  if (c.req.path === '/health') {
    return next();
  }
  return log(c, next);
});

// CORS configuration
// When credentials: true, origin cannot be "*" - must be explicit or dynamic
// Priority: CORS_ORIGIN env var > settings.yml > dynamic localhost fallback
// Default safe origins for development (localhost on common ports)
const DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:4173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
];

app.use(
  '*',
  cors({
    origin: (origin) => {
      const configuredOrigin = process.env.CORS_ORIGIN || getAppSettings().server?.cors?.origin;
      if (configuredOrigin && configuredOrigin !== '*') {
        return configuredOrigin;
      }

      // In development: allow localhost origins
      // In production without CORS_ORIGIN: only allow same-origin
      if (!origin) return '';
      if (DEFAULT_ORIGINS.includes(origin)) return origin;
      // Allow any *.localhost or 127.0.0.1 origin for dev flexibility
      try {
        const url = new URL(origin);
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return origin;
      } catch {
        // invalid origin
      }
      // Production: require explicit CORS_ORIGIN config
      if (process.env.NODE_ENV === 'production') return '';
      return origin; // Dev fallback: allow all (only in non-production)
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    credentials: true,
  })
);

// Authentication middleware — applied to all /api/* routes
// Skips public routes (auth, setup, webhooks, messaging channels)
app.use('/api/*', authMiddleware());

// HTTP rate limiting (sliding window, per-IP)
const apiRateLimiter = rateLimit({
  maxRequests: parseInt(process.env['API_RATE_LIMIT'] ?? '100', 10),
  windowMs: 60_000,
});
const authRateLimiter = rateLimit({
  maxRequests: parseInt(process.env['AUTH_RATE_LIMIT'] ?? '20', 10),
  windowMs: 60_000,
});
app.use('/api/*', apiRateLimiter);
app.use('/auth/*', authRateLimiter);

// === Core Routes ===

// Health check
app.get('/health', async (c) => {
  const { getHealthStatus } = await import('./cron/index.js');
  const { getQueueType } = await import('./queue/index.js');
  const agentHealth = getHealthStatus();
  return c.json({
    status: 'ok',
    service: 'profclaw',
    version: VERSION,
    mode: getMode(),
    queue: getQueueType() || 'not_initialized',
    timestamp: new Date().toISOString(),
    agents: agentHealth,
  });
});

// API info
app.get('/', (c) => {
  return c.json({
    name: 'profClaw',
    version: VERSION,
    description: 'AI Agent Task Orchestration - Autonomous Mode',
    docs: '/docs',
    endpoints: {
      health: 'GET /health',
      tasks: 'GET /api/tasks',
      createTask: 'POST /api/tasks',
      getTask: 'GET /api/tasks/:id',
      cancelTask: 'POST /api/tasks/:id/cancel',
      retryTask: 'POST /api/tasks/:id/retry',
      agents: 'GET /api/agents',
      deadLetterQueue: 'GET /api/dlq',
      retryDlqTask: 'POST /api/dlq/:id/retry',
      webhooks: {
        github: 'POST /webhooks/github',
        jira: 'POST /webhooks/jira',
        linear: 'POST /webhooks/linear',
      },
      hooks: {
        toolUse: 'POST /api/hook/tool-use',
        sessionEnd: 'POST /api/hook/session-end',
        promptSubmit: 'POST /api/hook/prompt-submit',
        sessions: 'GET /api/hook/sessions',
        sessionEvents: 'GET /api/hook/sessions/:sessionId/events',
        sessionSummary: 'GET /api/hook/sessions/:sessionId/summary',
      },
      agentWebhooks: {
        openclaw: 'POST /api/hook/webhook/openclaw',
        generic: 'POST /api/hook/webhook/agent',
        reports: 'GET /api/hook/webhook/reports',
        taskReports: 'GET /api/hook/webhook/tasks/:taskId/reports',
      },
      costs: {
        summary: 'GET /api/costs/summary',
        budget: 'GET /api/costs/budget',
      },
      summaries: {
        list: 'GET /api/summaries',
        create: 'POST /api/summaries',
        get: 'GET /api/summaries/:id',
        delete: 'DELETE /api/summaries/:id',
        search: 'GET /api/summaries/search',
        stats: 'GET /api/summaries/stats',
        recent: 'GET /api/summaries/recent',
        byTask: 'GET /api/tasks/:taskId/summaries',
      },
      settings: {
        get: 'GET /api/settings',
        update: 'PATCH /api/settings',
        reset: 'POST /api/settings/reset',
      },
      gateway: {
        execute: 'POST /api/gateway/execute',
        agents: 'GET /api/gateway/agents',
        workflows: 'GET /api/gateway/workflows',
        workflow: 'GET /api/gateway/workflows/:type',
        config: 'GET /api/gateway/config',
        updateConfig: 'PATCH /api/gateway/config',
      },
      search: {
        semantic: 'GET /api/search/semantic?q={query}',
        text: 'GET /api/search/text?q={query}',
        capabilities: 'GET /api/search/capabilities',
      },
      tickets: {
        list: 'GET /api/tickets',
        create: 'POST /api/tickets',
        get: 'GET /api/tickets/:id',
        update: 'PATCH /api/tickets/:id',
        delete: 'DELETE /api/tickets/:id',
        transition: 'POST /api/tickets/:id/transition',
        assignAgent: 'POST /api/tickets/:id/assign-agent',
        comments: 'GET /api/tickets/:id/comments',
        addComment: 'POST /api/tickets/:id/comments',
        links: 'GET /api/tickets/:id/links',
        addLink: 'POST /api/tickets/:id/links',
        history: 'GET /api/tickets/:id/history',
      },
      projects: {
        list: 'GET /api/projects',
        create: 'POST /api/projects',
        get: 'GET /api/projects/:id',
        update: 'PATCH /api/projects/:id',
        archive: 'POST /api/projects/:id/archive',
        delete: 'DELETE /api/projects/:id',
        byKey: 'GET /api/projects/by-key/:key',
        default: 'GET /api/projects/default',
        migrate: 'POST /api/projects/migrate',
        externalLinks: 'GET /api/projects/:id/external-links',
        addExternalLink: 'POST /api/projects/:id/external-links',
      },
      sprints: {
        list: 'GET /api/projects/:projectId/sprints',
        create: 'POST /api/projects/:projectId/sprints',
        get: 'GET /api/projects/:projectId/sprints/:sprintId',
        update: 'PATCH /api/projects/:projectId/sprints/:sprintId',
        start: 'POST /api/projects/:projectId/sprints/:sprintId/start',
        complete: 'POST /api/projects/:projectId/sprints/:sprintId/complete',
        cancel: 'POST /api/projects/:projectId/sprints/:sprintId/cancel',
        delete: 'DELETE /api/projects/:projectId/sprints/:sprintId',
        active: 'GET /api/projects/:projectId/sprints/active',
        tickets: 'GET /api/projects/:projectId/sprints/:sprintId/tickets',
        addTickets: 'POST /api/projects/:projectId/sprints/:sprintId/tickets',
        removeTicket: 'DELETE /api/projects/:projectId/sprints/:sprintId/tickets/:ticketId',
        reorderTickets: 'PUT /api/projects/:projectId/sprints/:sprintId/tickets/reorder',
      },
    },
  });
});

// Task statistics
app.get('/api/stats', async (c) => {
  const { getTasks } = await import('./queue/index.js');
  const allTasks = getTasks({ limit: 10000 });
  const stats = {
    pending: 0,
    inProgress: 0,
    completed: 0,
    failed: 0,
    total: allTasks.length,
  };

  for (const task of allTasks) {
    if (task.status === 'pending' || task.status === 'queued') {
      stats.pending++;
    } else if (task.status === 'in_progress' || task.status === 'assigned') {
      stats.inProgress++;
    } else if (task.status === 'completed') {
      stats.completed++;
    } else if (task.status === 'failed') {
      stats.failed++;
    }
  }

  return c.json(stats);
});

// Get summaries for a task (nested route that spans two domains)
app.get('/api/tasks/:taskId/summaries', async (c) => {
  const { getTaskSummaries } = await import('./summaries/index.js');
  const taskId = c.req.param('taskId');
  const summaries = await getTaskSummaries(taskId);

  return c.json({
    taskId,
    summaries,
    count: summaries.length,
  });
});

// Integration status
app.get('/api/integrations/status', (c) => {
  const baseUrl = process.env.BASE_URL || `http://localhost:${getPort()}`;

  const integrations = {
    github: {
      name: 'GitHub',
      configured: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
      webhookUrl: `${baseUrl}/webhooks/github`,
      oauthUrl: `${baseUrl}/auth/github`,
      icon: 'github',
      description: 'Issues and Pull Requests',
    },
    jira: {
      name: 'Jira',
      configured: Boolean(process.env.JIRA_CLIENT_ID && process.env.JIRA_CLIENT_SECRET),
      webhookUrl: `${baseUrl}/webhooks/jira`,
      oauthUrl: `${baseUrl}/auth/jira`,
      icon: 'jira',
      description: 'Issues and Projects',
    },
    linear: {
      name: 'Linear',
      configured: Boolean(process.env.LINEAR_CLIENT_ID && process.env.LINEAR_CLIENT_SECRET),
      webhookUrl: `${baseUrl}/webhooks/linear`,
      oauthUrl: `${baseUrl}/auth/linear`,
      icon: 'linear',
      description: 'Issues and Cycles',
    },
  };

  return c.json({
    integrations,
    baseUrl,
    hookEndpoints: {
      toolUse: `${baseUrl}/api/hook/tool-use`,
      sessionEnd: `${baseUrl}/api/hook/session-end`,
      promptSubmit: `${baseUrl}/api/hook/prompt-submit`,
    },
  });
});

// === Server-Sent Events (SSE) ===

interface SseConnection {
  controller: ReadableStreamDefaultController<Uint8Array>;
  heartbeat: ReturnType<typeof setInterval>;
  connectedAt: number;
  lastPingAt: number;
}

const sseConnections = new Map<string, SseConnection>();

// Stale SSE connection cleanup (no successful ping in 90s)
const SSE_STALE_MS = parseInt(process.env['SSE_STALE_TIMEOUT_MS'] ?? '90000', 10);
const sseCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, conn] of sseConnections) {
    if (now - conn.lastPingAt > SSE_STALE_MS) {
      try {
        clearInterval(conn.heartbeat);
        conn.controller.close();
      } catch { /* already closed */ }
      sseConnections.delete(id);
    }
  }
}, 30000);

export function broadcastEvent(eventType: string, data: unknown) {
  const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  const encoder = new TextEncoder();
  const bytes = encoder.encode(message);

  for (const [id, conn] of sseConnections) {
    try {
      conn.controller.enqueue(bytes);
    } catch {
      // Connection dead - remove it
      try { clearInterval(conn.heartbeat); } catch { /* noop */ }
      sseConnections.delete(id);
    }
  }
}

let sseConnectionCounter = 0;

app.get('/api/events', (c) => {
  const encoder = new TextEncoder();
  const connId = `sse-${++sseConnectionCounter}`;

  const stream = new ReadableStream({
    start(controller) {
      const now = Date.now();
      const heartbeat = setInterval(() => {
        try {
          const ping = `event: ping\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`;
          controller.enqueue(encoder.encode(ping));
          // Update lastPingAt on successful enqueue
          const conn = sseConnections.get(connId);
          if (conn) conn.lastPingAt = Date.now();
        } catch {
          clearInterval(heartbeat);
          sseConnections.delete(connId);
        }
      }, 30000);

      sseConnections.set(connId, {
        controller,
        heartbeat,
        connectedAt: now,
        lastPingAt: now,
      });

      const connectMsg = `event: connected\ndata: ${JSON.stringify({
        message: 'Connected to profClaw event stream',
        timestamp: new Date().toISOString()
      })}\n\n`;
      controller.enqueue(encoder.encode(connectMsg));

      c.req.raw.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        sseConnections.delete(connId);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
    cancel() {
      // Cleanup handled by abort handler
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

// === Protected Gateway Endpoint ===

app.post('/api/gateway/execute-secure', tokenAuthMiddleware(['gateway:execute']), async (c) => {
  try {
    const body = await c.req.json();
    const { getGateway } = await import('./gateway/index.js');
    const gateway = getGateway();

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
      const { addTask } = await import('./queue/index.js');
      const createdTask = await addTask(parsed.data);
      request.task = createdTask;
    }

    const response = await gateway.execute(request);
    return c.json(response);
  } catch {
    return c.json({ error: 'Gateway execution failed' }, 500);
  }
});

// === Mount Route Modules (mode-aware, lazy-loaded) ===
await registerRouteModules(app, getMode());

// Alias /api/plugins to /api/settings/plugins for backwards compat
app.get('/api/plugins/health', async (c) => {
  return c.redirect('/api/settings/plugins/health');
});
app.post('/api/plugins/:id/toggle', async (c) => {
  const id = c.req.param('id');
  return c.redirect(`/api/settings/plugins/${id}/toggle`, 307);
});

// === Server Startup ===

function checkPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      resolve(err.code !== 'EADDRINUSE');
    });
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '127.0.0.1');
  });
}

async function main() {
  // Only start IF we are the main module actually being executed
  const isMain = process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');
  if (!isMain && process.env.NODE_ENV === 'test') {
    return;
  }
  const mode = getMode();
  const appSettings = getAppSettings();
  const PORT = getPort();
  const ENABLE_CRON = isCronEnabled();
  appLog.info('profClaw starting', { version: VERSION, mode: getModeLabel() });

  // Early port conflict detection
  const portAvailable = await checkPortAvailable(PORT);
  if (!portAvailable) {
    appLog.error(`Port ${PORT} is already in use`, new Error(`EADDRINUSE: Port ${PORT}`));
    process.exit(1);
  }

  // Validate environment variables (fail fast if critical vars missing)
  const envResult = validateEnvironment({
    exitOnError: process.env.NODE_ENV === 'production',
    logResults: true,
  });

  if (!envResult.valid && process.env.NODE_ENV === 'production') {
    appLog.error('Cannot start in production with invalid environment');
    process.exit(1);
  }

  // Log configured integrations
  const aiProviders = getConfiguredAIProviders();
  const integrations = getConfiguredIntegrations();
  if (aiProviders.length > 0) {
    appLog.info('AI providers configured', { providers: aiProviders });
  }
  if (integrations.length > 0) {
    appLog.info('Integrations configured', { integrations });
  }

  // Initialize storage FIRST (queue needs it for persistence)
  try {
    const { initStorage } = await import('./storage/index.js');
    await initStorage();
    appLog.info('Storage initialized');

    await initApiTokensTable();
    appLog.info('API tokens table initialized');

    // Initialize conversation tables for chat history
    if (hasCapability('chat_channels') || hasCapability('web_ui')) {
      const { initConversationTables } = await import('./chat/conversations.js');
      await initConversationTables();
      appLog.info('Chat conversations initialized');
    }

    // Register messenger-to-AI pipeline (only if chat channels enabled)
    if (hasCapability('chat_channels')) {
      const { registerMessageHandler } = await import('./chat/message-handler.js');
      registerMessageHandler();
      appLog.info('Messenger AI handler registered');
    }

    // Load saved AI provider configurations from database (skip in pico - loaded on first use)
    if (hasCapability('chat_channels') || hasCapability('web_ui')) {
      const [{ aiProvider }, { loadAllProviderConfigs }] = await Promise.all([
        import('./providers/index.js'),
        import('./storage/index.js'),
      ]);
      const loadedProviders = await aiProvider.loadSavedConfigs(loadAllProviderConfigs);
      if (loadedProviders > 0) {
        appLog.info('Loaded saved AI provider configs', { count: loadedProviders });
      }
    }

    // Initialize skills registry (only if web UI enabled)
    if (hasCapability('web_ui')) {
      try {
        const { initializeSkillsRegistry } = await import('./skills/index.js');
        const skillsRegistry = await initializeSkillsRegistry({
          workspaceDir: process.cwd(),
        });
        appLog.info('Skills loaded', { count: skillsRegistry.getLoadedSkillNames().length });
      } catch (error) {
        appLog.warn('Skills initialization failed', { error: error instanceof Error ? error.message : String(error) });
      }
    }
  } catch (error) {
    appLog.error('Failed to initialize storage', error instanceof Error ? error : new Error(String(error)));
    appLog.warn('Running with in-memory storage only');
  }

  // Initialize task queue (Redis or in-memory based on mode)
  try {
    const { initQueue, registerSSEBroadcaster } = await import('./queue/index.js');
    await initQueue();
    registerSSEBroadcaster(broadcastEvent);
    const { getQueueType } = await import('./queue/index.js');
    appLog.info('Task queue initialized', { queueType: getQueueType() });
    appLog.info('SSE event stream registered');
  } catch (error) {
    appLog.error('Failed to initialize task queue', error instanceof Error ? error : new Error(String(error)));
    appLog.warn('Tasks will not be processed');
  }

  // Initialize sync engine (pro mode or if explicitly configured)
  if (hasCapability('sync_engine')) {
    try {
      const { initSyncIntegration } = await import('./sync/index.js');
      const syncEngine = await initSyncIntegration();
      if (syncEngine) {
        appLog.info('Sync engine initialized');
      } else {
        appLog.info('Sync engine disabled (enable in config/settings.yml)');
      }
    } catch (error) {
      appLog.warn('Sync engine initialization failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  // Initialize cost tracking (skip in pico - loaded on first use)
  if (getMode() !== 'pico') {
    const { initTokenTracker } = await import('./costs/token-tracker.js');
    initTokenTracker();
    appLog.info('Token tracker initialized');
  }

  // Initialize agents from config
  const { getAgentRegistry } = await import('./adapters/registry.js');
  const registry = getAgentRegistry();

  interface AgentsYaml {
    agents: AgentConfig[];
  }

  const agentsConfig = loadConfig<AgentsYaml>('agents.yml');

  if (agentsConfig.agents && Array.isArray(agentsConfig.agents)) {
    for (const agentDef of agentsConfig.agents) {
      try {
        if (agentDef.type === 'openclaw' && !agentDef.config?.token) {
          appLog.info('Skipping agent: missing OPENCLAW_GATEWAY_TOKEN', { agentId: agentDef.id });
          continue;
        }

        if (agentDef.type === 'claude-code' && !agentDef.config?.workingDir) {
          appLog.info('Skipping agent: missing CLAUDE_WORKING_DIR', { agentId: agentDef.id });
          continue;
        }

        // Check if Ollama is reachable before configuring
        if (agentDef.type === 'ollama') {
          const ollamaUrl = agentDef.config?.baseUrl || 'http://localhost:11434';
          try {
            const resp = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
            if (!resp.ok) {
              appLog.info('Skipping agent: Ollama not responding', { agentId: agentDef.id, url: ollamaUrl });
              continue;
            }
          } catch {
            appLog.info('Skipping agent: Ollama not running', { agentId: agentDef.id, url: ollamaUrl });
            continue;
          }
        }

        registry.createAdapter(agentDef);
        appLog.info('Agent configured', { agentId: agentDef.id, type: agentDef.type });
      } catch (error) {
        appLog.error(`Failed to configure agent ${agentDef.id}`, error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  // Auto-discover agents if enabled (skip in pico mode to save startup time/memory)
  const autoDiscover = mode !== 'pico' && (
    process.env.AUTO_DISCOVER_AGENTS !== undefined
      ? process.env.AUTO_DISCOVER_AGENTS === 'true'
      : (appSettings.agents?.autoDiscover ?? false)
  );

  if (autoDiscover && !registry.getActiveAdapters().some(a => a.type === 'claude-code')) {
    try {
      const { execSync } = await import('child_process');
      execSync('which claude', { stdio: 'ignore' });
      registry.createAdapter({
        id: 'claude-code-auto',
        type: 'claude-code',
        enabled: true,
        maxConcurrent: 1,
        priority: 5,
        config: {
          workingDir: process.env.CLAUDE_WORKING_DIR || process.cwd(),
        },
      });
      appLog.info('Claude Code adapter auto-discovered (CLI found)');
    } catch {
      // CLI not found
    }
  }

  // Auto-discover Ollama if running locally
  if (autoDiscover && !registry.getActiveAdapters().some(a => a.type === 'ollama')) {
    try {
      const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
      const response = await fetch(`${ollamaUrl}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        registry.createAdapter({
          id: 'ollama-auto',
          type: 'ollama',
          enabled: true,
          maxConcurrent: 2,
          priority: 3,
          config: {
            baseUrl: ollamaUrl,
            model: process.env.OLLAMA_MODEL || 'llama3.2',
          },
        });
        appLog.info('Ollama adapter auto-discovered (server running)');
      }
    } catch {
      // Ollama not running
    }
  }

  // Start cron jobs (if mode supports it and enabled)
  if (ENABLE_CRON && hasCapability('cron')) {
    const { startAllCronJobs } = await import('./cron/index.js');
    startAllCronJobs();
    appLog.info('Cron jobs started (autonomous mode)');
  } else if (!hasCapability('cron')) {
    appLog.info('Cron jobs not available in pico mode');
  } else {
    appLog.info('Cron jobs disabled (ENABLE_CRON=false)');
  }

  // Start proactive health monitor (Phase 19)
  try {
    const { HealthMonitor } = await import('./chat/proactive/index.js');
    const healthMonitor = new HealthMonitor(5 * 60_000); // 5-minute interval
    healthMonitor.on('degraded', (check: { service: string; message?: string }) => {
      appLog.warn('Service degraded', { service: check.service, reason: check.message ?? 'unknown' });
    });
    healthMonitor.start();
    appLog.info('Health monitor started', { intervalMs: 5 * 60_000 });
  } catch {
    appLog.info('Health monitor unavailable');
  }

  // Static UI serving (mini/pro modes)
  if (hasCapability('web_ui')) {
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { readFile } = await import('node:fs/promises');
    const uiDistPath = join(process.cwd(), 'ui', 'dist');

    if (existsSync(uiDistPath)) {
      const { serveStatic } = await import('@hono/node-server/serve-static');

      app.use('/assets/*', serveStatic({ root: 'ui/dist' }));
      app.use('/favicon/*', serveStatic({ root: 'ui/dist' }));

      // SPA fallback for non-API routes
      app.get('*', async (c, next) => {
        const path = c.req.path;
        if (path.startsWith('/api/') || path.startsWith('/auth/') ||
            path.startsWith('/webhooks/') || path === '/health') {
          return next();
        }
        const indexPath = join(uiDistPath, 'index.html');
        try {
          const html = await readFile(indexPath, 'utf-8');
          return c.html(html);
        } catch {
          return next();
        }
      });

      appLog.info('Static UI serving enabled');
    }
  }

  // Start server
  serve({
    fetch: app.fetch,
    port: PORT,
  });

  appLog.info(`profClaw ready on http://localhost:${PORT}`, { port: PORT, mode: getModeLabel() });

  if (ENABLE_CRON) {
    const heartbeatMs = parseInt(process.env.POLL_INTERVAL_HEARTBEAT || '30000', 10);
    const issuesMs = parseInt(process.env.POLL_INTERVAL_ISSUES || '120000', 10);
    const staleMs = parseInt(process.env.POLL_INTERVAL_STALE || '60000', 10);
    appLog.info('Autonomous features active', {
      heartbeatSec: Math.round(heartbeatMs / 1000),
      issuePollerSec: Math.round(issuesMs / 1000),
      staleCheckerSec: Math.round(staleMs / 1000),
      logLevel: process.env.LOG_LEVEL || 'INFO',
    });
  }

  // First-time setup banner
  try {
    const [{ getDb }, { users }, { eq }] = await Promise.all([
      import('./storage/index.js'),
      import('./storage/schema.js'),
      import('drizzle-orm'),
    ]);
    const db = getDb();
    if (db) {
      const adminCount = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, 'admin'))
        .limit(1);
      if (adminCount.length === 0) {
        appLog.info('First-time setup required - visit the UI to complete setup', { url: `http://localhost:${PORT}` });
      }
    }
  } catch { /* ignore - DB may not be ready */ }
}

// Graceful shutdown with connection draining
let isShuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = parseInt(process.env['SHUTDOWN_TIMEOUT_MS'] ?? '10000', 10);

// Middleware to reject new requests during shutdown
app.use('*', async (c, next) => {
  if (isShuttingDown) {
    return c.json({ error: 'Server is shutting down' }, 503);
  }
  return next();
});

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  appLog.info('Shutting down gracefully', { signal });

  // Force exit after timeout to prevent hanging
  const forceExitTimer = setTimeout(() => {
    appLog.error('Force exit after shutdown timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExitTimer.unref();

  // 1. Close SSE connections with shutdown event
  const encoder = new TextEncoder();
  for (const [, conn] of sseConnections) {
    try {
      const msg = `event: shutdown\ndata: ${JSON.stringify({ reason: signal })}\n\n`;
      conn.controller.enqueue(encoder.encode(msg));
      clearInterval(conn.heartbeat);
      conn.controller.close();
    } catch {
      // Already closed
    }
  }
  sseConnections.clear();
  clearInterval(sseCleanupInterval);
  appLog.info('SSE connections closed');

  // 2. Stop cron jobs
  try {
    const { stopAllCronJobs } = await import('./cron/index.js');
    stopAllCronJobs();
    appLog.info('Cron jobs stopped');
  } catch {
    // Cron may not be initialized
  }

  // 3. Drain task queue
  try {
    const { closeQueue } = await import('./queue/index.js');
    await closeQueue();
    appLog.info('Task queue drained');
  } catch {
    // Queue may not be initialized
  }

  // 4. Destroy HTTP rate limiters
  try {
    apiRateLimiter.destroy();
    authRateLimiter.destroy();
    appLog.info('Rate limiters destroyed');
  } catch {
    // Rate limiters may not be initialized
  }

  appLog.info('Clean exit');
  clearTimeout(forceExitTimer);
  process.exit(0);
}

process.on('SIGINT', () => { gracefulShutdown('SIGINT'); });
process.on('SIGTERM', () => { gracefulShutdown('SIGTERM'); });

// Catch unhandled errors to log before crashing
process.on('uncaughtException', (err) => {
  appLog.error('Uncaught exception', err);
  // Let the process crash (daemon/serve will restart it)
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  appLog.error('Unhandled rejection', reason instanceof Error ? reason : new Error(String(reason)));
  // Don't exit for unhandled rejections - log and continue
  // This prevents a single failed promise from taking down the server
});

main().catch((err) => {
  appLog.error('Startup failed', err instanceof Error ? err : new Error(String(err)));
  process.exit(1);
});
