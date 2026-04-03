import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { createServer } from 'net';

// Core imports - keep static only for truly essential boot utilities
import { loadConfig } from './utils/config-loader.js';
import { createContextualLogger } from './utils/logger.js';
import { writePidFile, removePidFile } from './utils/pid-file.js';

const appLog = createContextualLogger('Server');
import { validateEnvironment, getConfiguredIntegrations, getConfiguredAIProviders } from './utils/env-validator.js';
import { initApiTokensTable, tokenAuthMiddleware } from './auth/api-tokens.js';
import { authMiddleware } from './auth/middleware.js';
import { rateLimit } from './middleware/rate-limit.js';
import type { GatewayRequest, WorkflowType } from './gateway/index.js';
import type { AgentConfig } from './types/agent.js';
import { CreateTaskSchema } from './types/task.js';
import { getMode, getModeLabel, hasCapability, getCapabilities } from './core/deployment.js';
import { getRouteDefinitionsForMode, registerRouteModules } from './server/route-loader.js';
import { validateBody, GatewayExecuteSchema } from './middleware/request-validator.js';

const VERSION = '2.0.0';

// Module-level startup state flags
let degradedMode = false;
let inMemoryStorageReminderInterval: ReturnType<typeof setInterval> | null = null;

// Runtime tracking state
let runningPort = 0;
let lastErrorMessage: string | undefined;

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

// WS-1.4: In-memory storage warning header — set on every response when storage is ephemeral
app.use('*', async (c, next) => {
  await next();
  if (degradedMode) {
    c.res.headers.set('X-ProfClaw-Storage', 'ephemeral');
  }
});

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
const serverStartTime = Date.now();

type ServiceStatus = 'ok' | 'warning' | 'error';

interface ServiceHealth {
  status: ServiceStatus;
  latencyMs?: number;
  message?: string;
}

interface OllamaServiceHealth extends ServiceHealth {
  models?: number;
}

interface DiskServiceHealth extends ServiceHealth {
  freeGb?: number;
}

interface MemoryServiceHealth extends ServiceHealth {
  usedPercent?: number;
}

interface QueueServiceHealth extends ServiceHealth {
  type?: string;
}

interface QueueDepth {
  pending: number;
  running: number;
  total: number;
}

interface ProcessStats {
  pid: number;
  port: number;
  memoryMb: number;
  cpuLoadAvg: number[];
}

interface DeepHealthResponse {
  status: 'ok' | 'degraded' | 'unhealthy';
  services: {
    database: ServiceHealth;
    queue: QueueServiceHealth;
    ollama: OllamaServiceHealth;
    disk: DiskServiceHealth;
    memory: MemoryServiceHealth;
  };
  version: string;
  uptime: number;
  sseClients: number;
  activeSessions: number;
  queueDepth: QueueDepth;
  process: ProcessStats;
  lastError?: string;
}

async function checkDatabaseHealth(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const { getDb } = await import('./storage/index.js');
    const db = getDb();
    if (!db) return { status: 'error', message: 'Database not initialised' };
    // Simple liveness query
    await db.run('SELECT 1');
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (err) {
    return {
      status: 'error',
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : 'Database check failed',
    };
  }
}

async function checkQueueHealth(): Promise<QueueServiceHealth> {
  try {
    const { getQueueType } = await import('./queue/index.js');
    const queueType = getQueueType();
    if (!queueType) return { status: 'warning', message: 'Queue not initialised' };

    if (queueType === 'redis') {
      // Test Redis reachability with a fresh connection
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      const start = Date.now();
      try {
        const IORedis = (await import('ioredis')).default;
        const probe = new IORedis(redisUrl, { lazyConnect: true, connectTimeout: 2000, maxRetriesPerRequest: 0 });
        await probe.connect();
        await probe.ping();
        await probe.disconnect();
        return { status: 'ok', type: 'redis', latencyMs: Date.now() - start };
      } catch {
        return { status: 'error', type: 'redis', latencyMs: Date.now() - start, message: 'Redis unreachable' };
      }
    }

    return { status: 'ok', type: queueType };
  } catch {
    return { status: 'ok', type: 'in-memory' };
  }
}

async function checkOllamaHealth(): Promise<OllamaServiceHealth> {
  const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const start = Date.now();
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { status: 'error', latencyMs: Date.now() - start, message: `HTTP ${res.status}` };
    const data = await res.json() as { models?: unknown[] };
    const modelCount = Array.isArray(data.models) ? data.models.length : 0;
    return { status: 'ok', latencyMs: Date.now() - start, models: modelCount };
  } catch {
    // Ollama is optional — not reachable means degraded, not unhealthy
    return { status: 'warning', latencyMs: Date.now() - start, message: 'Ollama not reachable' };
  }
}

async function checkDiskHealth(): Promise<DiskServiceHealth> {
  try {
    const { statfs } = await import('node:fs/promises');
    const stats = await statfs(process.cwd());
    const freeBytes = stats.bfree * stats.bsize;
    const freeGb = freeBytes / (1024 ** 3);
    const WARN_THRESHOLD_BYTES = 100 * 1024 * 1024; // 100 MB
    const status: ServiceStatus = freeBytes < WARN_THRESHOLD_BYTES ? 'warning' : 'ok';
    return {
      status,
      freeGb: Math.round(freeGb * 100) / 100,
      ...(status === 'warning' && { message: 'Low disk space (< 100 MB free)' }),
    };
  } catch {
    return { status: 'warning', message: 'Disk check unavailable' };
  }
}

function checkMemoryHealth(): MemoryServiceHealth {
  const WARN_THRESHOLD = 90;
  const mem = process.memoryUsage();
  // rss is total process resident memory; heapTotal is V8 heap.
  // Use rss vs a cap of available system memory — but without os.totalmem we
  // report heap utilisation which is the most actionable metric.
  const usedPercent = Math.round((mem.heapUsed / mem.heapTotal) * 100);
  const status: ServiceStatus = usedPercent > WARN_THRESHOLD ? 'warning' : 'ok';
  return {
    status,
    usedPercent,
    ...(status === 'warning' && { message: `Heap usage above ${WARN_THRESHOLD}%` }),
  };
}

app.get('/health', async (c) => {
  const [database, queue, ollama, disk] = await Promise.all([
    checkDatabaseHealth(),
    checkQueueHealth(),
    checkOllamaHealth(),
    checkDiskHealth(),
  ]);
  const memory = checkMemoryHealth();

  const services = { database, queue, ollama, disk, memory };

  const statuses = Object.values(services).map((s) => s.status);
  const overallStatus: 'ok' | 'degraded' | 'unhealthy' =
    statuses.some((s) => s === 'error')
      ? 'unhealthy'
      : statuses.some((s) => s === 'warning')
        ? 'degraded'
        : 'ok';

  // Gather queue depth
  let queueDepth: QueueDepth = { pending: 0, running: 0, total: 0 };
  try {
    const { getTasks } = await import('./queue/index.js');
    const pending = getTasks({ status: 'pending' }).length + getTasks({ status: 'queued' }).length;
    const running = getTasks({ status: 'in_progress' }).length;
    queueDepth = { pending, running, total: pending + running };
  } catch {
    // Queue not yet initialised — use zeroes
  }

  // Gather active agent sessions
  let activeSessions = 0;
  try {
    const { getAgentRegistry } = await import('./adapters/registry.js');
    activeSessions = getAgentRegistry().getActiveAdapters().length;
  } catch {
    // Registry not yet initialised
  }

  const memUsage = process.memoryUsage();
  const { loadavg: osLoadavg } = await import('node:os');

  const body: DeepHealthResponse = {
    status: overallStatus,
    services,
    version: VERSION,
    uptime: Math.floor((Date.now() - serverStartTime) / 1000),
    sseClients: sseConnections.size,
    activeSessions,
    queueDepth,
    process: {
      pid: process.pid,
      port: runningPort,
      memoryMb: Math.round(memUsage.rss / 1024 / 1024),
      cpuLoadAvg: process.platform !== 'win32' ? osLoadavg() : [0, 0, 0],
    },
    ...(lastErrorMessage !== undefined && { lastError: lastErrorMessage }),
  };

  const httpStatus = overallStatus === 'unhealthy' ? 503 : 200;
  return c.json(body, httpStatus);
});

// API info (mode-aware)
app.get('/', async (c) => {
  // WS-1.3: First-run setup redirect — send to /setup when no admin users exist
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
        return c.redirect('/setup', 302);
      }
    }
  } catch {
    // DB may not be ready; fall through to normal response
  }

  // If UI is built and web_ui capability is enabled, serve the dashboard
  if (hasCapability('web_ui')) {
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { readFile } = await import('node:fs/promises');
    const indexPath = join(process.cwd(), 'ui', 'dist', 'index.html');
    if (existsSync(indexPath)) {
      const html = await readFile(indexPath, 'utf-8');
      return c.html(html);
    }
  }

  // Fallback: API info JSON
  const mode = getMode();
  const routes = getRouteDefinitionsForMode(mode);
  const routeIds = new Set(routes.map((r) => r.id));

  // Build endpoints dynamically based on available routes
  const endpoints: Record<string, unknown> = {
    health: 'GET /health',
  };

  // Core routes (always available)
  if (routeIds.has('tasks')) {
    endpoints.tasks = {
      list: 'GET /api/tasks',
      create: 'POST /api/tasks',
      get: 'GET /api/tasks/:id',
      cancel: 'POST /api/tasks/:id/cancel',
      retry: 'POST /api/tasks/:id/retry',
    };
  }
  if (routeIds.has('agents')) endpoints.agents = 'GET /api/agents';
  if (routeIds.has('chat')) {
    endpoints.chat = {
      models: 'GET /api/chat/models',
      providers: 'GET /api/chat/providers',
      send: 'POST /api/chat/send',
    };
  }
  if (routeIds.has('gateway')) {
    endpoints.gateway = {
      execute: 'POST /api/gateway/execute',
      agents: 'GET /api/gateway/agents',
      workflows: 'GET /api/gateway/workflows',
    };
  }
  if (routeIds.has('hooks')) {
    endpoints.hooks = {
      toolUse: 'POST /api/hook/tool-use',
      sessionEnd: 'POST /api/hook/session-end',
      sessions: 'GET /api/hook/sessions',
    };
  }
  if (routeIds.has('tools')) {
    endpoints.tools = {
      list: 'GET /api/tools',
      execute: 'POST /api/tools/execute',
      security: 'GET /api/tools/security',
    };
  }
  if (routeIds.has('settings')) {
    endpoints.settings = {
      get: 'GET /api/settings',
      update: 'PATCH /api/settings',
    };
  }
  if (routeIds.has('auth')) endpoints.auth = 'POST /auth/login';

  // Dashboard/web UI routes
  if (routeIds.has('costs')) endpoints.costs = 'GET /api/costs/summary';
  if (routeIds.has('memory')) endpoints.memory = 'GET /api/memory';
  if (routeIds.has('skills')) endpoints.skills = 'GET /api/skills';
  if (routeIds.has('mcp')) {
    endpoints.mcp = {
      status: 'GET /api/mcp',
      tools: 'GET /api/mcp/tools',
    };
  }
  if (routeIds.has('tunnels')) endpoints.tunnels = 'GET /api/tunnels';
  if (routeIds.has('teams')) {
    endpoints.teams = {
      list: 'GET /api/teams?userId=<id>',
      create: 'POST /api/teams',
      members: 'GET /api/teams/:id/members',
      usage: 'GET /api/teams/:id/usage',
      invites: 'POST /api/teams/:id/invites',
    };
  }

  // Web UI data routes
  if (routeIds.has('dlq')) endpoints.deadLetterQueue = 'GET /api/dlq';
  if (routeIds.has('summaries')) {
    endpoints.summaries = {
      list: 'GET /api/summaries',
      search: 'GET /api/summaries/search',
    };
  }
  if (routeIds.has('search')) {
    endpoints.search = {
      semantic: 'GET /api/search/semantic?q={query}',
      text: 'GET /api/search/text?q={query}',
    };
  }
  if (routeIds.has('stats')) endpoints.stats = 'GET /api/stats';

  // Integration routes
  if (routeIds.has('tickets')) {
    endpoints.tickets = {
      list: 'GET /api/tickets',
      create: 'POST /api/tickets',
      get: 'GET /api/tickets/:id',
    };
  }
  if (routeIds.has('projects')) {
    endpoints.projects = {
      list: 'GET /api/projects',
      create: 'POST /api/projects',
      get: 'GET /api/projects/:id',
    };
  }
  if (routeIds.has('webhooks')) {
    endpoints.webhooks = {
      github: 'POST /webhooks/github',
      jira: 'POST /webhooks/jira',
      linear: 'POST /webhooks/linear',
    };
  }

  // Cron routes
  if (routeIds.has('cron')) endpoints.cron = 'GET /api/cron';

  // Channel routes
  if (routeIds.has('channels')) endpoints.channels = 'GET /api/channels';

  // Sync routes
  if (routeIds.has('sync')) endpoints.sync = 'GET /api/sync';

  return c.json({
    name: 'profClaw',
    version: VERSION,
    mode,
    capabilities: getCapabilities(),
    endpoints,
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

app.post(
  '/api/gateway/execute-secure',
  tokenAuthMiddleware(['gateway:execute']),
  validateBody(GatewayExecuteSchema),
  async (c) => {
    try {
      // validateBody middleware stores the parsed result; cast via raw context map
      const body = (c as unknown as { get(k: string): unknown }).get('validatedBody') as import('./middleware/request-validator.js').GatewayExecuteInput;
      const { getGateway } = await import('./gateway/index.js');
      const gateway = getGateway();

      const request: GatewayRequest = {
        task: body.task as GatewayRequest['task'],
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
  },
);

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

const MAX_PORT_ATTEMPTS = 3;

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

async function resolvePort(startPort: number): Promise<number | null> {
  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset++) {
    const candidate = startPort + offset;
    const available = await checkPortAvailable(candidate);
    if (available) {
      return candidate;
    }
  }
  return null;
}

async function main() {
  // Only start IF we are the main module actually being executed
  const isMain = process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');
  if (!isMain && process.env.NODE_ENV === 'test') {
    return;
  }
  const mode = getMode();
  const appSettings = getAppSettings();
  const configuredPort = getPort();
  const ENABLE_CRON = isCronEnabled();
  appLog.info('profClaw starting', { version: VERSION, mode: getModeLabel() });

  // Bind-or-retry: find an available port
  const PORT = await resolvePort(configuredPort);
  if (PORT === null) {
    appLog.error(
      `All ports ${configuredPort}–${configuredPort + MAX_PORT_ATTEMPTS - 1} are in use`,
      new Error(`EADDRINUSE: ports ${configuredPort}-${configuredPort + MAX_PORT_ATTEMPTS - 1}`)
    );
    process.exit(1);
  }
  if (PORT !== configuredPort) {
    appLog.warn(`Port ${configuredPort} in use, started on port ${PORT}`);
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

  // Register SSE broadcaster for agent summary updates
  try {
    const { getAgentSummaryTracker } = await import('./agents/agent-summary.js');
    getAgentSummaryTracker().registerSSEBroadcaster(broadcastEvent);
    appLog.info('Agent summary SSE broadcaster registered');
  } catch (error) {
    appLog.error('Failed to register agent summary broadcaster', error instanceof Error ? error : new Error(String(error)));
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

  // WS-1.2: Provider validation — warn (or exit in strict mode) when no AI adapters are configured
  if (registry.getActiveAdapters().length === 0) {
    appLog.warn(
      'No AI providers configured. Run `profclaw setup` or set ANTHROPIC_API_KEY / OPENAI_API_KEY',
    );
    if (process.env.PROFCLAW_STRICT_MODE === 'true') {
      appLog.error('Strict mode enabled: refusing to start without an AI provider');
      process.exit(1);
    }
    degradedMode = true;
  }

  // WS-1.4: In-memory storage — warn on startup and remind every 60 seconds
  {
    const { isStorageInMemory } = await import('./storage/index.js');
    if (isStorageInMemory()) {
      degradedMode = true;
      appLog.warn('╔══════════════════════════════════════════════════════════╗');
      appLog.warn('║  WARNING: Running with in-memory storage (ephemeral)     ║');
      appLog.warn('║  All data will be lost when the server restarts.         ║');
      appLog.warn('║  Set STORAGE_TIER=local or DATABASE_URL to persist data. ║');
      appLog.warn('╚══════════════════════════════════════════════════════════╝');

      inMemoryStorageReminderInterval = setInterval(() => {
        appLog.warn('Reminder: server is running with ephemeral in-memory storage — data will not survive a restart');
      }, 60_000);
      // Allow Node to exit cleanly without waiting for this interval
      inMemoryStorageReminderInterval.unref();
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

  // Record runtime port for health endpoint
  runningPort = PORT;

  // Record PID so the CLI can detect/kill existing instances
  writePidFile(PORT);

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

  // 2. Stop in-memory storage reminder interval
  if (inMemoryStorageReminderInterval !== null) {
    clearInterval(inMemoryStorageReminderInterval);
    inMemoryStorageReminderInterval = null;
  }

  // 3. Stop cron jobs
  try {
    const { stopAllCronJobs } = await import('./cron/index.js');
    stopAllCronJobs();
    appLog.info('Cron jobs stopped');
  } catch {
    // Cron may not be initialized
  }

  // 4. Drain task queue
  try {
    const { closeQueue } = await import('./queue/index.js');
    await closeQueue();
    appLog.info('Task queue drained');
  } catch {
    // Queue may not be initialized
  }

  // 5. Destroy HTTP rate limiters
  try {
    apiRateLimiter.destroy();
    authRateLimiter.destroy();
    appLog.info('Rate limiters destroyed');
  } catch {
    // Rate limiters may not be initialized
  }

  // Remove PID file so new instances know the slot is free
  removePidFile();

  appLog.info('Clean exit');
  clearTimeout(forceExitTimer);
  process.exit(0);
}

process.on('SIGINT', () => { gracefulShutdown('SIGINT'); });
process.on('SIGTERM', () => { gracefulShutdown('SIGTERM'); });

// Catch unhandled errors to log before crashing
process.on('uncaughtException', (err) => {
  lastErrorMessage = err.message;
  appLog.error('Uncaught exception', err);
  // Let the process crash (daemon/serve will restart it)
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const errMsg = reason instanceof Error ? reason.message : String(reason);
  lastErrorMessage = errMsg;
  appLog.error('Unhandled rejection', reason instanceof Error ? reason : new Error(errMsg));
  // Don't exit for unhandled rejections - log and continue
  // This prevents a single failed promise from taking down the server
});

main().catch((err) => {
  appLog.error('Startup failed', err instanceof Error ? err : new Error(String(err)));
  process.exit(1);
});
