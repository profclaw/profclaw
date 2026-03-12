/**
 * Tunnel Routes
 *
 * API endpoints for managing remote access tunnels (Tailscale, Cloudflare).
 */

import { Hono } from 'hono';
import { getTailscaleService } from '../integrations/tailscale.js';
import { getCloudflareTunnelService } from '../integrations/cloudflare-tunnel.js';

export const tunnelsRoutes = new Hono();

// =============================================================================
// Status
// =============================================================================

/**
 * GET /api/tunnels/status - Get status of all tunnel providers
 */
tunnelsRoutes.get('/status', async (c) => {
  const [tailscale, cloudflare] = await Promise.all([
    getTailscaleService().getStatus(),
    getCloudflareTunnelService().getStatus(),
  ]);

  const cfService = getCloudflareTunnelService();

  return c.json({
    tailscale: {
      ...tailscale,
      activeServe: false, // Would need to check serve status
    },
    cloudflare: {
      ...cloudflare,
      running: cfService.isRunning(),
      activeUrl: cfService.getActiveUrl(),
    },
  });
});

// =============================================================================
// Tailscale
// =============================================================================

/**
 * GET /api/tunnels/tailscale/status - Get Tailscale status
 */
tunnelsRoutes.get('/tailscale/status', async (c) => {
  const status = await getTailscaleService().getStatus();
  return c.json(status);
});

/**
 * POST /api/tunnels/tailscale/serve - Start Tailscale Serve
 */
tunnelsRoutes.post('/tailscale/serve', async (c) => {
  const body = await c.req.json<{
    port: number;
    protocol?: 'http' | 'https';
    path?: string;
    servePort?: number;
  }>();

  if (!body.port) {
    return c.json({ error: 'port is required' }, 400);
  }

  const result = await getTailscaleService().startServe({
    port: body.port,
    protocol: body.protocol || 'http',
    path: body.path,
    servePort: body.servePort,
  });

  return c.json(result, result.success ? 200 : 500);
});

/**
 * POST /api/tunnels/tailscale/funnel - Start Tailscale Funnel
 */
tunnelsRoutes.post('/tailscale/funnel', async (c) => {
  const body = await c.req.json<{
    port: number;
    protocol?: 'http' | 'https';
    path?: string;
    funnelPort?: number;
  }>();

  if (!body.port) {
    return c.json({ error: 'port is required' }, 400);
  }

  const result = await getTailscaleService().startFunnel({
    port: body.port,
    protocol: body.protocol || 'http',
    path: body.path,
    funnelPort: body.funnelPort,
  });

  return c.json(result, result.success ? 200 : 500);
});

/**
 * POST /api/tunnels/tailscale/stop - Stop Tailscale Serve/Funnel
 */
tunnelsRoutes.post('/tailscale/stop', async (c) => {
  const body = await c.req.json<{ port?: number }>().catch(() => ({}));
  const result = await getTailscaleService().stop((body as { port?: number }).port);
  return c.json(result);
});

/**
 * GET /api/tunnels/tailscale/config - Get current serve config
 */
tunnelsRoutes.get('/tailscale/config', async (c) => {
  const result = await getTailscaleService().getServeConfig();
  return c.json(result);
});

// =============================================================================
// Cloudflare Tunnel
// =============================================================================

/**
 * GET /api/tunnels/cloudflare/status - Get Cloudflare status
 */
tunnelsRoutes.get('/cloudflare/status', async (c) => {
  const status = await getCloudflareTunnelService().getStatus();
  const service = getCloudflareTunnelService();

  return c.json({
    ...status,
    running: service.isRunning(),
    activeUrl: service.getActiveUrl(),
  });
});

/**
 * POST /api/tunnels/cloudflare/quick - Start a quick tunnel (no account needed)
 */
tunnelsRoutes.post('/cloudflare/quick', async (c) => {
  const body = await c.req.json<{
    port: number;
    protocol?: 'http' | 'https';
  }>();

  if (!body.port) {
    return c.json({ error: 'port is required' }, 400);
  }

  const result = await getCloudflareTunnelService().startQuickTunnel({
    port: body.port,
    protocol: body.protocol,
  });

  return c.json(result, result.success ? 200 : 500);
});

/**
 * POST /api/tunnels/cloudflare/named - Start a named tunnel (requires account)
 */
tunnelsRoutes.post('/cloudflare/named', async (c) => {
  const body = await c.req.json<{
    name: string;
    port: number;
    protocol?: 'http' | 'https';
    hostname?: string;
  }>();

  if (!body.name || !body.port) {
    return c.json({ error: 'name and port are required' }, 400);
  }

  const result = await getCloudflareTunnelService().startNamedTunnel({
    name: body.name,
    port: body.port,
    protocol: body.protocol,
    hostname: body.hostname,
  });

  return c.json(result, result.success ? 200 : 500);
});

/**
 * POST /api/tunnels/cloudflare/stop - Stop the active tunnel
 */
tunnelsRoutes.post('/cloudflare/stop', async (c) => {
  const result = await getCloudflareTunnelService().stop();
  return c.json(result);
});

/**
 * DELETE /api/tunnels/cloudflare/:name - Delete a named tunnel
 */
tunnelsRoutes.delete('/cloudflare/:name', async (c) => {
  const name = c.req.param('name');
  const result = await getCloudflareTunnelService().deleteTunnel(name);
  return c.json(result);
});
