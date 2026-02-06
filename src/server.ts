import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

// Route modules
import {
  tasksRoutes,
  dlqRoutes,
  agentsRoutes,
  webhooksRoutes,
  hooksRoutes,
  summariesRoutes,
  costsRoutes,
  settingsRoutes,
  tokensRoutes,
  authRoutes,
  gatewayRoutes,
  searchRoutes,
  ticketsRoutes,
  projectsRoutes,
  statsRoutes,
  syncRoutes,
  chatRoutes,
  importRoutes,
  userRoutes,
  toolsRoutes,
  setupRoutes,
  labelsRoutes,
  cronRoutes,
  devicesRoutes,
  memoryRoutes,
  skillsRoutes,
  telegramRoutes,
  whatsappRoutes,
  discordRoutes,
  openApiRoutes,
  notificationsRoutes,
} from './routes/index.js';

// Core imports
import { initTaskQueue, getTasks, registerSSEBroadcaster, closeTaskQueue } from './queue/task-queue.js';
import { getTaskSummaries } from './summaries/index.js';
import { getAgentRegistry } from './adapters/registry.js';
import { startAllCronJobs, stopAllCronJobs, getHealthStatus } from './cron/index.js';
import { initTokenTracker } from './costs/token-tracker.js';
import { loadConfig } from './utils/config-loader.js';
import { validateEnvironment, getConfiguredIntegrations, getConfiguredAIProviders } from './utils/env-validator.js';
import { initStorage, getDb } from './storage/index.js';
import { users } from './storage/schema.js';
import { eq } from 'drizzle-orm';
import { initApiTokensTable, tokenAuthMiddleware } from './auth/api-tokens.js';
import { authMiddleware } from './auth/middleware.js';
import { getGateway, type GatewayRequest, type WorkflowType } from './gateway/index.js';
import { CreateTaskSchema } from './types/task.js';
import { addTask } from './queue/task-queue.js';
import { initSyncIntegration } from './sync/index.js';
import { aiProvider } from './providers/index.js';
import { loadAllProviderConfigs } from './storage/index.js';

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

const appSettings = loadConfig<SettingsYaml>('settings.yml');
const PORT = parseInt(process.env.PORT || appSettings.server?.port?.toString() || '3000');
const ENABLE_CRON = process.env.ENABLE_CRON !== undefined
  ? process.env.ENABLE_CRON !== 'false'
  : (appSettings.server?.enableCron !== undefined ? appSettings.server.enableCron : true);

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
const configuredOrigin = process.env.CORS_ORIGIN || appSettings.server?.cors?.origin;

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
    origin: configuredOrigin && configuredOrigin !== '*'
      ? configuredOrigin
      : (origin) => {
          // In development: allow localhost origins
          // In production without CORS_ORIGIN: only allow same-origin
          if (!origin) return '';
          if (DEFAULT_ORIGINS.includes(origin)) return origin;
          // Allow any *.localhost or 127.0.0.1 origin for dev flexibility
          try {
            const url = new URL(origin);
            if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return origin;
          } catch { /* invalid origin */ }
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

// === Core Routes ===

// Health check
app.get('/health', (c) => {
  const agentHealth = getHealthStatus();
  return c.json({
    status: 'ok',
    service: 'glinr-task-manager',
    version: '0.2.0',
    timestamp: new Date().toISOString(),
    agents: agentHealth,
  });
});

// API info
app.get('/', (c) => {
  return c.json({
    name: 'GLINR Task Manager',
    version: '0.2.0',
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
app.get('/api/stats', (c) => {
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
  const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;

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

const sseConnections = new Set<ReadableStreamDefaultController<Uint8Array>>();

export function broadcastEvent(eventType: string, data: any) {
  const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  const encoder = new TextEncoder();
  const bytes = encoder.encode(message);

  sseConnections.forEach((controller) => {
    try {
      controller.enqueue(bytes);
    } catch {
      // Connection closed
    }
  });
}

app.get('/api/events', (c) => {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      sseConnections.add(controller);

      const connectMsg = `event: connected\ndata: ${JSON.stringify({
        message: 'Connected to GLINR event stream',
        timestamp: new Date().toISOString()
      })}\n\n`;
      controller.enqueue(encoder.encode(connectMsg));

      const heartbeat = setInterval(() => {
        try {
          const ping = `event: ping\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`;
          controller.enqueue(encoder.encode(ping));
        } catch {
          clearInterval(heartbeat);
          sseConnections.delete(controller);
        }
      }, 30000);

      c.req.raw.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        sseConnections.delete(controller);
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
      const createdTask = await addTask(parsed.data);
      request.task = createdTask;
    }

    const response = await gateway.execute(request);
    return c.json(response);
  } catch (error) {
    return c.json({ error: 'Gateway execution failed' }, 500);
  }
});

// === Mount Route Modules ===

app.route('/auth', authRoutes);
app.route('/webhooks', webhooksRoutes);
app.route('/api/tasks', tasksRoutes);
app.route('/api/dlq', dlqRoutes);
app.route('/api/agents', agentsRoutes);
app.route('/api/hook', hooksRoutes);
app.route('/api/summaries', summariesRoutes);
app.route('/api/costs', costsRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/tokens', tokensRoutes);
app.route('/api/gateway', gatewayRoutes);
app.route('/api/search', searchRoutes);
app.route('/api/tickets', ticketsRoutes);
app.route('/api/projects', projectsRoutes);
app.route('/api/stats', statsRoutes);
app.route('/api/sync', syncRoutes);
app.route('/api/chat', chatRoutes);
app.route('/api/import', importRoutes);
app.route('/api/users', userRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/tools', toolsRoutes);
app.route('/api/setup', setupRoutes);
app.route('/api', labelsRoutes); // Labels routes mount at /api for /api/projects/:id/labels and /api/tickets/:id/labels
app.route('/api/cron', cronRoutes);
app.route('/api/devices', devicesRoutes);
app.route('/api/memory', memoryRoutes);
app.route('/api/skills', skillsRoutes);
app.route('/api/telegram', telegramRoutes);
app.route('/api/whatsapp', whatsappRoutes);
app.route('/api/discord', discordRoutes);
app.route('/api/docs', openApiRoutes);
app.route('/api/notifications', notificationsRoutes);

// Alias /api/plugins to /api/settings/plugins for backwards compat
app.get('/api/plugins/health', async (c) => {
  return c.redirect('/api/settings/plugins/health');
});
app.post('/api/plugins/:id/toggle', async (c) => {
  const id = c.req.param('id');
  return c.redirect(`/api/settings/plugins/${id}/toggle`, 307);
});

// === Server Startup ===

async function main() {
  // Only start IF we are the main module actually being executed
  // We check if this is the start file.
  const isMain = process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');
  if (!isMain && process.env.NODE_ENV === 'test') {
    return;
  }
  console.log('[GLINR] Task Manager starting...');
  console.log('[GLINR] Mode: Autonomous');

  // Validate environment variables (fail fast if critical vars missing)
  const envResult = validateEnvironment({ 
    exitOnError: process.env.NODE_ENV === 'production',
    logResults: true,
  });
  
  if (!envResult.valid && process.env.NODE_ENV === 'production') {
    console.error('\n[FATAL] Cannot start in production with invalid environment.');
    process.exit(1);
  }

  // Log configured integrations
  const aiProviders = getConfiguredAIProviders();
  const integrations = getConfiguredIntegrations();
  if (aiProviders.length > 0) {
    console.log(`[OK] AI Providers: ${aiProviders.join(', ')}`);
  }
  if (integrations.length > 0) {
    console.log(`[OK] Integrations: ${integrations.join(', ')}`);
  }

  // Initialize storage FIRST (queue needs it for persistence)
  try {
    await initStorage();
    console.log('[OK] Storage initialized');

    await initApiTokensTable();
    console.log('[OK] API tokens table initialized');

    // Initialize conversation tables for chat history
    const { initConversationTables } = await import('./chat/conversations.js');
    await initConversationTables();
    console.log('[OK] Chat conversations initialized');

    // Load saved AI provider configurations from database
    const loadedProviders = await aiProvider.loadSavedConfigs(loadAllProviderConfigs);
    if (loadedProviders > 0) {
      console.log(`[OK] Loaded ${loadedProviders} saved AI provider configs`);
    }

    // Initialize skills registry
    try {
      const { initializeSkillsRegistry } = await import('./skills/index.js');
      const skillsRegistry = await initializeSkillsRegistry({
        workspaceDir: process.cwd(),
      });
      console.log(`[OK] Skills loaded: ${skillsRegistry.getLoadedSkillNames().length} skills`);
    } catch (error) {
      console.error('[WARN] Skills initialization failed:', error);
    }
  } catch (error) {
    console.error('[ERROR] Failed to initialize storage:', error);
    console.log('[WARN] Running with in-memory storage only');
  }

  // Validate Redis connectivity
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  try {
    const IORedis = (await import('ioredis')).default;
    const testRedis = new IORedis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      lazyConnect: true,
    });
    await testRedis.connect();
    await testRedis.ping();
    await testRedis.disconnect();
    console.log('[OK] Redis connected');
  } catch {
    console.error(`[ERROR] Redis unreachable at ${redisUrl}`);
    if (process.env.GLINR_REQUIRE_REDIS === 'true') {
      console.error('[FATAL] GLINR_REQUIRE_REDIS=true — exiting.');
      process.exit(1);
    }
    console.log('[WARN] Continuing without Redis (tasks will not process)');
  }

  // Initialize task queue (loads tasks from DB)
  try {
    await initTaskQueue();
    registerSSEBroadcaster(broadcastEvent);
    console.log('[OK] Task queue initialized');
    console.log('[OK] SSE event stream registered');
  } catch (error) {
    console.error('[ERROR] Failed to initialize task queue:', error);
    console.log('[WARN] Running without Redis (tasks will not be processed)');
  }

  // Initialize sync engine (if configured)
  try {
    const syncEngine = await initSyncIntegration();
    if (syncEngine) {
      console.log('[OK] Sync engine initialized');
    } else {
      console.log('[INFO] Sync engine disabled (enable in config/settings.yml)');
    }
  } catch (error) {
    console.error('[WARN] Sync engine initialization failed:', error);
  }

  // Initialize cost tracking
  initTokenTracker();
  console.log('[OK] Token tracker initialized');

  // Initialize agents from config
  const registry = getAgentRegistry();

  interface AgentsYaml {
    agents: any[];
  }

  const agentsConfig = loadConfig<AgentsYaml>('agents.yml');

  if (agentsConfig.agents && Array.isArray(agentsConfig.agents)) {
    for (const agentDef of agentsConfig.agents) {
      try {
        if (agentDef.type === 'openclaw' && !agentDef.config?.token) {
          console.log(`[INFO] Skipping agent ${agentDef.id}: Missing OPENCLAW_GATEWAY_TOKEN`);
          continue;
        }

        if (agentDef.type === 'claude-code' && !agentDef.config?.workingDir) {
          console.log(`[INFO] Skipping agent ${agentDef.id}: Missing CLAUDE_WORKING_DIR`);
          continue;
        }

        // Check if Ollama is reachable before configuring
        if (agentDef.type === 'ollama') {
          const ollamaUrl = agentDef.config?.baseUrl || 'http://localhost:11434';
          try {
            const resp = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
            if (!resp.ok) {
              console.log(`[INFO] Skipping agent ${agentDef.id}: Ollama not responding at ${ollamaUrl}`);
              continue;
            }
          } catch {
            console.log(`[INFO] Skipping agent ${agentDef.id}: Ollama not running at ${ollamaUrl}`);
            continue;
          }
        }

        registry.createAdapter(agentDef);
        console.log(`[OK] Agent ${agentDef.id} (${agentDef.type}) configured`);
      } catch (error) {
        console.error(`[ERROR] Failed to configure agent ${agentDef.id}:`, error);
      }
    }
  }

  // Auto-discover agents if enabled
  const autoDiscover = process.env.AUTO_DISCOVER_AGENTS !== undefined
    ? process.env.AUTO_DISCOVER_AGENTS === 'true'
    : (appSettings.agents?.autoDiscover ?? false);

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
      console.log('[OK] Claude Code adapter auto-discovered (CLI found)');
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
        console.log('[OK] Ollama adapter auto-discovered (server running)');
      }
    } catch {
      // Ollama not running
    }
  }

  // Start cron jobs
  if (ENABLE_CRON) {
    startAllCronJobs();
    console.log('[OK] Cron jobs started (autonomous mode)');
  } else {
    console.log('[INFO] Cron jobs disabled (ENABLE_CRON=false)');
  }

  // Start server
  serve({
    fetch: app.fetch,
    port: PORT,
  });

  console.log(`\n[READY] GLINR Task Manager running on http://localhost:${PORT}`);
  console.log(`\nEndpoints:`);
  console.log(`  Tasks:    http://localhost:${PORT}/api/tasks`);
  console.log(`  Agents:   http://localhost:${PORT}/api/agents`);
  console.log(`  DLQ:      http://localhost:${PORT}/api/dlq`);
  console.log(`  GitHub:   http://localhost:${PORT}/webhooks/github`);
  console.log(`  Jira:     http://localhost:${PORT}/webhooks/jira`);
  console.log(`  Hooks:    http://localhost:${PORT}/api/hook/tool-use`);
  console.log(`  Sessions: http://localhost:${PORT}/api/hook/sessions`);
  console.log(`  Health:   http://localhost:${PORT}/health`);
  console.log(`  Gateway:  http://localhost:${PORT}/api/gateway/execute`);

  if (ENABLE_CRON) {
    const heartbeatMs = parseInt(process.env.POLL_INTERVAL_HEARTBEAT || '30000', 10);
    const issuesMs = parseInt(process.env.POLL_INTERVAL_ISSUES || '120000', 10);
    const staleMs = parseInt(process.env.POLL_INTERVAL_STALE || '60000', 10);
    console.log(`\nAutonomous Features (configurable via env):`);
    console.log(`  Heartbeat: ${Math.round(heartbeatMs / 1000)}s (POLL_INTERVAL_HEARTBEAT)`);
    console.log(`  Issue Poller: ${Math.round(issuesMs / 1000)}s (POLL_INTERVAL_ISSUES)`);
    console.log(`  Stale Checker: ${Math.round(staleMs / 1000)}s (POLL_INTERVAL_STALE)`);
    console.log(`  Log Level: ${process.env.LOG_LEVEL || 'INFO'} (LOG_LEVEL)`);
  }

  // First-time setup banner
  try {
    const db = getDb();
    if (db) {
      const adminCount = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, 'admin'))
        .limit(1);
      if (adminCount.length === 0) {
        console.log('\n' + '='.repeat(56));
        console.log('  GLINR needs initial setup!');
        console.log('');
        console.log('  Run:   glinr setup');
        console.log('  Or:    docker exec -it glinr-task-manager glinr setup');
        console.log(`  Or visit: http://localhost:${PORT}/setup`);
        console.log('='.repeat(56) + '\n');
      }
    }
  } catch { /* ignore - DB may not be ready */ }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[SHUTDOWN] Shutting down...');
  stopAllCronJobs();
  await closeTaskQueue();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[SHUTDOWN] Shutting down...');
  stopAllCronJobs();
  await closeTaskQueue();
  process.exit(0);
});

main().catch(console.error);
