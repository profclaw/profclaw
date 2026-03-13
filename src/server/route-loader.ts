import type { Context, Hono } from 'hono';
import { hasCapabilityForMode, type DeploymentMode } from '../core/deployment.js';

type RouteApp = Pick<Hono, 'all'>;
type RouteInstance = Pick<Hono, 'fetch'>;
type RouteLoader = () => Promise<RouteInstance>;

export interface RouteDefinition {
  id: string;
  mountPaths: string[];
  load: RouteLoader;
}

function normalizeMountedPath(pathname: string, mountPath: string): string {
  if (pathname === mountPath) {
    return '/';
  }

  if (pathname.startsWith(`${mountPath}/`)) {
    return pathname.slice(mountPath.length) || '/';
  }

  return pathname;
}

export function createLazyRouteHandler(definition: RouteDefinition, mountPath: string) {
  let routePromise: Promise<RouteInstance> | null = null;

  return async (c: Context) => {
    if (!routePromise) {
      routePromise = definition.load();
    }

    const route = await routePromise;
    const url = new URL(c.req.url);
    url.pathname = normalizeMountedPath(url.pathname, mountPath);
    let executionCtx: Parameters<RouteInstance['fetch']>[2] | undefined;
    try {
      executionCtx = c.executionCtx;
    } catch {
      executionCtx = undefined;
    }

    return route.fetch(new Request(url, c.req.raw), c.env, executionCtx);
  };
}

function namedRoute<TModule extends Record<string, unknown>, TExport extends keyof TModule>(
  importer: () => Promise<TModule>,
  exportName: TExport
): RouteLoader {
  return async () => (await importer())[exportName] as RouteInstance;
}

function defaultRoute<TModule extends { default: unknown }>(
  importer: () => Promise<TModule>
): RouteLoader {
  return async () => (await importer()).default as RouteInstance;
}

// Core routes loaded in all modes (pico, mini, pro)
const CORE_ROUTE_DEFINITIONS: RouteDefinition[] = [
  { id: 'tasks', mountPaths: ['/api/tasks'], load: namedRoute(() => import('../routes/tasks.js'), 'tasksRoutes') },
  { id: 'agents', mountPaths: ['/api/agents'], load: namedRoute(() => import('../routes/agents.js'), 'agentsRoutes') },
  { id: 'chat', mountPaths: ['/api/chat'], load: namedRoute(() => import('../routes/chat.js'), 'chatRoutes') },
  { id: 'webchat', mountPaths: ['/api/chat/webchat'], load: namedRoute(() => import('../routes/webchat.js'), 'webchatRoutes') },
  { id: 'gateway', mountPaths: ['/api/gateway'], load: namedRoute(() => import('../routes/gateway.js'), 'gatewayRoutes') },
  { id: 'hooks', mountPaths: ['/api/hook'], load: namedRoute(() => import('../routes/hooks.js'), 'hooksRoutes') },
  { id: 'tools', mountPaths: ['/api/tools'], load: defaultRoute(() => import('../routes/tools.js')) },
  { id: 'auth', mountPaths: ['/auth', '/api/auth'], load: namedRoute(() => import('../routes/auth.js'), 'authRoutes') },
  { id: 'settings', mountPaths: ['/api/settings'], load: namedRoute(() => import('../routes/settings.js'), 'settingsRoutes') },
  { id: 'security', mountPaths: ['/api/security'], load: defaultRoute(() => import('../routes/security.js')) },
];

// Dashboard/UI routes (gated on web_ui capability)
const DASHBOARD_ROUTE_DEFINITIONS: RouteDefinition[] = [
  { id: 'setup', mountPaths: ['/api/setup'], load: namedRoute(() => import('../routes/setup.js'), 'setupRoutes') },
  { id: 'oobe', mountPaths: ['/api/oobe'], load: namedRoute(() => import('../routes/oobe.js'), 'oobeRoutes') },
  { id: 'memory', mountPaths: ['/api/memory'], load: namedRoute(() => import('../routes/memory.js'), 'memoryRoutes') },
  { id: 'skills', mountPaths: ['/api/skills'], load: namedRoute(() => import('../routes/skills.js'), 'skillsRoutes') },
  { id: 'openapi', mountPaths: ['/api/docs'], load: namedRoute(() => import('../routes/openapi.js'), 'openApiRoutes') },
  { id: 'mcp', mountPaths: ['/api/mcp'], load: namedRoute(() => import('../routes/mcp.js'), 'mcpRoutes') },
  { id: 'costs', mountPaths: ['/api/costs'], load: namedRoute(() => import('../routes/costs.js'), 'costsRoutes') },
  { id: 'tunnels', mountPaths: ['/api/tunnels'], load: namedRoute(() => import('../routes/tunnels.js'), 'tunnelsRoutes') },
  { id: 'voice', mountPaths: ['/api/voice'], load: namedRoute(() => import('../routes/voice.js'), 'voiceRoutes') },
];

// Plugin routes (gated on plugins capability)
const PLUGINS_ROUTE_DEFINITIONS: RouteDefinition[] = [
  { id: 'plugins', mountPaths: ['/api/plugins'], load: namedRoute(() => import('../routes/plugins.js'), 'pluginsRoutes') },
  { id: 'clawhub', mountPaths: ['/api/clawhub'], load: namedRoute(() => import('../routes/clawhub.js'), 'clawhubRoutes') },
];

// Notification routes (gated on notifications capability)
const NOTIFICATIONS_ROUTE_DEFINITIONS: RouteDefinition[] = [
  { id: 'push', mountPaths: ['/api/push'], load: namedRoute(() => import('../routes/push.js'), 'pushRoutes') },
];

const WEB_UI_ROUTE_DEFINITIONS: RouteDefinition[] = [
  { id: 'dlq', mountPaths: ['/api/dlq'], load: namedRoute(() => import('../routes/dlq.js'), 'dlqRoutes') },
  { id: 'summaries', mountPaths: ['/api/summaries'], load: namedRoute(() => import('../routes/summaries.js'), 'summariesRoutes') },
  { id: 'tokens', mountPaths: ['/api/tokens'], load: namedRoute(() => import('../routes/tokens.js'), 'tokensRoutes') },
  { id: 'search', mountPaths: ['/api/search'], load: namedRoute(() => import('../routes/search.js'), 'searchRoutes') },
  { id: 'stats', mountPaths: ['/api/stats'], load: namedRoute(() => import('../routes/stats.js'), 'statsRoutes') },
  { id: 'users', mountPaths: ['/api/users'], load: namedRoute(() => import('../routes/users.js'), 'userRoutes') },
  { id: 'devices', mountPaths: ['/api/devices'], load: namedRoute(() => import('../routes/devices.js'), 'devicesRoutes') },
  { id: 'notifications', mountPaths: ['/api/notifications'], load: namedRoute(() => import('../routes/notifications.js'), 'notificationsRoutes') },
];

const CRON_ROUTE_DEFINITIONS: RouteDefinition[] = [
  { id: 'cron', mountPaths: ['/api/cron'], load: namedRoute(() => import('../routes/cron.js'), 'cronRoutes') },
];

const INTEGRATION_ROUTE_DEFINITIONS: RouteDefinition[] = [
  { id: 'tickets', mountPaths: ['/api/tickets'], load: namedRoute(() => import('../routes/tickets.js'), 'ticketsRoutes') },
  { id: 'projects', mountPaths: ['/api/projects'], load: namedRoute(() => import('../routes/projects.js'), 'projectsRoutes') },
  { id: 'labels', mountPaths: ['/api'], load: namedRoute(() => import('../routes/labels.js'), 'labelsRoutes') },
  { id: 'webhooks', mountPaths: ['/webhooks'], load: namedRoute(() => import('../routes/webhooks.js'), 'webhooksRoutes') },
];

const SYNC_ROUTE_DEFINITIONS: RouteDefinition[] = [
  { id: 'sync', mountPaths: ['/api/sync'], load: defaultRoute(() => import('../routes/sync.js')) },
  { id: 'import', mountPaths: ['/api/import'], load: namedRoute(() => import('../routes/import.js'), 'importRoutes') },
  { id: 'backup', mountPaths: ['/api/backup'], load: namedRoute(() => import('../routes/backup.js'), 'backupRoutes') },
];

const CHAT_CHANNEL_ROUTE_DEFINITIONS: RouteDefinition[] = [
  { id: 'telegram', mountPaths: ['/api/telegram'], load: namedRoute(() => import('../routes/telegram.js'), 'telegramRoutes') },
  { id: 'whatsapp', mountPaths: ['/api/whatsapp'], load: namedRoute(() => import('../routes/whatsapp.js'), 'whatsappRoutes') },
  { id: 'discord', mountPaths: ['/api/discord'], load: namedRoute(() => import('../routes/discord.js'), 'discordRoutes') },
];

export function getRouteDefinitionsForMode(mode: DeploymentMode): RouteDefinition[] {
  const definitions = [...CORE_ROUTE_DEFINITIONS];

  if (hasCapabilityForMode(mode, 'web_ui')) {
    definitions.push(...DASHBOARD_ROUTE_DEFINITIONS);
    definitions.push(...WEB_UI_ROUTE_DEFINITIONS);
  }
  if (hasCapabilityForMode(mode, 'plugins')) {
    definitions.push(...PLUGINS_ROUTE_DEFINITIONS);
  }
  if (hasCapabilityForMode(mode, 'notifications')) {
    definitions.push(...NOTIFICATIONS_ROUTE_DEFINITIONS);
  }
  if (hasCapabilityForMode(mode, 'cron')) {
    definitions.push(...CRON_ROUTE_DEFINITIONS);
  }
  if (hasCapabilityForMode(mode, 'integrations')) {
    definitions.push(...INTEGRATION_ROUTE_DEFINITIONS);
  }
  if (hasCapabilityForMode(mode, 'sync_engine')) {
    definitions.push(...SYNC_ROUTE_DEFINITIONS);
  }
  if (hasCapabilityForMode(mode, 'chat_channels')) {
    definitions.push(...CHAT_CHANNEL_ROUTE_DEFINITIONS);
  }

  return definitions;
}

export async function registerRouteModules(app: RouteApp, mode: DeploymentMode): Promise<void> {
  const mountEntries = getRouteDefinitionsForMode(mode)
    .flatMap((definition) => definition.mountPaths.map((mountPath) => ({ definition, mountPath })))
    .sort((a, b) => b.mountPath.length - a.mountPath.length);

  for (const { definition, mountPath } of mountEntries) {
    const handler = createLazyRouteHandler(definition, mountPath);
    app.all(mountPath, handler);
    app.all(`${mountPath}/*`, handler);
  }
}
