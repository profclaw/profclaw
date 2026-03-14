/**
 * Deployment Mode System
 *
 * Controls which features are available based on PROFCLAW_MODE env var.
 * Modes: pico (minimal), mini (dashboard), pro (everything).
 */

export type DeploymentMode = 'pico' | 'mini' | 'pro';

export type Capability =
  | 'agent'
  | 'tools'
  | 'chat_cli'
  | 'chat_channels'
  | 'web_ui'
  | 'redis'
  | 'bullmq'
  | 'cron'
  | 'cron_full'
  | 'integrations'
  | 'integrations_full'
  | 'browser_tools'
  | 'plugins'
  | 'sandbox'
  | 'sandbox_full'
  | 'sync_engine'
  | 'webhook_queue'
  | 'notifications';

const MODE_CAPABILITIES: Record<DeploymentMode, Set<Capability>> = {
  pico: new Set([
    'agent',
    'tools',
    'chat_cli',
    'chat_channels',
    'cron',
  ]),
  mini: new Set([
    'agent',
    'tools',
    'chat_cli',
    'chat_channels',
    'web_ui',
    'cron',
    'integrations',
    'sandbox',
    'notifications',
  ]),
  pro: new Set([
    'agent',
    'tools',
    'chat_cli',
    'chat_channels',
    'web_ui',
    'redis',
    'bullmq',
    'cron',
    'cron_full',
    'integrations',
    'integrations_full',
    'browser_tools',
    'plugins',
    'sandbox',
    'sandbox_full',
    'sync_engine',
    'webhook_queue',
    'notifications',
  ]),
};

/** Max chat channels per mode */
const MODE_CHANNEL_LIMITS: Record<DeploymentMode, number> = {
  pico: 1,
  mini: 3,
  pro: Infinity,
};

/** Max concurrent task executions per mode */
const MODE_CONCURRENCY: Record<DeploymentMode, number> = {
  pico: 1,
  mini: 3,
  pro: parseInt(process.env.POOL_MAX_CONCURRENT || '50', 10),
};

let cachedMode: DeploymentMode | null = null;

/**
 * Get the current deployment mode from PROFCLAW_MODE env var.
 * Defaults to 'mini' if not set.
 */
export function getMode(): DeploymentMode {
  if (cachedMode) return cachedMode;

  const raw = process.env.PROFCLAW_MODE?.toLowerCase().trim();
  if (raw === 'pico' || raw === 'mini' || raw === 'pro') {
    cachedMode = raw;
  } else {
    cachedMode = 'mini';
  }
  return cachedMode;
}

/** Check if the current mode has a specific capability. */
export function hasCapability(cap: Capability): boolean {
  return MODE_CAPABILITIES[getMode()].has(cap);
}

/** Check if an explicit mode has a specific capability. */
export function hasCapabilityForMode(
  mode: DeploymentMode,
  cap: Capability,
): boolean {
  return MODE_CAPABILITIES[mode].has(cap);
}

/** Get all capabilities for the current mode. */
export function getCapabilities(): Capability[] {
  return [...MODE_CAPABILITIES[getMode()]];
}

/** Get max allowed chat channels for the current mode. */
export function getChannelLimit(): number {
  return MODE_CHANNEL_LIMITS[getMode()];
}

/** Get max concurrent task executions for the current mode. */
export function getConcurrency(): number {
  return MODE_CONCURRENCY[getMode()];
}

/** Check if Redis should be used (pro mode, or explicitly configured). */
export function shouldUseRedis(): boolean {
  // Explicit override: if REDIS_URL is set, try to use Redis regardless of mode
  if (process.env.REDIS_URL) return true;
  return hasCapability('redis');
}

/** Human-readable mode label for logs. */
export function getModeLabel(): string {
  const labels: Record<DeploymentMode, string> = {
    pico: 'Pico (minimal)',
    mini: 'Mini (dashboard)',
    pro: 'Pro (full)',
  };
  return labels[getMode()];
}

/** Reset cached mode (for testing). */
export function resetMode(): void {
  cachedMode = null;
}
